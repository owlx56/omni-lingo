import { describe, expect, test } from "bun:test";

import { shouldSkipSameLanguageText } from "./lang-detect.ts";

describe("shouldSkipSameLanguageText", () => {
  test("does not skip opposite-script Chinese targets", () => {
    expect(shouldSkipSameLanguageText("简体中文", "zh-Hant")).toBe(false);
    expect(shouldSkipSameLanguageText("繁體中文", "zh-Hans")).toBe(false);
  });

  test("skips Chinese text that already matches script-specific targets", () => {
    expect(shouldSkipSameLanguageText("这是简体中文", "zh-Hans")).toBe(true);
    expect(shouldSkipSameLanguageText("這是繁體中文", "zh-Hant")).toBe(true);
  });

  test("keeps generic Chinese same-language short circuit", () => {
    expect(shouldSkipSameLanguageText("中文内容", "zh")).toBe(true);
  });

  test("keeps high-confidence Japanese and Korean short circuits", () => {
    expect(shouldSkipSameLanguageText("これは日本語です", "ja")).toBe(true);
    expect(shouldSkipSameLanguageText("한국어 문장", "ko")).toBe(true);
  });
});
