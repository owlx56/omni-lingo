import {
  areFoliateReaderStyleSettingsEqual,
  normalizeFoliateReaderSettings,
  type FoliateReaderStyleSettings,
} from "./reader-settings";

export const FOLIATE_READER_APPEARANCE_SESSION_KEY =
  "omni-lingo:foliate-reader-appearance";

export interface FoliateReaderAppearanceSessionStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface FoliateReaderAppearanceDocumentSource {
  data: ArrayBuffer;
  format: string;
  name: string;
  storageKey?: string;
  url?: string;
}

export interface FoliateReaderAppearanceSessionState {
  detached: boolean;
  documentKey: string;
  settings: FoliateReaderStyleSettings;
}

export function createFoliateReaderAppearanceDocumentKey(
  source: FoliateReaderAppearanceDocumentSource,
): string {
  if (source.storageKey) return `stored:${source.storageKey}`;
  if (source.url) return `url:${source.url}`;
  return `file:${source.name}:${source.format}:${source.data.byteLength}`;
}

export function readFoliateReaderAppearanceSession(
  storage: FoliateReaderAppearanceSessionStorage | undefined,
  documentKey: string,
): FoliateReaderAppearanceSessionState | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(FOLIATE_READER_APPEARANCE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FoliateReaderAppearanceSessionState>;
    if (!parsed.detached || parsed.documentKey !== documentKey) return null;
    return {
      detached: true,
      documentKey,
      settings: normalizeSessionSettings(parsed.settings),
    };
  } catch {
    return null;
  }
}

export function writeFoliateReaderAppearanceSession(
  storage: FoliateReaderAppearanceSessionStorage | undefined,
  documentKey: string,
  settings: FoliateReaderStyleSettings,
): void {
  if (!storage) return;
  try {
    storage.setItem(
      FOLIATE_READER_APPEARANCE_SESSION_KEY,
      JSON.stringify({
        detached: true,
        documentKey,
        settings: normalizeSessionSettings(settings),
      }),
    );
  } catch {
    // Some browser contexts can deny sessionStorage writes.
  }
}

export function resolveFoliateReaderAppearanceFromSession(
  storage: FoliateReaderAppearanceSessionStorage | undefined,
  documentKey: string,
  globalSettings: FoliateReaderStyleSettings,
): {
  detached: boolean;
  settings: FoliateReaderStyleSettings;
} {
  const session = readFoliateReaderAppearanceSession(storage, documentKey);
  if (session) {
    return {
      detached: true,
      settings: session.settings,
    };
  }
  return {
    detached: false,
    settings: globalSettings,
  };
}

export function resolveFoliateReaderAppearanceGlobalUpdate(input: {
  current: FoliateReaderStyleSettings;
  detached: boolean;
  global: FoliateReaderStyleSettings;
}): {
  settings: FoliateReaderStyleSettings;
  shouldApply: boolean;
} {
  if (input.detached) {
    return {
      settings: input.current,
      shouldApply: false,
    };
  }
  if (areFoliateReaderStyleSettingsEqual(input.current, input.global)) {
    return {
      settings: input.current,
      shouldApply: false,
    };
  }
  return {
    settings: input.global,
    shouldApply: true,
  };
}

function normalizeSessionSettings(
  settings: unknown,
): FoliateReaderStyleSettings {
  const value = settings as Partial<FoliateReaderStyleSettings> | null | undefined;
  return normalizeFoliateReaderSettings({
    foliateReaderFontSize: value?.fontSize,
    foliateReaderLineHeight: value?.lineHeight,
    foliateReaderTextIndent: value?.textIndent,
    foliateReaderUseBookLayout: value?.useBookLayout,
  });
}
