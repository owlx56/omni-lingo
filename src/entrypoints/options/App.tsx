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

import { For, Show, createEffect, createSignal, type JSX } from "solid-js";
import { UI_LANG_LABELS, UI_LANGS } from "@/lib/languages";
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
  IconFile,
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
import { browser } from "wxt/browser";
import { storeDocument } from "@/lib/document-store";
import {
  documentViewerUrlForUrl,
  epubViewerUrlForStoredKey,
  pdfViewerUrlForStoredKey,
} from "@/lib/document-viewer-urls";


type TabId = "account" | "hover" | "selection" | "immersive" | "fileplus" | "about";
type OptionIcon = (props: { size?: number }) => JSX.Element;

const VERSION = "0.0.0";
const HOVER_FONT_SIZE_STEP = 0.5;

const TABS: { id: TabId; labelKey: MessageKey; icon: OptionIcon }[] = [
  { id: "account", labelKey: "sidebar.account", icon: IconSettings },
  { id: "hover", labelKey: "sidebar.hover", icon: IconHover },
  { id: "selection", labelKey: "sidebar.selection", icon: IconSelection },
  { id: "immersive", labelKey: "sidebar.immersive", icon: IconImmersive },
  { id: "fileplus", labelKey: "sidebar.fileplus", icon: IconFile },
  { id: "about", labelKey: "sidebar.about", icon: IconInfo },
];

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
    { value: "inherit", labelKey: "color.inherit", swatch: "transparent" },
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

function uiLangSelectOptions(): SelectOption<UiLang>[] {
  return UI_LANGS.map((value) => ({
    value,
    label: UI_LANG_LABELS[value],
  }));
}

function targetLangSelectOptions(): SelectOption<TargetLang>[] {
  return UI_LANGS.map((value) => ({
    value,
    label: UI_LANG_LABELS[value],
  }));
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

function formatPx(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function clampFontSizeValue(value: number): number {
  return Math.min(HOVER_FONT_SIZE_MAX, Math.max(HOVER_FONT_SIZE_MIN, value));
}

function cleanFontSizeValue(value: number): number {
  return Number(value.toFixed(3));
}

function parseFontSizeDraft(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

const ACCEPTED_FILES = ".pdf,.epub,application/pdf,application/epub+zip";

function App() {
  const settings = useSettings();
  const t = useT();
  const [activeTab, setActiveTab] = createSignal<TabId>("account");
  const [hoverFontSizeDraft, setHoverFontSizeDraft] = createSignal(
    formatPx(HOVER_FONT_SIZE_MIN),
  );

  const [fpUrl, setFpUrl] = createSignal("");
  const [fpBusy, setFpBusy] = createSignal(false);
  let fpFileInput: HTMLInputElement | undefined;
  let fpDropDepth = 0;

  createEffect(() => {
    setHoverFontSizeDraft(formatPx(settings().hoverFontSize));
  });

  const setTranslationStyle = (
    patch: Parameters<typeof setSettings>[0]["translationStyle"],
  ): void => {
    void setSettings({ translationStyle: patch });
  };

  const tabTitle = (): string => {
    const tab = TABS.find((item) => item.id === activeTab());
    return tab ? t(tab.labelKey) : t("sidebar.account");
  };

  const commitHoverFontSize = (value: number): void => {
    const next = cleanFontSizeValue(clampFontSizeValue(value));
    setHoverFontSizeDraft(formatPx(next));
    void setSettings({ hoverFontSize: next });
  };

  const commitHoverFontSizeDraft = (): void => {
    commitHoverFontSize(parseFontSizeDraft(hoverFontSizeDraft()) ?? HOVER_FONT_SIZE_MIN);
  };

  const stepHoverFontSize = (delta: number): void => {
    const draftValue = parseFontSizeDraft(hoverFontSizeDraft());
    const base = draftValue ?? settings().hoverFontSize;
    commitHoverFontSize(base + delta);
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
          <Select
            label={t("preferences.uiLang")}
            onChange={(uiLang) => void setSettings({ uiLang })}
            options={uiLangSelectOptions()}
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
          <Select
            label={t("section.targetLang")}
            onChange={(hoverTargetLang) =>
              void setSettings({ hoverTargetLang })
            }
            options={targetLangSelectOptions()}
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
          label={t("fontSize.label")}
        >
          <div class="number-stepper hover-font-size-control">
            <button
              aria-label={`${t("slider.fontSize.aria")} -${HOVER_FONT_SIZE_STEP}`}
              class="number-stepper-button"
              onClick={() => stepHoverFontSize(-HOVER_FONT_SIZE_STEP)}
              type="button"
            >
              -
            </button>
            <input
              aria-label={t("slider.fontSize.aria")}
              class="number-stepper-input"
              inputMode="decimal"
              max={HOVER_FONT_SIZE_MAX}
              min={HOVER_FONT_SIZE_MIN}
              onBlur={commitHoverFontSizeDraft}
              onInput={(event) => setHoverFontSizeDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  stepHoverFontSize(HOVER_FONT_SIZE_STEP);
                  return;
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  stepHoverFontSize(-HOVER_FONT_SIZE_STEP);
                }
              }}
              step="any"
              type="text"
              value={hoverFontSizeDraft()}
            />
            <span aria-hidden="true" class="number-stepper-unit">px</span>
            <button
              aria-label={`${t("slider.fontSize.aria")} +${HOVER_FONT_SIZE_STEP}`}
              class="number-stepper-button"
              onClick={() => stepHoverFontSize(HOVER_FONT_SIZE_STEP)}
              type="button"
            >
              +
            </button>
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
        <Select
          label={t("section.targetLang")}
          onChange={(selectionTargetLang) =>
            void setSettings({ selectionTargetLang })
          }
          options={targetLangSelectOptions()}
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
          <Select
            label={t("section.targetLang")}
            onChange={(immersiveTargetLang) =>
              void setSettings({ immersiveTargetLang })
            }
            options={targetLangSelectOptions()}
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
        <Row label={t("style.label.color")} description={t("desc.color")}>
          <ColorRowControl
            customColor={settings().translationStyle.customColor}
            onCustom={(customColor) =>
              setTranslationStyle({ color: "custom", customColor })
            }
            onSelect={(color) => setTranslationStyle({ color })}
            t={t}
            value={settings().translationStyle.color}
          />
        </Row>
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

  const inferKind = (name: string, mime?: string): "pdf" | "epub" => {
    const lower = name.split(/[?#]/)[0]?.toLowerCase() ?? "";
    if (lower.endsWith(".pdf") || mime === "application/pdf") return "pdf";
    return "epub";
  };

  const openFile = async (file: File): Promise<void> => {
    const kind = inferKind(file.name, file.type);
    setFpBusy(true);
    try {
      const data = await file.arrayBuffer();
      const key = await storeDocument(data, kind, file.name);
      const viewerUrl =
        kind === "pdf"
          ? pdfViewerUrlForStoredKey(key, settings().uiLang)
          : epubViewerUrlForStoredKey(key);
      await browser.tabs.create({ url: viewerUrl });
    } finally {
      setFpBusy(false);
    }
  };

  const openUrl = async (): Promise<void> => {
    const nextUrl = fpUrl().trim();
    if (!nextUrl) return;
    await browser.tabs.create({
      url: documentViewerUrlForUrl(nextUrl, "auto", settings().uiLang),
    });
  };

  const renderFilePlus = (): JSX.Element => (
    <section
      class="section fileplus-idle"
      onDragEnter={(event) => {
        event.preventDefault();
        fpDropDepth++;
        event.currentTarget.classList.add("dragging");
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        fpDropDepth = Math.max(0, fpDropDepth - 1);
        if (fpDropDepth === 0)
          event.currentTarget.classList.remove("dragging");
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        fpDropDepth = 0;
        event.currentTarget.classList.remove("dragging");
        const file = event.dataTransfer?.files.item(0);
        if (file) void openFile(file);
      }}
    >
      <h2>{t("fileplus.section.open")}</h2>
      <FullRow>
        <div class="url-control">
          <input
            aria-label={t("fileplus.openUrl")}
            class="url-input"
            disabled={fpBusy()}
            onInput={(event) => setFpUrl(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void openUrl();
            }}
            placeholder={t("fileplus.urlPlaceholder")}
            spellcheck={false}
            type="url"
            value={fpUrl()}
          />
          <button
            class="primary-button"
            disabled={fpBusy()}
            onClick={() => void openUrl()}
            type="button"
          >
            {t("fileplus.openButton")}
          </button>
        </div>
      </FullRow>
      <Row label={t("fileplus.localFile")}>
        <button
          class="secondary-button"
          disabled={fpBusy()}
          onClick={() => fpFileInput?.click()}
          type="button"
        >
          {t("fileplus.chooseFile")}
        </button>
        <input
          accept={ACCEPTED_FILES}
          class="visually-hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.item(0);
            if (file) void openFile(file);
            event.currentTarget.value = "";
          }}
          ref={fpFileInput}
          type="file"
        />
      </Row>
      <div class="fileplus-dropzone">
        <h2>{t("fileplus.dropTitle")}</h2>
        <p>{t("fileplus.dropNote")}</p>
      </div>
      <Row
        description={t("fileplus.sniffLinks.desc")}
        label={t("fileplus.sniffLinks")}
      >
        <Switch
          checked={settings().documentLinkSniffEnabled}
          label={t("fileplus.sniffLinks")}
          onChange={(documentLinkSniffEnabled) =>
            void setSettings({ documentLinkSniffEnabled })
          }
        />
      </Row>
      <Row
        description={t("fileplus.keepOriginal.desc")}
        label={t("fileplus.keepOriginal")}
      >
        <Switch
          checked={settings().documentLinkSniffKeepOriginal}
          disabled={!settings().documentLinkSniffEnabled}
          label={t("fileplus.keepOriginal")}
          onChange={(documentLinkSniffKeepOriginal) =>
            void setSettings({ documentLinkSniffKeepOriginal })
          }
        />
      </Row>
      <Row
        description={t("fileplus.standalone.desc")}
        label={t("fileplus.standalone")}
      >
        <Switch
          checked={settings().documentLinkSniffStandalone}
          disabled={!settings().documentLinkSniffEnabled}
          label={t("fileplus.standalone")}
          onChange={(documentLinkSniffStandalone) =>
            void setSettings({ documentLinkSniffStandalone })
          }
        />
      </Row>
    </section>
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
      case "fileplus":
        return renderFilePlus();
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
        <section aria-label={tabTitle()} class="content-panel">
          {renderActiveTab()}
        </section>
      </div>
    </main>
  );
}

export default App;
