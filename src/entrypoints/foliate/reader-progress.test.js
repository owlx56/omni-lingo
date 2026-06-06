import { describe, expect, test } from "bun:test";

import {
  READER_PROGRESS_RANGE_MAX,
  formatReaderProgressPercent,
  progressFractionFromRangeValue,
  rangeValueFromReaderProgress,
  readerProgressFromRelocate,
} from "./reader-progress.ts";

describe("Foliate reader progress", () => {
  test("uses Foliate semantic fraction for the scrubber position", () => {
    const progress = readerProgressFromRelocate({
      fraction: 0.375,
      location: { current: 10, total: 100 },
    });

    expect(progress).toEqual({
      fraction: 0.375,
      locationCurrent: 10,
      locationTotal: 100,
    });
    expect(rangeValueFromReaderProgress(progress)).toBe(375);
    expect(formatReaderProgressPercent(progress)).toBe("38%");
  });

  test("falls back to location progress when fraction is unavailable", () => {
    const progress = readerProgressFromRelocate({
      location: { current: 4, total: 10 },
    });

    expect(progress?.fraction).toBe(0.5);
    expect(progress?.locationCurrent).toBe(4);
    expect(progress?.locationTotal).toBe(10);
  });

  test("clamps range input values to a valid goToFraction target", () => {
    expect(progressFractionFromRangeValue(-10)).toBe(0);
    expect(progressFractionFromRangeValue(READER_PROGRESS_RANGE_MAX + 10)).toBe(1);
    expect(progressFractionFromRangeValue(625)).toBe(0.625);
  });

  test("ignores relocate details without useful progress", () => {
    expect(readerProgressFromRelocate({})).toBeNull();
    expect(readerProgressFromRelocate({ location: { current: 1, total: 0 } })).toBeNull();
  });
});
