// Options 页主容器。
//
// 布局：左 sidebar 切 tab，右内容区。Tab 内容用 row primitives 排成
// Claude.ai 风格的扁平列表（section 标题 + 细分隔线行）。
//
// 设计原则：
//   - 每行一个设置，左侧 label + 可选 description，右侧单一控件。
//   - 复杂控件（slider / 译文样式色板）用 FullRow，独占整行。
//   - boolean 用 Switch；多选用 Select；2~3 选文字段控件用 Segment；
//     主题用 IconSegment。
//   - About 页是只读 row，不做控件。

import { Show, createEffect, createSignal, type JSX } from "solid-js";
import {
  setSettings,
  useSettings,
  HOVER_FONT_SIZE_MAX,
  HOVER_FONT_SIZE_MIN,
  type TranslationColor,
} from "@/lib/storage/settings";
import {
  FOLIATE_READER_FONT_SIZE_MAX,
  FOLIATE_READER_FONT_SIZE_MIN,
  FOLIATE_READER_LINE_HEIGHT_MAX,
  FOLIATE_READER_LINE_HEIGHT_MIN,
  foliateReaderStyleSettingsToStoragePatch,
  getLockedFoliateReaderSettings,
  mergeFoliateReaderStyleSettings,
  normalizeFoliateReaderFontSize,
  normalizeFoliateReaderLineHeight,
  normalizeFoliateReaderSettings,
  type FoliateReaderStylePatch,
  type FoliateReaderStyleSettings,
} from "@/lib/foliate-reader-settings";
import { broadcastFoliateReaderAppearance } from "@/lib/foliate-reader-live-settings";
import { PRODUCT_NAME } from "@/lib/branding";
import { useT } from "@/lib/i18n";
import { clamp } from "@/lib/number";
import { IconLogo } from "@/lib/ui/icons";
import {
  FullRow,
  IconSegment,
  Row,
  Segment,
  Select,
  Switch,
} from "@/lib/ui/controls";
import { browser } from "wxt/browser";
import {
  ACCEPTED_DOCUMENT_FILES,
  storeLocalDocumentAndGetViewerUrl,
} from "@/lib/document-open";
import {
  documentViewerUrlForUrl,
} from "@/lib/document-viewer-urls";
import {
  normalizeOptionsTabId,
  optionsUrlForTab,
  type TabId,
} from "@/lib/options-tabs";
import { ColorRowControl, NumberStepper, Sidebar } from "./options-components";
import {
  FOLIATE_READER_FONT_SIZE_STEP,
  FOLIATE_READER_LINE_HEIGHT_STEP,
  FULL_PAGE_ENGINES,
  HOVER_ENGINES,
  HOVER_FONT_SIZE_STEP,
  TABS,
  VERSION,
  appearanceOptions,
  fontSelectOptions,
  granularitySelectOptions,
  modeSegmentOptions,
  targetLangSelectOptions,
  uiLangSelectOptions,
  underlineSelectOptions,
} from "./options-model";


function formatPx(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function clampFontSizeValue(value: number): number {
  return clamp(value, HOVER_FONT_SIZE_MIN, HOVER_FONT_SIZE_MAX);
}

function cleanFontSizeValue(value: number): number {
  return Number(value.toFixed(3));
}

function parseNumberDraft(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function App() {
  const settings = useSettings();
  const t = useT();
  const [activeTab, setActiveTab] = createSignal<TabId>(
    normalizeOptionsTabId(
      new URLSearchParams(window.location.search).get("tab"),
    ),
  );
  const [hoverFontSizeDraft, setHoverFontSizeDraft] = createSignal(
    formatPx(HOVER_FONT_SIZE_MIN),
  );
  const [readerFontSizeDraft, setReaderFontSizeDraft] = createSignal("16");
  const [readerLineHeightDraft, setReaderLineHeightDraft] = createSignal("1.4");

  const [fpUrl, setFpUrl] = createSignal("");
  const [fpBusy, setFpBusy] = createSignal(false);
  let fpFileInput: HTMLInputElement | undefined;
  let fpDropDepth = 0;

  createEffect(() => {
    setHoverFontSizeDraft(formatPx(settings().hoverFontSize));
    setReaderFontSizeDraft(formatPx(settings().foliateReaderFontSize));
    setReaderLineHeightDraft(formatPx(settings().foliateReaderLineHeight));
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
    commitHoverFontSize(parseNumberDraft(hoverFontSizeDraft()) ?? HOVER_FONT_SIZE_MIN);
  };

  const stepHoverFontSize = (delta: number): void => {
    const draftValue = parseNumberDraft(hoverFontSizeDraft());
    const base = draftValue ?? settings().hoverFontSize;
    commitHoverFontSize(base + delta);
  };

  const commitReaderFontSize = (value: number): void => {
    const next = normalizeFoliateReaderFontSize(value);
    setReaderFontSizeDraft(formatPx(next));
    updateReaderAppearanceSettings({ fontSize: next });
  };

  const commitReaderFontSizeDraft = (): void => {
    commitReaderFontSize(
      parseNumberDraft(readerFontSizeDraft()) ??
        settings().foliateReaderFontSize,
    );
  };

  const stepReaderFontSize = (delta: number): void => {
    const draftValue = parseNumberDraft(readerFontSizeDraft());
    const base = draftValue ?? settings().foliateReaderFontSize;
    commitReaderFontSize(base + delta);
  };

  const commitReaderLineHeight = (value: number): void => {
    const next = normalizeFoliateReaderLineHeight(value);
    setReaderLineHeightDraft(formatPx(next));
    updateReaderAppearanceSettings({ lineHeight: next });
  };

  const commitReaderLineHeightDraft = (): void => {
    commitReaderLineHeight(
      parseNumberDraft(readerLineHeightDraft()) ??
        settings().foliateReaderLineHeight,
    );
  };

  const stepReaderLineHeight = (delta: number): void => {
    const draftValue = parseNumberDraft(readerLineHeightDraft());
    const base = draftValue ?? settings().foliateReaderLineHeight;
    commitReaderLineHeight(base + delta);
  };

  const saveReaderAppearanceSettings = (
    next: FoliateReaderStyleSettings,
  ): void => {
    void broadcastFoliateReaderAppearance(next);
    void setSettings(foliateReaderStyleSettingsToStoragePatch(next));
  };

  const updateReaderAppearanceSettings = (
    patch: FoliateReaderStylePatch,
  ): FoliateReaderStyleSettings => {
    const next = mergeFoliateReaderStyleSettings(
      normalizeFoliateReaderSettings(settings()),
      patch,
    );
    saveReaderAppearanceSettings(next);
    return next;
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
          <NumberStepper
            ariaLabel={t("slider.fontSize.aria")}
            max={HOVER_FONT_SIZE_MAX}
            min={HOVER_FONT_SIZE_MIN}
            onCommit={commitHoverFontSizeDraft}
            onInput={setHoverFontSizeDraft}
            onStep={stepHoverFontSize}
            step={HOVER_FONT_SIZE_STEP}
            unit="px"
            value={hoverFontSizeDraft()}
          />
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
      </section>
    </>
  );

  const selectTab = (tab: TabId): void => {
    setActiveTab(tab);
    window.history.replaceState(
      null,
      "",
      optionsUrlForTab(window.location.href, tab),
    );
  };

  const openFile = async (file: File): Promise<void> => {
    setFpBusy(true);
    try {
      const viewerUrl = await storeLocalDocumentAndGetViewerUrl(
        file,
        settings().uiLang,
      );
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

  const renderFilePlus = (): JSX.Element => {
    const locked = () =>
      getLockedFoliateReaderSettings(settings().foliateReaderUseBookLayout);
    return (
      <>
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
              accept={ACCEPTED_DOCUMENT_FILES}
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

        <section class="section">
          <h2>{t("fileplus.section.readerAppearance")}</h2>
          <Row
            description={t("fileplus.reader.fontSize.desc")}
            label={t("fileplus.reader.fontSize")}
          >
            <NumberStepper
              ariaLabel={t("fileplus.reader.fontSize.aria")}
              max={FOLIATE_READER_FONT_SIZE_MAX}
              min={FOLIATE_READER_FONT_SIZE_MIN}
              onCommit={commitReaderFontSizeDraft}
              onInput={setReaderFontSizeDraft}
              onStep={stepReaderFontSize}
              step={FOLIATE_READER_FONT_SIZE_STEP}
              unit="px"
              value={readerFontSizeDraft()}
            />
          </Row>
          <Row
            description={t("fileplus.reader.useBookLayout.desc")}
            label={t("fileplus.reader.useBookLayout")}
          >
            <Switch
              checked={settings().foliateReaderUseBookLayout}
              label={t("fileplus.reader.useBookLayout")}
              onChange={(foliateReaderUseBookLayout) =>
                updateReaderAppearanceSettings({
                  useBookLayout: foliateReaderUseBookLayout,
                })
              }
            />
          </Row>
          <Row
            description={t("fileplus.reader.textIndent.desc")}
            label={t("fileplus.reader.textIndent")}
          >
            <Switch
              checked={settings().foliateReaderTextIndent}
              disabled={locked().textIndent}
              label={t("fileplus.reader.textIndent")}
              onChange={(foliateReaderTextIndent) =>
                updateReaderAppearanceSettings({
                  textIndent: foliateReaderTextIndent,
                })
              }
            />
          </Row>
          <Row
            description={t("fileplus.reader.lineHeight.desc")}
            label={t("fileplus.reader.lineHeight")}
          >
            <NumberStepper
              ariaLabel={t("fileplus.reader.lineHeight.aria")}
              disabled={locked().lineHeight}
              max={FOLIATE_READER_LINE_HEIGHT_MAX}
              min={FOLIATE_READER_LINE_HEIGHT_MIN}
              onCommit={commitReaderLineHeightDraft}
              onInput={setReaderLineHeightDraft}
              onStep={stepReaderLineHeight}
              step={FOLIATE_READER_LINE_HEIGHT_STEP}
              unit="x"
              value={readerLineHeightDraft()}
            />
          </Row>
        </section>
      </>
    );
  };

  const renderAbout = (): JSX.Element => (
    <section class="section">
      <h2>{t("section.about")}</h2>
      <Row label={PRODUCT_NAME} description={t("about.tagline")}>
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
        <Sidebar activeTab={activeTab()} onSelect={selectTab} t={t} />
        <section aria-label={tabTitle()} class="content-panel">
          {renderActiveTab()}
        </section>
      </div>
    </main>
  );
}

export default App;
