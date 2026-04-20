import { For } from "solid-js";
import { sendMessage } from "@/lib/messaging";
import { setSettings, useSettings, type HoverGranularity } from "@/lib/storage/settings";
import "./App.css";

const GRANULARITIES: { value: HoverGranularity; label: string }[] = [
  { value: "word", label: "词" },
  { value: "sentence", label: "句子" },
  { value: "paragraph", label: "段落" },
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

  // ── 测试翻译 ──
  let textRef!: HTMLTextAreaElement;
  let resultRef!: HTMLPreElement;
  let btnRef!: HTMLButtonElement;

  const run = async () => {
    btnRef.disabled = true;
    btnRef.textContent = "翻译中…";
    resultRef.textContent = "";
    try {
      const res = await sendMessage("translate", {
        text: textRef.value,
        target: settings().targetLang,
      });
      resultRef.textContent = res.text;
    } catch (e) {
      resultRef.textContent = `错误: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      btnRef.disabled = false;
      btnRef.textContent = "翻译";
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

      {/* 测试翻译 */}
      <div style={{ "border-top": "1px solid #eee", "padding-top": "10px", "margin-top": "4px" }}>
        <textarea
          ref={textRef}
          rows={3}
          style={{
            width: "100%",
            "box-sizing": "border-box",
            "font-size": "12px",
            resize: "vertical",
          }}
        >
          Hello, world.
        </textarea>
        <button
          ref={btnRef}
          onClick={run}
          style={{ "margin-top": "6px", "font-size": "12px" }}
        >
          翻译
        </button>
        <pre
          ref={resultRef}
          style={{
            "white-space": "pre-wrap",
            "word-break": "break-word",
            background: "#f4f4f4",
            padding: "6px 8px",
            "margin-top": "8px",
            "font-size": "12px",
            "min-height": "1.5em",
          }}
        />
      </div>
    </div>
  );
}

export default App;
