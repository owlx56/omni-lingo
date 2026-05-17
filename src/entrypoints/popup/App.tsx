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
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: "8px",
        "margin-bottom": "8px",
        "font-size": "12px",
      }}
    >
      <span style={{ color: "#666", "min-width": "52px" }}>{props.label}</span>
      {props.children}
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
      disabled={props.disabled}
      onClick={props.onClick}
      style={{
        padding: "2px 10px",
        "border-radius": "4px",
        border: "1px solid",
        "border-color": props.active ? "#2a6df4" : "#d0d0d0",
        background: props.active ? "#2a6df4" : "#fff",
        color: props.active ? "#fff" : "#444",
        "font-size": "12px",
        cursor: props.disabled ? "default" : "pointer",
        opacity: props.disabled ? 0.85 : 1,
      }}
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
    <div
      style={{
        padding: "12px",
        "font-family": "system-ui,sans-serif",
        width: "300px",
      }}
    >
      <h1
        style={{
          "font-size": "14px",
          "font-weight": "600",
          margin: "0 0 12px",
        }}
      >
        OneLingo
      </h1>

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

      <div
        style={{
          "border-top": "1px solid #eee",
          "padding-top": "10px",
          "margin-top": "4px",
        }}
      >
        <Row label={t("popup.label.mode")}>
          <SegBtn active={immersiveActive()} onClick={toggleFullPageMode}>
            {t("popup.modeToggle", { label: modeLabel(pageMode()) })}
          </SegBtn>
        </Row>
        <p style={{ margin: "0 0 8px", "font-size": "12px", color: "#666" }}>
          {pageStateText()}
        </p>
        <button
          onClick={run}
          disabled={action() === "restoring"}
          style={{
            width: "100%",
            padding: "8px 10px",
            "font-size": "12px",
            "border-radius": "6px",
            border: "1px solid #d0d0d0",
            background: immersiveActive()
              ? "#222"
              : action() === "starting"
                ? "#f2f2f2"
                : "#fff",
            color: immersiveActive() ? "#fff" : "#222",
            cursor: action() === "restoring" ? "default" : "pointer",
          }}
          type="button"
        >
          {action() === "restoring"
            ? t("popup.button.restoring")
            : immersiveActive()
              ? t("popup.button.restore")
              : t("popup.button.start")}
        </button>
        <p
          style={{
            margin: "8px 0 0",
            "word-break": "break-word",
            "font-size": "12px",
            color: statusIsError() ? "#c0392b" : "#666",
            "min-height": "1.5em",
          }}
        >
          {status()}
        </p>
        <button
          onClick={openOptions}
          style={{
            width: "100%",
            padding: "6px 10px",
            "font-size": "12px",
            "border-radius": "6px",
            border: "1px solid #d0d0d0",
            background: "#fff",
            color: "#444",
            cursor: "pointer",
          }}
          type="button"
        >
          {t("popup.button.openOptions")}
        </button>
      </div>
    </div>
  );
}

export default App;
