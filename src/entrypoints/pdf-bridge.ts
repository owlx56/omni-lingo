import { onMessage, sendMessage, type PageFeatureStatus } from "@/lib/messaging";
import { loadDocument } from "@/lib/document-store";
import {
  getHoverEnabledStatus,
  initHover,
  updateHoverEnabledPref,
} from "@/features/hover";
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
const VIEWER_APP_MAX_ATTEMPTS = 100;

interface PdfViewerApplication {
  initializedPromise?: Promise<void>;
  open(input: { data: Uint8Array } | { url: string }): Promise<void>;
  setTitle?(title: string): void;
}

type PdfViewerWindow = Window & typeof globalThis & {
  PDFViewerApplication?: PdfViewerApplication;
};

export default defineUnlistedScript(() => {
  document.documentElement.setAttribute("data-onelingo-pdf-viewer", "");
  initPdfViewerTheme();
  initPdfReaderUiBoundary();
  initPdfReaderFeatures();
  void bootstrapPdfDocumentOpen().catch((err: unknown) => {
    console.warn("[OneLingo] failed to bootstrap PDF document:", err);
  });
});

// PDF document bootstrap: resolve stored/sniffed inputs and hand them to the
// top-level official PDF.js viewer application.
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

// Theme + reader chrome marking keep the official viewer selectable while
// shielding OneLingo's own reader UI from hover/selection handlers.
function initPdfViewerTheme(): void {
  initTheme();
  watchEffectiveTheme(syncPdfViewerTheme);
}

function initPdfReaderUiBoundary(): void {
  markPdfChrome();
  const observer = new MutationObserver(() => {
    markPdfChrome();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
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

// Reader features intentionally reuse the shared webpage implementations.
function initPdfReaderFeatures(): void {
  initHover();
  initSelection();
  registerViewerMessageHandlers();
}

function registerViewerMessageHandlers(): void {
  const readFeatureStatus = (): PageFeatureStatus => ({
    fullPageClickToShowOriginal: false,
    ...getHoverEnabledStatus(),
    ...getSelectionEnabledStatus(),
    hasFullPageClickToShowOriginalPref: false,
  });

  onMessage("readPageFeatureStatus", () => readFeatureStatus());
  onMessage("updatePageFeaturePrefs", (input) => {
    if (input.hoverEnabled !== undefined) {
      updateHoverEnabledPref(input.hoverEnabled);
    }
    if (input.selectionEnabled !== undefined) {
      updateSelectionEnabledPref(input.selectionEnabled);
    }
    return readFeatureStatus();
  });
}
