import { onMessage, sendMessage, type PageFeatureStatus } from "@/lib/messaging";
import { shouldSkipSameLanguageText } from "@/lib/lang-detect";
import {
  hitAtInDocument,
  type HoverTextHit,
} from "@/features/hover";
import {
  getSettings,
  resolveTargetLang,
  watchSettings,
  type HoverGranularity,
} from "@/lib/storage/settings";
import {
  getSelectionEnabledStatus,
  hideSelectionUi,
  initSelection,
  showSelectionFromReader,
  updateSelectionEnabledPref,
} from "@/features/selection";
import type { Rendition } from "epubjs";

interface EpubBridgeState {
  hoverEnabled: boolean;
  hoverPreferredEnabled: boolean | null;
  hoverTarget: string;
  hoverEngine: string;
  hoverGranularity: HoverGranularity;
  hoverFontSize: number;
  hoverSeq: number;
  hoverTimer: number | null;
  lastHoverText: string;
  wordSegmenter: Intl.Segmenter;
  sentenceSegmenter: Intl.Segmenter;
  hoverHighlightDoc: Document | null;
  tooltip: HTMLDivElement | null;
}

const HOVER_DELAY_MS = 10;
const TOOLTIP_ATTR = "data-onelingo-epub-tooltip";
const HIGHLIGHT_NAME = "onelingo-epub-hover";

type HighlightCtor = new (range: Range) => unknown;
type HighlightRegistry = {
  set(name: string, h: unknown): void;
  delete(name: string): void;
};
type CSSWithHighlights = typeof CSS & { highlights?: HighlightRegistry };

interface EpubContents {
  document: Document;
}

type EpubEventSource = {
  on(event: string, callback: (...args: unknown[]) => void): void;
};

const boundEpubDocs = new WeakSet<Document>();
const boundEpubContents = new WeakSet<object>();

export function initEpubBridge(rendition: Rendition): void {
  const state: EpubBridgeState = {
    hoverEnabled: true,
    hoverPreferredEnabled: null,
    hoverTarget: "zh-Hans",
    hoverEngine: "google",
    hoverGranularity: "word",
    hoverFontSize: 14,
    hoverSeq: 0,
    hoverTimer: null,
    lastHoverText: "",
    wordSegmenter: new Intl.Segmenter(undefined, { granularity: "word" }),
    sentenceSegmenter: new Intl.Segmenter(undefined, {
      granularity: "sentence",
    }),
    hoverHighlightDoc: null,
    tooltip: null,
  };

  initSelection({ captureDocumentSelection: false });

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
  window.addEventListener("scroll", hideSelectionUi, {
    passive: true,
  });

  bindRenditionEvents(rendition, state);
  rendition.hooks.content.register((contents: unknown) => {
    bindEpubContents(contents, state);
  });
  rendition.on("rendered", (_section: unknown, view: unknown) => {
    bindEpubContents(view, state);
    bindRenderedContents(rendition, state);
    bindEpubIframes(state);
  });
  window.setTimeout(() => bindRenderedContents(rendition, state), 0);
  window.setTimeout(() => bindEpubIframes(state), 0);
  window.setTimeout(() => bindEpubIframes(state), 250);
}

function bindRenditionEvents(
  rendition: Rendition,
  state: EpubBridgeState,
): void {
  const source = rendition as unknown as EpubEventSource;
  source.on("mousemove", (event, contents) => {
    const mouse = mouseEventLike(event);
    const doc = documentFromContents(contents) ?? documentFromEvent(event);
    if (mouse && doc) onEpubMouseMove(mouse, doc, state);
  });
  source.on("mouseup", (event, contents) => {
    const mouse = mouseEventLike(event);
    const doc = documentFromContents(contents) ?? documentFromEvent(event);
    if (mouse && doc) window.setTimeout(() => onEpubMouseUp(mouse, doc, state), 40);
  });
  source.on("mousedown", () => hideSelectionUi());
  source.on("keydown", (event) => {
    if (keyboardEventLike(event)?.key === "Escape") {
      dismissEpubHover(state);
      hideSelectionUi();
    }
  });
}

function bindRenderedContents(
  rendition: Rendition,
  state: EpubBridgeState,
): void {
  const getContents = (rendition as { getContents?: () => unknown }).getContents;
  if (!getContents) return;
  const contents = getContents.call(rendition);
  if (Array.isArray(contents)) {
    for (const item of contents) bindEpubContents(item, state);
    return;
  }
  bindEpubContents(contents, state);
}

function bindEpubIframes(state: EpubBridgeState): void {
  for (const iframe of document.querySelectorAll<HTMLIFrameElement>(
    "#epub-render iframe",
  )) {
    try {
      if (iframe.contentDocument) {
        bindEpubContents({ document: iframe.contentDocument }, state);
      }
    } catch {
      // EPUB.js uses same-origin reader frames; ignore anything else defensively.
    }
  }
}

function bindEpubContents(
  contentsOrView: unknown,
  state: EpubBridgeState,
): void {
  bindEpubContentEvents(contentsOrView, state);
  const doc = documentFromContents(contentsOrView);
  if (!doc || boundEpubDocs.has(doc)) return;
  boundEpubDocs.add(doc);

  doc.addEventListener(
    "mousemove",
    (event: Event) => {
      const mouse = mouseEventLike(event);
      if (mouse) onEpubMouseMove(mouse, doc, state);
    },
    { passive: true },
  );
  doc.addEventListener("mouseleave", () => dismissEpubHover(state));
  doc.addEventListener("scroll", () => dismissEpubHover(state), {
    passive: true,
  });
  doc.addEventListener("mouseup", (event: Event) => {
    const mouse = mouseEventLike(event);
    if (mouse) window.setTimeout(() => onEpubMouseUp(mouse, doc, state), 0);
  });
  doc.addEventListener(
    "mousedown",
    () => hideSelectionUi(),
    { capture: true },
  );
  doc.addEventListener("keydown", (event: Event) => {
    if (keyboardEventLike(event)?.key === "Escape") {
      dismissEpubHover(state);
      hideSelectionUi();
    }
  });
}

function bindEpubContentEvents(
  contentsOrView: unknown,
  state: EpubBridgeState,
): void {
  const contents = contentsFromValue(contentsOrView);
  if (!contents || boundEpubContents.has(contents)) return;
  boundEpubContents.add(contents);
  contents.on("mousemove", (event) => {
    const mouse = mouseEventLike(event);
    const doc = documentFromContents(contents) ?? documentFromEvent(event);
    if (mouse && doc) onEpubMouseMove(mouse, doc, state);
  });
  contents.on("mouseup", (event) => {
    const mouse = mouseEventLike(event);
    const doc = documentFromContents(contents) ?? documentFromEvent(event);
    if (mouse && doc) window.setTimeout(() => onEpubMouseUp(mouse, doc, state), 40);
  });
  contents.on("selectedRange", (range) => {
    if (rangeLike(range)) onEpubSelectedRange(range, contents.document, state);
  });
}

function contentsFromValue(value: unknown): (EpubContents & EpubEventSource) | null {
  if (!isObject(value)) return null;
  if (isDocument((value as { document?: unknown }).document) && hasOn(value)) {
    return value as unknown as EpubContents & EpubEventSource;
  }
  const nested = (value as { contents?: unknown }).contents;
  if (
    isObject(nested) &&
    isDocument((nested as { document?: unknown }).document) &&
    hasOn(nested)
  ) {
    return nested as unknown as EpubContents & EpubEventSource;
  }
  return null;
}

function documentFromContents(value: unknown): Document | null {
  if (!isObject(value)) return null;
  const direct = (value as { document?: unknown }).document;
  if (isDocument(direct)) return direct;
  const nested = (value as { contents?: unknown }).contents;
  if (isObject(nested)) {
    const nestedDoc = (nested as { document?: unknown }).document;
    if (isDocument(nestedDoc)) return nestedDoc;
  }
  return null;
}

function documentFromEvent(event: unknown): Document | null {
  const target = (event as { target?: unknown } | null)?.target;
  if (!isObject(target)) return null;
  const ownerDocument = (target as { ownerDocument?: unknown }).ownerDocument;
  return isDocument(ownerDocument) ? ownerDocument : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDocument(value: unknown): value is Document {
  return isObject(value) && value.nodeType === Node.DOCUMENT_NODE;
}

function mouseEventLike(event: unknown): MouseEvent | null {
  if (!isObject(event)) return null;
  const candidate = event as Partial<MouseEvent>;
  return typeof candidate.clientX === "number" &&
    typeof candidate.clientY === "number"
    ? (event as unknown as MouseEvent)
    : null;
}

function keyboardEventLike(event: unknown): KeyboardEvent | null {
  return typeof (event as Partial<KeyboardEvent>).key === "string"
    ? (event as KeyboardEvent)
    : null;
}

function hasOn(value: unknown): value is EpubEventSource {
  return isObject(value) && typeof (value as { on?: unknown }).on === "function";
}

function rangeLike(value: unknown): value is Range {
  return (
    isObject(value) &&
    typeof (value as { getClientRects?: unknown }).getClientRects === "function" &&
    typeof (value as { toString?: unknown }).toString === "function"
  );
}

function applyEpubSettings(
  state: EpubBridgeState,
  settings: Awaited<ReturnType<typeof getSettings>>,
): void {
  const prevHover = state.hoverEnabled;
  state.hoverEnabled = state.hoverPreferredEnabled ?? settings.hoverEnabled;
  state.hoverTarget = resolveTargetLang(settings.hoverTargetLang, settings.uiLang);
  state.hoverEngine = settings.engines.hover;
  state.hoverGranularity = settings.hoverGranularity;
  state.hoverFontSize = settings.hoverFontSize;
  if (prevHover && !state.hoverEnabled) dismissEpubHover(state);
}

function registerEpubMessageHandlers(state: EpubBridgeState): void {
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
      if (!state.hoverEnabled) dismissEpubHover(state);
    }
    if (input.selectionEnabled !== undefined) {
      updateSelectionEnabledPref(input.selectionEnabled);
    }
    return readFeatureStatus();
  });
}

function onEpubMouseMove(
  event: MouseEvent,
  doc: Document,
  state: EpubBridgeState,
): void {
  if (!state.hoverEnabled) return;
  const hit = epubTextHitAt(
    state,
    doc,
    event.clientX,
    event.clientY,
  );
  if (!hit || shouldSkipSameLanguageText(hit.text, state.hoverTarget)) {
    dismissEpubHover(state);
    return;
  }
  if (hit.text === state.lastHoverText) return;
  state.lastHoverText = hit.text;
  state.hoverSeq++;
  const seq = state.hoverSeq;
  clearEpubHoverTimer(state);
  setEpubHighlight(state, doc, hit.range);

  state.hoverTimer = window.setTimeout(() => {
    state.hoverTimer = null;
    void sendMessage("translate", {
      engine: state.hoverEngine,
      target: state.hoverTarget,
      text: hit.text,
    })
      .then((res) => {
        if (seq === state.hoverSeq)
          showEpubHoverTooltip(state, res.text, toParentRect(doc, hit.rect));
      })
      .catch((err: unknown) => {
        console.warn("[OneLingo] EPUB hover translate failed:", err);
        if (seq === state.hoverSeq) dismissEpubHover(state);
      });
  }, HOVER_DELAY_MS);
}

function onEpubMouseUp(
  event: MouseEvent,
  doc: Document,
  state: EpubBridgeState,
): void {
  const sel = doc.getSelection?.() ?? doc.defaultView?.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const text = sel.toString().trim();
  if (!text) return;
  const rect =
    toParentRect(doc, firstUsefulRect(sel.getRangeAt(0)) ?? pointRect(event.clientX, event.clientY));

  showSelectionFromReader({
    clientX: rect.right,
    clientY: rect.top,
    text,
  });
}

function onEpubSelectedRange(
  range: Range,
  doc: Document,
  state: EpubBridgeState,
): void {
  const text = range.toString().trim();
  if (!text) return;
  const rect = toParentRect(doc, firstUsefulRect(range) ?? pointRect(8, 8));

  showSelectionFromReader({
    clientX: rect.right,
    clientY: rect.top,
    text,
  });
}

function epubTextHitAt(
  state: EpubBridgeState,
  doc: Document,
  x: number,
  y: number,
): HoverTextHit | null {
  return hitAtInDocument(
    doc,
    x,
    y,
    state.wordSegmenter,
    state.sentenceSegmenter,
    state.hoverGranularity,
  );
}

function showEpubHoverTooltip(
  state: EpubBridgeState,
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

function dismissEpubHover(state: EpubBridgeState): void {
  clearEpubHoverTimer(state);
  state.hoverSeq++;
  state.lastHoverText = "";
  clearEpubHighlight(state);
  if (state.tooltip) state.tooltip.style.display = "none";
}

function clearEpubHoverTimer(state: EpubBridgeState): void {
  if (state.hoverTimer !== null) {
    clearTimeout(state.hoverTimer);
    state.hoverTimer = null;
  }
}

function firstUsefulRect(range: Range): DOMRect | null {
  for (const rect of range.getClientRects()) {
    if (rect.width > 0 && rect.height > 0) return rect;
  }
  const rect = range.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

function pointRect(x: number, y: number): DOMRect {
  return new DOMRect(x, y, 1, 1);
}

function pointInRect(x: number, y: number, rect: DOMRect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function toParentRect(doc: Document, rect: DOMRect): DOMRect {
  const frame = frameElementForDoc(doc);
  if (!frame) return rect;
  const frameRect = frame.getBoundingClientRect();
  return new DOMRect(
    rect.left + frameRect.left,
    rect.top + frameRect.top,
    rect.width,
    rect.height,
  );
}

function frameElementForDoc(doc: Document): HTMLElement | null {
  const frame = doc.defaultView?.frameElement;
  if (frame instanceof HTMLElement) return frame;

  for (const iframe of document.querySelectorAll("iframe")) {
    try {
      if (iframe.contentDocument === doc) return iframe;
    } catch {
      // Cross-origin frames are not EPUB.js content frames.
    }
  }
  return null;
}

function setEpubHighlight(
  state: EpubBridgeState,
  doc: Document,
  range: Range,
): void {
  const registry = getHighlightRegistry(doc);
  const Ctor = getHighlightCtor(doc);
  if (!registry || !Ctor) return;
  injectHighlightStyle(doc);
  if (state.hoverHighlightDoc && state.hoverHighlightDoc !== doc) {
    getHighlightRegistry(state.hoverHighlightDoc)?.delete(HIGHLIGHT_NAME);
  }
  state.hoverHighlightDoc = doc;
  registry.set(HIGHLIGHT_NAME, new Ctor(range));
}

function clearEpubHighlight(state: EpubBridgeState): void {
  if (!state.hoverHighlightDoc) return;
  getHighlightRegistry(state.hoverHighlightDoc)?.delete(HIGHLIGHT_NAME);
  state.hoverHighlightDoc = null;
}

function getHighlightRegistry(doc: Document): HighlightRegistry | null {
  const css = doc.defaultView?.CSS as CSSWithHighlights | undefined;
  return css?.highlights ?? null;
}

function getHighlightCtor(doc: Document): HighlightCtor | null {
  const win = doc.defaultView as
    | (Window & typeof globalThis & { Highlight?: HighlightCtor })
    | null;
  return win?.Highlight ?? null;
}

function injectHighlightStyle(doc: Document): void {
  if (doc.querySelector("style[data-onelingo-epub-highlight]")) return;
  const style = doc.createElement("style");
  style.setAttribute("data-onelingo-epub-highlight", "");
  style.textContent =
    `::highlight(${HIGHLIGHT_NAME}){` +
    "text-decoration:underline solid #aaa;" +
    "text-decoration-thickness:1px;" +
    "text-underline-offset:2px}";
  (doc.head ?? doc.documentElement).appendChild(style);
}
