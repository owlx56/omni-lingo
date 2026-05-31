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
import type {
  FoliateContent,
  FoliateLoadDetail,
  FoliateRelocateDetail,
  FoliateViewElement,
} from "./types";

type FoliateBridgeCallbacks = {
  onLocationChange?: (location: FoliateRelocateDetail) => void;
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

  let currentTheme = getEffectiveTheme();
  let currentUiLang: UiLang = "zh-Hans";
  void getSettings()
    .then((settings) => {
      currentUiLang = settings.uiLang;
      syncCurrentContents(view, currentTheme, currentUiLang, hover);
    })
    .catch((err: unknown) => {
      console.warn("[OneLingo] failed to read foliate settings:", err);
    });

  const stopThemeWatch = watchEffectiveTheme((theme) => {
    currentTheme = theme;
    syncCurrentContents(view, currentTheme, currentUiLang, hover);
  });
  const stopSettingsWatch = watchSettings((settings) => {
    currentUiLang = settings.uiLang;
    syncCurrentContents(view, currentTheme, currentUiLang, hover);
  });
  const stopMessages = registerMessageHandlers(hover);
  const stopHooks = registerViewHooks(
    view,
    hover,
    currentTheme,
    currentUiLang,
    callbacks,
  );

  return () => {
    hover.dismiss();
    hideSelectionUi();
    stopHooks();
    stopMessages();
    stopSettingsWatch();
    stopThemeWatch();
  };
}

function registerViewHooks(
  view: FoliateViewElement,
  hover: HoverController,
  theme: EffectiveTheme,
  uiLang: UiLang,
  callbacks: FoliateBridgeCallbacks,
): () => void {
  const handleLoad = (event: Event): void => {
    const detail = (event as CustomEvent<FoliateLoadDetail>).detail;
    bindDoc(detail.doc, hover, theme, uiLang);
    syncCurrentContents(view, theme, uiLang, hover);
  };

  const handleRelocate = (event: Event): void => {
    const detail = (event as CustomEvent<FoliateRelocateDetail>).detail;
    callbacks.onLocationChange?.(detail);
    syncCurrentContents(view, theme, uiLang, hover);
  };

  view.addEventListener("load", handleLoad);
  view.addEventListener("relocate", handleRelocate);

  const timers = [
    window.setTimeout(
      () => syncCurrentContents(view, theme, uiLang, hover),
      0,
    ),
    window.setTimeout(
      () => syncCurrentContents(view, theme, uiLang, hover),
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
  theme: EffectiveTheme,
  uiLang: UiLang,
  hover: HoverController,
): void {
  const contents = view.getContents?.();
  if (!Array.isArray(contents)) return;
  for (const item of contents) {
    bindDoc(item.doc, hover, theme, uiLang);
  }
}

function bindDoc(
  doc: Document,
  hover: HoverController,
  theme: EffectiveTheme,
  uiLang: UiLang,
): void {
  applyDocPrefs(doc, theme, uiLang);
  if (boundDocs.has(doc)) return;
  boundDocs.add(doc);

  bindHoverDocument(hover, doc);
  doc.addEventListener("mouseup", (event) => {
    window.setTimeout(() => onDocMouseUp(event, doc), 0);
  });
  doc.addEventListener("mousedown", () => hideSelectionUi(), {
    capture: true,
  });
  doc.addEventListener(
    "scroll",
    () => {
      hover.dismiss();
      hideSelectionUi();
    },
    { passive: true },
  );
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hover.dismiss();
      hideSelectionUi();
    }
  });
}

function applyDocPrefs(doc: Document, theme: EffectiveTheme, uiLang: UiLang): void {
  applyThemeToDocument(doc, theme);
  doc.documentElement.lang ||= htmlLang(uiLang);
  if (!doc.documentElement.dir && (uiLang === "ar" || uiLang === "fa")) {
    doc.documentElement.dir = "rtl";
  }

  const styleId = "onelingo-foliate-theme";
  const style = doc.getElementById(styleId) ?? doc.createElement("style");
  style.id = styleId;
  style.textContent = foliateThemeCss(theme);
  if (!style.parentNode) (doc.head ?? doc.documentElement).appendChild(style);
}

function foliateThemeCss(theme: EffectiveTheme): string {
  const isDark = theme === "dark";
  const bg = isDark ? "#1f1f1e" : "#ffffff";
  const text = isDark ? "#ebe8df" : "#1f1e1d";
  const selection = isDark
    ? "rgba(91, 141, 214, 0.42)"
    : "rgba(44, 117, 224, 0.28)";
  const link = isDark ? "#8ab4f8" : "#1f5fbf";
  return [
    `html,body{background:${bg}!important;color:${text}!important;color-scheme:${theme}!important;}`,
    `::selection{background:${selection}!important;}`,
    `a,a:visited{color:${link}!important;}`,
  ].join("\n");
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
