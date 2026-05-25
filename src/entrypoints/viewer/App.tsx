import {
  createSignal,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { browser } from "wxt/browser";
import ePub from "epubjs";
import type { Book, Rendition } from "epubjs";
import { loadDocument, storeDocument } from "@/lib/document-store";
import { useT } from "@/lib/i18n";
import { sendMessage } from "@/lib/messaging";
import {
  applyThemeToDocument,
  getEffectiveTheme,
  watchEffectiveTheme,
  type EffectiveTheme,
} from "@/lib/theme";
import { initEpubBridge } from "./epub-bridge";

type DocFormat = "pdf" | "epub";
type ViewerFormat = DocFormat | "auto";
type ViewState = "loading" | "ready" | "error";

interface FetchedDocument {
  data: ArrayBuffer;
  format: DocFormat;
  name: string;
  url: string;
}

interface FetchedResource {
  data: ArrayBuffer;
  mimeType: string;
  text: string | null;
  url: string;
}

const MAX_URL_RESOLVE_DEPTH = 4;

function App(): JSX.Element {
  const t = useT();
  const [state, setState] = createSignal<ViewState>("loading");
  const [error, setError] = createSignal("");
  const [docTitle, setDocTitle] = createSignal("");
  const [docFormat, setDocFormat] = createSignal<DocFormat>("epub");
  const [currentLocation, setCurrentLocation] = createSignal("");

  let bookRef: Book | undefined;
  let renditionRef: Rendition | undefined;
  let stopThemeSync: (() => void) | undefined;

  const pdfViewerUrl = (fileUrl: string): string =>
    `${browser.runtime.getURL("/")}pdf/web/viewer.html?file=${encodeURIComponent(fileUrl)}`;

  onMount(() => {
    void init();
  });

  onCleanup(() => {
    stopThemeSync?.();
    renditionRef?.destroy();
    bookRef?.destroy();
  });

  const init = async (): Promise<void> => {
    const params = new URLSearchParams(location.search);
    const key = params.get("key");
    const url = params.get("url");

    if (key) {
      await loadFromStore(key);
    } else if (url) {
      const format = (params.get("format") ?? "auto") as ViewerFormat;
      await loadFromUrl(url, format);
    } else if (params.get("sniff") === "1") {
      const pending = await sendMessage("consumeSniffedDocument", {});
      if (pending?.action === "open" && pending.url) {
        await loadFromUrl(pending.url, "auto");
      } else if (pending?.action === "bypass" && pending.url) {
        location.replace(pending.url);
      } else if (pending?.action === "handled") {
        setError("Document opened in OneLingo Reader.");
        setState("error");
      } else {
        setError("No sniffed document URL was found.");
        setState("error");
      }
    } else {
      setError("No document specified.");
      setState("error");
    }
  };

  const loadFromStore = async (key: string): Promise<void> => {
    try {
      const doc = await loadDocument(key);
      if (!doc) {
        setError("Document not found in storage. It may have been cleared.");
        setState("error");
        return;
      }
      setDocTitle(doc.name.replace(/\.(pdf|epub)$/i, "") || "Document");
      setDocFormat(doc.format);
      if (doc.format === "pdf") {
        renderPdf(doc.data);
      } else {
        await renderEpub(doc.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  };

  const loadFromUrl = async (
    url: string,
    formatHint: ViewerFormat,
  ): Promise<void> => {
    try {
      const doc = await fetchDocumentFromUrl(url, formatHint);
      setDocFormat(doc.format);
      setDocTitle(doc.name.replace(/\.(pdf|epub)$/i, "") || "Document");
      const key = await storeDocument(doc.data, doc.format, doc.name);
      const viewerUrl = browser.runtime.getURL(
        `/viewer.html?key=${encodeURIComponent(key)}`,
      );
      history.replaceState(null, "", viewerUrl);
      if (doc.format === "pdf") {
        renderPdf(doc.data);
      } else {
        await renderEpub(doc.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  };

  const renderPdf = (data: ArrayBuffer): void => {
    const blob = new Blob([data], { type: "application/pdf" });
    const objectUrl = URL.createObjectURL(blob);
    setState("ready");
    stopThemeSync?.();
    stopThemeSync = undefined;
    requestAnimationFrame(() => {
      const iframe = document.getElementById(
        "pdf-frame",
      ) as HTMLIFrameElement | null;
      if (iframe) {
        stopThemeSync = syncPdfFrameTheme(iframe);
        iframe.src = pdfViewerUrl(objectUrl);
      }
    });
  };

  const renderEpub = async (data: ArrayBuffer): Promise<void> => {
    const book = ePub(data);
    bookRef = book;
    await book.ready;

    const metadata = await book.loaded.metadata;
    if (metadata.title) setDocTitle(metadata.title);

    setDocFormat("epub");
    setState("ready");
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const el = document.getElementById("epub-render");
    if (!el) {
      setError("Viewer element not found.");
      setState("error");
      return;
    }

    const rendition = book.renderTo(el, {
      width: "100%",
      height: "100%",
      spread: "none",
      flow: "paginated",
    });
    renditionRef = rendition;

    initEpubBridge(rendition);
    stopThemeSync?.();
    stopThemeSync = syncRenditionTheme(rendition);

    rendition.on("relocated", (loc: { start: { label: string } }) => {
      setCurrentLocation(loc.start.label);
    });

    await rendition.display();
  };

  const goPrev = (): void => {
    renditionRef?.prev();
  };

  const goNext = (): void => {
    renditionRef?.next();
  };

  return (
    <main class="viewer-root">
      <Show when={state() === "error"}>
        <div class="viewer-error">
          <p>{error()}</p>
        </div>
      </Show>

      <Show when={state() === "loading"}>
        <div class="viewer-loading">{t("viewer.status.loading")}</div>
      </Show>

      <Show when={state() === "ready" && docFormat() === "pdf"}>
        <iframe
          class="viewer-pdf-frame"
          id="pdf-frame"
          title={docTitle()}
        />
      </Show>

      <Show when={state() === "ready" && docFormat() === "epub"}>
        <header class="epub-toolbar">
          <button class="epub-nav-button" onClick={goPrev} type="button">
            ‹
          </button>
          <span class="epub-toolbar-title">{docTitle()}</span>
          <span class="epub-toolbar-location">{currentLocation()}</span>
          <button class="epub-nav-button" onClick={goNext} type="button">
            ›
          </button>
        </header>
        <div class="epub-render-area" id="epub-render" />
      </Show>
    </main>
  );
}

function syncPdfFrameTheme(iframe: HTMLIFrameElement): () => void {
  let currentTheme = getEffectiveTheme();
  const syncFrame = (): void => {
    try {
      const doc = iframe.contentDocument;
      if (doc) applyThemeToDocument(doc, currentTheme);
    } catch {
      // The bundled PDF.js frame is same-origin; keep this defensive for reloads.
    }
  };
  const onLoad = (): void => syncFrame();
  iframe.addEventListener("load", onLoad);
  const stopWatch = watchEffectiveTheme((theme) => {
    currentTheme = theme;
    syncFrame();
  });
  return () => {
    iframe.removeEventListener("load", onLoad);
    stopWatch();
  };
}

function syncRenditionTheme(rendition: Rendition): () => void {
  rendition.hooks.content.register((contents: { document: Document }) => {
    applyEpubDocumentTheme(contents.document, getEffectiveTheme());
  });
  return watchEffectiveTheme((theme) => {
    for (const contents of getRenditionContents(rendition)) {
      applyEpubDocumentTheme(contents.document, theme);
    }
  });
}

type EpubContentDocument = { document: Document };

function applyEpubDocumentTheme(doc: Document, theme: EffectiveTheme): void {
  applyThemeToDocument(doc, theme);

  const style = doc.getElementById("onelingo-epub-theme") ?? doc.createElement("style");
  style.id = "onelingo-epub-theme";
  style.textContent = epubThemeCss(theme);
  if (!style.parentNode) (doc.head ?? doc.documentElement).appendChild(style);
}

function epubThemeCss(theme: EffectiveTheme): string {
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

function getRenditionContents(rendition: Rendition): EpubContentDocument[] {
  const contents = (rendition as { getContents: () => unknown }).getContents();
  const items = Array.isArray(contents) ? contents : contents ? [contents] : [];
  return items.filter(hasDocument);
}

function hasDocument(value: unknown): value is EpubContentDocument {
  const doc = (value as { document?: unknown } | null)?.document;
  return (
    typeof doc === "object" &&
    doc !== null &&
    (doc as { nodeType?: unknown }).nodeType === Node.DOCUMENT_NODE
  );
}

async function fetchDocumentFromUrl(
  url: string,
  preferred: ViewerFormat,
): Promise<FetchedDocument> {
  const resource = await fetchResolvableResource(url, preferred, 0);
  const format = inferFetchedFormat(resource, preferred);
  if (!format) {
    throw new Error("Unsupported document URL. Expected a PDF or EPUB file.");
  }
  return {
    data: resource.data,
    format,
    name: nameFromUrl(resource.url, format),
    url: resource.url,
  };
}

async function fetchResolvableResource(
  url: string,
  preferred: ViewerFormat,
  depth: number,
): Promise<FetchedResource> {
  if (depth > MAX_URL_RESOLVE_DEPTH) {
    throw new Error("Document URL nested too deeply.");
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.arrayBuffer();
  const mimeType = resp.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  const finalUrl = resp.url || url;
  const text = isHtmlResponse(data, mimeType)
    ? new TextDecoder().decode(data)
    : null;
  if (!text) return { data, mimeType, text, url: finalUrl };

  const nestedUrl = await discoverNestedDocumentUrl(text, finalUrl, preferred);
  if (!nestedUrl) {
    throw new Error("The URL is an HTML page and no PDF/EPUB document was found.");
  }
  return fetchResolvableResource(nestedUrl, preferred, depth + 1);
}

async function discoverNestedDocumentUrl(
  html: string,
  baseUrl: string,
  preferred: ViewerFormat,
): Promise<string | null> {
  const direct = discoverUrlInMarkup(html, baseUrl, preferred);
  if (direct) return direct;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  for (const script of doc.querySelectorAll<HTMLScriptElement>("script[src]")) {
    const src = absoluteUrl(script.getAttribute("src"), baseUrl);
    if (!src) continue;
    try {
      const resp = await fetch(src);
      if (!resp.ok) continue;
      const nested = discoverUrlInScript(await resp.text(), src, preferred, {
        allowLooseDocumentUrl: false,
      });
      if (nested) return nested;
    } catch {
      // Third-party pages can reference scripts that are not document metadata.
    }
  }
  return null;
}

function discoverUrlInMarkup(
  html: string,
  baseUrl: string,
  preferred: ViewerFormat,
): string | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  for (const selector of ["iframe[src]", "embed[src]", "object[data]"]) {
    for (const element of doc.querySelectorAll(selector)) {
      const attr = element.hasAttribute("data") ? "data" : "src";
      const url = absoluteUrl(element.getAttribute(attr), baseUrl);
      if (url && looksLikeDocumentOrHtmlShell(url, preferred)) return url;
    }
  }

  for (const link of doc.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const url = absoluteUrl(link.getAttribute("href"), baseUrl);
    if (url && looksLikeDocumentUrl(url, preferred)) {
      return url;
    }
  }

  return discoverUrlInScript(html, baseUrl, preferred, {
    allowLooseDocumentUrl: true,
  });
}

function discoverUrlInScript(
  source: string,
  baseUrl: string,
  preferred: ViewerFormat,
  options: { allowLooseDocumentUrl: boolean },
): string | null {
  const fileParam = new URL(baseUrl).searchParams.get("file");
  const fileParamUrl = absoluteUrl(fileParam, baseUrl);
  if (fileParamUrl && looksLikeDocumentUrl(fileParamUrl, preferred)) return fileParamUrl;

  const defaultUrlMatch = source.match(
    /defaultUrl\s*=\s*\{[^}]*value\s*:\s*["']([^"']+)["']/i,
  );
  const defaultUrl = absoluteUrl(defaultUrlMatch?.[1] ?? null, baseUrl);
  if (defaultUrl && looksLikeDocumentUrl(defaultUrl, preferred)) return defaultUrl;

  if (!options.allowLooseDocumentUrl) return null;

  const docUrlMatch = source.match(/["']([^"']+\.(?:pdf|epub)(?:[?#][^"']*)?)["']/i);
  const docUrl = absoluteUrl(docUrlMatch?.[1] ?? null, baseUrl);
  return docUrl && looksLikeDocumentUrl(docUrl, preferred) ? docUrl : null;
}

function inferFetchedFormat(
  resource: FetchedResource,
  preferred: ViewerFormat,
): DocFormat | null {
  const mime = resource.mimeType.toLowerCase();
  const lowerUrl = resource.url.split(/[?#]/)[0]?.toLowerCase() ?? "";
  if (mime === "application/pdf" || lowerUrl.endsWith(".pdf")) return "pdf";
  if (mime === "application/epub+zip" || lowerUrl.endsWith(".epub")) return "epub";
  const prefix = new TextDecoder("latin1").decode(resource.data.slice(0, 8));
  if (prefix.startsWith("%PDF")) return "pdf";
  if (prefix.startsWith("PK")) return "epub";
  return null;
}

function isHtmlResponse(data: ArrayBuffer, mimeType: string): boolean {
  if (mimeType.toLowerCase() === "text/html") return true;
  const prefix = new TextDecoder("latin1")
    .decode(data.slice(0, 128))
    .trimStart()
    .toLowerCase();
  return prefix.startsWith("<!doctype html") || prefix.startsWith("<html");
}

function looksLikeDocumentOrHtmlShell(url: string, preferred: ViewerFormat): boolean {
  if (looksLikeDocumentUrl(url, preferred)) return true;
  const lower = url.split(/[?#]/)[0]?.toLowerCase() ?? "";
  return lower.endsWith(".html") || lower.endsWith(".htm");
}

function looksLikeDocumentUrl(url: string, preferred: ViewerFormat): boolean {
  const lower = url.split(/[?#]/)[0]?.toLowerCase() ?? "";
  if (preferred === "pdf") return lower.endsWith(".pdf");
  if (preferred === "epub") return lower.endsWith(".epub");
  return lower.endsWith(".pdf") || lower.endsWith(".epub");
}

function absoluteUrl(raw: string | null | undefined, baseUrl: string): string | null {
  if (!raw) return null;
  try {
    return new URL(raw, baseUrl).href;
  } catch {
    return null;
  }
}

function nameFromUrl(url: string, format: DocFormat): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : `document.${format}`;
  } catch {
    return `document.${format}`;
  }
}

export default App;
