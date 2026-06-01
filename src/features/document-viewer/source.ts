import type { DocumentKind, DocumentSource, ViewerFormat } from "./types";

const PDF_MAGIC = "%PDF";
const FOLIATE_MIME = "application/epub+zip";
const FB2_MIME = "application/x-fictionbook+xml";
const FBZ_MIME = "application/x-zip-compressed-fb2";
const MOBI_MAGIC = "BOOKMOBI";

export async function sourceFromFile(file: File): Promise<DocumentSource> {
  return {
    bytes: await file.arrayBuffer(),
    mimeType: file.type || undefined,
    name: file.name,
  };
}

export async function sourceFromUrl(url: string): Promise<DocumentSource> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return {
    bytes: await res.arrayBuffer(),
    mimeType: res.headers.get("content-type")?.split(";")[0]?.trim(),
    name: nameFromUrl(url) ?? "document",
    url,
  };
}

export function inferDocumentKind(
  source: DocumentSource,
  preferred: ViewerFormat,
): DocumentKind | null {
  if (preferred === "pdf" || preferred === "foliate") return preferred;
  if (preferred !== "auto") return null;

  const name = source.name.toLowerCase();
  const mime = source.mimeType?.toLowerCase() ?? "";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (
    mime === FOLIATE_MIME ||
    mime === FB2_MIME ||
    mime === FBZ_MIME ||
    name.endsWith(".epub") ||
    name.endsWith(".mobi") ||
    name.endsWith(".azw3") ||
    name.endsWith(".kf8") ||
    name.endsWith(".fb2") ||
    name.endsWith(".fb2.zip") ||
    name.endsWith(".fbz")
  ) {
    return "foliate";
  }

  const prefix = new TextDecoder("latin1").decode(source.bytes.slice(0, 8));
  if (prefix.startsWith(PDF_MAGIC)) return "pdf";
  if (prefix.startsWith(MOBI_MAGIC)) return "foliate";
  if (prefix.startsWith("BOOK")) return "foliate";
  if (prefix.startsWith("PK")) return "foliate";
  return null;
}

export function inferDocumentKindFromName(
  name: string,
  mimeType: string | undefined,
  preferred: ViewerFormat,
): DocumentKind | null {
  if (preferred === "pdf" || preferred === "foliate") return preferred;
  if (preferred !== "auto") return null;

  const lowerName = name.toLowerCase();
  const lowerMime = mimeType?.toLowerCase() ?? "";
  if (lowerMime === "application/pdf" || lowerName.endsWith(".pdf")) return "pdf";
  if (
    lowerMime === FOLIATE_MIME ||
    lowerMime === FB2_MIME ||
    lowerMime === FBZ_MIME ||
    lowerName.endsWith(".epub") ||
    lowerName.endsWith(".mobi") ||
    lowerName.endsWith(".azw3") ||
    lowerName.endsWith(".kf8") ||
    lowerName.endsWith(".fb2") ||
    lowerName.endsWith(".fb2.zip") ||
    lowerName.endsWith(".fbz")
  ) {
    return "foliate";
  }
  return null;
}

export function stripDocumentExtension(name: string): string {
  return name.replace(/\.(pdf|epub|mobi|azw3|kf8|fb2|fb2\.zip|fbz)$/i, "") || name;
}

function nameFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const last = url.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : null;
  } catch {
    return null;
  }
}
