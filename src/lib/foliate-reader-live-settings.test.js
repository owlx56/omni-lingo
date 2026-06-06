import { describe, expect, test } from "bun:test";

import {
  broadcastFoliateReaderAppearance,
  createFoliateReaderAppearanceMessageInput,
  isMissingFoliateReaderReceiverError,
  listenFoliateReaderAppearanceBroadcast,
  postFoliateReaderAppearanceBroadcast,
} from "./foliate-reader-live-settings.ts";

describe("foliate reader live settings broadcast", () => {
  test("sends complete normalized reader appearance settings", async () => {
    const calls = [];

    await broadcastFoliateReaderAppearance(
      {
        fontSize: 22,
        lineHeight: 1.8,
        textIndent: true,
        useBookLayout: false,
      },
      async (type, input) => {
        calls.push({ type, input });
        return { applied: true };
      },
    );

    expect(calls).toEqual([
      {
        type: "applyFoliateReaderAppearance",
        input: {
          settings: {
            fontSize: 22,
            lineHeight: 1.8,
            textIndent: true,
            useBookLayout: false,
          },
        },
      },
    ]);
  });

  test("normalizes broadcast payload values before sending", () => {
    expect(
      createFoliateReaderAppearanceMessageInput({
        fontSize: 100,
        lineHeight: 0.2,
        textIndent: true,
        useBookLayout: true,
      }),
    ).toEqual({
      settings: {
        fontSize: 30,
        lineHeight: 1,
        textIndent: true,
        useBookLayout: true,
      },
    });
  });

  test("ignores the normal no-open-reader runtime messaging error", async () => {
    const posted = [];

    await expect(
      broadcastFoliateReaderAppearance(
        {
          fontSize: 18,
          lineHeight: 1.5,
          textIndent: false,
          useBookLayout: false,
        },
        async () => {
          throw new Error("Could not establish connection. Receiving end does not exist.");
        },
        () => makeFakeBroadcastChannel(posted),
      ),
    ).resolves.toBeUndefined();

    expect(posted).toEqual([
      {
        type: "applyFoliateReaderAppearance",
        input: {
          settings: {
            fontSize: 18,
            lineHeight: 1.5,
            textIndent: false,
            useBookLayout: false,
          },
        },
      },
    ]);
  });

  test("only treats missing receiver errors as optional", () => {
    expect(
      isMissingFoliateReaderReceiverError(
        new Error("Could not establish connection. Receiving end does not exist."),
      ),
    ).toBe(true);
    expect(isMissingFoliateReaderReceiverError(new Error("permission denied"))).toBe(false);
  });

  test("posts a same-origin broadcast channel message for already open reader pages", () => {
    const posted = [];

    postFoliateReaderAppearanceBroadcast(
      {
        fontSize: 21,
        lineHeight: 1.6,
        textIndent: true,
        useBookLayout: false,
      },
      () => makeFakeBroadcastChannel(posted),
    );

    expect(posted).toEqual([
      {
        type: "applyFoliateReaderAppearance",
        input: {
          settings: {
            fontSize: 21,
            lineHeight: 1.6,
            textIndent: true,
            useBookLayout: false,
          },
        },
      },
    ]);
  });

  test("listens for reader appearance broadcasts and cleans up the channel", () => {
    const received = [];
    const channel = makeFakeBroadcastChannel([]);

    const stop = listenFoliateReaderAppearanceBroadcast(
      (settings) => received.push(settings),
      () => channel,
    );

    channel.dispatch({
      type: "applyFoliateReaderAppearance",
      input: {
        settings: {
          fontSize: 19,
          lineHeight: 1.7,
          textIndent: false,
          useBookLayout: true,
        },
      },
    });
    channel.dispatch({ type: "other", input: {} });
    stop();
    channel.dispatch({
      type: "applyFoliateReaderAppearance",
      input: {
        settings: {
          fontSize: 20,
          lineHeight: 1.7,
          textIndent: false,
          useBookLayout: true,
        },
      },
    });

    expect(received).toEqual([
      {
        fontSize: 19,
        lineHeight: 1.7,
        textIndent: false,
        useBookLayout: true,
      },
    ]);
    expect(channel.closed).toBe(true);
  });
});

function makeFakeBroadcastChannel(posted) {
  const listeners = new Set();
  return {
    closed: false,
    addEventListener(type, listener) {
      if (type === "message") listeners.add(listener);
    },
    close() {
      this.closed = true;
    },
    dispatch(data) {
      for (const listener of listeners) listener({ data });
    },
    postMessage(message) {
      posted.push(message);
    },
    removeEventListener(type, listener) {
      if (type === "message") listeners.delete(listener);
    },
  };
}
