import { For, createSignal, onMount } from "solid-js";
import { sendMessage } from "@/lib/messaging";
import {
  setSettings,
  useSettings,
  type FullPageMode,
  type HoverGranularity,
} from "@/lib/storage/settings";
import "./App.css";

type EngineId = "google" | "microsoft";

const GRANULARITIES: { value: HoverGranularity; label: string }[] = [
  { value: "word", label: "词" },
  { value: "sentence", label: "句子" },
  { value: "paragraph", label: "段落" },
];

const ENGINES: { value: EngineId; label: string }[] = [
  { value: "google", label: "Google" },
  { value: "microsoft", label: "Microsoft" },
];

const DEFAULT_FULL_PAGE_MODE: FullPageMode = "replace";

function Row(props: { label: string; children: import("solid-js").JSX.Element }) {
  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: "8px",
        "margin-bottom": "8px",
        "font-size": "12px",
      }}
    >
      <span style={{ color: "#666", "min-width": "52px" }}>{props.label}</span>
      {props.children}
    </div>
  );
}

function SegBtn(props: { active: boolean; onClick: () => void; children: import("solid-js").JSX.Element }) {
  return (
    <button
      onClick={props.onClick}
      style={{
        padding: "2px 10px",
        "border-radius": "4px",
        border: "1px solid",
        "border-color": props.active ? "#2a6df4" : "#d0d0d0",
        background: props.active ? "#2a6df4" : "#fff",
        color: props.active ? "#fff" : "#444",
        "font-size": "12px",
        cursor: "pointer",
      }}
    >
      {props.children}
    </button>
  );
}

function App() {
  const settings = useSettings();
  const [action, setAction] = createSignal<"idle" | "starting" | "restoring" | "retranslating">("idle");
  const [status, setStatus] = createSignal("");
  const [immersiveActive, setImmersiveActive] = createSignal(false);
  const [pageMode, setPageMode] = createSignal<FullPageMode | null>(null);
  let actionSeq = 0;
  let lastCommandId = 0;

  const unifiedEngine = (): EngineId | null => {
    const e = settings().engines;
    if (e.hover === e.selection && e.selection === e.fullPage) {
      return e.hover as EngineId;
    }
    return null;
  };

  const openOptions = (): void => {
    void browser.runtime.openOptionsPage().catch(() => {
      window.open(browser.runtime.getURL("/options.html"), "_blank");
    });
  };

  const nextCommandId = (): number => {
    lastCommandId = Math.max(lastCommandId + 1, Date.now());
    return lastCommandId;
  };

  const startedStatus = (blocks: number): string =>
    blocks > 0
      ? `已开始沉浸翻译，共 ${blocks} 个段落`
      : "当前网页没有可翻译的段落";

  const modeLabel = (mode: FullPageMode): string =>
    mode === "replace" ? "译文" : "双语";

  const engineLabel = (engine: EngineId): string =>
    ENGINES.find((e) => e.value === engine)?.label ?? engine;

  const visibleFullPageMode = (): FullPageMode =>
    pageMode() ?? DEFAULT_FULL_PAGE_MODE;

  const nextFullPageMode = (): FullPageMode =>
    visibleFullPageMode() === "replace" ? "bilingual" : "replace";

  const pageStateText = (): string =>
    immersiveActive()
      ? `当前网页：已翻译（全文 / ${modeLabel(visibleFullPageMode())}）`
      : pageMode()
        ? `当前网页：未翻译（全文 / 待用${modeLabel(visibleFullPageMode())}）`
        : `当前网页：未翻译（全文 / 默认${modeLabel(DEFAULT_FULL_PAGE_MODE)}）`;

  const toggleFullPageMode = (): void => {
    const mode = nextFullPageMode();
    if (!immersiveActive() || action() !== "idle") {
      if (!immersiveActive()) {
        setPageMode(mode);
        setStatus(`显示模式：${modeLabel(mode)}，开始沉浸翻译后生效`);
      }
      return;
    }

    const seq = ++actionSeq;
    setPageMode(mode);
    setStatus("已切换显示模式");
    void (async () => {
      const res = await sendMessage("translatePage", {
        target: settings().targetLang,
        engine: settings().engines.fullPage,
        mode,
        commandId: nextCommandId(),
      });
      if (seq !== actionSeq) return;
      const active = res.active || res.translating === true;
      setImmersiveActive(active);
      setPageMode(active ? (res.mode ?? mode) : null);
      setStatus(res.active ? "已切换显示模式" : startedStatus(res.blocks));
    })()
      .catch((e) => {
        if (seq !== actionSeq) return;
        setStatus(`错误: ${e instanceof Error ? e.message : String(e)}`);
      });
  };

  const setUnifiedEngine = (engine: EngineId): void => {
    const wasActive = immersiveActive();
    const mode = visibleFullPageMode();
    const seq = wasActive ? ++actionSeq : actionSeq;
    if (wasActive) {
      setAction("retranslating");
      setStatus(`正在切换到 ${engineLabel(engine)} 并重新翻译…`);
    }

    void (async () => {
      await setSettings({
        engines: { hover: engine, selection: engine, fullPage: engine },
      });
      if (!wasActive) return;
      const res = await sendMessage("translatePage", {
        target: settings().targetLang,
        engine,
        mode,
        commandId: nextCommandId(),
      });
      if (seq !== actionSeq) return;
      const active = res.active || res.translating === true;
      setImmersiveActive(active);
      setPageMode(active ? (res.mode ?? mode) : null);
      setStatus(
        active
          ? `已切换到 ${engineLabel(engine)}，正在重新翻译`
          : startedStatus(res.blocks),
      );
    })()
      .catch((e) => {
        if (seq !== actionSeq) return;
        setStatus(`错误: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => {
        if (seq === actionSeq) setAction("idle");
      });
  };

  const run = async () => {
    if (immersiveActive()) {
      const seq = ++actionSeq;
      const commandId = nextCommandId();
      setAction("restoring");
      setStatus("正在显示原文…");
      try {
        await sendMessage("restorePage", { commandId });
        if (seq !== actionSeq) return;
        setImmersiveActive(false);
        setPageMode(null);
        setStatus("已显示原文");
      } catch (e) {
        if (seq !== actionSeq) return;
        setStatus(`错误: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (seq === actionSeq) setAction("idle");
      }
      return;
    }

    const seq = ++actionSeq;
    const commandId = nextCommandId();
    const mode = visibleFullPageMode();
    setAction("starting");
    setImmersiveActive(true);
    setPageMode(mode);
    setStatus("已开始沉浸翻译");
    try {
      const res = await sendMessage("translatePage", {
        target: settings().targetLang,
        engine: settings().engines.fullPage,
        mode,
        commandId,
      });
      if (seq !== actionSeq) return;
      setImmersiveActive(res.active);
      setPageMode(res.active || res.translating === true ? (res.mode ?? mode) : null);
      setStatus(startedStatus(res.blocks));
    } catch (e) {
      if (seq !== actionSeq) return;
      setImmersiveActive(false);
      setStatus(`错误: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (seq === actionSeq) setAction("idle");
    }
  };

  onMount(() => {
    void sendMessage("getPageTranslateStatus", {})
      .then((res) => {
        setImmersiveActive(res.active || res.translating);
        setPageMode(res.active || res.translating ? (res.mode ?? null) : null);
      })
      .catch(() => {});
  });

  return (
    <div style={{ padding: "12px", "font-family": "system-ui,sans-serif", width: "300px" }}>
      <h1 style={{ "font-size": "14px", "font-weight": "600", margin: "0 0 12px" }}>
        OneLingo
      </h1>

      {/* 目标语言 */}
      <Row label="目标语言">
        <SegBtn
          active={settings().targetLang === "zh"}
          onClick={() => void setSettings({ targetLang: "zh" })}
        >
          中文
        </SegBtn>
        <SegBtn
          active={settings().targetLang === "en"}
          onClick={() => void setSettings({ targetLang: "en" })}
        >
          English
        </SegBtn>
      </Row>

      <Row label="翻译引擎">
        <For each={ENGINES}>
          {(e) => (
            <SegBtn
              active={unifiedEngine() === e.value}
              onClick={() => {
                if (unifiedEngine() !== e.value) setUnifiedEngine(e.value);
              }}
            >
              {e.label}
            </SegBtn>
          )}
        </For>
      </Row>

      {/* hover 粒度 */}
      <Row label="划词粒度">
        <For each={GRANULARITIES}>
          {(g) => (
            <SegBtn
              active={settings().hoverGranularity === g.value}
              onClick={() => void setSettings({ hoverGranularity: g.value })}
            >
              {g.label}
            </SegBtn>
          )}
        </For>
      </Row>

      {/* 沉浸翻译 */}
      <div style={{ "border-top": "1px solid #eee", "padding-top": "10px", "margin-top": "4px" }}>
        <Row label="显示模式">
          <SegBtn active={immersiveActive()} onClick={toggleFullPageMode}>
            {modeLabel(visibleFullPageMode())}，点击切换
          </SegBtn>
        </Row>
        <p style={{ margin: "0 0 8px", "font-size": "12px", color: "#666" }}>
          {pageStateText()}
        </p>
        <button
          onClick={run}
          disabled={action() === "restoring"}
          style={{
            width: "100%",
            padding: "8px 10px",
            "font-size": "12px",
            "border-radius": "6px",
            border: "1px solid #d0d0d0",
            background: immersiveActive() ? "#222" : action() === "starting" ? "#f2f2f2" : "#fff",
            color: immersiveActive() ? "#fff" : "#222",
            cursor: action() === "restoring" ? "default" : "pointer",
          }}
        >
          {action() === "restoring"
            ? "显示原文中…"
            : immersiveActive()
              ? "显示原文"
              : "沉浸翻译"}
        </button>
        <p
          style={{
            margin: "8px 0 0",
            "word-break": "break-word",
            "font-size": "12px",
            color: status().startsWith("错误:") ? "#c0392b" : "#666",
            "min-height": "1.5em",
          }}
        >
          {status()}
        </p>
        <button
          onClick={openOptions}
          style={{
            width: "100%",
            padding: "6px 10px",
            "font-size": "12px",
            "border-radius": "6px",
            border: "1px solid #d0d0d0",
            background: "#fff",
            color: "#444",
            cursor: "pointer",
          }}
        >
          打开设置
        </button>
      </div>
    </div>
  );
}

export default App;
