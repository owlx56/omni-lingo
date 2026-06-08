// 全文翻译核心逻辑 — 参照 kiss-translator 实现
// 核心差异保留：使用 onelingo 的 LRU + IndexedDB 二级缓存（通过 translateBatch 消息）

import type { TranslateFormat } from "@/engines/types";
import {
  onMessage,
  sendMessage,
  type PageTranslateAck,
  type PageTranslateCommand,
  type PageTranslatePrefs,
  type PageTranslateStatus,
} from "@/lib/messaging";
import { getFullPageRules } from "@/lib/storage/full-page-rules";
import {
  getSettings,
  resolveTargetLang,
  watchSettings,
  type FullPageEngineId,
  type FullPageMode,
  type Settings,
} from "@/lib/storage/settings";
import { buildTranslationStyleCss } from "@/lib/translation-style";
import { INNER_ATTR, WRAPPER_ATTR } from "./dom-attrs";
import {
  appendTranslatedContent,
  pickSerializeFormat,
  serializeNodes,
} from "./markup";
import {
  matchFullPageRule,
  resolveFullPageRule,
  type ResolvedFullPageRule,
} from "./rules";
import { matchesSelectorSafe, querySelectorAllSafe } from "./selectors";
import {
  appendInlineStyle,
  applyRuleStyles,
  isBlockNode,
  isOurUiNode,
  isOurWrapper,
  isVisible,
  restoreRuleStyles,
  scanNode,
  shouldIgnoreNode,
  type ScanContext,
} from "./scan";

// ── Constants ─────────────────────────────────────────────────────────────────
const BATCH_INTERVAL = 400; // ms debounce before sending batch
const BATCH_SIZE = 10; // max texts per API call
const BATCH_CONCURRENCY = 3;
const BATCH_MAX_LENGTH = 10_000; // max chars per API call
const TRANS_MIN_LENGTH = 2; // kiss-translator default
const TRANS_MAX_LENGTH = 100_000;
const NEWLINE_LENGTH = 20; // add <br> separator if text > 20 chars
const NAVIGATION_CHECK_MS = 500;
const NAVIGATION_RETRANSLATE_DELAY_MS = 800;
const VIRTUAL_LAYOUT_REFRESH_DELAY_MS = 80;

const LOADING_STYLE_ID = "onelingo-immersive-loading-style";
const MAIN_PAGE_LAYOUT_STYLE_ID = "onelingo-wikipedia-main-page-layout-style";
const HIDDEN_ORIGINAL_ATTR = "data-onelingo-hidden-original";
const SINGLE_MODE_TOGGLE_ATTR = "data-onelingo-single-mode-toggle";
const ORIGINAL_PEEK_ATTR = "data-onelingo-original-peek";
const LOADING_BASE_VAR = "--onelingo-loading-base";
const LOADING_FLOW_VAR = "--onelingo-loading-flow";
const INLINE_RUN_SEPARATOR_RE = /^[\s,.;:|/\\()[\]{}·•●‧・\-–—←→]+$/u;
const INLINE_RUN_TRANSLATION_SEPARATOR = " · ";
const INTERACTIVE_HOST_SELECTOR = [
  "a[href]",
  "button",
  "label",
  "summary",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='tab']",
  "[onclick]",
].join(", ");
const SINGLE_MODE_TOGGLE_IGNORE_SELECTOR = [
  INTERACTIVE_HOST_SELECTOR,
  "input",
  "textarea",
  "select",
  "option",
  "audio",
  "video",
  "[contenteditable]:not([contenteditable='false'])",
].join(", ");

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

// ── Types ─────────────────────────────────────────────────────────────────────
type PageTranslateMode = NonNullable<PageTranslateCommand["mode"]>;
type OriginalHideMode = "detached" | "collapsed";
type SingleModeView = "translation" | "original";

interface WrapperState {
  nodes: ChildNode[];
  isHide: boolean;
  host: HTMLElement;
  hideMode?: OriginalHideMode;
  hiddenOriginal?: HTMLElement;
  singleModeView?: SingleModeView;
}

interface InlineSiblingRun {
  host: HTMLElement;
  nodes: ChildNode[];
  processedHosts: HTMLElement[];
  format?: TranslateFormat;
  separator?: string;
}

const QUEUE_DESTROYED_ERROR = "Queue destroyed";

// ── BatchQueue (kiss-translator batchQueue.js pattern) ────────────────────────
interface BatchTask {
  text: string;
  resolve: (result: string) => void;
  reject: (err: unknown) => void;
}

class TranslateBatchQueue {
  private readonly queue: BatchTask[] = [];
  private timer: number | undefined;
  private activeCount = 0;

  constructor(
    readonly engine: string,
    readonly target: string,
    readonly source: string | undefined,
    readonly format: TranslateFormat,
  ) {}

  addTask(text: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.push({ text, resolve, reject });
      if (this.queue.length >= BATCH_SIZE) {
        this.drain(false);
      } else {
        this.schedule();
      }
    });
  }

  private schedule(): void {
    if (this.timer === undefined && this.queue.length > 0) {
      this.timer = window.setTimeout(() => {
        this.timer = undefined;
        this.drain(true);
      }, BATCH_INTERVAL);
    }
  }

  private drain(force: boolean): void {
    if (this.queue.length === 0 || this.activeCount >= BATCH_CONCURRENCY) {
      return;
    }

    if (
      this.timer !== undefined &&
      (force || this.queue.length >= BATCH_SIZE)
    ) {
      window.clearTimeout(this.timer);
      this.timer = undefined;
    }

    while (this.activeCount < BATCH_CONCURRENCY && this.queue.length > 0) {
      if (!force && this.queue.length < BATCH_SIZE) break;

      const batch = this.takeBatch();
      if (batch.length === 0) break;

      this.activeCount++;
      void this.flush(batch);
      if (this.queue.length < BATCH_SIZE) force = false;
    }

    if (this.queue.length > 0) this.schedule();
  }

  private takeBatch(): BatchTask[] {
    // Collect batch respecting size + length limits
    const batch: BatchTask[] = [];
    let totalLen = 0;
    for (const task of this.queue) {
      if (
        batch.length >= BATCH_SIZE ||
        (batch.length > 0 && totalLen + task.text.length > BATCH_MAX_LENGTH)
      )
        break;
      totalLen += task.text.length;
      batch.push(task);
    }
    this.queue.splice(0, batch.length);
    return batch;
  }

  private async flush(batch: BatchTask[]): Promise<void> {
    try {
      const results = await sendMessage("translateBatch", {
        texts: batch.map((t) => t.text),
        target: this.target,
        engine: this.engine,
        source: this.source,
        format: this.format,
      });
      batch.forEach((task, i) => task.resolve(results[i] ?? ""));
    } catch (err) {
      batch.forEach((task) => task.reject(err));
    } finally {
      this.activeCount = Math.max(0, this.activeCount - 1);
      if (this.queue.length >= BATCH_SIZE) {
        this.drain(false);
      } else if (this.queue.length > 0) {
        this.schedule();
      }
    }
  }

  destroy(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    const err = new Error(QUEUE_DESTROYED_ERROR);
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
let currentBaseTextExtStyle = "";
let clickToShowOriginalEnabled = true;
let settingsClickToShowOriginalEnabled = true;
let preferredClickToShowOriginalEnabled: boolean | null = null;
let runSeq = 0;
let lastCommandId = 0;
let pendingCount = 0;
let currentMode: PageTranslateMode | null = null;
let currentEngine: FullPageEngineId | null = null;
let currentSource: string | null = null;
let currentTarget: string | null = null;
let preferredMode: PageTranslateMode | null = null;
let preferredEngine: FullPageEngineId | null = null;
let preferredSource: string | null = null;
let preferredTarget: string | null = null;
let settingsMode: FullPageMode = "replace";
let settingsEngine: FullPageEngineId = "google2";
let settingsTarget: string | null = null;
let originalTitle: string | null = null;
let batchQueues: Record<TranslateFormat, TranslateBatchQueue> | null = null;

// Navigation
let lastLocationKey = getLocationKey();
let lastTranslateInput: PageTranslateCommand | null = null;
let navigationTimer: number | undefined;
let virtualLayoutRefreshTimer: number | undefined;

// Per-node state (WeakMaps don't leak)
const processedNodes = new WeakMap<HTMLElement, ResolvedFullPageRule>();
const hostWrappers = new WeakMap<HTMLElement, Set<HTMLElement>>();
const wrapperState = new WeakMap<HTMLElement, WrapperState>();
const originalPeekWrappers = new WeakMap<HTMLElement, HTMLElement>();

// Live node sets
const observedNodes = new Set<HTMLElement>();
const viewNodes = new Set<HTMLElement>();
const rootNodes = new Set<ParentNode>();
const translatedHosts = new Set<HTMLElement>();
const wrapperHosts = new Set<HTMLElement>();
const rescanQueue = new Set<Node>();
// Per-session content cache: serialized text → translated text.
// Keyed on content, not DOM nodes, so it survives virtual-DOM re-creation
// (Discourse, Rust Forum) where old nodes are destroyed and new ones inserted.
const localTranslationCache = new Map<string, string>();

// Mutation guard
const mutedMutationRoots = new Set<Node>();
let singleModeToggleListenerInstalled = false;

// ── Entry point ───────────────────────────────────────────────────────────────

export function initFullPage(): void {
  installNavigationWatcher();
  installSingleModeToggleListener();
  ensureObservers();
  void getSettings().then(handleSettingsChanged);
  void watchSettings(handleSettingsChanged);

  onMessage("runPageTranslate", async (input) => {
    pruneDisconnectedNodes();
    if (isStaleCommand(input.commandId)) return buildAck(false);
    applyCommandId(input.commandId);

    const mode = input.mode ?? "replace";
    if (
      canSwitchMode({
        engine: input.engine,
        source:
          "source" in input
            ? normalizePreferredSource(input.source)
            : preferredSource,
        target: input.target,
      })
    ) {
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

  onMessage("updatePageTranslatePrefs", (input) => {
    updatePageTranslatePrefs(input);
    return getStatus();
  });
}

function isStaleCommand(id: number | undefined): boolean {
  return id !== undefined && id < lastCommandId;
}

function applyCommandId(id: number | undefined): void {
  if (id !== undefined && id > lastCommandId) lastCommandId = id;
}

async function startPageTranslate(
  input: PageTranslateCommand,
): Promise<PageTranslateAck> {
  if (navigationTimer !== undefined) {
    window.clearTimeout(navigationTimer);
    navigationTimer = undefined;
  }

  const mode = input.mode ?? "replace";
  const source =
    "source" in input ? normalizePreferredSource(input.source) : preferredSource;
  currentMode = mode;

  const ruleInput = source ? { ...input, source } : input;
  currentRule = await loadRule(ruleInput);
  currentSource = source;
  preferredSource = source;
  currentEngine = currentRule.engine;
  currentTarget = currentRule.target;
  lastTranslateInput = {
    target: currentRule.target,
    engine: currentRule.engine,
    ...(source ? { source } : {}),
    mode,
  };
  ensureSiteLayoutStyles();

  const seq = ++runSeq;
  pendingCount = 0;

  cleanupAllTranslations();
  stopObservation();

  batchQueues?.text.destroy();
  batchQueues?.html.destroy();
  batchQueues = createBatchQueues(currentRule);

  startObserveRoots();
  void updateDocumentTitle(seq).catch(() => {});
  requeueVisibleNodes();

  return buildAck(true);
}

function restoreOriginals(): void {
  runSeq++;
  currentMode = null;
  currentEngine = null;
  currentSource = null;
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
  batchQueues?.text.destroy();
  batchQueues?.html.destroy();
  batchQueues = null;
  currentRule = null;
  currentBaseTextExtStyle = "";
  removeSiteLayoutStyles();
}

function updatePageTranslatePrefs(input: PageTranslatePrefs): void {
  if (input.mode) preferredMode = input.mode;
  if (input.engine) preferredEngine = input.engine;
  if ("source" in input)
    preferredSource = normalizePreferredSource(input.source);
  if (input.target) preferredTarget = input.target;
}

function normalizePreferredSource(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed !== "auto" ? trimmed : null;
}

export function getFullPageClickToShowOriginalStatus(): {
  fullPageClickToShowOriginal: boolean;
  hasFullPageClickToShowOriginalPref: boolean;
} {
  return {
    fullPageClickToShowOriginal: clickToShowOriginalEnabled,
    hasFullPageClickToShowOriginalPref:
      preferredClickToShowOriginalEnabled !== null,
  };
}

export function updateFullPageClickToShowOriginalPref(
  fullPageClickToShowOriginal: boolean,
): {
  fullPageClickToShowOriginal: boolean;
  hasFullPageClickToShowOriginalPref: boolean;
} {
  preferredClickToShowOriginalEnabled = fullPageClickToShowOriginal;
  updateClickToShowOriginalSetting(resolveClickToShowOriginalEnabled());
  return getFullPageClickToShowOriginalStatus();
}

function handleSettingsChanged(settings: Settings): void {
  settingsMode = settings.fullPageMode;
  settingsEngine = settings.engines.fullPage;
  settingsTarget = resolveTargetLang(
    settings.immersiveTargetLang,
    settings.uiLang,
  );
  settingsClickToShowOriginalEnabled = settings.fullPageClickToShowOriginal;
  updateClickToShowOriginalSetting(resolveClickToShowOriginalEnabled());

  const rule = currentRule;
  if (!rule) return;

  const nextTextExtStyle = composeTranslationTextExtStyle(
    currentBaseTextExtStyle,
    settings,
  );
  if (nextTextExtStyle === rule.textExtStyle) return;

  const nextRule = { ...rule, textExtStyle: nextTextExtStyle };
  currentRule = nextRule;
  reapplyTranslationInnerStyles(nextRule);
}

async function loadRule(
  input: PageTranslateCommand,
): Promise<ResolvedFullPageRule> {
  const [userRules, settings] = await Promise.all([
    getFullPageRules(),
    getSettings(),
  ]);
  const matched = matchFullPageRule(window.location.href, userRules);
  const baseRule = resolveFullPageRule(matched, input);
  currentBaseTextExtStyle = baseRule.textExtStyle;
  settingsClickToShowOriginalEnabled = settings.fullPageClickToShowOriginal;
  updateClickToShowOriginalSetting(resolveClickToShowOriginalEnabled());
  return {
    ...baseRule,
    textExtStyle: composeTranslationTextExtStyle(
      baseRule.textExtStyle,
      settings,
    ),
  };
}

function composeTranslationTextExtStyle(
  baseTextExtStyle: string,
  settings: Settings,
): string {
  return appendCssText(
    baseTextExtStyle,
    buildTranslationStyleCss(settings.translationStyle),
  );
}

function resolveClickToShowOriginalEnabled(): boolean {
  return (
    preferredClickToShowOriginalEnabled ?? settingsClickToShowOriginalEnabled
  );
}

function updateClickToShowOriginalSetting(enabled: boolean): void {
  if (clickToShowOriginalEnabled === enabled) return;
  clickToShowOriginalEnabled = enabled;
  if (reapplySingleModeToggleStates()) scheduleVirtualizedLayoutRefresh();
}

function appendCssText(baseCss: string, patchCss: string): string {
  const base = baseCss.trim();
  const patch = patchCss.trim();
  if (!base) return patch;
  if (!patch) return base;
  return `${base}${base.endsWith(";") ? "" : ";"} ${patch}`;
}

function createBatchQueues(
  rule: ResolvedFullPageRule,
): Record<TranslateFormat, TranslateBatchQueue> {
  return {
    text: new TranslateBatchQueue(
      rule.engine,
      rule.target,
      rule.source,
      "text",
    ),
    html: new TranslateBatchQueue(
      rule.engine,
      rule.target,
      rule.source,
      "html",
    ),
  };
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
          if (added.nodeType === Node.TEXT_NODE) {
            hasText = true;
            continue;
          }
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
  const roots = querySelectorAllSafe(document, selector).filter(
    (r): r is HTMLElement => r instanceof HTMLElement,
  );
  const targets =
    roots.length > 0
      ? roots
      : ([document.body].filter(Boolean) as HTMLElement[]);
  targets.forEach(startObserveRoot);
  if (currentRule.scanAll || currentRule.hasShadowroot) {
    findAndObserveShadowRoots(document.body);
  }
}

function startObserveRoot(root: ParentNode): void {
  if (!currentRule) return;
  const rule = currentRule;
  const ctx = makeScanCtx();
  if (!ctx) return;
  if (rootNodes.has(root) || !mutationObserver) return;
  rootNodes.add(root);
  mutationObserver.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    characterDataOldValue: true,
  });
  if (rule.hasShadowroot && root instanceof Element) {
    findAndObserveShadowRoots(root);
  }
  scanNode(root, rule, ctx);
}

function startObserveShadowRoot(root: ShadowRoot): void {
  if (!rootNodes.has(root)) startObserveRoot(root);
}

function makeScanCtx(): ScanContext | null {
  if (!intersectionObserver) return null;
  return {
    intersectionObserver,
    observedNodes,
    viewNodes,
    processedNodes,
    onNodeReady: (node) => void scheduleProcessNode(node, runSeq),
  };
}

// ── Core processing (kiss-translator #processNode / #translateNodeGroup) ───────

async function scheduleProcessNode(
  node: HTMLElement,
  seq: number,
): Promise<void> {
  if (seq !== runSeq || !currentRule || !batchQueues) return;
  const rule = currentRule;
  if (!node.isConnected || shouldIgnoreNode(node, rule)) return;
  if (processedNodes.has(node)) return;

  const inlineRun = collectInlineSiblingRun(node, rule);
  if (inlineRun) {
    inlineRun.processedHosts.forEach((host) => processedNodes.set(host, rule));
    if (isInvalidText(getNodesText(inlineRun.nodes))) return;
    await translateNodeGroup(inlineRun.nodes, inlineRun.host, seq, {
      format: inlineRun.format,
      separator: inlineRun.separator,
    });
    return;
  }

  processedNodes.set(node, rule);

  // Early out: if the entire textContent is junk, skip
  if (isInvalidText(node.textContent ?? "")) return;

  // Collect groups of consecutive non-break child nodes
  const childList = Array.from(node.childNodes).filter((c) => !isOurWrapper(c));
  const groups = collectNodeGroups(childList, rule);

  const tasks: Promise<void>[] = [];
  for (const group of groups) {
    if (seq !== runSeq || !node.isConnected) return;
    tasks.push(translateNodeGroup(group, node, seq));
  }
  await Promise.all(tasks);
}

// Mirrors kiss-translator's inline node grouping in #processNode
function collectNodeGroups(
  childNodes: ChildNode[],
  rule: ResolvedFullPageRule,
): ChildNode[][] {
  const groups: ChildNode[][] = [];
  let current: ChildNode[] = [];

  for (const node of childNodes) {
    const shouldGroup =
      node.nodeType === Node.TEXT_NODE || node.nodeType === Node.ELEMENT_NODE;
    if (shouldGroup && !shouldBreakGroup(node, rule)) {
      current.push(node);
    } else {
      if (current.length > 0) {
        groups.push(current);
        current = [];
      }
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

// Mirrors kiss-translator's #shouldBreak
function shouldBreakGroup(
  node: ChildNode,
  rule: ResolvedFullPageRule,
): boolean {
  if (!(node instanceof Element)) return false;
  if (matchesSelectorSafe(node, rule.keepSelector)) return false;
  if (!(node instanceof HTMLElement)) {
    return BREAK_LINE_TAGS.has((node as Element).tagName);
  }
  if (
    BREAK_LINE_TAGS.has(node.tagName) ||
    shouldIgnoreNode(node, rule) ||
    isOurWrapper(node)
  ) {
    return true;
  }
  if (rule.autoScan && isBlockNode(node)) return true;
  if (!rule.autoScan && rule.selector) {
    if (matchesSelectorSafe(node, rule.selector)) return true;
    if (querySelectorAllSafe(node, rule.selector).length > 0) return true;
  }
  return false;
}

function collectInlineSiblingRun(
  node: HTMLElement,
  rule: ResolvedFullPageRule,
): InlineSiblingRun | null {
  const parent = node.parentElement;
  if (!parent || !isInlineRunCandidate(node, rule)) return null;

  const siblings = Array.from(parent.childNodes);
  const nodeIndex = siblings.indexOf(node);
  if (nodeIndex < 0) return null;

  let start = nodeIndex;
  while (start > 0 && canJoinInlineRun(siblings[start - 1]!, rule)) start--;

  let end = nodeIndex;
  while (
    end < siblings.length - 1 &&
    canJoinInlineRun(siblings[end + 1]!, rule)
  )
    end++;

  const nodes = siblings.slice(start, end + 1);
  const processedHosts = nodes.filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && isInlineRunCandidate(child, rule),
  );

  const isListRun =
    parent instanceof HTMLUListElement || parent instanceof HTMLOListElement;
  if (processedHosts.length < 2) return null;
  if (!isListRun && nodes.some(isInteractiveRunNode)) return null;
  return {
    host: parent,
    nodes,
    processedHosts,
    format: isListRun && supportsHtmlFormat(rule.engine) ? "html" : undefined,
    separator: isListRun ? INLINE_RUN_TRANSLATION_SEPARATOR : undefined,
  };
}

function isInlineRunCandidate(
  el: HTMLElement,
  rule: ResolvedFullPageRule,
): boolean {
  return (
    !!rule.selector &&
    matchesSelectorSafe(el, rule.selector) &&
    !isOurWrapper(el) &&
    !shouldIgnoreNode(el, rule) &&
    isInlineFlowElement(el)
  );
}

function canJoinInlineRun(
  node: ChildNode,
  rule: ResolvedFullPageRule,
): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.nodeValue ?? "";
    return text === "" || INLINE_RUN_SEPARATOR_RE.test(text);
  }
  if (!(node instanceof HTMLElement)) return false;
  if (isOurWrapper(node) || shouldIgnoreNode(node, rule)) return false;
  if (BREAK_LINE_TAGS.has(node.tagName)) return false;
  return isInlineFlowElement(node);
}

function isInteractiveRunNode(node: ChildNode): boolean {
  return (
    node instanceof HTMLElement &&
    (isInsideInteractiveHost(node) ||
      !!node.querySelector(INTERACTIVE_HOST_SELECTOR))
  );
}

function isInlineFlowElement(el: HTMLElement): boolean {
  const display = window.getComputedStyle(el).display;
  return (
    display === "contents" || display === "ruby" || display.startsWith("inline")
  );
}

function getNodesText(nodes: Iterable<Node>): string {
  let text = "";
  for (const node of nodes) text += node.textContent ?? "";
  return text;
}

// Mirrors kiss-translator's #translateNodeGroup
async function translateNodeGroup(
  nodes: ChildNode[],
  host: HTMLElement,
  seq: number,
  options: { format?: TranslateFormat; separator?: string } = {},
): Promise<void> {
  if (!currentRule || !batchQueues || seq !== runSeq) return;

  const rule = currentRule;
  const format = options.format ?? pickSerializeFormat(host, nodes, rule);
  const { html: serialized, placeholders } = serializeNodes(
    nodes,
    format,
    rule,
    {
      separator: options.separator,
    },
  );
  if (!serialized || isInvalidText(serialized)) return;

  const transOnly = shouldUseTranslationOnly(currentMode ?? "replace", rule);
  const hideMode = transOnly ? getOriginalHideMode(host) : undefined;

  // Create wrapper and insert after last original node (kiss-translator pattern)
  const wrapper = createLoadingWrapper(
    serialized,
    transOnly,
    rule,
    host,
    hideMode,
  );
  let hiddenOriginal: HTMLElement | undefined;
  runWithMutedMutations(host, () => {
    const last = nodes[nodes.length - 1]!;
    if (last.parentNode === host) {
      last.after(wrapper);
    } else {
      host.appendChild(wrapper);
    }
    if (transOnly && hideMode) {
      hiddenOriginal = hideOriginalNodes(nodes, host, hideMode, wrapper);
    }
  });
  if (transOnly) scheduleVirtualizedLayoutRefresh();
  addHostWrapper(host, wrapper);
  wrapperState.set(wrapper, {
    nodes,
    isHide: transOnly,
    host,
    hideMode,
    hiddenOriginal,
    singleModeView: "translation",
  });
  pendingCount++;

  try {
    const translated =
      localTranslationCache.get(serialized) ??
      (await batchQueues[format].addTask(serialized));
    pendingCount = Math.max(0, pendingCount - 1);

    if (seq !== runSeq || !host.isConnected || !wrapper.isConnected) return;

    if (!translated) {
      runWithMutedMutations(host, () => {
        removeWrapperWithOriginalRestore(wrapper);
        wrapper.remove();
      });
      removeHostWrapper(host, wrapper);
      return;
    }

    // Replace skeleton with actual translation
    runWithMutedMutations(host, () => {
      const inner = wrapper.querySelector(
        `[${INNER_ATTR}]`,
      ) as HTMLElement | null;
      if (!inner) return;
      inner.removeAttribute("aria-busy");
      inner.textContent = "";
      appendTranslatedContent(inner, translated, placeholders, format);
      const state = wrapperState.get(wrapper);
      const liveRule = currentRule ?? rule;
      if (state) {
        applyWrapperMode(
          wrapper,
          host,
          state,
          currentMode ?? "replace",
          liveRule,
        );
      }
    });
    if (wrapperState.get(wrapper)?.isHide) scheduleVirtualizedLayoutRefresh();
    translatedHosts.add(host);
    localTranslationCache.set(serialized, translated);
  } catch (err) {
    pendingCount = Math.max(0, pendingCount - 1);
    if (isQueueDestroyedError(err)) return;
    if (seq === runSeq && wrapper.isConnected) {
      runWithMutedMutations(host, () => {
        removeWrapperWithOriginalRestore(wrapper);
        wrapper.remove();
      });
      removeHostWrapper(host, wrapper);
    }
    console.warn("[OneLingo] translateNodeGroup failed:", err);
  }
}

// ── Wrapper DOM management ────────────────────────────────────────────────────

function createLoadingWrapper(
  original: string,
  transOnly: boolean,
  rule: ResolvedFullPageRule,
  host: HTMLElement,
  hideMode: OriginalHideMode | undefined,
): HTMLElement {
  const wrapperTag = getTranslationWrapperTag(host);
  const wrapper = document.createElement(wrapperTag);
  wrapper.setAttribute(WRAPPER_ATTR, "true");
  wrapper.style.visibility = "visible";
  if (isInsideInteractiveHost(host)) {
    wrapper.style.pointerEvents = "none";
  }
  if (wrapperTag === "li") {
    wrapper.style.display = "block";
    wrapper.style.listStyle = "none";
  }

  // Optional line-break before translation (hidden in transOnly, visible in bilingual)
  if (
    wrapperTag === "span" &&
    shouldStartTranslationOnNewLine(host, original)
  ) {
    const br = document.createElement("br");
    br.hidden = transOnly;
    wrapper.appendChild(br);
  }

  const inner = document.createElement(rule.transTag);
  inner.setAttribute(INNER_ATTR, "true");
  inner.setAttribute("aria-busy", "true");
  inner.lang = rule.target;

  applyTranslationInnerStyles(inner, transOnly, host, hideMode, rule);

  ensureLoadingStyles();
  appendLoadingLines(inner, original, false);
  wrapper.appendChild(inner);
  return wrapper;
}

function getTranslationWrapperTag(host: HTMLElement): "li" | "span" {
  return host instanceof HTMLUListElement || host instanceof HTMLOListElement
    ? "li"
    : "span";
}

function isInsideInteractiveHost(host: HTMLElement): boolean {
  return !!host.closest(INTERACTIVE_HOST_SELECTOR);
}

function shouldStartTranslationOnNewLine(
  host: HTMLElement,
  original: string,
): boolean {
  return original.length > NEWLINE_LENGTH || !isInlineFlowElement(host);
}

function supportsHtmlFormat(engine: FullPageEngineId): boolean {
  return engine === "google2" || engine === "microsoft";
}

function applyTranslationInnerStyles(
  inner: HTMLElement,
  transOnly: boolean,
  host: HTMLElement,
  hideMode: OriginalHideMode | undefined,
  rule: ResolvedFullPageRule,
): void {
  const loadingVars = readLoadingCssVars(inner);
  inner.removeAttribute("style");
  applyTranslationInnerModeStyles(inner, transOnly, host, hideMode);
  appendInlineStyle(inner, rule.textExtStyle);
  if (loadingVars) restoreLoadingCssVars(inner, loadingVars);
}

function readLoadingCssVars(
  inner: HTMLElement,
): { base: string; flow: string } | null {
  if (inner.getAttribute("aria-busy") !== "true") return null;
  const palette = getLoadingPalette();
  return {
    base: inner.style.getPropertyValue(LOADING_BASE_VAR) || palette.base,
    flow: inner.style.getPropertyValue(LOADING_FLOW_VAR) || palette.flow,
  };
}

function restoreLoadingCssVars(
  inner: HTMLElement,
  vars: { base: string; flow: string },
): void {
  inner.style.setProperty(LOADING_BASE_VAR, vars.base);
  inner.style.setProperty(LOADING_FLOW_VAR, vars.flow);
}

function applyTranslationInnerModeStyles(
  inner: HTMLElement,
  transOnly: boolean,
  host: HTMLElement,
  hideMode: OriginalHideMode | undefined,
): void {
  inner.style.visibility = "visible";
  if (!transOnly) {
    inner.style.fontSize = "0.95em";
    inner.style.lineHeight = "1.55";
    return;
  }
  if (hideMode === "collapsed") {
    const style = window.getComputedStyle(host);
    inner.style.color = style.color;
    inner.style.fontSize = style.fontSize;
    inner.style.lineHeight = style.lineHeight;
    return;
  }
  inner.style.removeProperty("color");
  inner.style.removeProperty("font-size");
  inner.style.removeProperty("line-height");
}

function addHostWrapper(host: HTMLElement, wrapper: HTMLElement): void {
  let set = hostWrappers.get(host);
  if (!set) {
    set = new Set();
    hostWrappers.set(host, set);
  }
  set.add(wrapper);
  wrapperHosts.add(host);
}

function removeHostWrapper(host: HTMLElement, wrapper: HTMLElement): void {
  hostWrappers.get(host)?.delete(wrapper);
  wrapperState.delete(wrapper);
}

function getHostWrappers(host: HTMLElement): HTMLElement[] {
  return Array.from(hostWrappers.get(host) ?? []);
}

function getOriginalHideMode(host: HTMLElement): OriginalHideMode {
  return isDomPreservingReplaceHost(host) ? "collapsed" : "detached";
}

function isDomPreservingReplaceHost(_host: HTMLElement): boolean {
  return isDiscourseTopicPage();
}

function hideOriginalNodes(
  nodes: ChildNode[],
  host: HTMLElement,
  mode: OriginalHideMode,
  wrapper: HTMLElement,
): HTMLElement | undefined {
  if (mode === "collapsed") {
    return moveNodesToHiddenContainer(nodes, host, wrapper);
  }
  moveNodesToFragment(nodes);
  return undefined;
}

function moveNodesToHiddenContainer(
  nodes: ChildNode[],
  host: HTMLElement,
  wrapper: HTMLElement,
): HTMLElement {
  const hidden = document.createElement("span");
  hidden.setAttribute(HIDDEN_ORIGINAL_ATTR, "true");
  hidden.hidden = true;
  hidden.style.display = "none";
  if (wrapper.parentNode === host) {
    host.insertBefore(hidden, wrapper);
  } else {
    host.appendChild(hidden);
  }
  nodes.forEach((n) => hidden.appendChild(n));
  return hidden;
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
  wrapper.hidden = false;
  if (state.hiddenOriginal) {
    restoreHiddenOriginalNodes(state, wrapper);
    state.isHide = false;
    state.singleModeView = "translation";
    return;
  }
  const parent = wrapper.parentElement;
  if (parent) {
    const frag = document.createDocumentFragment();
    state.nodes.forEach((n) => frag.appendChild(n));
    parent.insertBefore(frag, wrapper);
  }
  state.isHide = false;
  state.singleModeView = "translation";
}

function restoreHiddenOriginalNodes(
  state: WrapperState,
  wrapper: HTMLElement,
): void {
  const hidden = state.hiddenOriginal;
  const frag = document.createDocumentFragment();
  state.nodes.forEach((n) => frag.appendChild(n));
  if (hidden?.parentNode) {
    hidden.parentNode.insertBefore(frag, hidden);
    originalPeekWrappers.delete(hidden);
    hidden.remove();
  } else {
    wrapper.parentNode?.insertBefore(frag, wrapper);
  }
  state.hiddenOriginal = undefined;
}

function installSingleModeToggleListener(): void {
  if (singleModeToggleListenerInstalled) return;
  document.addEventListener("click", handleSingleModeToggleClick, true);
  singleModeToggleListenerInstalled = true;
}

function handleSingleModeToggleClick(event: MouseEvent): void {
  if (!clickToShowOriginalEnabled || currentMode !== "replace") return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (shouldIgnoreSingleModeToggleTarget(target)) return;

  const element =
    target instanceof Element ? target : target.parentElement;
  if (!element) return;

  const original = element.closest(`[${ORIGINAL_PEEK_ATTR}="true"]`);
  if (original instanceof HTMLElement) {
    const wrapper = originalPeekWrappers.get(original);
    const state = wrapper ? wrapperState.get(wrapper) : undefined;
    if (wrapper && state && showTranslationForSingleMode(wrapper, state)) {
      event.preventDefault();
      event.stopPropagation();
      scheduleVirtualizedLayoutRefresh();
    }
    return;
  }

  const wrapper = element.closest(
    `[${WRAPPER_ATTR}="true"][${SINGLE_MODE_TOGGLE_ATTR}="true"]`,
  );
  if (!(wrapper instanceof HTMLElement)) return;
  const state = wrapperState.get(wrapper);
  if (!state || !showOriginalForSingleMode(wrapper, state)) return;
  event.preventDefault();
  event.stopPropagation();
  scheduleVirtualizedLayoutRefresh();
}

function shouldIgnoreSingleModeToggleTarget(target: Node): boolean {
  const element = target instanceof Element ? target : target.parentElement;
  return !!element?.closest(SINGLE_MODE_TOGGLE_IGNORE_SELECTOR);
}

function updateSingleModeToggleState(
  wrapper: HTMLElement,
  state: WrapperState,
): void {
  if (canUseSingleModeToggle(wrapper, state)) {
    wrapper.setAttribute(SINGLE_MODE_TOGGLE_ATTR, "true");
  } else {
    wrapper.removeAttribute(SINGLE_MODE_TOGGLE_ATTR);
  }
}

function reapplySingleModeToggleStates(): boolean {
  let layoutChanged = false;
  for (const host of Array.from(wrapperHosts)) {
    if (!host.isConnected) {
      wrapperHosts.delete(host);
      continue;
    }

    runWithMutedMutations(host, () => {
      for (const wrapper of getHostWrappers(host)) {
        if (!wrapper.isConnected) continue;
        const state = wrapperState.get(wrapper);
        if (!state) continue;

        if (!clickToShowOriginalEnabled && state.singleModeView === "original") {
          hideOriginalForSingleMode(wrapper, state);
          layoutChanged = true;
        }
        updateSingleModeToggleState(wrapper, state);
      }
    });
  }
  return layoutChanged;
}

function canUseSingleModeToggle(
  wrapper: HTMLElement,
  state: WrapperState,
): boolean {
  if (
    !clickToShowOriginalEnabled ||
    currentMode !== "replace" ||
    !state.isHide ||
    state.singleModeView === "original" ||
    !wrapper.isConnected ||
    !isTranslatedWrapperReady(wrapper)
  ) {
    return false;
  }
  if (state.hideMode === "collapsed") return !!state.hiddenOriginal;
  return canCreateOriginalPeekContainer(state.host);
}

function isTranslatedWrapperReady(wrapper: HTMLElement): boolean {
  const inner = wrapper.querySelector(`[${INNER_ATTR}]`);
  return (
    inner instanceof HTMLElement && inner.getAttribute("aria-busy") !== "true"
  );
}

function canCreateOriginalPeekContainer(host: HTMLElement): boolean {
  return !(host instanceof HTMLUListElement || host instanceof HTMLOListElement);
}

function showOriginalForSingleMode(
  wrapper: HTMLElement,
  state: WrapperState,
): boolean {
  if (!canUseSingleModeToggle(wrapper, state)) return false;
  runWithMutedMutations(state.host, () => {
    const original =
      state.hideMode === "collapsed"
        ? state.hiddenOriginal
        : createDetachedOriginalPeek(wrapper, state);
    if (!original) return;
    original.hidden = false;
    original.style.removeProperty("display");
    original.setAttribute(ORIGINAL_PEEK_ATTR, "true");
    originalPeekWrappers.set(original, wrapper);
    wrapper.hidden = true;
    wrapper.removeAttribute(SINGLE_MODE_TOGGLE_ATTR);
    state.singleModeView = "original";
  });
  return state.singleModeView === "original";
}

function showTranslationForSingleMode(
  wrapper: HTMLElement,
  state: WrapperState,
): boolean {
  if (
    currentMode !== "replace" ||
    !state.isHide ||
    state.singleModeView !== "original"
  ) {
    return false;
  }
  let changed = false;
  runWithMutedMutations(state.host, () => {
    hideOriginalForSingleMode(wrapper, state);
    updateSingleModeToggleState(wrapper, state);
    changed = true;
  });
  return changed;
}

function resetSingleModeToggle(
  wrapper: HTMLElement,
  state: WrapperState,
): boolean {
  const wasOriginal = state.singleModeView === "original";
  if (wasOriginal) hideOriginalForSingleMode(wrapper, state);
  wrapper.removeAttribute(SINGLE_MODE_TOGGLE_ATTR);
  if (state.hiddenOriginal && state.hideMode === "collapsed") {
    state.hiddenOriginal.removeAttribute(ORIGINAL_PEEK_ATTR);
    originalPeekWrappers.delete(state.hiddenOriginal);
  }
  state.singleModeView = "translation";
  return wasOriginal;
}

function createDetachedOriginalPeek(
  wrapper: HTMLElement,
  state: WrapperState,
): HTMLElement | undefined {
  if (state.hiddenOriginal) return state.hiddenOriginal;
  const parent = wrapper.parentNode;
  if (!parent) return undefined;
  const original = document.createElement("span");
  parent.insertBefore(original, wrapper);
  state.nodes.forEach((node) => original.appendChild(node));
  state.hiddenOriginal = original;
  return original;
}

function hideOriginalForSingleMode(
  wrapper: HTMLElement,
  state: WrapperState,
): void {
  const original = state.hiddenOriginal;
  if (original) {
    original.removeAttribute(ORIGINAL_PEEK_ATTR);
    originalPeekWrappers.delete(original);
    if (state.hideMode === "collapsed") {
      original.hidden = true;
      original.style.display = "none";
    } else {
      moveNodesToFragment(state.nodes);
      original.remove();
      state.hiddenOriginal = undefined;
    }
  }
  wrapper.hidden = false;
  state.singleModeView = "translation";
}

// ── Mode switching ────────────────────────────────────────────────────────────

function canSwitchMode(input: {
  engine: FullPageEngineId;
  source: string | null;
  target: string;
}): boolean {
  return (
    currentRule !== null &&
    currentEngine !== null &&
    currentSource === input.source &&
    currentTarget !== null &&
    input.engine === currentEngine &&
    input.target === currentTarget &&
    (wrapperHosts.size > 0 || translatedHosts.size > 0 || pendingCount > 0)
  );
}

// Mirrors kiss-translator's #toggleTranslationOnly
function switchAppliedMode(mode: PageTranslateMode): void {
  currentMode = mode;
  if (currentRule) {
    currentRule = { ...currentRule, transOnly: mode === "replace" };
  }
  const rule = currentRule;
  if (!rule) return;
  if (currentEngine !== null && currentTarget !== null) {
    lastTranslateInput = {
      target: currentTarget,
      engine: currentEngine,
      ...(currentSource ? { source: currentSource } : {}),
      mode,
    };
  }

  let layoutChanged = false;
  for (const host of Array.from(wrapperHosts)) {
    if (!host.isConnected) {
      wrapperHosts.delete(host);
      continue;
    }
    runWithMutedMutations(host, () => {
      for (const wrapper of getHostWrappers(host)) {
        if (!wrapper.isConnected) continue;
        const state = wrapperState.get(wrapper);
        if (!state) continue;

        layoutChanged =
          applyWrapperMode(wrapper, host, state, mode, rule) || layoutChanged;
      }
    });
  }
  if (layoutChanged) scheduleVirtualizedLayoutRefresh();
}

function applyWrapperMode(
  wrapper: HTMLElement,
  host: HTMLElement,
  state: WrapperState,
  mode: PageTranslateMode,
  rule: ResolvedFullPageRule,
): boolean {
  const transOnly = shouldUseTranslationOnly(mode, rule);
  let layoutChanged = resetSingleModeToggle(wrapper, state);

  const br = wrapper.querySelector(":scope > br");
  if (br instanceof HTMLElement) br.hidden = transOnly;

  if (transOnly && !state.isHide) {
    state.hideMode = getOriginalHideMode(host);
    state.hiddenOriginal = hideOriginalNodes(
      state.nodes,
      host,
      state.hideMode,
      wrapper,
    );
    state.isHide = true;
    layoutChanged = true;
  } else if (!transOnly && state.isHide) {
    restoreWrapperNodes(wrapper);
    layoutChanged = true;
  }

  const inner = wrapper.querySelector(`[${INNER_ATTR}]`) as HTMLElement | null;
  if (inner) {
    applyTranslationInnerStyles(inner, transOnly, host, state.hideMode, rule);
  }

  updateSingleModeToggleState(wrapper, state);
  return layoutChanged;
}

function removeWrapperWithOriginalRestore(wrapper: HTMLElement): void {
  const state = wrapperState.get(wrapper);
  if (state?.isHide) restoreWrapperNodes(wrapper);
}

function reapplyTranslationInnerStyles(rule: ResolvedFullPageRule): void {
  const transOnly = shouldUseTranslationOnly(currentMode ?? "replace", rule);

  for (const host of Array.from(wrapperHosts)) {
    if (!host.isConnected) {
      wrapperHosts.delete(host);
      continue;
    }

    runWithMutedMutations(host, () => {
      for (const wrapper of getHostWrappers(host)) {
        if (!wrapper.isConnected) continue;
        const state = wrapperState.get(wrapper);
        if (!state) continue;

        const inner = wrapper.querySelector(
          `[${INNER_ATTR}]`,
        ) as HTMLElement | null;
        if (inner) {
          applyTranslationInnerStyles(
            inner,
            transOnly,
            host,
            state.hideMode,
            rule,
          );
        }
      }
    });
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

// Mirrors kiss-translator's #cleanupAllNodes / #cleanupAllTranslations
function cleanupAllTranslations(): void {
  const hosts = new Set([
    ...observedNodes,
    ...translatedHosts,
    ...wrapperHosts,
  ]);
  for (const host of hosts) cleanupHostNode(host);
  translatedHosts.clear();
  wrapperHosts.clear();
  localTranslationCache.clear();
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
  wrapperHosts.delete(host);
}

function stopObservation(): void {
  if (rescanTimer !== undefined) {
    window.clearTimeout(rescanTimer);
    rescanTimer = undefined;
  }
  if (virtualLayoutRefreshTimer !== undefined) {
    window.clearTimeout(virtualLayoutRefreshTimer);
    virtualLayoutRefreshTimer = undefined;
  }
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
  if (findActiveTranslationHost(target)) return;
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
  if (!currentRule) return;
  const rule = currentRule;
  const ctx = makeScanCtx();
  if (!ctx) return;
  if (findActiveTranslationHost(changedNode)) return;
  const container = findChangeContainer(changedNode);
  if (!container) return;
  if (hasActiveTranslation(container)) return;
  cleanupHostNode(container);
  if (intersectionObserver) intersectionObserver.unobserve(container);
  observedNodes.delete(container);
  viewNodes.delete(container);
  scanNode(container, rule, ctx);
}

function findChangeContainer(startNode: Node): HTMLElement | null {
  let current: Node | null = startNode;
  while (current && current !== document.body) {
    if (
      current instanceof HTMLElement &&
      (observedNodes.has(current) || isBlockNode(current))
    ) {
      for (const root of rootNodes) {
        if (root instanceof Node && root.contains(current)) return current;
      }
    }
    current = current.parentNode;
  }
  return null;
}

function hasActiveTranslation(host: HTMLElement): boolean {
  if (translatedHosts.has(host)) return true;
  return getHostWrappers(host).some((wrapper) => wrapper.isConnected);
}

function findActiveTranslationHost(startNode: Node): HTMLElement | null {
  let current: Element | null =
    startNode instanceof Element ? startNode : startNode.parentElement;
  while (current && current !== document.body) {
    if (current instanceof HTMLElement && hasActiveTranslation(current))
      return current;
    current = current.parentElement;
  }
  return null;
}

// ── Status / Ack ──────────────────────────────────────────────────────────────

function getStatus(): PageTranslateStatus {
  checkLocationChange();
  pruneDisconnectedNodes();
  const blocks =
    observedNodes.size > 0 ? observedNodes.size : translatedHosts.size;
  const hasPagePrefs =
    preferredMode !== null ||
    preferredEngine !== null ||
    preferredSource !== null ||
    preferredTarget !== null;
  return {
    active: translatedHosts.size > 0 || pendingCount > 0,
    translating: pendingCount > 0,
    blocks,
    hasPagePrefs,
    mode: currentMode ?? preferredMode ?? settingsMode,
    engine: currentEngine ?? preferredEngine ?? settingsEngine,
    source: preferredSource ?? undefined,
    target: currentTarget ?? preferredTarget ?? settingsTarget ?? undefined,
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
  return `${window.location.origin}${getCanonicalPathname()}${window.location.search}`;
}

function getCanonicalPathname(): string {
  const path = window.location.pathname.replace(/\/+$/, "");
  if (isDiscourseTopicPage()) {
    return path.replace(/^(\/t\/.+\/\d+)\/\d+$/u, "$1");
  }
  return path || "/";
}

function isDiscourseTopicPage(): boolean {
  if (!/^\/t\/.+\/\d+(?:\/\d+)?$/u.test(window.location.pathname)) return false;
  const generator =
    document.querySelector('meta[name="generator"]')?.getAttribute("content") ??
    "";
  return (
    /discourse/i.test(generator) ||
    !!document.querySelector("#data-discourse-setup")
  );
}

function scheduleVirtualizedLayoutRefresh(): void {
  if (!isDiscourseTopicPage()) return;
  if (virtualLayoutRefreshTimer !== undefined) {
    window.clearTimeout(virtualLayoutRefreshTimer);
  }
  virtualLayoutRefreshTimer = window.setTimeout(() => {
    virtualLayoutRefreshTimer = undefined;
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("scroll"));
    });
  }, VIRTUAL_LAYOUT_REFRESH_DELAY_MS);
}

function handleSoftNavigation(): void {
  const input = lastTranslateInput;
  pruneDisconnectedNodes();
  if (!input) {
    preferredMode = null;
    preferredEngine = null;
    preferredSource = null;
    preferredTarget = null;
    return;
  }

  runSeq++;
  pendingCount = 0;
  restoreDocumentTitle();
  cleanupAllTranslations();
  stopObservation();
  batchQueues?.text.destroy();
  batchQueues?.html.destroy();
  batchQueues = null;
  currentRule = null;
  currentBaseTextExtStyle = "";
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

// ── Loading skeleton ──────────────────────────────────────────────────────────

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
  const palette = getLoadingPalette();
  container.style.setProperty(LOADING_BASE_VAR, palette.base);
  container.style.setProperty(LOADING_FLOW_VAR, palette.flow);
}

function getLoadingLineCount(text: string): number {
  const len = text.replace(/\s+/g, " ").trim().length;
  if (len < 32) return 1;
  if (len < 110) return 2;
  if (len < 220) return 3;
  return 4;
}

function getBlockLoadingWidth(
  text: string,
  index: number,
  total: number,
): string {
  if (total === 1) return `${Math.min(Math.max(text.length * 1.7, 18), 72)}%`;
  if (index === total - 1)
    return `${Math.min(Math.max(38 + (text.length % 28), 34), 72)}%`;
  return index % 2 === 0 ? "100%" : "94%";
}

function getInlineLoadingWidth(text: string): string {
  return `${Math.min(Math.max(text.length * 0.58, 2.4), 12)}em`;
}

function getLoadingAnimationSeed(text: string): number {
  let hash = 0;
  const sample = text.slice(0, 96);
  for (let i = 0; i < sample.length; i++) {
    hash = (hash * 33 + sample.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function getLoadingAnimationDelay(seed: number, index: number): string {
  return (-0.12 - ((seed + index * 17) % 9) * 0.11 - index * 0.09).toFixed(2);
}

function getLoadingAnimationDuration(seed: number, index: number): string {
  return (1.6 + ((seed + index * 13) % 5) * 0.12).toFixed(2);
}

function getLoadingPalette(): { base: string; flow: string } {
  const bg =
    getSurfaceColor(document.body) ?? getSurfaceColor(document.documentElement);
  if (bg) {
    const luminance = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255;
    if (luminance < 0.45) {
      return { base: "rgba(255,255,255,0.09)", flow: "rgba(255,255,255,0.18)" };
    }
  }
  return { base: "rgba(0,0,0,0.055)", flow: "rgba(0,0,0,0.11)" };
}

function getSurfaceColor(
  el: HTMLElement | null,
): [number, number, number] | null {
  if (!el) return null;
  const match = window
    .getComputedStyle(el)
    .backgroundColor.match(
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
[${WRAPPER_ATTR}]::before,
[${WRAPPER_ATTR}]::after {
  content: none !important;
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
  return (
    window.location.hostname === "en.wikipedia.org" &&
    window.location.pathname === "/wiki/Main_Page"
  );
}

// ── DOM utilities (mirrors kiss-translator static helpers) ────────────────────

function shouldUseTranslationOnly(
  mode: PageTranslateMode,
  rule: ResolvedFullPageRule | null,
): boolean {
  return mode === "replace" || rule?.transOnly === true;
}

// Kiss-translator's #isInvalidText
function isInvalidText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < TRANS_MIN_LENGTH || trimmed.length > TRANS_MAX_LENGTH)
    return true;
  if (trimmed.length === 1 && !/[a-zA-Z]/.test(trimmed)) return true;
  if (!Number.isNaN(parseFloat(trimmed)) && Number.isFinite(Number(trimmed)))
    return true;
  return COMBINED_SKIP_RE.test(trimmed);
}

function shouldIgnoreMutationNode(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  if (element && isOurUiNode(element)) return true;
  for (const root of mutedMutationRoots) {
    if (root === node || root.contains(node)) return true;
  }
  return false;
}

function isQueueDestroyedError(err: unknown): boolean {
  return err instanceof Error && err.message === QUEUE_DESTROYED_ERROR;
}

function runWithMutedMutations(root: Node, run: () => void): void {
  mutedMutationRoots.add(root);
  try {
    run();
  } finally {
    window.setTimeout(() => mutedMutationRoots.delete(root), 0);
  }
}

// ── Shadow DOM ────────────────────────────────────────────────────────────────

function getOpenOrClosedShadowRoot(element: Element): ShadowRoot | null {
  if (element.shadowRoot) return element.shadowRoot;
  const ff = (
    element as Element & { openOrClosedShadowRoot?: ShadowRoot | null }
  ).openOrClosedShadowRoot;
  if (ff) return ff;
  if (!(element instanceof HTMLElement)) return null;
  const chromeFn = (
    globalThis as typeof globalThis & {
      chrome?: {
        dom?: {
          openOrClosedShadowRoot?: (el: HTMLElement) => ShadowRoot | null;
        };
      };
    }
  ).chrome?.dom?.openOrClosedShadowRoot;
  if (!chromeFn) return null;
  try {
    return chromeFn(element);
  } catch {
    return null;
  }
}

function findAndObserveShadowRoots(root: ParentNode): void {
  for (const el of root.querySelectorAll("*")) {
    const shadow = getOpenOrClosedShadowRoot(el);
    if (!shadow) continue;
    startObserveShadowRoot(shadow);
    findAndObserveShadowRoots(shadow);
  }
}
