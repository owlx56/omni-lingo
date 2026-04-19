import { createSignal } from "solid-js";
import { sendMessage } from "@/lib/messaging";
import { setSettings, useSettings } from "@/lib/storage/settings";
import "./App.css";

function App() {
  const settings = useSettings();
  const [text, setText] = createSignal("Hello, world.");
  const [result, setResult] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);

  const toggleTarget = () => {
    const next = settings().targetLang === "zh" ? "en" : "zh";
    void setSettings({ targetLang: next });
  };

  const run = async () => {
    setBusy(true);
    setErr(null);
    setResult("");
    try {
      const res = await sendMessage("translate", {
        text: text(),
        target: settings().targetLang,
      });
      setResult(res.text);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: "12px", "font-family": "sans-serif", width: "320px" }}>
      <h1 style={{ "font-size": "15px", margin: "0 0 8px" }}>OneLingo</h1>

      <div style={{ "font-size": "12px", "margin-bottom": "8px" }}>
        目标: <b>{settings().targetLang}</b>{" "}
        <button onClick={toggleTarget}>切换</button>
      </div>

      <textarea
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        rows={3}
        style={{ width: "100%", "box-sizing": "border-box", "font-size": "13px" }}
      />
      <button onClick={run} disabled={busy()} style={{ "margin-top": "6px" }}>
        {busy() ? "翻译中…" : "翻译"}
      </button>

      {result() && (
        <pre
          style={{
            "white-space": "pre-wrap",
            "word-break": "break-word",
            background: "#f4f4f4",
            padding: "8px",
            "margin-top": "8px",
            "font-size": "13px",
          }}
        >
          {result()}
        </pre>
      )}
      {err() && (
        <p style={{ color: "crimson", "font-size": "12px" }}>错误: {err()}</p>
      )}
    </div>
  );
}

export default App;
