import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { translate } from "./index.ts";
import { UI_LANGS } from "../languages.ts";
import { EN_MESSAGES, I18N_CATALOG, I18N_TRANSLATIONS } from "./catalog.ts";

describe("translate", () => {
  test("stores each UI language in its own locale file", () => {
    for (const lang of UI_LANGS) {
      expect(existsSync(join(import.meta.dir, "locales", `${lang}.ts`))).toBe(
        true,
      );
    }
  });

  test("uses language-specific UI strings for options and popup", () => {
    expect(translate("ja", "popup.button.openOptions")).toBe("設定を開く");
    expect(translate("de", "preferences.uiLang")).toBe("Primäre Sprache");
  });

  test("every non-English UI locale explicitly covers every English key", () => {
    const englishKeys = Object.keys(EN_MESSAGES);
    const missingByLang = [];

    for (const lang of UI_LANGS) {
      if (lang === "en") continue;
      const rawMessages = I18N_TRANSLATIONS[lang];
      const missingKeys = englishKeys.filter((key) => !(key in rawMessages));
      if (missingKeys.length > 0) {
        missingByLang.push(
          `${lang} (${missingKeys.length}): ${missingKeys.join(", ")}`,
        );
      }
    }

    expect(missingByLang).toEqual([]);
  });

  test("keeps reader copy in the shared catalog", () => {
    for (const lang of UI_LANGS) {
      expect(I18N_CATALOG[lang]["viewer.title"]).toBeTruthy();
      expect(I18N_CATALOG[lang]["viewer.appearance.useBookLayout"]).toBeTruthy();
      expect(I18N_CATALOG[lang]["pdfViewer.readerTitle"]).toBeTruthy();
      expect(I18N_CATALOG[lang]["pdfViewer.scaleAuto"]).toBeTruthy();
      expect(I18N_CATALOG[lang]["pdfViewer.pdfjs.pageLandmark"]).toBeTruthy();
    }
  });

  test("uses localized copy for the Foliate reader appearance panel", () => {
    expect(translate("zh-Hans", "viewer.appearance.useBookLayout")).toBe(
      "使用书籍版式",
    );
    expect(translate("zh-Hans", "viewer.appearance.lineHeight")).toBe("行距");
  });

  test("uses ebook wording instead of EPUB in options and viewer labels", () => {
    expect(translate("en", "viewer.format.epub")).toBe("eBook");
    expect(translate("zh-Hans", "viewer.format.epub")).toBe("电子书");

    for (const lang of UI_LANGS) {
      for (const [key, value] of Object.entries(I18N_CATALOG[lang])) {
        if (
          (key.startsWith("viewer.") || key.startsWith("fileplus.")) &&
          !key.endsWith("urlPlaceholder")
        ) {
          expect(value).not.toContain("EPUB");
        }
      }
    }
  });
});
