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
  wordSegmenter: Intl.Segmenter;
  sentenceSegmenter: Intl.Segmenter;
  hoverSeq: number;
  hoverTimer: number | null;
  lastHoverText: string;
  tooltip: HTMLDivElement | null;
}

type CaretDoc = Document & {
  caretPositionFromPoint?(
    x: number,
    y: number,
  ): { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?(x: number, y: number): Range | null;
};

interface CaretHit {
  node: Text;
  offset: number | null;
}

export default defineUnlistedScript(() => {
  document.documentElement.setAttribute("data-onelingo-pdf-viewer", "");
  initTheme();
  watchEffectiveTheme(syncPdfViewerTheme);
  markPdfChrome();
  initPdfTranslation();

  const observer = new MutationObserver(markPdfChrome);
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
    wordSegmenter: new Intl.Segmenter(undefined, { granularity: "word" }),
    sentenceSegmenter: new Intl.Segmenter(undefined, {
      granularity: "sentence",
    }),
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
  const hit = pdfTextHitAt(
    event.clientX,
    event.clientY,
    state.hoverGranularity,
    state.wordSegmenter,
    state.sentenceSegmenter,
  );
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
  wordSegmenter: Intl.Segmenter,
  sentenceSegmenter: Intl.Segmenter,
): PdfTextHit | null {
  const caret = caretHitAt(x, y) ?? textLayerHitAt(x, y);
  if (!caret) return null;
  const textNode = caret.node;
  const text = textNode.nodeValue ?? "";
  if (!text.trim()) return null;

  let wordStart = -1;
  let hitRect: DOMRect | null = null;
  let hitWordText = "";
  let hitWordRange: Range | null = null;

  for (const word of wordSegmenter.segment(text)) {
    if (!word.isWordLike) continue;
    const start = word.index;
    const end = start + word.segment.length;

    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    for (const rect of range.getClientRects()) {
      if (!pointInRect(x, y, rect)) continue;
      wordStart = start;
      hitRect = rect;
      hitWordText = word.segment;
      hitWordRange = range;
      break;
    }
    if (wordStart !== -1) break;
  }
  if (wordStart === -1 || !hitRect || !hitWordRange) return null;

  if (granularity === "word") {
    return {
      anchor: hitRect,
      range: hitWordRange,
      text: hitWordText,
    };
  }

  if (granularity === "sentence") {
    for (const sentence of sentenceSegmenter.segment(text)) {
      const start = sentence.index;
      const end = start + sentence.segment.length;
      if (wordStart < start || wordStart >= end) continue;
      const sentenceText = sentence.segment.trim();
      if (!sentenceText) return null;
      const sentenceRange = document.createRange();
      sentenceRange.setStart(textNode, start);
      sentenceRange.setEnd(textNode, end);
      return {
        anchor: hitRect,
        range: sentenceRange,
        text: sentenceText,
      };
    }
    return null;
  }

  const paragraph = paragraphHit(textNode, hitRect);
  if (paragraph) return paragraph;
  return {
    anchor: hitRect,
    range: hitWordRange,
    text: hitWordText,
  };
}

function caretHitAt(x: number, y: number): CaretHit | null {
  const doc = document as CaretDoc;
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (p?.offsetNode.nodeType === Node.TEXT_NODE) {
      return { node: p.offsetNode as Text, offset: p.offset };
    }
  }
  if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    if (r?.startContainer.nodeType === Node.TEXT_NODE) {
      return { node: r.startContainer as Text, offset: r.startOffset };
    }
  }
  return null;
}

function textLayerHitAt(x: number, y: number): CaretHit | null {
  const el = document.elementFromPoint(x, y);
  const textLayerNode = el?.closest?.(".textLayer span, .textLayer");
  if (!textLayerNode) return null;
  const walker = document.createTreeWalker(textLayerNode, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if ((node.nodeValue ?? "").trim()) {
      return { node: node as Text, offset: null };
    }
    node = walker.nextNode();
  }
  return null;
}

function firstTextNode(root: Node): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  return node instanceof Text ? node : null;
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
