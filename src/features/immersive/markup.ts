import type { TranslateFormat } from "@/engines/types";
import type { ResolvedFullPageRule } from "./rules";
import { closestSelectorSafe, matchesSelectorSafe } from "./selectors";

// Tags whose outerHTML is replaced entirely by a placeholder {n}.
const RICH_TEXT_REPLACE_TAGS = new Set([
  "ABBR", "BR", "CODE", "DFN", "IMG", "KBD", "OUTPUT", "RP", "RT",
  "SAMP", "SUB", "SUP", "SVG", "TIME", "VAR", "WBR",
]);

// Tags wrapped in <i n>...</i n> placeholder (content translated, tag restored).
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
// TABLE/TR/TD/TH are intentionally not here so table-contained article text is scanned.
export const HARD_SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "HEAD", "META", "LINK", "TEMPLATE",
  "SVG", "MATH", "IMG", "VIDEO", "AUDIO", "CANVAS", "IFRAME",
  "INPUT", "TEXTAREA", "SELECT",
  "PRE", "CODE", "KBD", "SAMP", "VAR",
]);

// Sub-trees excluded from serialisation (noise text).
const EXCLUDE_TEXT_SELECTOR = [
  ".mw-editsection",
  ".sr-only", ".visually-hidden", "[hidden]", "[aria-hidden='true']",
].join(",");

// kiss-translator's BUILTIN_IGNORE_SELECTOR.
export const BUILTIN_IGNORE_SELECTOR = [
  "address", "area", "audio", "br", "canvas", "data", "datalist", "embed",
  "head", "iframe", "input", "noscript", "map", "object", "option", "param",
  "picture", "progress", "select", "script", "style", "svg", "track",
  "textarea", "template", "video", "wbr",
  ".notranslate", "[contenteditable='true']", "[translate='no']",
].join(", ");

// Single-brace placeholders match kiss-translator's default "{ }" delimiter format.
// Some engines normalize "{{1}}" into "{1}", breaking double-brace restoration.
// Single braces "{1}" are more stable across the plain-text fallback path.
const PLACEHOLDER_START = "{";
const PLACEHOLDER_END = "}";
const PLACEHOLDER_RE = /\{\d+\}/g;
const PLACEHOLDER_TAG = "i";
const PLACEHOLDER_SAFE_TAG = "span";
// Compact format: <i1>content</i1> matches kiss-translator's default placetagFormat.
const PLACEHOLDER_OPEN_RE = /<i(\d+)>/gi;
const PLACEHOLDER_CLOSE_RE = /<\/i\d+>/gi;
const PRESERVE_HTML_ATTR = "data-onelingo-preserve";

interface WrappedPlaceholder {
  openTag: string;
  closeTag: string;
}

export type PlaceholderMap = Map<string, string | WrappedPlaceholder>;

export interface SerializedNodes {
  html: string;
  format: TranslateFormat;
  placeholders: PlaceholderMap;
}

export interface SerializeNodesOptions {
  separator?: string;
}

export function serializeNodes(
  nodes: Iterable<Node>,
  format: TranslateFormat,
  rule: ResolvedFullPageRule,
  options: SerializeNodesOptions = {},
): SerializedNodes {
  let replaceCounter = 0;
  let wrapCounter = 0;
  let preserveCounter = 0;
  const placeholders: PlaceholderMap = new Map();
  const isHtml = format === "html";

  const pushReplace = (html: string): string => {
    replaceCounter++;
    const key = `${PLACEHOLDER_START}${replaceCounter}${PLACEHOLDER_END}`;
    placeholders.set(key, html);
    return key;
  };

  const pushWrappedTag = (el: HTMLElement, innerContent: string): string => {
    wrapCounter++;
    placeholders.set(`TAG_${wrapCounter}`, {
      openTag: buildOpeningTag(el),
      closeTag: `</${el.localName}>`,
    });
    return `<${PLACEHOLDER_TAG}${wrapCounter}>${innerContent}</${PLACEHOLDER_TAG}${wrapCounter}>`;
  };

  const preserveHtmlNode = (el: HTMLElement): string => {
    preserveCounter++;
    const clone = el.cloneNode(true) as HTMLElement;
    clone.setAttribute("translate", "no");
    clone.setAttribute(PRESERVE_HTML_ATTR, String(preserveCounter));
    placeholders.set(`HTML_${preserveCounter}`, el.outerHTML);
    return clone.outerHTML;
  };

  const pushOpaqueTextNode = (el: HTMLElement): string => {
    if (el.tagName === "IMG" || el.tagName === "SVG") {
      el.style.width = `${el.offsetWidth}px`;
      el.style.height = `${el.offsetHeight}px`;
    }
    return pushReplace(el.outerHTML);
  };

  const serializeTextNode = (node: Node): string => {
    const text = node.nodeValue ?? "";
    if (isHtml) return escapeHtml(text);
    return escapeHtml(text.replace(/\r?\n/g, () => pushReplace("&#10;")));
  };

  const traverse = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return serializeTextNode(node);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    if (isHtml && !(node instanceof HTMLElement)) return "";

    const el = node as HTMLElement;

    if (shouldDropNodeFromSerialization(el)) return "";

    const semanticLabel = getSemanticTranslationLabel(el);
    if (semanticLabel) {
      const label = escapeHtml(semanticLabel);
      if (isHtml && RICH_HTML_INLINE_TAGS.has(el.tagName)) {
        return `${buildRichHtmlOpeningTag(el)}${label}</${el.localName}>`;
      }
      return label;
    }

    if (isHtml) {
      if (shouldPreserveNode(el)) {
        return preserveHtmlNode(el);
      }
      if (el.tagName === "BR" || el.tagName === "WBR") return " ";
      if (el.tagName === "IMG" || el.tagName === "SVG") return el.outerHTML;
      if (shouldSkipInlineTextNode(el)) return "";
      if (shouldIgnoreNodeForSerialization(el)) return preserveHtmlNode(el);

      const inner = Array.from(el.childNodes).map(traverse).join("");
      if (!inner.trim()) return "";
      if (!RICH_HTML_INLINE_TAGS.has(el.tagName)) return inner;
      return `${buildRichHtmlOpeningTag(el)}${inner}</${el.localName}>`;
    }

    if (shouldIgnoreNodeForSerialization(el)) return pushReplace(el.outerHTML);

    if (
      shouldPreserveNode(el) ||
      (rule.hasRichText && RICH_TEXT_REPLACE_TAGS.has(el.tagName)) ||
      matchesSelectorSafe(el, rule.keepSelector) ||
      !el.textContent?.trim()
    ) {
      return pushOpaqueTextNode(el);
    }

    let innerContent = "";
    el.childNodes.forEach((child) => { innerContent += traverse(child); });

    if (rule.hasRichText && RICH_TEXT_WRAP_TAGS.has(el.tagName)) {
      return pushWrappedTag(el, innerContent);
    }

    return innerContent;
  };

  const separator = options.separator ? escapeHtml(options.separator) : "";
  const chunks = Array.from(nodes).map(traverse);
  const raw = separator
    ? chunks.map((chunk) => chunk.trim()).filter(Boolean).join(separator)
    : chunks.join("");
  const html = isHtml ? normalizeInlineText(raw) : raw.trim();
  if (isHtml) placeholders.set("__html__", "");
  return { html, format, placeholders };
}

export function pickSerializeFormat(
  host: HTMLElement,
  rule: ResolvedFullPageRule,
): TranslateFormat {
  if (!rule.hasRichText) return "text";
  if (!rule.richHtmlSelector) return "text";
  const engine = rule.engine;
  if (engine !== "google2" && engine !== "microsoft") return "text";
  if (!closestSelectorSafe(host, rule.richHtmlSelector)) return "text";
  if (
    rule.richHtmlExcludeSelector &&
    closestSelectorSafe(host, rule.richHtmlExcludeSelector)
  ) {
    return "text";
  }
  return "html";
}

function buildRichHtmlOpeningTag(el: HTMLElement): string {
  if (el.tagName !== "A") {
    const attrs: string[] = [];
    const className = el.getAttribute("class");
    const title = el.getAttribute("title");
    const lang = el.getAttribute("lang");
    const dir = el.getAttribute("dir");
    if (className) attrs.push(`class="${escapeHtmlAttr(className)}"`);
    if (title) attrs.push(`title="${escapeHtmlAttr(title)}"`);
    if (lang) attrs.push(`lang="${escapeHtmlAttr(lang)}"`);
    if (dir) attrs.push(`dir="${escapeHtmlAttr(dir)}"`);
    return `<${el.localName}${attrs.length > 0 ? ` ${attrs.join(" ")}` : ""}>`;
  }

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

function shouldSkipInlineTextNode(el: Element): boolean {
  if (shouldDropNodeFromSerialization(el)) return true;
  if (HARD_SKIP_TAGS.has(el.tagName)) return true;
  return false;
}

function getSemanticTranslationLabel(el: HTMLElement): string | null {
  const languageName = el.getAttribute("data-language-local-name")?.trim();
  return languageName || null;
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

export function appendTranslatedContent(
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function normalizeInlineText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
