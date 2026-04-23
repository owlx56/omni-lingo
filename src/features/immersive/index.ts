import {
  onMessage,
  sendMessage,
  type PageTranslateAck,
  type PageTranslateCommand,
  type PageTranslateStatus,
} from "@/lib/messaging";
import {
  isCompactUiBlockCandidate,
  isGithubContentText,
  isGithubUiText,
  isRedditContentText,
  isWikipediaCompactUiText,
  isWikipediaHatnote,
  shouldSkipSiteElement,
} from "./site-rules";

const BLOCK_RE = /^(block|flex|grid|list-item|table(?!-cell\b|-row\b)|table-cell|table-row)$/;
const MIN_TEXT_CHARS = 8;
const MAX_CONCURRENCY = 12;
const FOLLOW_UP_DELAY_MS = 1200;
const NAVIGATION_CHECK_MS = 500;
const NAVIGATION_RETRANSLATE_DELAY_MS = 800;
const TRANSLATION_ATTR = "data-onelingo-immersive";
const ORIGINAL_ATTR = "data-onelingo-original";
const LOADING_ATTR = "data-onelingo-immersive-loading";
const LOADING_STYLE_ID = "onelingo-immersive-loading-style";
const originalTexts = new WeakMap<HTMLElement, string>();
const originalTokens = new WeakMap<HTMLElement, InlineToken[]>();
const appliedKeys = new WeakMap<HTMLElement, string>();
const appliedModes = new WeakMap<HTMLElement, PageTranslateMode>();
const translatedTexts = new WeakMap<HTMLElement, string>();
const translationNodes = new WeakMap<HTMLElement, HTMLElement>();
const loadingNodes = new WeakMap<HTMLElement, HTMLElement>();
const originalWrappers = new WeakMap<HTMLElement, HTMLElement>();
const inlineReplacements = new WeakMap<HTMLElement, InlineReplacement>();
const translatedBlocks = new Set<HTMLElement>();
const loadingBlocks = new Set<HTMLElement>();

let runSeq = 0;
let lastCommandId = 0;
let translating = false;
let currentMode: PageTranslateMode | null = null;
let currentEngine: string | null = null;
let currentTarget: string | null = null;
let lastLocationKey = getLocationKey();
let lastTranslateInput: PageTranslateCommand | null = null;
let navigationTimer: number | undefined;

type PageTranslateMode = NonNullable<PageTranslateCommand["mode"]>;

export function initFullPage(): void {
  installNavigationWatcher();

  onMessage("runPageTranslate", (input) => {
    pruneDisconnectedBlocks();
    if (isStaleCommand(input.commandId)) {
      return { accepted: false, blocks: translatedBlocks.size, active: getStatus().active };
    }
    applyCommandId(input.commandId);

    const mode = input.mode ?? "replace";
    const translationKey = getTranslationKey(input);
    if (canSwitchMode(translationKey)) {
      switchAppliedMode(mode);
      return getAck(true);
    }

    const blocks =
      translatedBlocks.size > 0
        ? Array.from(translatedBlocks).filter((block) => block.isConnected)
        : loadingBlocks.size > 0
          ? Array.from(loadingBlocks).filter((block) => block.isConnected)
        : collectBlocks();
    return startPageTranslate({ ...input, mode }, blocks);
  });

  onMessage("runPageRestore", (input) => {
    if (isStaleCommand(input.commandId)) return getStatus();
    applyCommandId(input.commandId);
    restoreOriginals();
    return getStatus();
  });

  onMessage("readPageTranslateStatus", () => {
    return getStatus();
  });
}

function isStaleCommand(commandId: number | undefined): boolean {
  return commandId !== undefined && commandId < lastCommandId;
}

function applyCommandId(commandId: number | undefined): void {
  if (commandId !== undefined && commandId > lastCommandId) {
    lastCommandId = commandId;
  }
}

async function translateBlocks(
  blocks: HTMLElement[],
  input: PageTranslateCommand,
  seq: number,
): Promise<void> {
  const mode = input.mode ?? "replace";
  const pageKey = getTranslationKey(input);
  let cursor = 0;
  const workers = Math.min(MAX_CONCURRENCY, blocks.length);
  translating = workers > 0;

  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (true) {
        if (seq !== runSeq) return;
        const block = blocks[cursor++];
        if (!block) return;
        if (!block.isConnected) continue;
        if (loadingBlocks.has(block)) continue;

        const original = getOriginalText(block);
        if (!original) continue;

        const appliedKey = getBlockTranslationKey(pageKey, original);
        const cached = translatedTexts.get(block);
        if (cached && appliedKeys.get(block) === appliedKey) {
          const applyMode = currentMode ?? mode;
          // follow-up pass 会回到这里。若已经按当前 mode 渲染过，跳过重建 ——
          // 否则每次都会 removeTranslationNode + appendTranslationNode，
          // 新节点要走 opacity 淡入，观感上就是闪一下。
          if (appliedModes.get(block) !== applyMode) {
            applyTranslation(block, cached, applyMode);
            appliedModes.set(block, applyMode);
          }
          translatedBlocks.add(block);
          continue;
        }

        showLoading(block, currentMode ?? mode, original);
        try {
          const res = await sendMessage("translate", {
            text: original,
            target: input.target,
            engine: input.engine,
          });
          if (seq !== runSeq) return;
          if (!block.isConnected) {
            removeLoading(block);
            continue;
          }
          const applyMode = currentMode ?? mode;
          removeLoading(block);
          translatedTexts.set(block, res.text);
          applyTranslation(block, res.text, applyMode);
          appliedKeys.set(block, appliedKey);
          appliedModes.set(block, applyMode);
          translatedBlocks.add(block);
        } catch (error) {
          if (seq === runSeq) removeLoading(block);
          console.warn("[OneLingo] immersive translate failed:", error);
        }
      }
    }),
  );

  if (seq === runSeq) translating = false;
}

function scheduleFollowUpPass(input: PageTranslateCommand, seq: number): void {
  window.setTimeout(() => {
    if (seq !== runSeq) return;
    const blocks = collectBlocks();
    if (blocks.length === 0) return;
    void translateBlocks(blocks, input, seq).catch((error) => {
      console.warn("[OneLingo] immersive follow-up translate crashed:", error);
    });
  }, FOLLOW_UP_DELAY_MS);
}

function startPageTranslate(
  input: PageTranslateCommand,
  blocks = collectBlocks(),
): PageTranslateAck {
  if (navigationTimer !== undefined) {
    window.clearTimeout(navigationTimer);
    navigationTimer = undefined;
  }

  const mode = input.mode ?? "replace";
  currentMode = mode;
  currentEngine = input.engine;
  currentTarget = input.target;
  lastTranslateInput = {
    target: input.target,
    engine: input.engine,
    mode,
  };

  const seq = ++runSeq;
  clearLoadingBlocks();
  void translateBlocks(blocks, input, seq).catch((error) => {
    console.warn("[OneLingo] immersive translate crashed:", error);
  });
  scheduleFollowUpPass(input, seq);
  return getAck(true, blocks.length);
}

function restoreOriginals(): void {
  runSeq++;
  translating = false;
  currentMode = null;
  currentEngine = null;
  currentTarget = null;
  lastTranslateInput = null;
  if (navigationTimer !== undefined) {
    window.clearTimeout(navigationTimer);
    navigationTimer = undefined;
  }
  restoreTranslatedBlocks();
}

function restoreTranslatedBlocks(): void {
  clearLoadingBlocks();
  for (const block of translatedBlocks) {
    removeTranslationNode(block);
    restoreOriginalDom(block);
    restoreInlineOriginal(block);
    originalTexts.delete(block);
    originalTokens.delete(block);
    appliedModes.delete(block);
  }
  translatedBlocks.clear();
}

function applyTranslation(
  block: HTMLElement,
  translated: string,
  mode: PageTranslateMode,
): void {
  removeLoading(block);
  removeTranslationNode(block);
  restoreInlineOriginal(block);
  restoreOriginalDom(block);

  if (isInlineTranslationTarget(block)) {
    applyInlineTranslation(block, translated);
    return;
  }

  if (mode === "replace" || isCompactBilingualReplacement(block, mode)) {
    hideOriginalDom(block);
    appendTranslationNode(block, translated, "replace");
    return;
  }

  if (appliedModes.get(block) === "replace") {
    restoreOriginalDom(block);
  }

  appendTranslationNode(block, translated, mode);
}

function appendTranslationNode(
  block: HTMLElement,
  translated: string,
  mode: PageTranslateMode,
): void {
  const node = document.createElement("span");
  node.setAttribute(TRANSLATION_ATTR, "true");
  if (mode === "bilingual") {
    // 双语对照模式：译文只作为辅助参考，不需要还原原文的链接 / 加粗结构，
    // 直接用纯文本即可，避免多余的交互元素干扰阅读。
    node.textContent = cleanMarkerJunk(translated);
  } else {
    appendTranslatedContent(node, translated, block);
  }
  node.style.display = "block";
  node.style.marginTop = mode === "bilingual" ? "0.35em" : "0";
  if (mode === "bilingual") node.style.color = "#6b7280";
  node.style.fontSize = mode === "bilingual" ? "0.95em" : "inherit";
  node.style.lineHeight = "1.55";
  block.appendChild(node);
  translationNodes.set(block, node);
}

function removeTranslationNode(block: HTMLElement): void {
  const node = translationNodes.get(block);
  if (node?.isConnected) node.remove();
  translationNodes.delete(block);
}

function showLoading(
  block: HTMLElement,
  mode: PageTranslateMode,
  original: string,
): void {
  ensureLoadingStyles();
  removeLoading(block);
  removeTranslationNode(block);
  restoreInlineOriginal(block);
  translatedBlocks.delete(block);
  appliedModes.delete(block);

  if (isInlineTranslationTarget(block)) {
    applyInlineLoading(block, original);
    return;
  }

  // replace 模式：骨架直接占住原文位置（对齐 Trancy 的 replace 行为）。
  // bilingual 模式：原文保留，下方追加骨架。
  if (mode === "replace" || isCompactBilingualReplacement(block, mode)) {
    hideOriginalDom(block);
    appendLoadingNode(block, original, "replace");
    return;
  }

  restoreOriginalDom(block);
  appendLoadingNode(block, original, "bilingual");
}

function appendLoadingNode(
  block: HTMLElement,
  original: string,
  mode: PageTranslateMode,
): void {
  const node = createLoadingNode(original, false);
  node.style.display = "block";
  node.style.marginTop = mode === "bilingual" ? "0.35em" : "0";
  // 骨架是空的，染色没意义；而且颜色会在"骨架→译文"那瞬间先闪一下再被译文节点接管。
  node.style.fontSize = mode === "bilingual" ? "0.95em" : "inherit";
  node.style.lineHeight = "1.55";
  block.appendChild(node);
  loadingNodes.set(block, node);
  loadingBlocks.add(block);
}

function removeLoading(block: HTMLElement): void {
  const hadLoading = loadingBlocks.has(block);
  const node = loadingNodes.get(block);
  if (node?.isConnected) node.remove();
  loadingNodes.delete(block);
  loadingBlocks.delete(block);
  if (!hadLoading) return;
  restoreInlineOriginal(block);
  restoreOriginalDom(block);
}

function clearLoadingBlocks(): void {
  for (const block of Array.from(loadingBlocks)) {
    removeLoading(block);
  }
}

function createLoadingNode(original: string, inline: boolean): HTMLElement {
  const node = document.createElement("span");
  const palette = getLoadingPalette();
  node.setAttribute(LOADING_ATTR, "true");
  node.setAttribute("aria-busy", "true");
  node.setAttribute("aria-label", "Translating");
  if (inline) node.setAttribute("data-onelingo-loading-inline", "true");
  node.style.setProperty("--onelingo-loading-base", palette.base);
  node.style.setProperty("--onelingo-loading-flow", palette.flow);
  appendLoadingLines(node, original, inline);
  return node;
}

function appendLoadingLines(
  container: HTMLElement,
  original: string,
  inline: boolean,
): void {
  const lineCount = inline ? 1 : getLoadingLineCount(original);
  const seed = getLoadingAnimationSeed(original);
  for (let i = 0; i < lineCount; i++) {
    const line = document.createElement("span");
    line.className = "onelingo-immersive-loading-line";
    line.style.width = inline
      ? getInlineLoadingWidth(original)
      : getBlockLoadingWidth(original, i, lineCount);
    line.style.animationDelay = `${getLoadingAnimationDelay(seed, i)}s`;
    line.style.animationDuration = `${getLoadingAnimationDuration(seed, i)}s`;
    container.appendChild(line);
  }
}

function getLoadingLineCount(text: string): number {
  const length = text.replace(/\s+/g, " ").trim().length;
  if (length < 32) return 1;
  if (length < 110) return 2;
  if (length < 220) return 3;
  return 4;
}

function getBlockLoadingWidth(text: string, index: number, total: number): string {
  if (total === 1) {
    return `${Math.min(Math.max(text.length * 1.7, 18), 72)}%`;
  }
  if (index === total - 1) {
    return `${Math.min(Math.max(38 + (text.length % 28), 34), 72)}%`;
  }
  return index % 2 === 0 ? "100%" : "94%";
}

function getInlineLoadingWidth(text: string): string {
  return `${Math.min(Math.max(text.length * 0.58, 2.4), 12)}em`;
}

function getLoadingAnimationSeed(text: string): number {
  let hash = 0;
  const sample = text.slice(0, 96);
  for (let i = 0; i < sample.length; i++) {
    hash = ((hash * 33) + sample.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function getLoadingAnimationDelay(seed: number, index: number): string {
  return (-0.12 - ((seed + (index * 17)) % 9) * 0.11 - index * 0.09).toFixed(2);
}

function getLoadingAnimationDuration(seed: number, index: number): string {
  return (1.6 + ((seed + (index * 13)) % 5) * 0.12).toFixed(2);
}

function getLoadingPalette(): { base: string; flow: string } {
  if (isDarkSurface()) {
    return {
      base: "rgba(255, 255, 255, 0.09)",
      flow: "rgba(255, 255, 255, 0.18)",
    };
  }
  return {
    base: "rgba(0, 0, 0, 0.055)",
    flow: "rgba(0, 0, 0, 0.11)",
  };
}

function isDarkSurface(): boolean {
  const background = getSurfaceColor(document.body) ?? getSurfaceColor(document.documentElement);
  if (!background) return false;
  const [r, g, b] = background;
  const luminance = ((0.2126 * r) + (0.7152 * g) + (0.0722 * b)) / 255;
  return luminance < 0.45;
}

function getSurfaceColor(el: HTMLElement | null): [number, number, number] | null {
  if (!el) return null;
  const color = parseRgbColor(window.getComputedStyle(el).backgroundColor);
  if (!color) return null;
  const [r, g, b, alpha] = color;
  if (alpha === 0) return null;
  return [r, g, b];
}

function parseRgbColor(value: string): [number, number, number, number] | null {
  const match = value.match(
    /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([0-9.]+))?\s*\)$/i,
  );
  if (!match) return null;
  return [
    Number.parseInt(match[1] ?? "0", 10),
    Number.parseInt(match[2] ?? "0", 10),
    Number.parseInt(match[3] ?? "0", 10),
    match[4] ? Number.parseFloat(match[4]) : 1,
  ];
}

function ensureLoadingStyles(): void {
  if (document.getElementById(LOADING_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = LOADING_STYLE_ID;
  style.textContent = `
[${LOADING_ATTR}] {
  contain: content;
  pointer-events: none;
  user-select: none;
}
[${LOADING_ATTR}] .onelingo-immersive-loading-line {
  display: block;
  height: 0.92em;
  min-height: 0.72rem;
  margin: 0.38em 0;
  border-radius: 0;
  background-color: var(--onelingo-loading-base);
  background-image: linear-gradient(
    90deg,
    var(--onelingo-loading-base) 0%,
    var(--onelingo-loading-base) 34%,
    var(--onelingo-loading-flow) 49%,
    var(--onelingo-loading-base) 64%,
    var(--onelingo-loading-base) 100%
  );
  background-position: 120% 0;
  background-size: 260% 100%;
  animation: onelingo-immersive-loading-flow 2s linear infinite;
  overflow: hidden;
}
[${LOADING_ATTR}][data-onelingo-loading-inline="true"] {
  display: inline-block;
  vertical-align: -0.08em;
}
[${LOADING_ATTR}][data-onelingo-loading-inline="true"] .onelingo-immersive-loading-line {
  height: 0.9em;
  margin: 0 0.12em;
}
@keyframes onelingo-immersive-loading-flow {
  to {
    background-position: -120% 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  [${LOADING_ATTR}] .onelingo-immersive-loading-line {
    animation: none;
    background-position: 50% 0;
  }
}
`;
  (document.head ?? document.documentElement).appendChild(style);
}

function hideOriginalDom(block: HTMLElement): void {
  const existing = originalWrappers.get(block);
  if (existing?.isConnected) {
    hideElement(existing);
    return;
  }

  const wrapper = document.createElement("span");
  wrapper.setAttribute(ORIGINAL_ATTR, "true");
  hideElement(wrapper);
  while (block.firstChild) {
    wrapper.appendChild(block.firstChild);
  }
  block.appendChild(wrapper);
  originalWrappers.set(block, wrapper);
}

function restoreOriginalDom(block: HTMLElement): void {
  const wrapper = originalWrappers.get(block);
  if (!wrapper) return;

  while (wrapper.firstChild) {
    block.insertBefore(wrapper.firstChild, wrapper);
  }
  wrapper.remove();
  originalWrappers.delete(block);
}

function getStatus(): PageTranslateStatus {
  checkLocationChange();
  pruneDisconnectedBlocks();
  return {
    active: translatedBlocks.size > 0 || loadingBlocks.size > 0 || translating,
    translating,
    blocks: translatedBlocks.size + loadingBlocks.size,
    mode: currentMode ?? undefined,
    engine: currentEngine ?? undefined,
    target: currentTarget ?? undefined,
  };
}

function getAck(accepted: boolean, blocks = translatedBlocks.size): PageTranslateAck {
  return {
    ...getStatus(),
    accepted,
    blocks,
    active: blocks > 0 || translatedBlocks.size > 0 || loadingBlocks.size > 0 || translating,
  };
}

function getTranslationKey(input: PageTranslateCommand): string {
  return `${input.engine}|${input.target}`;
}

function getBlockTranslationKey(pageKey: string, original: string): string {
  return `${pageKey}|${original}`;
}

function canSwitchMode(translationKey: string): boolean {
  pruneDisconnectedBlocks();
  return (
    translatedBlocks.size > 0 &&
    currentEngine !== null &&
    currentTarget !== null &&
    translationKey === `${currentEngine}|${currentTarget}`
  );
}

function switchAppliedMode(mode: PageTranslateMode): void {
  pruneDisconnectedBlocks();
  currentMode = mode;
  if (currentEngine !== null && currentTarget !== null) {
    lastTranslateInput = {
      target: currentTarget,
      engine: currentEngine,
      mode,
    };
  }
  for (const block of translatedBlocks) {
    const translated = translatedTexts.get(block);
    if (!translated || !block.isConnected) continue;
    applyTranslation(block, translated, mode);
    appliedModes.set(block, mode);
  }
  for (const block of Array.from(loadingBlocks)) {
    const original = originalTexts.get(block);
    if (!original || !block.isConnected) continue;
    showLoading(block, mode, original);
  }
}

function installNavigationWatcher(): void {
  window.setInterval(checkLocationChange, NAVIGATION_CHECK_MS);
  window.addEventListener("hashchange", checkLocationChange, true);
  window.addEventListener("popstate", checkLocationChange, true);
  document.addEventListener("turbo:load", checkLocationChange, true);
  document.addEventListener("turbo:render", checkLocationChange, true);
  document.addEventListener("pjax:end", checkLocationChange, true);
}

function checkLocationChange(): void {
  const locationKey = getLocationKey();
  if (locationKey === lastLocationKey) return;
  lastLocationKey = locationKey;
  handleSoftNavigation();
}

function getLocationKey(): string {
  return `${window.location.origin}${window.location.pathname}${window.location.search}`;
}

function handleSoftNavigation(): void {
  const input = lastTranslateInput;
  pruneDisconnectedBlocks();
  if (!input) {
    return;
  }

  runSeq++;
  translating = false;
  restoreTranslatedBlocks();

  if (navigationTimer !== undefined) window.clearTimeout(navigationTimer);
  navigationTimer = window.setTimeout(() => {
    navigationTimer = undefined;
    if (!lastTranslateInput) return;
    const blocks = collectBlocks();
    if (blocks.length === 0) return;
    startPageTranslate(lastTranslateInput, blocks);
  }, NAVIGATION_RETRANSLATE_DELAY_MS);
}

function pruneDisconnectedBlocks(): void {
  for (const block of translatedBlocks) {
    if (block.isConnected) continue;
    removeTranslationNode(block);
    restoreOriginalDom(block);
    restoreInlineOriginal(block);
    originalTexts.delete(block);
    originalTokens.delete(block);
    appliedModes.delete(block);
    translatedBlocks.delete(block);
  }
  for (const block of loadingBlocks) {
    if (block.isConnected) continue;
    removeLoading(block);
    originalTexts.delete(block);
    originalTokens.delete(block);
    appliedModes.delete(block);
  }
}

const TEXT_TAGS = new Set([
  "P", "LI", "DD", "DT", "BLOCKQUOTE", "FIGCAPTION", "CAPTION", "SUMMARY",
  "H1", "H2", "H3", "H4", "H5", "H6",
]);
const INLINE_UI_TAGS = new Set(["A", "BUTTON", "LABEL", "SPAN", "DT", "DD", "LI"]);
const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);
const GENERIC_TEXT_TAGS = new Set(["DIV", "SECTION", "ARTICLE", "MAIN"]);
// 整体跳过的标签：自身不作翻译块，后代也不进入候选。
// 表格（TABLE/TR/TD/TH...）整体跳过，避免把数据表的表头/文字列翻成中文。
const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "HEAD", "META", "LINK", "TEMPLATE",
  "SVG", "MATH", "IMG", "VIDEO", "AUDIO", "CANVAS", "IFRAME",
  "INPUT", "TEXTAREA", "SELECT", "FORM",
  "PRE", "CODE", "KBD", "SAMP", "VAR",
  "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH",
]);
// 配合 SKIP_TAGS：任何被 <table>/<pre>/<code>... 包裹的内联元素也一并跳过。
// 比如 <td><a>xxx</a></td> 的 <a> 不会被二遍扫描当成 inline UI target。
const SKIP_ANCESTOR_SELECTOR = [
  "pre", "code", "kbd", "samp", "var",
  "svg", "math", "canvas", "iframe",
  "input", "textarea", "select",
  "table",
  "[contenteditable='true']", "[translate='no']", "[aria-hidden='true']", "[hidden]",
  ".notranslate", ".sr-only", ".visually-hidden",
  `[${TRANSLATION_ATTR}]`, `[${ORIGINAL_ATTR}]`, `[${LOADING_ATTR}]`,
].join(",");
// 提取翻译输入时跳过的子树：元素本身不构成独立翻译块，
// 但其文本内容是噪声，会污染上下文 / 破坏排版：
//   - sup.reference：Wikipedia 引用角标（[1][2]）
//   - .mw-editsection / .reference-text：Wikipedia 编辑按钮、引用正文
//   - 无障碍隐藏文本（sr-only / visually-hidden / aria-hidden）
const EXCLUDE_TEXT_SELECTOR = [
  "sup.reference",
  ".mw-editsection",
  ".reference-text",
  ".sr-only",
  ".visually-hidden",
  "[hidden]",
  "[aria-hidden='true']",
].join(",");
const DATAVIZ_RE =
  /(^|[-_\s])(chart|graph|plot|sparkline|axis|legend|recharts|highcharts|echarts|apexcharts|victory|visx|vega|nivo|d3)([-_\s]|$)/i;
const CODE_LIKE_RE =
  /^\s*(import|export|const|let|var|function|class|interface|type|enum|async|await|return|if|else|for|while|try|catch|pub|fn|struct|impl|zig|cargo|npm|pnpm|yarn)\b|[{}<>;=]/i;

function collectBlocks(): HTMLElement[] {
  const root = document.body;
  if (!root) return [];

  const blocks: HTMLElement[] = [];
  const picked = new Set<HTMLElement>();
  const candidates = collectCandidateElements(root);
  for (const el of candidates) {
    if (!(el instanceof HTMLElement)) continue;
    if (shouldSkipElement(el)) continue;
    if (isOurUi(el)) continue;
    if (loadingBlocks.has(el)) continue;
    if (isGithubUiText(el)) continue;
    if (!isVisible(el)) continue;
    if (isCompactUiBlockCandidate(el)) continue;
    if (!isTextBlockCandidate(el)) continue;
    if (!isLayoutCandidate(el)) continue;
    const text = getOriginalText(el);
    if (text.length < getMinTextChars(el)) continue;
    if (shouldSkipText(text)) continue;
    if (hasBlockChild(el)) continue;
    blocks.push(el);
    picked.add(el);
  }

  for (const el of candidates) {
    if (!(el instanceof HTMLElement)) continue;
    if (picked.has(el)) continue;
    if (hasPickedAncestor(el, picked)) continue;
    if (shouldSkipElement(el)) continue;
    if (isOurUi(el)) continue;
    if (loadingBlocks.has(el)) continue;
    if (isGithubUiText(el)) continue;
    if (!isVisible(el)) continue;
    if (!isInlineTranslationTarget(el)) continue;
    const text = getOriginalText(el);
    if (text.length < 2) continue;
    if (shouldSkipText(text)) continue;
    blocks.push(el);
    picked.add(el);
  }
  return blocks;
}

function collectCandidateElements(root: ParentNode): HTMLElement[] {
  const elements: HTMLElement[] = [];
  const visit = (node: ParentNode): void => {
    for (const el of node.querySelectorAll("*")) {
      if (!(el instanceof HTMLElement)) continue;
      elements.push(el);
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(root);
  return elements;
}

function hasBlockChild(el: HTMLElement): boolean {
  for (const child of el.children) {
    if (!(child instanceof HTMLElement)) continue;
    if (shouldSkipElement(child)) continue;
    if (isOurUi(child)) continue;
    if (!isVisible(child)) continue;
    if (!isLayoutCandidate(child)) continue;
    if (getOriginalText(child).length >= MIN_TEXT_CHARS) return true;
  }
  return false;
}

function shouldSkipElement(el: HTMLElement): boolean {
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (shouldSkipSiteElement(el)) return true;
  if (el.tagName === "BUTTON" && !isInlineTranslationTarget(el)) return true;
  if (el.isContentEditable) return true;
  if (el.closest(SKIP_ANCESTOR_SELECTOR)) return true;
  if (isDataVizElement(el)) return true;
  return false;
}

function hasPickedAncestor(el: HTMLElement, picked: Set<HTMLElement>): boolean {
  let cur = el.parentElement;
  while (cur) {
    if (picked.has(cur)) return true;
    cur = cur.parentElement;
  }
  return false;
}

function isTextBlockCandidate(el: HTMLElement): boolean {
  if (isGithubContentText(el)) return true;
  if (isWikipediaHatnote(el)) return true;
  if (isRedditContentText(el)) return true;
  if (TEXT_TAGS.has(el.tagName)) return true;
  if (!GENERIC_TEXT_TAGS.has(el.tagName)) return false;

  // 通用容器只有在非常像正文叶子块时才翻译，避免按钮组、图表、卡片等 UI 被命中。
  const textChildCount = Array.from(el.childNodes).filter(
    (child) => child.nodeType === Node.TEXT_NODE && !!child.textContent?.trim(),
  ).length;
  if (textChildCount === 0) return false;

  const elementChildCount = Array.from(el.children).filter(
    (child) =>
      child instanceof HTMLElement &&
      !isOurUi(child) &&
      !shouldSkipElement(child) &&
      !!child.textContent?.trim(),
  ).length;
  return elementChildCount === 0;
}

function shouldSkipText(text: string): boolean {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return true;
  if (/^https?:\/\/\S+$/i.test(compact)) return true;
  if (/^[\d\s.,:%()+/-]+$/.test(compact)) return true;
  if (compact.length < 80 && CODE_LIKE_RE.test(compact)) return true;
  return false;
}

function isDataVizElement(el: HTMLElement): boolean {
  let cur: HTMLElement | null = el;
  let depth = 0;
  while (cur && cur !== document.body && depth < 5) {
    const className = typeof cur.className === "string" ? cur.className : "";
    const label = [
      cur.id,
      className,
      cur.getAttribute("role") ?? "",
      cur.getAttribute("aria-label") ?? "",
      cur.getAttribute("data-testid") ?? "",
      cur.getAttribute("data-slot") ?? "",
      cur.getAttribute("data-chart") ?? "",
    ].join(" ");
    if (DATAVIZ_RE.test(label) && (depth === 0 || !isLikelyTitle(el))) {
      return true;
    }
    cur = cur.parentElement;
    depth += 1;
  }
  return false;
}

function getMinTextChars(el: HTMLElement): number {
  if (HEADING_TAGS.has(el.tagName)) return 3;
  if (el.tagName === "DT" || el.tagName === "DD") return 2;
  return MIN_TEXT_CHARS;
}

function isLikelyTitle(el: HTMLElement): boolean {
  return HEADING_TAGS.has(el.tagName) || el.tagName === "P";
}

function isLayoutCandidate(el: HTMLElement): boolean {
  if (isGithubContentText(el)) return true;
  if (isWikipediaHatnote(el)) return true;
  if (isRedditContentText(el)) return true;
  if (HEADING_TAGS.has(el.tagName)) return true;
  return BLOCK_RE.test(window.getComputedStyle(el).display);
}

function isInlineTranslationTarget(el: HTMLElement): boolean {
  const isWikipediaUiText = isWikipediaCompactUiText(el);
  if (!INLINE_UI_TAGS.has(el.tagName) && !isWikipediaUiText) return false;
  if (isGithubUiText(el)) return false;
  if (!isWikipediaUiText && !isCompactUiBlockCandidate(el)) return false;
  if (el.querySelector("a,button,label")) return false;
  return getDirectText(el).length > 0;
}

function isCompactBilingualReplacement(
  el: HTMLElement,
  mode: PageTranslateMode,
): boolean {
  return mode === "bilingual" && isCompactUiBlockCandidate(el);
}

function getDirectText(el: HTMLElement): string {
  return Array.from(el.childNodes)
    .filter((child) => child.nodeType === Node.TEXT_NODE)
    .map((child) => child.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function readRawText(el: HTMLElement): string {
  return (
    typeof (el as { innerText?: unknown }).innerText === "string"
      ? (el as { innerText: string }).innerText
      : (el.textContent ?? "")
  );
}

function isVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (style.opacity === "0") return false;
  if (HEADING_TAGS.has(el.tagName) && readRawText(el).trim().length > 0) return true;
  if (el.getClientRects().length > 0) return true;
  if (el.offsetParent !== null) return true;
  return (
    style.position === "fixed" ||
    style.position === "sticky" ||
    style.position === "absolute"
  );
}

function getOriginalText(el: HTMLElement): string {
  const cached = originalTexts.get(el);
  if (cached !== undefined) return cached;

  // Inline 目标走 getDirectText（只拿直接文本节点，保留行内子元素由 token 重建）；
  // Block 走 extractTranslatableHTML（在 <a>/<code>/<b> 等处插入 <b i="N"> 占位标记，
  // 让翻译引擎保留结构，译文回来再用 token 表重建链接/粗体）。
  if (isInlineTranslationTarget(el)) {
    const text = getDirectText(el);
    if (text) originalTexts.set(el, text);
    return text;
  }

  const { html, tokens } = extractTranslatableHTML(el);
  originalTokens.set(el, tokens);
  if (html) originalTexts.set(el, html);
  return html;
}

// 把 block 子树拍平为带 <b i="N"> 标记的字符串送翻译。
// - 剔除 EXCLUDE_TEXT_SELECTOR 子树（Wikipedia [1][edit] 等噪声）
// - 遇到需要保留结构的内联元素（a / code / b 等），把它替换成 <b i="N">文本</b>
//   并登记 token 到返回表中，译文回来后据此重建 DOM
function extractTranslatableHTML(el: HTMLElement): {
  html: string;
  tokens: InlineToken[];
} {
  const tokens: InlineToken[] = [];
  const parts: string[] = [];

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      // HTML escape 文本节点里的 < > &：微软 textType=html 会把它们当 HTML 语法
      // 解析。即使是原文里的字面 `<`（代码片段等）也不能裸着送。
      parts.push(escapeHtml(node.nodeValue ?? ""));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const child = node as HTMLElement;
    if (child.matches?.(EXCLUDE_TEXT_SELECTOR)) return;

    const kind = getPreservableInlineKind(child);
    if (kind) {
      // 收集子树纯文本（同样剔除排除项），作为 marker 内的内容 —— 让翻译引擎
      // 只翻这一小段；回来根据 marker 索引找到 token 并包回原标签。
      const innerText = extractInnerPlainText(child);
      if (innerText) {
        const idx = tokens.length;
        tokens.push({
          text: innerText,
          tagName: child.tagName.toLowerCase(),
          className: child.className,
          style: child.getAttribute("style"),
          href: kind === "link" ? child.getAttribute("href") : null,
          title: child.getAttribute("title"),
          kind,
        });
        // 用 anchor + 哈希片段作 marker：Google / 微软(html 模式) 对真 <a> 都保留稳。
        // #fragment 是合法 URL 片段不会被当正文翻译。
        parts.push(`<a href="#i${idx}">${escapeHtml(innerText)}</a>`);
      }
      return;
    }

    for (const c of child.childNodes) visit(c);
  };

  for (const c of el.childNodes) visit(c);
  const html = parts.join("").replace(/\s+/g, " ").trim();
  return { html, tokens };
}

function extractInnerPlainText(el: HTMLElement): string {
  const parts: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.nodeValue ?? "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const child = node as HTMLElement;
    if (child.matches?.(EXCLUDE_TEXT_SELECTOR)) return;
    for (const c of child.childNodes) visit(c);
  };
  for (const c of el.childNodes) visit(c);
  return parts.join("").replace(/\s+/g, " ").trim();
}

function getPreservableInlineKind(el: HTMLElement): InlineToken["kind"] | null {
  const tag = el.tagName;
  if (tag === "A" && el.getAttribute("href")) return "link";
  if (/^(CODE|KBD|SAMP|VAR)$/.test(tag) && !el.closest("pre")) return "code";
  if (/^(B|STRONG|I|EM|U|MARK)$/.test(tag)) return "emphasis";
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 译文里的实体（Google / 微软都可能输出 &amp; &#39; &nbsp; 等）解码回字符。
// 用 textarea.innerHTML 技巧：textarea 不会执行 script，纯解实体。
let entityDecoder: HTMLTextAreaElement | null = null;
function decodeHtmlEntities(s: string): string {
  if (!/&[#\w]+;/.test(s)) return s;
  if (!entityDecoder) entityDecoder = document.createElement("textarea");
  entityDecoder.innerHTML = s;
  return entityDecoder.value;
}

function isOurUi(el: Element): boolean {
  return !!el.closest(
    `[data-onelingo-tooltip],[data-onelingo-host],[${TRANSLATION_ATTR}],[${ORIGINAL_ATTR}],[${LOADING_ATTR}]`,
  );
}

interface InlineToken {
  text: string;
  tagName: string;
  className: string;
  style: string | null;
  href: string | null;
  title: string | null;
  kind: "code" | "link" | "emphasis";
}

interface InlineReplacement {
  wrappers: HTMLElement[];
  translation: HTMLElement;
}

// Marker 正则合集。按顺序优先：
//  1. 新版：<a href="#iN">text</a>
//  2. 旧版（兼容老缓存）：<b data-i=N>text</b> 或 <b i="N">text</b>
// 全部对属性格式/引号做最大容忍（Google 有时会加转义、删引号、把 " 换成 "）。
const TOKEN_MARKER_RE =
  /<a[^>]*?#\s*i\s*(\d+)[^>]*?>([\s\S]*?)<\/\s*a\s*>|<b\s+(?:data-)?i\s*=?\s*[^>\d]{0,4}(\d+)[^>]{0,8}>([\s\S]*?)<\/\s*b\s*>/gi;

// 把漏网的 marker 碎片从译文片段里清掉（Google 偶尔只吃掉半个标签留下
// 裸的 "data-i=7>" / "</b>" / "#i4"">" 等）。不保证 100%，但能让用户眼前干净。
const MARKER_JUNK_RE = /<\/?\s*[ab]\b[^>]{0,60}>|(?:data-|#)i\s*=?\s*["'""''`]{0,2}\d+["'""''`]{0,2}>?/gi;

function cleanMarkerJunk(text: string): string {
  // 译文可能带 &amp; / &#39; / &nbsp; 等 HTML 实体（微软 textType=html 尤其常见）。
  // 先解码再扫 marker 残骸——这样即便引擎把我们的 `<a>` 编码成 `&lt;a&gt;` 吐回来，
  // 也能被正则清掉，避免它以字面 "<a>" 出现在正文里。
  return decodeHtmlEntities(text).replace(MARKER_JUNK_RE, "").replace(/\s{2,}/g, " ");
}

function appendTranslatedContent(
  container: HTMLElement,
  translated: string,
  source: HTMLElement,
): void {
  const tokens = originalTokens.get(source) ?? [];
  if (tokens.length === 0) {
    container.textContent = cleanMarkerJunk(translated);
    return;
  }

  // 解析 marker：<a href="#iN">translated</a>（优先）或旧版 <b> 兜底。
  const pattern = TOKEN_MARKER_RE;
  pattern.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  const seenIdx = new Set<number>();
  const pushText = (raw: string): void => {
    const cleaned = cleanMarkerJunk(raw);
    if (cleaned) container.appendChild(document.createTextNode(cleaned));
  };
  while ((match = pattern.exec(translated)) !== null) {
    if (match.index > cursor) {
      pushText(translated.slice(cursor, match.index));
    }
    // 新版捕获组：match[1]=idx、match[2]=inner；旧版：match[3]=idx、match[4]=inner
    const rawIdx = match[1] ?? match[3] ?? "";
    const rawInner = match[2] ?? match[4] ?? "";
    const idx = Number.parseInt(rawIdx, 10);
    const inner = cleanMarkerJunk(rawInner);
    const token = Number.isFinite(idx) ? tokens[idx] : undefined;
    if (token && inner && !seenIdx.has(idx)) {
      seenIdx.add(idx);
      container.appendChild(createInlineTokenNode(token, inner));
    } else if (inner) {
      // token 缺失（Google 把 marker 吃了）或被复制到多处 —— 退化为纯文本。
      container.appendChild(document.createTextNode(inner));
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < translated.length) {
    pushText(translated.slice(cursor));
  }
}

function createInlineTokenNode(token: InlineToken, text: string): HTMLElement {
  const el = document.createElement(token.tagName);
  if (token.className) el.className = token.className;
  if (token.style) el.setAttribute("style", token.style);
  if (token.href) el.setAttribute("href", token.href);
  if (token.title) el.setAttribute("title", token.title);
  el.textContent = text;
  return el;
}

function applyInlineLoading(block: HTMLElement, original: string): void {
  restoreInlineOriginal(block);
  const textNodes = getDirectTextNodes(block);
  if (textNodes.length === 0) return;

  const loading = createLoadingNode(original, true);
  const wrappers: HTMLElement[] = [];
  for (const textNode of textNodes) {
    const parent = textNode.parentNode;
    if (!parent) continue;
    const wrapper = document.createElement("span");
    wrapper.setAttribute(ORIGINAL_ATTR, "true");
    hideElement(wrapper);
    parent.replaceChild(wrapper, textNode);
    wrapper.appendChild(textNode);
    if (wrappers.length === 0) {
      parent.insertBefore(loading, wrapper);
    }
    wrappers.push(wrapper);
  }

  if (wrappers.length > 0) {
    inlineReplacements.set(block, { wrappers, translation: loading });
    loadingNodes.set(block, loading);
    loadingBlocks.add(block);
  }
}

function applyInlineTranslation(block: HTMLElement, translated: string): void {
  restoreInlineOriginal(block);
  const textNodes = getDirectTextNodes(block);
  if (textNodes.length === 0) return;

  const translation = document.createElement("span");
  translation.setAttribute(TRANSLATION_ATTR, "true");
  translation.style.display = "inline";
  appendTranslatedContent(translation, translated, block);

  const wrappers: HTMLElement[] = [];
  for (const textNode of textNodes) {
    const parent = textNode.parentNode;
    if (!parent) continue;
    const wrapper = document.createElement("span");
    wrapper.setAttribute(ORIGINAL_ATTR, "true");
    hideElement(wrapper);
    parent.replaceChild(wrapper, textNode);
    wrapper.appendChild(textNode);
    if (wrappers.length === 0) {
      parent.insertBefore(translation, wrapper);
    }
    wrappers.push(wrapper);
  }

  if (wrappers.length > 0) {
    inlineReplacements.set(block, { wrappers, translation });
  }
}

function restoreInlineOriginal(block: HTMLElement): void {
  const replacement = inlineReplacements.get(block);
  if (!replacement) return;

  for (const wrapper of replacement.wrappers) {
    const parent = wrapper.parentNode;
    if (parent) {
      while (wrapper.firstChild) {
        parent.insertBefore(wrapper.firstChild, wrapper);
      }
    }
    wrapper.remove();
  }
  replacement.translation.remove();
  inlineReplacements.delete(block);
}

function hideElement(el: HTMLElement): void {
  el.hidden = true;
  el.style.setProperty("display", "none", "important");
}

function getDirectTextNodes(el: HTMLElement): Text[] {
  return Array.from(el.childNodes).filter(
    (child): child is Text =>
      child.nodeType === Node.TEXT_NODE &&
      !!child.textContent?.replace(/\s+/g, " ").trim(),
  );
}
