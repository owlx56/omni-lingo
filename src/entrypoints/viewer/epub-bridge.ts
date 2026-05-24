import { onMessage, sendMessage, type PageFeatureStatus } from "@/lib/messaging";
import { shouldSkipSameLanguageText } from "@/lib/lang-detect";
import {
  getSettings,
  resolveTargetLang,
  watchSettings,
  type HoverGranularity,
} from "@/lib/storage/settings";
import type { Rendition } from "epubjs";

interface EpubBridgeState {
  hoverEnabled: boolean;
  selectionEnabled: boolean;
  hoverPreferredEnabled: boolean | null;
  selectionPreferredEnabled: boolean | null;
  hoverTarget: string;
  selectionTarget: string;
  hoverEngine: string;
  selectionEngine: string;
  hoverGranularity: HoverGranularity;
  hoverFontSize: number;
  hoverSeq: number;
  hoverTimer: number | null;
  lastHoverText: string;
  tooltip: HTMLDivElement | null;
  selectionCard: HTMLDivElement | null;
}

const HOVER_DELAY_MS = 10;
const TOOLTIP_ATTR = "data-onelingo-epub-tooltip";
const SELECTION_CARD_ATTR = "data-onelingo-epub-selection-card";

export function initEpubBridge(rendition: Rendition): void {
  const state: EpubBridgeState = {
    hoverEnabled: true,
    selectionEnabled: true,
    hoverPreferredEnabled: null,
    selectionPreferredEnabled: null,
    hoverTarget: "zh",
    selectionTarget: "zh",
    hoverEngine: "google",
    selectionEngine: "google",
    hoverGranularity: "word",
    hoverFontSize: 13,
    hoverSeq: 0,
    hoverTimer: null,
    lastHoverText: "",
    tooltip: null,
    selectionCard: null,
  };

  void getSettings()
    .then((settings) => {
      applyEpubSettings(state, settings);
    })
    .catch((err: unknown) => {
      console.warn("[OneLingo] failed to read EPUB reader settings:", err);
    });
  try {
    watchSettings((settings) => {
      applyEpubSettings(state, settings);
    });
  } catch (err: unknown) {
    console.warn("[OneLingo] failed to watch EPUB reader settings:", err);
  }

  registerEpubMessageHandlers(state);

  rendition.hooks.content.register((contents: { document: Document }) => {
    const doc = contents.document;
    doc.addEventListener(
      "mousemove",
      (event: Event) => {
        if (event instanceof MouseEvent) onEpubMouseMove(event, state);
      },
      { passive: true },
    );
    doc.addEventListener("mouseleave", () => dismissEpubHover(state));
    doc.addEventListener("scroll", () => dismissEpubHover(state), {
      passive: true,
    });
    doc.addEventListener("mouseup", (event: Event) => {
      if (event instanceof MouseEvent) {
        window.setTimeout(() => onEpubMouseUp(event, state), 0);
      }
    });
    doc.addEventListener(
      "mousedown",
      () => hideEpubSelectionCard(state),
      { capture: true },
    );
    doc.addEventListener("keydown", (event: Event) => {
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        dismissEpubHover(state);
        hideEpubSelectionCard(state);
      }
    });
  });
}

function applyEpubSettings(
  state: EpubBridgeState,
  settings: Awaited<ReturnType<typeof getSettings>>,
): void {
  const prevHover = state.hoverEnabled;
  const prevSelection = state.selectionEnabled;
  state.hoverEnabled = state.hoverPreferredEnabled ?? settings.hoverEnabled;
  state.selectionEnabled =
    state.selectionPreferredEnabled ?? settings.selectionEnabled;
  state.hoverTarget = resolveTargetLang(settings.hoverTargetLang, settings.uiLang);
  state.selectionTarget = resolveTargetLang(
    settings.selectionTargetLang,
    settings.uiLang,
  );
  state.hoverEngine = settings.engines.hover;
  state.selectionEngine = settings.engines.selection;
  state.hoverGranularity = settings.hoverGranularity;
  state.hoverFontSize = settings.hoverFontSize;
  if (prevHover && !state.hoverEnabled) dismissEpubHover(state);
  if (prevSelection && !state.selectionEnabled) hideEpubSelectionCard(state);
}

function registerEpubMessageHandlers(state: EpubBridgeState): void {
  const readFeatureStatus = (): PageFeatureStatus => ({
    fullPageClickToShowOriginal: false,
    hoverEnabled: state.hoverEnabled,
    selectionEnabled: state.selectionEnabled,
    hasFullPageClickToShowOriginalPref: false,
    hasHoverEnabledPref: state.hoverPreferredEnabled !== null,
    hasSelectionEnabledPref: state.selectionPreferredEnabled !== null,
  });

  onMessage("readPageFeatureStatus", () => readFeatureStatus());
  onMessage("updatePageFeaturePrefs", (input) => {
    if (input.hoverEnabled !== undefined) {
      state.hoverPreferredEnabled = input.hoverEnabled;
      state.hoverEnabled = input.hoverEnabled;
      if (!state.hoverEnabled) dismissEpubHover(state);
    }
    if (input.selectionEnabled !== undefined) {
      state.selectionPreferredEnabled = input.selectionEnabled;
      state.selectionEnabled = input.selectionEnabled;
      if (!state.selectionEnabled) hideEpubSelectionCard(state);
    }
    return readFeatureStatus();
  });
}

function onEpubMouseMove(event: MouseEvent, state: EpubBridgeState): void {
  if (!state.hoverEnabled) return;
  const text = textAtPoint(event);
  if (!text || shouldSkipSameLanguageText(text, state.hoverTarget)) {
    dismissEpubHover(state);
    return;
  }
  if (text === state.lastHoverText) return;
  state.lastHoverText = text;
  state.hoverSeq++;
  const seq = state.hoverSeq;
  clearEpubHoverTimer(state);

  state.hoverTimer = window.setTimeout(() => {
    state.hoverTimer = null;
    void sendMessage("translate", {
      engine: state.hoverEngine,
      target: state.hoverTarget,
      text,
    })
      .then((res) => {
        if (seq === state.hoverSeq)
          showEpubHoverTooltip(state, res.text, event.clientX, event.clientY);
      })
      .catch((err: unknown) => {
        console.warn("[OneLingo] EPUB hover translate failed:", err);
        if (seq === state.hoverSeq) dismissEpubHover(state);
      });
  }, HOVER_DELAY_MS);
}

function onEpubMouseUp(event: MouseEvent, state: EpubBridgeState): void {
  if (!state.selectionEnabled) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const text = sel.toString().trim();
  if (!text || shouldSkipSameLanguageText(text, state.selectionTarget)) return;

  showEpubSelectionCard(state, "\u7FFB\u8BD1\u4E2D...", event.clientX, event.clientY);
  void sendMessage("translate", {
    engine: state.selectionEngine,
    target: state.selectionTarget,
    text,
  })
    .then((res) =>
      showEpubSelectionCard(state, res.text, event.clientX, event.clientY),
    )
    .catch((err: unknown) => {
      console.warn("[OneLingo] EPUB selection translate failed:", err);
      hideEpubSelectionCard(state);
    });
}

function textAtPoint(event: MouseEvent): string | null {
  const target = event.target as Node | null;
  if (!target) return null;

  if (stateGranularity() === "word") {
    const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (!range) return null;
    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) return null;
    const fullText = textNode.textContent ?? "";
    const offset = range.startOffset;
    const words = [
      ...new Intl.Segmenter(undefined, { granularity: "word" }).segment(fullText),
    ].filter((part) => part.isWordLike);
    for (const w of words) {
      if (offset >= w.index && offset < w.index + w.segment.length) {
        return w.segment;
      }
    }
    return null;
  }

  const el =
    target instanceof Element ? target : target.parentElement;
  return el?.textContent?.trim() || null;
}

function stateGranularity(): string {
  return "word";
}

function showEpubHoverTooltip(
  state: EpubBridgeState,
  translation: string,
  x: number,
  y: number,
): void {
  let tooltip = state.tooltip;
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.setAttribute(TOOLTIP_ATTR, "");
    tooltip.style.cssText = [
      "position:fixed",
      "z-index:2147483647",
      "max-width:360px",
      "padding:6px 8px",
      "border-radius:6px",
      "background:#222",
      "color:#fff",
      "font-family:system-ui,sans-serif",
      "line-height:1.4",
      "white-space:pre-wrap",
      "word-break:break-word",
      "pointer-events:none",
      "box-shadow:0 2px 8px rgba(0,0,0,.3)",
    ].join(";");
    document.body.appendChild(tooltip);
    state.tooltip = tooltip;
  }
  tooltip.textContent = translation;
  tooltip.style.fontSize = `${state.hoverFontSize}px`;
  tooltip.style.visibility = "hidden";
  tooltip.style.display = "block";

  const width = tooltip.offsetWidth;
  const height = tooltip.offsetHeight;
  let left = x;
  let top = y - height - 12;
  if (top < 4) top = y + 12;
  if (left + width > window.innerWidth - 4) {
    left = Math.max(4, window.innerWidth - width - 4);
  }
  tooltip.style.left = `${Math.max(4, left)}px`;
  tooltip.style.top = `${Math.max(4, top)}px`;
  tooltip.style.visibility = "visible";
}

function showEpubSelectionCard(
  state: EpubBridgeState,
  text: string,
  x: number,
  y: number,
): void {
  let card = state.selectionCard;
  if (!card) {
    card = document.createElement("div");
    card.setAttribute(SELECTION_CARD_ATTR, "");
    card.style.cssText = [
      "position:fixed",
      "z-index:2147483647",
      "max-width:420px",
      "min-width:96px",
      "padding:10px 12px",
      "border:1px solid #e2dfd5",
      "border-radius:8px",
      "background:#fff",
      "color:#1f1e1d",
      "font:13px/1.5 system-ui,sans-serif",
      "white-space:pre-wrap",
      "word-break:break-word",
      "box-shadow:0 8px 26px rgba(31,30,29,.16)",
    ].join(";");
    document.body.appendChild(card);
    state.selectionCard = card;
  }
  card.textContent = text;
  card.style.visibility = "hidden";
  card.style.display = "block";

  const width = card.offsetWidth;
  const height = card.offsetHeight;
  let left = x;
  let top = y - height - 8;
  if (top < 4) top = y + 8;
  if (left + width > window.innerWidth - 4) {
    left = Math.max(4, window.innerWidth - width - 4);
  }
  card.style.left = `${Math.max(4, left)}px`;
  card.style.top = `${Math.max(4, top)}px`;
  card.style.visibility = "visible";
}

function dismissEpubHover(state: EpubBridgeState): void {
  clearEpubHoverTimer(state);
  state.hoverSeq++;
  state.lastHoverText = "";
  if (state.tooltip) state.tooltip.style.display = "none";
}

function hideEpubSelectionCard(state: EpubBridgeState): void {
  if (state.selectionCard) state.selectionCard.style.display = "none";
}

function clearEpubHoverTimer(state: EpubBridgeState): void {
  if (state.hoverTimer !== null) {
    clearTimeout(state.hoverTimer);
    state.hoverTimer = null;
  }
}
