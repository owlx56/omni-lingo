// background 常驻的翻译缓存。内存 LRU + 在途 Promise 去重。
// service worker 被杀时整片丢失——没关系，IndexedDB 持久化是后续步骤。

import type { TranslateRequest, TranslateResponse } from "@/engines/types";
import { LRU } from "./lru";

const CAP = 500;

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

  const p = run()
    .then((res) => {
      cache.set(k, res);
      return res;
    })
    .finally(() => {
      inflight.delete(k);
    });
  inflight.set(k, p);
  return p;
}

// 调试 / 后续 UI 展示用
export function cacheStats(): { size: number; inflight: number } {
  return { size: cache.size, inflight: inflight.size };
}
