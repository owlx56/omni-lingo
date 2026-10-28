import type { UiLang } from "@/lib/languages";
import { browser } from "wxt/browser";

export type DocumentFormat = "pdf" | "foliate";
export type ViewerFormat = DocumentFormat | "auto";

const PDF_VIEWER_PATH = "pdf/web/viewer.html";
const FOLIATE_VIEWER_PATH = "foliate/web/viewer.html";
const READER_SHELL_PATH = "viewer.html";
export const STORED_DOCUMENT_KEY_PARAM = "omni-lingo-key";
export const DOCUMENT_SNIFF_PARAM = "omni-lingo-sniff";
export const HTTP_PDF_DOCUMENT_URL_REGEX =
  "^https?://[^/?#]+/[^?#]*\\.[Pp][Dd][Ff](?:$|[?#].*)";
export const HTTP_FOLIATE_DOCUMENT_URL_REGEX =
  "^https?://[^/?#]+/[^?#]*\\.(?:[Ee][Pp][Uu][Bb]|[Mm][Oo][Bb][Ii]|[Aa][Zz][Ww]3|[Kk][Ff]8|[Ff][Bb]2(?:\\.zip)?|[Ff][Bb][Zz])(?:$|[?#].*)";
const PDF_URL_RE = /\.pdf$/i;
const FOLIATE_URL_RE = /\.(?:epub|mobi|azw3|kf8|fb2(?:\.zip)?|fbz)$/i;

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
  url.searchParams.set(STORED_DOCUMENT_KEY_PARAM, key);
  applyPdfLocale(url, uiLang);
  return url.href;
}

export function pdfViewerUrlForSniff(uiLang?: UiLang): string {
  const url = pdfViewerBaseUrl();
  url.searchParams.set(DOCUMENT_SNIFF_PARAM, "1");
  applyPdfLocale(url, uiLang);
  return url.href;
}

export function foliateViewerUrlForFile(fileUrl: string): string {
  const url = foliateViewerBaseUrl();
  url.searchParams.set("file", fileUrl);
  return url.href;
}

export function foliateViewerUrlForStoredKey(key: string): string {
  const url = foliateViewerBaseUrl();
  url.searchParams.set(STORED_DOCUMENT_KEY_PARAM, key);
  return url.href;
}

export function foliateViewerUrlForSniff(): string {
  const url = foliateViewerBaseUrl();
  url.searchParams.set(DOCUMENT_SNIFF_PARAM, "1");
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
    format === "foliate" || (format === "auto" && isLikelyFoliateUrl(documentUrl))
  ) {
    return foliateViewerUrlForFile(documentUrl);
  }
  return readerShellUrlForDocument(documentUrl, format);
}

export function isLikelyPdfUrl(url: string): boolean {
  return testDocumentUrl(url, PDF_URL_RE);
}

export function isLikelyFoliateUrl(url: string): boolean {
  return testDocumentUrl(url, FOLIATE_URL_RE);
}

export function isPdfViewerUrl(url: string): boolean {
  return url.startsWith(pdfViewerBaseUrl().href);
}

export function isFoliateViewerUrl(url: string): boolean {
  return url.startsWith(foliateViewerBaseUrl().href);
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

function foliateViewerBaseUrl(): URL {
  return new URL(FOLIATE_VIEWER_PATH, browser.runtime.getURL("/"));
}

export function readStoredDocumentKey(params: URLSearchParams): string | null {
  return params.get(STORED_DOCUMENT_KEY_PARAM);
}

export function hasDocumentSniffFlag(params: URLSearchParams): boolean {
  return params.get(DOCUMENT_SNIFF_PARAM) === "1";
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
    return regex.test(parsed.pathname);
  } catch {
    return false;
  }
}
