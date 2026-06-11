import { describe, expect, test } from "bun:test";

import { DOCUMENT_DB_NAME } from "./document-store.ts";
import { TRANSLATE_CACHE_DB_NAME } from "./cache/translate-db.ts";

describe("storage branding names", () => {
  test("writes Omni Lingo IndexedDB names", () => {
    expect(DOCUMENT_DB_NAME).toBe("omni-lingo-docs");
    expect(TRANSLATE_CACHE_DB_NAME).toBe("omni-lingo-cache");
  });
});
