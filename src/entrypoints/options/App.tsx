import { For } from "solid-js";
import {
  setSettings,
  useSettings,
  type FullPageEngineId,
  type HoverGranularity,
} from "@/lib/storage/settings";

const ENGINES: { value: FullPageEngineId; label: string; note: string }[] = [
  { value: "google2", label: "Google 2", note: "translate_a/t HTML" },
  { value: "microsoft", label: "Microsoft", note: "Edge Translator API" },
];

const LANGS = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
] as const;

const GRANULARITIES: { value: HoverGranularity; label: string; note: string }[] = [
  { value: "word", label: "词", note: "命中单词后翻译单词" },
  { value: "sentence", label: "句子", note: "命中单词后翻译所在句子" },
  { value: "paragraph", label: "段落", note: "命中单词后翻译最近段落" },
];

function OptionButton(props: {
  active: boolean;
  label: string;
  note?: string;
  onClick: () => void;
}) {
  return (
    <button
      class="option-button"
      classList={{ active: props.active }}
      onClick={props.onClick}
      type="button"
    >
      <span>{props.label}</span>
      {props.note ? <small>{props.note}</small> : null}
    </button>
  );
}

function Section(props: { title: string; children: import("solid-js").JSX.Element }) {
  return (
    <section class="section">
      <h2>{props.title}</h2>
      <div class="option-grid">{props.children}</div>
    </section>
  );
}

function App() {
  const settings = useSettings();

  const fullPageEngine = (): FullPageEngineId => settings().engines.fullPage;

  const setFullPageEngine = (engine: FullPageEngineId): void => {
    void setSettings({ engines: { fullPage: engine } });
  };

  return (
    <main class="page">
      <header class="header">
        <div>
          <p class="eyebrow">OneLingo</p>
          <h1>设置</h1>
        </div>
        <span class="scope">本地扩展页面</span>
      </header>

      <Section title="目标语言">
        <For each={LANGS}>
          {(lang) => (
            <OptionButton
              active={settings().targetLang === lang.value}
              label={lang.label}
              onClick={() => void setSettings({ targetLang: lang.value })}
            />
          )}
        </For>
      </Section>

      <Section title="网页翻译引擎">
        <For each={ENGINES}>
          {(engine) => (
            <OptionButton
              active={fullPageEngine() === engine.value}
              label={engine.label}
              note={engine.note}
              onClick={() => setFullPageEngine(engine.value)}
            />
          )}
        </For>
      </Section>

      <Section title="悬停粒度">
        <For each={GRANULARITIES}>
          {(item) => (
            <OptionButton
              active={settings().hoverGranularity === item.value}
              label={item.label}
              note={item.note}
              onClick={() => void setSettings({ hoverGranularity: item.value })}
            />
          )}
        </For>
      </Section>
    </main>
  );
}

export default App;
