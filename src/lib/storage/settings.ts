import { createSignal, onCleanup, type Accessor } from "solid-js";
import {
  isTargetLang,
  isUiLang,
  type TargetLang,
  type UiLang,
} from "@/lib/languages";

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
  translationStyle: TranslationStyle;
}

// 老版本存储可能带 hoverLargeText：boolean -> hoverFontSize 13/17 迁移。
type LegacySettings = Partial<Settings> & {
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
  foliateSidebarWidth: "24%",
  foliateSidebarPinned: true,
  translationStyle: {
    underlineStyle: "none",
    fontFamily: "inherit",
    color: "inherit",
    customColor: "#fbbc04",
  },
};

const KEY = "sync:settings" as const;

function withDefaults(raw: Partial<Settings> | null): Settings {
  const legacy = raw as LegacySettings | null;

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
  // 所有 normalize 过的字段必须在 return 末尾显式覆盖，否则 raw 里的脏值会绕开守门。
  return {
    ...DEFAULTS,
    ...(raw ?? {}),
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
  if (typeof value !== "string") return DEFAULTS.foliateSidebarWidth;
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?%$/.test(trimmed)) return DEFAULTS.foliateSidebarWidth;
  const fraction = Number.parseFloat(trimmed) / 100;
  if (!Number.isFinite(fraction)) return DEFAULTS.foliateSidebarWidth;
  const clamped = Math.min(0.45, Math.max(0.05, fraction));
  return `${Math.round(clamped * 10000) / 100}%`;
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
  };
  await storage.setItem<Settings>(KEY, next);
}

export function watchSettings(cb: (s: Settings) => void): () => void {
  return storage.watch<Partial<Settings>>(KEY, (raw) => cb(withDefaults(raw)));
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
