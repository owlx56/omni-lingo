import { createSignal, onCleanup, type Accessor } from "solid-js";

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
export type TranslationFontFamily = "inherit" | "serif" | "sans" | "mono";
export type TranslationColor =
  | "inherit"
  | "muted"
  | "blue"
  | "green"
  | "red"
  | "custom";

export interface TranslationStyle {
  underline: boolean;
  fontFamily: TranslationFontFamily;
  color: TranslationColor;
  customColor: string;
}

export interface Settings {
  targetLang: "zh" | "en";
  engines: EngineMap;
  hoverGranularity: HoverGranularity;
  fullPageMode: FullPageMode;
  translationStyle: TranslationStyle;
}

export type SettingsPatch = Omit<
  Partial<Settings>,
  "engines" | "translationStyle"
> & {
  engines?: Partial<EngineMap>;
  translationStyle?: Partial<TranslationStyle>;
};

const DEFAULTS: Settings = {
  targetLang: "zh",
  engines: { hover: "google", selection: "google", fullPage: "google2" },
  hoverGranularity: "sentence",
  fullPageMode: "replace",
  translationStyle: {
    underline: false,
    fontFamily: "inherit",
    color: "inherit",
    customColor: "#2563eb",
  },
};

const KEY = "sync:settings" as const;

function withDefaults(raw: Partial<Settings> | null): Settings {
  // 浅 merge 会丢 engines 内部字段，必须二级合并
  const engines = { ...DEFAULTS.engines, ...(raw?.engines ?? {}) };
  const translationStyle = {
    ...DEFAULTS.translationStyle,
    ...(raw?.translationStyle ?? {}),
  };
  return { ...DEFAULTS, ...(raw ?? {}), engines, translationStyle };
}

export async function getSettings(): Promise<Settings> {
  const raw = await storage.getItem<Partial<Settings>>(KEY);
  return withDefaults(raw);
}

export async function setSettings(patch: SettingsPatch): Promise<void> {
  const cur = await getSettings();
  const next: Settings = {
    ...cur,
    ...patch,
    engines: { ...cur.engines, ...(patch.engines ?? {}) },
    translationStyle: {
      ...cur.translationStyle,
      ...(patch.translationStyle ?? {}),
    },
  };
  await storage.setItem<Settings>(KEY, next);
}

export function watchSettings(cb: (s: Settings) => void): () => void {
  return storage.watch<Partial<Settings>>(KEY, (raw) => cb(withDefaults(raw)));
}

// Solid 侧订阅入口：返回一个只读 signal，自动在 onCleanup 时解绑。
export function useSettings(): Accessor<Settings> {
  const [s, setS] = createSignal<Settings>(DEFAULTS);
  void getSettings().then(setS);
  const stop = watchSettings(setS);
  onCleanup(stop);
  return s;
}
