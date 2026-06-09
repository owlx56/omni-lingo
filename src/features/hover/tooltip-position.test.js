import { describe, expect, test } from "bun:test";

import { computeTooltipPosition } from "./tooltip-position.ts";

function rect(left, top, width, height) {
  return {
    left,
    top,
    width,
    height,
    bottom: top + height,
  };
}

describe("computeTooltipPosition", () => {
  test("centers the tooltip above the anchor", () => {
    expect(
      computeTooltipPosition(
        rect(100, 200, 40, 10),
        { width: 120, height: 30 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ left: 60, top: 156 });
  });

  test("clamps the centered tooltip inside the viewport", () => {
    expect(
      computeTooltipPosition(
        rect(5, 200, 10, 10),
        { width: 120, height: 30 },
        { width: 800, height: 600 },
      ).left,
    ).toBe(4);
  });

  test("places the tooltip below the anchor when there is no room above", () => {
    expect(
      computeTooltipPosition(
        rect(100, 20, 40, 10),
        { width: 120, height: 30 },
        { width: 800, height: 600 },
      ).top,
    ).toBe(44);
  });
});
