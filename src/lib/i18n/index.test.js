import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { translate } from "./index.ts";
import { UI_LANGS } from "../languages.ts";
import { I18N_CATALOG } from "./catalog.ts";

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

  test("fills missing language overrides from English", () => {
    expect(translate("ja", "settings.title")).toBe("OneLingo");
  });

  test("keeps reader copy in the shared catalog", () => {
    for (const lang of UI_LANGS) {
      expect(I18N_CATALOG[lang]["viewer.title"]).toBeTruthy();
      expect(I18N_CATALOG[lang]["pdfViewer.readerTitle"]).toBeTruthy();
      expect(I18N_CATALOG[lang]["pdfViewer.scaleAuto"]).toBeTruthy();
      expect(I18N_CATALOG[lang]["pdfViewer.pdfjs.pageLandmark"]).toBeTruthy();
    }
  });
});
