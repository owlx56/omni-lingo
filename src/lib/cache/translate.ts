// background 常驻的翻译缓存。内存 LRU + IndexedDB 二级缓存 + 在途 Promise 去重。

import type { TranslateRequest, TranslateResponse } from "@/engines/types";
import { LRU } from "./lru";
import { readTranslateCache, writeTranslateCache } from "./translate-db";

const CAP = 5_000;

const cache = new LRU<string, TranslateResponse>(CAP);
const inflight = new Map<string, Promise<TranslateResponse>>();

export function cacheKey(engine: string, req: TranslateRequest): string {
  return `${engine}|${req.source ?? "auto"}|${req.target}|${req.text}`;
}

export async function translateCached(
  engine: string,
  req: TranslateRequest,
  run: () => Promise<TranslateResponse>,
): Promise<TranslateResponse> {
  const k = cacheKey(engine, req);

  const hit = cache.get(k);
  if (hit) return hit;

  const pending = inflight.get(k);
  if (pending) return pending;

  const p = (async () => {
    const persisted = await readTranslateCache(k).catch(() => undefined);
    if (persisted) {
      cache.set(k, persisted);
      return persisted;
    }

    const res = await run();
    cache.set(k, res);
    void writeTranslateCache(k, res).catch(() => undefined);
    return res;
  })().finally(() => {
    inflight.delete(k);
  });

  inflight.set(k, p);
  return p;
}

// 调试 / 后续 UI 展示用
export function cacheStats(): { size: number; inflight: number } {
  return { size: cache.size, inflight: inflight.size };
}
