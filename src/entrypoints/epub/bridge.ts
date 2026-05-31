import { onMessage, type PageFeatureStatus } from "@/lib/messaging";
import {
  bindHoverDocument,
  createHoverController,
  type HoverController,
} from "@/features/hover";
import {
  getSelectionEnabledStatus,
  hideSelectionUi,
  initSelection,
  showSelectionFromReader,
  updateSelectionEnabledPref,
} from "@/features/selection";
import type { Rendition } from "epubjs";

export type EpubTocItem = {
  href: string;
  label: string;
  subitems: EpubTocItem[];
};

type EpubEventSource = {
  on(event: string, callback: (...args: unknown[]) => void): void;
  off?(event: string, callback: (...args: unknown[]) => void): void;
};

type EpubContents = {
  document: Document;
};

type EpubBridgeCallbacks = {
  onLocationChange?: (location: EpubLocation) => void;
};

type EpubLocation = {
  start: {
    cfi: string;
    href: string;
    label: string;
  };
};

const boundEpubDocs = new WeakSet<Document>();
const boundEpubContents = new WeakSet<object>();

export function initEpubBridge(rendition: Rendition, callbacks: EpubBridgeCallbacks = {}): () => void {
  const hover = createHoverController({
    mapAnchorRect: toParentRect,
    tooltipDocument: document,
  });

  initSelection({ captureDocumentSelection: false });
  const stopMessages = registerEpubMessageHandlers(hover);
  const stopScroll = registerScrollDismiss(hover);
  const stopHooks = registerRenditionHooks(rendition, hover, callbacks);
  markReaderUi();

  return () => {
    hover.dismiss();
    hideSelectionUi();
    stopHooks();
    stopMessages();
    stopScroll();
  };
}

function registerRenditionHooks(
  rendition: Rendition,
  hover: HoverController,
  callbacks: EpubBridgeCallbacks,
): () => void {
  const handleContent = (contents: unknown): void => {
    bindEpubContents(contents, hover);
  };
  const handleRendered = (_section: unknown, view: unknown): void => {
    bindEpubContents(view, hover);
    bindRenderedContents(rendition, hover);
    bindEpubIframes(hover);
  };

  rendition.hooks.content.register(handleContent);
  rendition.on("rendered", handleRendered);
  const timers = [
    window.setTimeout(() => bindRenderedContents(rendition, hover), 0),
    window.setTimeout(() => bindEpubIframes(hover), 0),
    window.setTimeout(() => bindEpubIframes(hover), 250),
  ];

  const handleRelocated = (location: EpubLocation): void => {
    callbacks.onLocationChange?.(location);
  };
  rendition.on("relocated", handleRelocated);

  return () => {
    for (const timer of timers) window.clearTimeout(timer);
    rendition.hooks.content.deregister(handleContent);
    rendition.off?.("rendered", handleRendered);
    rendition.off?.("relocated", handleRelocated);
  };
}

function registerScrollDismiss(hover: HoverController): () => void {
  const onScroll = (): void => {
    hover.dismiss();
    hideSelectionUi();
  };
  window.addEventListener("scroll", onScroll, { passive: true });

  const container = document.querySelector<HTMLElement>("#epub-render .epub-container");
  if (container) {
    container.addEventListener("scroll", onScroll, { passive: true });
  }

  return () => {
    window.removeEventListener("scroll", onScroll);
    container?.removeEventListener("scroll", onScroll);
  };
}

function bindRenderedContents(
  rendition: Rendition,
  hover: HoverController,
): void {
  const getContents = (rendition as { getContents?: () => unknown }).getContents;
  if (!getContents) return;
  const contents = getContents.call(rendition);
  if (Array.isArray(contents)) {
    for (const item of contents) bindEpubContents(item, hover);
    return;
  }
  bindEpubContents(contents, hover);
}

function bindEpubIframes(hover: HoverController): void {
  for (const iframe of document.querySelectorAll<HTMLIFrameElement>("#epub-render iframe")) {
    try {
      if (iframe.contentDocument) {
        bindEpubContents({ document: iframe.contentDocument }, hover);
      }
    } catch {
      // EPUB.js uses same-origin reader frames; ignore anything else defensively.
    }
  }
}

function bindEpubContents(
  contentsOrView: unknown,
  hover: HoverController,
): void {
  bindEpubContentEvents(contentsOrView);
  const doc = documentFromContents(contentsOrView);
  if (!doc || boundEpubDocs.has(doc)) return;
  boundEpubDocs.add(doc);

  bindHoverDocument(hover, doc);
  doc.addEventListener("mouseup", (event) => {
    window.setTimeout(() => onEpubMouseUp(event, doc), 0);
  });
  doc.addEventListener("mousedown", () => hideSelectionUi(), { capture: true });
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hover.dismiss();
      hideSelectionUi();
    }
  });
}

function bindEpubContentEvents(contentsOrView: unknown): void {
  const contents = contentsFromValue(contentsOrView);
  if (!contents || boundEpubContents.has(contents)) return;
  boundEpubContents.add(contents);
  contents.on("selectedRange", (range) => {
    if (rangeLike(range)) onEpubSelectedRange(range, contents.document);
  });
}

function contentsFromValue(value: unknown): (EpubContents & EpubEventSource) | null {
  if (!isObject(value)) return null;
  if (isDocument((value as { document?: unknown }).document) && hasOn(value)) {
    return value as unknown as EpubContents & EpubEventSource;
  }
  const nested = (value as { contents?: unknown }).contents;
  if (
    isObject(nested) &&
    isDocument((nested as { document?: unknown }).document) &&
    hasOn(nested)
  ) {
    return nested as unknown as EpubContents & EpubEventSource;
  }
  return null;
}

function documentFromContents(value: unknown): Document | null {
  if (!isObject(value)) return null;
  const direct = (value as { document?: unknown }).document;
  if (isDocument(direct)) return direct;
  const nested = (value as { contents?: unknown }).contents;
  if (isObject(nested)) {
    const nestedDoc = (nested as { document?: unknown }).document;
    if (isDocument(nestedDoc)) return nestedDoc;
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDocument(value: unknown): value is Document {
  return isObject(value) && value.nodeType === Node.DOCUMENT_NODE;
}

function hasOn(value: unknown): value is EpubEventSource {
  return isObject(value) && typeof (value as { on?: unknown }).on === "function";
}

function rangeLike(value: unknown): value is Range {
  return (
    isObject(value) &&
    typeof (value as { getClientRects?: unknown }).getClientRects === "function" &&
    typeof (value as { toString?: unknown }).toString === "function"
  );
}

function registerEpubMessageHandlers(hover: HoverController): () => void {
  const readFeatureStatus = (): PageFeatureStatus => ({
    fullPageClickToShowOriginal: false,
    ...hover.getEnabledStatus(),
    ...getSelectionEnabledStatus(),
    hasFullPageClickToShowOriginalPref: false,
  });

  const offRead = onMessage("readPageFeatureStatus", () => readFeatureStatus());
  const offUpdate = onMessage("updatePageFeaturePrefs", (input) => {
    if (input.hoverEnabled !== undefined) {
      hover.updateEnabledPref(input.hoverEnabled);
    }
    if (input.selectionEnabled !== undefined) {
      updateSelectionEnabledPref(input.selectionEnabled);
    }
    return readFeatureStatus();
  });

  return () => {
    offRead();
    offUpdate();
  };
}

function onEpubMouseUp(event: MouseEvent, doc: Document): void {
  const sel = doc.getSelection?.() ?? doc.defaultView?.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const text = sel.toString().trim();
  if (!text) return;
  const rect = toParentRect(
    doc,
    firstUsefulRect(sel.getRangeAt(0)) ?? pointRect(event.clientX, event.clientY),
  );

  showSelectionFromReader({
    clientX: rect.right,
    clientY: rect.top,
    text,
  });
}

function onEpubSelectedRange(range: Range, doc: Document): void {
  const text = range.toString().trim();
  if (!text) return;
  const rect = toParentRect(doc, firstUsefulRect(range) ?? pointRect(8, 8));

  showSelectionFromReader({
    clientX: rect.right,
    clientY: rect.top,
    text,
  });
}

function firstUsefulRect(range: Range): DOMRect | null {
  for (const rect of range.getClientRects()) {
    if (rect.width > 0 && rect.height > 0) return rect;
  }
  const rect = range.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

function pointRect(x: number, y: number): DOMRect {
  return new DOMRect(x, y, 1, 1);
}

function toParentRect(doc: Document, rect: DOMRect): DOMRect {
  const frame = frameElementForDoc(doc);
  if (!frame) return rect;
  const frameRect = frame.getBoundingClientRect();
  return new DOMRect(
    rect.left + frameRect.left,
    rect.top + frameRect.top,
    rect.width,
    rect.height,
  );
}

function frameElementForDoc(doc: Document): HTMLElement | null {
  const frame = doc.defaultView?.frameElement;
  if (frame instanceof HTMLElement) return frame;

  for (const iframe of document.querySelectorAll("iframe")) {
    try {
      if (iframe.contentDocument === doc) return iframe;
    } catch {
      // Cross-origin frames are not EPUB.js content frames.
    }
  }
  return null;
}

function markReaderUi(): void {
  document.documentElement.setAttribute("data-onelingo-epub-viewer", "");
  for (const selector of [
    ".epub-toolbar",
    ".epub-sidebar",
    ".epub-sidebar-backdrop",
    ".epub-mode-switch",
    ".epub-nav-button",
    ".epub-mode-button",
  ]) {
    for (const element of document.querySelectorAll(selector)) {
      element.setAttribute("data-onelingo-reader-ui", "");
    }
  }
}
