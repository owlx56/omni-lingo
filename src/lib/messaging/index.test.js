import { describe, expect, test } from "bun:test";

import { isProtocolEnvelope, makeEnvelope } from "./index.ts";

describe("messaging envelope branding", () => {
  test("sends Omni Lingo envelopes", () => {
    expect(makeEnvelope("ping", { text: "hello" })).toEqual({
      __omniLingo: true,
      type: "ping",
      input: { text: "hello" },
    });
  });

  test("rejects removed legacy envelopes", () => {
    expect(
      isProtocolEnvelope({
        __legacy: true,
        type: "ping",
        input: { text: "hello" },
      }),
    ).toBe(false);
  });
});
