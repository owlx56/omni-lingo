import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { translate } from "./index.ts";
import { UI_LANGS } from "../languages.ts";

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

  test("falls back to English when a language does not override a key", () => {
    expect(translate("ja", "settings.title")).toBe("OneLingo");
  });
});
