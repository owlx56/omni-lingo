import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const css = readFileSync(
  join(import.meta.dir, "../../assets/foliate-viewer/viewer.css"),
  "utf8",
);

describe("Foliate reader scrollbar styling", () => {
  test("moves the scrolled renderer scrollbar to the reader edge only in scroll mode", () => {
    expect(css).toContain(
      'foliate-view[data-view-mode="scroll"]::part(container)',
    );
    expect(css).toContain("grid-column: 1 / -1");
  });

  test("hides the native scrolled renderer scrollbar for the reader overlay", () => {
    expect(css).toContain("scrollbar-width: none");
    expect(css).toContain("::-webkit-scrollbar");
    expect(css).toContain("display: none");
  });

  test("defines the reader overlay scrollbar states", () => {
    expect(css).toContain(".foliate-scrollbar");
    expect(css).toContain(".foliate-scrollbar.is-visible");
    expect(css).toContain(".foliate-scrollbar.is-expanded");
    expect(css).toContain(".foliate-scrollbar-button");
    expect(css).toContain(".foliate-scrollbar-thumb");
  });

  test("shows only the thumb and solid triangle buttons", () => {
    expect(css).toMatch(/\.foliate-scrollbar\s*\{[\s\S]*width:\s*18px/);
    expect(css).toMatch(/\.foliate-scrollbar\s*\{[\s\S]*pointer-events:\s*auto/);
    expect(css).toMatch(
      /\.foliate-scrollbar\.is-expanded\s*\{[\s\S]*width:\s*18px/,
    );
    expect(css).toMatch(/\.foliate-scrollbar-thumb\s*\{[\s\S]*width:\s*7px/);
    expect(css).toMatch(
      /\.foliate-scrollbar\.is-expanded \.foliate-scrollbar-thumb\s*\{[\s\S]*width:\s*7px/,
    );
    expect(css).toMatch(
      /\.foliate-scrollbar-button\s*\{[\s\S]*background:\s*transparent/,
    );
    expect(css).toMatch(/\.foliate-scrollbar-track\s*\{[\s\S]*pointer-events:\s*none/);
    expect(css).toMatch(
      /\.foliate-scrollbar\.is-expanded \.foliate-scrollbar-track\s*\{[\s\S]*pointer-events:\s*auto/,
    );
    expect(css).toMatch(
      /\.foliate-scrollbar-button-triangle\s*\{[\s\S]*width:\s*12px[\s\S]*height:\s*9px[\s\S]*background:\s*currentColor/,
    );
    expect(css).toMatch(
      /\.foliate-scrollbar-button-triangle\s*\{[\s\S]*-webkit-mask:[\s\S]*svg/,
    );
    expect(css).toContain("C5.45%201%205.87%201.21%206.14%201.58");
    expect(css).not.toContain("solid transparent");
    expect(css).not.toContain("solid currentColor");
    expect(css).not.toContain(".foliate-scrollbar-track::before");
  });

  test("keeps the thumb track stable when the arrow buttons expand", () => {
    expect(css).toMatch(
      /\.foliate-scrollbar-track\s*\{[\s\S]*position:\s*absolute[\s\S]*inset:\s*0/,
    );
    expect(css).toMatch(
      /\.foliate-scrollbar-button\s*\{[\s\S]*position:\s*absolute/,
    );
    expect(css).toMatch(
      /\.foliate-scrollbar-button\.is-up\s*\{[\s\S]*top:\s*0/,
    );
    expect(css).toMatch(
      /\.foliate-scrollbar-button\.is-down\s*\{[\s\S]*bottom:\s*0/,
    );
    expect(css).not.toMatch(
      /\.foliate-scrollbar\.is-expanded\s*\{[\s\S]*grid-template-rows/,
    );
  });
});
