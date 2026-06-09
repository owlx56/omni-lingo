// Native toolbar popup. The layout mirrors Read Frog's popup structure while
// keeping OneLingo's existing page-translation/session semantics.

import {
  Show,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import type { UiLang } from "@/lib/languages";
import {
  ACCEPTED_DOCUMENT_FILES,
  storeLocalDocumentAndGetViewerUrl,
} from "@/lib/document-open";
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
  IconBell,
  IconBilingualMode,
  IconFile,
  IconInfo,
  IconLanguages,
  IconMessageCircle,
  IconMoreHorizontal,
  IconReplaceMode,
  IconSettings,
  IconUploadFile,
  IconUser,
} from "@/lib/ui/icons";
import { Select, type SelectOption } from "@/lib/ui/controls";
import { browser } from "wxt/browser";
import { optionsUrlForTab, type TabId } from "@/lib/options-tabs";
import {
  createPopupPagePrefSync,
  pagePrefsFromLocalSaveAck,
} from "./page-pref-sync";
import {
  pageSourceFromStatus,
  pageSourceOptions,
  pageSourceToPrefSource,
  type PageSourceLang,
} from "./popup-language-options";
import {
  AiStyleIcon,
  HeaderAction,
  PopupAiConfigCard,
  ProviderMark,
  SwitchRow,
  renderAiConfigSelectValue,
} from "./popup-components";
import {
  commandSourceField,
  pageTargetOptions,
  type AiStyleId,
  type PageTargetLang,
} from "./popup-options";

type ActionState = "idle" | "starting" | "restoring" | "retranslating";

const DEFAULT_PAGE_FEATURE_STATUS: PageFeatureStatus = {
  fullPageClickToShowOriginal: true,
  hoverEnabled: true,
  selectionEnabled: true,
  hasFullPageClickToShowOriginalPref: false,
  hasHoverEnabledPref: false,
  hasSelectionEnabledPref: false,
};

export interface PopupAppProps {
  capability?: PopupCapability;
  onClose?: () => void;
  surface?: "native";
}

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
  const [pageSource, setPageSource] = createSignal<PageSourceLang>("auto");
  const [pageTarget, setPageTarget] = createSignal<PageTargetLang>("en");
  const [hasPagePrefs, setHasPagePrefs] = createSignal(false);
  const [pageFeatureStatus, setPageFeatureStatus] =
    createSignal<PageFeatureStatus>(DEFAULT_PAGE_FEATURE_STATUS);
  const [detectedCapability, setDetectedCapability] =
    createSignal<PopupCapability>(props.capability ?? "unsupported");
  const [fileBusy, setFileBusy] = createSignal(false);
  const [moreMenuOpen, setMoreMenuOpen] = createSignal(false);

  let actionSeq = 0;
  let lastCommandId = 0;
  let fileInput: HTMLInputElement | undefined;
  const pagePrefSync = createPopupPagePrefSync();

  const capability = (): PopupCapability =>
    props.capability ?? detectedCapability();
  const canTranslatePage = (): boolean => popupCanTranslatePage(capability());
  const showPageControls = (): boolean => popupShowsPageControls(capability());
  const canToggleFeatures = (): boolean =>
    popupCanToggleFeatureControls(capability());
  const showFeatureControls = (): boolean =>
    popupShowsFeatureControls(capability());
  const canToggleClickToShowOriginal = (): boolean =>
    popupCanToggleClickToShowOriginal(capability());

  const engineOptions = (): SelectOption<FullPageEngineId>[] => [
    {
      value: "google2",
      label: "Google",
      icon: () => <ProviderMark engine="google2" />,
    },
    {
      value: "microsoft",
      label: "Microsoft",
      icon: () => <ProviderMark engine="microsoft" />,
    },
  ];
  const aiStyleOptions = (): SelectOption<AiStyleId>[] => [
    {
      value: "default",
      label: t("popup.aiStyle.default"),
      icon: AiStyleIcon,
    },
  ];
  const sourceOptions = (): SelectOption<PageSourceLang>[] =>
    pageSourceOptions(t("popup.label.sourceAuto"));

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
    engineOptions().find((e) => e.value === engine)?.label ?? engine;
  const modeLabel = (mode: FullPageMode): string =>
    mode === "bilingual" ? t("mode.bilingual") : t("mode.replace");
  const nextPageMode = (): FullPageMode =>
    pageModeValue() === "replace" ? "bilingual" : "replace";

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
  const pageSourceValue = (): PageSourceLang =>
    hasPagePrefs() || immersiveActive() ? pageSource() : "auto";
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

  const applyPagePref = (
    patch: {
      target?: PageTargetLang;
      engine?: FullPageEngineId;
      source?: PageSourceLang;
      mode?: FullPageMode;
    },
    pendingStatus: string,
  ): void => {
    const next = {
      target: patch.target ?? pageTargetValue(),
      engine: patch.engine ?? pageEngineValue(),
      source: patch.source ?? pageSourceValue(),
      mode: patch.mode ?? pageModeValue(),
    };
    const prefSnapshot = pagePrefSync.markLocalChange();

    setHasPagePrefs(true);
    setPageTarget(next.target);
    setPageEngine(next.engine);
    setPageSource(next.source);
    setPageMode(next.mode);

    const prefsInput = {
      target: next.target,
      engine: next.engine,
      source: pageSourceToPrefSource(next.source),
      mode: next.mode,
    };
    const savePagePrefs = canTranslatePage()
      ? sendMessage("setPageTranslatePrefs", prefsInput).catch(() => null)
      : Promise.resolve(null);

    if (!immersiveActive()) {
      void savePagePrefs.then((res) => {
        if (!pagePrefSync.canApplyRemote(prefSnapshot)) return;
        const saved = pagePrefsFromLocalSaveAck(next, res);
        setHasPagePrefs(saved.hasPagePrefs);
        setPageMode(saved.mode);
        setPageEngine(saved.engine);
        setPageSource(saved.source);
        setPageTarget(saved.target);
      });
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
          ...commandSourceField(next.source),
          mode: next.mode,
          commandId: nextCommandId(),
        }),
      )
      .then((res) => {
        if (seq !== actionSeq || !pagePrefSync.canApplyRemote(prefSnapshot))
          return;
        const active = res.active || res.translating === true;
        setImmersiveActive(active);
        setHasPagePrefs(true);
        setPageMode(res.mode ?? next.mode);
        setPageEngine(res.engine ?? next.engine);
        setPageSource(
          res.source === undefined
            ? next.source
            : pageSourceFromStatus(res.source),
        );
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
    const source = pageSourceValue();
    const target = pageTargetValue();
    setAction("starting");
    setImmersiveActive(true);
    setInfoStatus(t("popup.status.started"));
    try {
      const res = await sendMessage("translatePage", {
        target,
        engine,
        ...commandSourceField(source),
        mode,
        commandId,
      });
      if (seq !== actionSeq) return;
      setImmersiveActive(res.active);
      setHasPagePrefs(res.hasPagePrefs);
      setPageMode(res.mode ?? mode);
      setPageEngine(res.engine ?? engine);
      setPageSource(
        res.source === undefined ? source : pageSourceFromStatus(res.source),
      );
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

  const onPopupKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") setMoreMenuOpen(false);
  };

  onMount(() => {
    document.addEventListener("keydown", onPopupKeyDown);

    void (async () => {
      const initialPrefSnapshot = pagePrefSync.capture();
      const activeCapability =
        props.capability ?? (await detectActiveTabCapability());
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

          if (pagePrefSync.canApplyRemote(initialPrefSnapshot)) {
            setPageMode(mode);
            setPageEngine(engine);
            setPageSource(pageSourceFromStatus(res.source));
            setPageTarget(target);
            setHasPagePrefs(res.hasPagePrefs);
          }
          setImmersiveActive(res.active || res.translating);
        } catch {
          if (pagePrefSync.canApplyRemote(initialPrefSnapshot)) {
            setPageMode(defaults.fullPageMode);
            setPageEngine(defaults.engines.fullPage);
            setPageSource("auto");
            setPageTarget(
              resolveTargetLang(
                defaults.immersiveTargetLang,
                defaults.uiLang,
              ) as PageTargetLang,
            );
            setHasPagePrefs(false);
          }
        }
      } else {
        if (pagePrefSync.canApplyRemote(initialPrefSnapshot)) {
          setPageMode(defaults.fullPageMode);
          setPageEngine(defaults.engines.fullPage);
          setPageSource("auto");
          setPageTarget(
            resolveTargetLang(
              defaults.immersiveTargetLang,
              defaults.uiLang,
            ) as PageTargetLang,
          );
          setHasPagePrefs(false);
        }
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

  onCleanup(() => document.removeEventListener("keydown", onPopupKeyDown));

  const openOptions = (tab?: TabId): void => {
    setMoreMenuOpen(false);
    const url = tab
      ? optionsUrlForTab(browser.runtime.getURL("/options.html"), tab)
      : browser.runtime.getURL("/options.html");
    void browser.tabs.create({ url }).catch(() => {
      window.open(url, "_blank");
    });
  };

  const openSelectedFile = async (file: File): Promise<void> => {
    if (fileBusy()) return;
    setMoreMenuOpen(false);
    setFileBusy(true);
    try {
      const url = await storeLocalDocumentAndGetViewerUrl(
        file,
        settings().uiLang,
      );
      await browser.tabs.create({ url });
      props.onClose?.();
    } catch (e) {
      setErrorStatus(e);
    } finally {
      setFileBusy(false);
    }
  };

  const ctaLabel = (): string => {
    if (action() === "restoring") return t("popup.button.restoring");
    return immersiveActive()
      ? t("popup.button.restore")
      : t("popup.button.translate");
  };

  return (
    <main
      class="popup"
      data-onelingo-reader-ui=""
      data-popup-capability={capability()}
      data-popup-surface={props.surface ?? "native"}
      onClick={(event) => {
        const target = event.target as HTMLElement | null;
        if (!target?.closest(".popup-more-wrap")) setMoreMenuOpen(false);
      }}
    >
      <section class="popup-panel">
        <header class="popup-header">
          <div class="popup-account" aria-label={t("popup.account.guest")}>
            <button
              aria-label={t("popup.account.login")}
              class="popup-account-avatar"
              type="button"
            >
              <IconUser size={16} />
            </button>
            <span class="popup-account-copy">
              <span class="popup-account-name">{t("popup.account.guest")}</span>
            </span>
          </div>
          <div class="popup-header-actions">
            <HeaderAction
              icon={IconLanguages}
              label={t("popup.header.translationHub")}
            />
            <HeaderAction
              icon={IconMessageCircle}
              label={t("popup.header.discord")}
            />
            <HeaderAction
              icon={IconBell}
              label={t("popup.header.notifications")}
            />
          </div>
        </header>

        <Show when={showPageControls()}>
          <div class="popup-language-row">
            <Select
              class="language-card language-card-select"
              label={t("popup.label.sourceLang")}
              menuClass="language-card-menu"
              menuPlacement="left"
              onChange={(source) =>
                applyPagePref({ source }, t("popup.status.modeSwitching"))
              }
              options={sourceOptions()}
              renderValue={(option) => (
                <span class="language-card-content">
                  <span class="language-card-main">{option().label}</span>
                  <span class="language-card-subtitle">
                    {t("popup.label.sourceLang")}
                  </span>
                </span>
              )}
              value={pageSourceValue()}
            />
            <span aria-hidden="true" class="language-flow-arrow">
              <IconArrowRight size={16} />
            </span>
            <Select
              class="language-card language-card-select"
              label={t("popup.label.lang")}
              menuClass="language-card-menu"
              menuPlacement="right"
              onChange={(target) =>
                applyPagePref({ target }, t("popup.status.modeSwitching"))
              }
              options={pageTargetOptions()}
              renderValue={(option) => (
                <span class="language-card-content">
                  <span class="language-card-main">{option().label}</span>
                  <span class="language-card-subtitle">
                    {t("popup.label.lang")}
                  </span>
                </span>
              )}
              value={pageTargetValue()}
            />
          </div>

          <PopupAiConfigCard
            aiStyleControl={
              <Select
                class="popup-ai-config-select-row"
                disabled
                label={t("popup.aiStyle")}
                menuClass="popup-ai-config-menu"
                onChange={() => undefined}
                options={aiStyleOptions()}
                renderValue={renderAiConfigSelectValue(t("popup.aiStyle"))}
                value="default"
              />
            }
            aiStyleLabel={t("popup.aiStyle")}
            serviceControl={
              <Select
                class="popup-ai-config-select-row"
                disabled={action() !== "idle"}
                label={t("popup.label.service")}
                menuClass="popup-ai-config-menu"
                onChange={(engine) =>
                  applyPagePref(
                    { engine },
                    t("popup.status.engineSwitchPending", {
                      engine: engineLabel(engine),
                    }),
                  )
                }
                options={engineOptions()}
                renderValue={renderAiConfigSelectValue(t("popup.label.service"))}
                value={pageEngineValue()}
              />
            }
            serviceLabel={t("popup.label.service")}
            smartContextLabel={t("popup.aiSmartContext")}
          />

          <div class="popup-action-row">
            <button
              aria-label={`${t("popup.label.mode")}: ${modeLabel(
                pageModeValue(),
              )}`}
              class="popup-mode-toggle"
              disabled={action() !== "idle"}
              onClick={() =>
                applyPagePref(
                  { mode: nextPageMode() },
                  t("popup.status.modeSwitching"),
                )
              }
              title={modeLabel(pageModeValue())}
              type="button"
            >
              <Show
                fallback={<IconReplaceMode size={24} />}
                when={pageModeValue() === "bilingual"}
              >
                <IconBilingualMode size={24} />
              </Show>
            </button>
            <button
              class="popup-cta"
              classList={{ active: immersiveActive() }}
              disabled={action() !== "idle" || !canTranslatePage()}
              onClick={() => void runCta()}
              type="button"
            >
              {ctaLabel()}
            </button>
          </div>

          <Show when={statusIsError() && status()}>
            <p class="popup-error-line">{status()}</p>
          </Show>
        </Show>

        <Show when={showFeatureControls()}>
          <section
            aria-label={t("popup.section.features")}
            class="popup-switch-list"
          >
            <SwitchRow
              checked={clickToShowOriginalValue()}
              disabled={!canToggleClickToShowOriginal()}
              label={t("section.clickToShowOriginal")}
              onChange={(fullPageClickToShowOriginal) =>
                applyPageFeaturePref({ fullPageClickToShowOriginal })
              }
            />
            <SwitchRow
              checked={hoverEnabledValue()}
              disabled={!canToggleFeatures()}
              label={t("popup.row.hoverEnabled")}
              onChange={(hoverEnabled) =>
                applyPageFeaturePref({ hoverEnabled })
              }
            />
            <SwitchRow
              checked={selectionEnabledValue()}
              disabled={!canToggleFeatures()}
              label={t("popup.row.selectionEnabled")}
              onChange={(selectionEnabled) =>
                applyPageFeaturePref({ selectionEnabled })
              }
            />
          </section>
        </Show>

        <input
          accept={ACCEPTED_DOCUMENT_FILES}
          class="visually-hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.item(0);
            if (file) void openSelectedFile(file);
            event.currentTarget.value = "";
          }}
          ref={fileInput}
          type="file"
        />
      </section>

      <footer class="popup-bottom-bar">
        <button
          class="popup-bottom-item"
          onClick={(event) => {
            event.stopPropagation();
            openOptions();
          }}
          type="button"
        >
          <IconSettings size={16} />
          <span>{t("popup.openSettings")}</span>
        </button>
        <span class="popup-version">
          {browser.runtime.getManifest().version}
        </span>
        <div class="popup-more-wrap">
          <button
            aria-expanded={moreMenuOpen()}
            class="popup-bottom-item"
            onClick={(event) => {
              event.stopPropagation();
              setMoreMenuOpen((open) => !open);
            }}
            type="button"
          >
            <IconMoreHorizontal size={16} />
            <span>{t("popup.more")}</span>
          </button>
          <Show when={moreMenuOpen()}>
            <div class="popup-more-menu" role="menu">
              <button
                class="popup-more-item"
                disabled={fileBusy()}
                onClick={(event) => {
                  event.stopPropagation();
                  fileInput?.click();
                }}
                role="menuitem"
                type="button"
              >
                <IconUploadFile size={15} />
                <span>{t("popup.service.openFile")}</span>
              </button>
              <button
                class="popup-more-item"
                onClick={(event) => {
                  event.stopPropagation();
                  openOptions("fileplus");
                }}
                role="menuitem"
                type="button"
              >
                <IconFile size={15} />
                <span>{t("sidebar.fileplus")}</span>
              </button>
              <button
                class="popup-more-item"
                onClick={(event) => {
                  event.stopPropagation();
                  openOptions("about");
                }}
                role="menuitem"
                type="button"
              >
                <IconInfo size={15} />
                <span>{t("sidebar.about")}</span>
              </button>
            </div>
          </Show>
        </div>
      </footer>
    </main>
  );
}

export default App;
