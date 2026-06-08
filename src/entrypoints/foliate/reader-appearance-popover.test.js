import { describe, expect, test } from "bun:test";

import {
  READER_APPEARANCE_DISMISS_EXCLUSION_SELECTOR,
  shouldCloseReaderAppearanceFromPointerTarget,
} from "./reader-appearance-popover.ts";

function targetInside(matches) {
  return {
    closest(selector) {
      expect(selector).toBe(READER_APPEARANCE_DISMISS_EXCLUSION_SELECTOR);
      return matches ? {} : null;
    },
  };
}

function domLikeTargetInside(matches) {
  const target = {
    closest(selector) {
      if (this !== target) throw new TypeError("Illegal invocation");
      expect(selector).toBe(READER_APPEARANCE_DISMISS_EXCLUSION_SELECTOR);
      return matches ? {} : null;
    },
  };
  return target;
}

describe("reader appearance popover dismissal", () => {
  test("does not close when the popover is already closed", () => {
    expect(
      shouldCloseReaderAppearanceFromPointerTarget(targetInside(false), false),
    ).toBe(false);
  });

  test("keeps the popover open for clicks inside the panel or settings button", () => {
    expect(
      shouldCloseReaderAppearanceFromPointerTarget(targetInside(true), true),
    ).toBe(false);
  });

  test("calls DOM-like closest with the original target as this", () => {
    expect(
      shouldCloseReaderAppearanceFromPointerTarget(
        domLikeTargetInside(true),
        true,
      ),
    ).toBe(false);
  });

  test("keeps the popover open for text-node-like targets inside the panel", () => {
    expect(
      shouldCloseReaderAppearanceFromPointerTarget(
        { parentElement: targetInside(true) },
        true,
      ),
    ).toBe(false);
  });

  test("closes the popover for clicks outside the panel and settings button", () => {
    expect(
      shouldCloseReaderAppearanceFromPointerTarget(targetInside(false), true),
    ).toBe(true);
  });

  test("closes for iframe document clicks whose target has no closest helper", () => {
    expect(shouldCloseReaderAppearanceFromPointerTarget({}, true)).toBe(true);
  });
});
