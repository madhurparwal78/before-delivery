import type { LocalLetter } from '../types';

interface StoredKey {
  keyId: string;
  privateKey: CryptoKey;
}

function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    source.onsuccess = () => resolve(source.result);
    source.onerror = () => reject(source.error);
  });
}

/** One IndexedDB per account: the non-extractable keys, the opened letters, the outbox, and small values. */
export async function openAccountDatabase(accountId: string) {
  const opening = indexedDB.open(`airfold-${accountId}`, 1);
  opening.onupgradeneeded = () => {
    const db = opening.result;
    db.createObjectStore('keys', { keyPath: 'keyId' });
    db.createObjectStore('letters', { keyPath: 'id' });
    db.createObjectStore('kv');
    db.createObjectStore('files');
  };
  const db = await request(opening);
  const store = (name: 'keys' | 'letters' | 'kv' | 'files', mode: IDBTransactionMode): IDBObjectStore => db.transaction(name, mode).objectStore(name);
  return {
    keys: await request(store('keys', 'readonly').getAll() as IDBRequest<StoredKey[]>),
    letters: await request(store('letters', 'readonly').getAll() as IDBRequest<LocalLetter[]>),
    async putKey(key: StoredKey) {
      await request(store('keys', 'readwrite').put(key));
    },
    async putLetter(letter: LocalLetter) {
      await request(store('letters', 'readwrite').put(letter));
    },
    async removeLetter(id: string) {
      await request(store('letters', 'readwrite').delete(id));
    },
    getValue: <T>(key: string) => request(store('kv', 'readonly').get(key) as IDBRequest<T | undefined>),
    async setValue(key: string, value: unknown) {
      await request(store('kv', 'readwrite').put(value, key));
    },
    getFile: (letterId: string) => request(store('files', 'readonly').get(letterId) as IDBRequest<Blob | undefined>),
    async setFile(letterId: string, file: Blob) {
      await request(store('files', 'readwrite').put(file, letterId));
    },
    async removeFile(letterId: string) {
      await request(store('files', 'readwrite').delete(letterId));
    },
  };
}

export type AccountDatabase = Awaited<ReturnType<typeof openAccountDatabase>>;
