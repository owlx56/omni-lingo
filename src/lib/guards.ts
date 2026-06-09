export type ClosestCapableTarget = EventTarget & {
  closest: (selectors: string) => unknown;
};

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isElement(value: unknown): value is Element {
  return typeof Element !== "undefined" && value instanceof Element;
}

export function hasClosest(value: EventTarget | null): value is ClosestCapableTarget {
  if (!value || typeof value !== "object") return false;
  const candidate = value as unknown as { closest?: unknown };
  return typeof candidate.closest === "function";
}
