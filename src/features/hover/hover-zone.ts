export type HoverZoneGranularity = "word" | "sentence" | "paragraph";

export interface HoverZoneRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface HoverZoneInput {
  granularity: HoverZoneGranularity;
  sourceDocument: unknown;
  zoneDocument: unknown;
  zone: HoverZoneRect | null;
  x: number;
  y: number;
  tolerance?: number;
}

const DEFAULT_TOLERANCE = 2;

export function shouldKeepHoverZoneAlive(input: HoverZoneInput): boolean {
  if (input.granularity === "word") return false;
  if (!input.zone || !input.zoneDocument) return false;
  if (input.zoneDocument !== input.sourceDocument) return false;

  const tolerance = input.tolerance ?? DEFAULT_TOLERANCE;
  return (
    input.x >= input.zone.left - tolerance &&
    input.x <= input.zone.right + tolerance &&
    input.y >= input.zone.top - tolerance &&
    input.y <= input.zone.bottom + tolerance
  );
}
