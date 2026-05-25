import { onMessage, sendMessage, type PageFeatureStatus } from "@/lib/messaging";
import { shouldSkipSameLanguageText } from "@/lib/lang-detect";
import {
  getSettings,
  resolveTargetLang,
  watchSettings,
  type HoverGranularity,
} from "@/lib/storage/settings";
import {
  getSelectionEnabledStatus,
  initSelection,
  updateSelectionEnabledPref,
} from "@/features/selection";
import { initTheme } from "@/lib/theme";

const READER_UI_ATTR = "data-onelingo-reader-ui";
const HIGHLIGHT_NAME = "onelingo-pdf-hover";
const HOVER_DELAY_MS = 10;
const TOOLTIP_ATTR = "data-onelingo-pdf-tooltip";

type HighlightCtor = new (range: Range) => unknown;
type HighlightRegistry = {
  set(name: string, h: unknown): void;
  delete(name: string): void;
};
type CSSWithHighlights = typeof CSS & { highlights?: HighlightRegistry };

interface PdfTextHit {
  anchor: DOMRect;
  range: Range;
  text: string;
}

interface PdfBridgeState {
  hoverEnabled: boolean;
  hoverPreferredEnabled: boolean | null;
  hoverTarget: string;
  hoverEngine: string;
  hoverGranularity: HoverGranularity;
  hoverFontSize: number;
  hoverSeq: number;
  hoverTimer: number | null;
  lastHoverText: string;
  tooltip: HTMLDivElement | null;
}

export default defineUnlistedScript(() => {
  document.documentElement.setAttribute("data-onelingo-pdf-viewer", "");
  initTheme();
  markPdfChrome();
  initPdfTranslation();

  const observer = new MutationObserver(markPdfChrome);
  observer.observe(document.documentElement, { childList: true, subtree: true });
});

function markPdfChrome(): void {
  for (const selector of [
    "#toolbarContainer",
    "#sidebarContainer",
    "#secondaryToolbar",
    "#dialogContainer",
    "#printContainer",
    ".toolbar",
    ".toolbarButton",
    ".dropdownToolbarButton",
  ]) {
    for (const element of document.querySelectorAll(selector)) {
      element.setAttribute(READER_UI_ATTR, "");
    }
  }
}

function initPdfTranslation(): void {
  const state: PdfBridgeState = {
    hoverEnabled: true,
    hoverPreferredEnabled: null,
    hoverTarget: "zh",
    hoverEngine: "google",
    hoverGranularity: "word",
    hoverFontSize: 14,
    hoverSeq: 0,
    hoverTimer: null,
    lastHoverText: "",
    tooltip: null,
  };

  initSelection();

  void getSettings()
    .then((settings) => {
      applySettings(state, settings);
    })
    .catch((err: unknown) => {
      console.warn("[OneLingo] failed to read PDF reader settings:", err);
    });
  try {
    watchSettings((settings) => {
      applySettings(state, settings);
    });
  } catch (err: unknown) {
    console.warn("[OneLingo] failed to watch PDF reader settings:", err);
  }

  registerViewerMessageHandlers(state);

  document.addEventListener("mousemove", (event) => onPdfMouseMove(event, state), {
    passive: true,
  });
  document.addEventListener("mouseleave", () => dismissHover(state));
  document.addEventListener("scroll", () => dismissHover(state), {
    capture: true,
    passive: true,
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      dismissHover(state);
    }
  });
}

function applySettings(
  state: PdfBridgeState,
  settings: Awaited<ReturnType<typeof getSettings>>,
): void {
  const prevHover = state.hoverEnabled;
  state.hoverEnabled = state.hoverPreferredEnabled ?? settings.hoverEnabled;
  state.hoverTarget = resolveTargetLang(settings.hoverTargetLang, settings.uiLang);
  state.hoverEngine = settings.engines.hover;
  state.hoverGranularity = settings.hoverGranularity;
  state.hoverFontSize = settings.hoverFontSize;
  if (prevHover && !state.hoverEnabled) dismissHover(state);
}

function registerViewerMessageHandlers(state: PdfBridgeState): void {
  const readFeatureStatus = (): PageFeatureStatus => ({
    fullPageClickToShowOriginal: false,
    hoverEnabled: state.hoverEnabled,
    ...getSelectionEnabledStatus(),
    hasFullPageClickToShowOriginalPref: false,
    hasHoverEnabledPref: state.hoverPreferredEnabled !== null,
  });

  onMessage("readPageFeatureStatus", () => readFeatureStatus());
  onMessage("updatePageFeaturePrefs", (input) => {
    if (input.hoverEnabled !== undefined) {
      state.hoverPreferredEnabled = input.hoverEnabled;
      state.hoverEnabled = input.hoverEnabled;
      if (!state.hoverEnabled) dismissHover(state);
    }
    if (input.selectionEnabled !== undefined) {
      updateSelectionEnabledPref(input.selectionEnabled);
    }
    return readFeatureStatus();
  });
}

function onPdfMouseMove(event: MouseEvent, state: PdfBridgeState): void {
  if (!state.hoverEnabled) return;
  if (isReaderUi(event.target)) {
    dismissHover(state);
    return;
  }
  const hit = pdfTextHitAt(event.clientX, event.clientY, state.hoverGranularity);
  if (!hit || shouldSkipSameLanguageText(hit.text, state.hoverTarget)) {
    dismissHover(state);
    return;
  }
  if (hit.text === state.lastHoverText) return;
  state.lastHoverText = hit.text;
  state.hoverSeq++;
  const seq = state.hoverSeq;
  clearHoverTimer(state);
  setHighlight(hit.range);

  state.hoverTimer = window.setTimeout(() => {
    state.hoverTimer = null;
    void sendMessage("translate", {
      engine: state.hoverEngine,
      target: state.hoverTarget,
      text: hit.text,
    })
      .then((res) => {
        if (seq === state.hoverSeq) showHoverTooltip(state, res.text, hit.anchor);
      })
      .catch((err: unknown) => {
        console.warn("[OneLingo] PDF hover translate failed:", err);
        if (seq === state.hoverSeq) dismissHover(state);
      });
  }, HOVER_DELAY_MS);
}

function pdfTextHitAt(
  x: number,
  y: number,
  granularity: HoverGranularity,
): PdfTextHit | null {
  const span = pdfTextSpanFromPoint(x, y);
  if (!span) return null;
  const textNode = firstTextNode(span);
  const fullText = textNode?.nodeValue ?? "";
  if (!textNode || !fullText.trim()) return null;

  const spanRect = span.getBoundingClientRect();
  const unit = textUnitAtPoint(fullText, spanRect, x, granularity);
  if (!unit) return null;

  const range = document.createRange();
  range.setStart(textNode, unit.start);
  range.setEnd(textNode, unit.end);
  return {
    anchor: firstUsefulRect(range) ?? spanRect,
    range,
    text: unit.text,
  };
}

function pdfTextSpanFromPoint(x: number, y: number): HTMLElement | null {
  for (const element of document.elementsFromPoint(x, y)) {
    const span = element.closest?.(".textLayer span");
    if (span instanceof HTMLElement && (span.textContent ?? "").trim()) {
      return span;
    }
    if (element instanceof HTMLElement && element.classList.contains("textLayer")) {
      const nested = textLayerSpanAt(element, x, y);
      if (nested) return nested;
    }
  }
  const layers = document.querySelectorAll<HTMLElement>(".textLayer");
  for (const layer of layers) {
    const nested = textLayerSpanAt(layer, x, y);
    if (nested) return nested;
  }
  return null;
}

function textLayerSpanAt(
  layer: HTMLElement,
  x: number,
  y: number,
): HTMLElement | null {
  const layerRect = layer.getBoundingClientRect();
  if (!pointInRect(x, y, layerRect)) return null;
  for (const span of layer.querySelectorAll<HTMLElement>("span")) {
    if (!(span.textContent ?? "").trim()) continue;
    if (pointInRect(x, y, span.getBoundingClientRect())) return span;
  }
  return null;
}

function textUnitAtPoint(
  text: string,
  rect: DOMRect,
  x: number,
  granularity: HoverGranularity,
): { end: number; start: number; text: string } | null {
  if (granularity !== "word") {
    const trimmed = text.trim();
    const start = text.indexOf(trimmed);
    return trimmed ? { end: start + trimmed.length, start, text: trimmed } : null;
  }

  const words = [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)]
    .filter((part) => part.isWordLike)
    .map((part) => ({
      end: part.index + part.segment.length,
      start: part.index,
      text: part.segment.trim(),
    }))
    .filter((part) => part.text);
  if (words.length === 0) return null;
  if (words.length === 1 || rect.width <= 0) return words[0] ?? null;

  const ratio = Math.min(0.999, Math.max(0, (x - rect.left) / rect.width));
  const index = Math.min(words.length - 1, Math.floor(ratio * words.length));
  return words[index] ?? null;
}

function firstTextNode(root: Node): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  return node instanceof Text ? node : null;
}

function firstUsefulRect(range: Range): DOMRect | null {
  for (const rect of range.getClientRects()) {
    if (rect.width > 0 && rect.height > 0) return rect;
  }
  const rect = range.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

function pointInRect(x: number, y: number, rect: DOMRect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function showHoverTooltip(
  state: PdfBridgeState,
  translation: string,
  anchor: DOMRect,
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
  positionFloating(tooltip, anchor, 12);
  tooltip.style.visibility = "visible";
}

function positionFloating(el: HTMLElement, anchor: DOMRect, margin: number): void {
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let left = anchor.left;
  let top = anchor.top - height - margin;
  if (top < 4) top = Math.min(anchor.bottom + margin, viewportHeight - height - 4);
  if (left + width > viewportWidth - 4) {
    left = Math.max(4, viewportWidth - width - 4);
  }
  el.style.left = `${Math.max(4, left)}px`;
  el.style.top = `${Math.max(4, top)}px`;
}

function dismissHover(state: PdfBridgeState): void {
  clearHoverTimer(state);
  state.hoverSeq++;
  state.lastHoverText = "";
  clearHighlight();
  if (state.tooltip) state.tooltip.style.display = "none";
}

function clearHoverTimer(state: PdfBridgeState): void {
  if (state.hoverTimer !== null) {
    clearTimeout(state.hoverTimer);
    state.hoverTimer = null;
  }
}

function isReaderUi(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(`[${READER_UI_ATTR}]`);
}

let highlightStyleInjected = false;

function getRegistry(): HighlightRegistry | null {
  return (CSS as CSSWithHighlights).highlights ?? null;
}

function setHighlight(range: Range): void {
  const registry = getRegistry();
  const Ctor = (globalThis as { Highlight?: HighlightCtor }).Highlight;
  if (!registry || !Ctor) return;
  injectHighlightStyle();
  registry.set(HIGHLIGHT_NAME, new Ctor(range));
}

function clearHighlight(): void {
  getRegistry()?.delete(HIGHLIGHT_NAME);
}

function injectHighlightStyle(): void {
  if (highlightStyleInjected) return;
  highlightStyleInjected = true;
  const style = document.createElement("style");
  style.textContent =
    `::highlight(${HIGHLIGHT_NAME}){` +
    "text-decoration:underline solid #aaa;" +
    "text-decoration-thickness:1px;" +
    "text-underline-offset:2px}";
  document.documentElement.appendChild(style);
}
