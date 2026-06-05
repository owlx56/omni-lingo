import { describe, expect, test } from "bun:test";

import {
  clearReaderSelections,
  shouldDismissReaderSelectionPointer,
} from "./reader-selection.ts";

function fakeSelection() {
  return {
    rangeCount: 1,
    removed: 0,
    removeAllRanges() {
      this.removed += 1;
      this.rangeCount = 0;
    },
  };
}

function fakeDoc(selection = fakeSelection(), windowSelection = null) {
  return {
    defaultView: {
      getSelection: () => windowSelection ?? selection,
    },
    getSelection: () => selection,
  };
}

describe("clearReaderSelections", () => {
  test("clears native selections in every Foliate content document", () => {
    const first = fakeSelection();
    const second = fakeSelection();
    const view = {
      getContents: () => [{ doc: fakeDoc(first) }, { doc: fakeDoc(second) }],
    };

    expect(clearReaderSelections(view)).toBe(true);

    expect(first.rangeCount).toBe(0);
    expect(first.removed).toBe(1);
    expect(second.rangeCount).toBe(0);
    expect(second.removed).toBe(1);
  });

  test("uses Foliate deselect but still falls back to content documents", () => {
    const selection = fakeSelection();
    let deselected = 0;
    const view = {
      deselect() {
        deselected += 1;
      },
      getContents: () => [{ doc: fakeDoc(selection) }],
    };

    expect(clearReaderSelections(view)).toBe(true);

    expect(deselected).toBe(1);
    expect(selection.rangeCount).toBe(0);
  });

  test("clears distinct document and window selection objects", () => {
    const docSelection = fakeSelection();
    const windowSelection = fakeSelection();
    const view = {
      getContents: () => [{ doc: fakeDoc(docSelection, windowSelection) }],
    };

    expect(clearReaderSelections(view)).toBe(true);

    expect(docSelection.rangeCount).toBe(0);
    expect(windowSelection.rangeCount).toBe(0);
  });
});

describe("shouldDismissReaderSelectionPointer", () => {
  test("dismisses blank reader surface clicks", () => {
    expect(shouldDismissReaderSelectionPointer(null)).toBe(true);
    expect(
      shouldDismissReaderSelectionPointer({
        closest: () => null,
      }),
    ).toBe(true);
  });

  test("keeps reader controls from acting like blank dismiss targets", () => {
    expect(
      shouldDismissReaderSelectionPointer({
        closest: (selectors) =>
          selectors.includes(".foliate-details-modal") ? {} : null,
      }),
    ).toBe(false);
  });
});
