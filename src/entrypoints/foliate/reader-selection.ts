import type { FoliateContent, FoliateViewElement } from "./types";

type SelectionLike = {
  rangeCount?: number;
  removeAllRanges?: () => void;
};

type ClosestTarget = {
  closest: (selectors: string) => unknown;
};

const READER_SELECTION_CONTROL_SELECTOR = [
  ".foliate-sidebar",
  ".foliate-sidebar-backdrop",
  ".foliate-sidebar-resize",
  ".foliate-reader-topbar",
  ".foliate-reader-bottombar",
  ".foliate-reader-bottom-hover-zone",
  ".foliate-page-turn-button",
  ".foliate-scrollbar",
  ".foliate-details-backdrop",
  ".foliate-details-modal",
  ".foliate-footnote-backdrop",
  ".foliate-footnote-popup",
].join(", ");

export function clearReaderSelections(
  view: Pick<FoliateViewElement, "deselect" | "getContents"> | null | undefined,
): boolean {
  let cleared = false;
  try {
    view?.deselect?.();
    cleared = Boolean(view?.deselect) || cleared;
  } catch {
    // Fall back to clearing each content document below.
  }

  const selections = new Set<SelectionLike>();
  for (const item of safeContents(view)) {
    cleared = clearDocumentSelections(item.doc, selections) || cleared;
  }
  return cleared;
}

export function shouldDismissReaderSelectionPointer(target: EventTarget | null): boolean {
  if (!hasClosest(target)) return true;
  return !target.closest(READER_SELECTION_CONTROL_SELECTOR);
}

function safeContents(
  view: Pick<FoliateViewElement, "getContents"> | null | undefined,
): FoliateContent[] {
  try {
    const contents = view?.getContents?.();
    return Array.isArray(contents) ? contents : [];
  } catch {
    return [];
  }
}

function clearDocumentSelections(
  doc: Document | null | undefined,
  seen: Set<SelectionLike>,
): boolean {
  let cleared = false;
  const selections = [
    safeGetSelection(() => doc?.getSelection?.()),
    safeGetSelection(() => doc?.defaultView?.getSelection?.()),
  ];

  for (const selection of selections) {
    if (!isSelectionLike(selection) || seen.has(selection)) continue;
    seen.add(selection);
    if (typeof selection.rangeCount === "number" && selection.rangeCount === 0) {
      continue;
    }
    try {
      selection.removeAllRanges();
      cleared = true;
    } catch {
      // Ignore inaccessible or already-detached selections.
    }
  }
  return cleared;
}

function safeGetSelection(read: () => Selection | null | undefined): Selection | null {
  try {
    return read() ?? null;
  } catch {
    return null;
  }
}

function isSelectionLike(value: unknown): value is SelectionLike {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as SelectionLike).removeAllRanges === "function"
  );
}

function hasClosest(target: EventTarget | null): target is EventTarget & ClosestTarget {
  if (!target || typeof target !== "object") return false;
  const candidate = target as unknown as { closest?: unknown };
  return typeof candidate.closest === "function";
}
