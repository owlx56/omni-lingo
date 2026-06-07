import type { UiLang } from "@/lib/languages";
import { storeDocument } from "@/lib/document-store";
import {
  foliateViewerUrlForStoredKey,
  pdfViewerUrlForStoredKey,
  type DocumentFormat,
} from "@/lib/document-viewer-urls";

export const ACCEPTED_DOCUMENT_FILES =
  ".pdf,.epub,.mobi,.azw3,.kf8,.fb2,.fb2.zip,.fbz,application/pdf,application/epub+zip,application/x-fictionbook+xml,application/x-zip-compressed-fb2";

const EBOOK_FILE_RE = /\.(?:epub|mobi|azw3|kf8|fb2|fb2\.zip|fbz)$/i;

export function inferDocumentKind(
  name: string,
  mime?: string,
): DocumentFormat {
  const lower = name.split(/[?#]/)[0]?.toLowerCase() ?? "";
  if (lower.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  if (EBOOK_FILE_RE.test(lower)) return "foliate";
  return "foliate";
}

export async function storeLocalDocumentAndGetViewerUrl(
  file: File,
  uiLang?: UiLang,
): Promise<string> {
  const kind = inferDocumentKind(file.name, file.type);
  const data = await file.arrayBuffer();
  const key = await storeDocument(data, kind, file.name);
  return kind === "pdf"
    ? pdfViewerUrlForStoredKey(key, uiLang)
    : foliateViewerUrlForStoredKey(key);
}
