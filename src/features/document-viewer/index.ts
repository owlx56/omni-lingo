import { parseEpub } from "./epub";
import { inferDocumentKind } from "./source";
import type {
  DocumentKind,
  DocumentSource,
  ReaderDocument,
  ViewerFormat,
} from "./types";

export type { DocumentKind, DocumentSource, ReaderDocument, ViewerFormat };
export {
  inferDocumentKind,
  inferDocumentKindFromName,
  sourceFromFile,
  sourceFromUrl,
} from "./source";

export async function parseReaderDocument(
  source: DocumentSource,
  preferred: ViewerFormat,
): Promise<ReaderDocument> {
  const kind = inferDocumentKind(source, preferred);
  if (!kind) {
    throw new Error("Unsupported document format");
  }
  return parseByKind(kind, source);
}

function parseByKind(
  kind: DocumentKind,
  source: DocumentSource,
): Promise<ReaderDocument> {
  if (kind === "epub") return parseEpub(source);
  throw new Error("PDF documents are handled by the bundled PDF.js viewer");
}
