export const FOLIATE_SIDEBAR_MIN = 0.05;
export const FOLIATE_SIDEBAR_MAX = 0.45;
export const FOLIATE_SIDEBAR_DEFAULT_DESKTOP = 0.2;
export const FOLIATE_SIDEBAR_DEFAULT_MOBILE = 0.2;
export const DEFAULT_FOLIATE_SIDEBAR_WIDTH =
  toFoliateSidebarPercent(FOLIATE_SIDEBAR_DEFAULT_DESKTOP);

export function toFoliateSidebarPercent(fraction: number): string {
  return `${Math.round(fraction * 10000) / 100}%`;
}

export function normalizeFoliateSidebarWidth(
  value: unknown,
  fallback: number,
): string {
  if (typeof value !== "string") return toFoliateSidebarPercent(fallback);
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?%$/.test(trimmed)) {
    return toFoliateSidebarPercent(fallback);
  }
  const fraction = Number.parseFloat(trimmed) / 100;
  if (!Number.isFinite(fraction)) return toFoliateSidebarPercent(fallback);
  return toFoliateSidebarPercent(
    clampFoliateSidebarFraction(fraction),
  );
}

export function parseFoliateSidebarWidthFraction(value: string): number {
  const fraction = Number.parseFloat(value);
  return Number.isFinite(fraction)
    ? fraction / 100
    : FOLIATE_SIDEBAR_DEFAULT_DESKTOP;
}

export function clampFoliateSidebarFraction(value: number): number {
  return Math.min(FOLIATE_SIDEBAR_MAX, Math.max(FOLIATE_SIDEBAR_MIN, value));
}
