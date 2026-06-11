import { getSettings, watchSettings } from "@/lib/storage/settings";
import type { UiLang } from "@/lib/languages";
import {
  documentViewerUrlForUrl,
  isLikelyPdfUrl,
  isLikelyFoliateUrl,
} from "@/lib/document-viewer-urls";

interface SnifferState {
  enabled: boolean;
  keepOriginal: boolean;
  standalone: boolean;
  uiLang: UiLang;
}

const DOCUMENT_URL_RE = /\.(?:pdf|epub|mobi|azw3|kf8|fb2|fb2\.zip|fbz)(?:$|[?#])/i;

export function initDocumentLinkSniffer(): void {
  const state: SnifferState = {
    enabled: false,
    keepOriginal: false,
    standalone: false,
    uiLang: "zh-Hans",
  };

  void getSettings()
    .then((settings) => {
      state.enabled = settings.documentLinkSniffEnabled;
      state.keepOriginal = settings.documentLinkSniffKeepOriginal;
      state.standalone = settings.documentLinkSniffStandalone;
      state.uiLang = settings.uiLang;
    })
    .catch((err: unknown) => {
      console.warn("[Omni Lingo] failed to read document sniffer settings:", err);
    });

  try {
    watchSettings((settings) => {
      state.enabled = settings.documentLinkSniffEnabled;
      state.keepOriginal = settings.documentLinkSniffKeepOriginal;
      state.standalone = settings.documentLinkSniffStandalone;
      state.uiLang = settings.uiLang;
    });
  } catch (err: unknown) {
    console.warn("[Omni Lingo] failed to watch document sniffer settings:", err);
  }

  document.addEventListener(
    "click",
    (event) => {
      if (!state.enabled || event.defaultPrevented) return;
      const anchor = linkFromEvent(event);
      if (!anchor?.href || !isDocumentUrl(anchor.href)) return;

      if (state.keepOriginal || state.standalone) return;

      event.preventDefault();
      event.stopPropagation();
      location.href = viewerUrlForDocument(anchor.href, state.uiLang);
    },
    true,
  );
}

function viewerUrlForDocument(url: string, uiLang: UiLang): string {
  return documentViewerUrlForUrl(
    url,
    isLikelyPdfUrl(url) ? "pdf" : isLikelyFoliateUrl(url) ? "foliate" : "auto",
    uiLang,
  );
}

function linkFromEvent(event: MouseEvent): HTMLAnchorElement | null {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) {
    return null;
  }
  const path = event.composedPath();
  for (const target of path) {
    if (target instanceof HTMLAnchorElement) return target;
    if (target === document || target === window) break;
  }
  const element =
    event.target instanceof Element
      ? event.target.closest("a[href]")
      : null;
  return element instanceof HTMLAnchorElement ? element : null;
}

function isDocumentUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "http:" ||
        parsed.protocol === "https:" ||
        parsed.protocol === "file:") &&
      DOCUMENT_URL_RE.test(parsed.pathname + parsed.search + parsed.hash)
    );
  } catch {
    return false;
  }
}
