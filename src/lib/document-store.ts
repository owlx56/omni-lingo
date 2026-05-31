const DB_NAME = "onelingo-docs";
const STORE_NAME = "documents";
const DB_VERSION = 1;

interface StoredDocument {
  data: ArrayBuffer;
  format: "pdf" | "foliate" | "epub";
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
  format: "pdf" | "foliate" | "epub",
  name: string,
): Promise<string> {
  const key = crypto.randomUUID();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(
      { data, format, name, timestamp: Date.now() } satisfies StoredDocument,
      key,
    );
    tx.oncomplete = () => resolve(key);
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadDocument(
  key: string,
): Promise<StoredDocument | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}
