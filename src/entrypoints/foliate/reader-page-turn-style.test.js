import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const css = readFileSync(
  join(import.meta.dir, "../../assets/foliate-viewer/viewer.css"),
  "utf8",
);

describe("Foliate reader page-turn styling", () => {
  test("does not let the edge affordance overlay intercept text selection", () => {
    expect(css).toMatch(
      /\.foliate-page-turn-zone\s*\{[\s\S]*pointer-events:\s*none/,
    );
    expect(css).toMatch(
      /\.foliate-page-turn-zone\.is-visible \.foliate-page-turn-button\s*\{[\s\S]*pointer-events:\s*auto/,
    );
    expect(css).not.toContain(".foliate-page-turn-zone:hover .foliate-page-turn-button");
  });
});
