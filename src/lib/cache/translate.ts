// background 常驻的翻译缓存。内存 LRU + IndexedDB 二级缓存 + 在途 Promise 去重。

import type { TranslateRequest, TranslateResponse } from "@/engines/types";
import { LRU } from "./lru";
import { readTranslateCache, readTranslateCacheBulk, writeTranslateCache } from "./translate-db";

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

// 批量翻译：三段式缓存命中（LRU → IDB bulk read → API）。
// 每条文本的缓存键与单次翻译一致，hover/selection 可复用同一份缓存。
const BATCH_SEP = "\n";

export async function translateCachedBatch(
  engine: string,
  reqs: TranslateRequest[],
  run: (req: TranslateRequest) => Promise<TranslateResponse>,
  runBatch?: (reqs: TranslateRequest[]) => Promise<TranslateResponse[]>,
): Promise<string[]> {
  if (reqs.length === 0) return [];

  const keys = reqs.map((r) => cacheKey(engine, r));
  const results: (string | undefined)[] = new Array(reqs.length).fill(undefined);

  // Phase 1: LRU memory cache (sync)
  const needIdb: number[] = [];
  for (let i = 0; i < reqs.length; i++) {
    const hit = cache.get(keys[i]!);
    if (hit) {
      results[i] = hit.text;
    } else {
      needIdb.push(i);
    }
  }

  // Phase 2: Bulk IDB read for misses
  const needApi: number[] = [];
  if (needIdb.length > 0) {
    const idbKeys = needIdb.map((i) => keys[i]!);
    const idbHits = await readTranslateCacheBulk(idbKeys).catch(() => []);
    for (let j = 0; j < needIdb.length; j++) {
      const i = needIdb[j]!;
      const hit = idbHits[j];
      if (hit) {
        cache.set(keys[i]!, hit);
        results[i] = hit.text;
      } else {
        needApi.push(i);
      }
    }
  }

  // Phase 3: Batch API call for remaining misses
  if (needApi.length > 0) {
    const apiReqs = needApi.map((i) => reqs[i]!);

    try {
      const batchResponses = runBatch
        ? await runBatch(apiReqs)
        : await translateJoinedBatch(apiReqs, run);

      for (let j = 0; j < needApi.length; j++) {
        const i = needApi[j]!;
        const individual = batchResponses[j] ?? {
          text: "",
          engine,
        };
        cache.set(keys[i]!, individual);
        void writeTranslateCache(keys[i]!, individual).catch(() => undefined);
        results[i] = individual.text;
      }
    } catch (err) {
      console.warn("[OneLingo] translateCachedBatch API failed:", err);
      // Fallback: empty strings for failed items
      for (const i of needApi) results[i] = "";
    }
  }

  return results.map((r) => r ?? "");
}

async function translateJoinedBatch(
  reqs: TranslateRequest[],
  run: (req: TranslateRequest) => Promise<TranslateResponse>,
): Promise<TranslateResponse[]> {
  const joinedText = reqs.map((r) => r.text).join(BATCH_SEP);
  const batchReq: TranslateRequest = {
    text: joinedText,
    target: reqs[0]!.target,
    source: reqs[0]!.source,
  };
  const batchRes = await run(batchReq);
  const parts = splitBatchResult(batchRes.text, reqs.length, BATCH_SEP);
  return parts.map((text) => ({
    text,
    engine: batchRes.engine,
    detectedSource: batchRes.detectedSource,
  }));
}

function splitBatchResult(text: string, count: number, sep: string): string[] {
  if (count === 1) return [text.trim()];
  const parts = text.split(sep);
  if (parts.length === count) return parts.map((p) => p.trim());
  if (parts.length > count) {
    const merged = parts.slice(0, count - 1);
    merged.push(parts.slice(count - 1).join(sep));
    return merged.map((p) => p.trim());
  }
  // Too few parts — pad with empty
  while (parts.length < count) parts.push("");
  return parts.map((p) => p.trim());
}

// 调试 / 后续 UI 展示用
export function cacheStats(): { size: number; inflight: number } {
  return { size: cache.size, inflight: inflight.size };
}
