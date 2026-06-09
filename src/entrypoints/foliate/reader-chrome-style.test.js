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

  test("uses the shared shell background for the reader and sidebar", () => {
    expect(css).toMatch(/--bg:\s*#f8f8f6;/);
    expect(css).toMatch(/--bg:\s*#1f1f1e;/);
    expect(css).toMatch(/--reader-bg:\s*var\(--bg\);/);
    expect(css).toMatch(/--sidebar-bg:\s*var\(--bg\);/);
  });

  test("separates pinned sidebar from the reader with a single fine divider", () => {
    expect(css).toContain("--sidebar-divider");
    expect(css).toMatch(
      /\.foliate-sidebar\.is-pinned\s*\{[\s\S]*border-right:\s*1px solid var\(--sidebar-divider\);/,
    );
  });

  test("makes sidebar TOC expander triangles inherit theme text color", () => {
    expect(css).toMatch(
      /\.foliate-toc-expander svg\s*\{[\s\S]*fill:\s*currentColor;/,
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
