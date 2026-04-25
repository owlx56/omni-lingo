import type { FullPageRule } from "@/features/immersive/rules";
import { normalizeFullPageRules } from "@/features/immersive/rules";

const KEY = "sync:full-page-rules" as const;

export async function getFullPageRules(): Promise<FullPageRule[]> {
  const raw = await storage.getItem<unknown>(KEY);
  return normalizeFullPageRules(raw);
}

export async function setFullPageRules(rules: FullPageRule[]): Promise<void> {
  await storage.setItem<FullPageRule[]>(KEY, normalizeFullPageRules(rules));
}

export function watchFullPageRules(cb: (rules: FullPageRule[]) => void): () => void {
  return storage.watch<unknown>(KEY, (raw) => cb(normalizeFullPageRules(raw)));
}
