import { describe, expect, it } from "bun:test";
import {
  createLoadingLineSpecs,
  getLoadingLineCount,
} from "./immersive-loading";

describe("immersive loading skeleton", () => {
  it("chooses line counts from normalized text length", () => {
    expect(getLoadingLineCount("short text")).toBe(1);
    expect(getLoadingLineCount("x".repeat(80))).toBe(2);
    expect(getLoadingLineCount("x".repeat(160))).toBe(3);
    expect(getLoadingLineCount("x".repeat(260))).toBe(4);
  });

  it("uses a single em-based line for inline loading", () => {
    const specs = createLoadingLineSpecs("inline text", true);
    expect(specs).toHaveLength(1);
    expect(specs[0]?.width.endsWith("em")).toBe(true);
  });

  it("uses alternating block widths for multiline loading", () => {
    const specs = createLoadingLineSpecs("x".repeat(160), false);
    expect(specs.map((spec) => spec.width)).toEqual(["100%", "94%", "58%"]);
  });
});
