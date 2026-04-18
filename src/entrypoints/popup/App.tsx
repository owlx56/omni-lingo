import { setSettings, useSettings } from "@/lib/storage/settings";
import "./App.css";

function App() {
  const settings = useSettings();

  const toggleTarget = () => {
    const next = settings().targetLang === "zh" ? "en" : "zh";
    void setSettings({ targetLang: next });
  };

  return (
    <div style={{ padding: "16px", "font-family": "sans-serif" }}>
      <h1 style={{ "font-size": "16px", margin: "0 0 8px" }}>OneLingo</h1>
      <p style={{ margin: "0 0 12px", "font-size": "13px" }}>
        目标语言: <b>{settings().targetLang}</b>
      </p>
      <button onClick={toggleTarget}>切换 (zh ↔ en)</button>
    </div>
  );
}

export default App;
