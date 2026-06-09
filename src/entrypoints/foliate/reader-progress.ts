import { clamp, finiteNumberOrNull } from "@/lib/number";
import type { FoliateRelocateDetail } from "./types";

export const READER_PROGRESS_RANGE_MAX = 1000;

export interface ReaderProgress {
  fraction: number;
  locationCurrent?: number;
  locationTotal?: number;
}

export function readerProgressFromRelocate(
  detail: FoliateRelocateDetail,
): ReaderProgress | null {
  const location = normalizeLocation(detail.location);
  const fraction = normalizeFraction(detail.fraction);
  const effectiveFraction =
    fraction ?? (location ? (location.current + 1) / location.total : null);

  if (effectiveFraction === null) return null;

  return {
    fraction: clamp(effectiveFraction, 0, 1),
    locationCurrent: location?.current,
    locationTotal: location?.total,
  };
}

export function rangeValueFromReaderProgress(
  progress: ReaderProgress | null | undefined,
): number {
  if (!progress) return 0;
  return Math.round(clamp(progress.fraction, 0, 1) * READER_PROGRESS_RANGE_MAX);
}

export function progressFractionFromRangeValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return clamp(value, 0, READER_PROGRESS_RANGE_MAX) / READER_PROGRESS_RANGE_MAX;
}

export function formatReaderProgressPercent(
  progress: ReaderProgress | null | undefined,
): string {
  if (!progress) return "";
  return `${Math.round(clamp(progress.fraction, 0, 1) * 100)}%`;
}

function normalizeFraction(value: unknown): number | null {
  return finiteNumberOrNull(value);
}

function normalizeLocation(
  location: FoliateRelocateDetail["location"],
): { current: number; total: number } | null {
  if (!location) return null;
  const totalValue = finiteNumberOrNull(location.total);
  const total = totalValue !== null ? Math.floor(totalValue) : 0;
  if (total <= 0) return null;
  const currentValue = finiteNumberOrNull(location.current);
  const rawCurrent = currentValue !== null ? Math.floor(currentValue) : 0;
  return {
    current: clamp(rawCurrent, 0, total - 1),
    total,
  };
}
