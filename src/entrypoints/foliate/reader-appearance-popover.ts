export const READER_APPEARANCE_DISMISS_EXCLUSION_SELECTOR =
  ".foliate-appearance-panel,.foliate-appearance-button";

type ClosestCapableTarget = {
  closest?: (selector: string) => unknown;
  parentElement?: ClosestCapableTarget | null;
};

export function shouldCloseReaderAppearanceFromPointerTarget(
  target: EventTarget | ClosestCapableTarget | null,
  open: boolean,
): boolean {
  if (!open) return false;
  return !isReaderAppearanceTarget(target);
}

function isReaderAppearanceTarget(
  target: EventTarget | ClosestCapableTarget | null,
): boolean {
  if (!target || typeof target !== "object") return false;
  const targetWithClosest = getClosestCapableTarget(target);
  const closest = targetWithClosest?.closest;
  if (typeof closest !== "function") return false;
  return Boolean(closest(READER_APPEARANCE_DISMISS_EXCLUSION_SELECTOR));
}

function getClosestCapableTarget(
  target: EventTarget | ClosestCapableTarget,
): ClosestCapableTarget | null {
  const maybeTarget = target as ClosestCapableTarget;
  if (typeof maybeTarget.closest === "function") return maybeTarget;
  const parent = maybeTarget.parentElement;
  return parent && typeof parent.closest === "function" ? parent : null;
}
