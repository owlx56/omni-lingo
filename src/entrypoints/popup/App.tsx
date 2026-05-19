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
//   - 改 clickToShowOriginal / hoverEnabled / selectionEnabled 只写 settings。
//     immersive 的 click toggle 通过 settings watcher 在下次翻译时生效。

import { createSignal, onMount, type JSX } from "solid-js";
import { sendMessage } from "@/lib/messaging";
import {
  resolveTargetLang,
  setSettings,
  useSettings,
  type FullPageEngineId,
  type FullPageMode,
} from "@/lib/storage/settings";
import { useT, type TFn } from "@/lib/i18n";
import { IconLogo, IconSettings } from "@/lib/ui/icons";
import {
  Row,
  Segment,
  Switch,
  type SegmentOption,
} from "@/lib/ui/controls";

const ENGINES: SegmentOption<FullPageEngineId>[] = [
  { value: "google2", label: "Google" },
  { value: "microsoft", label: "Microsoft" },
];

type PageTargetLang = "zh" | "en";

function pageTargetOptions(t: TFn): SegmentOption<PageTargetLang>[] {
  return [
    { value: "zh", label: t("common.chinese") },
    { value: "en", label: t("common.english") },
  ];
}

function modeOptions(t: TFn): SegmentOption<FullPageMode>[] {
  return [
    { value: "replace", label: t("mode.replace") },
    { value: "bilingual", label: t("mode.bilingual") },
  ];
}

type ActionState = "idle" | "starting" | "restoring" | "retranslating";

function App(): JSX.Element {
  const t = useT();
  const settings = useSettings();

  const [action, setAction] = createSignal<ActionState>("idle");
  const [status, setStatus] = createSignal("");
  const [statusIsError, setStatusIsError] = createSignal(false);
  const [immersiveActive, setImmersiveActive] = createSignal(false);
  const [pageMode, setPageMode] = createSignal<FullPageMode>("replace");
  const [pageEngine, setPageEngine] = createSignal<FullPageEngineId>("google2");
  const [pageTarget, setPageTarget] = createSignal<PageTargetLang>("zh");
  const [hasPagePrefs, setHasPagePrefs] = createSignal(false);

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

  const targetLabel = (lang: PageTargetLang): string =>
    lang === "zh" ? t("common.chinese") : t("common.english");

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
      : t("popup.button.start");
  };

  return (
    <main class="popup">
      <header class="popup-header">
        <span class="popup-brand">
          <span aria-hidden="true" class="popup-logo">
            <IconLogo size={20} />
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

      <div class="popup-cta-block">
        <button
          class="popup-cta"
          classList={{ active: immersiveActive() }}
          disabled={action() !== "idle"}
          onClick={() => void runCta()}
          type="button"
        >
          {ctaLabel()}
        </button>
        <p
          class="popup-status"
          classList={{ error: statusIsError() }}
        >
          {status() || pageStateText()}
        </p>
      </div>

      <section class="section">
        <h2>{t("popup.section.page")}</h2>
        <Row label={t("popup.label.lang")}>
          <Segment
            label={t("popup.label.lang")}
            onChange={(target) =>
              applyPagePref(
                { target },
                t("popup.status.modeSwitching"),
              )
            }
            options={pageTargetOptions(t)}
            value={pageTargetValue()}
          />
        </Row>
        <Row label={t("popup.label.engine")}>
          <Segment
            label={t("popup.label.engine")}
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
        </Row>
        <Row label={t("popup.label.mode")}>
          <Segment
            label={t("popup.label.mode")}
            onChange={(mode) =>
              applyPagePref({ mode }, t("popup.status.modeSwitching"))
            }
            options={modeOptions(t)}
            value={pageModeValue()}
          />
        </Row>
        <Row label={t("section.clickToShowOriginal")}>
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
        <h2>{t("popup.section.features")}</h2>
        <Row label={t("popup.row.hoverEnabled")}>
          <Switch
            checked={settings().hoverEnabled}
            label={t("popup.row.hoverEnabled")}
            onChange={(hoverEnabled) => void setSettings({ hoverEnabled })}
          />
        </Row>
        <Row label={t("popup.row.selectionEnabled")}>
          <Switch
            checked={settings().selectionEnabled}
            label={t("popup.row.selectionEnabled")}
            onChange={(selectionEnabled) =>
              void setSettings({ selectionEnabled })
            }
          />
        </Row>
      </section>

      <footer class="popup-footer">
        <button
          class="footer-button"
          onClick={openOptions}
          type="button"
        >
          <IconSettings size={14} />
          <span>{t("popup.button.openOptions")}</span>
        </button>
      </footer>
    </main>
  );
}

export default App;
