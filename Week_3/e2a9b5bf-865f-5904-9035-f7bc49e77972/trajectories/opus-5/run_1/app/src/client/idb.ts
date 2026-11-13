/**
 * The device's own store. Everything an account keeps for offline use lives
 * under that account's id, so another account signing in sees none of it.
 */
const DB_NAME = 'lowlamp';
const DB_VERSION = 1;

export const STORE_CACHE = 'cache';
export const STORE_JOURNAL = 'journal';
export const STORE_DRAFTS = 'drafts';
export const STORE_META = 'meta';

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_CACHE)) db.createObjectStore(STORE_CACHE);
      if (!db.objectStoreNames.contains(STORE_JOURNAL)) {
        const journal = db.createObjectStore(STORE_JOURNAL, { keyPath: 'client_op_id' });
        journal.createIndex('order', ['account_id', 'seq']);
      }
      if (!db.objectStoreNames.contains(STORE_DRAFTS)) db.createObjectStore(STORE_DRAFTS);
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb refused to open'));
  });
  return opening;
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb request failed'));
  });
}

export async function put(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  const db = await open();
  const transaction = db.transaction(store, 'readwrite');
  await wrap(key === undefined
    ? transaction.objectStore(store).put(value)
    : transaction.objectStore(store).put(value, key));
}

export async function get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await open();
  return wrap<T | undefined>(db.transaction(store, 'readonly').objectStore(store).get(key) as IDBRequest<T | undefined>);
}

export async function remove(store: string, key: IDBValidKey): Promise<void> {
  const db = await open();
  await wrap(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}

export async function all<T>(store: string): Promise<T[]> {
  const db = await open();
  return wrap<T[]>(db.transaction(store, 'readonly').objectStore(store).getAll() as IDBRequest<T[]>);
}

export async function keys(store: string): Promise<IDBValidKey[]> {
  const db = await open();
  return wrap<IDBValidKey[]>(
    db.transaction(store, 'readonly').objectStore(store).getAllKeys() as IDBRequest<IDBValidKey[]>,
  );
}
