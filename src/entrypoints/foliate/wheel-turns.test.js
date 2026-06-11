import { describe, expect, test } from "bun:test";

import {
  createQueuedWheelTurnNavigator,
  createWheelTurnDetector,
  shouldHandleWheelTurn,
} from "./wheel-turns.ts";

const sample = (overrides) => ({
  deltaMode: 0,
  deltaX: 0,
  deltaY: 0,
  timeStamp: 0,
  ...overrides,
});

describe("createWheelTurnDetector", () => {
  test("maps vertical wheel direction to previous and next page turns", () => {
    const detector = createWheelTurnDetector({ threshold: 30 });

    expect(detector.feed(sample({ deltaY: 40, timeStamp: 0 }))).toBe("right");
    detector.reset();
    expect(detector.feed(sample({ deltaY: -40, timeStamp: 0 }))).toBe("left");
  });

  test("maps horizontal wheel direction to previous and next page turns", () => {
    const detector = createWheelTurnDetector({ threshold: 30 });

    expect(detector.feed(sample({ deltaX: 40, timeStamp: 0 }))).toBe("right");
    detector.reset();
    expect(detector.feed(sample({ deltaX: -40, timeStamp: 0 }))).toBe("left");
  });

  test("flips only once during a continuous touchpad gesture", () => {
    const detector = createWheelTurnDetector({ idleResetMs: 120, threshold: 30 });

    expect(detector.feed(sample({ deltaY: 12, timeStamp: 0 }))).toBeNull();
    expect(detector.feed(sample({ deltaY: 12, timeStamp: 16 }))).toBeNull();
    expect(detector.feed(sample({ deltaY: 12, timeStamp: 32 }))).toBe("right");
    expect(detector.feed(sample({ deltaY: 40, timeStamp: 48 }))).toBeNull();
    expect(detector.feed(sample({ deltaY: 40, timeStamp: 64 }))).toBeNull();
  });

  test("starts a new wheel gesture after Omni Lingo's shorter idle gap", () => {
    const detector = createWheelTurnDetector({ threshold: 30 });

    expect(detector.feed(sample({ deltaY: 40, timeStamp: 0 }))).toBe("right");
    expect(detector.feed(sample({ deltaY: 40, timeStamp: 80 }))).toBeNull();
    expect(detector.feed(sample({ deltaY: -40, timeStamp: 201 }))).toBe("left");
  });

  test("counts a single oversized wheel event as one effective step", () => {
    const detector = createWheelTurnDetector({ idleResetMs: 120, threshold: 30 });

    expect(detector.feed(sample({ deltaY: 600, timeStamp: 0 }))).toBe("right");
    expect(detector.feed(sample({ deltaY: 600, timeStamp: 16 }))).toBeNull();
  });

  test("normalizes line and page delta modes", () => {
    const detector = createWheelTurnDetector({
      lineHeight: 40,
      pageHeight: 800,
      threshold: 30,
    });

    expect(detector.feed(sample({ deltaMode: 1, deltaY: 1, timeStamp: 0 }))).toBe("right");
    expect(detector.feed(sample({ deltaMode: 2, deltaY: -1, timeStamp: 201 }))).toBe("left");
  });

  test("ignores ctrl or meta wheel and resets accumulated movement", () => {
    const detector = createWheelTurnDetector({ threshold: 30 });

    expect(detector.feed(sample({ deltaY: 20 }))).toBeNull();
    expect(detector.feed(sample({ ctrlKey: true, deltaY: 20 }))).toBeNull();
    expect(detector.feed(sample({ deltaY: 20 }))).toBeNull();
    expect(detector.feed(sample({ metaKey: true, deltaY: 20 }))).toBeNull();
    expect(detector.feed(sample({ deltaY: 20 }))).toBeNull();
  });
});

describe("createQueuedWheelTurnNavigator", () => {
  test("runs queued wheel turns in enqueue order", async () => {
    const turns = [];
    const navigator = createQueuedWheelTurnNavigator({
      navigate: (direction) => {
        turns.push(direction);
      },
    });

    navigator.enqueue("right");
    navigator.enqueue("right");
    navigator.enqueue("left");
    await navigator.whenIdle();

    expect(turns).toEqual(["right", "right", "left"]);
  });

  test("keeps queued turns while navigation is busy", async () => {
    const turns = [];
    let busy = true;
    let waits = 0;
    const navigator = createQueuedWheelTurnNavigator({
      canNavigate: () => !busy,
      navigate: (direction) => {
        turns.push(direction);
      },
      wait: async () => {
        waits += 1;
        if (waits === 2) busy = false;
      },
    });

    navigator.enqueue("right");
    navigator.enqueue("left");
    await navigator.whenIdle();

    expect(waits).toBe(2);
    expect(turns).toEqual(["right", "left"]);
  });

  test("clears pending turns when inactive", async () => {
    const turns = [];
    const navigator = createQueuedWheelTurnNavigator({
      isActive: () => false,
      navigate: (direction) => {
        turns.push(direction);
      },
    });

    navigator.enqueue("right");
    await navigator.whenIdle();

    expect(turns).toEqual([]);
    expect(navigator.pending()).toBe(0);
  });
});

describe("shouldHandleWheelTurn", () => {
  test("requires ready paginated content and non-zero wheel movement", () => {
    expect(
      shouldHandleWheelTurn(sample({ deltaY: 40 }), {
        isPagesMode: true,
        isReady: true,
      }),
    ).toBe(true);

    expect(
      shouldHandleWheelTurn(sample({ deltaY: 40 }), {
        isPagesMode: false,
        isReady: true,
      }),
    ).toBe(false);

    expect(
      shouldHandleWheelTurn(sample({ deltaY: 40 }), {
        isPagesMode: true,
        isReady: false,
      }),
    ).toBe(false);

    expect(
      shouldHandleWheelTurn(sample({ deltaY: 0 }), {
        isPagesMode: true,
        isReady: true,
      }),
    ).toBe(false);
  });

  test("does not handle modified wheel or reader UI wheel", () => {
    expect(
      shouldHandleWheelTurn(sample({ ctrlKey: true, deltaY: 40 }), {
        isPagesMode: true,
        isReady: true,
      }),
    ).toBe(false);

    expect(
      shouldHandleWheelTurn(sample({ deltaY: 40, metaKey: true }), {
        isPagesMode: true,
        isReady: true,
      }),
    ).toBe(false);

    expect(
      shouldHandleWheelTurn(sample({ deltaY: 40 }), {
        isPagesMode: true,
        isReaderUi: true,
        isReady: true,
      }),
    ).toBe(false);
  });
});
