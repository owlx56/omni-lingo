import { onMessage, sendMessage, type PageFeatureStatus } from "@/lib/messaging";
import {
  getSettings,
  resolveTargetLang,
  watchSettings,
} from "@/lib/storage/settings";
import {
  getSelectionEnabledStatus,
  initSelection,
  updateSelectionEnabledPref,
} from "@/features/selection";
import {
  applyThemeToDocument,
  initTheme,
  watchEffectiveTheme,
  type EffectiveTheme,
} from "@/lib/theme";

const READER_UI_ATTR = "data-onelingo-reader-ui";
const HOVER_DELAY_MS = 20;
const TOOLTIP_ATTR = "data-onelingo-pdf-tooltip";
const HOVER_HIGHLIGHT_ATTR = "data-onelingo-pdf-hover-highlight";
const PDF_TEXT_SPAN_ATTR = "data-onelingo-pdf-text-span";
const PDF_TOKEN_WRAP_ATTR = "data-onelingo-pdf-token-wrap";
const PDF_TOKEN_ATTR = "data-onelingo-pdf-token";
const LESS_TRANSLATE_SPLIT_RE = /(\s|\.|\,|\:|\!|\?|\"|\||\'|。|，|？|》|《)/g;
const LESS_TRANSLATE_CLEAN_RE = /(\:|,|\.|\?|\!|\=|\+|\"|\'|\(|\)|，|。|？|》|《)/g;
const LESS_TRANSLATE_REQUEST_CLEAN_RE = /(-|\.|,|\?)$/g;
const DIGIT_RE = /\d/;
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/;
const TEXT_REJECTS = new Set([
  "(",
  ")",
  "[",
  "%",
  "]",
  "{",
  "}",
  "?",
  ".",
  ",",
  "!",
  "/",
  "\\",
  "..",
  "...",
  "....",
  ".....",
  "......",
]);
const IGNORED_TAGS = new Set(["NOSCRIPT", "SCRIPT", "STYLE", "META"]);
const INPUT_TAGS = new Set(["TEXTAREA", "INPUT"]);
const SVG_TAGS = new Set([
  "altGlyph",
  "altGlyphDef",
  "altGlyphItem",
  "animate",
  "animateColor",
  "animateMotion",
  "animateTransform",
  "circle",
  "clipPath",
  "color-profile",
  "cursor",
  "defs",
  "desc",
  "ellipse",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  "filter",
  "font",
  "font-face",
  "font-face-format",
  "font-face-name",
  "font-face-src",
  "font-face-uri",
  "foreignObject",
  "g",
  "glyph",
  "glyphRef",
  "hkern",
  "image",
  "line",
  "linearGradient",
  "marker",
  "mask",
  "metadata",
  "missing-glyph",
  "mpath",
  "path",
  "pattern",
  "polygon",
  "polyline",
  "radialGradient",
  "rect",
  "script",
  "set",
  "stop",
  "style",
  "svg",
  "switch",
  "symbol",
  "text",
  "textPath",
  "title",
  "tref",
  "tspan",
  "use",
  "view",
  "vkern",
]);

const lessProcessedNodes = new WeakSet<Node>();
let pdfBridgeState: PdfBridgeState | null = null;

type LessTranslateNode = Node & {
  __translate?: 1;
  contentEditable?: string;
  tagName?: string;
};

interface PdfTextHit {
  anchor: DOMRect;
  highlightRects: DOMRect[];
  text: string;
  token: HTMLElement;
}

interface PdfTokenHit {
  highlightRects: DOMRect[];
  rect: DOMRect;
  text: string;
  token: HTMLElement;
}

interface PdfBridgeState {
  hoverEnabled: boolean;
  hoverPreferredEnabled: boolean | null;
  hoverTarget: string;
  hoverEngine: string;
  hoverFontSize: number;
  hoverSeq: number;
  hoverTimer: number | null;
  hoverAutoDismissTimer: number | null;
  lastElementFromPoint: Element | null;
  lastHoverKey: string;
  lastHoverText: string;
  tooltip: HTMLDivElement | null;
  highlightLayer: HTMLDivElement | null;
}

export default defineUnlistedScript(() => {
  document.documentElement.setAttribute("data-onelingo-pdf-viewer", "");
  initTheme();
  watchEffectiveTheme(syncPdfViewerTheme);
  markPdfChrome();
  initPdfTranslation();

  const observer = new MutationObserver(() => {
    markPdfChrome();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
});

function syncPdfViewerTheme(theme: EffectiveTheme): void {
  applyThemeToDocument(document, theme);
  document.documentElement.classList.toggle("onelingo-theme-dark", theme === "dark");
  document.documentElement.classList.toggle("onelingo-theme-light", theme === "light");
}

function markPdfChrome(): void {
  for (const selector of [
    "#toolbarContainer",
    "#sidebarContainer",
    "#secondaryToolbar",
    "#dialogContainer",
    "#printContainer",
    ".toolbar",
    ".toolbarButton",
    ".dropdownToolbarButton",
  ]) {
    for (const element of document.querySelectorAll(selector)) {
      element.setAttribute(READER_UI_ATTR, "");
    }
  }
}

function initPdfTranslation(): void {
  const state: PdfBridgeState = {
    hoverEnabled: true,
    hoverPreferredEnabled: null,
    hoverTarget: "zh-Hans",
    hoverEngine: "google",
    hoverFontSize: 14,
    hoverSeq: 0,
    hoverTimer: null,
    hoverAutoDismissTimer: null,
    lastElementFromPoint: null,
    lastHoverKey: "",
    lastHoverText: "",
    tooltip: null,
    highlightLayer: null,
  };
  pdfBridgeState = state;

  initSelection();

  void getSettings()
    .then((settings) => {
      applySettings(state, settings);
    })
    .catch((err: unknown) => {
      console.warn("[OneLingo] failed to read PDF reader settings:", err);
    });
  try {
    watchSettings((settings) => {
      applySettings(state, settings);
    });
  } catch (err: unknown) {
    console.warn("[OneLingo] failed to watch PDF reader settings:", err);
  }

  registerViewerMessageHandlers(state);
  document.addEventListener("mouseleave", () => dismissHover(state));
  window.addEventListener("mousemove", onPdfDocumentMouseMove);
  window.addEventListener("scroll", () => dismissHover(state));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      dismissHover(state);
    }
  });
}

function applySettings(
  state: PdfBridgeState,
  settings: Awaited<ReturnType<typeof getSettings>>,
): void {
  const prevHover = state.hoverEnabled;
  state.hoverEnabled = state.hoverPreferredEnabled ?? settings.hoverEnabled;
  state.hoverTarget = resolveTargetLang(settings.hoverTargetLang, settings.uiLang);
  state.hoverEngine = settings.engines.hover;
  state.hoverFontSize = settings.hoverFontSize;
  if (prevHover && !state.hoverEnabled) dismissHover(state);
}

function registerViewerMessageHandlers(state: PdfBridgeState): void {
  const readFeatureStatus = (): PageFeatureStatus => ({
    fullPageClickToShowOriginal: false,
    hoverEnabled: state.hoverEnabled,
    ...getSelectionEnabledStatus(),
    hasFullPageClickToShowOriginalPref: false,
    hasHoverEnabledPref: state.hoverPreferredEnabled !== null,
  });

  onMessage("readPageFeatureStatus", () => readFeatureStatus());
  onMessage("updatePageFeaturePrefs", (input) => {
    if (input.hoverEnabled !== undefined) {
      state.hoverPreferredEnabled = input.hoverEnabled;
      state.hoverEnabled = input.hoverEnabled;
      if (!state.hoverEnabled) dismissHover(state);
    }
    if (input.selectionEnabled !== undefined) {
      updateSelectionEnabledPref(input.selectionEnabled);
    }
    return readFeatureStatus();
  });
}

function onPdfTokenMouseEnter(token: HTMLElement): void {
  const state = pdfBridgeState;
  if (!state?.hoverEnabled) return;
  startPdfHover(pdfTextHitFromToken(token), state);
}

function onPdfDocumentMouseMove(event: MouseEvent): void {
  const state = pdfBridgeState;
  if (!state?.hoverEnabled) return;
  const target = document.elementFromPoint(event.clientX, event.clientY);
  if (isReaderUi(target)) {
    dismissHover(state);
    state.lastElementFromPoint = null;
    return;
  }
  if (!(target instanceof Element)) {
    dismissHover(state);
    state.lastElementFromPoint = null;
    return;
  }

  const token = target.closest<HTMLElement>(`[${PDF_TOKEN_ATTR}]`);
  if (token?.closest(".textLayer")) {
    state.lastElementFromPoint = target;
    return;
  }

  if (target !== state.lastElementFromPoint) {
    dismissHover(state);
  }
  processLessPdfHoverElement(target);
  state.lastElementFromPoint = target;
}

function onPdfTokenMouseClear(): void {
  const state = pdfBridgeState;
  if (state) dismissHover(state);
}

function startPdfHover(hit: PdfTextHit | null, state: PdfBridgeState): void {
  if (!state.hoverEnabled) return;
  const requestText = hit ? normalizeLessTranslateRequestText(hit.text) : "";
  if (!hit || !requestText || !isLessTranslatableText(requestText)) {
    dismissHover(state);
    return;
  }
  const hoverKey = makeHoverKey(hit);
  if (hoverKey === state.lastHoverKey) return;
  state.lastHoverKey = hoverKey;
  state.lastHoverText = hit.text;
  state.hoverSeq++;
  const seq = state.hoverSeq;
  clearHoverTimer(state);
  clearHoverAutoDismissTimer(state);
  state.hoverAutoDismissTimer = window.setTimeout(
    () => dismissHover(state),
    hit.text.length > 40 ? 13500 : 3500,
  );

  state.hoverTimer = window.setTimeout(() => {
    state.hoverTimer = null;
    const currentHit = pdfTextHitFromToken(hit.token);
    if (!currentHit) {
      dismissHover(state);
      return;
    }
    setHighlight(state, currentHit);
    void sendMessage("translate", {
      engine: state.hoverEngine,
      target: state.hoverTarget,
      text: requestText,
    })
      .then((res) => {
        if (
          seq !== state.hoverSeq ||
          isSameLanguageResult(res.detectedSource, state.hoverTarget)
        ) {
          if (seq === state.hoverSeq) dismissHover(state);
          return;
        }
        const freshHit = pdfTextHitFromToken(hit.token);
        if (freshHit) showHoverTooltip(state, res.text, freshHit.anchor);
      })
      .catch((err: unknown) => {
        console.warn("[OneLingo] PDF hover translate failed:", err);
        if (seq === state.hoverSeq) dismissHover(state);
      });
  }, HOVER_DELAY_MS);
}

function processLessPdfHoverElement(element: Element): void {
  if (!element.closest(".textLayer")) return;
  if (element.closest(".highlight")) return;
  if (element.classList.contains("highlight")) return;
  if (element.getAttribute("role") === "img") return;

  const lessElement = element as LessTranslateNode;
  if (!element || lessProcessedNodes.has(element)) return;
  lessProcessedNodes.add(element);
  if (
    (lessElement.tagName && IGNORED_TAGS.has(lessElement.tagName)) ||
    isLessTranslatedNode(element.parentElement) ||
    isLessTranslatedNode(element) ||
    isSvgLikeNode(lessElement) ||
    (lessElement.tagName && INPUT_TAGS.has(lessElement.tagName))
  ) {
    return;
  }

  for (const node of [...element.childNodes]) {
    if (
      lessProcessedNodes.has(node) ||
      node.nodeType !== Node.TEXT_NODE ||
      !node.textContent ||
      !node.parentElement ||
      isLessTranslatedNode(node.parentElement)
    ) {
      continue;
    }

    lessProcessedNodes.add(node);
    if (
      node.parentElement.closest(".monaco-editor") ||
      node.parentElement.closest(".CodeMirror")
    ) {
      continue;
    }

    window.requestAnimationFrame(() => {
      tokenizePdfTextNodeLikeLess(node);
    });
  }
}

function tokenizePdfTextNodeLikeLess(node: ChildNode): void {
  const lessNode = node as LessTranslateNode;
  if (
    !node ||
    isLessTranslatedNode(node) ||
    lessNode.contentEditable === "true" ||
    node.nodeName === "INPUT" ||
    node.nodeName === "TEXTAREA" ||
    isSvgLikeNode(lessNode)
  ) {
    return;
  }

  const text = node.textContent ?? "";
  if (!isLessTranslatableText(text)) return;
  if (node.nodeName !== "#text" || lessNode.tagName != null) return;

  const wrapper = document.createElement("span");
  wrapper.style.cssText = "all: unset";
  wrapper.setAttribute(PDF_TEXT_SPAN_ATTR, "");
  wrapper.setAttribute(PDF_TOKEN_WRAP_ATTR, "");
  (wrapper as LessTranslateNode).__translate = 1;
  wrapper.addEventListener(
    "mousedown",
    () => {
      wrapper.style.pointerEvents = "none";
      window.setTimeout(() => {
        if (wrapper.isConnected) wrapper.style.cssText = "all: unset";
      }, 500);
    },
    { passive: true },
  );

  for (const segment of lessTranslateSplitSegments(text)) {
    const token = document.createElement("span");
    token.style.cssText = "all: unset";
    token.textContent = segment;
    (token as LessTranslateNode).__translate = 1;
    const trimmed = segment.trim();
    if (trimmed && trimmed.length > 0 && !DIGIT_RE.test(trimmed)) {
      token.setAttribute(PDF_TOKEN_ATTR, "");
      bindPdfTokenHover(token);
    }
    wrapper.appendChild(token);
  }

  node.replaceWith(wrapper);
}

function bindPdfTokenHover(token: HTMLElement): void {
  token.addEventListener(
    "mouseenter",
    () => {
      onPdfTokenMouseEnter(token);
    },
    true,
  );
  token.addEventListener(
    "mouseout",
    () => {
      onPdfTokenMouseClear();
    },
    true,
  );
  token.addEventListener(
    "mouseleave",
    () => {
      onPdfTokenMouseClear();
    },
    true,
  );
  token.addEventListener(
    "mouseover",
    () => {
      onPdfTokenMouseClear();
    },
    true,
  );
}

function pdfTextHitFromToken(token: HTMLElement): PdfTextHit | null {
  const word = pdfTokenHit(token);
  if (!word) return null;

  return {
    anchor: word.rect,
    highlightRects: word.highlightRects,
    text: word.text,
    token: word.token,
  };
}

function makeHoverKey(hit: PdfTextHit): string {
  const rectKey = hit.highlightRects
    .map(
      (rect) =>
        `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`,
    )
    .join("|");
  return `${hit.text}\n${rectKey}`;
}

function pdfTokenHit(token: HTMLElement): PdfTokenHit | null {
  if (!token.hasAttribute(PDF_TOKEN_ATTR)) return null;
  if (!token.closest(".textLayer")) return null;

  const rect = token.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  let text = (token.textContent ?? "").trim();
  if (/\s/.test(text)) text = text.replace(LESS_TRANSLATE_CLEAN_RE, "");
  if (!text) return null;

  return {
    highlightRects: [rect],
    rect,
    text,
    token,
  };
}

function lessTranslateSplitSegments(text: string): string[] {
  return text.split(LESS_TRANSLATE_SPLIT_RE).filter(Boolean);
}

function normalizeLessTranslateRequestText(text: string): string {
  return text
    .replace(/-\n/g, "")
    .replace(/\n/g, " ")
    .replace(LESS_TRANSLATE_REQUEST_CLEAN_RE, "")
    .replace(/%/g, "");
}

function isLessTranslatableText(text: string): boolean {
  if (text.length > 9999) return false;
  const trimmed = text.trim();
  if (!trimmed || TEXT_REJECTS.has(trimmed)) return false;
  if (/^(http\:\/\/|https\:\/\/)/.test(trimmed)) return false;
  if (/(function\(|\<script|\<style|background\:|color\:|font-size\:)/.test(trimmed)) {
    return false;
  }
  if (!Number.isNaN(Number(trimmed))) return false;
  return !CJK_RE.test(trimmed);
}

function isLessTranslatedNode(node: Node | null): boolean {
  return !!(node as LessTranslateNode | null)?.__translate;
}

function isSvgLikeNode(node: LessTranslateNode): boolean {
  const tagName = node.tagName;
  return (
    (typeof SVGAElement !== "undefined" && node instanceof SVGAElement) ||
    !!(tagName && (SVG_TAGS.has(tagName) || SVG_TAGS.has(tagName.toLowerCase())))
  );
}

function isSameLanguageResult(
  detectedSource: string | undefined,
  target: string,
): boolean {
  if (!detectedSource) return false;
  return primaryLang(detectedSource) === primaryLang(target);
}

function primaryLang(lang: string): string {
  return lang.toLowerCase().split(/[-_]/, 1)[0] ?? "";
}

function showHoverTooltip(
  state: PdfBridgeState,
  translation: string,
  anchor: DOMRect,
): void {
  let tooltip = state.tooltip;
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.setAttribute(TOOLTIP_ATTR, "");
    tooltip.style.cssText = [
      "opacity:0",
      "font-size:13px",
      "width:auto",
      "max-width:400px",
      "display:inline",
      "position:fixed",
      "z-index:2147483647",
      "top:0px",
      "left:0",
      "pointer-events:none",
      "padding:5px 7px",
      "background:rgba(10,10,11,0.95)",
      "color:rgba(255,255,255,0.93)",
      "box-shadow:0px 2px 2px rgba(0,0,0,0.07)",
      "border-radius:5px",
      "line-height:1.3",
      'font-family:"SF Pro SC","SF Pro Text","SF Pro Icons","PingFang SC","Helvetica Neue","Helvetica","Arial",sans-serif',
      "white-space:pre-wrap",
      "word-break:break-word",
    ].join(";");
    document.body.appendChild(tooltip);
    state.tooltip = tooltip;
  }
  tooltip.textContent = translation;
  tooltip.style.fontSize = `${state.hoverFontSize}px`;
  tooltip.style.display = "inline";
  tooltip.style.opacity = "0";
  positionFloating(tooltip, anchor);
  tooltip.style.opacity = "1";
}

function positionFloating(el: HTMLElement, anchor: DOMRect): void {
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  el.style.right = "auto";
  el.style.left = `${anchor.left + anchor.width / 2 - width / 2}px`;
  el.style.top =
    anchor.top < 60
      ? `${anchor.top + anchor.height + 20}px`
      : `${anchor.top - height - 15}px`;
}

function dismissHover(state: PdfBridgeState): void {
  clearHoverTimer(state);
  clearHoverAutoDismissTimer(state);
  state.hoverSeq++;
  state.lastHoverKey = "";
  state.lastHoverText = "";
  clearHighlight(state);
  if (state.tooltip) {
    state.tooltip.style.opacity = "0";
    state.tooltip.textContent = "";
  }
}

function clearHoverTimer(state: PdfBridgeState): void {
  if (state.hoverTimer !== null) {
    clearTimeout(state.hoverTimer);
    state.hoverTimer = null;
  }
}

function clearHoverAutoDismissTimer(state: PdfBridgeState): void {
  if (state.hoverAutoDismissTimer !== null) {
    clearTimeout(state.hoverAutoDismissTimer);
    state.hoverAutoDismissTimer = null;
  }
}

function isReaderUi(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(`[${READER_UI_ATTR}]`);
}

function setHighlight(state: PdfBridgeState, hit: PdfTextHit): void {
  setOverlayHighlight(state, hit.highlightRects);
}

function setOverlayHighlight(state: PdfBridgeState, rects: DOMRect[]): void {
  const layer = ensureHighlightLayer(state);
  layer.replaceChildren(
    ...rects.map((rect) => {
      const line = document.createElement("span");
      line.style.cssText = [
        "position:fixed",
        "pointer-events:none",
        "z-index:2147483646",
        "height:1px",
        "background:rgba(128,128,128,0.4)",
        `left:${rect.left}px`,
        `top:${rect.top + rect.height + 2}px`,
        `width:${rect.width}px`,
      ].join(";");
      return line;
    }),
  );
}

function clearHighlight(state: PdfBridgeState): void {
  clearOverlayHighlight(state);
}

function clearOverlayHighlight(state: PdfBridgeState): void {
  state.highlightLayer?.replaceChildren();
}

function ensureHighlightLayer(state: PdfBridgeState): HTMLDivElement {
  if (state.highlightLayer?.isConnected) return state.highlightLayer;
  const layer = document.createElement("div");
  layer.setAttribute(HOVER_HIGHLIGHT_ATTR, "");
  layer.style.cssText = [
    "position:fixed",
    "inset:0",
    "pointer-events:none",
    "z-index:2147483646",
  ].join(";");
  document.documentElement.appendChild(layer);
  state.highlightLayer = layer;
  return layer;
}
