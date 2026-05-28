// 悬停翻译最小闭环。热路径，保持 vanilla、零框架。
//
// 粒度（hoverGranularity）：
//   word      — word 几何校验 → 直接返回命中词
//   sentence  — word 几何校验 → sentence segmenter 取句（文本节点内）
//   paragraph — word 几何校验 → 找最近 block 祖先 → innerText 整段
//
// 缓存共用：key = engine|src|tgt|text，全文翻译按相同粒度拆句即可命中。

import { sendMessage } from "@/lib/messaging";
import type { TranslateResponse } from "@/engines/types";
import { shouldSkipSameLanguageText } from "@/lib/lang-detect";
import {
  getSettings,
  resolveTargetLang,
  watchSettings,
  type HoverGranularity,
} from "@/lib/storage/settings";

const TRANSLATE_DELAY_MS = 10;
const TOOLTIP_ATTR = "data-onelingo-tooltip";
const READER_UI_ATTR = "data-onelingo-reader-ui";
const HIGHLIGHT_NAME = "onelingo-hover";
const HIGHLIGHT_STYLE_ATTR = "data-onelingo-hl";

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

type HighlightCtor = new (range: Range) => unknown;
type HighlightRegistry = {
  set(name: string, h: unknown): void;
  delete(name: string): void;
};
type CSSWithHighlights = typeof CSS & { highlights?: HighlightRegistry };

interface TextHit {
  text: string; // 翻译单元（句子 or 段落）
  rect: DOMRect; // 词位置（tooltip 锚点）
  range: Range; // 高亮范围
}

export interface HoverTextHit {
  text: string;
  rect: DOMRect;
  range: Range;
}

export interface HoverControllerOptions {
  highlightName?: string;
  mapAnchorRect?: (sourceDocument: Document, rect: DOMRect) => DOMRect;
  tooltipAttr?: string;
  tooltipDocument?: Document;
}

export interface HoverPointerInput {
  clientX: number;
  clientY: number;
  sourceDocument?: Document;
  target: EventTarget | null;
}

export interface HoverController {
  dismiss(): void;
  getEnabledStatus(): {
    hoverEnabled: boolean;
    hasHoverEnabledPref: boolean;
  };
  handleMove(input: HoverPointerInput): void;
  updateEnabledPref(hoverEnabled: boolean): {
    hoverEnabled: boolean;
    hasHoverEnabledPref: boolean;
  };
}

interface ResolvedHoverControllerOptions {
  highlightName: string;
  mapAnchorRect: (sourceDocument: Document, rect: DOMRect) => DOMRect;
  tooltipAttr: string;
  tooltipDocument: Document;
}

interface State {
  enabled: boolean;
  settingsEnabled: boolean;
  preferredEnabled: boolean | null;
  target: string;
  engine: string;
  granularity: HoverGranularity;
  fontSize: number; // px
  translateTimer: number | null;
  lastText: string | null; // 上次翻译的文本（去重）
  lastAnchor: DOMRect | null; // 设置变更时重新定位用
  tooltip: HTMLDivElement | null;
  seq: number;
  wordSegmenter: Intl.Segmenter;
  sentenceSegmenter: Intl.Segmenter;
  highlightDoc: Document | null;
  options: ResolvedHoverControllerOptions;
}

interface HoverTranslateRequest {
  text: string;
  target: string;
  engine: string;
}

type ElementLike = Pick<Element, "closest" | "tagName"> & {
  isContentEditable?: boolean;
  nodeType: number;
};

let defaultHoverController: HoverController | null = null;

export function initHover(
  options: HoverControllerOptions = {},
): HoverController {
  const controller = createHoverController(options);
  defaultHoverController = controller;
  bindHoverDocument(controller, document);
  return controller;
}

export function createHoverController(
  options: HoverControllerOptions = {},
): HoverController {
  const state = createState(resolveHoverControllerOptions(options));
  initHoverSettings(state);

  return {
    dismiss: () => dismiss(state),
    getEnabledStatus: () => readEnabledStatus(state),
    handleMove: (input) => handleMove(state, input),
    updateEnabledPref: (hoverEnabled) => {
      state.preferredEnabled = hoverEnabled;
      applyEnabled(state);
      return readEnabledStatus(state);
    },
  };
}

export function bindHoverDocument(
  controller: HoverController,
  doc: Document,
): void {
  doc.addEventListener(
    "mousemove",
    (event) => {
      controller.handleMove({
        clientX: event.clientX,
        clientY: event.clientY,
        sourceDocument: doc,
        target: event.target,
      });
    },
    { passive: true },
  );
  doc.addEventListener("mouseleave", () => controller.dismiss());
  doc.addEventListener("scroll", () => controller.dismiss(), { passive: true });
}

function createState(options: ResolvedHoverControllerOptions): State {
  return {
    enabled: true,
    settingsEnabled: true,
    preferredEnabled: null,
    target: "zh-Hans",
    engine: "google",
    granularity: "word",
    fontSize: 13,
    translateTimer: null,
    lastText: null,
    lastAnchor: null,
    tooltip: null,
    seq: 0,
    wordSegmenter: new Intl.Segmenter(undefined, { granularity: "word" }),
    sentenceSegmenter: new Intl.Segmenter(undefined, {
      granularity: "sentence",
    }),
    highlightDoc: null,
    options,
  };
}

function resolveHoverControllerOptions(
  options: HoverControllerOptions,
): ResolvedHoverControllerOptions {
  return {
    highlightName: options.highlightName ?? HIGHLIGHT_NAME,
    mapAnchorRect: options.mapAnchorRect ?? ((_sourceDocument, rect) => rect),
    tooltipAttr: options.tooltipAttr ?? TOOLTIP_ATTR,
    tooltipDocument: options.tooltipDocument ?? document,
  };
}

function initHoverSettings(state: State): void {
  void getSettings()
    .then((s) => {
      applyHoverSettings(state, s);
    })
    .catch((err: unknown) => {
      console.warn("[OneLingo] failed to read hover settings:", err);
      applyEnabled(state);
    });
  try {
    watchSettings((s) => {
      applyHoverSettings(state, s);
    });
  } catch (err) {
    console.warn("[OneLingo] failed to watch hover settings:", err);
  }
}

function applyHoverSettings(
  state: State,
  s: Awaited<ReturnType<typeof getSettings>>,
): void {
  state.settingsEnabled = s.hoverEnabled;
  state.target = resolveTargetLang(s.hoverTargetLang, s.uiLang);
  state.engine = s.engines.hover;
  state.granularity = s.hoverGranularity;
  state.fontSize = s.hoverFontSize;
  applyTooltipFontSize(state);
  applyEnabled(state);
}

export function getHoverEnabledStatus(): {
  hoverEnabled: boolean;
  hasHoverEnabledPref: boolean;
} {
  return (
    defaultHoverController?.getEnabledStatus() ?? {
      hoverEnabled: true,
      hasHoverEnabledPref: false,
    }
  );
}

export function updateHoverEnabledPref(hoverEnabled: boolean): {
  hoverEnabled: boolean;
  hasHoverEnabledPref: boolean;
} {
  return (
    defaultHoverController?.updateEnabledPref(hoverEnabled) ?? {
      hoverEnabled,
      hasHoverEnabledPref: true,
    }
  );
}

function readEnabledStatus(state: State): {
  hoverEnabled: boolean;
  hasHoverEnabledPref: boolean;
} {
  return {
    hoverEnabled: state.enabled,
    hasHoverEnabledPref: state.preferredEnabled !== null,
  };
}

function applyEnabled(s: State): void {
  s.enabled = s.preferredEnabled ?? s.settingsEnabled;
  if (!s.enabled) dismiss(s);
}

function handleMove(s: State, input: HoverPointerInput): void {
  if (!s.enabled) return;
  if (isEditable(input.target) || isOurUi(input.target, s.options.tooltipAttr)) {
    dismiss(s);
    return;
  }

  const sourceDocument = input.sourceDocument ?? document;
  const hit = hitAtInDocument(
    sourceDocument,
    input.clientX,
    input.clientY,
    s.wordSegmenter,
    s.sentenceSegmenter,
    s.granularity,
  );
  if (!hit) {
    dismiss(s);
    return;
  }
  if (shouldSkipSameLanguageText(hit.text, s.target)) {
    dismiss(s);
    return;
  }
  if (hit.text === s.lastText) return;

  clearTimer(s);
  s.lastText = hit.text;
  const mySeq = ++s.seq;
  setHighlight(s, sourceDocument, hit.range);
  const anchor = s.options.mapAnchorRect(sourceDocument, hit.rect);
  const req = {
    text: hit.text,
    target: s.target,
    engine: s.engine,
  };
  const cached = sendMessage("peekTranslateMemoryCache", req).catch(() => null);
  s.translateTimer = window.setTimeout(() => {
    s.translateTimer = null;
    void finishTranslate(s, mySeq, req, anchor, cached);
  }, TRANSLATE_DELAY_MS);
}

async function finishTranslate(
  s: State,
  seq: number,
  req: HoverTranslateRequest,
  anchor: DOMRect,
  cached: Promise<TranslateResponse | null>,
): Promise<void> {
  if (seq !== s.seq) return;
  const hit = await cached;
  if (seq !== s.seq) return;
  if (hit) {
    show(s, hit.text, anchor);
    return;
  }
  sendMessage("translate", req)
    .then((res) => {
      if (seq !== s.seq) return;
      show(s, res.text, anchor);
    })
    .catch((e: unknown) => {
      console.warn("[OneLingo] hover translate failed:", e);
      if (seq === s.seq) dismiss(s);
    });
}

// ─── 取词 / 句 / 段 ──────────────────────────────────

export function hitAtInDocument(
  doc: Document,
  x: number,
  y: number,
  wordSeg: Intl.Segmenter,
  sentSeg: Intl.Segmenter,
  granularity: HoverGranularity,
): HoverTextHit | null {
  // 1. caret API 找文本节点 + offset
  const caret = caretHitAt(doc, x, y) ?? textLayerHitAt(doc, x, y);
  if (!caret) return null;
  const textNode = caret.node;
  const text = textNode.nodeValue ?? "";
  if (!text.trim()) return null;

  // 2. word segmenter 几何校验（防 caret 空白吸附）
  let wordStart = -1;
  let hitRect: DOMRect | null = null;
  let hitWordText = "";
  let hitWordRange: Range | null = null;

  for (const w of wordSeg.segment(text)) {
    if (!w.isWordLike) continue;
    const ws = w.index;
    const we = ws + w.segment.length;

    const wr = doc.createRange();
    wr.setStart(textNode, ws);
    wr.setEnd(textNode, we);
    const rects = wr.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (!r) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        wordStart = ws;
        hitRect = r;
        hitWordText = w.segment;
        hitWordRange = wr;
        break;
      }
    }
  }
  if (wordStart === -1 || !hitRect) return null;

  if (granularity === "word") {
    return { text: hitWordText, rect: hitRect, range: hitWordRange! };
  }

  if (granularity === "sentence") {
    for (const sent of sentSeg.segment(text)) {
      const ss = sent.index;
      const se = ss + sent.segment.length;
      if (wordStart < ss || wordStart >= se) continue;
      const sentText = sent.segment.trim();
      if (!sentText) return null;
      const sentRange = doc.createRange();
      sentRange.setStart(textNode, ss);
      sentRange.setEnd(textNode, se);
      return { text: sentText, rect: hitRect, range: sentRange };
    }
    return null;
  }

  return paragraphHit(doc, textNode, hitRect);
}

function caretHitAt(doc: Document, x: number, y: number): CaretHit | null {
  const caretDoc = doc as CaretDoc;
  if (caretDoc.caretPositionFromPoint) {
    const p = caretDoc.caretPositionFromPoint(x, y);
    if (p?.offsetNode.nodeType === Node.TEXT_NODE) {
      return { node: p.offsetNode as Text, offset: p.offset };
    }
  }
  if (caretDoc.caretRangeFromPoint) {
    const r = caretDoc.caretRangeFromPoint(x, y);
    if (r?.startContainer.nodeType === Node.TEXT_NODE) {
      return { node: r.startContainer as Text, offset: r.startOffset };
    }
  }
  return null;
}

function textLayerHitAt(doc: Document, x: number, y: number): CaretHit | null {
  const el = doc.elementFromPoint(x, y);
  const textLayerNode = el?.closest?.(".textLayer span, .textLayer");
  if (!textLayerNode) return null;
  const walker = doc.createTreeWalker(textLayerNode, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if ((node.nodeValue ?? "").trim()) {
      return { node: node as Text, offset: null };
    }
    node = walker.nextNode();
  }
  return null;
}

// block-level display 值判断（不含 inline-*）
const BLOCK_RE =
  /^(block|flex|grid|list-item|table(?!-cell\b|-row\b)|table-cell|table-row)$/;

function paragraphHit(
  doc: Document,
  textNode: Text,
  hitRect: DOMRect,
): TextHit | null {
  let el: Element | null = textNode.parentElement;
  const win = doc.defaultView ?? window;
  while (el && el !== doc.documentElement) {
    const display = win.getComputedStyle(el).display;
    if (BLOCK_RE.test(display)) break;
    el = el.parentElement;
  }
  if (!el || el === doc.documentElement || el === doc.body) return null;

  const paraText = (el as HTMLElement).innerText?.trim();
  if (!paraText) return null;

  const paraRange = doc.createRange();
  paraRange.selectNodeContents(el);

  return { text: paraText, rect: hitRect, range: paraRange };
}

// ─── 显示 / 收起 ─────────────────────────────────────

function show(s: State, translation: string, anchor: DOMRect): void {
  const tooltipDocument = s.options.tooltipDocument;
  let el = s.tooltip;
  if (!el) {
    el = tooltipDocument.createElement("div");
    el.setAttribute(s.options.tooltipAttr, "");
    el.style.cssText = [
      "position:fixed",
      "z-index:2147483647",
      "background:#222",
      "color:#fff",
      "padding:6px 8px",
      "border-radius:4px",
      "font-family:system-ui,sans-serif",
      "line-height:1.4",
      "max-width:360px",
      "white-space:pre-wrap",
      "word-break:break-word",
      "pointer-events:none",
      "box-shadow:0 2px 8px rgba(0,0,0,.3)",
    ].join(";");
    (tooltipDocument.body ?? tooltipDocument.documentElement).appendChild(el);
    s.tooltip = el;
  }
  applyTooltipFontSize(s);
  el.textContent = translation;
  s.lastAnchor = anchor;

  el.style.visibility = "hidden";
  el.style.display = "block";
  positionTooltip(el, anchor);
  el.style.visibility = "visible";
}

function positionTooltip(el: HTMLElement, anchor: DOMRect): void {
  const hostWindow = el.ownerDocument.defaultView ?? window;
  const tw = el.offsetWidth;
  const th = el.offsetHeight;
  const vw = hostWindow.innerWidth;
  const vh = hostWindow.innerHeight;
  const margin = 14;

  let left = anchor.left;
  let top = anchor.top - th - margin;
  if (top < 4) top = Math.min(anchor.bottom + margin, vh - th - 4);
  if (left + tw > vw - 4) left = Math.max(4, vw - tw - 4);

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function applyTooltipFontSize(s: State): void {
  const el = s.tooltip;
  if (!el) return;
  el.style.fontSize = `${s.fontSize}px`;
  if (
    s.lastAnchor &&
    el.style.display === "block" &&
    el.style.visibility === "visible"
  ) {
    positionTooltip(el, s.lastAnchor);
  }
}

function dismiss(s: State): void {
  clearTimer(s);
  s.lastText = null;
  s.lastAnchor = null;
  s.seq++;
  clearHighlight(s);
  if (s.tooltip) s.tooltip.style.display = "none";
}

function clearTimer(s: State): void {
  if (s.translateTimer !== null) {
    clearTimeout(s.translateTimer);
    s.translateTimer = null;
  }
}

function isEditable(t: EventTarget | null): boolean {
  const element = asElement(t);
  if (!element) return false;
  const tag = element.tagName?.toUpperCase?.() ?? "";
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  return element.isContentEditable === true;
}

function isOurUi(t: EventTarget | null, tooltipAttr: string): boolean {
  const element = asElement(t);
  if (!element) return false;
  return !!element.closest?.(
    `[${tooltipAttr}],[data-onelingo-host],[${READER_UI_ATTR}]`,
  );
}

function asElement(target: EventTarget | null): ElementLike | null {
  if (!target || typeof target !== "object") return null;
  const value = target as Partial<ElementLike>;
  return value.nodeType === Node.ELEMENT_NODE ? (value as ElementLike) : null;
}

// ─── CSS Custom Highlight ─────────────────────────────

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

function setHighlight(s: State, doc: Document, range: Range): void {
  const reg = getHighlightRegistry(doc);
  if (!reg) return;
  injectHighlightStyle(doc, s.options.highlightName);
  const Ctor = getHighlightCtor(doc);
  if (!Ctor) return;
  if (s.highlightDoc && s.highlightDoc !== doc) {
    getHighlightRegistry(s.highlightDoc)?.delete(s.options.highlightName);
  }
  s.highlightDoc = doc;
  reg.set(s.options.highlightName, new Ctor(range));
}

function clearHighlight(s: State): void {
  if (!s.highlightDoc) return;
  getHighlightRegistry(s.highlightDoc)?.delete(s.options.highlightName);
  s.highlightDoc = null;
}

function injectHighlightStyle(doc: Document, highlightName: string): void {
  if (doc.querySelector(`style[${HIGHLIGHT_STYLE_ATTR}="${highlightName}"]`)) {
    return;
  }
  const style = doc.createElement("style");
  style.setAttribute(HIGHLIGHT_STYLE_ATTR, highlightName);
  style.textContent =
    `::highlight(${highlightName}){` +
    "text-decoration:underline solid #aaa;" +
    "text-decoration-thickness:1px;" +
    "text-underline-offset:2px}";
  (doc.head ?? doc.documentElement).appendChild(style);
}
