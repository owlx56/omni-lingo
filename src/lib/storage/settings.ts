import { createSignal, onCleanup, type Accessor } from "solid-js";
import {
  isTargetLang,
  isUiLang,
  type TargetLang,
  type UiLang,
} from "@/lib/languages";
import { browser, type Browser } from "wxt/browser";
import {
  DEFAULT_FOLIATE_READER_SETTINGS,
  normalizeFoliateReaderSettings,
} from "@/lib/foliate-reader-settings";
import {
  DEFAULT_FOLIATE_SIDEBAR_WIDTH,
  FOLIATE_SIDEBAR_DEFAULT_DESKTOP,
  normalizeFoliateSidebarWidth,
} from "@/lib/foliate-sidebar";

export type { TargetLang, UiLang } from "@/lib/languages";

export type FullPageEngineId = "google2" | "microsoft";

// 按场景挂引擎，而不是全局一个：hover 是高频热路径，禁用 AI；
// selection / fullPage 是低频用户主动触发，可以接 AI。UI 层在引擎选择
// 上做能力过滤即可。
export interface EngineMap {
  hover: string;
  selection: string;
  fullPage: FullPageEngineId;
}

export type HoverGranularity = "word" | "sentence" | "paragraph";
export type FullPageMode = "replace" | "bilingual";
export type ThemePreference = "system" | "light" | "dark";
export type TranslationFontFamily = "inherit" | "serif" | "sans" | "mono";
export type TranslationColor =
  | "inherit"
  | "yellow"
  | "green"
  | "teal"
  | "blue"
  | "indigo"
  | "orange"
  | "purple"
  | "pink"
  | "red"
  | "gray"
  | "custom";
export type TranslationUnderlineStyle =
  | "none"
  | "solid"
  | "dotted"
  | "wavy";

export interface TranslationStyle {
  underlineStyle: TranslationUnderlineStyle;
  fontFamily: TranslationFontFamily;
  color: TranslationColor;
  customColor: string;
}

type LegacyTranslationStyle = Partial<TranslationStyle> & {
  underline?: boolean;
};

export const HOVER_FONT_SIZE_MIN = 13;
export const HOVER_FONT_SIZE_MAX = 17;

export interface Settings {
  uiLang: UiLang; // 主语言：options/popup/未来悬浮球的 UI 语言
  hoverEnabled: boolean;
  selectionEnabled: boolean;
  hoverTargetLang: TargetLang;
  selectionTargetLang: TargetLang;
  immersiveTargetLang: TargetLang;
  hoverTargetLangCustomized: boolean;
  selectionTargetLangCustomized: boolean;
  immersiveTargetLangCustomized: boolean;
  theme: ThemePreference;
  engines: EngineMap;
  hoverGranularity: HoverGranularity;
  hoverFontSize: number; // px, [HOVER_FONT_SIZE_MIN, HOVER_FONT_SIZE_MAX]
  fullPageMode: FullPageMode;
  fullPageClickToShowOriginal: boolean;
  documentLinkSniffEnabled: boolean;
  documentLinkSniffKeepOriginal: boolean;
  documentLinkSniffStandalone: boolean;
  foliateSidebarWidth: string;
  foliateSidebarPinned: boolean;
  foliateReaderFontSize: number;
  foliateReaderLineHeight: number;
  foliateReaderTextIndent: boolean;
  foliateReaderUseBookLayout: boolean;
  translationStyle: TranslationStyle;
}

// 老版本存储可能带 hoverLargeText：boolean -> hoverFontSize 13/17 迁移。
type LegacySettings = Partial<Settings> & {
  foliateReaderFontFamily?: unknown;
  hoverLargeText?: unknown;
};

export type SettingsPatch = Omit<
  Partial<Settings>,
  "engines" | "translationStyle"
> & {
  engines?: Partial<EngineMap>;
  translationStyle?: Partial<TranslationStyle>;
};

const DEFAULTS: Settings = {
  uiLang: "zh-Hans",
  hoverEnabled: true,
  selectionEnabled: true,
  hoverTargetLang: "zh-Hans",
  selectionTargetLang: "zh-Hans",
  immersiveTargetLang: "zh-Hans",
  hoverTargetLangCustomized: false,
  selectionTargetLangCustomized: false,
  immersiveTargetLangCustomized: false,
  theme: "system",
  engines: { hover: "google", selection: "google", fullPage: "google2" },
  hoverGranularity: "word",
  hoverFontSize: 14,
  fullPageMode: "replace",
  fullPageClickToShowOriginal: true,
  documentLinkSniffEnabled: true,
  documentLinkSniffKeepOriginal: false,
  documentLinkSniffStandalone: false,
  foliateSidebarWidth: DEFAULT_FOLIATE_SIDEBAR_WIDTH,
  foliateSidebarPinned: true,
  ...DEFAULT_FOLIATE_READER_SETTINGS,
  translationStyle: {
    underlineStyle: "none",
    fontFamily: "inherit",
    color: "inherit",
    customColor: "#fbbc04",
  },
};

const KEY = "sync:settings" as const;
const SETTINGS_STORAGE_AREA = "sync" as const;
const SETTINGS_STORAGE_KEY = "settings" as const;

function withDefaults(raw: Partial<Settings> | null): Settings {
  const legacy = raw as LegacySettings | null;
  const rawWithoutRemovedReaderFont = { ...(legacy ?? {}) };
  delete rawWithoutRemovedReaderFont.foliateReaderFontFamily;

  // 浅 merge 会丢 engines 内部字段，必须二级合并
  const engines = { ...DEFAULTS.engines, ...(raw?.engines ?? {}) };
  const { underline, ...rawTranslationStyle } =
    ((raw?.translationStyle ?? {}) as LegacyTranslationStyle);
  const underlineStyle =
    normalizeUnderlineStyle(rawTranslationStyle.underlineStyle) ??
    (underline === true ? "solid" : undefined) ??
    (underline === false ? "none" : undefined) ??
    DEFAULTS.translationStyle.underlineStyle;
  const translationStyle: TranslationStyle = {
    ...DEFAULTS.translationStyle,
    ...rawTranslationStyle,
    color: normalizeTranslationColor(rawTranslationStyle.color),
    underlineStyle,
  };
  // hoverFontSize 优先读新字段；否则回退到 legacy hoverLargeText。
  const hoverFontSize = clampFontSize(
    legacy?.hoverFontSize ??
      (legacy?.hoverLargeText === true ? HOVER_FONT_SIZE_MAX : undefined),
  );
  const uiLang = normalizeUiLang(legacy?.uiLang);
  const hoverEnabled = normalizeBoolean(
    legacy?.hoverEnabled,
    DEFAULTS.hoverEnabled,
  );
  const selectionEnabled = normalizeBoolean(
    legacy?.selectionEnabled,
    DEFAULTS.selectionEnabled,
  );
  const hoverTargetLang = normalizeTargetLang(legacy?.hoverTargetLang, uiLang);
  const selectionTargetLang = normalizeTargetLang(
    legacy?.selectionTargetLang,
    uiLang,
  );
  const immersiveTargetLang = normalizeTargetLang(
    legacy?.immersiveTargetLang,
    uiLang,
  );
  const hoverTargetLangCustomized = normalizeBoolean(
    legacy?.hoverTargetLangCustomized,
    false,
  );
  const selectionTargetLangCustomized = normalizeBoolean(
    legacy?.selectionTargetLangCustomized,
    false,
  );
  const immersiveTargetLangCustomized = normalizeBoolean(
    legacy?.immersiveTargetLangCustomized,
    false,
  );
  const theme = normalizeTheme(legacy?.theme);
  const documentLinkSniffEnabled = normalizeBoolean(
    legacy?.documentLinkSniffEnabled,
    DEFAULTS.documentLinkSniffEnabled,
  );
  const documentLinkSniffKeepOriginal = normalizeBoolean(
    legacy?.documentLinkSniffKeepOriginal,
    DEFAULTS.documentLinkSniffKeepOriginal,
  );
  const documentLinkSniffStandalone = normalizeBoolean(
    legacy?.documentLinkSniffStandalone,
    DEFAULTS.documentLinkSniffStandalone,
  );
  const foliateSidebarWidth = normalizeSidebarWidth(
    legacy?.foliateSidebarWidth,
  );
  const foliateSidebarPinned = normalizeBoolean(
    legacy?.foliateSidebarPinned,
    DEFAULTS.foliateSidebarPinned,
  );
  const foliateReaderSettings = normalizeFoliateReaderSettings(legacy);
  // 所有 normalize 过的字段必须在 return 末尾显式覆盖，否则 raw 里的脏值会绕开守门。
  return {
    ...DEFAULTS,
    ...rawWithoutRemovedReaderFont,
    engines,
    translationStyle,
    hoverFontSize,
    uiLang,
    hoverEnabled,
    selectionEnabled,
    hoverTargetLang,
    selectionTargetLang,
    immersiveTargetLang,
    hoverTargetLangCustomized,
    selectionTargetLangCustomized,
    immersiveTargetLangCustomized,
    theme,
    documentLinkSniffEnabled,
    documentLinkSniffKeepOriginal,
    documentLinkSniffStandalone,
    foliateSidebarWidth,
    foliateSidebarPinned,
    foliateReaderFontSize: foliateReaderSettings.fontSize,
    foliateReaderLineHeight: foliateReaderSettings.lineHeight,
    foliateReaderTextIndent: foliateReaderSettings.textIndent,
    foliateReaderUseBookLayout: foliateReaderSettings.useBookLayout,
  };
}

function normalizeUiLang(value: unknown): UiLang {
  return isUiLang(value) ? value : DEFAULTS.uiLang;
}

function normalizeTargetLang(value: unknown, fallback: UiLang): TargetLang {
  return isTargetLang(value) ? value : fallback;
}

function normalizeTheme(value: unknown): ThemePreference {
  return value === "system" || value === "light" || value === "dark"
    ? value
    : DEFAULTS.theme;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeSidebarWidth(value: unknown): string {
  return normalizeFoliateSidebarWidth(
    value,
    FOLIATE_SIDEBAR_DEFAULT_DESKTOP,
  );
}

function normalizeTranslationColor(value: unknown): TranslationColor {
  if (
    value === "inherit" ||
    value === "yellow" ||
    value === "green" ||
    value === "teal" ||
    value === "blue" ||
    value === "indigo" ||
    value === "orange" ||
    value === "purple" ||
    value === "pink" ||
    value === "red" ||
    value === "gray" ||
    value === "custom"
  ) {
    return value;
  }
  if (value === "light-green" || value === "olive") return "green";
  if (value === "amber") return "yellow";
  if (value === "coral" || value === "burnt-orange") return "orange";
  if (value === "dark-red") return "red";
  if (value === "muted") return "gray";
  return DEFAULTS.translationStyle.color;
}

export function resolveTargetLang(
  target: TargetLang,
  _uiLang: UiLang,
): UiLang {
  return target;
}

function clampFontSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULTS.hoverFontSize;
  }
  const clamped = Math.min(
    HOVER_FONT_SIZE_MAX,
    Math.max(HOVER_FONT_SIZE_MIN, value),
  );
  const fixed = Number(clamped.toFixed(3));
  return Math.min(
    HOVER_FONT_SIZE_MAX,
    Math.max(HOVER_FONT_SIZE_MIN, fixed),
  );
}

function normalizeUnderlineStyle(
  value: string | undefined,
): TranslationUnderlineStyle | undefined {
  if (
    value === "none" ||
    value === "solid" ||
    value === "dotted" ||
    value === "wavy"
  ) {
    return value;
  }
  return undefined;
}

export async function getSettings(): Promise<Settings> {
  const raw = await storage.getItem<Partial<Settings>>(KEY);
  return withDefaults(raw);
}

export async function getStoredSettings(): Promise<Partial<Settings> | null> {
  return storage.getItem<Partial<Settings>>(KEY);
}

export async function setSettings(patch: SettingsPatch): Promise<void> {
  const cur = await getSettings();
  const uiLang = patch.uiLang ?? cur.uiLang;
  const foliateReaderSettings = normalizeFoliateReaderSettings({
    foliateReaderFontSize:
      patch.foliateReaderFontSize ?? cur.foliateReaderFontSize,
    foliateReaderLineHeight:
      patch.foliateReaderLineHeight ?? cur.foliateReaderLineHeight,
    foliateReaderTextIndent:
      patch.foliateReaderTextIndent ?? cur.foliateReaderTextIndent,
    foliateReaderUseBookLayout:
      patch.foliateReaderUseBookLayout ?? cur.foliateReaderUseBookLayout,
  });
  const next: Settings = {
    ...cur,
    ...patch,
    uiLang,
    hoverTargetLang:
      patch.hoverTargetLang ??
      (patch.uiLang !== undefined && !cur.hoverTargetLangCustomized
        ? uiLang
        : cur.hoverTargetLang),
    selectionTargetLang:
      patch.selectionTargetLang ??
      (patch.uiLang !== undefined && !cur.selectionTargetLangCustomized
        ? uiLang
        : cur.selectionTargetLang),
    immersiveTargetLang:
      patch.immersiveTargetLang ??
      (patch.uiLang !== undefined && !cur.immersiveTargetLangCustomized
        ? uiLang
        : cur.immersiveTargetLang),
    hoverTargetLangCustomized:
      patch.hoverTargetLang !== undefined
        ? true
        : (patch.hoverTargetLangCustomized ?? cur.hoverTargetLangCustomized),
    selectionTargetLangCustomized:
      patch.selectionTargetLang !== undefined
        ? true
        : (patch.selectionTargetLangCustomized ??
          cur.selectionTargetLangCustomized),
    immersiveTargetLangCustomized:
      patch.immersiveTargetLang !== undefined
        ? true
        : (patch.immersiveTargetLangCustomized ??
          cur.immersiveTargetLangCustomized),
    engines: { ...cur.engines, ...(patch.engines ?? {}) },
    translationStyle: {
      ...cur.translationStyle,
      ...(patch.translationStyle ?? {}),
    },
    foliateSidebarWidth: normalizeSidebarWidth(
      patch.foliateSidebarWidth ?? cur.foliateSidebarWidth,
    ),
    foliateSidebarPinned: normalizeBoolean(
      patch.foliateSidebarPinned,
      cur.foliateSidebarPinned,
    ),
    foliateReaderFontSize: foliateReaderSettings.fontSize,
    foliateReaderLineHeight: foliateReaderSettings.lineHeight,
    foliateReaderTextIndent: foliateReaderSettings.textIndent,
    foliateReaderUseBookLayout: foliateReaderSettings.useBookLayout,
  };
  await storage.setItem<Settings>(KEY, next);
}

export function watchSettings(cb: (s: Settings) => void): () => void {
  const stops: Array<() => void> = [];
  let primaryError: unknown;

  const emit = (raw: Partial<Settings> | null | undefined): void => {
    cb(withDefaults(raw ?? null));
  };

  try {
    stops.push(storage.watch<Partial<Settings>>(KEY, emit));
  } catch (err) {
    primaryError = err;
  }

  const stopGlobalWatch = watchSettingsGlobalStorageChanges(emit);
  if (stopGlobalWatch) stops.push(stopGlobalWatch);

  if (stops.length === 0 && primaryError) throw primaryError;
  return () => {
    for (const stop of stops.splice(0)) stop();
  };
}

// Solid 侧订阅入口：返回一个只读 signal，自动在 onCleanup 时解绑。
export function useSettings(): Accessor<Settings> {
  const [s, setS] = createSignal<Settings>(DEFAULTS);
  void getSettings().then(setS).catch(() => {});
  let stop = (): void => {};
  try {
    stop = watchSettings(setS);
  } catch {
    stop = () => {};
  }
  onCleanup(stop);
  return s;
}

type StorageChangeMap = Record<
  string,
  Browser.storage.StorageChange | undefined
>;

function watchSettingsGlobalStorageChanges(
  cb: (raw: Partial<Settings> | null | undefined) => void,
): (() => void) | undefined {
  const onChanged = browser.storage?.onChanged;
  if (!onChanged?.addListener || !onChanged.removeListener) return undefined;

  const listener = (changes: StorageChangeMap, areaName: string): void => {
    if (areaName !== SETTINGS_STORAGE_AREA) return;
    const change = changes[SETTINGS_STORAGE_KEY];
    if (!change) return;
    cb((change.newValue as Partial<Settings> | undefined) ?? null);
  };

  onChanged.addListener(listener);
  return () => onChanged.removeListener(listener);
}
