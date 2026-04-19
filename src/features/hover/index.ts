// 悬停翻译最小闭环。热路径，保持 vanilla、零框架。
//
// 策略：mousemove 只重置 dwell timer（不做昂贵计算）；timer 触发时
// 用最后的坐标取词、发 RPC、显译文。换词即重启；离开或进入可编辑
// 区则 dismiss。暂无 Shadow DOM。

import { sendMessage } from "@/lib/messaging";
import { getSettings, watchSettings } from "@/lib/storage/settings";

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

// CSS Custom Highlight API 的最小类型占位。TS lib 里还没完全稳定，
// 用窄声明避免 any，Firefox 无此 API 时优雅降级。
type HighlightCtor = new (range: Range) => unknown;
type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void };
type CSSWithHighlights = typeof CSS & { highlights?: HighlightRegistry };

interface WordHit {
  text: string;
  rect: DOMRect;
  range: Range;
}

interface State {
  target: string;
  dwellTimer: number | null;
  lastWord: string | null;
  pendingX: number;
  pendingY: number;
  tooltip: HTMLDivElement | null;
  seq: number;
  segmenter: Intl.Segmenter;
}

export function initHover(): void {
  const state: State = {
    target: "zh",
    dwellTimer: null,
    lastWord: null,
    pendingX: 0,
    pendingY: 0,
    tooltip: null,
    seq: 0,
    segmenter: new Intl.Segmenter(undefined, { granularity: "word" }),
  };

  void getSettings().then((s) => (state.target = s.targetLang));
  watchSettings((s) => (state.target = s.targetLang));

  document.addEventListener("mousemove", (e) => onMove(e, state), {
    passive: true,
  });
  document.addEventListener("mouseleave", () => dismiss(state));
  document.addEventListener("scroll", () => dismiss(state), { passive: true });
}

function onMove(e: MouseEvent, s: State): void {
  if (isEditable(e.target)) {
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
  const hit = wordAt(s.pendingX, s.pendingY, s.segmenter);
  if (!hit) {
    dismiss(s);
    return;
  }
  if (hit.text === s.lastWord) return;
  s.lastWord = hit.text;
  const mySeq = ++s.seq;

  // 先显下划线反馈"识别到了"，再等译文
  setHighlight(hit.range);
  const anchor = hit.rect;

  sendMessage("translate", { text: hit.text, target: s.target })
    .then((res) => {
      if (mySeq !== s.seq) return;
      show(s, res.text, anchor);
    })
    .catch((e: unknown) => {
      console.warn("[OneLingo] hover translate failed:", e);
      if (mySeq === s.seq) dismiss(s);
    });
}

function wordAt(
  x: number,
  y: number,
  seg: Intl.Segmenter,
): WordHit | null {
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

  for (const s of seg.segment(text)) {
    if (!s.isWordLike) continue;
    const start = s.index;
    const end = start + s.segment.length;
    if (offset < start || offset > end) continue;

    // caret API 会把词右侧空白吸附到词末尾 offset，必须用真实几何再校验一次。
    // 跨行词有多个 rect，命中哪个用哪个。
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    const rects = range.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (!r) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return { text: s.segment, rect: r, range };
      }
    }
    return null;
  }
  return null;
}

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
      "max-width:320px",
      "pointer-events:none",
      "box-shadow:0 2px 8px rgba(0,0,0,.3)",
    ].join(";");
    document.body.appendChild(el);
    s.tooltip = el;
  }
  el.textContent = translation;

  // 先隐形放上去量尺寸，避免闪一下再定位
  el.style.visibility = "hidden";
  el.style.display = "block";
  const tw = el.offsetWidth;
  const th = el.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 14;

  // 默认在词上方；上面放不下就翻到下方；水平超出视口就左移
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
  s.lastWord = null;
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

// ---------- CSS Custom Highlight ----------

let highlightStyleInjected = false;

function getRegistry(): HighlightRegistry | null {
  const c = CSS as CSSWithHighlights;
  return c.highlights ?? null;
}

function setHighlight(range: Range): void {
  const reg = getRegistry();
  if (!reg) return; // Firefox 没实现，先静默降级
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
