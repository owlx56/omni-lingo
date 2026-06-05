export type PageTurnSide = "left" | "right";

type PageTurnHoverInput = {
  clientX: number;
  containerLeft: number;
  containerWidth: number;
  viewportWidth: number;
};

const PAGE_TURN_ZONE_MIN = 84;
const PAGE_TURN_ZONE_MAX = 220;
const PAGE_TURN_ZONE_RATIO = 0.15;

export function getPageTurnHoverSide(
  input: PageTurnHoverInput,
): PageTurnSide | null {
  if (input.containerWidth <= 0) return null;
  const x = input.clientX - input.containerLeft;
  if (x < 0 || x > input.containerWidth) return null;

  const idealWidth = input.viewportWidth * PAGE_TURN_ZONE_RATIO;
  const edgeWidth = Math.min(
    input.containerWidth / 2,
    clamp(idealWidth, PAGE_TURN_ZONE_MIN, PAGE_TURN_ZONE_MAX),
  );

  if (x <= edgeWidth) return "left";
  if (x >= input.containerWidth - edgeWidth) return "right";
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
