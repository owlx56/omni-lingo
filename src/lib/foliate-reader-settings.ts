export interface FoliateReaderSettings {
  foliateReaderFontSize: number;
  foliateReaderLineHeight: number;
  foliateReaderTextIndent: boolean;
  foliateReaderUseBookLayout: boolean;
}

export type FoliateReaderStyleSettings = {
  fontSize: number;
  lineHeight: number;
  textIndent: boolean;
  useBookLayout: boolean;
};

export type FoliateReaderStylePatch = Partial<FoliateReaderStyleSettings>;

export const FOLIATE_READER_FONT_SIZE_MIN = 8;
export const FOLIATE_READER_FONT_SIZE_MAX = 30;
export const FOLIATE_READER_LINE_HEIGHT_MIN = 1;
export const FOLIATE_READER_LINE_HEIGHT_MAX = 3;
export const FOLIATE_READER_TEXT_INDENT_EM = 2;

export const DEFAULT_FOLIATE_READER_SETTINGS: FoliateReaderSettings = {
  foliateReaderFontSize: 16,
  foliateReaderLineHeight: 1.4,
  foliateReaderTextIndent: false,
  foliateReaderUseBookLayout: false,
};

export function normalizeFoliateReaderSettings(
  value: Partial<FoliateReaderSettings> | null | undefined,
): FoliateReaderStyleSettings {
  return {
    fontSize: normalizeFoliateReaderFontSize(value?.foliateReaderFontSize),
    lineHeight: normalizeFoliateReaderLineHeight(
      value?.foliateReaderLineHeight,
    ),
    textIndent: normalizeBoolean(
      value?.foliateReaderTextIndent,
      DEFAULT_FOLIATE_READER_SETTINGS.foliateReaderTextIndent,
    ),
    useBookLayout: normalizeBoolean(
      value?.foliateReaderUseBookLayout,
      DEFAULT_FOLIATE_READER_SETTINGS.foliateReaderUseBookLayout,
    ),
  };
}

export function mergeFoliateReaderStyleSettings(
  current: FoliateReaderStyleSettings,
  patch: FoliateReaderStylePatch,
): FoliateReaderStyleSettings {
  return normalizeFoliateReaderSettings({
    foliateReaderFontSize: patch.fontSize ?? current.fontSize,
    foliateReaderLineHeight: patch.lineHeight ?? current.lineHeight,
    foliateReaderTextIndent: patch.textIndent ?? current.textIndent,
    foliateReaderUseBookLayout: patch.useBookLayout ?? current.useBookLayout,
  });
}

export function foliateReaderStyleSettingsToStoragePatch(
  settings: FoliateReaderStyleSettings,
): FoliateReaderSettings {
  return {
    foliateReaderFontSize: settings.fontSize,
    foliateReaderLineHeight: settings.lineHeight,
    foliateReaderTextIndent: settings.textIndent,
    foliateReaderUseBookLayout: settings.useBookLayout,
  };
}

export function areFoliateReaderStyleSettingsEqual(
  a: FoliateReaderStyleSettings,
  b: FoliateReaderStyleSettings,
): boolean {
  return (
    a.fontSize === b.fontSize &&
    a.lineHeight === b.lineHeight &&
    a.textIndent === b.textIndent &&
    a.useBookLayout === b.useBookLayout
  );
}

export function shouldRelayoutFoliateReaderAppearance(
  previous: FoliateReaderStyleSettings,
  next: FoliateReaderStyleSettings,
): boolean {
  return !areFoliateReaderStyleSettingsEqual(previous, next);
}

export function shouldApplyStoredFoliateReaderSettings(
  stored: FoliateReaderStyleSettings,
  pendingLocal: FoliateReaderStyleSettings | null | undefined,
): boolean {
  return (
    !pendingLocal || areFoliateReaderStyleSettingsEqual(stored, pendingLocal)
  );
}

export function resolveStoredFoliateReaderSettingsApplication(
  stored: FoliateReaderStyleSettings,
  pendingLocal: FoliateReaderStyleSettings | null | undefined,
): {
  pendingLocal: FoliateReaderStyleSettings | null;
  shouldApply: boolean;
} {
  const shouldApply = shouldApplyStoredFoliateReaderSettings(
    stored,
    pendingLocal,
  );
  return {
    pendingLocal: shouldApply ? null : (pendingLocal ?? null),
    shouldApply,
  };
}

export function resolveSavedFoliateReaderSettingsApplication(
  saved: FoliateReaderStyleSettings,
  pendingLocal: FoliateReaderStyleSettings | null | undefined,
): {
  pendingLocal: FoliateReaderStyleSettings | null;
} {
  return {
    pendingLocal:
      pendingLocal && areFoliateReaderStyleSettingsEqual(saved, pendingLocal)
        ? null
        : (pendingLocal ?? null),
  };
}

export function normalizeFoliateReaderFontSize(value: unknown): number {
  return clampDecimal(
    value,
    DEFAULT_FOLIATE_READER_SETTINGS.foliateReaderFontSize,
    FOLIATE_READER_FONT_SIZE_MIN,
    FOLIATE_READER_FONT_SIZE_MAX,
  );
}

export function normalizeFoliateReaderLineHeight(value: unknown): number {
  return clampDecimal(
    value,
    DEFAULT_FOLIATE_READER_SETTINGS.foliateReaderLineHeight,
    FOLIATE_READER_LINE_HEIGHT_MIN,
    FOLIATE_READER_LINE_HEIGHT_MAX,
  );
}

export function getLockedFoliateReaderSettings(
  useBookLayout: boolean,
): Record<"fontSize" | "lineHeight" | "textIndent", boolean> {
  return {
    fontSize: false,
    lineHeight: useBookLayout,
    textIndent: useBookLayout,
  };
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clampDecimal(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const clamped = Math.min(max, Math.max(min, value));
  return Number(clamped.toFixed(3));
}
