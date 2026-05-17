import { For, createSignal, type JSX } from "solid-js";
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
  type TargetLang,
  type ThemePreference,
  type TranslationColor,
  type TranslationFontFamily,
  type TranslationUnderlineStyle,
  type UiLang,
} from "@/lib/storage/settings";
import { useT, type MessageKey, type TFn } from "@/lib/i18n";
import {
  IconHover,
  IconImmersive,
  IconInfo,
  IconLogo,
  IconMoon,
  IconSelection,
  IconSun,
  IconSystem,
  IconUser,
} from "./icons";

type TabId = "account" | "hover" | "selection" | "immersive" | "about";
type OptionIcon = (props: { size?: number }) => JSX.Element;

const VERSION = "0.0.0";

const TABS: {
  id: TabId;
  labelKey: MessageKey;
  icon: OptionIcon;
}[] = [
  { id: "account", labelKey: "sidebar.account", icon: IconUser },
  { id: "hover", labelKey: "sidebar.hover", icon: IconHover },
  { id: "selection", labelKey: "sidebar.selection", icon: IconSelection },
  { id: "immersive", labelKey: "sidebar.immersive", icon: IconImmersive },
  { id: "about", labelKey: "sidebar.about", icon: IconInfo },
];

const UI_LANGS: { value: UiLang; labelKey: MessageKey }[] = [
  { value: "zh", labelKey: "common.chinese" },
  { value: "en", labelKey: "common.english" },
];

const TARGET_LANGS: { value: TargetLang; labelKey: MessageKey }[] = [
  { value: "inherit", labelKey: "common.followUiLang" },
  { value: "zh", labelKey: "common.chinese" },
  { value: "en", labelKey: "common.english" },
];

const HOVER_ENGINES: { value: string; label: string; noteKey: MessageKey }[] = [
  { value: "google", label: "Google", noteKey: "engine.note.google" },
  { value: "google2", label: "Google 2", noteKey: "engine.note.google2" },
  { value: "microsoft", label: "Microsoft", noteKey: "engine.note.microsoft" },
];

const FULL_PAGE_ENGINES: {
  value: FullPageEngineId;
  label: string;
  noteKey: MessageKey;
}[] = [
  { value: "google2", label: "Google 2", noteKey: "engine.note.google2" },
  { value: "microsoft", label: "Microsoft", noteKey: "engine.note.microsoft" },
];

const GRANULARITIES: {
  value: HoverGranularity;
  labelKey: MessageKey;
  noteKey: MessageKey;
}[] = [
  {
    value: "word",
    labelKey: "granularity.word",
    noteKey: "granularity.word.note",
  },
  {
    value: "sentence",
    labelKey: "granularity.sentence",
    noteKey: "granularity.sentence.note",
  },
  {
    value: "paragraph",
    labelKey: "granularity.paragraph",
    noteKey: "granularity.paragraph.note",
  },
];

const MODES: {
  value: FullPageMode;
  labelKey: MessageKey;
  noteKey: MessageKey;
}[] = [
  { value: "replace", labelKey: "mode.replace", noteKey: "mode.replace.note" },
  {
    value: "bilingual",
    labelKey: "mode.bilingual",
    noteKey: "mode.bilingual.note",
  },
];

const CLICK_TO_SHOW_ORIGINAL_OPTIONS = [
  { value: true, labelKey: "common.on", noteKey: "clickToShow.on.note" },
  { value: false, labelKey: "common.off", noteKey: "clickToShow.off.note" },
] as const;

const THEMES: {
  value: ThemePreference;
  labelKey: MessageKey;
  icon: OptionIcon;
}[] = [
  { value: "system", labelKey: "appearance.system", icon: IconSystem },
  { value: "light", labelKey: "appearance.light", icon: IconSun },
  { value: "dark", labelKey: "appearance.dark", icon: IconMoon },
];

const FONT_FAMILIES: {
  value: TranslationFontFamily;
  labelKey: MessageKey;
  noteKey: MessageKey;
}[] = [
  { value: "inherit", labelKey: "font.inherit", noteKey: "font.inherit.note" },
  { value: "serif", labelKey: "font.serif", noteKey: "font.serif.note" },
  { value: "sans", labelKey: "font.sans", noteKey: "font.sans.note" },
  { value: "mono", labelKey: "font.mono", noteKey: "font.mono.note" },
];

const COLORS: { value: TranslationColor; labelKey: MessageKey; color?: string }[] =
  [
    { value: "inherit", labelKey: "color.inherit" },
    { value: "muted", labelKey: "color.muted", color: "#6b7280" },
    { value: "blue", labelKey: "color.blue", color: "#2563eb" },
    { value: "green", labelKey: "color.green", color: "#047857" },
    { value: "red", labelKey: "color.red", color: "#dc2626" },
    { value: "custom", labelKey: "color.custom" },
  ];

const UNDERLINE_STYLES: {
  value: TranslationUnderlineStyle;
  labelKey: MessageKey;
  noteKey: MessageKey;
}[] = [
  {
    value: "none",
    labelKey: "underline.none",
    noteKey: "underline.none.note",
  },
  {
    value: "solid",
    labelKey: "underline.solid",
    noteKey: "underline.solid.note",
  },
  {
    value: "dotted",
    labelKey: "underline.dotted",
    noteKey: "underline.dotted.note",
  },
  {
    value: "wavy",
    labelKey: "underline.wavy",
    noteKey: "underline.wavy.note",
  },
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
  children: JSX.Element;
  compact?: boolean;
}) {
  return (
    <section class="section">
      <h2>{props.title}</h2>
      <div class="option-grid" classList={{ compact: props.compact }}>
        {props.children}
      </div>
    </section>
  );
}

function Field(props: { label: string; children: JSX.Element }) {
  return (
    <div class="field">
      <span class="field-label">{props.label}</span>
      <div class="field-control">{props.children}</div>
    </div>
  );
}

function Sidebar(props: {
  activeTab: TabId;
  onSelect: (tab: TabId) => void;
  t: TFn;
}) {
  return (
    <nav aria-label="Settings sections" class="sidebar">
      <For each={TABS}>
        {(tab) => {
          const Icon = tab.icon;
          return (
            <button
              class="sidebar-item"
              classList={{ active: props.activeTab === tab.id }}
              onClick={() => props.onSelect(tab.id)}
              type="button"
            >
              <Icon size={17} />
              <span>{props.t(tab.labelKey)}</span>
            </button>
          );
        }}
      </For>
    </nav>
  );
}

function AppearanceSwitch(props: { value: ThemePreference; t: TFn }) {
  return (
    <div class="icon-segment" role="group">
      <For each={THEMES}>
        {(theme) => {
          const Icon = theme.icon;
          const label = props.t(theme.labelKey);
          return (
            <button
              aria-label={label}
              class="icon-option"
              classList={{ active: props.value === theme.value }}
              onClick={() => void setSettings({ theme: theme.value })}
              title={label}
              type="button"
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          );
        }}
      </For>
    </div>
  );
}

function TargetLanguageOptions(props: {
  value: TargetLang;
  onChange: (value: TargetLang) => void;
  t: TFn;
}) {
  return (
    <For each={TARGET_LANGS}>
      {(lang) => (
        <OptionButton
          active={props.value === lang.value}
          label={props.t(lang.labelKey)}
          onClick={() => props.onChange(lang.value)}
        />
      )}
    </For>
  );
}

function App() {
  const settings = useSettings();
  const t = useT();
  const [activeTab, setActiveTab] = createSignal<TabId>("account");

  const setTranslationStyle = (
    patch: Parameters<typeof setSettings>[0]["translationStyle"],
  ): void => {
    void setSettings({ translationStyle: patch });
  };

  const tabTitle = (): string => {
    const tab = TABS.find((item) => item.id === activeTab());
    return tab ? t(tab.labelKey) : t("sidebar.account");
  };

  const renderAccount = (): JSX.Element => (
    <>
      <section class="section">
        <h2>{t("section.profile")}</h2>
        <div class="profile-panel">
          <div class="avatar" aria-hidden="true">
            <IconLogo size={28} />
          </div>
          <Field label={t("profile.displayName")}>
            <input
              class="text-input"
              disabled
              type="text"
              value={t("profile.placeholder")}
            />
          </Field>
          <div class="notice">{t("profile.notice")}</div>
        </div>
      </section>

      <section class="section">
        <h2>{t("section.preferences")}</h2>
        <div class="field-stack">
          <Field label={t("preferences.uiLang")}>
            <div class="option-grid compact inline-grid">
              <For each={UI_LANGS}>
                {(lang) => (
                  <OptionButton
                    active={settings().uiLang === lang.value}
                    label={t(lang.labelKey)}
                    onClick={() => void setSettings({ uiLang: lang.value })}
                  />
                )}
              </For>
            </div>
          </Field>
          <Field label={t("preferences.appearance")}>
            <AppearanceSwitch value={settings().theme} t={t} />
          </Field>
        </div>
      </section>

    </>
  );

  const renderAbout = (): JSX.Element => (
    <section class="section">
      <h2>{t("section.about")}</h2>
      <div class="about-panel">
        <div class="avatar" aria-hidden="true">
          <IconLogo size={28} />
        </div>
        <strong>OneLingo</strong>
        <span>{t("about.tagline")}</span>
        <span>{t("about.version", { version: VERSION })}</span>
      </div>
    </section>
  );

  const renderHover = (): JSX.Element => (
    <>
      <Section title={t("section.targetLang")}>
        <TargetLanguageOptions
          value={settings().hoverTargetLang}
          onChange={(hoverTargetLang) => void setSettings({ hoverTargetLang })}
          t={t}
        />
      </Section>

      <Section title={t("section.engine")}>
        <For each={HOVER_ENGINES}>
          {(engine) => (
            <OptionButton
              active={settings().engines.hover === engine.value}
              label={engine.label}
              note={t(engine.noteKey)}
              onClick={() => void setSettings({ engines: { hover: engine.value } })}
            />
          )}
        </For>
      </Section>

      <Section title={t("section.granularity")}>
        <For each={GRANULARITIES}>
          {(item) => (
            <OptionButton
              active={settings().hoverGranularity === item.value}
              label={t(item.labelKey)}
              note={t(item.noteKey)}
              onClick={() => void setSettings({ hoverGranularity: item.value })}
            />
          )}
        </For>
      </Section>

      <section class="section">
        <h2>{t("section.fontSize")}</h2>
        <div class="range-row">
          <input
            aria-label={t("slider.fontSize.aria")}
            aria-valuetext={t("slider.fontSize.valuetext", {
              n: settings().hoverFontSize,
            })}
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
    </>
  );

  const renderSelection = (): JSX.Element => (
    <>
      <Section title={t("section.targetLang")}>
        <TargetLanguageOptions
          value={settings().selectionTargetLang}
          onChange={(selectionTargetLang) =>
            void setSettings({ selectionTargetLang })
          }
          t={t}
        />
      </Section>

      <Section title={t("section.engine")}>
        <For each={HOVER_ENGINES}>
          {(engine) => (
            <OptionButton
              active={settings().engines.selection === engine.value}
              label={engine.label}
              note={t(engine.noteKey)}
              onClick={() =>
                void setSettings({ engines: { selection: engine.value } })
              }
            />
          )}
        </For>
      </Section>

      <p class="muted-note">{t("selection.note")}</p>
    </>
  );

  const renderTranslationStyle = (): JSX.Element => (
    <section class="section">
      <h2>{t("section.translationStyle")}</h2>
      <div class="style-panel">
        <div class="style-block">
          <span class="style-label">{t("style.label.underline")}</span>
          <div class="option-grid compact">
            <For each={UNDERLINE_STYLES}>
              {(item) => (
                <OptionButton
                  active={
                    settings().translationStyle.underlineStyle === item.value
                  }
                  label={t(item.labelKey)}
                  note={t(item.noteKey)}
                  onClick={() =>
                    setTranslationStyle({ underlineStyle: item.value })
                  }
                />
              )}
            </For>
          </div>
        </div>

        <div class="style-block">
          <span class="style-label">{t("style.label.font")}</span>
          <div class="option-grid compact">
            <For each={FONT_FAMILIES}>
              {(font) => (
                <OptionButton
                  active={settings().translationStyle.fontFamily === font.value}
                  label={t(font.labelKey)}
                  note={t(font.noteKey)}
                  onClick={() => setTranslationStyle({ fontFamily: font.value })}
                />
              )}
            </For>
          </div>
        </div>

        <div class="style-block">
          <span class="style-label">{t("style.label.color")}</span>
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
                  label={t(color.labelKey)}
                  onClick={() => setTranslationStyle({ color: color.value })}
                />
              )}
            </For>
            <input
              aria-label={t("color.custom.aria")}
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
          {t("style.preview")}
        </div>
      </div>
    </section>
  );

  const renderImmersive = (): JSX.Element => (
    <>
      <Section title={t("section.targetLang")}>
        <TargetLanguageOptions
          value={settings().immersiveTargetLang}
          onChange={(immersiveTargetLang) =>
            void setSettings({ immersiveTargetLang })
          }
          t={t}
        />
      </Section>

      <Section title={t("section.engine")}>
        <For each={FULL_PAGE_ENGINES}>
          {(engine) => (
            <OptionButton
              active={settings().engines.fullPage === engine.value}
              label={engine.label}
              note={t(engine.noteKey)}
              onClick={() =>
                void setSettings({ engines: { fullPage: engine.value } })
              }
            />
          )}
        </For>
      </Section>

      <Section title={t("section.displayMode")}>
        <For each={MODES}>
          {(mode) => (
            <OptionButton
              active={settings().fullPageMode === mode.value}
              label={t(mode.labelKey)}
              note={t(mode.noteKey)}
              onClick={() => void setSettings({ fullPageMode: mode.value })}
            />
          )}
        </For>
      </Section>

      <Section title={t("section.clickToShowOriginal")}>
        <For each={CLICK_TO_SHOW_ORIGINAL_OPTIONS}>
          {(option) => (
            <OptionButton
              active={settings().fullPageClickToShowOriginal === option.value}
              label={t(option.labelKey)}
              note={t(option.noteKey)}
              onClick={() =>
                void setSettings({
                  fullPageClickToShowOriginal: option.value,
                })
              }
            />
          )}
        </For>
      </Section>

      {renderTranslationStyle()}
    </>
  );

  const renderActiveTab = (): JSX.Element => {
    switch (activeTab()) {
      case "hover":
        return renderHover();
      case "selection":
        return renderSelection();
      case "immersive":
        return renderImmersive();
      case "about":
        return renderAbout();
      case "account":
      default:
        return renderAccount();
    }
  };

  return (
    <main class="page">
      <header class="header">
        <div>
          <p class="eyebrow">OneLingo</p>
          <h1>{t("settings.title")}</h1>
        </div>
        <span class="scope">{t("settings.scope")}</span>
      </header>

      <div class="settings-shell">
        <Sidebar activeTab={activeTab()} onSelect={setActiveTab} t={t} />
        <section class="content-panel" aria-labelledby="tab-title">
          <div class="tab-heading">
            <h2 id="tab-title">{tabTitle()}</h2>
          </div>
          {renderActiveTab()}
        </section>
      </div>
    </main>
  );
}

export default App;
