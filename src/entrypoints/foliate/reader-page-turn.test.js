import { describe, expect, test } from "bun:test";

import { getPageTurnHoverSide } from "./reader-page-turn.ts";

describe("getPageTurnHoverSide", () => {
  test("returns the side when the pointer is in the left or right edge band", () => {
    expect(
      getPageTurnHoverSide({
        clientX: 110,
        containerLeft: 100,
        containerWidth: 1000,
        viewportWidth: 1000,
      }),
    ).toBe("left");

    expect(
      getPageTurnHoverSide({
        clientX: 1090,
        containerLeft: 100,
        containerWidth: 1000,
        viewportWidth: 1000,
      }),
    ).toBe("right");
  });

  test("returns null in the reading center or outside the content area", () => {
    expect(
      getPageTurnHoverSide({
        clientX: 500,
        containerLeft: 100,
        containerWidth: 1000,
        viewportWidth: 1000,
      }),
    ).toBeNull();

    expect(
      getPageTurnHoverSide({
        clientX: 50,
        containerLeft: 100,
        containerWidth: 1000,
        viewportWidth: 1000,
      }),
    ).toBeNull();
  });

  test("clamps the hover band like the visual page-turn affordance", () => {
    expect(
      getPageTurnHoverSide({
        clientX: 80,
        containerLeft: 0,
        containerWidth: 600,
        viewportWidth: 300,
      }),
    ).toBe("left");

    expect(
      getPageTurnHoverSide({
        clientX: 221,
        containerLeft: 0,
        containerWidth: 1200,
        viewportWidth: 2000,
      }),
    ).toBeNull();
  });
});
