// Popup 面板：原生 toolbar popup 内的 immersive 快速入口 + 功能开关。
//
// 设计（Claude.ai 扁平 row + 紧凑布局）：
//   - 顶部 logo + brand，支持页右侧显示 settings 按钮
//   - 大 CTA：翻译此页面 / 显示原文（根据 active 切换）+ 状态摘要
//   - 段 1「当前页面」：目标语言 / 引擎 / 显示模式 / 点击显示原文
//   - 段 2「其他功能」：悬停翻译 / 划词翻译 总开关
//
// 行为约定：
//   - target / engine / mode 默认跟随 options 的 immersive 全局设置。
//   - popup 内显式修改 target / engine / mode 后，写成当前页面的独立设置。
//     当前页面 active 时立即重翻；未 active 则只保存 per-page pref。
//   - 普通网页 / reader 内修改 hoverEnabled / selectionEnabled 后写成当前
//     tab 的独立设置；不支持页面保留同一套控件但禁用无效动作。

import { Show, createSignal, onMount, type JSX } from "solid-js";
import { UI_LANG_LABELS, UI_LANGS, type UiLang } from "@/lib/languages";
import {
  sendMessage,
  type PageFeaturePrefs,
  type PageFeatureStatus,
} from "@/lib/messaging";
import {
  classifyPopupCapability,
  popupCanToggleClickToShowOriginal,
  popupCanToggleFeatureControls,
  popupCanTranslatePage,
  popupLoadsPageFeatureStatus,
  popupShowsFeatureControls,
  popupShowsPageControls,
  type PopupCapability,
} from "@/lib/popup-capability";
import {
  resolveTargetLang,
  useSettings,
  type FullPageEngineId,
  type FullPageMode,
} from "@/lib/storage/settings";
import { useT } from "@/lib/i18n";
import {
  IconArrowRight,
  IconBilingualMode,
  IconChevron,
  IconLogo,
  IconReplaceMode,
  IconSettings,
} from "@/lib/ui/icons";
import {
  Row,
  Select,
  Switch,
  type SelectOption,
} from "@/lib/ui/controls";
import { browser } from "wxt/browser";

const ENGINES: SelectOption<FullPageEngineId>[] = [
  { value: "google2", label: "Google" },
  { value: "microsoft", label: "Microsoft" },
];

type PageTargetLang = UiLang;

function pageTargetOptions(): SelectOption<PageTargetLang>[] {
  return UI_LANGS.map((value) => ({
    value,
    label: UI_LANG_LABELS[value],
  }));
}

type ActionState = "idle" | "starting" | "restoring" | "retranslating";

export interface PopupAppProps {
  capability?: PopupCapability;
  onClose?: () => void;
  surface?: "native";
}

const DEFAULT_PAGE_FEATURE_STATUS: PageFeatureStatus = {
  fullPageClickToShowOriginal: true,
  hoverEnabled: true,
  selectionEnabled: true,
  hasFullPageClickToShowOriginalPref: false,
  hasHoverEnabledPref: false,
  hasSelectionEnabledPref: false,
};

async function detectActiveTabCapability(): Promise<PopupCapability> {
  try {
    const [tab] = await browser.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    return classifyPopupCapability(tab?.url, browser.runtime.getURL("/"));
  } catch {
    return "unsupported";
  }
}

function EngineMark(props: { engine: FullPageEngineId }): JSX.Element {
  if (props.engine === "microsoft") {
    return (
      <span aria-hidden="true" class="engine-mark microsoft-mark">
        <span class="microsoft-mark-red" />
        <span class="microsoft-mark-green" />
        <span class="microsoft-mark-blue" />
        <span class="microsoft-mark-yellow" />
      </span>
    );
  }

  return <span aria-hidden="true" class="engine-mark google-mark">G</span>;
}

function isMissingContentScriptError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("Could not establish connection") ||
    error.message.includes("Receiving end does not exist")
  );
}

function App(props: PopupAppProps = {}): JSX.Element {
  const t = useT();
  const settings = useSettings();

  const [action, setAction] = createSignal<ActionState>("idle");
  const [status, setStatus] = createSignal("");
  const [statusIsError, setStatusIsError] = createSignal(false);
  const [immersiveActive, setImmersiveActive] = createSignal(false);
  const [pageMode, setPageMode] = createSignal<FullPageMode>("replace");
  const [pageEngine, setPageEngine] = createSignal<FullPageEngineId>("google2");
  const [pageTarget, setPageTarget] = createSignal<PageTargetLang>("en");
  const [hasPagePrefs, setHasPagePrefs] = createSignal(false);
  const [pageFeatureStatus, setPageFeatureStatus] =
    createSignal<PageFeatureStatus>(DEFAULT_PAGE_FEATURE_STATUS);
  const [detectedCapability, setDetectedCapability] =
    createSignal<PopupCapability>(props.capability ?? "unsupported");

  let actionSeq = 0;
  let lastCommandId = 0;

  const capability = (): PopupCapability =>
    props.capability ?? detectedCapability();
  const canTranslatePage = (): boolean =>
    popupCanTranslatePage(capability());
  const showPageControls = (): boolean =>
    popupShowsPageControls(capability());
  const canToggleFeatures = (): boolean =>
    popupCanToggleFeatureControls(capability());
  const showFeatureControls = (): boolean =>
    popupShowsFeatureControls(capability());
  const canToggleClickToShowOriginal = (): boolean =>
    popupCanToggleClickToShowOriginal(capability());

  const nextCommandId = (): number => {
    lastCommandId = Math.max(lastCommandId + 1, Date.now());
    return lastCommandId;
  };

  const setInfoStatus = (message: string): void => {
    setStatusIsError(false);
    setStatus(message);
  };

  const setErrorStatus = (error: unknown): void => {
    setStatusIsError(true);
    setStatus(
      t("popup.status.error", {
        msg: error instanceof Error ? error.message : String(error),
      }),
    );
  };

  const startedStatus = (blocks: number): string =>
    blocks > 0
      ? t("popup.status.startedBlocks", { n: blocks })
      : t("popup.status.noBlocks");

  const engineLabel = (engine: FullPageEngineId): string =>
    ENGINES.find((e) => e.value === engine)?.label ?? engine;

  const targetLabel = (lang: PageTargetLang): string => UI_LANG_LABELS[lang];

  const modeLabel = (mode: FullPageMode): string =>
    mode === "replace" ? t("mode.replace") : t("mode.bilingual");

  const defaultPageMode = (): FullPageMode => settings().fullPageMode;

  const defaultPageEngine = (): FullPageEngineId =>
    settings().engines.fullPage;

  const defaultPageTarget = (): PageTargetLang =>
    resolveTargetLang(
      settings().immersiveTargetLang,
      settings().uiLang,
    ) as PageTargetLang;

  const pageModeValue = (): FullPageMode =>
    hasPagePrefs() || immersiveActive() ? pageMode() : defaultPageMode();

  const pageEngineValue = (): FullPageEngineId =>
    hasPagePrefs() || immersiveActive() ? pageEngine() : defaultPageEngine();

  const pageTargetValue = (): PageTargetLang =>
    hasPagePrefs() || immersiveActive() ? pageTarget() : defaultPageTarget();

  const clickToShowOriginalValue = (): boolean =>
    pageFeatureStatus().hasFullPageClickToShowOriginalPref
        ? pageFeatureStatus().fullPageClickToShowOriginal
        : settings().fullPageClickToShowOriginal;

  const hoverEnabledValue = (): boolean =>
    pageFeatureStatus().hasHoverEnabledPref
        ? pageFeatureStatus().hoverEnabled
        : settings().hoverEnabled;

  const selectionEnabledValue = (): boolean =>
    pageFeatureStatus().hasSelectionEnabledPref
        ? pageFeatureStatus().selectionEnabled
        : settings().selectionEnabled;

  const pageStateText = (): string =>
    immersiveActive()
      ? t("popup.state.translatedDetail", {
          engine: engineLabel(pageEngineValue()),
          target: targetLabel(pageTargetValue()),
          mode: modeLabel(pageModeValue()),
        })
      : t("popup.state.untranslatedDetail", {
          engine: engineLabel(pageEngineValue()),
          target: targetLabel(pageTargetValue()),
          mode: modeLabel(pageModeValue()),
        });

  const applyPagePref = (
    patch: {
      target?: PageTargetLang;
      engine?: FullPageEngineId;
      mode?: FullPageMode;
    },
    pendingStatus: string,
  ): void => {
    const next = {
      target: patch.target ?? pageTargetValue(),
      engine: patch.engine ?? pageEngineValue(),
      mode: patch.mode ?? pageModeValue(),
    };

    setHasPagePrefs(true);
    setPageTarget(next.target);
    setPageEngine(next.engine);
    setPageMode(next.mode);

    const savePagePrefs = sendMessage("setPageTranslatePrefs", next).catch(
      () => null,
    );

    if (!immersiveActive()) {
      void savePagePrefs;
      return;
    }

    const seq = ++actionSeq;
    setAction("retranslating");
    setInfoStatus(pendingStatus);
    void savePagePrefs
      .then(() =>
        sendMessage("translatePage", {
          target: next.target,
          engine: next.engine,
          mode: next.mode,
          commandId: nextCommandId(),
        }),
      )
      .then((res) => {
        if (seq !== actionSeq) return;
        const active = res.active || res.translating === true;
        setImmersiveActive(active);
        setHasPagePrefs(true);
        setPageMode(res.mode ?? next.mode);
        setPageEngine(res.engine ?? next.engine);
        setPageTarget((res.target as PageTargetLang) ?? next.target);
        setInfoStatus(
          active ? t("popup.status.retranslated") : startedStatus(res.blocks),
        );
      })
      .catch((e) => {
        if (seq !== actionSeq) return;
        setErrorStatus(e);
      })
      .finally(() => {
        if (seq === actionSeq) setAction("idle");
      });
  };

  const applyPageFeaturePref = (patch: PageFeaturePrefs): void => {
    if (!canToggleFeatures()) return;

    setPageFeatureStatus((cur) => ({
      ...cur,
      ...patch,
      hasFullPageClickToShowOriginalPref:
        patch.fullPageClickToShowOriginal !== undefined
          ? true
          : cur.hasFullPageClickToShowOriginalPref,
      hasHoverEnabledPref:
        patch.hoverEnabled !== undefined ? true : cur.hasHoverEnabledPref,
      hasSelectionEnabledPref:
        patch.selectionEnabled !== undefined
          ? true
          : cur.hasSelectionEnabledPref,
    }));
    void sendMessage("setPageFeaturePrefs", patch)
      .then(setPageFeatureStatus)
      .catch((e) => {
        if (isMissingContentScriptError(e)) return;
        setErrorStatus(e);
      });
  };

  const runCta = async (): Promise<void> => {
    if (immersiveActive()) {
      const seq = ++actionSeq;
      const commandId = nextCommandId();
      setAction("restoring");
      setInfoStatus(t("popup.status.restoring"));
      try {
        await sendMessage("restorePage", { commandId });
        if (seq !== actionSeq) return;
        setImmersiveActive(false);
        setInfoStatus(t("popup.status.restored"));
      } catch (e) {
        if (seq !== actionSeq) return;
        setErrorStatus(e);
      } finally {
        if (seq === actionSeq) setAction("idle");
      }
      return;
    }

    const seq = ++actionSeq;
    const commandId = nextCommandId();
    const mode = pageModeValue();
    const engine = pageEngineValue();
    const target = pageTargetValue();
    setAction("starting");
    setImmersiveActive(true);
    setInfoStatus(t("popup.status.started"));
    try {
      const res = await sendMessage("translatePage", {
        target,
        engine,
        mode,
        commandId,
      });
      if (seq !== actionSeq) return;
      setImmersiveActive(res.active);
      setHasPagePrefs(res.hasPagePrefs);
      setPageMode(res.mode ?? mode);
      setPageEngine(res.engine ?? engine);
      setPageTarget((res.target as PageTargetLang) ?? target);
      setInfoStatus(startedStatus(res.blocks));
    } catch (e) {
      if (seq !== actionSeq) return;
      setImmersiveActive(false);
      setErrorStatus(e);
    } finally {
      if (seq === actionSeq) setAction("idle");
    }
  };

  onMount(() => {
    void (async () => {
      const activeCapability = props.capability ?? (await detectActiveTabCapability());
      setDetectedCapability(activeCapability);
      const defaults = settings();
      if (activeCapability === "web") {
        try {
          const res = await sendMessage("getPageTranslateStatus", {});
          const mode = res.mode ?? defaults.fullPageMode;
          const engine = res.engine ?? defaults.engines.fullPage;
          const resolved = resolveTargetLang(
            defaults.immersiveTargetLang,
            defaults.uiLang,
          );
          const target = (res.target as PageTargetLang | undefined) ?? resolved;

          setPageMode(mode);
          setPageEngine(engine);
          setPageTarget(target);
          setHasPagePrefs(res.hasPagePrefs);
          setImmersiveActive(res.active || res.translating);
        } catch {
          setPageMode(defaults.fullPageMode);
          setPageEngine(defaults.engines.fullPage);
          setPageTarget(
            resolveTargetLang(
              defaults.immersiveTargetLang,
              defaults.uiLang,
            ) as PageTargetLang,
          );
          setHasPagePrefs(false);
        }
      } else {
        setPageMode(defaults.fullPageMode);
        setPageEngine(defaults.engines.fullPage);
        setPageTarget(
          resolveTargetLang(
            defaults.immersiveTargetLang,
            defaults.uiLang,
          ) as PageTargetLang,
        );
        setHasPagePrefs(false);
      }

      if (popupLoadsPageFeatureStatus(activeCapability)) {
        try {
          setPageFeatureStatus(await sendMessage("getPageFeatureStatus", {}));
        } catch (e) {
          if (!isMissingContentScriptError(e)) setErrorStatus(e);
          setPageFeatureStatus(DEFAULT_PAGE_FEATURE_STATUS);
        }
      }
    })().catch(() => {});
  });

  const openOptions = (): void => {
    void browser.runtime.openOptionsPage().catch(() => {
      window.open(browser.runtime.getURL("/options.html"), "_blank");
    });
  };

  const ctaLabel = (): string => {
    if (action() === "restoring") return t("popup.button.restoring");
    return immersiveActive()
      ? t("popup.button.restore")
      : t("popup.button.translate");
  };

  const selectMode = (mode: FullPageMode): void => {
    if (action() !== "idle" || pageModeValue() === mode) return;
    applyPagePref({ mode }, t("popup.status.modeSwitching"));
  };

  return (
    <main
      class="popup"
      data-onelingo-reader-ui=""
      data-popup-capability={capability()}
      data-popup-surface={props.surface ?? "native"}
    >
      <header class="popup-header">
        <span class="popup-brand">
          <span aria-hidden="true" class="popup-logo">
            <IconLogo size={18} />
          </span>
          <span>OneLingo</span>
        </span>
        <button
          aria-label={t("popup.openSettings")}
          class="icon-button"
          onClick={openOptions}
          title={t("popup.openSettings")}
          type="button"
        >
          <IconSettings size={16} />
        </button>
      </header>

      <Show when={showPageControls()}>
        <section aria-label={t("popup.section.page")} class="translate-card">
          <div class="language-flow">
            <button
              aria-disabled="true"
              aria-label={t("popup.label.sourceLang")}
              class="source-language-button"
              tabIndex={-1}
              type="button"
            >
              <span>{t("popup.label.sourceAuto")}</span>
              <IconChevron size={16} />
            </button>
            <span aria-hidden="true" class="language-arrow">
              <IconArrowRight />
            </span>
            <div class="target-language-select">
              <Select
                label={t("popup.label.lang")}
                onChange={(target) =>
                  applyPagePref(
                    { target },
                    t("popup.status.modeSwitching"),
                  )
                }
                options={pageTargetOptions()}
                value={pageTargetValue()}
              />
            </div>
          </div>

          <div class="service-row">
            <span class="service-label">
              {t("popup.label.service")}:
              <span class="service-label-spacer"></span>
            </span>
            <span class="service-control">
              <Select
                label={t("popup.label.service")}
                onChange={(engine) =>
                  applyPagePref(
                    { engine },
                    t("popup.status.engineSwitchPending", {
                      engine: engineLabel(engine),
                    }),
                  )
                }
                options={ENGINES}
                value={pageEngineValue()}
              />
            </span>
          </div>
        </section>

        <div class="popup-primary-actions">
          <div aria-label={t("popup.label.mode")} class="mode-switch" role="group">
            <button
              aria-label={t("mode.replace")}
              aria-pressed={pageModeValue() === "replace"}
              class="mode-button"
              classList={{ active: pageModeValue() === "replace" }}
              disabled={action() !== "idle"}
              onClick={() => selectMode("replace")}
              title={t("mode.replace")}
              type="button"
            >
              <IconReplaceMode />
            </button>
            <button
              aria-label={t("mode.bilingual")}
              aria-pressed={pageModeValue() === "bilingual"}
              class="mode-button"
              classList={{ active: pageModeValue() === "bilingual" }}
              disabled={action() !== "idle"}
              onClick={() => selectMode("bilingual")}
              title={t("mode.bilingual")}
              type="button"
            >
              <IconBilingualMode />
            </button>
          </div>

          <button
            class="popup-cta"
            classList={{ active: immersiveActive() }}
            disabled={action() !== "idle" || !canTranslatePage()}
            onClick={() => void runCta()}
            type="button"
          >
            <span>{ctaLabel()}</span>
            <span class="popup-shortcut">{t("popup.shortcut")}</span>
          </button>
        </div>

        <p
          class="popup-status"
          classList={{ error: statusIsError() }}
        >
          {status() || pageStateText()}
        </p>
      </Show>

      <Show when={showFeatureControls()}>
        <section class="section popup-settings-section">
          <Row label={t("section.clickToShowOriginal")}>
            <Switch
              checked={clickToShowOriginalValue()}
              disabled={!canToggleClickToShowOriginal()}
              label={t("section.clickToShowOriginal")}
              onChange={(fullPageClickToShowOriginal) =>
                applyPageFeaturePref({ fullPageClickToShowOriginal })
              }
            />
          </Row>
          <Row label={t("popup.row.hoverEnabled")}>
            <Switch
              checked={hoverEnabledValue()}
              disabled={!canToggleFeatures()}
              label={t("popup.row.hoverEnabled")}
              onChange={(hoverEnabled) =>
                applyPageFeaturePref({ hoverEnabled })
              }
            />
          </Row>
          <Row label={t("popup.row.selectionEnabled")}>
            <Switch
              checked={selectionEnabledValue()}
              disabled={!canToggleFeatures()}
              label={t("popup.row.selectionEnabled")}
              onChange={(selectionEnabled) =>
                applyPageFeaturePref({ selectionEnabled })
              }
            />
          </Row>
        </section>
      </Show>

    </main>
  );
}

export default App;
