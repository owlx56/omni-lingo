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

export interface Settings {
  targetLang: "zh" | "en";
  engines: EngineMap;
  hoverGranularity: HoverGranularity;
  fullPageMode: FullPageMode;
}

export type SettingsPatch = Omit<Partial<Settings>, "engines"> & {
  engines?: Partial<EngineMap>;
};

const DEFAULTS: Settings = {
  targetLang: "zh",
  engines: { hover: "google", selection: "google", fullPage: "google2" },
  hoverGranularity: "sentence",
  fullPageMode: "replace",
};

const KEY = "sync:settings" as const;

function withDefaults(raw: Partial<Settings> | null): Settings {
  // 浅 merge 会丢 engines 内部字段，必须二级合并
  const engines = { ...DEFAULTS.engines, ...(raw?.engines ?? {}) };
  return { ...DEFAULTS, ...(raw ?? {}), engines };
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
