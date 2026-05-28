import { onMessage, sendMessage, type PageFeatureStatus } from "@/lib/messaging";
import { loadDocument } from "@/lib/document-store";
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
const STORED_PDF_KEY_PARAM = "onelingo-key";
const SNIFFED_PDF_PARAM = "onelingo-sniff";
const HOVER_DELAY_MS = 20;
const VIEWER_APP_MAX_ATTEMPTS = 100;
const TOOLTIP_ATTR = "data-onelingo-pdf-tooltip";
const HOVER_HIGHLIGHT_ATTR = "data-onelingo-pdf-hover-highlight";
const LESS_TRANSLATE_SPLIT_RE = /(\s|\.|\,|\:|\!|\?|\"|\||\'|。|，|？|》|《)/g;
const LESS_TRANSLATE_CLEAN_RE = /(\:|,|\.|\?|\!|\=|\+|\"|\'|\(|\)|，|。|？|》|《)/g;
const LESS_TRANSLATE_REQUEST_CLEAN_RE = /(-|\.|,|\?)$/g;
const POINT_RECT_TOLERANCE_PX = 1;
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
const textSegmentCache = new WeakMap<Text, TextSegmentCacheEntry>();
const textNodeIds = new WeakMap<Text, number>();
let nextTextNodeId = 1;
let pdfBridgeState: PdfBridgeState | null = null;

interface TextSegment {
  start: number;
  end: number;
  text: string;
}

interface TextSegmentCacheEntry {
  segments: TextSegment[];
  text: string;
}

interface PdfTextHit {
  anchor: DOMRect;
  key: string;
  rects: DOMRect[];
  startOffset: number;
  endOffset: number;
  text: string;
  textNode: Text;
}

interface PdfViewerApplication {
  initializedPromise?: Promise<void>;
  open(input: { data: Uint8Array } | { url: string }): Promise<void>;
  setTitle?(title: string): void;
}

type PdfViewerWindow = Window & typeof globalThis & {
  PDFViewerApplication?: PdfViewerApplication;
};

interface PdfBridgeState {
  hoverEnabled: boolean;
  hoverPreferredEnabled: boolean | null;
  hoverTarget: string;
  hoverEngine: string;
  hoverSeq: number;
  hoverTimer: number | null;
  hoverAutoDismissTimer: number | null;
  lastElementFromPoint: Element | null;
  lastHoverKey: string;
  lastHoverText: string;
  tooltip: HTMLElement | null;
  highlightLayer: HTMLDivElement | null;
}

export default defineUnlistedScript(() => {
  document.documentElement.setAttribute("data-onelingo-pdf-viewer", "");
  initTheme();
  watchEffectiveTheme(syncPdfViewerTheme);
  markPdfChrome();
  initPdfTranslation();
  void bootstrapPdfDocumentOpen().catch((err: unknown) => {
    console.warn("[OneLingo] failed to bootstrap PDF document:", err);
  });

  const observer = new MutationObserver(() => {
    markPdfChrome();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
});

async function bootstrapPdfDocumentOpen(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const key = params.get(STORED_PDF_KEY_PARAM);
  const shouldConsumeSniffed = params.get(SNIFFED_PDF_PARAM) === "1";
  if (!key && !shouldConsumeSniffed) return;

  const app = await waitForPdfViewerApplication();
  await app.initializedPromise;

  if (key) {
    await openStoredPdf(app, key);
    return;
  }

  if (shouldConsumeSniffed) {
    await openSniffedPdf(app);
  }
}

async function openStoredPdf(
  app: PdfViewerApplication,
  key: string,
): Promise<void> {
  const doc = await loadDocument(key);
  if (!doc) {
    throw new Error("Stored PDF document was not found.");
  }
  if (doc.format !== "pdf") {
    throw new Error("Stored document is not a PDF.");
  }

  await app.open({ data: new Uint8Array(doc.data.slice(0)) });
  const title = doc.name.replace(/\.pdf$/i, "") || doc.name;
  if (title) {
    app.setTitle?.(title);
    document.title = title;
  }
}

async function openSniffedPdf(app: PdfViewerApplication): Promise<void> {
  const pending = await sendMessage("consumeSniffedDocument", {});
  if (pending?.action === "open" && pending.url) {
    history.replaceState(history.state, "", currentPdfViewerUrlForFile(pending.url));
    await app.open({ url: pending.url });
    return;
  }
  if (pending?.action === "bypass" && pending.url) {
    location.replace(pending.url);
    return;
  }
  if (pending?.action === "handled") {
    window.close();
    return;
  }
  throw new Error("No sniffed PDF document URL was found.");
}

function currentPdfViewerUrlForFile(fileUrl: string): string {
  const url = new URL(location.href);
  url.searchParams.delete(SNIFFED_PDF_PARAM);
  url.searchParams.set("file", fileUrl);
  return url.href;
}

async function waitForPdfViewerApplication(): Promise<PdfViewerApplication> {
  const win = window as PdfViewerWindow;
  for (let attempt = 0; attempt < VIEWER_APP_MAX_ATTEMPTS; attempt++) {
    const app = win.PDFViewerApplication;
    if (app?.open) return app;
    await sleep(50);
  }
  throw new Error("PDF viewer application did not initialize.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function syncPdfViewerTheme(theme: EffectiveTheme): void {
  applyThemeToDocument(document, theme);
  document.documentElement.classList.toggle("onelingo-theme-dark", theme === "dark");
  document.documentElement.classList.toggle("onelingo-theme-light", theme === "light");
}

function markPdfChrome(): void {
  for (const selector of [
    "#toolbarContainer",
    "#toolbarSidebar",
    "#sidebarContainer",
    "#secondaryToolbar",
    "#findbar",
    "#dialogContainer",
    "#printContainer",
    "#loadingBar",
    ".dialog",
    ".doorHanger",
    ".toolbar",
    ".toolbarButton",
    ".secondaryToolbarButton",
    ".toolbarField",
    ".toolbarLabel",
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

  const hit = pdfTextHitAt(target, event.clientX, event.clientY);
  if (!hit) {
    dismissHover(state);
    state.lastElementFromPoint = target;
    return;
  }

  if (hit.key === state.lastHoverKey) {
    state.lastElementFromPoint = target;
    return;
  }

  dismissHover(state);
  startPdfHoverFromHit(hit, state);
  state.lastElementFromPoint = target;
}

function startPdfHoverFromHit(hit: PdfTextHit, state: PdfBridgeState): void {
  if (!state.hoverEnabled) return;
  state.lastHoverKey = hit.key;
  clearHoverTimer(state);
  clearHoverAutoDismissTimer(state);
  state.hoverAutoDismissTimer = window.setTimeout(
    () => dismissHover(state),
    hit.text.length > 40 ? 13500 : 3500,
  );

  state.hoverTimer = window.setTimeout(() => {
    state.hoverTimer = null;
    const freshHit = refreshPdfTextHit(hit);
    if (!freshHit) {
      dismissHover(state);
      return;
    }
    let text = freshHit.text.trim();
    if (/\s/.test(text)) text = text.replace(LESS_TRANSLATE_CLEAN_RE, "");
    const requestText = normalizeLessTranslateRequestText(text);
    if (!requestText || !isLessTranslatableText(requestText)) {
      dismissHover(state);
      return;
    }
    setHoverLine(state, freshHit.rects);
    state.lastHoverText = text;
    state.hoverSeq++;
    const seq = state.hoverSeq;
    void sendMessage("translate", {
      engine: state.hoverEngine,
      target: state.hoverTarget,
      text: requestText,
    })
      .then((res) => {
        if (
          seq !== state.hoverSeq ||
          state.lastHoverText !== text
        ) {
          return;
        }
        const latestHit = refreshPdfTextHit(freshHit);
        if (latestHit) showHoverTooltipForHit(state, res.text, latestHit);
      })
      .catch((err: unknown) => {
        console.warn("[OneLingo] PDF hover translate failed:", err);
        if (seq === state.hoverSeq) dismissHover(state);
      });
  }, HOVER_DELAY_MS);
}

function pdfTextHitAt(
  target: Element,
  clientX: number,
  clientY: number,
): PdfTextHit | null {
  if (!target.closest(".textLayer")) return null;
  if (target.closest(".highlight") || target.classList.contains("highlight")) {
    return null;
  }
  if (target.getAttribute("role") === "img") return null;

  for (const textNode of textNodesAtPointTarget(target, clientX, clientY)) {
    const hit = pdfTextHitFromNode(textNode, clientX, clientY);
    if (hit) return hit;
  }
  return null;
}

function textNodesAtPointTarget(
  target: Element,
  clientX: number,
  clientY: number,
): Text[] {
  const nodes: Text[] = [];
  const seen = new Set<Text>();
  const add = (node: Text | null): void => {
    if (!node || seen.has(node)) return;
    if (!node.parentElement?.closest(".textLayer")) return;
    seen.add(node);
    nodes.push(node);
  };

  for (const node of textNodesInElement(pdfTextScopeForTarget(target))) {
    add(node);
  }
  add(caretTextNodeAt(clientX, clientY));
  return nodes;
}

function pdfTextScopeForTarget(target: Element): Element | null {
  if (!target.closest(".textLayer")) return null;
  if (target.matches("span[role='presentation']")) return target;
  return target.closest("span[role='presentation'], .textLayer span");
}

function textNodesInElement(element: Element | null): Text[] {
  if (!element) return [];
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if ((node.nodeValue ?? "").trim()) nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

function caretTextNodeAt(clientX: number, clientY: number): Text | null {
  const doc = document as Document & {
    caretPositionFromPoint?(x: number, y: number): {
      offsetNode: Node;
      offset: number;
    } | null;
    caretRangeFromPoint?(x: number, y: number): Range | null;
  };
  const position = doc.caretPositionFromPoint?.(clientX, clientY);
  if (position?.offsetNode.nodeType === Node.TEXT_NODE) {
    return position.offsetNode as Text;
  }
  const range = doc.caretRangeFromPoint?.(clientX, clientY);
  if (range?.startContainer.nodeType === Node.TEXT_NODE) {
    return range.startContainer as Text;
  }
  return null;
}

function pdfTextHitFromNode(
  textNode: Text,
  clientX: number,
  clientY: number,
): PdfTextHit | null {
  const text = textNode.nodeValue ?? "";
  if (!isLessTranslatableText(text)) return null;

  for (const segment of getTextSegments(textNode)) {
    if (!isHoverSegment(segment.text)) continue;
    const rects = rangeRects(textNode, segment.start, segment.end);
    const anchor = rects.find((rect) => pointInRect(rect, clientX, clientY));
    if (!anchor) continue;
    return {
      anchor,
      key: makePdfTextHitKey(textNode, segment.start, segment.end, segment.text),
      rects,
      startOffset: segment.start,
      endOffset: segment.end,
      text: segment.text,
      textNode,
    };
  }
  return null;
}

function refreshPdfTextHit(hit: PdfTextHit): PdfTextHit | null {
  if (!hit.textNode.isConnected) return null;
  const text = hit.textNode.nodeValue ?? "";
  if (
    hit.startOffset < 0 ||
    hit.endOffset > text.length ||
    text.slice(hit.startOffset, hit.endOffset) !== hit.text
  ) {
    return null;
  }
  const rects = rangeRects(hit.textNode, hit.startOffset, hit.endOffset);
  const anchor = rects[0];
  if (!anchor) return null;
  return { ...hit, anchor, rects };
}

function getTextSegments(textNode: Text): TextSegment[] {
  const text = textNode.nodeValue ?? "";
  const cached = textSegmentCache.get(textNode);
  if (cached?.text === text) return cached.segments;

  const segments: TextSegment[] = [];
  let offset = 0;
  for (const segment of text.split(LESS_TRANSLATE_SPLIT_RE)) {
    if (segment.length > 0) {
      segments.push({
        start: offset,
        end: offset + segment.length,
        text: segment,
      });
    }
    offset += segment.length;
  }
  textSegmentCache.set(textNode, { segments, text });
  return segments;
}

function isHoverSegment(segment: string): boolean {
  const trimmed = segment.trim();
  return !!trimmed && !DIGIT_RE.test(trimmed) && isLessTranslatableText(trimmed);
}

function rangeRects(textNode: Text, start: number, end: number): DOMRect[] {
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  const rects: DOMRect[] = [];
  for (const rect of range.getClientRects()) {
    if (rect.width > 0 && rect.height > 0) {
      rects.push(new DOMRect(rect.x, rect.y, rect.width, rect.height));
    }
  }
  return rects;
}

function pointInRect(
  rect: DOMRect,
  clientX: number,
  clientY: number,
): boolean {
  return (
    clientX >= rect.left - POINT_RECT_TOLERANCE_PX &&
    clientX <= rect.right + POINT_RECT_TOLERANCE_PX &&
    clientY >= rect.top - POINT_RECT_TOLERANCE_PX &&
    clientY <= rect.bottom + POINT_RECT_TOLERANCE_PX
  );
}

function makePdfTextHitKey(
  textNode: Text,
  start: number,
  end: number,
  text: string,
): string {
  let id = textNodeIds.get(textNode);
  if (!id) {
    id = nextTextNodeId;
    nextTextNodeId++;
    textNodeIds.set(textNode, id);
  }
  return `${id}:${start}:${end}:${text}`;
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

function showHoverTooltipForHit(
  state: PdfBridgeState,
  translation: string,
  hit: PdfTextHit,
): void {
  const tooltip = ensureHoverTooltip(state);
  tooltip.textContent = translation;
  const tooltipRect = tooltip.getBoundingClientRect();
  const anchor = hit.anchor;
  tooltip.style.right = "auto";
  tooltip.style.left = `${anchor.x + anchor.width / 2 - tooltipRect.width / 2}px`;
  tooltip.style.top =
    anchor.y < 60
      ? `${anchor.y + anchor.height + 20}px`
      : `${anchor.y - tooltipRect.height - 15}px`;
  tooltip.style.opacity = "1";
  setHoverLine(state, hit.rects);
}

function ensureHoverTooltip(state: PdfBridgeState): HTMLElement {
  if (state.tooltip?.isConnected) return state.tooltip;
  const tooltip = document.createElement("span");
  tooltip.setAttribute(TOOLTIP_ATTR, "");
  tooltip.style.cssText =
    'opacity:0; font-size:13px; width:auto; max-width:400px; display:inline; position:fixed; top:0px; left:0; z-index:9999; pointer-events:none; padding:5px 7px; background:rgba(10,10,11,0.95); color:rgba(255,255,255,0.93); box-shadow:0px 2px 2px rgba(0,0,0,0.07); border-radius:5px; line-height:1.3; font-family: "SF Pro SC","SF Pro Text","SF Pro Icons","PingFang SC","Helvetica Neue","Helvetica","Arial",sans-serif;';
  document.body.append(tooltip);
  state.tooltip = tooltip;
  return tooltip;
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

function setHoverLine(state: PdfBridgeState, rects: DOMRect[]): void {
  const layer = ensureHighlightLayer(state);
  layer.style.opacity = "1";
  layer.replaceChildren(
    ...rects.map((rect) => {
      const line = document.createElement("span");
      line.style.cssText = [
        "position:fixed",
        "pointer-events:none",
        "height:1px",
        "background:rgba(128,128,128,0.4)",
        `left:${rect.x}px`,
        `top:${rect.y + rect.height + 2}px`,
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
  if (!state.highlightLayer) return;
  state.highlightLayer.style.opacity = "0";
  state.highlightLayer.replaceChildren();
}

function ensureHighlightLayer(state: PdfBridgeState): HTMLDivElement {
  if (state.highlightLayer?.isConnected) return state.highlightLayer;
  const layer = document.createElement("div");
  layer.setAttribute(HOVER_HIGHLIGHT_ATTR, "");
  layer.style.cssText =
    "opacity:0;z-index:9999;pointer-events:none;position:fixed;inset:0;";
  document.body.appendChild(layer);
  state.highlightLayer = layer;
  return layer;
}
