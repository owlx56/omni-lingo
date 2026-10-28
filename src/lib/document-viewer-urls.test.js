import { describe, expect, test } from "bun:test";

import {
  DOCUMENT_SNIFF_PARAM,
  HTTP_FOLIATE_DOCUMENT_URL_REGEX,
  HTTP_PDF_DOCUMENT_URL_REGEX,
  STORED_DOCUMENT_KEY_PARAM,
  hasDocumentSniffFlag,
  isLikelyFoliateUrl,
  isLikelyPdfUrl,
  readStoredDocumentKey,
} from "./document-viewer-urls.ts";

describe("document viewer URL params", () => {
  test("writes Omni Lingo stored document and sniff parameter names", () => {
    expect(STORED_DOCUMENT_KEY_PARAM).toBe("omni-lingo-key");
    expect(DOCUMENT_SNIFF_PARAM).toBe("omni-lingo-sniff");
  });

  test("reads only Omni Lingo document parameters", () => {
    expect(
      readStoredDocumentKey(
        new URLSearchParams("omni-lingo-key=stored-document"),
      ),
    ).toBe("stored-document");
    expect(hasDocumentSniffFlag(new URLSearchParams("omni-lingo-sniff=1"))).toBe(
      true,
    );
  });

  test("ignores removed legacy document parameters", () => {
    expect(readStoredDocumentKey(new URLSearchParams("key=legacy-document"))).toBe(
      null,
    );
    expect(hasDocumentSniffFlag(new URLSearchParams("sniff=1"))).toBe(false);
  });

  test("requires document extensions to end the URL path", () => {
    expect(isLikelyPdfUrl("https://example.com/report.pdf")).toBe(true);
    expect(isLikelyPdfUrl("https://example.com/report.PDF?download=1")).toBe(
      true,
    );
    expect(isLikelyPdfUrl("https://www.pdftechno.com/zh-CN/edit-pdf")).toBe(
      false,
    );
    expect(isLikelyPdfUrl("https://example.com/report.pdftechno")).toBe(false);

    for (const url of [
      "https://example.com/book.epub",
      "https://example.com/book.mobi",
      "https://example.com/book.azw3",
      "https://example.com/book.kf8",
      "https://example.com/book.fb2",
      "https://example.com/book.fb2.zip",
      "https://example.com/book.fbz",
    ]) {
      expect(isLikelyFoliateUrl(url)).toBe(true);
    }

    for (const url of [
      "https://example.com/book.epubpress",
      "https://example.com/book.mobipocket",
      "https://example.com/book.azw3reader",
      "https://example.com/book.kf8reader",
      "https://example.com/book.fb2reader",
      "https://example.com/book.fbzreader",
    ]) {
      expect(isLikelyFoliateUrl(url)).toBe(false);
    }
  });

  test("matches PDF extensions in DNR URL paths without matching PDF-like hosts", () => {
    const regex = new RegExp(HTTP_PDF_DOCUMENT_URL_REGEX);

    expect(regex.test("https://example.com/files/report.pdf")).toBe(true);
    expect(regex.test("https://example.com/files/report.PDF?download=1")).toBe(
      true,
    );
    expect(regex.test("https://www.pdftechno.com/zh-CN/edit-pdf")).toBe(false);
    expect(regex.test("https://example.com/files/report.pdftechno")).toBe(false);
  });

  test("matches ebook extensions in DNR URL paths without matching ebook-like hosts", () => {
    const regex = new RegExp(HTTP_FOLIATE_DOCUMENT_URL_REGEX);

    for (const url of [
      "https://example.com/books/book.epub",
      "https://example.com/books/book.mobi",
      "https://example.com/books/book.azw3",
      "https://example.com/books/book.kf8",
      "https://example.com/books/book.fb2",
      "https://example.com/books/book.fb2.zip",
      "https://example.com/books/book.fbz",
    ]) {
      expect(regex.test(url)).toBe(true);
    }

    for (const url of [
      "https://www.epubbooks.com/read",
      "https://example.mobi/books",
      "https://example.azw3/books",
      "https://example.com/books/book.epubpress",
      "https://example.com/books/book.mobipocket",
      "https://example.com/books/book.azw3reader",
      "https://example.com/books/book.fb2reader",
      "https://example.com/books/book.fbzreader",
    ]) {
      expect(regex.test(url)).toBe(false);
    }
  });
});
