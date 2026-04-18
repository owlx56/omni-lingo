import { createSignal, onCleanup, type Accessor } from "solid-js";

export interface Settings {
  targetLang: "zh" | "en";
}

const DEFAULTS: Settings = { targetLang: "zh" };
const KEY = "sync:settings" as const;

export async function getSettings(): Promise<Settings> {
  const raw = await storage.getItem<Partial<Settings>>(KEY);
  return { ...DEFAULTS, ...(raw ?? {}) };
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  const cur = await getSettings();
  await storage.setItem<Settings>(KEY, { ...cur, ...patch });
}

export function watchSettings(cb: (s: Settings) => void): () => void {
  return storage.watch<Partial<Settings>>(KEY, (raw) => {
    cb({ ...DEFAULTS, ...(raw ?? {}) });
  });
}

// Solid 侧订阅入口：返回一个只读 signal，自动在 onCleanup 时解绑。
export function useSettings(): Accessor<Settings> {
  const [s, setS] = createSignal<Settings>(DEFAULTS);
  getSettings().then(setS);
  const stop = watchSettings(setS);
  onCleanup(stop);
  return s;
}
