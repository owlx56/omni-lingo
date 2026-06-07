import { describe, expect, test } from "bun:test";

import { normalizeOptionsTabId, optionsUrlForTab } from "../../lib/options-tabs.ts";

describe("options tab deep links", () => {
  test("accepts known option tab ids", () => {
    expect(normalizeOptionsTabId("fileplus")).toBe("fileplus");
    expect(normalizeOptionsTabId("about")).toBe("about");
    expect(normalizeOptionsTabId("hover")).toBe("hover");
  });

  test("falls back to account for missing or invalid tabs", () => {
    expect(normalizeOptionsTabId(null)).toBe("account");
    expect(normalizeOptionsTabId("")).toBe("account");
    expect(normalizeOptionsTabId("unknown")).toBe("account");
  });

  test("builds stable options deep-link URLs", () => {
    expect(optionsUrlForTab("chrome-extension://id/options.html", "fileplus")).toBe(
      "chrome-extension://id/options.html?tab=fileplus",
    );
    expect(optionsUrlForTab("chrome-extension://id/options.html?tab=about", "account")).toBe(
      "chrome-extension://id/options.html?tab=account",
    );
  });
});
