import { describe, expect, test } from "bun:test";

import {
  ACCEPTED_DOCUMENT_FILES,
  inferDocumentKind,
} from "./document-open.ts";

describe("document open helpers", () => {
  test("routes PDF files to the PDF reader", () => {
    expect(inferDocumentKind("paper.pdf")).toBe("pdf");
    expect(inferDocumentKind("paper.PDF?download=1")).toBe("pdf");
    expect(inferDocumentKind("untitled", "application/pdf")).toBe("pdf");
  });

  test("routes supported ebook files to the Foliate reader", () => {
    for (const name of [
      "book.epub",
      "book.mobi",
      "book.azw3",
      "book.kf8",
      "book.fb2",
      "book.fb2.zip",
      "book.fbz",
    ]) {
      expect(inferDocumentKind(name)).toBe("foliate");
    }
  });

  test("keeps one shared accept string for local document inputs", () => {
    expect(ACCEPTED_DOCUMENT_FILES).toContain(".pdf");
    expect(ACCEPTED_DOCUMENT_FILES).toContain(".epub");
    expect(ACCEPTED_DOCUMENT_FILES).toContain(".fb2.zip");
    expect(ACCEPTED_DOCUMENT_FILES).toContain("application/pdf");
  });
});
