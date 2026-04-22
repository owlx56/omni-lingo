import {
  onMessage,
  sendMessage,
  type PageTranslateAck,
  type PageTranslateCommand,
  type PageTranslateStatus,
} from "@/lib/messaging";

const BLOCK_RE = /^(block|flex|grid|list-item|table(?!-cell\b|-row\b)|table-cell|table-row)$/;
const MIN_TEXT_CHARS = 8;
const MAX_CONCURRENCY = 12;
const FOLLOW_UP_DELAY_MS = 1200;
const NAVIGATION_CHECK_MS = 500;
const NAVIGATION_RETRANSLATE_DELAY_MS = 800;
const TRANSLATION_ATTR = "data-onelingo-immersive";
const ORIGINAL_ATTR = "data-onelingo-original";
const INLINE_CODE_SELECTOR = "code,kbd,samp,var";
const GITHUB_MARKDOWN_TITLE_SELECTOR = "a.js-navigation-open.markdown-title";
const GITHUB_UI_SELECTOR = [
  "header", "nav", "form", "button", "[role='button']",
  "[role='banner']", "[role='navigation']", "[role='menu']",
  "[role='tablist']", "[role='toolbar']",
  ".AppHeader", ".HeaderMenu", ".UnderlineNav", ".tabnav",
  ".pagehead", ".pagehead-actions", ".BtnGroup", ".Button", ".btn",
  ".subnav", ".SelectMenu", ".ActionList", ".filter-item",
  "table[aria-labelledby='folders-and-files'] tr",
  ".react-directory-row", ".react-directory-filename-column",
  ".react-directory-row-commit-cell", ".react-directory-commit-age",
  ".LatestCommit-module__Box__B25ZT",
].join(",");
const INLINE_UI_CONTAINER_SELECTOR = [
  "nav", "header", "aside", "form", "dl", "dt", "dd",
  "[role='banner']", "[role='navigation']", "[role='complementary']",
  "[role='menu']", "[role='tablist']", "[role='toolbar']",
  "#header", ".AppHeader", ".HeaderMenu", ".UnderlineNav", ".tabnav",
  ".meta", ".tags", ".actions", ".pagehead", ".pagehead-actions",
  ".BtnGroup", ".Button", ".btn",
  ".vector-toc", ".vector-appearance", ".vector-page-tools",
].join(",");

const originalTexts = new WeakMap<HTMLElement, string>();
const appliedKeys = new WeakMap<HTMLElement, string>();
const appliedModes = new WeakMap<HTMLElement, PageTranslateMode>();
const translatedTexts = new WeakMap<HTMLElement, string>();
const translationNodes = new WeakMap<HTMLElement, HTMLElement>();
const originalWrappers = new WeakMap<HTMLElement, HTMLElement>();
const inlineReplacements = new WeakMap<HTMLElement, InlineReplacement>();
const translatedBlocks = new Set<HTMLElement>();

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

        const original = getOriginalText(block);
        if (!original) continue;

        const appliedKey = getBlockTranslationKey(pageKey, original);
        const cached = translatedTexts.get(block);
        if (cached && appliedKeys.get(block) === appliedKey) {
          const applyMode = currentMode ?? mode;
          applyTranslation(block, cached, applyMode);
          appliedModes.set(block, applyMode);
          translatedBlocks.add(block);
          continue;
        }

        try {
          const res = await sendMessage("translate", {
            text: original,
            target: input.target,
            engine: input.engine,
          });
          if (seq !== runSeq) return;
          if (!block.isConnected) continue;
          const applyMode = currentMode ?? mode;
          translatedTexts.set(block, res.text);
          applyTranslation(block, res.text, applyMode);
          appliedKeys.set(block, appliedKey);
          appliedModes.set(block, applyMode);
          translatedBlocks.add(block);
        } catch (error) {
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
  for (const block of translatedBlocks) {
    removeTranslationNode(block);
    restoreOriginalDom(block);
    restoreInlineOriginal(block);
    originalTexts.delete(block);
    appliedModes.delete(block);
  }
  translatedBlocks.clear();
}

function applyTranslation(
  block: HTMLElement,
  translated: string,
  mode: PageTranslateMode,
): void {
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
  appendTranslatedContent(node, translated, block);
  node.style.display = "block";
  node.style.marginTop = mode === "bilingual" ? "0.35em" : "0";
  if (mode === "bilingual") node.style.color = "#2f6f4e";
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

function hideOriginalDom(block: HTMLElement): void {
  const existing = originalWrappers.get(block);
  if (existing?.isConnected) {
    existing.hidden = true;
    return;
  }

  const wrapper = document.createElement("span");
  wrapper.setAttribute(ORIGINAL_ATTR, "true");
  wrapper.hidden = true;
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
    active: translatedBlocks.size > 0,
    translating,
    blocks: translatedBlocks.size,
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
    active: blocks > 0 || translatedBlocks.size > 0 || translating,
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
    appliedModes.delete(block);
    translatedBlocks.delete(block);
  }
}

const TEXT_TAGS = new Set([
  "P", "LI", "DD", "DT", "BLOCKQUOTE", "FIGCAPTION", "CAPTION", "SUMMARY",
  "H1", "H2", "H3", "H4", "H5", "H6", "TD", "TH",
]);
const INLINE_UI_TAGS = new Set(["A", "BUTTON", "LABEL", "SPAN", "DT", "DD", "LI"]);
const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);
const GENERIC_TEXT_TAGS = new Set(["DIV", "SECTION", "ARTICLE", "MAIN"]);
const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "HEAD", "META", "LINK", "TEMPLATE",
  "SVG", "MATH", "IMG", "VIDEO", "AUDIO", "CANVAS", "IFRAME",
  "INPUT", "TEXTAREA", "SELECT", "FORM",
  "PRE", "CODE", "KBD", "SAMP", "VAR",
  "TABLE", "THEAD", "TBODY", "TFOOT", "TR",
]);
const SKIP_ANCESTOR_SELECTOR = [
  "pre", "code", "kbd", "samp", "var",
  "svg", "math", "canvas", "iframe",
  "input", "textarea", "select",
  "[contenteditable='true']", "[translate='no']", "[aria-hidden='true']", "[hidden]",
  ".notranslate", ".sr-only", ".visually-hidden",
  `[${TRANSLATION_ATTR}]`, `[${ORIGINAL_ATTR}]`,
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
  for (const el of root.querySelectorAll("*")) {
    if (!(el instanceof HTMLElement)) continue;
    if (shouldSkipElement(el)) continue;
    if (isOurUi(el)) continue;
    if (isGithubUiText(el)) continue;
    if (!isVisible(el)) continue;
    if (isCompactUiBlockCandidate(el)) continue;
    if (!isTextBlockCandidate(el)) continue;
    if (!isLayoutCandidate(el)) continue;
    const text = getOriginalText(el);
    if (text.length < getMinTextChars(el)) continue;
    if (shouldSkipText(text)) continue;
    if (!isTableCell(el) && hasBlockChild(el)) continue;
    blocks.push(el);
    picked.add(el);
  }

  for (const el of root.querySelectorAll("*")) {
    if (!(el instanceof HTMLElement)) continue;
    if (picked.has(el)) continue;
    if (hasPickedAncestor(el, picked)) continue;
    if (shouldSkipElement(el)) continue;
    if (isOurUi(el)) continue;
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
  if (el.tagName === "BUTTON" && !isInlineTranslationTarget(el)) return true;
  if (el.isContentEditable) return true;
  if (el.closest(SKIP_ANCESTOR_SELECTOR)) return true;
  if (!isTableCell(el) && el.closest("td,th")) return true;
  if (isTableCell(el) && hasCodeDescendant(el)) return true;
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

function isCompactUiBlockCandidate(el: HTMLElement): boolean {
  return !!el.closest(INLINE_UI_CONTAINER_SELECTOR);
}

function isTextBlockCandidate(el: HTMLElement): boolean {
  if (isGithubMarkdownTitle(el)) return true;
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
  if (HEADING_TAGS.has(el.tagName) || isTableCell(el)) return 3;
  if (el.tagName === "DT" || el.tagName === "DD") return 2;
  return MIN_TEXT_CHARS;
}

function isTableCell(el: HTMLElement): boolean {
  return el.tagName === "TD" || el.tagName === "TH";
}

function hasCodeDescendant(el: HTMLElement): boolean {
  return !!el.querySelector(`pre,${INLINE_CODE_SELECTOR}`);
}

function isLikelyTitle(el: HTMLElement): boolean {
  return HEADING_TAGS.has(el.tagName) || el.tagName === "P";
}

function isLayoutCandidate(el: HTMLElement): boolean {
  if (isGithubMarkdownTitle(el)) return true;
  if (HEADING_TAGS.has(el.tagName)) return true;
  return BLOCK_RE.test(window.getComputedStyle(el).display);
}

function isGithubMarkdownTitle(el: HTMLElement): boolean {
  return el.matches(GITHUB_MARKDOWN_TITLE_SELECTOR);
}

function isGithubUiText(el: HTMLElement): boolean {
  return isGithubPage() && !isGithubMarkdownTitle(el) && !!el.closest(GITHUB_UI_SELECTOR);
}

function isGithubPage(): boolean {
  return window.location.hostname === "github.com";
}

function isInlineTranslationTarget(el: HTMLElement): boolean {
  if (!INLINE_UI_TAGS.has(el.tagName)) return false;
  if (isGithubUiText(el)) return false;
  if (!el.closest(INLINE_UI_CONTAINER_SELECTOR)) return false;
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

  // 某些元素（尤其 SVG）没有可靠 innerText，回退到 textContent 避免 trim 崩溃。
  const text = isInlineTranslationTarget(el)
    ? getDirectText(el)
    : readRawText(el).trim();
  if (text) originalTexts.set(el, text);
  return text;
}

function isOurUi(el: Element): boolean {
  return !!el.closest(
    `[data-onelingo-tooltip],[data-onelingo-host],[${TRANSLATION_ATTR}],[${ORIGINAL_ATTR}]`,
  );
}

interface InlineToken {
  text: string;
  tagName: string;
  className: string;
  style: string | null;
  href: string | null;
  title: string | null;
  kind: "code" | "link";
}

interface InlineRange {
  start: number;
  end: number;
  token: InlineToken;
}

interface InlineReplacement {
  wrappers: HTMLElement[];
  translation: HTMLElement;
}

function appendTranslatedContent(
  container: HTMLElement,
  translated: string,
  source: HTMLElement,
): void {
  const ranges = findInlineRanges(translated, collectInlineTokens(source));
  if (ranges.length === 0) {
    container.textContent = translated;
    return;
  }

  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      container.appendChild(document.createTextNode(translated.slice(cursor, range.start)));
    }
    container.appendChild(createInlineTokenNode(range.token, translated.slice(range.start, range.end)));
    cursor = range.end;
  }
  if (cursor < translated.length) {
    container.appendChild(document.createTextNode(translated.slice(cursor)));
  }
}

function collectInlineTokens(source: HTMLElement): InlineToken[] {
  const tokens: InlineToken[] = [];
  const seen = new Set<string>();
  for (const node of source.querySelectorAll(INLINE_CODE_SELECTOR)) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.closest("pre")) continue;
    const text = readRawText(node).trim();
    if (text.length === 0 || text.length > 40) continue;
    const key = `${node.tagName}|${text.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push({
      text,
      tagName: node.tagName.toLowerCase(),
      className: node.className,
      style: node.getAttribute("style"),
      href: null,
      title: null,
      kind: "code",
    });
  }
  for (const node of source.querySelectorAll("a[href]")) {
    if (!(node instanceof HTMLAnchorElement)) continue;
    if (node.closest("pre")) continue;
    const text = readRawText(node).trim();
    if (text.length === 0 || text.length > 120) continue;
    const key = `A|${text.toLocaleLowerCase()}|${node.href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push({
      text,
      tagName: "a",
      className: node.className,
      style: node.getAttribute("style"),
      href: node.href,
      title: node.getAttribute("title"),
      kind: "link",
    });
  }
  return tokens.sort((a, b) => b.text.length - a.text.length);
}

function findInlineRanges(translated: string, tokens: InlineToken[]): InlineRange[] {
  const ranges: InlineRange[] = [];
  const lower = translated.toLocaleLowerCase();
  for (const token of tokens) {
    const needle = token.text.toLocaleLowerCase();
    let index = 0;
    while (index < lower.length) {
      const start = lower.indexOf(needle, index);
      if (start === -1) break;
      const end = start + needle.length;
      if (
        isTokenBoundary(translated[start - 1]) &&
        isTokenBoundary(translated[end]) &&
        !ranges.some((range) => start < range.end && end > range.start)
      ) {
        ranges.push({ start, end, token });
      }
      index = end;
    }
  }
  addFallbackLinkRanges(translated, tokens, ranges);
  return ranges.sort((a, b) => a.start - b.start);
}

function addFallbackLinkRanges(
  translated: string,
  tokens: InlineToken[],
  ranges: InlineRange[],
): void {
  const unmatchedLinks = tokens.filter(
    (token) =>
      token.kind === "link" &&
      !ranges.some((range) => range.token === token),
  );
  if (unmatchedLinks.length === 0) return;

  const titleMatches = Array.from(translated.matchAll(/《[^》]{2,80}》/g));
  let tokenIndex = 0;
  for (const match of titleMatches) {
    if (tokenIndex >= unmatchedLinks.length) return;
    const token = unmatchedLinks[tokenIndex];
    if (!token) return;
    const start = match.index;
    if (start === undefined) continue;
    const end = start + match[0].length;
    if (ranges.some((range) => start < range.end && end > range.start)) continue;
    ranges.push({ start, end, token });
    tokenIndex += 1;
  }
}

function isTokenBoundary(char: string | undefined): boolean {
  return char === undefined || !/[A-Za-z0-9_]/.test(char);
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
    wrapper.hidden = true;
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

function getDirectTextNodes(el: HTMLElement): Text[] {
  return Array.from(el.childNodes).filter(
    (child): child is Text =>
      child.nodeType === Node.TEXT_NODE &&
      !!child.textContent?.replace(/\s+/g, " ").trim(),
  );
}
