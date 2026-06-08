import { describe, expect, test } from "bun:test";

import { DEFAULT_FULL_PAGE_RULE, resolveFullPageRule } from "./rules.ts";

describe("resolveFullPageRule source language", () => {
  test("uses the popup source language before the matched rule source", () => {
    const rule = {
      ...DEFAULT_FULL_PAGE_RULE,
      fromLang: "en",
      toLang: "zh-Hans",
    };

    expect(
      resolveFullPageRule(rule, {
        engine: "google2",
        source: "ja",
        target: "zh-Hans",
      }).source,
    ).toBe("ja");
  });

  test("keeps the matched rule source when popup source is auto", () => {
    const rule = {
      ...DEFAULT_FULL_PAGE_RULE,
      fromLang: "en",
      toLang: "zh-Hans",
    };

    expect(
      resolveFullPageRule(rule, {
        engine: "google2",
        target: "zh-Hans",
      }).source,
    ).toBe("en");
  });
});
