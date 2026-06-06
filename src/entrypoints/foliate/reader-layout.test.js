import { describe, expect, test } from "bun:test";

import {
  FOLIATE_DEFAULT_VERTICAL_MARGIN,
  getRendererVerticalMargins,
  parseCssPixelValue,
} from "./reader-layout.ts";

describe("getRendererVerticalMargins", () => {
  test("does not add extra vertical margins in paginated mode", () => {
    expect(
      getRendererVerticalMargins("pages", {
        bottom: 56,
        top: 48,
      }),
    ).toEqual({
      bottom: 0,
      top: 0,
    });
  });

  test("keeps Foliate's default vertical margin in scroll mode", () => {
    expect(
      getRendererVerticalMargins("scroll", {
        bottom: 56,
        top: 48,
      }),
    ).toEqual({
      bottom: FOLIATE_DEFAULT_VERTICAL_MARGIN,
      top: FOLIATE_DEFAULT_VERTICAL_MARGIN,
    });
  });
});

describe("parseCssPixelValue", () => {
  test("parses px-like CSS values with a fallback", () => {
    expect(parseCssPixelValue("56px", 48)).toBe(56);
    expect(parseCssPixelValue("", 48)).toBe(48);
  });
});
