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
import {
  applyThemeToDocument,
  initTheme,
  watchEffectiveTheme,
  type EffectiveTheme,
} from "@/lib/theme";

const READER_UI_ATTR = "data-onelingo-reader-ui";
const HOVER_DELAY_MS = 10;
const TOOLTIP_ATTR = "data-onelingo-pdf-tooltip";
const HOVER_HIGHLIGHT_ATTR = "data-onelingo-pdf-hover-highlight";
const HIGHLIGHT_NAME = "onelingo-pdf-hover";
const PDF_TEXT_SPAN_ATTR = "data-onelingo-pdf-text-span";
const PDF_TOKEN_WRAP_ATTR = "data-onelingo-pdf-token-wrap";
const PDF_TOKEN_ATTR = "data-onelingo-pdf-token";
const LESS_TRANSLATE_SPLIT_RE = /(\s|\.|\,|\:|\!|\?|\"|\||\'|。|，|？|》|《)/g;
const DIGIT_RE = /\d/;

const pdfTextOriginals = new WeakMap<HTMLElement, string>();
let tokenizeTextLayersFrame: number | null = null;
let pdfHoverPointFrame: number | null = null;
let pendingPdfHoverPoint: PdfHoverPoint | null = null;
let pdfBridgeState: PdfBridgeState | null = null;
let pdfHighlightStyleInjected = false;

interface PdfTextHit {
  anchor: DOMRect;
  highlightRects: DOMRect[];
  highlightRanges: Range[];
  text: string;
}

interface PdfTokenHit {
  end: number;
  fullText: string;
  highlightRects: DOMRect[];
  highlightRanges: Range[];
  parent: HTMLElement;
  rect: DOMRect;
  start: number;
  text: string;
  token: HTMLElement;
}

type HighlightCtor = new (...ranges: Range[]) => unknown;
type HighlightRegistry = {
  set(name: string, h: unknown): void;
  delete(name: string): void;
};
type CSSWithHighlights = typeof CSS & { highlights?: HighlightRegistry };

interface PdfHoverPoint {
  x: number;
  y: number;
}

interface PdfBridgeState {
  hoverEnabled: boolean;
  hoverPreferredEnabled: boolean | null;
  hoverTarget: string;
  hoverEngine: string;
  hoverGranularity: HoverGranularity;
  hoverFontSize: number;
  sentenceSegmenter: Intl.Segmenter;
  hoverSeq: number;
  hoverTimer: number | null;
  lastHoverKey: string;
  lastHoverText: string;
  tooltip: HTMLDivElement | null;
  highlightLayer: HTMLDivElement | null;
}

export default defineUnlistedScript(() => {
  document.documentElement.setAttribute("data-onelingo-pdf-viewer", "");
  initTheme();
  watchEffectiveTheme(syncPdfViewerTheme);
  markPdfChrome();
  initPdfTranslation();
  schedulePdfTextLayerTokenize();

  const observer = new MutationObserver(() => {
    markPdfChrome();
    schedulePdfTextLayerTokenize();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
});

function syncPdfViewerTheme(theme: EffectiveTheme): void {
  applyThemeToDocument(document, theme);
  document.documentElement.classList.toggle("onelingo-theme-dark", theme === "dark");
  document.documentElement.classList.toggle("onelingo-theme-light", theme === "light");
}

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
    hoverTarget: "zh-Hans",
    hoverEngine: "google",
    hoverGranularity: "word",
    hoverFontSize: 14,
    sentenceSegmenter: new Intl.Segmenter(undefined, {
      granularity: "sentence",
    }),
    hoverSeq: 0,
    hoverTimer: null,
    lastHoverKey: "",
    lastHoverText: "",
    tooltip: null,
    highlightLayer: null,
  };
  pdfBridgeState = state;

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
  document.addEventListener("mouseleave", () => dismissHover(state));
  document.addEventListener("mousemove", onPdfDocumentMouseMove, {
    capture: true,
    passive: true,
  });
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

function onPdfTokenMouseEnter(token: HTMLElement): void {
  const state = pdfBridgeState;
  if (!state?.hoverEnabled) return;
  if (isReaderUi(token)) {
    dismissHover(state);
    return;
  }
  const hit = pdfTextHitFromToken(
    token,
    state.hoverGranularity,
    state.sentenceSegmenter,
  );
  startPdfHover(hit, state);
}

function onPdfDocumentMouseMove(event: MouseEvent): void {
  const state = pdfBridgeState;
  if (!state?.hoverEnabled) return;
  pendingPdfHoverPoint = { x: event.clientX, y: event.clientY };
  if (pdfHoverPointFrame !== null) return;
  pdfHoverPointFrame = window.requestAnimationFrame(() => {
    pdfHoverPointFrame = null;
    const point = pendingPdfHoverPoint;
    pendingPdfHoverPoint = null;
    if (point) handlePdfHoverPoint(point);
  });
}

function handlePdfHoverPoint(point: PdfHoverPoint): void {
  const state = pdfBridgeState;
  if (!state?.hoverEnabled) return;

  const target = document.elementFromPoint(point.x, point.y);
  if (isReaderUi(target)) {
    dismissHover(state);
    return;
  }
  if (!(target instanceof Element)) {
    dismissHover(state);
    return;
  }

  const token = target.closest<HTMLElement>(`[${PDF_TOKEN_ATTR}]`);
  if (token?.closest(".textLayer")) {
    startPdfHover(
      pdfTextHitFromToken(
        token,
        state.hoverGranularity,
        state.sentenceSegmenter,
      ),
      state,
    );
    return;
  }

  if (target.closest(".textLayer")) {
    dismissHover(state);
  }
}

function onPdfTokenMouseClear(): void {
  const state = pdfBridgeState;
  if (state) dismissHover(state);
}

function startPdfHover(hit: PdfTextHit | null, state: PdfBridgeState): void {
  if (!state.hoverEnabled) return;
  if (!hit || shouldSkipSameLanguageText(hit.text, state.hoverTarget)) {
    dismissHover(state);
    return;
  }
  const hoverKey = makeHoverKey(hit);
  if (hoverKey === state.lastHoverKey) return;
  state.lastHoverKey = hoverKey;
  state.lastHoverText = hit.text;
  state.hoverSeq++;
  const seq = state.hoverSeq;
  clearHoverTimer(state);
  setHighlight(state, hit);

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

function schedulePdfTextLayerTokenize(): void {
  if (tokenizeTextLayersFrame !== null) return;
  tokenizeTextLayersFrame = window.requestAnimationFrame(() => {
    tokenizeTextLayersFrame = null;
    tokenizePdfTextLayers();
  });
}

function tokenizePdfTextLayers(): void {
  for (const span of document.querySelectorAll<HTMLElement>(".textLayer span")) {
    tokenizePdfTextSpan(span);
  }
}

function tokenizePdfTextSpan(span: HTMLElement): void {
  if (!isTokenizablePdfTextSpan(span)) return;
  const text = span.textContent ?? "";
  if (!text.trim()) return;
  if (
    span.hasAttribute(PDF_TEXT_SPAN_ATTR) &&
    pdfTextOriginals.get(span) === text
  ) {
    return;
  }

  const wrapper = document.createElement("span");
  wrapper.setAttribute(PDF_TOKEN_WRAP_ATTR, "");
  wrapper.style.cssText = "all: unset";
  wrapper.addEventListener(
    "mousedown",
    () => {
      wrapper.style.pointerEvents = "none";
      window.setTimeout(() => {
        if (wrapper.isConnected) wrapper.style.cssText = "all: unset";
      }, 500);
    },
    { passive: true },
  );

  for (const segment of lessTranslateSplitSegments(text)) {
    const token = document.createElement("span");
    token.style.cssText = "all: unset";
    token.textContent = segment.text;
    if (segment.translatable) {
      token.setAttribute(PDF_TOKEN_ATTR, "");
      token.dataset.onelingoStart = String(segment.start);
      token.dataset.onelingoEnd = String(segment.end);
      bindPdfTokenHover(token);
    }
    wrapper.appendChild(token);
  }

  span.replaceChildren(wrapper);
  span.setAttribute(PDF_TEXT_SPAN_ATTR, "");
  pdfTextOriginals.set(span, text);
}

function isTokenizablePdfTextSpan(span: HTMLElement): boolean {
  if (span.localName !== "span") return false;
  if (!span.closest(".textLayer")) return false;
  if (span.hasAttribute(PDF_TOKEN_WRAP_ATTR) || span.closest(`[${PDF_TOKEN_WRAP_ATTR}]`)) {
    return false;
  }
  if (span.closest(".highlight")) return false;
  if (span.classList.contains("highlight")) return false;
  if (span.classList.contains("markedContent")) return false;
  if (span.getAttribute("role") === "img") return false;
  if (span.childElementCount > 0 && !span.hasAttribute(PDF_TEXT_SPAN_ATTR)) {
    return false;
  }
  return !!(span.textContent ?? "").trim();
}

function bindPdfTokenHover(token: HTMLElement): void {
  token.addEventListener(
    "mouseenter",
    () => {
      onPdfTokenMouseEnter(token);
    },
    true,
  );
  token.addEventListener(
    "mousemove",
    () => {
      onPdfTokenMouseEnter(token);
    },
    true,
  );
  token.addEventListener(
    "mouseout",
    () => {
      onPdfTokenMouseClear();
    },
    true,
  );
  token.addEventListener(
    "mouseleave",
    () => {
      onPdfTokenMouseClear();
    },
    true,
  );
  token.addEventListener(
    "mouseover",
    () => {
      onPdfTokenMouseClear();
    },
    true,
  );
}

function pdfTextHitFromToken(
  token: HTMLElement,
  granularity: HoverGranularity,
  sentenceSegmenter: Intl.Segmenter,
): PdfTextHit | null {
  const word = pdfTokenHit(token);
  if (!word) return null;

  const makeHit = (
    start: number,
    end: number,
    text: string,
  ): PdfTextHit | null => {
    const highlightRects = tokenRectsInRange(word.parent, start, end);
    const highlightRanges = tokenRangesInRange(word.parent, start, end);
    if (!highlightRects.length || !highlightRanges.length) return null;
    return {
      anchor: word.rect,
      highlightRects,
      highlightRanges,
      text,
    };
  };

  if (granularity === "word") {
    return {
      anchor: word.rect,
      highlightRects: word.highlightRects,
      highlightRanges: word.highlightRanges,
      text: word.text,
    };
  }

  if (granularity === "sentence") {
    for (const sentence of sentenceSegmenter.segment(word.fullText)) {
      const sentenceStart = sentence.index;
      const sentenceEnd = sentenceStart + sentence.segment.length;
      if (word.start < sentenceStart || word.start >= sentenceEnd) continue;
      const range = trimTextRange(word.fullText, sentenceStart, sentenceEnd);
      if (!range) return null;
      return makeHit(range.start, range.end, word.fullText.slice(range.start, range.end));
    }
    return null;
  }

  const paragraph = paragraphHit(word);
  if (paragraph) return paragraph;
  return {
    anchor: word.rect,
    highlightRects: word.highlightRects,
    highlightRanges: word.highlightRanges,
    text: word.text,
  };
}

function makeHoverKey(hit: PdfTextHit): string {
  const rectKey = hit.highlightRects
    .map(
      (rect) =>
        `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`,
    )
    .join("|");
  return `${hit.text}\n${rectKey}`;
}

function trimTextRange(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  let nextStart = start;
  let nextEnd = end;
  while (nextStart < nextEnd && isBlankText(text[nextStart] ?? "")) nextStart++;
  while (nextEnd > nextStart && isBlankText(text[nextEnd - 1] ?? "")) nextEnd--;
  return nextStart < nextEnd ? { start: nextStart, end: nextEnd } : null;
}

function paragraphHit(word: PdfTokenHit): PdfTextHit | null {
  const fullText = word.fullText;
  const trimmed = trimTextRange(fullText, 0, fullText.length);
  if (!trimmed) return null;
  const highlightRects = tokenRectsInRange(word.parent, trimmed.start, trimmed.end);
  const highlightRanges = tokenRangesInRange(word.parent, trimmed.start, trimmed.end);
  if (!highlightRects.length || !highlightRanges.length) return null;
  return {
    anchor: word.rect,
    highlightRects,
    highlightRanges,
    text: fullText.slice(trimmed.start, trimmed.end),
  };
}

function pdfTokenHit(token: HTMLElement): PdfTokenHit | null {
  if (!token.hasAttribute(PDF_TOKEN_ATTR)) return null;
  const parent = token.closest<HTMLElement>(`[${PDF_TEXT_SPAN_ATTR}]`);
  if (!parent || !parent.closest(".textLayer")) return null;

  const rect = token.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const start = readTokenOffset(token, "onelingoStart");
  const end = readTokenOffset(token, "onelingoEnd");
  if (start === null || end === null || end <= start) return null;

  const text = (token.textContent ?? "").trim();
  if (!text) return null;
  const highlightRange = tokenRange(token);
  if (!highlightRange) return null;

  return {
    end,
    fullText: getPdfSpanOriginalText(parent),
    highlightRects: [rect],
    highlightRanges: [highlightRange],
    parent,
    rect,
    start,
    text,
    token,
  };
}

function readTokenOffset(
  token: HTMLElement,
  key: "onelingoStart" | "onelingoEnd",
): number | null {
  const value = token.dataset[key];
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function getPdfSpanOriginalText(span: HTMLElement): string {
  return pdfTextOriginals.get(span) ?? span.textContent ?? "";
}

function tokenRectsInRange(parent: HTMLElement, start: number, end: number): DOMRect[] {
  const root =
    parent.querySelector<HTMLElement>(`[${PDF_TOKEN_WRAP_ATTR}]`) ?? parent;
  const rects: DOMRect[] = [];
  for (const token of root.querySelectorAll<HTMLElement>(`[${PDF_TOKEN_ATTR}]`)) {
    const tokenStart = readTokenOffset(token, "onelingoStart");
    const tokenEnd = readTokenOffset(token, "onelingoEnd");
    if (tokenStart === null || tokenEnd === null) continue;
    if (tokenEnd <= start || tokenStart >= end) continue;
    const rect = token.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) rects.push(rect);
  }
  return rects;
}

function tokenRangesInRange(parent: HTMLElement, start: number, end: number): Range[] {
  const root =
    parent.querySelector<HTMLElement>(`[${PDF_TOKEN_WRAP_ATTR}]`) ?? parent;
  const ranges: Range[] = [];
  for (const token of root.querySelectorAll<HTMLElement>(`[${PDF_TOKEN_ATTR}]`)) {
    const tokenStart = readTokenOffset(token, "onelingoStart");
    const tokenEnd = readTokenOffset(token, "onelingoEnd");
    if (tokenStart === null || tokenEnd === null) continue;
    if (tokenEnd <= start || tokenStart >= end) continue;
    const range = tokenRange(token);
    if (range) ranges.push(range);
  }
  return ranges;
}

function tokenRange(token: HTMLElement): Range | null {
  const textNode = token.firstChild;
  if (textNode?.nodeType !== Node.TEXT_NODE) return null;
  const text = textNode.textContent ?? "";
  if (!text.trim()) return null;
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, text.length);
  return range;
}

function lessTranslateSplitSegments(
  text: string,
): Array<{ end: number; start: number; text: string; translatable: boolean }> {
  const segments: Array<{
    end: number;
    start: number;
    text: string;
    translatable: boolean;
  }> = [];
  let cursor = 0;
  LESS_TRANSLATE_SPLIT_RE.lastIndex = 0;
  for (const match of text.matchAll(LESS_TRANSLATE_SPLIT_RE)) {
    const index = match.index ?? 0;
    addLessTranslateSplitSegment(segments, text, cursor, index);
    addLessTranslateSplitSegment(segments, text, index, index + match[0].length);
    cursor = index + match[0].length;
  }
  addLessTranslateSplitSegment(segments, text, cursor, text.length);
  return segments;
}

function addLessTranslateSplitSegment(
  segments: Array<{
    end: number;
    start: number;
    text: string;
    translatable: boolean;
  }>,
  text: string,
  start: number,
  end: number,
): void {
  if (end <= start) return;
  const segment = text.slice(start, end);
  const trimmed = segment.trim();
  segments.push({
    end,
    start,
    text: segment,
    translatable: !!trimmed && !DIGIT_RE.test(trimmed),
  });
}

function isBlankText(text: string): boolean {
  return !text || /^\s+$/u.test(text);
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
  state.lastHoverKey = "";
  state.lastHoverText = "";
  clearHighlight(state);
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

function setHighlight(state: PdfBridgeState, hit: PdfTextHit): void {
  if (setNativeHighlight(hit.highlightRanges)) {
    clearOverlayHighlight(state);
    return;
  }
  setOverlayHighlight(state, hit.highlightRects);
}

function setNativeHighlight(ranges: Range[]): boolean {
  const registry = getHighlightRegistry();
  const Ctor = getHighlightCtor();
  if (!registry || !Ctor || !ranges.length) return false;
  injectHighlightStyle();
  registry.set(HIGHLIGHT_NAME, new Ctor(...ranges));
  return true;
}

function getHighlightRegistry(): HighlightRegistry | null {
  return (CSS as CSSWithHighlights).highlights ?? null;
}

function getHighlightCtor(): HighlightCtor | null {
  return (globalThis as { Highlight?: HighlightCtor }).Highlight ?? null;
}

function injectHighlightStyle(): void {
  if (pdfHighlightStyleInjected) return;
  const style = document.createElement("style");
  style.setAttribute("data-onelingo-pdf-highlight", "");
  style.textContent =
    `::highlight(${HIGHLIGHT_NAME}){` +
    "text-decoration:underline solid #aaa;" +
    "text-decoration-thickness:1px;" +
    "text-underline-offset:2px}";
  (document.head ?? document.documentElement).appendChild(style);
  pdfHighlightStyleInjected = true;
}

function setOverlayHighlight(state: PdfBridgeState, rects: DOMRect[]): void {
  const layer = ensureHighlightLayer(state);
  layer.replaceChildren(
    ...rects.map((rect) => {
      const top = snapCssPixel(rect.bottom + 2);
      const line = document.createElement("span");
      line.style.cssText = [
        "position:fixed",
        "pointer-events:none",
        "z-index:2147483646",
        "border-top:1px solid #aaa",
        `left:${rect.left}px`,
        `top:${top}px`,
        `width:${rect.width}px`,
      ].join(";");
      return line;
    }),
  );
}

function clearHighlight(state: PdfBridgeState): void {
  getHighlightRegistry()?.delete(HIGHLIGHT_NAME);
  clearOverlayHighlight(state);
}

function clearOverlayHighlight(state: PdfBridgeState): void {
  state.highlightLayer?.replaceChildren();
}

function snapCssPixel(value: number): number {
  const ratio = window.devicePixelRatio || 1;
  return Math.round(value * ratio) / ratio;
}

function ensureHighlightLayer(state: PdfBridgeState): HTMLDivElement {
  if (state.highlightLayer?.isConnected) return state.highlightLayer;
  const layer = document.createElement("div");
  layer.setAttribute(HOVER_HIGHLIGHT_ATTR, "");
  layer.style.cssText = [
    "position:fixed",
    "inset:0",
    "pointer-events:none",
    "z-index:2147483646",
  ].join(";");
  document.documentElement.appendChild(layer);
  state.highlightLayer = layer;
  return layer;
}
