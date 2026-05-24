import { getSettings, watchSettings } from "@/lib/storage/settings";
import { browser } from "wxt/browser";

interface SnifferState {
  enabled: boolean;
  keepOriginal: boolean;
  standalone: boolean;
}

const DOCUMENT_URL_RE = /\.(?:pdf|epub)(?:$|[?#])/i;

export function initDocumentLinkSniffer(): void {
  const state: SnifferState = {
    enabled: false,
    keepOriginal: false,
    standalone: false,
  };

  void getSettings()
    .then((settings) => {
      state.enabled = settings.documentLinkSniffEnabled;
      state.keepOriginal = settings.documentLinkSniffKeepOriginal;
      state.standalone = settings.documentLinkSniffStandalone;
    })
    .catch((err: unknown) => {
      console.warn("[OneLingo] failed to read document sniffer settings:", err);
    });

  try {
    watchSettings((settings) => {
      state.enabled = settings.documentLinkSniffEnabled;
      state.keepOriginal = settings.documentLinkSniffKeepOriginal;
      state.standalone = settings.documentLinkSniffStandalone;
    });
  } catch (err: unknown) {
    console.warn("[OneLingo] failed to watch document sniffer settings:", err);
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
      location.href = viewerUrlForDocument(anchor.href);
    },
    true,
  );
}

function viewerUrlForDocument(url: string): string {
  return browser.runtime.getURL(
    `/viewer.html?url=${encodeURIComponent(url)}&format=auto`,
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
