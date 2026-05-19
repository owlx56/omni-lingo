// Options 页主容器。
//
// 布局：左 sidebar 切 tab，右内容区。Tab 内容用 row primitives 排成
// Claude.ai 风格的扁平列表（section 标题 + 细分隔线行）。
//
// 设计原则：
//   - 每行一个设置，左侧 label + 可选 description，右侧单一控件。
//   - 复杂控件（slider / 译文样式色板 / 预览）用 FullRow，独占整行。
//   - boolean 用 Switch；多选用 Select；2~3 选文字段控件用 Segment；
//     主题用 IconSegment。
//   - About 页是只读 row，不做控件。

import { For, Show, createSignal, type JSX } from "solid-js";
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
  IconMoon,
  IconSelection,
  IconSun,
  IconSystem,
} from "./icons";
import { IconLogo, IconSettings } from "@/lib/ui/icons";
import {
  FullRow,
  IconSegment,
  Row,
  Segment,
  Select,
  Switch,
  type IconSegmentOption,
  type SegmentOption,
  type SelectOption,
} from "@/lib/ui/controls";


type TabId = "account" | "hover" | "selection" | "immersive" | "about";
type OptionIcon = (props: { size?: number }) => JSX.Element;

const VERSION = "0.0.0";

const TABS: { id: TabId; labelKey: MessageKey; icon: OptionIcon }[] = [
  { id: "account", labelKey: "sidebar.account", icon: IconSettings },
  { id: "hover", labelKey: "sidebar.hover", icon: IconHover },
  { id: "selection", labelKey: "sidebar.selection", icon: IconSelection },
  { id: "immersive", labelKey: "sidebar.immersive", icon: IconImmersive },
  { id: "about", labelKey: "sidebar.about", icon: IconInfo },
];

const UI_LANG_KEYS: Record<UiLang, MessageKey> = {
  zh: "common.chinese",
  en: "common.english",
};

const TARGET_LANG_KEYS: Record<TargetLang, MessageKey> = {
  inherit: "common.followUiLang",
  zh: "common.chinese",
  en: "common.english",
};

const HOVER_ENGINES: { value: string; label: string }[] = [
  { value: "google", label: "Google" },
  { value: "google2", label: "Google 2" },
  { value: "microsoft", label: "Microsoft" },
];

const FULL_PAGE_ENGINES: { value: FullPageEngineId; label: string }[] = [
  { value: "google2", label: "Google 2" },
  { value: "microsoft", label: "Microsoft" },
];

const GRANULARITIES: { value: HoverGranularity; labelKey: MessageKey }[] = [
  { value: "word", labelKey: "granularity.word" },
  { value: "sentence", labelKey: "granularity.sentence" },
  { value: "paragraph", labelKey: "granularity.paragraph" },
];

const MODES: { value: FullPageMode; labelKey: MessageKey }[] = [
  { value: "replace", labelKey: "mode.replace" },
  { value: "bilingual", labelKey: "mode.bilingual" },
];

const FONT_FAMILIES: { value: TranslationFontFamily; labelKey: MessageKey }[] = [
  { value: "inherit", labelKey: "font.inherit" },
  { value: "serif", labelKey: "font.serif" },
  { value: "sans", labelKey: "font.sans" },
  { value: "mono", labelKey: "font.mono" },
];

const UNDERLINE_STYLES: {
  value: TranslationUnderlineStyle;
  labelKey: MessageKey;
}[] = [
  { value: "none", labelKey: "underline.none" },
  { value: "solid", labelKey: "underline.solid" },
  { value: "dotted", labelKey: "underline.dotted" },
  { value: "wavy", labelKey: "underline.wavy" },
];

const COLOR_PRESETS: { value: TranslationColor; labelKey: MessageKey; swatch: string }[] =
  [
    { value: "yellow", labelKey: "color.yellow", swatch: "rgb(251, 188, 4)" },
    { value: "green", labelKey: "color.green", swatch: "rgb(19, 129, 37)" },
    { value: "teal", labelKey: "color.teal", swatch: "rgb(25, 174, 160)" },
    { value: "blue", labelKey: "color.blue", swatch: "rgb(26, 115, 232)" },
    { value: "indigo", labelKey: "color.indigo", swatch: "rgb(91, 96, 232)" },
    { value: "orange", labelKey: "color.orange", swatch: "rgb(245, 124, 0)" },
    { value: "purple", labelKey: "color.purple", swatch: "rgb(142, 68, 173)" },
    { value: "pink", labelKey: "color.pink", swatch: "rgb(236, 64, 122)" },
    { value: "red", labelKey: "color.red", swatch: "rgb(234, 51, 59)" },
    { value: "gray", labelKey: "color.gray", swatch: "rgb(147, 147, 147)" },
  ];

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
              <Icon size={16} />
              <span>{props.t(tab.labelKey)}</span>
            </button>
          );
        }}
      </For>
    </nav>
  );
}

function uiLangSegmentOptions(t: TFn): SegmentOption<UiLang>[] {
  return [
    { value: "zh", label: t(UI_LANG_KEYS.zh) },
    { value: "en", label: t(UI_LANG_KEYS.en) },
  ];
}

function targetLangSegmentOptions(t: TFn): SegmentOption<TargetLang>[] {
  return [
    { value: "inherit", label: t(TARGET_LANG_KEYS.inherit) },
    { value: "zh", label: t(TARGET_LANG_KEYS.zh) },
    { value: "en", label: t(TARGET_LANG_KEYS.en) },
  ];
}

function granularitySelectOptions(t: TFn): SelectOption<HoverGranularity>[] {
  return GRANULARITIES.map((item) => ({
    value: item.value,
    label: t(item.labelKey),
  }));
}

function modeSegmentOptions(t: TFn): SegmentOption<FullPageMode>[] {
  return MODES.map((item) => ({ value: item.value, label: t(item.labelKey) }));
}

function fontSelectOptions(t: TFn): SelectOption<TranslationFontFamily>[] {
  return FONT_FAMILIES.map((item) => ({
    value: item.value,
    label: t(item.labelKey),
  }));
}

function underlineSelectOptions(
  t: TFn,
): SelectOption<TranslationUnderlineStyle>[] {
  return UNDERLINE_STYLES.map((item) => ({
    value: item.value,
    label: t(item.labelKey),
  }));
}

function appearanceOptions(t: TFn): IconSegmentOption<ThemePreference>[] {
  return [
    { value: "system", label: t("appearance.system"), icon: IconSystem },
    { value: "light", label: t("appearance.light"), icon: IconSun },
    { value: "dark", label: t("appearance.dark"), icon: IconMoon },
  ];
}

function ColorRowControl(props: {
  value: TranslationColor;
  customColor: string;
  t: TFn;
  onSelect: (next: TranslationColor) => void;
  onCustom: (color: string) => void;
}) {
  return (
    <div class="color-control">
      <For each={COLOR_PRESETS}>
        {(preset) => (
          <button
            aria-label={props.t(preset.labelKey)}
            class="color-swatch-button"
            classList={{ active: props.value === preset.value }}
            onClick={() => props.onSelect(preset.value)}
            style={{ "--swatch": preset.swatch }}
            title={props.t(preset.labelKey)}
            type="button"
          >
            <span aria-hidden="true" class="color-swatch-dot" />
          </button>
        )}
      </For>
      <label
        class="color-swatch-button color-swatch-button-custom"
        classList={{ active: props.value === "custom" }}
        title={props.t("color.custom")}
      >
        <span aria-hidden="true" class="color-swatch-dot" />
        <input
          aria-label={props.t("color.custom.aria")}
          class="color-swatch-input"
          onInput={(event) => {
            props.onCustom(event.currentTarget.value);
          }}
          type="color"
          value={props.customColor}
        />
      </label>
    </div>
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
        <Row label={t("profile.avatar")}>
          <span aria-hidden="true" class="avatar">
            <IconLogo size={22} />
          </span>
        </Row>
        <Row label={t("profile.displayName")}>
          <span class="row-static">{t("profile.placeholder")}</span>
        </Row>
        <FullRow>
          <p class="notice">{t("profile.notice")}</p>
        </FullRow>
      </section>

      <section class="section">
        <h2>{t("section.preferences")}</h2>
        <Row label={t("preferences.uiLang")} description={t("desc.uiLang")}>
          <Segment
            label={t("preferences.uiLang")}
            onChange={(uiLang) => void setSettings({ uiLang })}
            options={uiLangSegmentOptions(t)}
            value={settings().uiLang}
          />
        </Row>
        <Row
          label={t("preferences.appearance")}
          description={t("desc.appearance")}
        >
          <IconSegment
            label={t("preferences.appearance")}
            onChange={(theme) => void setSettings({ theme })}
            options={appearanceOptions(t)}
            value={settings().theme}
          />
        </Row>
      </section>
    </>
  );

  const renderHover = (): JSX.Element => (
    <>
      <section class="section">
        <h2>{t("section.featureSwitch")}</h2>
        <Row
          label={t("sidebar.hover")}
          description={t("desc.hoverEnabled")}
        >
          <Switch
            checked={settings().hoverEnabled}
            label={t("sidebar.hover")}
            onChange={(hoverEnabled) => void setSettings({ hoverEnabled })}
          />
        </Row>
        <Row
          label={t("section.targetLang")}
          description={t("desc.hoverTargetLang")}
        >
          <Segment
            label={t("section.targetLang")}
            onChange={(hoverTargetLang) =>
              void setSettings({ hoverTargetLang })
            }
            options={targetLangSegmentOptions(t)}
            value={settings().hoverTargetLang}
          />
        </Row>
        <Row label={t("section.engine")} description={t("desc.hoverEngine")}>
          <Select
            label={t("section.engine")}
            onChange={(value) => void setSettings({ engines: { hover: value } })}
            options={HOVER_ENGINES}
            value={settings().engines.hover}
          />
        </Row>
        <Row
          label={t("section.granularity")}
          description={t("desc.granularity")}
        >
          <Select
            label={t("section.granularity")}
            onChange={(hoverGranularity) =>
              void setSettings({ hoverGranularity })
            }
            options={granularitySelectOptions(t)}
            value={settings().hoverGranularity}
          />
        </Row>
      </section>

      <section class="section">
        <h2>{t("section.fontSize")}</h2>
        <Row
          description={t("desc.fontSize")}
          label={t("section.fontSize")}
        >
          <div class="range-row hover-font-size-control">
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
        </Row>
      </section>
    </>
  );

  const renderSelection = (): JSX.Element => (
    <section class="section">
      <h2>{t("section.featureSwitch")}</h2>
      <Row
        label={t("sidebar.selection")}
        description={t("desc.selectionEnabled")}
      >
        <Switch
          checked={settings().selectionEnabled}
          label={t("sidebar.selection")}
          onChange={(selectionEnabled) =>
            void setSettings({ selectionEnabled })
          }
        />
      </Row>
      <Row
        label={t("section.targetLang")}
        description={t("desc.selectionTargetLang")}
      >
        <Segment
          label={t("section.targetLang")}
          onChange={(selectionTargetLang) =>
            void setSettings({ selectionTargetLang })
          }
          options={targetLangSegmentOptions(t)}
          value={settings().selectionTargetLang}
        />
      </Row>
      <Row label={t("section.engine")} description={t("desc.selectionEngine")}>
        <Select
          label={t("section.engine")}
          onChange={(value) =>
            void setSettings({ engines: { selection: value } })
          }
          options={HOVER_ENGINES}
          value={settings().engines.selection}
        />
      </Row>
    </section>
  );

  const renderImmersive = (): JSX.Element => (
    <>
      <section class="section">
        <h2>{t("section.featureSwitch")}</h2>
        <Row
          label={t("section.targetLang")}
          description={t("desc.immersiveTargetLang")}
        >
          <Segment
            label={t("section.targetLang")}
            onChange={(immersiveTargetLang) =>
              void setSettings({ immersiveTargetLang })
            }
            options={targetLangSegmentOptions(t)}
            value={settings().immersiveTargetLang}
          />
        </Row>
        <Row
          label={t("section.engine")}
          description={t("desc.immersiveEngine")}
        >
          <Select
            label={t("section.engine")}
            onChange={(value) =>
              void setSettings({ engines: { fullPage: value } })
            }
            options={FULL_PAGE_ENGINES}
            value={settings().engines.fullPage}
          />
        </Row>
        <Row
          label={t("section.displayMode")}
          description={t("desc.displayMode")}
        >
          <Segment
            label={t("section.displayMode")}
            onChange={(fullPageMode) => void setSettings({ fullPageMode })}
            options={modeSegmentOptions(t)}
            value={settings().fullPageMode}
          />
        </Row>
        <Row
          label={t("section.clickToShowOriginal")}
          description={t("desc.clickToShowOriginal")}
        >
          <Switch
            checked={settings().fullPageClickToShowOriginal}
            label={t("section.clickToShowOriginal")}
            onChange={(fullPageClickToShowOriginal) =>
              void setSettings({ fullPageClickToShowOriginal })
            }
          />
        </Row>
      </section>

      <section class="section">
        <h2>{t("section.translationStyle")}</h2>
        <Row
          label={t("style.label.underline")}
          description={t("desc.underline")}
        >
          <Select
            label={t("style.label.underline")}
            onChange={(underlineStyle) =>
              setTranslationStyle({ underlineStyle })
            }
            options={underlineSelectOptions(t)}
            value={settings().translationStyle.underlineStyle}
          />
        </Row>
        <Row label={t("style.label.font")} description={t("desc.font")}>
          <Select
            label={t("style.label.font")}
            onChange={(fontFamily) => setTranslationStyle({ fontFamily })}
            options={fontSelectOptions(t)}
            value={settings().translationStyle.fontFamily}
          />
        </Row>
        <FullRow label={t("style.label.color")} description={t("desc.color")}>
          <ColorRowControl
            customColor={settings().translationStyle.customColor}
            onCustom={(customColor) =>
              setTranslationStyle({ color: "custom", customColor })
            }
            onSelect={(color) => setTranslationStyle({ color })}
            t={t}
            value={settings().translationStyle.color}
          />
        </FullRow>
        <FullRow>
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
        </FullRow>
      </section>
    </>
  );

  const renderAbout = (): JSX.Element => (
    <section class="section">
      <h2>{t("section.about")}</h2>
      <Row label="OneLingo" description={t("about.tagline")}>
        <span aria-hidden="true" class="avatar avatar-small">
          <IconLogo size={20} />
        </span>
      </Row>
      <Row label={t("about.versionLabel")}>
        <span class="row-static">{VERSION}</span>
      </Row>
    </section>
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
          <h1>{t("settings.title")}</h1>
        </div>
        <Show when={activeTab() === "about"}>
          <span class="scope">{t("about.version", { version: VERSION })}</span>
        </Show>
      </header>

      <div class="settings-shell">
        <Sidebar activeTab={activeTab()} onSelect={setActiveTab} t={t} />
        <section aria-labelledby="tab-title" class="content-panel">
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
