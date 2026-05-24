import type { DocumentKind, DocumentSource, ViewerFormat } from "./types";

const PDF_MAGIC = "%PDF";
const EPUB_MIME = "application/epub+zip";

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
  if (preferred !== "auto") return preferred;

  const name = source.name.toLowerCase();
  const mime = source.mimeType?.toLowerCase() ?? "";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (mime === EPUB_MIME || name.endsWith(".epub")) return "epub";

  const prefix = new TextDecoder("latin1").decode(source.bytes.slice(0, 8));
  if (prefix.startsWith(PDF_MAGIC)) return "pdf";
  if (prefix.startsWith("PK")) return "epub";
  return null;
}

export function inferDocumentKindFromName(
  name: string,
  mimeType: string | undefined,
  preferred: ViewerFormat,
): DocumentKind | null {
  if (preferred !== "auto") return preferred;

  const lowerName = name.toLowerCase();
  const lowerMime = mimeType?.toLowerCase() ?? "";
  if (lowerMime === "application/pdf" || lowerName.endsWith(".pdf")) return "pdf";
  if (lowerMime === EPUB_MIME || lowerName.endsWith(".epub")) return "epub";
  return null;
}

export function stripDocumentExtension(name: string): string {
  return name.replace(/\.(pdf|epub)$/i, "") || name;
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
