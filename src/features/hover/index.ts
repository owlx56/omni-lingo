// 悬停翻译最小闭环。热路径，保持 vanilla、零框架。
//
// 粒度（hoverGranularity）：
//   word      — word 几何校验 → 直接返回命中词
//   sentence  — word 几何校验 → sentence segmenter 取句（文本节点内）
//   paragraph — word 几何校验 → 找最近 block 祖先 → innerText 整段
//
// 缓存共用：key = engine|src|tgt|text，全文翻译按相同粒度拆句即可命中。

import { sendMessage } from "@/lib/messaging";
import {
  getSettings,
  watchSettings,
  type HoverGranularity,
} from "@/lib/storage/settings";

const DWELL_MS = 1;
const TOOLTIP_ATTR = "data-onelingo-tooltip";
const HIGHLIGHT_NAME = "onelingo-hover";

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

interface TextHit {
  text: string; // 翻译单元（句子 or 段落）
  rect: DOMRect; // 词位置（tooltip 锚点）
  range: Range; // 高亮范围
}

interface State {
  target: string;
  engine: string;
  granularity: HoverGranularity;
  dwellTimer: number | null;
  lastText: string | null; // 上次翻译的文本（去重）
  pendingX: number;
  pendingY: number;
  tooltip: HTMLDivElement | null;
  seq: number;
  wordSegmenter: Intl.Segmenter;
  sentenceSegmenter: Intl.Segmenter;
}

export function initHover(): void {
  const state: State = {
    target: "zh",
    engine: "google",
    granularity: "sentence",
    dwellTimer: null,
    lastText: null,
    pendingX: 0,
    pendingY: 0,
    tooltip: null,
    seq: 0,
    wordSegmenter: new Intl.Segmenter(undefined, { granularity: "word" }),
    sentenceSegmenter: new Intl.Segmenter(undefined, {
      granularity: "sentence",
    }),
  };

  void getSettings().then((s) => {
    state.target = s.targetLang;
    state.engine = s.engines.hover;
    state.granularity = s.hoverGranularity;
  });
  watchSettings((s) => {
    state.target = s.targetLang;
    state.engine = s.engines.hover;
    state.granularity = s.hoverGranularity;
  });

  document.addEventListener("mousemove", (e) => onMove(e, state), {
    passive: true,
  });
  document.addEventListener("mouseleave", () => dismiss(state));
  document.addEventListener("scroll", () => dismiss(state), { passive: true });
}

function onMove(e: MouseEvent, s: State): void {
  if (isEditable(e.target) || isOurUi(e.target)) {
    dismiss(s);
    return;
  }
  s.pendingX = e.clientX;
  s.pendingY = e.clientY;
  clearTimer(s);
  s.dwellTimer = window.setTimeout(() => fire(s), DWELL_MS);
}

function fire(s: State): void {
  s.dwellTimer = null;
  const hit = hitAt(
    s.pendingX,
    s.pendingY,
    s.wordSegmenter,
    s.sentenceSegmenter,
    s.granularity,
  );
  if (!hit) {
    dismiss(s);
    return;
  }
  if (hit.text === s.lastText) return; // 同一翻译单元内移动不重发
  s.lastText = hit.text;
  const mySeq = ++s.seq;

  setHighlight(hit.range);
  const anchor = hit.rect;

  sendMessage("translate", {
    text: hit.text,
    target: s.target,
    engine: s.engine,
  })
    .then((res) => {
      if (mySeq !== s.seq) return;
      show(s, res.text, anchor);
    })
    .catch((e: unknown) => {
      console.warn("[OneLingo] hover translate failed:", e);
      if (mySeq === s.seq) dismiss(s);
    });
}

// ─── 取词 / 句 / 段 ──────────────────────────────────

function hitAt(
  x: number,
  y: number,
  wordSeg: Intl.Segmenter,
  sentSeg: Intl.Segmenter,
  granularity: HoverGranularity,
): TextHit | null {
  // 1. caret API 找文本节点 + offset
  const doc = document as CaretDoc;
  let node: Node | null = null;
  let offset = 0;
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (p) {
      node = p.offsetNode;
      offset = p.offset;
    }
  } else if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const textNode = node as Text;
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
    if (offset < ws || offset > we) continue;

    const wr = document.createRange();
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
    break;
  }
  if (wordStart === -1 || !hitRect) return null;

  // 3a. 词模式：几何校验已完成，直接返回命中词
  if (granularity === "word") {
    return { text: hitWordText, rect: hitRect, range: hitWordRange! };
  }

  // 3b. 句子模式：sentence segmenter 在同一文本节点内取句
  if (granularity === "sentence") {
    for (const sent of sentSeg.segment(text)) {
      const ss = sent.index;
      const se = ss + sent.segment.length;
      if (wordStart < ss || wordStart >= se) continue;
      const sentText = sent.segment.trim();
      if (!sentText) return null;
      const sentRange = document.createRange();
      sentRange.setStart(textNode, ss);
      sentRange.setEnd(textNode, se);
      return { text: sentText, rect: hitRect, range: sentRange };
    }
    return null;
  }

  // 3c. 段落模式：找最近 block 祖先，取 innerText
  return paragraphHit(textNode, hitRect);
}

// block-level display 值判断（不含 inline-*）
const BLOCK_RE =
  /^(block|flex|grid|list-item|table(?!-cell\b|-row\b)|table-cell|table-row)$/;

function paragraphHit(textNode: Text, hitRect: DOMRect): TextHit | null {
  let el: Element | null = textNode.parentElement;
  while (el && el !== document.documentElement) {
    const display = window.getComputedStyle(el).display;
    if (BLOCK_RE.test(display)) break;
    el = el.parentElement;
  }
  if (!el || el === document.documentElement || el === document.body)
    return null;

  const paraText = (el as HTMLElement).innerText?.trim();
  if (!paraText) return null;

  const paraRange = document.createRange();
  paraRange.selectNodeContents(el);

  return { text: paraText, rect: hitRect, range: paraRange };
}

// ─── 显示 / 收起 ─────────────────────────────────────

function show(s: State, translation: string, anchor: DOMRect): void {
  let el = s.tooltip;
  if (!el) {
    el = document.createElement("div");
    el.setAttribute(TOOLTIP_ATTR, "");
    el.style.cssText = [
      "position:fixed",
      "z-index:2147483647",
      "background:#222",
      "color:#fff",
      "padding:6px 8px",
      "border-radius:4px",
      "font:12px/1.4 system-ui,sans-serif",
      "max-width:360px",
      "white-space:pre-wrap",
      "word-break:break-word",
      "pointer-events:none",
      "box-shadow:0 2px 8px rgba(0,0,0,.3)",
    ].join(";");
    document.body.appendChild(el);
    s.tooltip = el;
  }
  el.textContent = translation;

  el.style.visibility = "hidden";
  el.style.display = "block";
  const tw = el.offsetWidth;
  const th = el.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 14;

  let left = anchor.left;
  let top = anchor.top - th - margin;
  if (top < 4) top = Math.min(anchor.bottom + margin, vh - th - 4);
  if (left + tw > vw - 4) left = Math.max(4, vw - tw - 4);

  el.style.left = left + "px";
  el.style.top = top + "px";
  el.style.visibility = "visible";
}

function dismiss(s: State): void {
  clearTimer(s);
  s.lastText = null;
  s.seq++;
  clearHighlight();
  if (s.tooltip) s.tooltip.style.display = "none";
}

function clearTimer(s: State): void {
  if (s.dwellTimer !== null) {
    clearTimeout(s.dwellTimer);
    s.dwellTimer = null;
  }
}

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  return (t as HTMLElement).isContentEditable;
}

function isOurUi(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  return !!t.closest("[data-onelingo-tooltip],[data-onelingo-host]");
}

// ─── CSS Custom Highlight ─────────────────────────────

let highlightStyleInjected = false;

function getRegistry(): HighlightRegistry | null {
  return (CSS as CSSWithHighlights).highlights ?? null;
}

function setHighlight(range: Range): void {
  const reg = getRegistry();
  if (!reg) return;
  injectHighlightStyle();
  const Ctor = (globalThis as { Highlight?: HighlightCtor }).Highlight;
  if (!Ctor) return;
  reg.set(HIGHLIGHT_NAME, new Ctor(range));
}

function clearHighlight(): void {
  const reg = getRegistry();
  if (!reg) return;
  reg.delete(HIGHLIGHT_NAME);
}

function injectHighlightStyle(): void {
  if (highlightStyleInjected) return;
  const style = document.createElement("style");
  style.setAttribute("data-onelingo-hl", "");
  style.textContent =
    `::highlight(${HIGHLIGHT_NAME}){` +
    `text-decoration:underline solid #aaa;` +
    `text-decoration-thickness:1px;` +
    `text-underline-offset:6px}`;
  (document.head ?? document.documentElement).appendChild(style);
  highlightStyleInjected = true;
}
