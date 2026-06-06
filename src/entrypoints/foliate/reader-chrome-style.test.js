import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const css = readFileSync(
  join(import.meta.dir, "../../assets/foliate-viewer/viewer.css"),
  "utf8",
);

describe("Foliate reader chrome layout styling", () => {
  test("keeps the render area out of the hover chrome safe area", () => {
    expect(css).toMatch(
      /\.foliate-content\.has-reader-chrome-space \.foliate-render-area\s*\{[\s\S]*inset:\s*var\(--foliate-reader-topbar-size\) 0 var\(--foliate-reader-bottombar-size\)/,
    );
  });

  test("provides an in-reader appearance settings popover", () => {
    expect(css).toContain(".foliate-appearance-button");
    expect(css).toContain(".foliate-appearance-panel");
    expect(css).toContain(".foliate-appearance-row");
  });

  test("matches options number stepper proportions in the appearance panel", () => {
    expect(css).toMatch(
      /\.foliate-appearance-stepper\s*\{[\s\S]*gap:\s*10px;[\s\S]*\}/,
    );
    expect(css).toMatch(
      /\.foliate-appearance-stepper input\s*\{[\s\S]*width:\s*78px;[\s\S]*border:\s*1px solid var\(--border\);/,
    );
    expect(css).toMatch(
      /\.foliate-appearance-stepper button\s*\{[\s\S]*width:\s*28px;[\s\S]*height:\s*28px;[\s\S]*border-radius:\s*8px;/,
    );
  });
});
