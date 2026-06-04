import { describe, expect, test } from "bun:test";

import {
  READEST_DEFAULT_FONT_SIZE,
  createFoliateContentCss,
} from "./reader-content-style.ts";

describe("createFoliateContentCss", () => {
  test("uses Readest's default reader font size", () => {
    const css = createFoliateContentCss("light");

    expect(READEST_DEFAULT_FONT_SIZE).toBe(16);
    expect(css).toContain("font-size:16px!important");
    expect(css).toContain("--font-size:16px");
  });
});
