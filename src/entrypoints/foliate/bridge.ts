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
import {
  applyThemeToDocument,
  getEffectiveTheme,
  watchEffectiveTheme,
  type EffectiveTheme,
} from "@/lib/theme";
import { getSettings, watchSettings, type UiLang } from "@/lib/storage/settings";
import { clearReaderSelections } from "./reader-selection";
import type {
  FoliateContent,
  FoliateLoadDetail,
  FoliateRelocateDetail,
  FoliateViewElement,
} from "./types";
import {
  applyFoliateContentCss,
  applyFoliateViewContentCss,
  createFoliateContentCss,
  createFoliateContentCssFromSource,
} from "./reader-content-style";
import {
  normalizeFoliateReaderSettings,
  areFoliateReaderStyleSettingsEqual,
  type FoliateReaderStyleSettings,
} from "./reader-settings";

type FoliateBridgeCallbacks = {
  createContentCss?: (
    theme: EffectiveTheme,
    settings: FoliateReaderStyleSettings,
  ) => string;
  getReaderSettings?: () => FoliateReaderStyleSettings;
  onContentLoad?: (doc: Document) => void;
  onLocationChange?: (location: FoliateRelocateDetail) => void;
  onReaderSettingsChange?: (settings: FoliateReaderStyleSettings) => void;
};

type FoliateBridgePrefs = {
  readerSettings: FoliateReaderStyleSettings;
  theme: EffectiveTheme;
  uiLang: UiLang;
};

type FoliateBridgeCssOptions = {
  readerSettingsOverride?: FoliateReaderStyleSettings;
};

const boundDocs = new WeakSet<Document>();

export function initFoliateBridge(
  view: FoliateViewElement,
  callbacks: FoliateBridgeCallbacks = {},
): () => void {
  const hover = createHoverController({
    mapAnchorRect: toParentRect,
    tooltipDocument: document,
  });

  initSelection({ captureDocumentSelection: false });
  document.documentElement.setAttribute("data-onelingo-foliate-viewer", "");

  const prefs: FoliateBridgePrefs = {
    readerSettings: normalizeFoliateReaderSettings(null),
    theme: getEffectiveTheme(),
    uiLang: "zh-Hans",
  };
  void getSettings()
    .then((settings) => {
      const previousReaderSettings =
        callbacks.getReaderSettings?.() ?? prefs.readerSettings;
      prefs.uiLang = settings.uiLang;
      prefs.readerSettings = normalizeFoliateReaderSettings(settings);
      callbacks.onReaderSettingsChange?.(prefs.readerSettings);
      const effectiveReaderSettings =
        callbacks.getReaderSettings?.() ?? prefs.readerSettings;
      applyViewPrefs(view, prefs, callbacks, {
        readerSettingsOverride: effectiveReaderSettings,
        relayout: !areFoliateReaderStyleSettingsEqual(
          previousReaderSettings,
          effectiveReaderSettings,
        ),
      });
      syncCurrentContents(view, prefs, hover, callbacks, {
        readerSettingsOverride: effectiveReaderSettings,
      });
    })
    .catch((err: unknown) => {
      console.warn("[OneLingo] failed to read foliate settings:", err);
    });

  const stopThemeWatch = watchEffectiveTheme((theme) => {
    prefs.theme = theme;
    applyViewPrefs(view, prefs, callbacks);
    syncCurrentContents(view, prefs, hover, callbacks);
  });
  let stopSettingsWatch = (): void => {};
  try {
    stopSettingsWatch = watchSettings((settings) => {
      const previousReaderSettings =
        callbacks.getReaderSettings?.() ?? prefs.readerSettings;
      const nextReaderSettings = normalizeFoliateReaderSettings(settings);
      prefs.uiLang = settings.uiLang;
      prefs.readerSettings = nextReaderSettings;
      callbacks.onReaderSettingsChange?.(nextReaderSettings);
      const effectiveReaderSettings =
        callbacks.getReaderSettings?.() ?? prefs.readerSettings;
      const shouldRelayout = !areFoliateReaderStyleSettingsEqual(
        previousReaderSettings,
        effectiveReaderSettings,
      );
      applyViewPrefs(view, prefs, callbacks, {
        readerSettingsOverride: effectiveReaderSettings,
        relayout: shouldRelayout,
      });
      syncCurrentContents(view, prefs, hover, callbacks, {
        readerSettingsOverride: effectiveReaderSettings,
      });
    });
  } catch (err) {
    console.warn("[OneLingo] failed to watch foliate settings:", err);
  }
  const stopMessages = registerMessageHandlers(hover);
  const stopHooks = registerViewHooks(
    view,
    hover,
    prefs,
    callbacks,
  );

  return () => {
    hover.dismiss();
    hideSelectionUi();
    clearReaderSelections(view);
    stopHooks();
    stopMessages();
    stopSettingsWatch();
    stopThemeWatch();
  };
}

function applyViewPrefs(
  view: FoliateViewElement,
  prefs: FoliateBridgePrefs,
  callbacks: FoliateBridgeCallbacks,
  options: { relayout?: boolean } & FoliateBridgeCssOptions = {},
): void {
  applyFoliateViewContentCss(
    view,
    createBridgeContentCss(prefs, callbacks, options),
    options,
  );
}

function registerViewHooks(
  view: FoliateViewElement,
  hover: HoverController,
  prefs: FoliateBridgePrefs,
  callbacks: FoliateBridgeCallbacks,
): () => void {
  const handleLoad = (event: Event): void => {
    const detail = (event as CustomEvent<FoliateLoadDetail>).detail;
    bindDoc(view, detail.doc, hover, prefs, callbacks);
    callbacks.onContentLoad?.(detail.doc);
    syncCurrentContents(view, prefs, hover, callbacks);
  };

  const handleRelocate = (event: Event): void => {
    const detail = (event as CustomEvent<FoliateRelocateDetail>).detail;
    callbacks.onLocationChange?.(detail);
    syncCurrentContents(view, prefs, hover, callbacks);
  };

  view.addEventListener("load", handleLoad);
  view.addEventListener("relocate", handleRelocate);

  const timers = [
    window.setTimeout(
      () => syncCurrentContents(view, prefs, hover, callbacks),
      0,
    ),
    window.setTimeout(
      () => syncCurrentContents(view, prefs, hover, callbacks),
      250,
    ),
  ];

  return () => {
    for (const timer of timers) window.clearTimeout(timer);
    view.removeEventListener("load", handleLoad);
    view.removeEventListener("relocate", handleRelocate);
  };
}

function syncCurrentContents(
  view: FoliateViewElement,
  prefs: FoliateBridgePrefs,
  hover: HoverController,
  callbacks: FoliateBridgeCallbacks,
  options: { contentCss?: boolean } & FoliateBridgeCssOptions = {},
): void {
  const contents = view.getContents?.();
  if (!Array.isArray(contents)) return;
  for (const item of contents) {
    bindDoc(view, item.doc, hover, prefs, callbacks, options);
    callbacks.onContentLoad?.(item.doc);
  }
}

function bindDoc(
  view: FoliateViewElement,
  doc: Document,
  hover: HoverController,
  prefs: FoliateBridgePrefs,
  callbacks: FoliateBridgeCallbacks,
  options: { contentCss?: boolean } & FoliateBridgeCssOptions = {},
): void {
  applyDocPrefs(doc, prefs, callbacks, options);
  if (boundDocs.has(doc)) return;
  boundDocs.add(doc);

  bindHoverDocument(hover, doc);
  doc.addEventListener("mouseup", (event) => {
    window.setTimeout(() => onDocMouseUp(event, doc), 0);
  });
  doc.addEventListener("mousedown", () => dismissReaderSelection(view), {
    capture: true,
  });
  doc.addEventListener(
    "scroll",
    () => {
      hover.dismiss();
      dismissReaderSelection(view);
    },
    { passive: true },
  );
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hover.dismiss();
      dismissReaderSelection(view);
    }
  });
}

function dismissReaderSelection(view: FoliateViewElement): void {
  hideSelectionUi();
  clearReaderSelections(view);
}

function applyDocPrefs(
  doc: Document,
  prefs: FoliateBridgePrefs,
  callbacks: FoliateBridgeCallbacks,
  options: { contentCss?: boolean } & FoliateBridgeCssOptions = {},
): void {
  applyThemeToDocument(doc, prefs.theme);
  doc.documentElement.lang ||= htmlLang(prefs.uiLang);
  if (!doc.documentElement.dir && (prefs.uiLang === "ar" || prefs.uiLang === "fa")) {
    doc.documentElement.dir = "rtl";
  }

  if (options.contentCss !== false) {
    applyFoliateContentCss(doc, createBridgeContentCss(prefs, callbacks, options));
  }
}

function createBridgeContentCss(
  prefs: FoliateBridgePrefs,
  callbacks: FoliateBridgeCallbacks,
  options: FoliateBridgeCssOptions = {},
): string {
  if (callbacks.createContentCss) {
    return callbacks.createContentCss(
      prefs.theme,
      options.readerSettingsOverride ??
        callbacks.getReaderSettings?.() ??
        prefs.readerSettings,
    );
  }
  return createFoliateContentCssFromSource({
    getReaderSettings: callbacks.getReaderSettings,
    readerSettings: prefs.readerSettings,
    readerSettingsOverride: options.readerSettingsOverride,
    theme: prefs.theme,
  });
}

function htmlLang(uiLang: UiLang): string {
  if (uiLang === "zh-Hans") return "zh-Hans";
  if (uiLang === "zh-Hant") return "zh-Hant";
  return uiLang;
}

function registerMessageHandlers(hover: HoverController): () => void {
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

function onDocMouseUp(event: MouseEvent, doc: Document): void {
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
      // ignore cross-origin frames
    }
  }
  return null;
}
