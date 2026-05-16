import { For } from "solid-js";
import {
  resolveTranslationStyleColor,
  resolveTranslationStyleFontFamily,
  resolveTranslationStyleTextDecoration,
} from "@/lib/translation-style";
import {
  setSettings,
  useSettings,
  HOVER_FONT_SIZE_MAX,
  HOVER_FONT_SIZE_MIN,
  type FullPageEngineId,
  type FullPageMode,
  type HoverGranularity,
  type TranslationColor,
  type TranslationFontFamily,
  type TranslationUnderlineStyle,
} from "@/lib/storage/settings";

const ENGINES: { value: FullPageEngineId; label: string; note: string }[] = [
  { value: "google2", label: "Google 2", note: "translate_a/t HTML" },
  { value: "microsoft", label: "Microsoft", note: "Edge Translator API" },
];

const LANGS = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
] as const;

const GRANULARITIES: {
  value: HoverGranularity;
  label: string;
  note: string;
}[] = [
  { value: "word", label: "词", note: "命中单词后翻译单词" },
  { value: "sentence", label: "句子", note: "命中单词后翻译所在句子" },
  { value: "paragraph", label: "段落", note: "命中单词后翻译最近段落" },
];

const MODES: { value: FullPageMode; label: string; note: string }[] = [
  { value: "replace", label: "译文", note: "默认替换原文" },
  { value: "bilingual", label: "双语", note: "默认显示原文和译文" },
];

const CLICK_TO_SHOW_ORIGINAL_OPTIONS = [
  { value: true, label: "开启", note: "点击译文临时查看原文" },
  { value: false, label: "关闭", note: "点击译文不切换原文" },
] as const;

const FONT_FAMILIES: {
  value: TranslationFontFamily;
  label: string;
  note: string;
}[] = [
  { value: "inherit", label: "默认", note: "沿用网页或模式样式" },
  { value: "serif", label: "衬线", note: "Georgia / Times" },
  { value: "sans", label: "无衬线", note: "Segoe UI / system-ui" },
  { value: "mono", label: "等宽", note: "Consolas / monospace" },
];

const COLORS: { value: TranslationColor; label: string; color?: string }[] = [
  { value: "inherit", label: "默认" },
  { value: "muted", label: "灰色", color: "#6b7280" },
  { value: "blue", label: "蓝色", color: "#2563eb" },
  { value: "green", label: "绿色", color: "#047857" },
  { value: "red", label: "红色", color: "#dc2626" },
  { value: "custom", label: "自定义" },
];

const UNDERLINE_STYLES: {
  value: TranslationUnderlineStyle;
  label: string;
  note: string;
}[] = [
  { value: "none", label: "无样式", note: "默认不添加下划线" },
  { value: "solid", label: "实线", note: "普通下划线" },
  { value: "dotted", label: "点线", note: "点状下划线" },
  { value: "wavy", label: "波浪线", note: "波浪下划线" },
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

function ColorButton(props: {
  active: boolean;
  label: string;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      class="color-button"
      classList={{ active: props.active }}
      onClick={props.onClick}
      type="button"
    >
      <span
        class="color-swatch"
        style={{ "background-color": props.color ?? "transparent" }}
      />
      <span>{props.label}</span>
    </button>
  );
}

function Section(props: {
  title: string;
  children: import("solid-js").JSX.Element;
}) {
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

  const setTranslationStyle = (
    patch: Parameters<typeof setSettings>[0]["translationStyle"],
  ): void => {
    void setSettings({ translationStyle: patch });
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

      <Section title="全文显示模式">
        <For each={MODES}>
          {(mode) => (
            <OptionButton
              active={settings().fullPageMode === mode.value}
              label={mode.label}
              note={mode.note}
              onClick={() => void setSettings({ fullPageMode: mode.value })}
            />
          )}
        </For>
      </Section>

      <Section title="仅译文点击原文">
        <For each={CLICK_TO_SHOW_ORIGINAL_OPTIONS}>
          {(option) => (
            <OptionButton
              active={settings().fullPageClickToShowOriginal === option.value}
              label={option.label}
              note={option.note}
              onClick={() =>
                void setSettings({
                  fullPageClickToShowOriginal: option.value,
                })
              }
            />
          )}
        </For>
      </Section>

      <section class="section">
        <h2>译文样式</h2>
        <div class="style-panel">
          <div class="style-block">
            <span class="style-label">下划线</span>
            <div class="option-grid compact">
              <For each={UNDERLINE_STYLES}>
                {(item) => (
                  <OptionButton
                    active={
                      settings().translationStyle.underlineStyle === item.value
                    }
                    label={item.label}
                    note={item.note}
                    onClick={() =>
                      setTranslationStyle({ underlineStyle: item.value })
                    }
                  />
                )}
              </For>
            </div>
          </div>

          <div class="style-block">
            <span class="style-label">字体</span>
            <div class="option-grid compact">
              <For each={FONT_FAMILIES}>
                {(font) => (
                  <OptionButton
                    active={
                      settings().translationStyle.fontFamily === font.value
                    }
                    label={font.label}
                    note={font.note}
                    onClick={() =>
                      setTranslationStyle({ fontFamily: font.value })
                    }
                  />
                )}
              </For>
            </div>
          </div>

          <div class="style-block">
            <span class="style-label">颜色</span>
            <div class="color-grid">
              <For each={COLORS}>
                {(color) => (
                  <ColorButton
                    active={settings().translationStyle.color === color.value}
                    color={
                      color.value === "custom"
                        ? settings().translationStyle.customColor
                        : color.color
                    }
                    label={color.label}
                    onClick={() => setTranslationStyle({ color: color.value })}
                  />
                )}
              </For>
              <input
                aria-label="自定义译文颜色"
                class="color-input"
                disabled={settings().translationStyle.color !== "custom"}
                onInput={(event) =>
                  setTranslationStyle({
                    color: "custom",
                    customColor: event.currentTarget.value,
                  })
                }
                type="color"
                value={settings().translationStyle.customColor}
              />
            </div>
          </div>

          <div
            class="style-preview"
            style={{
              color: resolveTranslationStyleColor(settings().translationStyle),
              "font-family": resolveTranslationStyleFontFamily(
                settings().translationStyle.fontFamily,
              ),
              "text-decoration": resolveTranslationStyleTextDecoration(
                settings().translationStyle,
              ),
            }}
          >
            译文预览 Translation preview
          </div>
        </div>
      </section>

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

      <section class="section">
        <h2>悬停译文字号</h2>
        <div class="range-row">
          <input
            aria-label="悬停译文字号"
            aria-valuetext={`${settings().hoverFontSize} 像素`}
            class="range-input"
            max={HOVER_FONT_SIZE_MAX}
            min={HOVER_FONT_SIZE_MIN}
            onInput={(event) =>
              void setSettings({
                hoverFontSize: Number(event.currentTarget.value),
              })
            }
            step={1}
            type="range"
            value={settings().hoverFontSize}
          />
          <span aria-hidden="true" class="range-value">
            {settings().hoverFontSize}px
          </span>
        </div>
      </section>
    </main>
  );
}

export default App;
