// 划词翻译。独立于 hover 路径。
//
// Saladict 模式：
//   mouseup 有选区 → 立刻发翻译请求（结果进缓存）+ 显 logo
//   logo mouseenter → 等 500ms（结果大概率已到）→ 弹卡片
//   500ms 内 mouseleave → 取消，logo 留
//   logo click → 立刻弹卡片（同 Saladict BOWL_ACTIVATED）
//   卡片出现后 logo 立刻消失（卡片留，点空白才收）
//
// 翻译提前发出的好处：hover 确认时大概率命中缓存，卡片瞬间出，无需 spinner。

import { sendMessage } from "@/lib/messaging";
import {
  getSettings,
  resolveTargetLang,
  watchSettings,
} from "@/lib/storage/settings";
import { getHost, getShadowRoot } from "@/ui/shadow-root";
import { mountCard } from "./SelectionCard";
import { setSelText, setSelTarget, setSelResult } from "./card-store";

const LOGO_ATTR = "data-onelingo-logo";
const CARD_ATTR = "data-onelingo-selcard";
const LOGO_SIZE = 30; // 与 Saladict SaladBowl 保持一致
const LOGO_OFFSET_X = 6;
const LOGO_OFFSET_Y = -(LOGO_SIZE + 4);
const HOVER_CONFIRM_MS = 500; // mouseenter → 弹卡片延迟
const LEAVE_CONFIRM_MS = 100; // mouseleave → 取消延迟（防鼠标划过抖动）

interface State {
  enabled: boolean;
  target: string;
  engine: string;
  logo: HTMLButtonElement | null;
  card: HTMLDivElement | null;
  cardMounted: boolean;
  lastText: string;
  result: string | null;
  seq: number;
  enterTimer: number | null;
  leaveTimer: number | null; // 100ms 离开确认
  cardVisible: boolean;
  logoLeft: number;
  logoTop: number;
}

export function initSelection(): void {
  const s: State = {
    enabled: false,
    target: "zh",
    engine: "google",
    logo: null,
    card: null,
    cardMounted: false,
    lastText: "",
    result: null,
    seq: 0,
    enterTimer: null,
    leaveTimer: null,
    cardVisible: false,
    logoLeft: 0,
    logoTop: 0,
  };

  void getSettings().then((cfg) => {
    s.enabled = cfg.selectionEnabled;
    const target = resolveTargetLang(cfg.selectionTargetLang, cfg.uiLang);
    s.target = target;
    s.engine = cfg.engines.selection;
    setSelTarget(target);
    if (!s.enabled) hide(s);
  });
  watchSettings((cfg) => {
    s.enabled = cfg.selectionEnabled;
    const target = resolveTargetLang(cfg.selectionTargetLang, cfg.uiLang);
    s.target = target;
    s.engine = cfg.engines.selection;
    setSelTarget(target);
    if (!s.enabled) hide(s);
  });

  // ★ 关键修复：shadow DOM 内的 mouseup retarget 到 host，
  //   必须在这里拦截，否则会把卡片内选文当成新划词、或让 logo 跳位。
  document.addEventListener("mouseup", (e) => {
    const h = getHost();
    if (h && e.target === h) return;
    window.setTimeout(() => onMouseUp(e, s), 0);
  });

  document.addEventListener(
    "mousedown",
    (e) => {
      const h = getHost();
      if (h && e.target === h) return;
      hide(s);
    },
    { capture: true },
  );

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide(s);
  });
}

// ─── 选区 ─────────────────────────────────────────────

function onMouseUp(e: MouseEvent, s: State): void {
  if (!s.enabled) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const text = sel.toString().trim();
  if (!text || isInEditable(sel.anchorNode)) return;

  s.seq++;
  s.result = null;
  s.lastText = text;
  s.cardVisible = false;
  clearEnterTimer(s);
  if (s.card) s.card.style.display = "none";

  setSelText(text);
  setSelResult(null);
  setSelTarget(s.target);

  const mySeq = s.seq;
  void sendMessage("translate", { text, target: s.target, engine: s.engine })
    .then((res) => {
      if (mySeq !== s.seq) return;
      s.result = res.text;
      setSelResult(res.text);
    })
    .catch((err) => {
      console.warn("[OneLingo] selection translate failed:", err);
    });

  showLogo(s, e.clientX, e.clientY);
}

// ─── Logo ─────────────────────────────────────────────

// 只注入一次动画样式到 shadow root
let logoStyleInjected = false;
function injectLogoStyle(): void {
  if (logoStyleInjected) return;
  logoStyleInjected = true;
  const style = document.createElement("style");
  // prettier-ignore
  style.textContent = `
    /* ── 入场：果冻弹出（直接移植 Saladict saladbowl-jelly） ── */
    @keyframes onelingo-jelly {
         0% { transform: matrix3d(0.500,0,0,0,0,0.500,0,0,0,0,1,0,0,0,0,1); }
      3.40% { transform: matrix3d(0.658,0,0,0,0,0.703,0,0,0,0,1,0,0,0,0,1); }
      4.70% { transform: matrix3d(0.725,0,0,0,0,0.800,0,0,0,0,1,0,0,0,0,1); }
      6.81% { transform: matrix3d(0.830,0,0,0,0,0.946,0,0,0,0,1,0,0,0,0,1); }
      9.41% { transform: matrix3d(0.942,0,0,0,0,1.084,0,0,0,0,1,0,0,0,0,1); }
     10.21% { transform: matrix3d(0.971,0,0,0,0,1.113,0,0,0,0,1,0,0,0,0,1); }
     13.61% { transform: matrix3d(1.062,0,0,0,0,1.166,0,0,0,0,1,0,0,0,0,1); }
     14.11% { transform: matrix3d(1.070,0,0,0,0,1.165,0,0,0,0,1,0,0,0,0,1); }
     17.52% { transform: matrix3d(1.104,0,0,0,0,1.120,0,0,0,0,1,0,0,0,0,1); }
     18.72% { transform: matrix3d(1.106,0,0,0,0,1.094,0,0,0,0,1,0,0,0,0,1); }
     21.32% { transform: matrix3d(1.098,0,0,0,0,1.035,0,0,0,0,1,0,0,0,0,1); }
     24.32% { transform: matrix3d(1.075,0,0,0,0,0.980,0,0,0,0,1,0,0,0,0,1); }
     25.23% { transform: matrix3d(1.067,0,0,0,0,0.969,0,0,0,0,1,0,0,0,0,1); }
     29.03% { transform: matrix3d(1.031,0,0,0,0,0.948,0,0,0,0,1,0,0,0,0,1); }
     29.93% { transform: matrix3d(1.024,0,0,0,0,0.949,0,0,0,0,1,0,0,0,0,1); }
     35.54% { transform: matrix3d(0.990,0,0,0,0,0.981,0,0,0,0,1,0,0,0,0,1); }
     36.74% { transform: matrix3d(0.986,0,0,0,0,0.989,0,0,0,0,1,0,0,0,0,1); }
     41.04% { transform: matrix3d(0.980,0,0,0,0,1.011,0,0,0,0,1,0,0,0,0,1); }
     44.44% { transform: matrix3d(0.983,0,0,0,0,1.016,0,0,0,0,1,0,0,0,0,1); }
     52.15% { transform: matrix3d(0.996,0,0,0,0,1.003,0,0,0,0,1,0,0,0,0,1); }
     59.86% { transform: matrix3d(1.003,0,0,0,0,0.995,0,0,0,0,1,0,0,0,0,1); }
     63.26% { transform: matrix3d(1.004,0,0,0,0,0.996,0,0,0,0,1,0,0,0,0,1); }
     75.28% { transform: matrix3d(1.001,0,0,0,0,1.002,0,0,0,0,1,0,0,0,0,1); }
     85.49% { transform: matrix3d(0.999,0,0,0,0,1.000,0,0,0,0,1,0,0,0,0,1); }
     90.69% { transform: matrix3d(1.000,0,0,0,0,1.000,0,0,0,0,1,0,0,0,0,1); }
       100% { transform: matrix3d(1.000,0,0,0,0,1.000,0,0,0,0,1,0,0,0,0,1); }
    }
    /* ── hover 分部件动效（移植自 Saladict SaladBowl.shadow.scss） ── */
    @keyframes saladbowl-orange-spin {
      from { transform: rotate(  0deg); }
        to { transform: rotate(360deg); }
    }
    @keyframes saladbowl-leaf-shake {
        0% { transform: translate( 2px,  1px) rotate(0deg); }
       10% { transform: translate(-1px, -2px) rotate(1deg); }
       20% { transform: translate(-2px,  0  ) rotate(1deg); }
       30% { transform: translate( 0  ,  2px) rotate(0deg); }
       40% { transform: translate( 1px, -1px) rotate(1deg); }
       50% { transform: translate(-1px,  2px) rotate(1deg); }
       60% { transform: translate(-2px,  1px) rotate(0deg); }
       70% { transform: translate( 2px,  1px) rotate(1deg); }
       80% { transform: translate(-1px, -1px) rotate(1deg); }
       90% { transform: translate( 2px,  2px) rotate(0deg); }
      100% { transform: translate( 1px, -2px) rotate(1deg); }
    }
    @keyframes saladbowl-tomato-shake {
        0% { transform: rotate(10deg); }
       30% { transform: rotate( 0deg); }
       60% { transform: rotate(10deg); }
       90% { transform: rotate( 0deg); }
      100% { transform: rotate( 5deg); }
    }
    [data-onelingo-logo]:hover .saladbowl-leaf {
      animation: saladbowl-leaf-shake 0.7s infinite linear;
    }
    [data-onelingo-logo]:hover .saladbowl-orange {
      transform-origin: 301.8px 187.4px;
      animation: saladbowl-orange-spin 0.7s infinite linear;
    }
    [data-onelingo-logo]:hover .saladbowl-tomato {
      transform-origin: 297.8px 126.4px;
      animation: saladbowl-tomato-shake 0.7s infinite linear;
    }
  `;
  getShadowRoot().appendChild(style);
}

function showLogo(s: State, mouseX: number, mouseY: number): void {
  injectLogoStyle();
  let el = s.logo;
  if (!el) {
    el = document.createElement("button");
    el.setAttribute(LOGO_ATTR, "");
    el.style.cssText = [
      "all:unset",
      "position:fixed",
      "z-index:2147483647",
      `width:${LOGO_SIZE}px`,
      `height:${LOGO_SIZE}px`,
      "cursor:pointer",
      "user-select:none",
      "background:transparent",
    ].join(";");
    // Saladict SaladBowl SVG（viewBox 612×612，直接移植）
    el.innerHTML = `<svg viewBox="0 0 612 612" width="${LOGO_SIZE}" height="${LOGO_SIZE}" style="display:block">
      <g class="saladbowl-leaf">
        <path fill="#6bbc57" d="M 577.557 184.258 C 560.417 140.85 519.54 59.214 519.54 59.214 L 519.543 59.204 C 519.543 59.204 436.903 97.626 396.441 120.878 C 366.171 138.274 354.981 169.755 352.221 177.621 C 349.001 186.851 339.891 228.811 358.341 268.481 C 382.271 319.921 409.201 374.521 409.201 374.521 L 409.201 374.531 C 409.201 374.531 464.511 348.701 515.291 323.401 C 554.451 303.891 573.591 265.441 576.821 256.221 C 579.571 248.356 590.398 216.746 577.574 184.271 Z"/>
        <path fill="#bde9b7" d="M 501.052 102.162 L 507.518 104.425 L 426.69 335.38 L 420.224 333.117 Z"/>
      </g>
      <g class="saladbowl-orange">
        <circle fill="#ffb30d" cx="299.756" cy="198.246" r="178.613"/>
        <circle fill="#fce29c" cx="299.756" cy="198.246" r="155.24"/>
        <path fill="#fcc329" d="M 299.756 189.873 L 341.269 113.475 C 349.169 82.543 324.349 58.588 299.749 57.891 C 275.149 57.201 248.229 82.781 256.489 113.481 L 299.749 189.881 Z M 307.026 194.757 L 393.974 194.757 C 424.928 187.083 434.124 153.681 422.994 131.737 C 411.864 109.795 376.534 98.357 353.5 120.27 L 307.025 194.757 Z M 308.79 203.444 L 354.885 277.168 C 377.925 299.268 410.995 289.438 423.701 268.368 C 436.411 247.298 427.381 211.276 396.591 203.362 L 308.801 203.442 Z M 300.208 206.618 L 259.628 283.516 C 252.098 314.543 277.214 338.193 301.815 338.591 C 326.415 338.991 353.022 313.081 344.392 282.491 L 300.208 206.631 Z M 292.058 203.3 L 205.108 203.415 C 174.163 211.277 165.014 244.54 176.172 266.468 C 187.33 288.396 226.052 300.541 249.056 278.598 L 292.056 203.301 Z M 292.465 194.83 L 246.497 121.024 C 223.494 98.884 190.409 108.658 177.667 129.706 C 164.925 150.753 173.893 186.791 204.669 194.756 L 292.459 194.829 Z"/>
      </g>
      <g class="saladbowl-tomato">
        <path fill="#a63131" d="M 71.014 337.344 C 147.291 422.594 278.234 429.866 363.482 353.589 L 87.258 44.87 C 2.01 121.15 -5.262 252.092 71.014 337.342 Z"/>
        <path fill="#bc5757" d="M 101.447 310.115 C 162.685 378.555 267.811 384.393 336.251 323.155 L 114.49 75.31 C 46.047 136.55 40.21 241.674 101.447 310.115 Z"/>
        <path fill="#f1d4af" d="M 186.412 237.54 L 151.659 245.444 C 139.989 251.384 139.339 265.51 145.779 273.27 C 152.219 281.028 167.379 282.39 174.599 271.538 L 186.399 237.54 Z M 242.062 269.832 L 223.366 300.175 C 219.439 312.658 229.066 323.018 239.116 323.85 C 249.168 324.685 260.756 314.815 258.061 302.065 L 242.061 269.832 Z M 160.202 178.317 L 130.357 158.837 C 117.98 154.585 107.375 163.939 106.277 173.965 C 105.183 183.99 114.747 195.833 127.563 193.471 L 160.203 178.321 Z"/>
      </g>
      <g class="saladbowl-bowl">
        <path fill="#2d97b7" d="M 30.857 311.46 C 30.857 429.87 105.371 530.8 209.867 569.52 L 209.867 589.2 L 400.987 589.2 L 400.987 568.9 C 503.595 530.114 576.887 431.202 578.31 314.907 L 589.196 295.97 L 22.804 295.97 L 30.867 309.998 C 30.865 310.488 30.857 310.971 30.857 311.458 Z"/>
        <path fill="#fff" d="M 540.565 321.42 C 540.585 322.587 540.595 323.755 540.595 324.927 C 540.595 405.941 497.513 476.884 433.015 516.122 L 437.178 523.317 C 504.152 482.64 548.895 409.009 548.895 324.927 C 548.895 323.757 548.885 322.587 548.865 321.419 Z M 399.885 532.68 C 388.298 537.31 376.237 541.002 363.793 543.654 L 363.793 544.45 L 364.971 551.893 C 378.481 549.049 391.551 545.018 404.081 539.935 Z"/>
      </g>
    </svg>`;
    el.addEventListener("mouseenter", () => onLogoEnter(s));
    el.addEventListener("mouseleave", () => onLogoLeave(s));
    el.addEventListener("mousedown", (e) => e.preventDefault());
    // ★ 点击立刻弹卡片，同 Saladict BOWL_ACTIVATED
    el.addEventListener("click", () => {
      clearEnterTimer(s);
      openCard(s);
    });
    getShadowRoot().appendChild(el);
    s.logo = el;
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = mouseX + LOGO_OFFSET_X;
  let top = mouseY + LOGO_OFFSET_Y;
  if (top < 4) top = mouseY + 4;
  if (left + LOGO_SIZE > vw - 4) left = vw - LOGO_SIZE - 4;
  if (top + LOGO_SIZE > vh - 4) top = vh - LOGO_SIZE - 4;
  left = Math.max(4, left);

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.display = "block";
  s.logoLeft = left;
  s.logoTop = top;

  // 每次显示都重放果冻入场动画（display:none→block 不会自动重置 inline animation）
  el.style.animation = "none";
  void el.offsetWidth; // 触发 reflow，让浏览器认为动画被中断
  el.style.animation = "onelingo-jelly 1s linear";
}

function onLogoEnter(s: State): void {
  if (s.cardVisible) return;
  clearLeaveTimer(s); // 取消正在倒计的离开确认
  clearEnterTimer(s); // 重新从 0 开始计入场延迟
  s.enterTimer = window.setTimeout(() => {
    s.enterTimer = null;
    openCard(s);
  }, HOVER_CONFIRM_MS);
}

function onLogoLeave(s: State): void {
  // 不立刻取消：等 100ms 确认真的离开了，再撤销 enter 计时器
  // 这样鼠标在 logo 边缘抖动时不会反复重置 500ms 计时器
  clearLeaveTimer(s);
  s.leaveTimer = window.setTimeout(() => {
    s.leaveTimer = null;
    clearEnterTimer(s);
  }, LEAVE_CONFIRM_MS);
}

// ─── Card ─────────────────────────────────────────────

function openCard(s: State): void {
  if (s.cardVisible) return;
  s.cardVisible = true;
  // logo 立刻退场（Saladict：isShowBowl: false）
  if (s.logo) s.logo.style.display = "none";
  showCard(s);
}

function showCard(s: State): void {
  let el = s.card;
  if (!el) {
    el = document.createElement("div");
    el.setAttribute(CARD_ATTR, "");
    el.style.cssText = [
      "position:fixed",
      "z-index:2147483647",
      "background:#fff",
      "color:#222",
      "padding:10px 12px",
      "border-radius:6px",
      "font:13px/1.5 system-ui,sans-serif",
      "max-width:360px",
      "min-width:80px",
      "border:1px solid #e0e0e0",
      "box-shadow:0 4px 16px rgba(0,0,0,.18)",
    ].join(";");
    // 不拦 mousedown：用户要能在卡片内选文复制
    getShadowRoot().appendChild(el);
    s.card = el;
  }

  if (!s.cardMounted) {
    mountCard(el);
    s.cardMounted = true;
  }

  el.style.visibility = "hidden";
  el.style.display = "block";
  const tw = el.offsetWidth;
  const th = el.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 8;

  let left = s.logoLeft;
  let top = s.logoTop + LOGO_SIZE + margin;
  if (left + tw > vw - 4) left = Math.max(4, vw - tw - 4);
  if (top + th > vh - 4) top = Math.max(4, s.logoTop - th - margin);

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.visibility = "visible";
}

// ─── 收起 ─────────────────────────────────────────────

function hide(s: State): void {
  s.seq++;
  s.result = null;
  s.lastText = "";
  s.cardVisible = false;
  clearEnterTimer(s);
  clearLeaveTimer(s);
  if (s.logo) s.logo.style.display = "none";
  if (s.card) s.card.style.display = "none";
}

function clearEnterTimer(s: State): void {
  if (s.enterTimer !== null) {
    clearTimeout(s.enterTimer);
    s.enterTimer = null;
  }
}

function clearLeaveTimer(s: State): void {
  if (s.leaveTimer !== null) {
    clearTimeout(s.leaveTimer);
    s.leaveTimer = null;
  }
}

// ─── 工具 ─────────────────────────────────────────────

function isInEditable(n: Node | null): boolean {
  let cur: Node | null = n;
  while (cur) {
    if (cur instanceof HTMLElement) {
      const tag = cur.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return true;
      if (cur.isContentEditable) return true;
    }
    cur = cur.parentNode;
  }
  return false;
}
