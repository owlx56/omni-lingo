import { For, createSignal, onMount } from "solid-js";
import { sendMessage } from "@/lib/messaging";
import {
  getSettings,
  resolveTargetLang,
  type FullPageEngineId,
  type FullPageMode,
} from "@/lib/storage/settings";
import { useT } from "@/lib/i18n";
import "./App.css";

const ENGINES: { value: FullPageEngineId; label: string }[] = [
  { value: "google2", label: "Google 2" },
  { value: "microsoft", label: "Microsoft" },
];

const DEFAULT_FULL_PAGE_MODE: FullPageMode = "replace";
const DEFAULT_FULL_PAGE_ENGINE: FullPageEngineId = "google2";
const DEFAULT_TARGET = "zh";

function Row(props: {
  label: string;
  children: import("solid-js").JSX.Element;
}) {
  return (
    <div class="popup-row">
      <span class="popup-label">{props.label}</span>
      <div class="popup-controls">{props.children}</div>
    </div>
  );
}

function SegBtn(props: {
  active: boolean;
  onClick?: () => void;
  children: import("solid-js").JSX.Element;
  disabled?: boolean;
}) {
  return (
    <button
      class="seg-button"
      classList={{ active: props.active }}
      disabled={props.disabled}
      onClick={props.onClick}
      type="button"
    >
      {props.children}
    </button>
  );
}

function App() {
  const t = useT();
  const [action, setAction] = createSignal<
    "idle" | "starting" | "restoring" | "retranslating"
  >("idle");
  const [status, setStatus] = createSignal("");
  const [statusIsError, setStatusIsError] = createSignal(false);
  const [immersiveActive, setImmersiveActive] = createSignal(false);
  const [pageMode, setPageMode] = createSignal<FullPageMode>(
    DEFAULT_FULL_PAGE_MODE,
  );
  const [pageEngine, setPageEngine] = createSignal<FullPageEngineId>(
    DEFAULT_FULL_PAGE_ENGINE,
  );
  const [pageTarget, setPageTarget] = createSignal(DEFAULT_TARGET);
  let actionSeq = 0;
  let lastCommandId = 0;

  const openOptions = (): void => {
    void browser.runtime.openOptionsPage().catch(() => {
      window.open(browser.runtime.getURL("/options.html"), "_blank");
    });
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

  const nextCommandId = (): number => {
    lastCommandId = Math.max(lastCommandId + 1, Date.now());
    return lastCommandId;
  };

  const startedStatus = (blocks: number): string =>
    blocks > 0
      ? t("popup.status.startedBlocks", { n: blocks })
      : t("popup.status.noBlocks");

  const modeLabel = (mode: FullPageMode): string =>
    mode === "replace" ? t("mode.replace") : t("mode.bilingual");

  const engineLabel = (engine: FullPageEngineId): string =>
    ENGINES.find((e) => e.value === engine)?.label ?? engine;

  const targetLabel = (): string =>
    pageTarget() === "zh" ? t("common.chinese") : t("common.english");

  const nextFullPageMode = (): FullPageMode =>
    pageMode() === "replace" ? "bilingual" : "replace";

  const pageStateText = (): string =>
    immersiveActive()
      ? t("popup.state.translatedDetail", {
          engine: engineLabel(pageEngine()),
          target: targetLabel(),
          mode: modeLabel(pageMode()),
        })
      : t("popup.state.untranslatedDetail", {
          engine: engineLabel(pageEngine()),
          target: targetLabel(),
          mode: modeLabel(pageMode()),
        });

  const updatePagePrefs = (patch: {
    target?: string;
    engine?: FullPageEngineId;
    mode?: FullPageMode;
  }): void => {
    void sendMessage("setPageTranslatePrefs", patch).catch(() => {});
  };

  const retranslateCurrentPage = (
    patch: { target?: string; engine?: FullPageEngineId; mode?: FullPageMode },
    message: string,
  ): void => {
    const target = patch.target ?? pageTarget();
    const engine = patch.engine ?? pageEngine();
    const mode = patch.mode ?? pageMode();
    const seq = ++actionSeq;

    setAction("retranslating");
    setInfoStatus(message);

    void sendMessage("translatePage", {
      target,
      engine,
      mode,
      commandId: nextCommandId(),
    })
      .then((res) => {
        if (seq !== actionSeq) return;
        const active = res.active || res.translating === true;
        setImmersiveActive(active);
        setPageMode(res.mode ?? mode);
        setPageEngine(res.engine ?? engine);
        setPageTarget(res.target ?? target);
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

  const toggleFullPageMode = (): void => {
    const mode = nextFullPageMode();
    if (!immersiveActive()) {
      setPageMode(mode);
      updatePagePrefs({ mode });
      setInfoStatus(t("popup.status.modeIdleNote", { mode: modeLabel(mode) }));
      return;
    }

    const seq = ++actionSeq;
    setPageMode(mode);
    setAction("retranslating");
    setInfoStatus(t("popup.status.modeSwitching"));
    void (async () => {
      const res = await sendMessage("translatePage", {
        target: pageTarget(),
        engine: pageEngine(),
        mode,
        commandId: nextCommandId(),
      });
      if (seq !== actionSeq) return;
      const active = res.active || res.translating === true;
      setImmersiveActive(active);
      setPageMode(res.mode ?? mode);
      setPageEngine(res.engine ?? pageEngine());
      setPageTarget(res.target ?? pageTarget());
      setInfoStatus(
        res.active ? t("popup.status.modeSwitched") : startedStatus(res.blocks),
      );
    })()
      .catch((e) => {
        if (seq !== actionSeq) return;
        setErrorStatus(e);
      })
      .finally(() => {
        if (seq === actionSeq) setAction("idle");
      });
  };

  const setFullPageEngine = (engine: FullPageEngineId): void => {
    if (pageEngine() === engine) return;
    setPageEngine(engine);
    if (immersiveActive()) {
      retranslateCurrentPage(
        { engine },
        t("popup.status.engineSwitchPending", { engine: engineLabel(engine) }),
      );
    } else {
      updatePagePrefs({ engine });
      setInfoStatus(
        t("popup.status.engineSwitched", { engine: engineLabel(engine) }),
      );
    }
  };

  const run = async () => {
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
    const mode = pageMode();
    setAction("starting");
    setImmersiveActive(true);
    setPageMode(mode);
    setInfoStatus(t("popup.status.started"));
    try {
      const res = await sendMessage("translatePage", {
        target: pageTarget(),
        engine: pageEngine(),
        mode,
        commandId,
      });
      if (seq !== actionSeq) return;
      setImmersiveActive(res.active);
      setPageMode(res.mode ?? mode);
      setPageEngine(res.engine ?? pageEngine());
      setPageTarget(res.target ?? pageTarget());
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
      const defaults = await getSettings();
      const res = await sendMessage("getPageTranslateStatus", {});
      const mode = res.mode ?? defaults.fullPageMode;
      const engine = res.engine ?? defaults.engines.fullPage;
      const target =
        res.target ??
        resolveTargetLang(defaults.immersiveTargetLang, defaults.uiLang);

      setPageMode(mode);
      setPageEngine(engine);
      setPageTarget(target);
      setImmersiveActive(res.active || res.translating);
    })().catch(() => {
      void getSettings().then((defaults) => {
        setPageMode(defaults.fullPageMode);
        setPageEngine(defaults.engines.fullPage);
        setPageTarget(
          resolveTargetLang(defaults.immersiveTargetLang, defaults.uiLang),
        );
      });
    });
  });

  return (
    <main class="popup">
      <header class="popup-header">
        <h1 class="popup-title">OneLingo</h1>
        <span class="popup-scope">{t("sidebar.immersive")}</span>
      </header>

      <section class="popup-section">
        <Row label={t("popup.label.lang")}>
          <SegBtn active disabled>
            {targetLabel()}
          </SegBtn>
        </Row>

        <Row label={t("popup.label.engine")}>
          <For each={ENGINES}>
            {(e) => (
              <SegBtn
                active={pageEngine() === e.value}
                onClick={() => setFullPageEngine(e.value)}
              >
                {e.label}
              </SegBtn>
            )}
          </For>
        </Row>

        <Row label={t("popup.label.mode")}>
          <SegBtn active={immersiveActive()} onClick={toggleFullPageMode}>
            {t("popup.modeToggle", { label: modeLabel(pageMode()) })}
          </SegBtn>
        </Row>
        <p class="status-card">{pageStateText()}</p>
        <button
          class="primary-button"
          classList={{ idle: !immersiveActive() }}
          onClick={run}
          disabled={action() === "restoring"}
          type="button"
        >
          {action() === "restoring"
            ? t("popup.button.restoring")
            : immersiveActive()
              ? t("popup.button.restore")
              : t("popup.button.start")}
        </button>
        <p
          class="status-line"
          classList={{ error: statusIsError() }}
        >
          {status()}
        </p>
        <button
          class="secondary-button"
          onClick={openOptions}
          type="button"
        >
          {t("popup.button.openOptions")}
        </button>
      </section>
    </main>
  );
}

export default App;
