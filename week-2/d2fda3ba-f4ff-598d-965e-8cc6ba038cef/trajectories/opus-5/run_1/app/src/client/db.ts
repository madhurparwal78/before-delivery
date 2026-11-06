export interface StoredNote {
  id: string;
  notebookId: string;
  title: string;
  aliases: string[];
  frontmatter: Record<string, unknown>;
  body: string;
  private: boolean;
  updatedAt: number;
  serverRev: number | null;
  badge: string;
  rejection: string | null;
  conflictNotice: boolean;
  conflictCopyId: string | null;
  isConflictCopy: boolean;
}

export interface StoredNotebook {
  id: string;
  name: string;
  vaultId: string | null;
  role: 'owner' | 'partner' | null;
  cursor: number;
}

export interface StoredQueueItem {
  id: string;
  vaultId: string;
  notebookId: string;
  noteId: string;
  baseRevision: number | null;
  plaintext: {
    title: string;
    aliases: string[];
    frontmatter: Record<string, unknown>;
    body: string;
    private: boolean;
  };
  idempotencyKey: string;
  createdAt: number;
}

const DB_NAME = 'cairn';
const DB_VERSION = 1;
const STORES = ['notes', 'notebooks', 'queue', 'meta'] as const;
type StoreName = (typeof STORES)[number];

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, store === 'meta' ? { keyPath: 'key' } : { keyPath: 'id' });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb unavailable'));
  });
}

function run<T>(store: StoreName, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = work(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('indexeddb write failed'));
        transaction.oncomplete = () => db.close();
      }),
  );
}

/** The device's own copy of the notebook. Everything here survives reloads with the network off. */
export const localStore = {
  notes: {
    all: (): Promise<StoredNote[]> => run('notes', 'readonly', (store) => store.getAll() as IDBRequest<StoredNote[]>),
    put: (note: StoredNote): Promise<IDBValidKey> => run('notes', 'readwrite', (store) => store.put(note)),
    remove: (id: string): Promise<undefined> => run('notes', 'readwrite', (store) => store.delete(id)),
  },
  notebooks: {
    all: (): Promise<StoredNotebook[]> =>
      run('notebooks', 'readonly', (store) => store.getAll() as IDBRequest<StoredNotebook[]>),
    put: (notebook: StoredNotebook): Promise<IDBValidKey> =>
      run('notebooks', 'readwrite', (store) => store.put(notebook)),
  },
  queue: {
    all: (): Promise<StoredQueueItem[]> =>
      run('queue', 'readonly', (store) => store.getAll() as IDBRequest<StoredQueueItem[]>),
    put: (item: StoredQueueItem): Promise<IDBValidKey> => run('queue', 'readwrite', (store) => store.put(item)),
    remove: (id: string): Promise<undefined> => run('queue', 'readwrite', (store) => store.delete(id)),
  },
  meta: {
    get: async <T>(key: string): Promise<T | null> => {
      const row = await run<{ key: string; value: T } | undefined>('meta', 'readonly', (store) => store.get(key));
      return row ? row.value : null;
    },
    set: <T>(key: string, value: T): Promise<IDBValidKey> =>
      run('meta', 'readwrite', (store) => store.put({ key, value })),
  },
};
