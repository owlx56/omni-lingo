import { requestResult, transactionDone } from "@/lib/idb";

const DB_NAME = "onelingo-docs";
const STORE_NAME = "documents";
const DB_VERSION = 1;

interface StoredDocument {
  data: ArrayBuffer;
  format: "pdf" | "foliate";
  name: string;
  timestamp: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function storeDocument(
  data: ArrayBuffer,
  format: "pdf" | "foliate",
  name: string,
): Promise<string> {
  const key = crypto.randomUUID();
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).put(
    { data, format, name, timestamp: Date.now() } satisfies StoredDocument,
    key,
  );
  await transactionDone(tx);
  return key;
}

export async function loadDocument(
  key: string,
): Promise<StoredDocument | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const result = await requestResult<StoredDocument | undefined>(
    tx.objectStore(STORE_NAME).get(key),
  );
  return result ?? null;
}
