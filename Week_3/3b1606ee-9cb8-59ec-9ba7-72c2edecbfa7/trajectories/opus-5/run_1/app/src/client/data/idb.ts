/** The browser's own store: identity keys, opened letters, the outbox and preferences. */

const DB_NAME = 'airfold';
const DB_VERSION = 1;

export const STORES = {
  identity: 'identity',
  privateKeys: 'private_keys',
  profileKeys: 'profile_keys',
  letters: 'letters',
  outbox: 'outbox',
  prefs: 'prefs',
} as const;

let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(STORES.identity);
      db.createObjectStore(STORES.privateKeys);
      db.createObjectStore(STORES.profileKeys);
      const letters = db.createObjectStore(STORES.letters, { keyPath: 'id' });
      letters.createIndex('conversation', 'conversationId');
      const outbox = db.createObjectStore(STORES.outbox, { keyPath: 'id' });
      outbox.createIndex('order', 'order');
      db.createObjectStore(STORES.prefs);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function db(): Promise<IDBDatabase> {
  database ??= openDatabase();
  return database;
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return db().then(
    (connection) =>
      new Promise<T>((resolve, reject) => {
        const transaction = connection.transaction(store, mode);
        const request = action(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export function idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  return run<T | undefined>(store, 'readonly', (objectStore) => objectStore.get(key));
}

export function idbPut<T>(store: string, value: T, key?: IDBValidKey): Promise<IDBValidKey> {
  return run(store, 'readwrite', (objectStore) =>
    key === undefined ? objectStore.put(value) : objectStore.put(value, key),
  );
}

export function idbDelete(store: string, key: IDBValidKey): Promise<undefined> {
  return run(store, 'readwrite', (objectStore) => objectStore.delete(key));
}

export function idbAll<T>(store: string): Promise<T[]> {
  return run<T[]>(store, 'readonly', (objectStore) => objectStore.getAll());
}
