export type DocumentKind = "pdf" | "foliate";
export type ViewerFormat = "auto" | DocumentKind | "epub";

export interface DocumentSource {
  bytes: ArrayBuffer;
  mimeType?: string;
  name: string;
  url?: string;
}

export interface ReaderSection {
  html: string;
  id: string;
  title?: string;
}

export interface ReaderDocument {
  cleanup?: () => void;
  kind: DocumentKind;
  sections: ReaderSection[];
  sourceName: string;
  title: string;
  viewerUrl?: string;
  warnings: string[];
}
