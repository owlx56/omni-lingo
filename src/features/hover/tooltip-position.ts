export interface TooltipRect {
  left: number;
  top: number;
  width: number;
  height: number;
  bottom: number;
}

export interface TooltipSize {
  width: number;
  height: number;
}

export interface TooltipViewport {
  width: number;
  height: number;
}

export interface TooltipPosition {
  left: number;
  top: number;
}

const EDGE_MARGIN = 4;
const ANCHOR_MARGIN = 14;

export function computeTooltipPosition(
  anchor: TooltipRect,
  tooltip: TooltipSize,
  viewport: TooltipViewport,
): TooltipPosition {
  const maxLeft = Math.max(
    EDGE_MARGIN,
    viewport.width - tooltip.width - EDGE_MARGIN,
  );
  let left = anchor.left + anchor.width / 2 - tooltip.width / 2;
  left = clamp(left, EDGE_MARGIN, maxLeft);

  const maxTop = Math.max(
    EDGE_MARGIN,
    viewport.height - tooltip.height - EDGE_MARGIN,
  );
  let top = anchor.top - tooltip.height - ANCHOR_MARGIN;
  if (top < EDGE_MARGIN) top = anchor.bottom + ANCHOR_MARGIN;
  top = clamp(top, EDGE_MARGIN, maxTop);

  return { left, top };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
