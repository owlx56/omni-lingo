import { describe, expect, test } from "bun:test";

import {
  DOCUMENT_SNIFF_PARAM,
  STORED_DOCUMENT_KEY_PARAM,
  hasDocumentSniffFlag,
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
});
