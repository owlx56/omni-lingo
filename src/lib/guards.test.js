import { describe, expect, test } from "bun:test";

import { hasClosest, isObjectRecord } from "./guards.ts";

describe("guard helpers", () => {
  test("recognizes non-null object records", () => {
    expect(isObjectRecord({ ok: true })).toBe(true);
    expect(isObjectRecord([])).toBe(true);
    expect(isObjectRecord(null)).toBe(false);
    expect(isObjectRecord("value")).toBe(false);
  });

  test("recognizes event targets with a closest helper", () => {
    expect(hasClosest({ closest: () => null })).toBe(true);
    expect(hasClosest({ closest: "not a function" })).toBe(false);
    expect(hasClosest(null)).toBe(false);
  });
});
