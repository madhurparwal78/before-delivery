import type { AttachmentState, StoredOp } from '../../domain/types.ts';

const DATABASE = 'oddment';
const VERSION = 1;
const OPS = 'ops';
const META = 'meta';
const FILES = 'files';

export type StoredFile = {
  id: string;
  name: string;
  size: number;
  contentType: string;
  state: AttachmentState;
  refusal: 'too-large' | 'account-full' | null;
  bytes: Blob;
};

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OPS)) database.createObjectStore(OPS, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(META)) database.createObjectStore(META);
      if (!database.objectStoreNames.contains(FILES)) database.createObjectStore(FILES, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opening;
}

function finish(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    source.onsuccess = () => resolve(source.result);
    source.onerror = () => reject(source.error);
  });
}

export async function allOps(): Promise<StoredOp[]> {
  const database = await open();
  const transaction = database.transaction(OPS, 'readonly');
  return request(transaction.objectStore(OPS).getAll() as IDBRequest<StoredOp[]>);
}

export async function putOps(ops: StoredOp[]): Promise<void> {
  if (!ops.length) return;
  const database = await open();
  const transaction = database.transaction(OPS, 'readwrite');
  const store = transaction.objectStore(OPS);
  for (const op of ops) store.put(op);
  await finish(transaction);
}

export async function dropOps(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const database = await open();
  const transaction = database.transaction(OPS, 'readwrite');
  const store = transaction.objectStore(OPS);
  for (const id of ids) store.delete(id);
  await finish(transaction);
}

export async function readMeta<T>(key: string): Promise<T | undefined> {
  const database = await open();
  const transaction = database.transaction(META, 'readonly');
  return (await request(transaction.objectStore(META).get(key) as IDBRequest<T>)) ?? undefined;
}

export async function writeMeta(key: string, value: unknown): Promise<void> {
  const database = await open();
  const transaction = database.transaction(META, 'readwrite');
  transaction.objectStore(META).put(value, key);
  await finish(transaction);
}

export async function allFiles(): Promise<StoredFile[]> {
  const database = await open();
  const transaction = database.transaction(FILES, 'readonly');
  return request(transaction.objectStore(FILES).getAll() as IDBRequest<StoredFile[]>);
}

export async function putFile(file: StoredFile): Promise<void> {
  const database = await open();
  const transaction = database.transaction(FILES, 'readwrite');
  transaction.objectStore(FILES).put(file);
  await finish(transaction);
}

