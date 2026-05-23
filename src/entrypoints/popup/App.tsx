// Popup 面板：immersive 翻译的快速入口 + 其他功能开关。
//
// 设计（Claude.ai 扁平 row + 紧凑布局）：
//   - 顶部 logo + brand，右侧 settings 按钮
//   - 大 CTA：翻译此页面 / 显示原文（根据 active 切换）+ 状态摘要
//   - 段 1「当前页面」：目标语言 / 引擎 / 显示模式 / 点击显示原文
//   - 段 2「其他功能」：悬停翻译 / 划词翻译 总开关
//   - 底部 ⚙ 打开完整设置
//
// 行为约定：
//   - target / engine / mode 默认跟随 options 的 immersive 全局设置。
//   - popup 内显式修改 target / engine / mode 后，写成当前页面的独立设置。
//     当前页面 active 时立即重翻；未 active 则只保存 per-page pref。
//   - popup 内修改 clickToShowOriginal / hoverEnabled / selectionEnabled 后，
//     写成当前页面 tab 的独立设置；未修改时跟随 options 全局默认。

import { createSignal, onMount, type JSX } from "solid-js";
import { UI_LANG_LABELS, UI_LANGS, type UiLang } from "@/lib/languages";
import {
  sendMessage,
  type PageFeaturePrefs,
  type PageFeatureStatus,
} from "@/lib/messaging";
import {
  resolveTargetLang,
  useSettings,
  type FullPageEngineId,
  type FullPageMode,
} from "@/lib/storage/settings";
import { useT } from "@/lib/i18n";
import { IconChevron, IconLogo, IconSettings } from "@/lib/ui/icons";
import {
  Row,
  Select,
  Switch,
  type SelectOption,
} from "@/lib/ui/controls";

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

const DEFAULT_PAGE_FEATURE_STATUS: PageFeatureStatus = {
  fullPageClickToShowOriginal: true,
  hoverEnabled: true,
  selectionEnabled: true,
  hasFullPageClickToShowOriginalPref: false,
  hasHoverEnabledPref: false,
  hasSelectionEnabledPref: false,
};

function IconArrowRight(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="24"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="1.7"
      viewBox="0 0 24 24"
      width="24"
    >
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

function IconReplaceMode(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="30"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      viewBox="0 0 32 32"
      width="30"
    >
      <path d="M8 7H5v18h3" />
      <path d="M24 7h3v18h-3" />
      <path d="M12 21l4-11 4 11" />
      <path d="M13.4 17h5.2" />
    </svg>
  );
}

function IconBilingualMode(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="30"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="1.8"
      viewBox="0 0 32 32"
      width="30"
    >
      <rect height="15" rx="2" width="15" x="5" y="5" />
      <rect height="15" rx="2" width="15" x="12" y="12" />
      <path d="M9 16l3.2-7 3.2 7" />
      <path d="M10.2 13.4h4" />
      <path d="M16.5 19h7" />
      <path d="M20 16.5v8" />
      <path d="M17.5 23c2.9-1 4.9-3.1 5.4-6" />
      <path d="M23.5 23c-2.6-.9-4.2-2.6-5-5" />
    </svg>
  );
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

function App(): JSX.Element {
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

  let actionSeq = 0;
  let lastCommandId = 0;

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

  // ─── 应用当前页面偏好 ────────────────────────────────────────

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
      // 未翻译时只保存当前页 pref，待用户点 CTA 时统一发起
      void savePagePrefs;
      return;
    }

    // 已翻译：立即重翻
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

  // ─── 应用当前 tab 功能开关 ──────────────────────────────────

  const applyPageFeaturePref = (patch: PageFeaturePrefs): void => {
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

  // ─── CTA：开始翻译 / 显示原文 ────────────────────────────────

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

  // ─── 初始化 ────────────────────────────────────────────────

  onMount(() => {
    void (async () => {
      const defaults = settings();
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
        // 没拿到页面状态就用全局默认值兜底
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

      try {
        setPageFeatureStatus(await sendMessage("getPageFeatureStatus", {}));
      } catch (e) {
        if (!isMissingContentScriptError(e)) setErrorStatus(e);
        setPageFeatureStatus(DEFAULT_PAGE_FEATURE_STATUS);
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
    <main class="popup">
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
          <span class="service-label">{t("popup.label.service")}:</span>
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
          disabled={action() !== "idle"}
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

      <section class="section popup-settings-section">
        <Row label={t("section.clickToShowOriginal")}>
          <Switch
            checked={clickToShowOriginalValue()}
            label={t("section.clickToShowOriginal")}
            onChange={(fullPageClickToShowOriginal) =>
              applyPageFeaturePref({ fullPageClickToShowOriginal })
            }
          />
        </Row>
<Row label={t("popup.row.hoverEnabled")}>
          <Switch
            checked={hoverEnabledValue()}
            label={t("popup.row.hoverEnabled")}
            onChange={(hoverEnabled) =>
              applyPageFeaturePref({ hoverEnabled })
            }
          />
        </Row>
        <Row label={t("popup.row.selectionEnabled")}>
          <Switch
            checked={selectionEnabledValue()}
            label={t("popup.row.selectionEnabled")}
            onChange={(selectionEnabled) =>
              applyPageFeaturePref({ selectionEnabled })
            }
          />
        </Row>
      </section>

    </main>
  );
}

export default App;
