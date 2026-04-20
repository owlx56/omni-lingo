import { For, createSignal } from "solid-js";
import { sendMessage } from "@/lib/messaging";
import { setSettings, useSettings, type HoverGranularity } from "@/lib/storage/settings";
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
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal("");

  const unifiedEngine = (): EngineId | null => {
    const e = settings().engines;
    if (e.hover === e.selection && e.selection === e.fullPage) {
      return e.hover as EngineId;
    }
    return null;
  };

  const setUnifiedEngine = (engine: EngineId): void => {
    void setSettings({
      engines: { hover: engine, selection: engine, fullPage: engine },
    });
  };

  const run = async () => {
    setBusy(true);
    setStatus("");
    try {
      const res = await sendMessage("translatePage", {
        target: settings().targetLang,
        engine: settings().engines.fullPage,
      });
      setStatus(
        res.blocks > 0
          ? `已开始翻译当前网页，共 ${res.blocks} 个段落`
          : "当前网页没有可翻译的段落",
      );
    } catch (e) {
      setStatus(`错误: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

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
              onClick={() => setUnifiedEngine(e.value)}
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

      {/* 网页翻译 */}
      <div style={{ "border-top": "1px solid #eee", "padding-top": "10px", "margin-top": "4px" }}>
        <button
          onClick={run}
          disabled={busy()}
          style={{
            width: "100%",
            padding: "8px 10px",
            "font-size": "12px",
            "border-radius": "6px",
            border: "1px solid #d0d0d0",
            background: busy() ? "#f2f2f2" : "#fff",
            color: "#222",
            cursor: busy() ? "default" : "pointer",
          }}
        >
          {busy() ? "启动中…" : "网页翻译"}
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
      </div>
    </div>
  );
}

export default App;
