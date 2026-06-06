export type ReaderViewMode = "pages" | "scroll";

export type ReaderChromeMetrics = {
  bottom: number;
  top: number;
};

export const FOLIATE_DEFAULT_VERTICAL_MARGIN = 48;

export function getRendererVerticalMargins(
  mode: ReaderViewMode,
  chrome: ReaderChromeMetrics,
): ReaderChromeMetrics {
  if (mode === "pages") {
    return {
      bottom: 0,
      top: 0,
    };
  }
  if (mode === "scroll") {
    return {
      bottom: FOLIATE_DEFAULT_VERTICAL_MARGIN,
      top: FOLIATE_DEFAULT_VERTICAL_MARGIN,
    };
  }
  return {
    bottom: positivePixelOr(chrome.bottom, FOLIATE_DEFAULT_VERTICAL_MARGIN),
    top: positivePixelOr(chrome.top, FOLIATE_DEFAULT_VERTICAL_MARGIN),
  };
}

export function parseCssPixelValue(
  value: string | null | undefined,
  fallback: number,
): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return positivePixelOr(parsed, fallback);
}

function positivePixelOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
