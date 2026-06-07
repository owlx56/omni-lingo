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

  test("uses the reader background for chrome safe areas", () => {
    expect(css).toMatch(
      /\.foliate-main\s*\{[^}]*background:\s*var\(--reader-bg\);/,
    );
    expect(css).toMatch(
      /\.foliate-content\s*\{[^}]*background:\s*var\(--reader-bg\);/,
    );
    expect(css).toMatch(
      /\.foliate-render-area\s*\{[^}]*background:\s*var\(--reader-bg\);/,
    );
  });

  test("provides an in-reader appearance settings popover", () => {
    expect(css).toContain(".foliate-appearance-button");
    expect(css).toContain(".foliate-appearance-panel");
    expect(css).toContain(".foliate-appearance-row");
  });

  test("styles the reader progress scrubber in the bottom chrome", () => {
    expect(css).toContain(".foliate-reader-progress");
    expect(css).toContain(".foliate-reader-progress-label");
    expect(css).toContain(".foliate-reader-progress-range");
    expect(css).toMatch(
      /\.foliate-reader-progress-range::-webkit-slider-thumb\s*\{[\s\S]*border-radius:\s*999px;/,
    );
  });

  test("matches options number stepper proportions in the appearance panel", () => {
    expect(css).toMatch(
      /\.foliate-appearance-stepper\s*\{[\s\S]*gap:\s*6px;[\s\S]*min-height:\s*28px;/,
    );
    expect(css).toMatch(
      /\.foliate-appearance-stepper input\s*\{[\s\S]*width:\s*68px;[\s\S]*height:\s*28px;[\s\S]*line-height:\s*28px;/,
    );
    expect(css).toMatch(
      /\.foliate-appearance-stepper button\s*\{[\s\S]*width:\s*26px;[\s\S]*height:\s*26px;[\s\S]*border-radius:\s*7px;/,
    );
  });
});
