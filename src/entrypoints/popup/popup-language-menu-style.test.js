import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const popupCss = readFileSync(join(import.meta.dir, "popup.css"), "utf8");
const popupApp = readFileSync(join(import.meta.dir, "App.tsx"), "utf8");
const controlsCss = readFileSync(
  join(import.meta.dir, "../../lib/ui/controls.css"),
  "utf8",
);

describe("popup language menu layout", () => {
  test("uses shared select placement for mirrored language menus", () => {
    expect(controlsCss).toMatch(
      /\.select-menu-left\s*\{[\s\S]*left:\s*0[\s\S]*right:\s*auto/,
    );
    expect(controlsCss).toMatch(
      /\.select-menu-right\s*\{[\s\S]*right:\s*0[\s\S]*left:\s*auto/,
    );
  });

  test("does not keep a separate popup dropdown scrollbar implementation", () => {
    expect(controlsCss).toContain(".select-menu::-webkit-scrollbar");
    expect(controlsCss).toContain("scrollbar-width: thin");
    expect(popupCss).not.toContain(".popup-select-menu");
  });

  test("uses the shared scrollable select menu for AI configuration dropdowns", () => {
    expect(popupApp).toContain('menuClass="popup-ai-config-menu"');
    expect(popupCss).toContain(".popup-ai-config-menu");
    expect(popupCss).toMatch(
      /\.select-menu\.popup-ai-config-menu\s*\{[\s\S]*width:\s*176px/,
    );
    expect(popupCss).not.toContain(
      ".popup-ai-config-menu::-webkit-scrollbar",
    );
  });
});
