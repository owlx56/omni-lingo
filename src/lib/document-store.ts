import { requestResult, transactionDone } from "@/lib/idb";

export const DOCUMENT_DB_NAME = "omni-lingo-docs";
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
    const request = indexedDB.open(DOCUMENT_DB_NAME, DB_VERSION);
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
  await writeDocumentRecord(db, key, {
    data,
    format,
    name,
    timestamp: Date.now(),
  });
  return key;
}

export async function loadDocument(
  key: string,
): Promise<StoredDocument | null> {
  const db = await openDB();
  return readDocumentRecord(db, key);
}

async function readDocumentRecord(
  db: IDBDatabase,
  key: string,
): Promise<StoredDocument | null> {
  const tx = db.transaction(STORE_NAME, "readonly");
  const result = await requestResult<StoredDocument | undefined>(
    tx.objectStore(STORE_NAME).get(key),
  );
  return result ?? null;
}

async function writeDocumentRecord(
  db: IDBDatabase,
  key: string,
  record: StoredDocument,
): Promise<void> {
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).put(record, key);
  await transactionDone(tx);
}
