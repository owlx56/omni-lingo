import { BUILTIN_IGNORE_SELECTOR, HARD_SKIP_TAGS } from "./markup";
import type { ResolvedFullPageRule } from "./rules";
import {
  closestSelectorSafe,
  matchesSelectorSafe,
  querySelectorAllSafe,
} from "./selectors";
import { INNER_ATTR, WRAPPER_ATTR } from "./dom-attrs";

export interface ScanContext {
  intersectionObserver: IntersectionObserver;
  observedNodes: Set<HTMLElement>;
  viewNodes: Set<HTMLElement>;
  processedNodes: WeakMap<HTMLElement, ResolvedFullPageRule>;
  onNodeReady: (node: HTMLElement) => void;
}

const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "CANVAS",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "NOSCRIPT",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TFOOT",
  "UL",
  "VIDEO",
]);

const INLINE_TAGS = new Set([
  "ABBR",
  "ACRONYM",
  "B",
  "BDO",
  "BIG",
  "BR",
  "BUTTON",
  "CITE",
  "CODE",
  "DFN",
  "DEL",
  "FONT",
  "EM",
  "I",
  "IMG",
  "INPUT",
  "INS",
  "KBD",
  "LABEL",
  "MAP",
  "MARK",
  "OBJECT",
  "OUTPUT",
  "Q",
  "RUBY",
  "SAMP",
  "SCRIPT",
  "SELECT",
  "SMALL",
  "STRONG",
  "SUB",
  "SUP",
  "TEXTAREA",
  "TIME",
  "TT",
  "U",
  "VAR",
]);

const SKIP_ANCESTOR_SELECTOR = [
  "pre",
  "code",
  "kbd",
  "samp",
  "var",
  "svg",
  "math",
  "canvas",
  "iframe",
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[translate='no']",
  "[aria-hidden='true']",
  "[hidden]",
  ".notranslate",
  ".sr-only",
  ".visually-hidden",
  `[${WRAPPER_ATTR}]`,
].join(",");

const displayCache = new WeakMap<Element, boolean>();
const selectStyleAttrs = new WeakMap<
  HTMLElement,
  { original: string | null; count: number }
>();
const parentStyleAttrs = new WeakMap<
  HTMLElement,
  { original: string | null; count: number }
>();
const grandStyleAttrs = new WeakMap<
  HTMLElement,
  { original: string | null; count: number }
>();

export function scanNode(
  rootNode: ParentNode,
  rule: ResolvedFullPageRule,
  ctx: ScanContext,
): void {
  if (rootNode instanceof HTMLElement && shouldIgnoreNode(rootNode, rule))
    return;

  if (!rule.autoScan) {
    queryNodes(rootNode, rule, ctx);
    return;
  }

  if (rootNode instanceof HTMLElement) {
    const hasText = hasDirectText(rootNode);

    if (!hasText && rootNode.children.length === 1) {
      const child = rootNode.children.item(0);
      if (child) scanNode(child, rule, ctx);
      return;
    }

    const hasBlock = hasBlockNode(rootNode);
    if (hasText || !hasBlock) startObserveNode(rootNode, rule, ctx);
    if (hasBlock) {
      for (const child of Array.from(rootNode.children)) {
        if (!hasText || isBlockNode(child)) scanNode(child, rule, ctx);
      }
    }
    return;
  }

  for (const child of Array.from(rootNode.childNodes)) {
    if (child instanceof HTMLElement) scanNode(child, rule, ctx);
  }
}

function queryNodes(
  rootNode: ParentNode,
  rule: ResolvedFullPageRule,
  ctx: ScanContext,
): void {
  if (!rule.selector) return;
  const sel = rule.selector;
  if (rootNode instanceof HTMLElement && matchesSelectorSafe(rootNode, sel)) {
    startObserveNode(rootNode, rule, ctx);
  }
  querySelectorAllSafe(rootNode, sel).forEach((node) => {
    if (node instanceof HTMLElement) startObserveNode(node, rule, ctx);
  });
}

function startObserveNode(
  node: HTMLElement,
  rule: ResolvedFullPageRule,
  ctx: ScanContext,
): void {
  if (shouldIgnoreNode(node, rule)) return;
  applyRuleStyles(node, rule);

  if (!ctx.observedNodes.has(node)) {
    ctx.observedNodes.add(node);
    ctx.intersectionObserver.observe(node);
  }

  if (ctx.processedNodes.has(node)) return;

  if (rule.scanAll || ctx.viewNodes.has(node) || isVisible(node)) {
    ctx.viewNodes.add(node);
    ctx.onNodeReady(node);
  }
}

export function isBlockNode(node: Node): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (INLINE_TAGS.has(node.tagName)) return false;
  if (BLOCK_TAGS.has(node.tagName)) return true;
  if (displayCache.has(node)) return displayCache.get(node)!;
  const display = window.getComputedStyle(node).display;
  const isBlock =
    !display.startsWith("inline") &&
    /^(block|flex|grid|list-item|table)/.test(display);
  displayCache.set(node, isBlock);
  return isBlock;
}

function hasDirectText(el: HTMLElement): boolean {
  return Array.from(el.childNodes).some(
    (c) => c.nodeType === Node.TEXT_NODE && /\S/.test(c.nodeValue ?? ""),
  );
}

function hasBlockNode(el: HTMLElement): boolean {
  return Array.from(el.childNodes).some((c) => isBlockNode(c));
}

export function shouldIgnoreNode(
  el: HTMLElement,
  rule: ResolvedFullPageRule | null,
): boolean {
  if (isOurUiNode(el)) return true;
  if (HARD_SKIP_TAGS.has(el.tagName)) return true;
  if (el.isContentEditable) return true;
  if (el.closest(SKIP_ANCESTOR_SELECTOR)) return true;
  if (!rule) return false;
  const ignore = buildIgnoreSelector(rule);
  if (ignore && matchesSelectorSafe(el, ignore)) return true;
  if (ignore && closestSelectorSafe(el, ignore)) return true;
  return false;
}

function buildIgnoreSelector(rule: ResolvedFullPageRule | null): string {
  if (!rule) return BUILTIN_IGNORE_SELECTOR;
  const parts: string[] = [BUILTIN_IGNORE_SELECTOR];
  if (rule.ignoreSelector.trim()) parts.push(rule.ignoreSelector);
  return parts.join(", ");
}

export function isOurWrapper(node: Node): boolean {
  return node instanceof Element && node.hasAttribute(WRAPPER_ATTR);
}

export function isOurUiNode(el: Element): boolean {
  return (
    el.hasAttribute(WRAPPER_ATTR) ||
    el.hasAttribute(INNER_ATTR) ||
    !!el.closest(
      `[data-onelingo-tooltip],[data-onelingo-host],[${WRAPPER_ATTR}]`,
    )
  );
}

export function isVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0"
  ) {
    return false;
  }
  if (el.getClientRects().length > 0) return true;
  if (el.offsetParent !== null) return true;
  return (
    style.position === "fixed" ||
    style.position === "sticky" ||
    style.position === "absolute"
  );
}

export function applyRuleStyles(
  node: HTMLElement,
  rule: ResolvedFullPageRule,
): void {
  applyRuleStyle(node, rule.selectStyle, selectStyleAttrs);
  applyRuleStyle(node.parentElement, rule.parentStyle, parentStyleAttrs);
  applyRuleStyle(
    node.parentElement?.parentElement ?? null,
    rule.grandStyle,
    grandStyleAttrs,
  );
}

export function restoreRuleStyles(node: HTMLElement): void {
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
  if (existing) {
    existing.count++;
    return;
  }
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

export function appendInlineStyle(el: HTMLElement, cssText: string): void {
  const patch = cssText.trim();
  if (!patch) return;
  const base = el.getAttribute("style")?.trim();
  el.setAttribute(
    "style",
    base ? `${base}${base.endsWith(";") ? "" : ";"} ${patch}` : patch,
  );
}
