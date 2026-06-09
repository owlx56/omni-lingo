import { describe, expect, test } from "bun:test";

import { clamp, finiteNumberOrNull } from "./number.ts";

describe("number helpers", () => {
  test("clamps values inside an inclusive range", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  test("accepts only finite numeric values", () => {
    expect(finiteNumberOrNull(3.5)).toBe(3.5);
    expect(finiteNumberOrNull(Number.NaN)).toBeNull();
    expect(finiteNumberOrNull(Number.POSITIVE_INFINITY)).toBeNull();
    expect(finiteNumberOrNull("3.5")).toBeNull();
  });
});
