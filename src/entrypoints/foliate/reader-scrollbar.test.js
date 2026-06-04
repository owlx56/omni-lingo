import { describe, expect, test } from "bun:test";

import {
  computeOverlayThumb,
  createOverlayScrollbarController,
  getOverlayScrollbarState,
} from "./reader-scrollbar.ts";

class FakeScrollContainer {
  constructor({
    clientHeight = 500,
    scrollHeight = 2000,
    scrollTop = 0,
  } = {}) {
    this.clientHeight = clientHeight;
    this.scrollHeight = scrollHeight;
    this.scrollTop = scrollTop;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ type });
    }
  }
}

function createFakeTimer() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    clearTimeout(id) {
      callbacks.delete(id);
    },
    run(id) {
      const callback = callbacks.get(id);
      callbacks.delete(id);
      callback?.();
    },
    setTimeout(callback) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
  };
}

describe("computeOverlayThumb", () => {
  test("maps scroll ratio to thumb height and top", () => {
    expect(
      computeOverlayThumb({
        clientHeight: 500,
        minThumbSize: 1,
        scrollHeight: 2000,
        scrollTop: 750,
        trackHeight: 100,
      }),
    ).toEqual({
      canScroll: true,
      height: 25,
      top: 37.5,
    });
  });

  test("clamps the thumb size and scroll position", () => {
    expect(
      computeOverlayThumb({
        clientHeight: 100,
        minThumbSize: 32,
        scrollHeight: 5000,
        scrollTop: 9999,
        trackHeight: 120,
      }),
    ).toEqual({
      canScroll: true,
      height: 32,
      top: 88,
    });
  });

  test("marks a non-scrollable container as inactive", () => {
    expect(
      computeOverlayThumb({
        clientHeight: 500,
        scrollHeight: 500,
        scrollTop: 0,
        trackHeight: 100,
      }),
    ).toEqual({
      canScroll: false,
      height: 0,
      top: 0,
    });
  });
});

describe("getOverlayScrollbarState", () => {
  test("only enables the overlay in ready scroll mode with scrollable content", () => {
    expect(
      getOverlayScrollbarState({
        canScroll: true,
        isReady: true,
        mode: "scroll",
        requested: "visible",
      }),
    ).toBe("visible");

    expect(
      getOverlayScrollbarState({
        canScroll: true,
        isReady: true,
        mode: "pages",
        requested: "visible",
      }),
    ).toBe("hidden");
  });

  test("does not expand while hidden", () => {
    expect(
      getOverlayScrollbarState({
        canScroll: true,
        isReady: true,
        mode: "scroll",
        requested: "expanded",
        wasVisible: false,
      }),
    ).toBe("hidden");
  });
});

describe("createOverlayScrollbarController", () => {
  test("shows on scroll and hides after idle", () => {
    const timer = createFakeTimer();
    const snapshots = [];
    const container = new FakeScrollContainer();
    const controller = createOverlayScrollbarController({
      clearTimeout: timer.clearTimeout,
      getTrackHeight: () => 100,
      hideDelayMs: 1000,
      isActive: () => true,
      onChange: (snapshot) => snapshots.push(snapshot),
      setTimeout: timer.setTimeout,
    });

    controller.setContainer(container);
    container.dispatch("scroll");

    expect(snapshots.at(-1).state).toBe("visible");
    timer.run(1);
    expect(snapshots.at(-1).state).toBe("hidden");
  });

  test("expands only while visible", () => {
    const snapshots = [];
    const container = new FakeScrollContainer();
    const controller = createOverlayScrollbarController({
      getTrackHeight: () => 100,
      isActive: () => true,
      onChange: (snapshot) => snapshots.push(snapshot),
    });

    controller.setContainer(container);
    controller.expand();
    expect(snapshots.at(-1).state).toBe("hidden");

    controller.show();
    controller.expand();
    expect(snapshots.at(-1).state).toBe("expanded");
  });

  test("keeps the full scrollbar expanded while scrolling inside it", () => {
    const snapshots = [];
    const container = new FakeScrollContainer();
    const controller = createOverlayScrollbarController({
      getTrackHeight: () => 100,
      isActive: () => true,
      onChange: (snapshot) => snapshots.push(snapshot),
    });

    controller.setContainer(container);
    controller.show();
    controller.expand();
    container.dispatch("scroll");

    expect(snapshots.at(-1).state).toBe("expanded");
  });

  test("scrolls the underlying container from wheel events on the overlay", () => {
    const snapshots = [];
    const container = new FakeScrollContainer({
      clientHeight: 500,
      scrollHeight: 2000,
      scrollTop: 400,
    });
    const controller = createOverlayScrollbarController({
      getTrackHeight: () => 100,
      isActive: () => true,
      onChange: (snapshot) => snapshots.push(snapshot),
    });

    controller.setContainer(container);
    controller.show();
    controller.expand();

    expect(
      controller.scrollByWheel({
        deltaMode: 0,
        deltaX: 0,
        deltaY: 120,
      }),
    ).toBe(true);
    expect(container.scrollTop).toBe(520);
    expect(snapshots.at(-1).state).toBe("expanded");
  });

  test("scrolling while hovering the hidden hit zone expands immediately", () => {
    const snapshots = [];
    const container = new FakeScrollContainer({
      clientHeight: 500,
      scrollHeight: 2000,
      scrollTop: 0,
    });
    const controller = createOverlayScrollbarController({
      getTrackHeight: () => 100,
      isActive: () => true,
      onChange: (snapshot) => snapshots.push(snapshot),
    });

    controller.setContainer(container);
    controller.expand();
    expect(snapshots.at(-1).state).toBe("hidden");

    controller.scrollByWheel({
      deltaMode: 0,
      deltaX: 0,
      deltaY: 80,
    });

    expect(container.scrollTop).toBe(80);
    expect(snapshots.at(-1).state).toBe("expanded");
  });

  test("does not activate in pages mode", () => {
    const snapshots = [];
    const container = new FakeScrollContainer();
    const controller = createOverlayScrollbarController({
      getTrackHeight: () => 100,
      isActive: () => false,
      onChange: (snapshot) => snapshots.push(snapshot),
    });

    controller.setContainer(container);
    controller.show();

    expect(snapshots.at(-1).state).toBe("hidden");
  });

  test("converts thumb drag into scrollTop changes", () => {
    const container = new FakeScrollContainer({
      clientHeight: 500,
      scrollHeight: 2000,
      scrollTop: 750,
    });
    const controller = createOverlayScrollbarController({
      getTrackHeight: () => 100,
      isActive: () => true,
    });

    controller.setContainer(container);
    const drag = controller.startThumbDrag(50);
    drag.move(60);

    expect(container.scrollTop).toBeCloseTo(958.333, 3);
    drag.stop();
  });

  test("scrolls by viewport on track click and by a small step on buttons", () => {
    const container = new FakeScrollContainer({
      clientHeight: 500,
      scrollHeight: 2000,
      scrollTop: 750,
    });
    const controller = createOverlayScrollbarController({
      getTrackHeight: () => 100,
      isActive: () => true,
      stepSize: 80,
    });

    controller.setContainer(container);
    controller.scrollByPageAt(10, 0);
    expect(container.scrollTop).toBe(250);

    controller.scrollByStep("down");
    expect(container.scrollTop).toBe(330);
  });
});
