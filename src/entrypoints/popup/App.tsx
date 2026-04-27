import { For, createSignal, onMount } from "solid-js";
import { sendMessage } from "@/lib/messaging";
import {
  getSettings,
  type FullPageEngineId,
  type FullPageMode,
} from "@/lib/storage/settings";
import "./App.css";

const ENGINES: { value: FullPageEngineId; label: string }[] = [
  { value: "google2", label: "Google 2" },
  { value: "microsoft", label: "Microsoft" },
];

const LANGS = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
] as const;

const DEFAULT_FULL_PAGE_MODE: FullPageMode = "replace";
const DEFAULT_FULL_PAGE_ENGINE: FullPageEngineId = "google2";
const DEFAULT_TARGET = "zh";

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
  const [action, setAction] = createSignal<"idle" | "starting" | "restoring" | "retranslating">("idle");
  const [status, setStatus] = createSignal("");
  const [immersiveActive, setImmersiveActive] = createSignal(false);
  const [pageMode, setPageMode] = createSignal<FullPageMode>(DEFAULT_FULL_PAGE_MODE);
  const [pageEngine, setPageEngine] = createSignal<FullPageEngineId>(DEFAULT_FULL_PAGE_ENGINE);
  const [pageTarget, setPageTarget] = createSignal(DEFAULT_TARGET);
  let actionSeq = 0;
  let lastCommandId = 0;

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

  const engineLabel = (engine: FullPageEngineId): string =>
    ENGINES.find((e) => e.value === engine)?.label ?? engine;

  const nextFullPageMode = (): FullPageMode =>
    pageMode() === "replace" ? "bilingual" : "replace";

  const pageStateText = (): string =>
    immersiveActive()
      ? `当前网页：已翻译（${engineLabel(pageEngine())} / ${pageTarget()} / ${modeLabel(pageMode())}）`
      : `当前网页：未翻译（待用 ${engineLabel(pageEngine())} / ${pageTarget()} / ${modeLabel(pageMode())}）`;

  const updatePagePrefs = (patch: {
    target?: string;
    engine?: FullPageEngineId;
    mode?: FullPageMode;
  }): void => {
    void sendMessage("setPageTranslatePrefs", patch).catch(() => {});
  };

  const retranslateCurrentPage = (
    patch: { target?: string; engine?: FullPageEngineId; mode?: FullPageMode },
    message: string,
  ): void => {
    const target = patch.target ?? pageTarget();
    const engine = patch.engine ?? pageEngine();
    const mode = patch.mode ?? pageMode();
    const seq = ++actionSeq;

    setAction("retranslating");
    setStatus(message);

    void sendMessage("translatePage", {
      target,
      engine,
      mode,
      commandId: nextCommandId(),
    })
      .then((res) => {
        if (seq !== actionSeq) return;
        const active = res.active || res.translating === true;
        setImmersiveActive(active);
        setPageMode(res.mode ?? mode);
        setPageEngine(res.engine ?? engine);
        setPageTarget(res.target ?? target);
        setStatus(active ? "当前网页已重新翻译" : startedStatus(res.blocks));
      })
      .catch((e) => {
        if (seq !== actionSeq) return;
        setStatus(`错误: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => {
        if (seq === actionSeq) setAction("idle");
      });
  };

  const toggleFullPageMode = (): void => {
    const mode = nextFullPageMode();
    if (!immersiveActive() || action() !== "idle") {
      if (!immersiveActive()) {
        setPageMode(mode);
        updatePagePrefs({ mode });
        setStatus(`显示模式：${modeLabel(mode)}，开始沉浸翻译后生效`);
      }
      return;
    }

    const seq = ++actionSeq;
    setPageMode(mode);
    setStatus("已切换显示模式");
    void (async () => {
      const res = await sendMessage("translatePage", {
        target: pageTarget(),
        engine: pageEngine(),
        mode,
        commandId: nextCommandId(),
      });
      if (seq !== actionSeq) return;
      const active = res.active || res.translating === true;
      setImmersiveActive(active);
      setPageMode(res.mode ?? mode);
      setPageEngine(res.engine ?? pageEngine());
      setPageTarget(res.target ?? pageTarget());
      setStatus(res.active ? "已切换显示模式" : startedStatus(res.blocks));
    })()
      .catch((e) => {
        if (seq !== actionSeq) return;
        setStatus(`错误: ${e instanceof Error ? e.message : String(e)}`);
      });
  };

  const setFullPageEngine = (engine: FullPageEngineId): void => {
    if (pageEngine() === engine) return;
    setPageEngine(engine);
    if (immersiveActive()) {
      retranslateCurrentPage(
        { engine },
        `正在切换到 ${engineLabel(engine)} 并重新翻译当前网页…`,
      );
    } else {
      updatePagePrefs({ engine });
      setStatus(`当前网页引擎：${engineLabel(engine)}`);
    }
  };

  const setTargetLang = (target: string): void => {
    if (pageTarget() === target) return;
    setPageTarget(target);
    if (immersiveActive()) {
      retranslateCurrentPage({ target }, "正在切换目标语言并重新翻译当前网页…");
    } else {
      updatePagePrefs({ target });
      setStatus(`当前网页目标语言：${target}`);
    }
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
    const mode = pageMode();
    setAction("starting");
    setImmersiveActive(true);
    setPageMode(mode);
    setStatus("已开始沉浸翻译");
    try {
      const res = await sendMessage("translatePage", {
        target: pageTarget(),
        engine: pageEngine(),
        mode,
        commandId,
      });
      if (seq !== actionSeq) return;
      setImmersiveActive(res.active);
      setPageMode(res.mode ?? mode);
      setPageEngine(res.engine ?? pageEngine());
      setPageTarget(res.target ?? pageTarget());
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
    void (async () => {
      const defaults = await getSettings();
      const res = await sendMessage("getPageTranslateStatus", {});
      const mode = res.mode ?? defaults.fullPageMode;
      const engine = res.engine ?? defaults.engines.fullPage;
      const target = res.target ?? defaults.targetLang;

      setPageMode(mode);
      setPageEngine(engine);
      setPageTarget(target);
      setImmersiveActive(res.active || res.translating);
    })()
      .catch(() => {
        void getSettings().then((defaults) => {
          setPageMode(defaults.fullPageMode);
          setPageEngine(defaults.engines.fullPage);
          setPageTarget(defaults.targetLang);
        });
      });
  });

  return (
    <div style={{ padding: "12px", "font-family": "system-ui,sans-serif", width: "300px" }}>
      <h1 style={{ "font-size": "14px", "font-weight": "600", margin: "0 0 12px" }}>
        OneLingo
      </h1>

      {/* 目标语言 */}
      <Row label="目标语言">
        <For each={LANGS}>
          {(lang) => (
            <SegBtn
              active={pageTarget() === lang.value}
              onClick={() => setTargetLang(lang.value)}
            >
              {lang.label}
            </SegBtn>
          )}
        </For>
      </Row>

      <Row label="网页引擎">
        <For each={ENGINES}>
          {(e) => (
            <SegBtn
              active={pageEngine() === e.value}
              onClick={() => setFullPageEngine(e.value)}
            >
              {e.label}
            </SegBtn>
          )}
        </For>
      </Row>

      {/* 沉浸翻译 */}
      <div style={{ "border-top": "1px solid #eee", "padding-top": "10px", "margin-top": "4px" }}>
        <Row label="显示模式">
          <SegBtn active={immersiveActive()} onClick={toggleFullPageMode}>
            {modeLabel(pageMode())}，点击切换
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
