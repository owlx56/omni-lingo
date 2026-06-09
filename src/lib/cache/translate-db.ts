import type { TranslateResponse } from "@/engines/types";
import { isObjectRecord } from "@/lib/guards";
import { requestResult, transactionDone } from "@/lib/idb";

const DB_NAME = "onelingo-cache";
const DB_VERSION = 1;
const STORE = "translate";
const UPDATED_AT = "updatedAt";
const MAX_RECORDS = 10_000;
const PRUNE_EVERY_WRITES = 25;

interface TranslateCacheRecord {
  key: string;
  value: TranslateResponse;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | undefined;
let writesSincePrune = 0;

export async function readTranslateCacheBulk(
  keys: string[],
): Promise<(TranslateResponse | undefined)[]> {
  if (keys.length === 0) return [];
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  const results = await Promise.all(
    keys.map((k) => requestResult<unknown>(store.get(k))),
  );
  return results.map((v) => (isRecord(v) ? v.value : undefined));
}

export async function readTranslateCache(
  key: string,
): Promise<TranslateResponse | undefined> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const value = await requestResult<unknown>(tx.objectStore(STORE).get(key));
  return isRecord(value) ? value.value : undefined;
}

export async function writeTranslateCache(
  key: string,
  value: TranslateResponse,
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put({ key, value, updatedAt: Date.now() });
  await transactionDone(tx);

  writesSincePrune += 1;
  if (writesSincePrune >= PRUNE_EVERY_WRITES) {
    writesSincePrune = 0;
    await pruneOldRecords();
  }
}

function openDb(): Promise<IDBDatabase> {
  if (!("indexedDB" in globalThis)) {
    return Promise.reject(new Error("IndexedDB is unavailable"));
  }

  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      const tx = request.transaction;
      const store = db.objectStoreNames.contains(STORE)
        ? tx?.objectStore(STORE)
        : db.createObjectStore(STORE, { keyPath: "key" });

      if (store && !store.indexNames.contains(UPDATED_AT)) {
        store.createIndex(UPDATED_AT, UPDATED_AT);
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = undefined;
      };
      resolve(db);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Failed to open IndexedDB"));
    };
    request.onblocked = () => {
      // 允许下次调用重试（不缓存 rejected promise）
      dbPromise = undefined;
      reject(new Error("IndexedDB open was blocked"));
    };
  });

  return dbPromise;
}

async function pruneOldRecords(): Promise<void> {
  const db = await openDb();
  const countTx = db.transaction(STORE, "readonly");
  const count = await requestResult<number>(countTx.objectStore(STORE).count());
  if (count <= MAX_RECORDS) return;

  let remaining = count - MAX_RECORDS;
  const tx = db.transaction(STORE, "readwrite");
  const request = tx.objectStore(STORE).index(UPDATED_AT).openCursor();

  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor || remaining <= 0) return;

    cursor.delete();
    remaining -= 1;
    cursor.continue();
  };
  request.onerror = () => {
    tx.abort();
  };

  await transactionDone(tx);
}

function isRecord(value: unknown): value is TranslateCacheRecord {
  if (!isObjectRecord(value)) return false;
  const record = value;
  return (
    typeof record.key === "string" &&
    typeof record.updatedAt === "number" &&
    isTranslateResponse(record.value)
  );
}

function isTranslateResponse(value: unknown): value is TranslateResponse {
  if (!isObjectRecord(value)) return false;
  const response = value;
  return (
    typeof response.text === "string" &&
    typeof response.engine === "string" &&
    (response.detectedSource === undefined ||
      typeof response.detectedSource === "string")
  );
}
