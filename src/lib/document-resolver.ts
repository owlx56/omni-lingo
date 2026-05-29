import type { DocumentFormat, ViewerFormat } from "@/lib/document-viewer-urls";

export interface FetchedDocument {
  data: ArrayBuffer;
  format: DocumentFormat;
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

export async function fetchDocumentFromUrl(
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
  if (fileParamUrl && looksLikeDocumentUrl(fileParamUrl, preferred)) {
    return fileParamUrl;
  }

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
  _preferred: ViewerFormat,
): DocumentFormat | null {
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

function looksLikeDocumentOrHtmlShell(
  url: string,
  preferred: ViewerFormat,
): boolean {
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

function nameFromUrl(url: string, format: DocumentFormat): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : `document.${format}`;
  } catch {
    return `document.${format}`;
  }
}
