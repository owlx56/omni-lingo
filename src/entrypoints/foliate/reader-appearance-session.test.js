import { describe, expect, test } from "bun:test";

import {
  createFoliateReaderAppearanceDocumentKey,
  FOLIATE_READER_APPEARANCE_SESSION_KEY,
  readFoliateReaderAppearanceSession,
  resolveFoliateReaderAppearanceGlobalUpdate,
  resolveFoliateReaderAppearanceFromSession,
  writeFoliateReaderAppearanceSession,
} from "./reader-appearance-session.ts";

const globalSettings = {
  fontSize: 17,
  lineHeight: 1.4,
  textIndent: false,
  useBookLayout: true,
};

describe("reader appearance session overrides", () => {
  test("uses global settings before the viewer tab is locally detached", () => {
    const storage = makeSessionStorage();

    expect(
      resolveFoliateReaderAppearanceFromSession(
        storage,
        "stored:book-1",
        globalSettings,
      ),
    ).toEqual({
      detached: false,
      settings: globalSettings,
    });
  });

  test("restores a detached viewer tab override only for the same document", () => {
    const storage = makeSessionStorage();
    const local = {
      fontSize: 20,
      lineHeight: 1.7,
      textIndent: true,
      useBookLayout: false,
    };

    writeFoliateReaderAppearanceSession(storage, "stored:book-1", local);

    expect(
      resolveFoliateReaderAppearanceFromSession(
        storage,
        "stored:book-1",
        globalSettings,
      ),
    ).toEqual({
      detached: true,
      settings: local,
    });
    expect(
      resolveFoliateReaderAppearanceFromSession(
        storage,
        "stored:book-2",
        globalSettings,
      ),
    ).toEqual({
      detached: false,
      settings: globalSettings,
    });
  });

  test("normalizes invalid session values before restoring them", () => {
    const storage = makeSessionStorage();

    storage.setItem(
      FOLIATE_READER_APPEARANCE_SESSION_KEY,
      JSON.stringify({
        detached: true,
        documentKey: "stored:book-1",
        settings: {
          fontSize: 100,
          lineHeight: 0.2,
          textIndent: true,
          useBookLayout: false,
        },
      }),
    );

    expect(
      readFoliateReaderAppearanceSession(storage, "stored:book-1"),
    ).toEqual({
      detached: true,
      documentKey: "stored:book-1",
      settings: {
        fontSize: 30,
        lineHeight: 1,
        textIndent: true,
        useBookLayout: false,
      },
    });
  });

  test("writes detached overrides to the Omni Lingo session key", () => {
    const storage = makeSessionStorage();

    writeFoliateReaderAppearanceSession(storage, "stored:book-1", globalSettings);

    expect(storage.getItem(FOLIATE_READER_APPEARANCE_SESSION_KEY)).toContain(
      "stored:book-1",
    );
  });

  test("creates stable document keys for stored, url, and local files", () => {
    expect(
      createFoliateReaderAppearanceDocumentKey({
        data: new ArrayBuffer(10),
        format: "epub",
        name: "Book.epub",
        storageKey: "abc",
        url: "https://example.com/book.epub",
      }),
    ).toBe("stored:abc");
    expect(
      createFoliateReaderAppearanceDocumentKey({
        data: new ArrayBuffer(10),
        format: "epub",
        name: "Book.epub",
        url: "https://example.com/book.epub",
      }),
    ).toBe("url:https://example.com/book.epub");
    expect(
      createFoliateReaderAppearanceDocumentKey({
        data: new ArrayBuffer(10),
        format: "epub",
        name: "Book.epub",
      }),
    ).toBe("file:Book.epub:epub:10");
  });

  test("applies global options updates until the viewer tab is detached", () => {
    const nextGlobal = {
      fontSize: 18,
      lineHeight: 1.6,
      textIndent: true,
      useBookLayout: false,
    };

    expect(
      resolveFoliateReaderAppearanceGlobalUpdate({
        current: globalSettings,
        detached: false,
        global: nextGlobal,
      }),
    ).toEqual({
      settings: nextGlobal,
      shouldApply: true,
    });
  });

  test("does not reapply equal global settings with a new object identity", () => {
    expect(
      resolveFoliateReaderAppearanceGlobalUpdate({
        current: { ...globalSettings },
        detached: false,
        global: { ...globalSettings },
      }),
    ).toEqual({
      settings: { ...globalSettings },
      shouldApply: false,
    });
  });

  test("ignores global options updates after the viewer tab is detached", () => {
    const current = {
      fontSize: 20,
      lineHeight: 1.8,
      textIndent: true,
      useBookLayout: false,
    };

    expect(
      resolveFoliateReaderAppearanceGlobalUpdate({
        current,
        detached: true,
        global: globalSettings,
      }),
    ).toEqual({
      settings: current,
      shouldApply: false,
    });
  });
});

function makeSessionStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}
