import { describe, expect, test } from "bun:test";

import {
  OMNI_LINGO_HOST_ATTR,
  OMNI_LINGO_UI_BOUNDARY_SELECTOR,
  READER_UI_ATTR,
} from "./dom-attrs.ts";

describe("Omni Lingo DOM boundary attrs", () => {
  test("uses Omni Lingo attrs for new UI boundaries", () => {
    expect(OMNI_LINGO_HOST_ATTR).toBe("data-omni-lingo-host");
    expect(READER_UI_ATTR).toBe("data-omni-lingo-reader-ui");
  });

  test("uses only Omni Lingo attrs in shared boundary selectors", () => {
    expect(OMNI_LINGO_UI_BOUNDARY_SELECTOR).toContain(
      `[${OMNI_LINGO_HOST_ATTR}]`,
    );
    expect(OMNI_LINGO_UI_BOUNDARY_SELECTOR).toContain(`[${READER_UI_ATTR}]`);
    expect(OMNI_LINGO_UI_BOUNDARY_SELECTOR).toBe(
      "[data-omni-lingo-host],[data-omni-lingo-reader-ui],[data-omni-lingo-tooltip]",
    );
  });
});
