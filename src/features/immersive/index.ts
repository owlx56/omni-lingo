// 全文翻译核心逻辑 — 参照 kiss-translator 实现
// 核心差异保留：使用 onelingo 的 LRU + IndexedDB 二级缓存（通过 translateBatch 消息）

import {
  onMessage,
  sendMessage,
  type PageTranslateAck,
  type PageTranslateCommand,
  type PageTranslateStatus,
} from "@/lib/messaging";
import { getFullPageRules } from "@/lib/storage/full-page-rules";
import {
  matchFullPageRule,
  resolveFullPageRule,
  type ResolvedFullPageRule,
} from "./rules";

// ── Constants ─────────────────────────────────────────────────────────────────
const BATCH_INTERVAL = 400;          // ms debounce before sending batch
const BATCH_SIZE = 10;               // max texts per API call
const BATCH_MAX_LENGTH = 10_000;     // max chars per API call
const TRANS_MIN_LENGTH = 2;          // kiss-translator default
const TRANS_MAX_LENGTH = 100_000;
const NEWLINE_LENGTH = 20;           // add <br> separator if text > 20 chars
const NAVIGATION_CHECK_MS = 500;
const NAVIGATION_RETRANSLATE_DELAY_MS = 800;

const WRAPPER_ATTR = "data-onelingo-wrapper";
const INNER_ATTR = "data-onelingo-inner";
const LOADING_STYLE_ID = "onelingo-immersive-loading-style";
const MAIN_PAGE_LAYOUT_STYLE_ID = "onelingo-wikipedia-main-page-layout-style";

// ── Skip patterns (from kiss-translator BUILTIN_SKIP_PATTERNS) ────────────────
const BUILTIN_SKIP_PATTERNS = [
  /^(?:(?:https?|ftp|file):\/\/|www\.)[^\s/$.?#].[^\s]*$/i,
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  /^(?:[a-zA-Z]:\\|\/|\\)(?:[\w\-. ]+[/\\])*[\w\-. ]*\.?[\w\-. ]*$/,
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  /^[$\u00A2-\u00A5\u20A0-\u20CF]?\s?-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\s?(?:px|%|em|rem|pt|vw|vh|deg|s|ms)?$/,
  /^v?\d+(\.\d+){1,3}$/,
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/,
  /^({{[^}]+}}|\${[^}]+}|__\w+__|%\w+)$/,
  /^(?:\.|#)[\w-]+$|^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/,
  /^@[\w.-]+$/,
  /^&\w+;$/,
  /^\[\d+\]$/,
  /^\d{1,2}:\d{2}(:\d{2})?$/,
  /^[^\s\\/:]+?\.[a-zA-Z0-9]{2,5}$/,
];
const COMBINED_SKIP_RE = new RegExp(
  BUILTIN_SKIP_PATTERNS.map((r) => `(${r.source})`).join("|"),
);

// ── DOM tag sets (from kiss-translator Translator.TAGS) ───────────────────────
const BREAK_LINE_TAGS = new Set(["BR", "WBR"]);
const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "CANVAS", "DD", "DIV", "DL",
  "DT", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM",
  "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN",
  "NAV", "NOSCRIPT", "OL", "P", "PRE", "SECTION", "TABLE", "TFOOT", "UL", "VIDEO",
]);
const INLINE_TAGS = new Set([
  "ABBR", "ACRONYM", "B", "BDO", "BIG", "BR", "BUTTON", "CITE", "CODE", "DFN",
  "DEL", "FONT", "EM", "I", "IMG", "INPUT", "INS", "KBD", "LABEL", "MAP", "MARK",
  "OBJECT", "OUTPUT", "Q", "RUBY", "SAMP", "SCRIPT", "SELECT", "SMALL",
  "STRONG", "SUB", "SUP", "TEXTAREA", "TIME", "TT", "U", "VAR",
]);
// Tags whose outerHTML is replaced entirely by a placeholder {n}
const RICH_TEXT_REPLACE_TAGS = new Set([
  "ABBR", "BR", "CODE", "DFN", "IMG", "KBD", "OUTPUT", "RP", "RT",
  "SAMP", "SUB", "SUP", "SVG", "TIME", "VAR", "WBR",
]);
// Tags wrapped in <i n>…</i n> placeholder (content translated, tag restored)
const RICH_TEXT_WRAP_TAGS = new Set([
  "A", "B", "BDO", "BDI", "BIG", "CITE", "DEL", "EM", "FONT", "I", "INS",
  "MARK", "Q", "RUBY", "S", "SMALL", "SPAN", "STRONG", "U",
]);
const RICH_HTML_INLINE_TAGS = new Set([
  "A", "B", "CITE", "EM", "I", "SMALL", "SPAN", "STRONG", "SUB", "SUP",
]);
const OPAQUE_PRESERVE_SELECTOR = [
  "code", "kbd", "samp", "var",
  "math", ".math",
  "a:has(code)",
  "sup.reference",
].join(", ");

// Tags that should never be translated, nor their descendants scanned.
// NOTE: TABLE/TR/TD/TH are intentionally NOT here — we recurse into tables
// so that content like Wikipedia's featured-article descriptions (which live
// inside <table><tbody><tr><td><p>…</p></td></tr></tbody></table>) gets picked
// up, matching kiss-translator behaviour.
const HARD_SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "HEAD", "META", "LINK", "TEMPLATE",
  "SVG", "MATH", "IMG", "VIDEO", "AUDIO", "CANVAS", "IFRAME",
  "INPUT", "TEXTAREA", "SELECT",
  "PRE", "CODE", "KBD", "SAMP", "VAR",
]);

// Ancestors that force a skip for any descendant
const SKIP_ANCESTOR_SELECTOR = [
  "pre", "code", "kbd", "samp", "var",
  "svg", "math", "canvas", "iframe",
  "input", "textarea", "select",
  "[contenteditable='true']", "[translate='no']", "[aria-hidden='true']", "[hidden]",
  ".notranslate", ".sr-only", ".visually-hidden",
  `[${WRAPPER_ATTR}]`,
].join(",");

// Sub-trees excluded from serialisation (noise text).
// Wikipedia reference bodies are intentionally kept; dropping .reference-text
// leaves only backlinks such as "^" or "a b c d" in Notes/References.
// NOTE: "sup.reference" is intentionally NOT here — Wikipedia citation markers
// like [1][2] are SUP elements, and SUP is in RICH_TEXT_REPLACE_TAGS, so they
// become opaque {n} placeholders and are restored verbatim after translation,
// matching kiss-translator behaviour. Dropping them here would strip them.
const EXCLUDE_TEXT_SELECTOR = [
  ".mw-editsection",
  ".sr-only", ".visually-hidden", "[hidden]", "[aria-hidden='true']",
].join(",");

// kiss-translator's BUILTIN_IGNORE_SELECTOR
const BUILTIN_IGNORE_SELECTOR = [
  "address", "area", "audio", "br", "canvas", "data", "datalist", "embed",
  "head", "iframe", "input", "noscript", "map", "object", "option", "param",
  "picture", "progress", "select", "script", "style", "svg", "track",
  "textarea", "template", "video", "wbr",
  ".notranslate", "[contenteditable='true']", "[translate='no']",
].join(", ");

// computed-display cache (same as kiss's static displayCache WeakMap)
const displayCache = new WeakMap<Element, boolean>();

// ── Types ─────────────────────────────────────────────────────────────────────
type PageTranslateMode = NonNullable<PageTranslateCommand["mode"]>;

interface WrapperState {
  nodes: ChildNode[];
  isHide: boolean;
}

interface WrappedPlaceholder {
  openTag: string;
  closeTag: string;
}

type PlaceholderMap = Map<string, string | WrappedPlaceholder>;

// ── BatchQueue (kiss-translator batchQueue.js pattern) ────────────────────────
interface BatchTask {
  text: string;
  resolve: (result: string) => void;
  reject: (err: unknown) => void;
}

class TranslateBatchQueue {
  private readonly queue: BatchTask[] = [];
  private timer: number | undefined;
  private processing = false;

  constructor(
    readonly engine: string,
    readonly target: string,
    readonly source: string | undefined,
  ) {}

  addTask(text: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.push({ text, resolve, reject });
      if (this.queue.length >= BATCH_SIZE) {
        void this.flush();
      } else {
        this.schedule();
      }
    });
  }

  private schedule(): void {
    if (!this.processing && this.timer === undefined && this.queue.length > 0) {
      this.timer = window.setTimeout(() => void this.flush(), BATCH_INTERVAL);
    }
  }

  private async flush(): Promise<void> {
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.queue.length === 0 || this.processing) return;

    this.processing = true;

    // Collect batch respecting size + length limits
    const batch: BatchTask[] = [];
    let totalLen = 0;
    for (const task of this.queue) {
      if (
        batch.length >= BATCH_SIZE ||
        (batch.length > 0 && totalLen + task.text.length > BATCH_MAX_LENGTH)
      ) break;
      totalLen += task.text.length;
      batch.push(task);
    }
    this.queue.splice(0, batch.length);

    try {
      const results = await sendMessage("translateBatch", {
        texts: batch.map((t) => t.text),
        target: this.target,
        engine: this.engine,
        source: this.source,
      });
      batch.forEach((task, i) => task.resolve(results[i] ?? ""));
    } catch (err) {
      batch.forEach((task) => task.reject(err));
    } finally {
      this.processing = false;
      if (this.queue.length >= BATCH_SIZE) {
        void this.flush();
      } else if (this.queue.length > 0) {
        this.schedule();
      }
    }
  }

  destroy(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    const err = new Error("Queue destroyed");
    this.queue.forEach((t) => t.reject(err));
    this.queue.length = 0;
  }
}

// ── Module state ──────────────────────────────────────────────────────────────

// DOM observation
let intersectionObserver: IntersectionObserver | null = null;
let mutationObserver: MutationObserver | null = null;
let rescanTimer: number | undefined;

// Translation session
let currentRule: ResolvedFullPageRule | null = null;
let runSeq = 0;
let lastCommandId = 0;
let pendingCount = 0;
let currentMode: PageTranslateMode | null = null;
let currentEngine: string | null = null;
let currentTarget: string | null = null;
let originalTitle: string | null = null;
let batchQueue: TranslateBatchQueue | null = null;

// Navigation
let lastLocationKey = getLocationKey();
let lastTranslateInput: PageTranslateCommand | null = null;
let navigationTimer: number | undefined;

// Per-node state (WeakMaps don't leak)
const processedNodes = new WeakMap<HTMLElement, ResolvedFullPageRule>();
const hostWrappers = new WeakMap<HTMLElement, Set<HTMLElement>>();
const wrapperState = new WeakMap<HTMLElement, WrapperState>();
const selectStyleAttrs = new WeakMap<HTMLElement, { original: string | null; count: number }>();
const parentStyleAttrs = new WeakMap<HTMLElement, { original: string | null; count: number }>();
const grandStyleAttrs = new WeakMap<HTMLElement, { original: string | null; count: number }>();

// Live node sets
const observedNodes = new Set<HTMLElement>();
const viewNodes = new Set<HTMLElement>();
const rootNodes = new Set<ParentNode>();
const translatedHosts = new Set<HTMLElement>();
const rescanQueue = new Set<Node>();

// Mutation guard
const mutedMutationRoots = new Set<Node>();

// ── Entry point ───────────────────────────────────────────────────────────────

export function initFullPage(): void {
  installNavigationWatcher();
  ensureObservers();

  onMessage("runPageTranslate", async (input) => {
    pruneDisconnectedNodes();
    if (isStaleCommand(input.commandId)) return buildAck(false);
    applyCommandId(input.commandId);

    const mode = input.mode ?? "replace";
    const key = `${input.engine}|${input.target}`;
    if (canSwitchMode(key)) {
      switchAppliedMode(mode);
      return buildAck(true);
    }

    return startPageTranslate({ ...input, mode });
  });

  onMessage("runPageRestore", (input) => {
    if (isStaleCommand(input.commandId)) return getStatus();
    applyCommandId(input.commandId);
    restoreOriginals();
    return getStatus();
  });

  onMessage("readPageTranslateStatus", () => getStatus());
}

function isStaleCommand(id: number | undefined): boolean {
  return id !== undefined && id < lastCommandId;
}

function applyCommandId(id: number | undefined): void {
  if (id !== undefined && id > lastCommandId) lastCommandId = id;
}

async function startPageTranslate(input: PageTranslateCommand): Promise<PageTranslateAck> {
  if (navigationTimer !== undefined) {
    window.clearTimeout(navigationTimer);
    navigationTimer = undefined;
  }

  const mode = input.mode ?? "replace";
  currentMode = mode;
  currentEngine = input.engine;
  currentTarget = input.target;
  lastTranslateInput = { target: input.target, engine: input.engine, mode };

  currentRule = await loadRule(input);
  ensureSiteLayoutStyles();

  const seq = ++runSeq;
  pendingCount = 0;

  cleanupAllTranslations();
  stopObservation();

  batchQueue?.destroy();
  batchQueue = new TranslateBatchQueue(currentRule.engine, currentRule.target, currentRule.source);

  startObserveRoots();
  void updateDocumentTitle(seq).catch(() => {});
  requeueVisibleNodes();

  return buildAck(true);
}

function restoreOriginals(): void {
  runSeq++;
  currentMode = null;
  currentEngine = null;
  currentTarget = null;
  lastTranslateInput = null;
  pendingCount = 0;

  if (navigationTimer !== undefined) {
    window.clearTimeout(navigationTimer);
    navigationTimer = undefined;
  }

  restoreDocumentTitle();
  cleanupAllTranslations();
  stopObservation();
  batchQueue?.destroy();
  batchQueue = null;
  currentRule = null;
  removeSiteLayoutStyles();
}

async function loadRule(input: PageTranslateCommand): Promise<ResolvedFullPageRule> {
  const userRules = await getFullPageRules();
  const matched = matchFullPageRule(window.location.href, userRules);
  return resolveFullPageRule(matched, input);
}

// ── Observer setup ────────────────────────────────────────────────────────────

function ensureObservers(): void {
  if (!intersectionObserver) {
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const node = entry.target;
          if (!(node instanceof HTMLElement)) continue;
          if (entry.isIntersecting) {
            viewNodes.add(node);
            if (currentRule && !processedNodes.has(node)) {
              void scheduleProcessNode(node, runSeq);
            }
          } else {
            viewNodes.delete(node);
          }
        }
      },
      { threshold: 0.01, rootMargin: "500px 0px 500px 0px" },
    );
  }

  if (!mutationObserver) {
    mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (shouldIgnoreMutationNode(mutation.target)) continue;

        if (mutation.type === "characterData") {
          if (
            mutation.oldValue !== mutation.target.nodeValue &&
            mutation.target.parentElement
          ) {
            queueRescan(mutation.target.parentElement);
          }
          continue;
        }

        if (mutation.type !== "childList") continue;
        let hasText = false;
        for (const added of mutation.addedNodes) {
          if (shouldIgnoreMutationNode(added)) continue;
          if (added.nodeType === Node.TEXT_NODE) { hasText = true; continue; }
          if (!(added instanceof Element)) continue;
          const shadow = getOpenOrClosedShadowRoot(added);
          if (shadow) startObserveShadowRoot(shadow);
          queueRescan(added);
        }
        if (hasText && mutation.target instanceof HTMLElement) {
          queueRescan(mutation.target);
        }
      }
    });
  }
}

function startObserveRoots(): void {
  if (!currentRule) return;
  ensureObservers();
  const selector = currentRule.rootsSelector || "body";
  const roots = querySelectorAllSafe(document, selector)
    .filter((r): r is HTMLElement => r instanceof HTMLElement);
  const targets = roots.length > 0 ? roots : [document.body].filter(Boolean) as HTMLElement[];
  targets.forEach(startObserveRoot);
  if (currentRule.scanAll || currentRule.hasShadowroot) {
    findAndObserveShadowRoots(document.body);
  }
}

function startObserveRoot(root: ParentNode): void {
  if (rootNodes.has(root) || !mutationObserver) return;
  rootNodes.add(root);
  mutationObserver.observe(root, {
    childList: true, subtree: true, characterData: true, characterDataOldValue: true,
  });
  if (currentRule?.hasShadowroot && root instanceof Element) {
    findAndObserveShadowRoots(root);
  }
  scanNode(root);
}

function startObserveShadowRoot(root: ShadowRoot): void {
  if (!rootNodes.has(root)) startObserveRoot(root);
}

// ── DOM Scan (mirrors kiss-translator #scanNode / #queryNode) ─────────────────

function scanNode(rootNode: ParentNode): void {
  if (!currentRule) return;
  if (rootNode instanceof HTMLElement && shouldIgnoreNode(rootNode)) return;

  if (!currentRule.autoScan) {
    queryNodes(rootNode);
    return;
  }

  if (rootNode instanceof HTMLElement) {
    const hasText = hasDirectText(rootNode);

    // Kiss optimisation: single-child wrapper — descend immediately
    if (!hasText && rootNode.children.length === 1) {
      const child = rootNode.children.item(0);
      if (child) scanNode(child);
      return;
    }

    const hasBlock = hasBlockNode(rootNode);
    // Node has direct text OR no block children → treat as a translatable unit
    if (hasText || !hasBlock) startObserveNode(rootNode);
    // Descend into block children
    if (hasBlock) {
      for (const child of Array.from(rootNode.children)) {
        if (!hasText || isBlockNode(child)) scanNode(child);
      }
    }
    return;
  }

  // DocumentFragment / ShadowRoot
  for (const child of Array.from(rootNode.childNodes)) {
    if (child instanceof HTMLElement) scanNode(child);
  }
}

function queryNodes(rootNode: ParentNode): void {
  if (!currentRule?.selector) return;
  const sel = currentRule.selector;
  if (rootNode instanceof HTMLElement && matchesSelectorSafe(rootNode, sel)) {
    startObserveNode(rootNode);
  }
  querySelectorAllSafe(rootNode, sel).forEach((node) => {
    if (node instanceof HTMLElement) startObserveNode(node);
  });
}

function startObserveNode(node: HTMLElement): void {
  if (!currentRule || !intersectionObserver || shouldIgnoreNode(node)) return;
  applyRuleStyles(node);

  if (!observedNodes.has(node)) {
    observedNodes.add(node);
    intersectionObserver.observe(node);
  }

  if (processedNodes.has(node)) return; // already processed, IO will trigger sync if needed

  if (currentRule.scanAll || viewNodes.has(node) || isVisible(node)) {
    viewNodes.add(node);
    void scheduleProcessNode(node, runSeq);
  }
}

// ── Core processing (kiss-translator #processNode / #translateNodeGroup) ───────

async function scheduleProcessNode(node: HTMLElement, seq: number): Promise<void> {
  if (seq !== runSeq || !currentRule || !batchQueue) return;
  if (!node.isConnected || shouldIgnoreNode(node)) return;
  if (processedNodes.has(node)) return;

  processedNodes.set(node, currentRule);

  // Early out: if the entire textContent is junk, skip
  if (isInvalidText(node.textContent ?? "")) return;

  // Collect groups of consecutive non-break child nodes
  const childList = Array.from(node.childNodes).filter((c) => !isOurWrapper(c));
  const groups = collectNodeGroups(childList, node);

  for (const group of groups) {
    if (seq !== runSeq || !node.isConnected) return;
    await translateNodeGroup(group, node, seq);
  }
}

// Mirrors kiss-translator's inline node grouping in #processNode
function collectNodeGroups(childNodes: ChildNode[], host: HTMLElement): ChildNode[][] {
  const groups: ChildNode[][] = [];
  let current: ChildNode[] = [];

  for (const node of childNodes) {
    const shouldGroup =
      node.nodeType === Node.TEXT_NODE || node.nodeType === Node.ELEMENT_NODE;
    if (shouldGroup && !shouldBreakGroup(node, host)) {
      current.push(node);
    } else {
      if (current.length > 0) { groups.push(current); current = []; }
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

// Mirrors kiss-translator's #shouldBreak
function shouldBreakGroup(node: ChildNode, host: HTMLElement): boolean {
  if (!(node instanceof Element)) return false;
  if (!currentRule) return false;
  if (matchesSelectorSafe(node, currentRule.keepSelector)) return false;
  if (!(node instanceof HTMLElement)) {
    return BREAK_LINE_TAGS.has((node as Element).tagName);
  }
  if (BREAK_LINE_TAGS.has(node.tagName) || shouldIgnoreNode(node) || isOurWrapper(node)) {
    return true;
  }
  if (currentRule.autoScan && isBlockNode(node)) return true;
  if (!currentRule.autoScan && currentRule.selector) {
    if (matchesSelectorSafe(node, currentRule.selector)) return true;
    if (querySelectorAllSafe(node, currentRule.selector).length > 0) return true;
  }
  return false;
}

// Mirrors kiss-translator's #translateNodeGroup
async function translateNodeGroup(
  nodes: ChildNode[],
  host: HTMLElement,
  seq: number,
): Promise<void> {
  if (!currentRule || !batchQueue || seq !== runSeq) return;

  const { html: serialized, placeholders } = shouldUseRichHtmlSerialization(host)
    ? serializeNodesAsRichHtml(nodes)
    : serializeNodesForTranslation(nodes);
  if (!serialized || isInvalidText(serialized)) return;

  const transOnly = shouldUseTranslationOnly(currentMode ?? "replace");

  // Create wrapper and insert after last original node (kiss-translator pattern)
  const wrapper = createLoadingWrapper(serialized, transOnly);
  runWithMutedMutations(host, () => {
    const last = nodes[nodes.length - 1]!;
    if (last.parentNode === host) {
      last.after(wrapper);
    } else {
      host.appendChild(wrapper);
    }
    // transOnly: move original nodes off-screen (into a detached fragment)
    if (transOnly) moveNodesToFragment(nodes);
  });
  addHostWrapper(host, wrapper);
  wrapperState.set(wrapper, { nodes, isHide: transOnly });
  pendingCount++;

  try {
    const translated = await batchQueue.addTask(serialized);
    pendingCount = Math.max(0, pendingCount - 1);

    if (seq !== runSeq || !host.isConnected || !wrapper.isConnected) return;

    if (!translated) {
      runWithMutedMutations(host, () => {
        if (transOnly) restoreWrapperNodes(wrapper);
        wrapper.remove();
      });
      removeHostWrapper(host, wrapper);
      return;
    }

    // Replace skeleton with actual translation
    runWithMutedMutations(host, () => {
      const inner = wrapper.querySelector(`[${INNER_ATTR}]`) as HTMLElement | null;
      if (!inner) return;
      inner.removeAttribute("aria-busy");
      inner.textContent = "";
      appendTranslatedContent(inner, translated, placeholders);
    });
    translatedHosts.add(host);
  } catch (err) {
    pendingCount = Math.max(0, pendingCount - 1);
    if (seq === runSeq && wrapper.isConnected) {
      runWithMutedMutations(host, () => {
        if (transOnly) restoreWrapperNodes(wrapper);
        wrapper.remove();
      });
      removeHostWrapper(host, wrapper);
    }
    console.warn("[OneLingo] translateNodeGroup failed:", err);
  }
}

// ── Wrapper DOM management ────────────────────────────────────────────────────

function createLoadingWrapper(original: string, transOnly: boolean): HTMLElement {
  const rule = currentRule!;
  const wrapper = document.createElement("span");
  wrapper.setAttribute(WRAPPER_ATTR, "true");

  // Optional line-break before translation (hidden in transOnly, visible in bilingual)
  if (original.length > NEWLINE_LENGTH) {
    const br = document.createElement("br");
    br.hidden = transOnly;
    wrapper.appendChild(br);
  }

  const inner = document.createElement(rule.transTag);
  inner.setAttribute(INNER_ATTR, "true");
  inner.setAttribute("aria-busy", "true");
  inner.lang = rule.target;

  if (!transOnly) {
    inner.style.color = "#6b7280";
    inner.style.fontSize = "0.95em";
    inner.style.lineHeight = "1.55";
  }
  appendInlineStyle(inner, rule.textExtStyle);

  ensureLoadingStyles();
  appendLoadingLines(inner, original, false);
  wrapper.appendChild(inner);
  return wrapper;
}

function addHostWrapper(host: HTMLElement, wrapper: HTMLElement): void {
  let set = hostWrappers.get(host);
  if (!set) { set = new Set(); hostWrappers.set(host, set); }
  set.add(wrapper);
}

function removeHostWrapper(host: HTMLElement, wrapper: HTMLElement): void {
  hostWrappers.get(host)?.delete(wrapper);
  wrapperState.delete(wrapper);
}

function getHostWrappers(host: HTMLElement): HTMLElement[] {
  return Array.from(hostWrappers.get(host) ?? []);
}

function isOurWrapper(node: Node): boolean {
  return node instanceof Element && node.hasAttribute(WRAPPER_ATTR);
}

// Move nodes into a detached fragment (hides them; they can be restored)
function moveNodesToFragment(nodes: ChildNode[]): void {
  const frag = document.createDocumentFragment();
  nodes.forEach((n) => frag.appendChild(n));
}

// Restore nodes stored in a wrapper's state back before the wrapper
function restoreWrapperNodes(wrapper: HTMLElement): void {
  const state = wrapperState.get(wrapper);
  if (!state || !state.isHide) return;
  const parent = wrapper.parentElement;
  if (parent) {
    const frag = document.createDocumentFragment();
    state.nodes.forEach((n) => frag.appendChild(n));
    parent.insertBefore(frag, wrapper);
  }
  state.isHide = false;
}

// ── Mode switching ────────────────────────────────────────────────────────────

function canSwitchMode(translationKey: string): boolean {
  return (
    translatedHosts.size > 0 &&
    currentEngine !== null &&
    currentTarget !== null &&
    translationKey === `${currentEngine}|${currentTarget}`
  );
}

// Mirrors kiss-translator's #toggleTranslationOnly
function switchAppliedMode(mode: PageTranslateMode): void {
  currentMode = mode;
  if (currentRule) {
    currentRule = { ...currentRule, transOnly: mode === "replace" };
  }
  if (currentEngine !== null && currentTarget !== null) {
    lastTranslateInput = { target: currentTarget, engine: currentEngine, mode };
  }
  const transOnly = shouldUseTranslationOnly(mode);

  for (const host of Array.from(translatedHosts)) {
    if (!host.isConnected) continue;
    runWithMutedMutations(host, () => {
      for (const wrapper of getHostWrappers(host)) {
        if (!wrapper.isConnected) continue;
        const state = wrapperState.get(wrapper);
        if (!state) continue;

        // Toggle the line-break visibility
        const br = wrapper.querySelector(":scope > br");
        if (br instanceof HTMLElement) br.hidden = transOnly;

        // Show/hide original nodes
        if (transOnly && !state.isHide) {
          moveNodesToFragment(state.nodes);
          state.isHide = true;
        } else if (!transOnly && state.isHide) {
          const frag = document.createDocumentFragment();
          state.nodes.forEach((n) => frag.appendChild(n));
          wrapper.parentNode?.insertBefore(frag, wrapper);
          state.isHide = false;
        }

        // Adjust inner element styling
        const inner = wrapper.querySelector(`[${INNER_ATTR}]`) as HTMLElement | null;
        if (inner) {
          if (!transOnly) {
            inner.style.color = "#6b7280";
            inner.style.fontSize = "0.95em";
          } else {
            inner.style.removeProperty("color");
            inner.style.removeProperty("font-size");
          }
        }
      }
    });
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

// Mirrors kiss-translator's #cleanupAllNodes / #cleanupAllTranslations
function cleanupAllTranslations(): void {
  const hosts = new Set([...observedNodes, ...translatedHosts]);
  for (const host of hosts) cleanupHostNode(host);
  translatedHosts.clear();
}

// Mirrors kiss-translator's #removeTranslationElement
function cleanupHostNode(host: HTMLElement): void {
  runWithMutedMutations(host, () => {
    for (const wrapper of getHostWrappers(host)) {
      const state = wrapperState.get(wrapper);
      if (state?.isHide) restoreWrapperNodes(wrapper);
      wrapper.remove();
      wrapperState.delete(wrapper);
    }
    hostWrappers.delete(host);
    processedNodes.delete(host);
    restoreRuleStyles(host);
  });
  translatedHosts.delete(host);
}

function stopObservation(): void {
  if (rescanTimer !== undefined) { window.clearTimeout(rescanTimer); rescanTimer = undefined; }
  if (intersectionObserver) intersectionObserver.disconnect();
  if (mutationObserver) mutationObserver.disconnect();
  observedNodes.clear();
  viewNodes.clear();
  rootNodes.clear();
  rescanQueue.clear();
  pendingCount = 0;
}

// ── Rescan (mutation-driven, mirrors kiss-translator's #queueForRescan) ────────

function queueRescan(target: Node): void {
  if (!currentRule) return;
  rescanQueue.add(target);
  if (rescanTimer !== undefined) return;
  rescanTimer = window.setTimeout(() => {
    rescanTimer = undefined;
    for (const node of Array.from(rescanQueue)) {
      rescanQueue.delete(node);
      rescanContainer(node);
    }
  }, 100);
}

function rescanContainer(changedNode: Node): void {
  const container = findChangeContainer(changedNode);
  if (!container) return;
  cleanupHostNode(container);
  if (intersectionObserver) intersectionObserver.unobserve(container);
  observedNodes.delete(container);
  viewNodes.delete(container);
  scanNode(container);
}

function findChangeContainer(startNode: Node): HTMLElement | null {
  let current: Node | null = startNode;
  while (current && current !== document.body) {
    if (current instanceof HTMLElement && (observedNodes.has(current) || isBlockNode(current))) {
      for (const root of rootNodes) {
        if (root instanceof Node && root.contains(current)) return current;
      }
    }
    current = current.parentNode;
  }
  return null;
}

// ── Status / Ack ──────────────────────────────────────────────────────────────

function getStatus(): PageTranslateStatus {
  checkLocationChange();
  pruneDisconnectedNodes();
  const blocks = observedNodes.size > 0 ? observedNodes.size : translatedHosts.size;
  return {
    active: translatedHosts.size > 0 || pendingCount > 0,
    translating: pendingCount > 0,
    blocks,
    mode: currentMode ?? undefined,
    engine: currentEngine ?? undefined,
    target: currentTarget ?? undefined,
  };
}

function buildAck(accepted: boolean): PageTranslateAck {
  const status = getStatus();
  return { ...status, accepted };
}

function pruneDisconnectedNodes(): void {
  for (const node of Array.from(observedNodes)) {
    if (node.isConnected) continue;
    cleanupHostNode(node);
    if (intersectionObserver) intersectionObserver.unobserve(node);
    observedNodes.delete(node);
    viewNodes.delete(node);
  }
}

function requeueVisibleNodes(): void {
  for (const node of Array.from(observedNodes)) {
    if (node.isConnected && isVisible(node)) {
      viewNodes.add(node);
      void scheduleProcessNode(node, runSeq);
    }
  }
}

// ── Document title ────────────────────────────────────────────────────────────

async function updateDocumentTitle(seq: number): Promise<void> {
  if (!currentRule?.transTitle) return;
  const title = document.title.trim();
  if (!title) return;
  originalTitle ??= title;
  const res = await sendMessage("translate", {
    text: title,
    source: currentRule.source,
    target: currentRule.target,
    engine: currentRule.engine,
  });
  if (seq !== runSeq) return;
  document.title = res.text;
}

function restoreDocumentTitle(): void {
  if (!originalTitle) return;
  document.title = originalTitle;
  originalTitle = null;
}

// ── Navigation watcher ────────────────────────────────────────────────────────

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
  pruneDisconnectedNodes();
  if (!input) return;

  runSeq++;
  pendingCount = 0;
  restoreDocumentTitle();
  cleanupAllTranslations();
  stopObservation();
  batchQueue?.destroy();
  batchQueue = null;
  currentRule = null;
  removeSiteLayoutStyles();

  if (navigationTimer !== undefined) window.clearTimeout(navigationTimer);
  navigationTimer = window.setTimeout(() => {
    navigationTimer = undefined;
    if (!lastTranslateInput) return;
    void startPageTranslate(lastTranslateInput).catch((error) => {
      console.warn("[OneLingo] navigation retranslate failed:", error);
    });
  }, NAVIGATION_RETRANSLATE_DELAY_MS);
}

// ── Text serialisation (kiss-translator #serializeForTranslation) ─────────────

// Single-brace placeholders match kiss-translator's default "{ }" delimiter format.
// Some engines normalize "{{1}}" into "{1}", breaking double-brace restoration.
// Single braces "{1}" are more stable across the plain-text fallback path.
const PLACEHOLDER_START = "{";
const PLACEHOLDER_END = "}";
const PLACEHOLDER_RE = /\{\d+\}/g;
const PLACEHOLDER_TAG = "i";
const PLACEHOLDER_SAFE_TAG = "span";
// Compact format: <i1>content</i1> — matches kiss-translator's default placetagFormat.
// Attribute forms like <i i=1> can be confused with opaque placeholders by engines;
// compact tags keep wrapped ranges visually distinct from "{N}" replace tokens.
const PLACEHOLDER_OPEN_RE = /<i(\d+)>/gi;
const PLACEHOLDER_CLOSE_RE = /<\/i\d+>/gi;
const PRESERVE_HTML_ATTR = "data-onelingo-preserve";

function serializeNodesForTranslation(nodes: Iterable<Node>): {
  html: string;
  placeholders: PlaceholderMap;
} {
  let replaceCounter = 0;
  let wrapCounter = 0;
  const placeholders: PlaceholderMap = new Map();

  const pushReplace = (html: string): string => {
    replaceCounter++;
    const key = `${PLACEHOLDER_START}${replaceCounter}${PLACEHOLDER_END}`;
    placeholders.set(key, html);
    return key;
  };

  const traverse = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.nodeValue ?? "").replace(/\r?\n/g, () => pushReplace("&#10;"));
      return escapeHtml(text);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const el = node as HTMLElement;

    // Excluded sub-trees (noise text: edit links, screen-reader-only text, etc.)
    if (shouldDropNodeFromSerialization(el)) return "";

    // BUILTIN_IGNORE_SELECTOR → replace whole element as opaque placeholder
    if (shouldIgnoreNodeForSerialization(el)) {
      return pushReplace(el.outerHTML);
    }

    if (
      shouldPreserveNode(el) ||
      (currentRule?.hasRichText && RICH_TEXT_REPLACE_TAGS.has(el.tagName)) ||
      matchesSelectorSafe(el, currentRule?.keepSelector ?? "") ||
      !el.textContent?.trim()
    ) {
      if (el.tagName === "IMG" || el.tagName === "SVG") {
        el.style.width = `${el.offsetWidth}px`;
        el.style.height = `${el.offsetHeight}px`;
      }
      return pushReplace(el.outerHTML);
    }

    let innerContent = "";
    el.childNodes.forEach((child) => { innerContent += traverse(child); });

    if (currentRule?.hasRichText && RICH_TEXT_WRAP_TAGS.has(el.tagName)) {
      wrapCounter++;
      placeholders.set(`TAG_${wrapCounter}`, {
        openTag: buildOpeningTag(el),
        closeTag: `</${el.localName}>`,
      });
      return `<${PLACEHOLDER_TAG}${wrapCounter}>${innerContent}</${PLACEHOLDER_TAG}${wrapCounter}>`;
    }

    return innerContent;
  };

  const html = Array.from(nodes).map(traverse).join("").trim();
  return { html, placeholders };
}

function serializeNodesAsRichHtml(nodes: Iterable<Node>): {
  html: string;
  placeholders: PlaceholderMap;
} {
  let preserveCounter = 0;
  const placeholders: PlaceholderMap = new Map();

  const preserveHtml = (el: HTMLElement): string => {
    preserveCounter++;
    const clone = el.cloneNode(true) as HTMLElement;
    clone.setAttribute("translate", "no");
    clone.setAttribute(PRESERVE_HTML_ATTR, String(preserveCounter));
    placeholders.set(`HTML_${preserveCounter}`, el.outerHTML);
    return clone.outerHTML;
  };

  const traverse = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.nodeValue ?? "");
    if (!(node instanceof HTMLElement)) return "";
    if (shouldDropNodeFromSerialization(node)) return "";
    if (shouldPreserveNode(node)) return preserveHtml(node);
    if (node.tagName === "BR" || node.tagName === "WBR") return " ";
    if (node.tagName === "IMG" || node.tagName === "SVG") return node.outerHTML;
    if (shouldSkipInlineTextNode(node)) return "";
    if (shouldIgnoreNodeForSerialization(node)) return preserveHtml(node);

    const inner = Array.from(node.childNodes).map(traverse).join("");
    if (!inner.trim()) return "";
    if (!RICH_HTML_INLINE_TAGS.has(node.tagName)) return inner;
    return `${buildRichHtmlOpeningTag(node)}${inner}</${node.localName}>`;
  };

  const html = normalizeInlineText(Array.from(nodes).map(traverse).join(""));
  placeholders.set("__html__", "");
  return { html, placeholders };
}

function shouldUseRichHtmlSerialization(host: HTMLElement): boolean {
  return (currentEngine === "google2" || currentEngine === "microsoft") &&
    !!currentRule?.hasRichText &&
    (!isWikipediaMainPage() ||
      !!host.closest("#mp-tfa, #mp-tfl, #mp-dyk, #mp-itn, #mp-otd, #mp-tfp"));
}

function buildRichHtmlOpeningTag(el: HTMLElement): string {
  if (el.tagName !== "A") return `<${el.localName}>`;

  const attrs: string[] = [];
  const href = el.getAttribute("href");
  const title = el.getAttribute("title");
  if (href && isSafeLinkHref(href)) attrs.push(`href="${escapeHtmlAttr(href)}"`);
  if (title) attrs.push(`title="${escapeHtmlAttr(title)}"`);

  return `<${el.localName}${attrs.length > 0 ? ` ${attrs.join(" ")}` : ""}>`;
}

function shouldPreserveNode(el: HTMLElement): boolean {
  return matchesSelectorSafe(el, OPAQUE_PRESERVE_SELECTOR);
}

function shouldDropNodeFromSerialization(el: Element): boolean {
  return matchesSelectorSafe(el, EXCLUDE_TEXT_SELECTOR);
}

function shouldIgnoreNodeForSerialization(el: Element): boolean {
  return matchesSelectorSafe(el, BUILTIN_IGNORE_SELECTOR);
}

function isSafeLinkHref(href: string): boolean {
  return !/^(?:javascript|data|vbscript):/i.test(href.trim());
}

function restoreFromTranslation(translatedText: string, placeholders: PlaceholderMap): string {
  if (!translatedText || placeholders.size === 0) return translatedText;

  const restoreAttr = "data-onelingo-restore";
  let textToParse = translatedText;
  let result = translatedText;

  try {
    textToParse = textToParse.replace(
      PLACEHOLDER_OPEN_RE,
      `<${PLACEHOLDER_SAFE_TAG} ${restoreAttr}="$1">`,
    );
    textToParse = textToParse.replace(PLACEHOLDER_CLOSE_RE, `</${PLACEHOLDER_SAFE_TAG}>`);

    const parser = new DOMParser();
    const doc = parser.parseFromString(textToParse, "text/html");
    const nodes = Array.from(
      doc.querySelectorAll(`${PLACEHOLDER_SAFE_TAG}[${restoreAttr}]`),
    );

    nodes.reverse().forEach((node) => {
      const index = node.getAttribute(restoreAttr);
      if (!index) return;
      const value = placeholders.get(`TAG_${index}`);
      if (!isWrappedPlaceholder(value)) return;
      node.outerHTML = `${value.openTag}${node.innerHTML}${value.closeTag}`;
    });

    Array.from(doc.querySelectorAll(`[${PRESERVE_HTML_ATTR}]`)).reverse().forEach((node) => {
      const index = normalizeRestoreIndex(node.getAttribute(PRESERVE_HTML_ATTR));
      if (!index) return;
      const value = placeholders.get(`HTML_${index}`);
      if (typeof value !== "string") return;
      node.outerHTML = value;
    });

    result = doc.body.innerHTML;
  } catch {
    result = translatedText;
  }

  return result.replace(PLACEHOLDER_RE, (key) => {
    const value = placeholders.get(key);
    return typeof value === "string" ? value : key;
  });
}

function buildOpeningTag(node: HTMLElement): string {
  const escapeAttr = (s: string): string => s.replace(/"/g, "&quot;");
  let tag = `<${node.tagName.toLowerCase()}`;
  for (const attr of Array.from(node.attributes)) {
    tag += ` ${attr.name}="${escapeAttr(attr.value)}"`;
  }
  return tag + ">";
}

function normalizeRestoreIndex(value: string | null): string | null {
  const match = value?.match(/\d+/);
  return match?.[0] ?? null;
}

function isWrappedPlaceholder(
  value: string | WrappedPlaceholder | undefined,
): value is WrappedPlaceholder {
  return !!value && typeof value !== "string";
}

// ── Translation rendering ─────────────────────────────────────────────────────

const MARKER_JUNK_RE =
  /<\/?\s*(?:a|b|i)\b[^>]{0,80}>|(?:data-|#)i\s*=?\s*["'""''`]{0,2}\d+["'""''`]{0,2}>?|\{\d+\}/gi;

function cleanMarkerJunk(text: string): string {
  return decodeHtmlEntities(text).replace(MARKER_JUNK_RE, "").replace(/\s{2,}/g, " ");
}

let entityDecoder: HTMLTextAreaElement | null = null;
function decodeHtmlEntities(s: string): string {
  if (!/&[#\w]+;/.test(s)) return s;
  if (!entityDecoder) entityDecoder = document.createElement("textarea");
  entityDecoder.innerHTML = s;
  return entityDecoder.value;
}

function appendTranslatedContent(
  container: HTMLElement,
  translated: string,
  placeholders: PlaceholderMap,
): void {
  if (!placeholders || placeholders.size === 0) {
    container.textContent = cleanMarkerJunk(translated);
    return;
  }
  const html = restoreFromTranslation(translated, placeholders);
  if (!html.trim()) return;
  const template = document.createElement("template");
  template.innerHTML = html;
  container.appendChild(template.content.cloneNode(true));
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function appendLoadingLines(container: HTMLElement, original: string, inline: boolean): void {
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
  container.style.setProperty("--onelingo-loading-base", getLoadingPalette().base);
  container.style.setProperty("--onelingo-loading-flow", getLoadingPalette().flow);
}

function getLoadingLineCount(text: string): number {
  const len = text.replace(/\s+/g, " ").trim().length;
  if (len < 32) return 1;
  if (len < 110) return 2;
  if (len < 220) return 3;
  return 4;
}

function getBlockLoadingWidth(text: string, index: number, total: number): string {
  if (total === 1) return `${Math.min(Math.max(text.length * 1.7, 18), 72)}%`;
  if (index === total - 1) return `${Math.min(Math.max(38 + (text.length % 28), 34), 72)}%`;
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
  const bg = getSurfaceColor(document.body) ?? getSurfaceColor(document.documentElement);
  if (bg) {
    const luminance = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255;
    if (luminance < 0.45) {
      return { base: "rgba(255,255,255,0.09)", flow: "rgba(255,255,255,0.18)" };
    }
  }
  return { base: "rgba(0,0,0,0.055)", flow: "rgba(0,0,0,0.11)" };
}

function getSurfaceColor(el: HTMLElement | null): [number, number, number] | null {
  if (!el) return null;
  const match = window.getComputedStyle(el).backgroundColor.match(
    /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([0-9.]+))?\)/,
  );
  if (!match) return null;
  const alpha = match[4] ? parseFloat(match[4]) : 1;
  if (alpha === 0) return null;
  return [parseInt(match[1]!), parseInt(match[2]!), parseInt(match[3]!)];
}

function ensureLoadingStyles(): void {
  if (document.getElementById(LOADING_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = LOADING_STYLE_ID;
  style.textContent = `
[${WRAPPER_ATTR}] [${INNER_ATTR}][aria-busy="true"] {
  contain: content;
  pointer-events: none;
  user-select: none;
}
[${WRAPPER_ATTR}] [${INNER_ATTR}][aria-busy="true"] .onelingo-immersive-loading-line {
  display: block;
  height: 0.92em;
  min-height: 0.72rem;
  margin: 0.38em 0;
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
  animation: onelingo-loading-flow 2s linear infinite;
}
@keyframes onelingo-loading-flow { to { background-position: -120% 0; } }
@media (prefers-reduced-motion: reduce) {
  [${WRAPPER_ATTR}] [${INNER_ATTR}] .onelingo-immersive-loading-line {
    animation: none;
    background-position: 50% 0;
  }
}`;
  (document.head ?? document.documentElement).appendChild(style);
}

function ensureSiteLayoutStyles(): void {
  if (!isWikipediaMainPage()) return;
  if (document.getElementById(MAIN_PAGE_LAYOUT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = MAIN_PAGE_LAYOUT_STYLE_ID;
  style.textContent = `
#mp-upper {
  min-width: 0 !important;
  max-width: 100% !important;
  overflow-x: clip !important;
}
#mp-left,
#mp-right {
  min-width: 0 !important;
  max-width: 100% !important;
  overflow-wrap: anywhere !important;
}
#mp-left {
  flex: 55 1 0 !important;
}
#mp-right {
  flex: 45 1 0 !important;
}
#mp-left [${WRAPPER_ATTR}],
#mp-right [${WRAPPER_ATTR}],
#mp-left [${INNER_ATTR}],
#mp-right [${INNER_ATTR}] {
  white-space: normal !important;
  overflow-wrap: anywhere !important;
  word-break: break-word !important;
}`;
  (document.head ?? document.documentElement).appendChild(style);
}

function removeSiteLayoutStyles(): void {
  document.getElementById(MAIN_PAGE_LAYOUT_STYLE_ID)?.remove();
}

function isWikipediaMainPage(): boolean {
  return window.location.hostname === "en.wikipedia.org" &&
    window.location.pathname === "/wiki/Main_Page";
}

// ── Rule styles ───────────────────────────────────────────────────────────────

function applyRuleStyles(node: HTMLElement): void {
  if (!currentRule) return;
  applyRuleStyle(node, currentRule.selectStyle, selectStyleAttrs);
  applyRuleStyle(node.parentElement, currentRule.parentStyle, parentStyleAttrs);
  applyRuleStyle(
    node.parentElement?.parentElement ?? null, currentRule.grandStyle, grandStyleAttrs,
  );
}

function restoreRuleStyles(node: HTMLElement): void {
  restoreRuleStyle(node, selectStyleAttrs);
  restoreRuleStyle(node.parentElement, parentStyleAttrs);
  restoreRuleStyle(node.parentElement?.parentElement ?? null, grandStyleAttrs);
}

function applyRuleStyle(
  el: HTMLElement | null,
  cssText: string,
  cache: WeakMap<HTMLElement, { original: string | null; count: number }>,
): void {
  if (!el || !cssText.trim()) return;
  const existing = cache.get(el);
  if (existing) { existing.count++; return; }
  cache.set(el, { original: el.getAttribute("style"), count: 1 });
  appendInlineStyle(el, cssText);
}

function restoreRuleStyle(
  el: HTMLElement | null,
  cache: WeakMap<HTMLElement, { original: string | null; count: number }>,
): void {
  if (!el) return;
  const state = cache.get(el);
  if (!state) return;
  if (--state.count > 0) return;
  if (state.original === null) {
    el.removeAttribute("style");
  } else {
    el.setAttribute("style", state.original);
  }
  cache.delete(el);
}

function appendInlineStyle(el: HTMLElement, cssText: string): void {
  const patch = cssText.trim();
  if (!patch) return;
  const base = el.getAttribute("style")?.trim();
  el.setAttribute("style", base ? `${base}${base.endsWith(";") ? "" : ";"} ${patch}` : patch);
}

// ── DOM utilities (mirrors kiss-translator static helpers) ────────────────────

function shouldUseTranslationOnly(mode: PageTranslateMode): boolean {
  return mode === "replace" || currentRule?.transOnly === true;
}

// Kiss-translator's #isInvalidText
function isInvalidText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < TRANS_MIN_LENGTH || trimmed.length > TRANS_MAX_LENGTH) return true;
  if (trimmed.length === 1 && !/[a-zA-Z]/.test(trimmed)) return true;
  if (!Number.isNaN(parseFloat(trimmed)) && Number.isFinite(Number(trimmed))) return true;
  return COMBINED_SKIP_RE.test(trimmed);
}

// Kiss-translator's isBlockNode (with displayCache)
function isBlockNode(node: Node): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (INLINE_TAGS.has(node.tagName)) return false;
  if (BLOCK_TAGS.has(node.tagName)) return true;
  if (displayCache.has(node)) return displayCache.get(node)!;
  const display = window.getComputedStyle(node).display;
  const isBlock = !display.startsWith("inline") &&
    /^(block|flex|grid|list-item|table)/.test(display);
  displayCache.set(node, isBlock);
  return isBlock;
}

// Kiss-translator's hasTextNode (direct non-empty text nodes)
function hasDirectText(el: HTMLElement): boolean {
  return Array.from(el.childNodes).some(
    (c) => c.nodeType === Node.TEXT_NODE && /\S/.test(c.nodeValue ?? ""),
  );
}

// Kiss-translator's hasBlockNode
function hasBlockNode(el: HTMLElement): boolean {
  return Array.from(el.childNodes).some((c) => isBlockNode(c));
}

// Kiss-translator's shouldIgnoreNode equivalent
function shouldIgnoreNode(el: HTMLElement): boolean {
  if (isOurUiNode(el)) return true;
  if (HARD_SKIP_TAGS.has(el.tagName)) return true;
  if (el.isContentEditable) return true;
  if (el.closest(SKIP_ANCESTOR_SELECTOR)) return true;
  if (!currentRule) return false;
  // Check rule's ignoreSelector (plus the built-in one when autoScan is on)
  const ignore = buildIgnoreSelector();
  if (ignore && matchesSelectorSafe(el, ignore)) return true;
  if (ignore && closestSelectorSafe(el, ignore)) return true;
  return false;
}

function buildIgnoreSelector(): string {
  if (!currentRule) return BUILTIN_IGNORE_SELECTOR;
  const parts: string[] = [BUILTIN_IGNORE_SELECTOR];
  if (currentRule.ignoreSelector.trim()) parts.push(currentRule.ignoreSelector);
  return parts.join(", ");
}

function isOurUiNode(el: Element): boolean {
  return (
    el.hasAttribute(WRAPPER_ATTR) ||
    el.hasAttribute(INNER_ATTR) ||
    !!el.closest(`[data-onelingo-tooltip],[data-onelingo-host],[${WRAPPER_ATTR}]`)
  );
}

function isVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  if (el.getClientRects().length > 0) return true;
  if (el.offsetParent !== null) return true;
  return style.position === "fixed" || style.position === "sticky" || style.position === "absolute";
}

function shouldIgnoreMutationNode(node: Node): boolean {
  if (node instanceof Element && isOurUiNode(node)) return true;
  for (const root of mutedMutationRoots) {
    if (root === node || root.contains(node)) return true;
  }
  return false;
}

function runWithMutedMutations(root: Node, run: () => void): void {
  mutedMutationRoots.add(root);
  try { run(); } finally {
    window.setTimeout(() => mutedMutationRoots.delete(root), 0);
  }
}

// ── Shadow DOM ────────────────────────────────────────────────────────────────

function getOpenOrClosedShadowRoot(element: Element): ShadowRoot | null {
  const ff = (element as Element & { openOrClosedShadowRoot?: ShadowRoot | null })
    .openOrClosedShadowRoot;
  if (ff) return ff;
  const chromeFn = (
    globalThis as typeof globalThis & {
      chrome?: { dom?: { openOrClosedShadowRoot?: (el: Element) => ShadowRoot | null } };
    }
  ).chrome?.dom?.openOrClosedShadowRoot;
  if (chromeFn) return chromeFn(element);
  return element.shadowRoot;
}

function findAndObserveShadowRoots(root: ParentNode): void {
  for (const el of root.querySelectorAll("*")) {
    const shadow = getOpenOrClosedShadowRoot(el);
    if (!shadow) continue;
    startObserveShadowRoot(shadow);
    findAndObserveShadowRoots(shadow);
  }
}

// ── CSS selector helpers ──────────────────────────────────────────────────────

function matchesSelectorSafe(el: Element, selector: string): boolean {
  const s = selector.trim();
  if (!s) return false;
  try { return el.matches(s); } catch { return false; }
}

function closestSelectorSafe(el: Element, selector: string): Element | null {
  const s = selector.trim();
  if (!s) return null;
  try { return el.closest(s); } catch { return null; }
}

function querySelectorAllSafe(root: ParentNode, selector: string): Element[] {
  const s = selector.trim();
  if (!s) return [];
  try { return Array.from(root.querySelectorAll(s)); } catch { return []; }
}

// ── Misc ──────────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function normalizeInlineText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function getVisibleInlineText(root: Node): string {
  const parts: string[] = [];

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.nodeValue ?? "");
      return;
    }
    if (!(node instanceof Element)) return;
    if (shouldSkipInlineTextNode(node)) return;
    if (node.tagName === "BR" || node.tagName === "WBR") {
      parts.push(" ");
      return;
    }
    node.childNodes.forEach(visit);
    if (BLOCK_TAGS.has(node.tagName)) parts.push(" ");
  };

  visit(root);
  return normalizeInlineText(parts.join(""));
}

function shouldSkipInlineTextNode(el: Element): boolean {
  if (shouldDropNodeFromSerialization(el)) return true;
  if (HARD_SKIP_TAGS.has(el.tagName)) return true;
  return false;
}
