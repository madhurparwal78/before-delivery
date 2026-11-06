// On-device storage (IndexedDB): notebooks, notes, the revision queue, vault keys and small facts.
// Vault keys are stored as non-extractable CryptoKeys.

const DB_NAME = "cairn";
type StoreName = "notebooks" | "notes" | "queue" | "keys" | "meta";

let opening: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("notebooks", { keyPath: "id" });
      db.createObjectStore("notes", { keyPath: "id" });
      db.createObjectStore("queue", { keyPath: "key" });
      db.createObjectStore("keys");
      db.createObjectStore("meta");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opening;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return database().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = work(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result as T);
    tx.onerror = () => reject(tx.error);
  }));
}

export const readAll = <T>(store: StoreName) => run<T[]>(store, "readonly", (s) => s.getAll());
export const read = <T>(store: StoreName, key: string) => run<T | undefined>(store, "readonly", (s) => s.get(key));
export const write = (store: StoreName, value: unknown, key?: string) => run<IDBValidKey>(store, "readwrite", (s) => s.put(value, key));
export const remove = (store: StoreName, key: string) => run<undefined>(store, "readwrite", (s) => s.delete(key));
