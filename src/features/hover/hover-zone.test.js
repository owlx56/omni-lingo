import { describe, expect, test } from "bun:test";

import { shouldKeepHoverZoneAlive } from "./hover-zone.ts";

function rect(left, top, width, height) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

describe("shouldKeepHoverZoneAlive", () => {
  test("keeps sentence and paragraph hover alive inside the current zone", () => {
    const doc = {};
    const zone = rect(20, 40, 200, 80);

    expect(
      shouldKeepHoverZoneAlive({
        granularity: "sentence",
        sourceDocument: doc,
        zoneDocument: doc,
        zone,
        x: 120,
        y: 70,
      }),
    ).toBe(true);

    expect(
      shouldKeepHoverZoneAlive({
        granularity: "paragraph",
        sourceDocument: doc,
        zoneDocument: doc,
        zone,
        x: 120,
        y: 70,
      }),
    ).toBe(true);
  });

  test("does not keep word hover alive from the previous zone", () => {
    const doc = {};

    expect(
      shouldKeepHoverZoneAlive({
        granularity: "word",
        sourceDocument: doc,
        zoneDocument: doc,
        zone: rect(20, 40, 200, 80),
        x: 120,
        y: 70,
      }),
    ).toBe(false);
  });

  test("does not keep hover alive outside the current zone or document", () => {
    const doc = {};

    expect(
      shouldKeepHoverZoneAlive({
        granularity: "sentence",
        sourceDocument: doc,
        zoneDocument: doc,
        zone: rect(20, 40, 200, 80),
        x: 400,
        y: 70,
      }),
    ).toBe(false);

    expect(
      shouldKeepHoverZoneAlive({
        granularity: "sentence",
        sourceDocument: {},
        zoneDocument: doc,
        zone: rect(20, 40, 200, 80),
        x: 120,
        y: 70,
      }),
    ).toBe(false);
  });
});
