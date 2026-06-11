import { describe, expect, test } from "bun:test";

import {
  FOLIATE_READER_FONT_SIZE_MAX,
  FOLIATE_READER_FONT_SIZE_MIN,
  areFoliateReaderStyleSettingsEqual,
  getLockedFoliateReaderSettings,
  mergeFoliateReaderStyleSettings,
  normalizeFoliateReaderFontSize,
  normalizeFoliateReaderLineHeight,
  normalizeFoliateReaderSettings,
  resolveStoredFoliateReaderSettingsApplication,
  resolveSavedFoliateReaderSettingsApplication,
  shouldApplyStoredFoliateReaderSettings,
  shouldRelayoutFoliateReaderAppearance,
} from "./reader-settings.ts";

describe("normalizeFoliateReaderSettings", () => {
  test("keeps Omni Lingo defaults for missing values", () => {
    expect(normalizeFoliateReaderSettings({})).toEqual({
      fontSize: 17,
      lineHeight: 1.4,
      textIndent: false,
      useBookLayout: true,
    });
  });

  test("clamps numeric reader style settings", () => {
    expect(normalizeFoliateReaderFontSize(4)).toBe(FOLIATE_READER_FONT_SIZE_MIN);
    expect(normalizeFoliateReaderFontSize(80)).toBe(FOLIATE_READER_FONT_SIZE_MAX);
    expect(normalizeFoliateReaderFontSize(18.3456)).toBe(18.346);
    expect(normalizeFoliateReaderLineHeight(0.5)).toBe(1);
    expect(normalizeFoliateReaderLineHeight(4)).toBe(3);
  });

  test("merges partial reader style patches for immediate in-reader controls", () => {
    expect(
      mergeFoliateReaderStyleSettings(
        {
          fontSize: 16,
          lineHeight: 1.4,
          textIndent: false,
          useBookLayout: false,
        },
        {
          fontSize: 80,
          textIndent: true,
        },
      ),
    ).toEqual({
      fontSize: FOLIATE_READER_FONT_SIZE_MAX,
      lineHeight: 1.4,
      textIndent: true,
      useBookLayout: false,
    });
  });

  test("compares reader style settings by appearance fields", () => {
    const base = {
      fontSize: 16,
      lineHeight: 1.4,
      textIndent: false,
      useBookLayout: false,
    };

    expect(areFoliateReaderStyleSettingsEqual(base, { ...base })).toBe(true);
    expect(
      areFoliateReaderStyleSettingsEqual(base, {
        ...base,
        fontSize: 18,
      }),
    ).toBe(false);
  });

  test("requests Foliate relayout for any reader appearance change", () => {
    const base = {
      fontSize: 16,
      lineHeight: 1.4,
      textIndent: false,
      useBookLayout: false,
    };

    expect(shouldRelayoutFoliateReaderAppearance(base, { ...base })).toBe(false);
    expect(
      shouldRelayoutFoliateReaderAppearance(base, {
        ...base,
        fontSize: 18,
      }),
    ).toBe(true);
    expect(
      shouldRelayoutFoliateReaderAppearance(base, {
        ...base,
        lineHeight: 1.8,
      }),
    ).toBe(true);
    expect(
      shouldRelayoutFoliateReaderAppearance(base, {
        ...base,
        textIndent: true,
      }),
    ).toBe(true);
    expect(
      shouldRelayoutFoliateReaderAppearance(base, {
        ...base,
        useBookLayout: true,
      }),
    ).toBe(true);
  });
});

describe("getLockedFoliateReaderSettings", () => {
  test("Use Book Layout locks only paragraph layout settings", () => {
    expect(getLockedFoliateReaderSettings(true)).toEqual({
      fontSize: false,
      lineHeight: true,
      textIndent: true,
    });
  });

  test("reader layout controls are editable when book layout is disabled", () => {
    expect(getLockedFoliateReaderSettings(false)).toEqual({
      fontSize: false,
      lineHeight: false,
      textIndent: false,
    });
  });
});

describe("stored reader settings application", () => {
  const base = {
    fontSize: 16,
    lineHeight: 1.4,
    textIndent: false,
    useBookLayout: false,
  };

  test("applies stored settings when there is no pending local reader change", () => {
    expect(shouldApplyStoredFoliateReaderSettings(base, null)).toBe(true);
    expect(
      resolveStoredFoliateReaderSettingsApplication(base, null),
    ).toEqual({
      pendingLocal: null,
      shouldApply: true,
    });
  });

  test("keeps a pending local value when storage emits an older reader value", () => {
    const pending = { ...base, fontSize: 20 };

    expect(shouldApplyStoredFoliateReaderSettings(base, pending)).toBe(false);
    expect(
      resolveStoredFoliateReaderSettingsApplication(base, pending),
    ).toEqual({
      pendingLocal: pending,
      shouldApply: false,
    });
  });

  test("clears pending local reader change once storage catches up", () => {
    const pending = { ...base, lineHeight: 1.8 };

    expect(
      resolveStoredFoliateReaderSettingsApplication(pending, pending),
    ).toEqual({
      pendingLocal: null,
      shouldApply: true,
    });
  });

  test("ignores a different non-forced stored value while a local save is pending", () => {
    const pending = { ...base, fontSize: 20 };
    const external = { ...base, fontSize: 18 };

    expect(
      resolveStoredFoliateReaderSettingsApplication(external, pending),
    ).toEqual({
      pendingLocal: pending,
      shouldApply: false,
    });
  });

  test("clears pending local reader change after a successful local save without requiring a watcher echo", () => {
    const pending = { ...base, textIndent: true };

    expect(
      resolveSavedFoliateReaderSettingsApplication(pending, pending),
    ).toEqual({
      pendingLocal: null,
    });
  });
});
