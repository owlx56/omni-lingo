import { describe, expect, test } from "bun:test";

import {
  pageSourceOptions,
  pageSourceToCommandSource,
} from "./popup-language-options.ts";

describe("popup language options", () => {
  test("puts auto detect before the normal UI language list", () => {
    const options = pageSourceOptions("Auto detect");

    expect(options[0]).toEqual({ value: "auto", label: "Auto detect" });
    expect(options[1]?.value).toBe("en");
    expect(options.some((option) => option.value === "zh-Hans")).toBe(true);
  });

  test("omits source from translation commands while source is auto", () => {
    expect(pageSourceToCommandSource("auto")).toBeUndefined();
    expect(pageSourceToCommandSource("ja")).toBe("ja");
  });
});
