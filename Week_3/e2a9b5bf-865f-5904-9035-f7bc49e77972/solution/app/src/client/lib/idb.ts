/** A minimal key-value store over IndexedDB. Writes are best effort: the app keeps working in memory without it. */

const DB_NAME = "lowlamp-field-log";
const STORE = "kv";

let opened: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  opened ??= new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return opened;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve) => {
    const request = db.transaction(STORE).objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => resolve(undefined);
  });
}

export async function kvPut(entries: [string, unknown][]): Promise<void> {
  const db = await open();
  if (!db || entries.length === 0) return;
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  for (const [key, value] of entries) store.put(value, key);
  await done(tx);
}

export async function kvDelete(keys: string[]): Promise<void> {
  const db = await open();
  if (!db || keys.length === 0) return;
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  for (const key of keys) store.delete(key);
  await done(tx);
}

export async function kvRange(prefix: string): Promise<[string, unknown][]> {
  const db = await open();
  if (!db) return [];
  return new Promise((resolve) => {
    const found: [string, unknown][] = [];
    const request = db
      .transaction(STORE)
      .objectStore(STORE)
      .openCursor(IDBKeyRange.bound(prefix, `${prefix}￿`));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve(found);
      found.push([String(cursor.key), cursor.value]);
      cursor.continue();
    };
    request.onerror = () => resolve(found);
  });
}
