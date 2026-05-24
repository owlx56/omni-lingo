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
  hoverHighlightDoc: Document | null;
  tooltip: HTMLDivElement | null;
  selectionCard: HTMLDivElement | null;
}

const HOVER_DELAY_MS = 10;
const TOOLTIP_ATTR = "data-onelingo-epub-tooltip";
const SELECTION_CARD_ATTR = "data-onelingo-epub-selection-card";
const HIGHLIGHT_NAME = "onelingo-epub-hover";

type CaretDoc = Document & {
  caretPositionFromPoint?(
    x: number,
    y: number,
  ): { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?(x: number, y: number): Range | null;
};

type HighlightCtor = new (range: Range) => unknown;
type HighlightRegistry = {
  set(name: string, h: unknown): void;
  delete(name: string): void;
};
type CSSWithHighlights = typeof CSS & { highlights?: HighlightRegistry };

interface EpubContents {
  document: Document;
}

interface EpubTextHit {
  anchor: DOMRect;
  range: Range;
  text: string;
}

interface EpubCaretHit {
  offset: number;
  textNode: Text;
}

type EpubEventSource = {
  on(event: string, callback: (...args: unknown[]) => void): void;
};

const boundEpubDocs = new WeakSet<Document>();
const boundEpubContents = new WeakSet<object>();

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
    hoverFontSize: 14,
    hoverSeq: 0,
    hoverTimer: null,
    lastHoverText: "",
    hoverHighlightDoc: null,
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
  source.on("mousedown", () => hideEpubSelectionCard(state));
  source.on("keydown", (event) => {
    if (keyboardEventLike(event)?.key === "Escape") {
      dismissEpubHover(state);
      hideEpubSelectionCard(state);
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
    () => hideEpubSelectionCard(state),
    { capture: true },
  );
  doc.addEventListener("keydown", (event: Event) => {
    if (keyboardEventLike(event)?.key === "Escape") {
      dismissEpubHover(state);
      hideEpubSelectionCard(state);
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

function onEpubMouseMove(
  event: MouseEvent,
  doc: Document,
  state: EpubBridgeState,
): void {
  if (!state.hoverEnabled) return;
  const hit = epubTextHitAt(
    doc,
    event.clientX,
    event.clientY,
    state.hoverGranularity,
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
          showEpubHoverTooltip(state, res.text, toParentRect(doc, hit.anchor));
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
  if (!state.selectionEnabled) return;
  const sel = doc.getSelection?.() ?? doc.defaultView?.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const text = sel.toString().trim();
  if (!text || shouldSkipSameLanguageText(text, state.selectionTarget)) return;
  const rect =
    toParentRect(doc, firstUsefulRect(sel.getRangeAt(0)) ?? pointRect(event.clientX, event.clientY));

  showEpubSelectionCard(state, "\u7FFB\u8BD1\u4E2D...", rect);
  void sendMessage("translate", {
    engine: state.selectionEngine,
    target: state.selectionTarget,
    text,
  })
    .then((res) => showEpubSelectionCard(state, res.text, rect))
    .catch((err: unknown) => {
      console.warn("[OneLingo] EPUB selection translate failed:", err);
      hideEpubSelectionCard(state);
    });
}

function onEpubSelectedRange(
  range: Range,
  doc: Document,
  state: EpubBridgeState,
): void {
  if (!state.selectionEnabled) return;
  const text = range.toString().trim();
  if (!text || shouldSkipSameLanguageText(text, state.selectionTarget)) return;
  const rect = toParentRect(doc, firstUsefulRect(range) ?? pointRect(8, 8));

  showEpubSelectionCard(state, "\u7FFB\u8BD1\u4E2D...", rect);
  void sendMessage("translate", {
    engine: state.selectionEngine,
    target: state.selectionTarget,
    text,
  })
    .then((res) => showEpubSelectionCard(state, res.text, rect))
    .catch((err: unknown) => {
      console.warn("[OneLingo] EPUB selection translate failed:", err);
      hideEpubSelectionCard(state);
    });
}

function epubTextHitAt(
  doc: Document,
  x: number,
  y: number,
  granularity: HoverGranularity,
): EpubTextHit | null {
  const caret = caretHitAt(doc, x, y);
  const textNode = caret?.textNode ?? textNodeAtPoint(doc, x, y);
  const text = textNode?.nodeValue ?? "";
  if (!textNode || !text.trim()) return fallbackElementHitAt(doc, x, y, granularity);

  const word = wordAtPoint(doc, textNode, text, x, y, caret?.offset);
  if (!word) return null;
  if (granularity === "word") return word;

  if (granularity === "sentence") {
    for (const sent of new Intl.Segmenter(undefined, {
      granularity: "sentence",
    }).segment(text)) {
      const start = sent.index;
      const end = start + sent.segment.length;
      if (word.start < start || word.start >= end) continue;
      const sentText = sent.segment.trim();
      if (!sentText) return null;
      const range = doc.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      return {
        anchor: word.anchor,
        range,
        text: sentText,
      };
    }
    return null;
  }

  return paragraphHit(doc, textNode, word.anchor);
}

function textNodeAtPoint(doc: Document, x: number, y: number): Text | null {
  const element = doc.elementFromPoint(x, y);
  const root =
    element?.closest?.("p,li,blockquote,section,article,div,body") ?? element;
  if (!root) return null;

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (
      node.nodeType === Node.TEXT_NODE &&
      textNodeContainsPoint(doc, node as Text, x, y)
    ) {
      return node as Text;
    }
    node = walker.nextNode();
  }
  return null;
}

function caretHitAt(doc: Document, x: number, y: number): EpubCaretHit | null {
  const caretDoc = doc as CaretDoc;
  if (caretDoc.caretPositionFromPoint) {
    const pos = caretDoc.caretPositionFromPoint(x, y);
    if (pos?.offsetNode.nodeType === Node.TEXT_NODE) {
      return { offset: pos.offset, textNode: pos.offsetNode as Text };
    }
    const childText = textNodeFromCaretChild(pos?.offsetNode, pos?.offset);
    if (childText) return childText;
  }
  if (caretDoc.caretRangeFromPoint) {
    const range = caretDoc.caretRangeFromPoint(x, y);
    if (range?.startContainer.nodeType === Node.TEXT_NODE) {
      return { offset: range.startOffset, textNode: range.startContainer as Text };
    }
    const childText = textNodeFromCaretChild(range?.startContainer, range?.startOffset);
    if (childText) return childText;
  }
  return null;
}

function textNodeFromCaretChild(node: Node | undefined, offset: number | undefined): EpubCaretHit | null {
  if (!node || offset === undefined || node.nodeType !== Node.ELEMENT_NODE) return null;
  const child = node.childNodes[Math.min(offset, Math.max(0, node.childNodes.length - 1))];
  if (child?.nodeType === Node.TEXT_NODE) return { offset: 0, textNode: child as Text };
  const walker = node.ownerDocument?.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const textNode = walker?.nextNode();
  return textNode?.nodeType === Node.TEXT_NODE
    ? { offset: 0, textNode: textNode as Text }
    : null;
}

function textNodeContainsPoint(
  doc: Document,
  textNode: Text,
  x: number,
  y: number,
): boolean {
  const value = textNode.nodeValue ?? "";
  if (!value.trim()) return false;
  const range = doc.createRange();
  range.selectNodeContents(textNode);
  for (const rect of range.getClientRects()) {
    if (pointInRect(x, y, rect)) return true;
  }
  return false;
}

function wordAtPoint(
  doc: Document,
  textNode: Text,
  text: string,
  x: number,
  y: number,
  offset: number | undefined,
): (EpubTextHit & { start: number }) | null {
  for (const segment of new Intl.Segmenter(undefined, {
    granularity: "word",
  }).segment(text)) {
    if (!segment.isWordLike) continue;
    const start = segment.index;
    const end = start + segment.segment.length;
    const range = doc.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    const anchor = firstUsefulRect(range);
    if (!anchor) continue;
    if (offset !== undefined && offset >= start && offset <= end) {
      return {
        anchor,
        range,
        start,
        text: segment.segment.trim(),
      };
    }
    for (const rect of range.getClientRects()) {
      if (!pointInRect(x, y, rect)) continue;
      return {
        anchor: rect,
        range,
        start,
        text: segment.segment.trim(),
      };
    }
  }
  return null;
}

function fallbackElementHitAt(
  doc: Document,
  x: number,
  y: number,
  granularity: HoverGranularity,
): EpubTextHit | null {
  const element = doc.elementFromPoint(x, y);
  const root =
    element?.closest?.("p,li,blockquote,section,article,div,body") ?? element;
  const text = (root as HTMLElement | null)?.innerText?.trim();
  if (!root || !text) return null;
  const range = doc.createRange();
  range.selectNodeContents(root);
  const anchor = firstUsefulRect(range) ?? root.getBoundingClientRect();
  if (granularity === "paragraph") return { anchor, range, text };
  const firstWord = [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)]
    .find((segment) => segment.isWordLike && segment.segment.trim());
  if (!firstWord) return { anchor, range, text };
  return {
    anchor,
    range,
    text:
      granularity === "word"
        ? firstWord.segment.trim()
        : sentenceContainingText(text, firstWord.index) ?? text,
  };
}

function sentenceContainingText(text: string, offset: number): string | null {
  for (const sent of new Intl.Segmenter(undefined, {
    granularity: "sentence",
  }).segment(text)) {
    const start = sent.index;
    const end = start + sent.segment.length;
    if (offset >= start && offset < end) return sent.segment.trim() || null;
  }
  return null;
}

const BLOCK_RE =
  /^(block|flex|grid|list-item|table(?!-cell\b|-row\b)|table-cell|table-row)$/;

function paragraphHit(
  doc: Document,
  textNode: Text,
  anchor: DOMRect,
): EpubTextHit | null {
  let element: Element | null = textNode.parentElement;
  const win = doc.defaultView;
  while (element && element !== doc.documentElement) {
    const display = win?.getComputedStyle(element).display ?? "";
    if (BLOCK_RE.test(display)) break;
    element = element.parentElement;
  }
  if (!element || element === doc.documentElement || element === doc.body) {
    return null;
  }

  const text = (element as HTMLElement).innerText?.trim();
  if (!text) return null;

  const range = doc.createRange();
  range.selectNodeContents(element);
  return { anchor, range, text };
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

function showEpubSelectionCard(
  state: EpubBridgeState,
  text: string,
  anchor: DOMRect,
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
  positionFloating(card, anchor, 8);
  card.style.visibility = "visible";
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

function hideEpubSelectionCard(state: EpubBridgeState): void {
  if (state.selectionCard) state.selectionCard.style.display = "none";
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
