import type { UiLang } from "@/lib/languages";
import { browser } from "wxt/browser";

export type DocumentFormat = "pdf" | "epub";
export type ViewerFormat = DocumentFormat | "auto";

const PDF_VIEWER_PATH = "pdf/web/viewer.html";
const EPUB_VIEWER_PATH = "epub/web/viewer.html";
const READER_SHELL_PATH = "viewer.html";
const PDF_URL_RE = /\.pdf(?:$|[?#].*)?/i;
const EPUB_URL_RE = /\.epub(?:$|[?#].*)?/i;

export function pdfViewerUrlForFile(fileUrl: string, uiLang?: UiLang): string {
  const url = pdfViewerBaseUrl();
  url.searchParams.set("file", fileUrl);
  applyPdfLocale(url, uiLang);
  return url.href;
}

export function pdfViewerUrlForStoredKey(
  key: string,
  uiLang?: UiLang,
): string {
  const url = pdfViewerBaseUrl();
  url.searchParams.set("onelingo-key", key);
  applyPdfLocale(url, uiLang);
  return url.href;
}

export function pdfViewerUrlForSniff(uiLang?: UiLang): string {
  const url = pdfViewerBaseUrl();
  url.searchParams.set("onelingo-sniff", "1");
  applyPdfLocale(url, uiLang);
  return url.href;
}

export function epubViewerUrlForFile(fileUrl: string): string {
  const url = epubViewerBaseUrl();
  url.searchParams.set("url", fileUrl);
  return url.href;
}

export function epubViewerUrlForStoredKey(key: string): string {
  const url = epubViewerBaseUrl();
  url.searchParams.set("key", key);
  return url.href;
}

export function epubViewerUrlForSniff(): string {
  const url = epubViewerBaseUrl();
  url.searchParams.set("onelingo-sniff", "1");
  return url.href;
}

export function readerShellUrlForDocument(
  documentUrl: string,
  format: ViewerFormat = "auto",
): string {
  const url = readerShellBaseUrl();
  url.searchParams.set("url", documentUrl);
  url.searchParams.set("format", format);
  return url.href;
}

export function documentViewerUrlForUrl(
  documentUrl: string,
  format: ViewerFormat,
  uiLang?: UiLang,
): string {
  if (format === "pdf" || (format === "auto" && isLikelyPdfUrl(documentUrl))) {
    return pdfViewerUrlForFile(documentUrl, uiLang);
  }
  if (
    format === "epub" ||
    (format === "auto" && isLikelyEpubUrl(documentUrl))
  ) {
    return epubViewerUrlForFile(documentUrl);
  }
  return readerShellUrlForDocument(documentUrl, format);
}

export function isLikelyPdfUrl(url: string): boolean {
  return testDocumentUrl(url, PDF_URL_RE);
}

export function isLikelyEpubUrl(url: string): boolean {
  return testDocumentUrl(url, EPUB_URL_RE);
}

export function isPdfViewerUrl(url: string): boolean {
  return url.startsWith(pdfViewerBaseUrl().href);
}

export function isEpubViewerUrl(url: string): boolean {
  return url.startsWith(epubViewerBaseUrl().href);
}

export function isReaderShellUrl(url: string): boolean {
  return url.startsWith(readerShellBaseUrl().href);
}

export function pdfJsLocale(uiLang: UiLang): string {
  switch (uiLang) {
    case "zh-Hans":
      return "zh-CN";
    case "zh-Hant":
      return "zh-TW";
    case "es":
      return "es-ES";
    case "hi":
      return "hi-IN";
    case "en":
      return "en-US";
    default:
      return uiLang;
  }
}

function pdfViewerBaseUrl(): URL {
  return new URL(PDF_VIEWER_PATH, browser.runtime.getURL("/"));
}

function epubViewerBaseUrl(): URL {
  return new URL(EPUB_VIEWER_PATH, browser.runtime.getURL("/"));
}

function readerShellBaseUrl(): URL {
  return new URL(READER_SHELL_PATH, browser.runtime.getURL("/"));
}

function applyPdfLocale(url: URL, uiLang: UiLang | undefined): void {
  if (!uiLang) return;
  url.hash = `locale=${encodeURIComponent(pdfJsLocale(uiLang))}`;
}

function testDocumentUrl(url: string, regex: RegExp): boolean {
  try {
    const parsed = new URL(url);
    return regex.test(parsed.pathname + parsed.search + parsed.hash);
  } catch {
    return false;
  }
}
