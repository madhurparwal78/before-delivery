const DB_NAME = 'lintel-drive';
const STORE = 'upload-bytes';

const open = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const run = async <T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const database = await open();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE, mode);
    const request = work(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/** The browser keeps the chosen file's bytes while an upload is unfinished. */
export const keepBytes = (key: string, blob: Blob): Promise<IDBValidKey> =>
  run('readwrite', (store) => store.put(blob, key));

export const takeBytes = async (key: string): Promise<Blob | null> => {
  const value = await run<Blob | undefined>('readonly', (store) => store.get(key));
  return value ?? null;
};

export const dropBytes = (key: string): Promise<undefined> =>
  run('readwrite', (store) => store.delete(key));
