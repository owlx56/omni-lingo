import { describe, expect, test } from "bun:test";

import {
  FOLIATE_SIDEBAR_DEFAULT_DESKTOP,
  FOLIATE_SIDEBAR_DEFAULT_MOBILE,
  normalizeFoliateSidebarWidth,
  parseFoliateSidebarWidthFraction,
  toFoliateSidebarPercent,
} from "@/lib/foliate-sidebar";

describe("foliate reader sidebar width", () => {
  test("uses a narrower desktop default for fresh viewer tabs", () => {
    expect(FOLIATE_SIDEBAR_DEFAULT_DESKTOP).toBe(0.2);
    expect(toFoliateSidebarPercent(FOLIATE_SIDEBAR_DEFAULT_DESKTOP)).toBe("20%");
  });

  test("keeps mobile overlay sidebar narrower than the old desktop fallback", () => {
    expect(FOLIATE_SIDEBAR_DEFAULT_MOBILE).toBe(0.2);
  });

  test("normalizes stored percentage values with clamps and fallback", () => {
    expect(normalizeFoliateSidebarWidth("30%", 0.22)).toBe("30%");
    expect(normalizeFoliateSidebarWidth("2%", 0.22)).toBe("5%");
    expect(normalizeFoliateSidebarWidth("80%", 0.22)).toBe("45%");
    expect(normalizeFoliateSidebarWidth("bad", 0.22)).toBe("22%");
  });

  test("parses sidebar width percentage back to a fraction", () => {
    expect(parseFoliateSidebarWidthFraction("22%")).toBe(0.22);
    expect(parseFoliateSidebarWidthFraction("bad")).toBe(
      FOLIATE_SIDEBAR_DEFAULT_DESKTOP,
    );
  });
});
