// Native toolbar popup. The layout mirrors Read Frog's popup structure while
// keeping OneLingo's existing page-translation/session semantics.

import {
  For,
  Show,
  createMemo,
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { UI_LANG_LABELS, UI_LANGS, type UiLang } from "@/lib/languages";
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
  IconCheck,
  IconChevron,
  IconFile,
  IconInfo,
  IconLanguages,
  IconMessageCircle,
  IconMoreHorizontal,
  IconReplaceMode,
  IconSettings,
  IconSparkles,
  IconUploadFile,
  IconUser,
} from "@/lib/ui/icons";
import { browser } from "wxt/browser";
import { optionsUrlForTab, type TabId } from "@/lib/options-tabs";

type PageTargetLang = UiLang;
type ActionState = "idle" | "starting" | "restoring" | "retranslating";
type AiStyleId = "default";

type PopupSelectOption<T extends string> = {
  value: T;
  label: string;
  icon?: () => JSX.Element;
};

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

function pageTargetOptions(): PopupSelectOption<PageTargetLang>[] {
  return UI_LANGS.map((value) => ({
    value,
    label: UI_LANG_LABELS[value],
  }));
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

function ProviderMark(props: { engine: FullPageEngineId }): JSX.Element {
  return (
    <span class="provider-icon-shell" aria-hidden="true">
      <Show
        fallback={
          <span class="provider-google-mark" aria-hidden="true">
            G
          </span>
        }
        when={props.engine === "microsoft"}
      >
        <span class="provider-microsoft-mark" aria-hidden="true">
          <span class="provider-microsoft-red" />
          <span class="provider-microsoft-green" />
          <span class="provider-microsoft-blue" />
          <span class="provider-microsoft-yellow" />
        </span>
      </Show>
    </span>
  );
}

function PopupSelect<T extends string>(props: {
  value: T;
  options: PopupSelectOption<T>[];
  onChange: (next: T) => void;
  label: string;
  disabled?: boolean;
  class?: string;
  menuClass?: string;
  renderValue?: (option: PopupSelectOption<T>) => JSX.Element;
}) {
  let root: HTMLSpanElement | undefined;
  let button: HTMLButtonElement | undefined;
  const id = createUniqueId();
  const [open, setOpen] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(-1);

  const selectedIndex = createMemo(() => {
    const index = props.options.findIndex(
      (option) => option.value === props.value,
    );
    return index >= 0 ? index : 0;
  });
  const selectedOption = createMemo(() => props.options[selectedIndex()]);

  const close = (): void => {
    setOpen(false);
  };
  const openMenu = (): void => {
    if (props.disabled) return;
    setActiveIndex(-1);
    setOpen(true);
  };
  const selectOption = (option: PopupSelectOption<T>): void => {
    props.onChange(option.value);
    close();
    button?.focus();
  };

  const handleDocumentPointerDown = (event: PointerEvent): void => {
    if (!root?.contains(event.target as Node)) close();
  };
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  onCleanup(() =>
    document.removeEventListener("pointerdown", handleDocumentPointerDown),
  );

  const moveActive = (delta: number): void => {
    if (props.options.length === 0) return;
    setActiveIndex((current) => {
      if (current < 0) return selectedIndex();
      const next = current + delta;
      if (next < 0) return props.options.length - 1;
      if (next >= props.options.length) return 0;
      return next;
    });
  };

  const handleKeyDown: JSX.EventHandlerUnion<HTMLButtonElement, KeyboardEvent> =
    (event) => {
      if (props.disabled) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!open()) openMenu();
        else moveActive(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (!open()) openMenu();
        else moveActive(-1);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (!open()) {
          openMenu();
          return;
        }
        const option = props.options[
          activeIndex() >= 0 ? activeIndex() : selectedIndex()
        ];
        if (option) selectOption(option);
      }
    };

  return (
    <span
      class="popup-select"
      classList={{
        disabled: props.disabled,
        open: open(),
      }}
      ref={root}
    >
      <button
        aria-activedescendant={
          open() && activeIndex() >= 0
            ? `${id}-option-${activeIndex()}`
            : undefined
        }
        aria-controls={`${id}-menu`}
        aria-expanded={open()}
        aria-label={props.label}
        class={`popup-select-trigger ${props.class ?? ""}`}
        disabled={props.disabled}
        onClick={() => {
          if (open()) close();
          else openMenu();
        }}
        onKeyDown={handleKeyDown}
        ref={button}
        role="combobox"
        type="button"
      >
        <Show when={selectedOption()}>
          {(option) => (
            <Show
              fallback={
                <span class="popup-select-value">
                  {option().icon?.()}
                  <span class="popup-select-text">{option().label}</span>
                </span>
              }
              when={props.renderValue}
            >
              {(renderValue) => renderValue()(option())}
            </Show>
          )}
        </Show>
        <span aria-hidden="true" class="popup-select-chevron">
          <IconChevron size={14} />
        </span>
      </button>
      <Show when={open()}>
        <div
          class={`popup-select-menu ${props.menuClass ?? ""}`}
          id={`${id}-menu`}
          role="listbox"
        >
          <For each={props.options}>
            {(option, index) => (
              <button
                aria-selected={props.value === option.value}
                class="popup-select-option"
                classList={{
                  active: activeIndex() === index(),
                  selected: props.value === option.value,
                }}
                id={`${id}-option-${index()}`}
                onClick={() => selectOption(option)}
                role="option"
                type="button"
              >
                <span class="popup-select-option-main">
                  {option.icon?.()}
                  <span>{option.label}</span>
                </span>
                <Show when={props.value === option.value}>
                  <span aria-hidden="true" class="popup-select-check">
                    <IconCheck size={16} />
                  </span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </span>
  );
}

function ReadFrogRow(props: {
  label: string;
  help?: string;
  children: JSX.Element;
}) {
  return (
    <div class="popup-setting-row">
      <span class="popup-setting-label">
        {props.label}
        <Show when={props.help}>
          {(help) => (
            <span class="popup-help-icon" title={help()}>
              <IconInfo size={13} />
            </span>
          )}
        </Show>
      </span>
      {props.children}
    </div>
  );
}

function PopupSwitch(props: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange?: (next: boolean) => void;
}) {
  return (
    <button
      aria-checked={props.checked}
      aria-label={props.label}
      class="popup-switch"
      classList={{ on: props.checked }}
      disabled={props.disabled}
      onClick={() => props.onChange?.(!props.checked)}
      role="switch"
      type="button"
    >
      <span aria-hidden="true" class="popup-switch-thumb" />
    </button>
  );
}

function SwitchRow(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
}) {
  return (
    <div class="popup-switch-row">
      <span class="popup-switch-label">{props.label}</span>
      <PopupSwitch
        checked={props.checked}
        disabled={props.disabled}
        label={props.label}
        onChange={props.onChange}
      />
    </div>
  );
}

function HeaderAction(props: {
  label: string;
  icon: (iconProps: { size?: number }) => JSX.Element;
}) {
  const Icon = props.icon;
  return (
    <button
      aria-label={props.label}
      class="popup-header-action"
      title={props.label}
      type="button"
    >
      <Icon size={16} />
    </button>
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
  const [fileBusy, setFileBusy] = createSignal(false);
  const [moreMenuOpen, setMoreMenuOpen] = createSignal(false);

  let actionSeq = 0;
  let lastCommandId = 0;
  let fileInput: HTMLInputElement | undefined;

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

  const engineOptions = (): PopupSelectOption<FullPageEngineId>[] => [
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
  const aiStyleOptions = (): PopupSelectOption<AiStyleId>[] => [
    {
      value: "default",
      label: t("popup.aiStyle.default"),
      icon: () => <IconSparkles size={13} />,
    },
  ];

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

    const savePagePrefs = canTranslatePage()
      ? sendMessage("setPageTranslatePrefs", next).catch(() => null)
      : Promise.resolve(null);

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

  const onPopupKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") setMoreMenuOpen(false);
  };

  onMount(() => {
    document.addEventListener("keydown", onPopupKeyDown);

    void (async () => {
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
            <span class="popup-account-avatar" aria-hidden="true">
              <IconUser size={16} />
            </span>
            <span class="popup-account-copy">
              <span class="popup-account-name">{t("popup.account.guest")}</span>
              <span class="popup-account-login">{t("popup.account.login")}</span>
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
            <button
              aria-disabled="true"
              aria-label={t("popup.label.sourceLang")}
              class="language-card source-language-card"
              tabIndex={-1}
              type="button"
            >
              <span class="language-card-main">
                {t("popup.label.sourceAuto")}
              </span>
              <span class="language-card-subtitle">
                {t("popup.label.sourceLang")}
              </span>
              <span aria-hidden="true" class="language-card-chevron">
                <IconChevron size={14} />
              </span>
            </button>
            <span aria-hidden="true" class="language-flow-arrow">
              <IconArrowRight size={16} />
            </span>
            <PopupSelect
              class="language-card language-card-select"
              label={t("popup.label.lang")}
              menuClass="language-card-menu"
              onChange={(target) =>
                applyPagePref({ target }, t("popup.status.modeSwitching"))
              }
              options={pageTargetOptions()}
              renderValue={(option) => (
                <span class="language-card-content">
                  <span class="language-card-main">{option.label}</span>
                  <span class="language-card-subtitle">
                    {t("popup.label.lang")}
                  </span>
                </span>
              )}
              value={pageTargetValue()}
            />
          </div>

          <ReadFrogRow label={t("popup.label.service")}>
            <PopupSelect
              class="popup-row-select"
              disabled={action() !== "idle"}
              label={t("popup.label.service")}
              onChange={(engine) =>
                applyPagePref(
                  { engine },
                  t("popup.status.engineSwitchPending", {
                    engine: engineLabel(engine),
                  }),
                )
              }
              options={engineOptions()}
              value={pageEngineValue()}
            />
          </ReadFrogRow>

          <ReadFrogRow label={t("popup.aiStyle")}>
            <PopupSelect
              class="popup-row-select"
              disabled
              label={t("popup.aiStyle")}
              onChange={() => undefined}
              options={aiStyleOptions()}
              value="default"
            />
          </ReadFrogRow>

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
            <SwitchRow
              checked={false}
              disabled
              label={t("popup.aiSmartContext")}
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
