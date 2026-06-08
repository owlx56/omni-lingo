import { describe, expect, test } from "bun:test";

import {
  createPopupPagePrefSync,
  pagePrefsFromLocalSaveAck,
} from "./page-pref-sync.ts";

describe("popup page preference sync", () => {
  test("rejects remote page preference snapshots captured before a local selection", () => {
    const sync = createPopupPagePrefSync();
    const initialSnapshot = sync.capture();

    const localSelection = sync.markLocalChange();

    expect(sync.canApplyRemote(initialSnapshot)).toBe(false);
    expect(sync.canApplyRemote(localSelection)).toBe(true);
  });

  test("keeps the selected engine when a save ack still reports the old active engine", () => {
    expect(
      pagePrefsFromLocalSaveAck(
        {
          engine: "microsoft",
          mode: "replace",
          source: "auto",
          target: "zh-Hans",
        },
        {
          engine: "google2",
          hasPagePrefs: true,
          mode: "replace",
          source: "ja",
          target: "zh-Hans",
        },
      ),
    ).toEqual({
      engine: "microsoft",
      hasPagePrefs: true,
      mode: "replace",
      source: "auto",
      target: "zh-Hans",
    });
  });

  test("keeps the selected source when a save ack still reports an old source", () => {
    expect(
      pagePrefsFromLocalSaveAck(
        {
          engine: "google2",
          mode: "bilingual",
          source: "ja",
          target: "zh-Hans",
        },
        {
          engine: "google2",
          hasPagePrefs: true,
          mode: "bilingual",
          source: "en",
          target: "zh-Hans",
        },
      ),
    ).toEqual({
      engine: "google2",
      hasPagePrefs: true,
      mode: "bilingual",
      source: "ja",
      target: "zh-Hans",
    });
  });
});
