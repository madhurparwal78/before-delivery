// Browser-side storage: the non-extractable identity key, the outbox and cached letter bodies.
// Everything lives in IndexedDB so it survives reloads. DP-02, DP-13, DP-31.

const DB_NAME = 'airfold';
const DB_VERSION = 1;

export interface StoredIdentity {
  kind: 'identity';
  privateKey: CryptoKey; // non-extractable
  publicKey: string; // raw 65-byte point, base64url
  keyId: string;
  accountId: string;
  username: string;
  profileKey: Uint8Array | null;
}

export interface OutboxLetter {
  kind: 'outbox';
  id: string;
  conversationId: string;
  class: 'letter' | 'control';
  recipientKeyId: string;
  iv: string | null;
  ciphertext: string | null;
  attachmentId: string | null;
  attachmentSealed?: Uint8Array | null; // sealed bytes waiting for upload
  attachmentDeclaredSize?: number;
  attachmentKind?: 'image' | 'file';
  body: string; // the JSON body shape, for resealing on key change
  composedAt: number;
  attempts: number;
  uploadFailed: boolean;
}

export interface LetterBodyRow {
  kind: 'letterBody';
  letterId: string;
  conversationId: string;
  body: string;
}

export interface ProfileCache {
  kind: 'profile';
  accountId: string;
  displayName: string | null;
  photoBlobId: string | null;
}

export interface DeletedForMeRow {
  kind: 'deletedForMe';
  letterId: string;
  conversationId: string;
  deletedAt: number;
}

export interface PeerKeyRow {
  kind: 'peerKey';
  accountId: string;
  privateKey: CryptoKey | null; // an old private key imported for opening held letters
  keyId: string;
}

export interface KeyBackupRow {
  kind: 'keyBackup';
  keyId: string;
  iv: string;
  ciphertext: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('letterBody')) db.createObjectStore('letterBody', { keyPath: 'letterId' });
      if (!db.objectStoreNames.contains('profile')) db.createObjectStore('profile', { keyPath: 'accountId' });
      if (!db.objectStoreNames.contains('deletedForMe')) db.createObjectStore('deletedForMe', { keyPath: 'letterId' });
      if (!db.objectStoreNames.contains('peerKey')) db.createObjectStore('peerKey', { keyPath: 'accountId' });
      if (!db.objectStoreNames.contains('keyBackup')) db.createObjectStore('keyBackup', { keyPath: 'keyId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function readOne<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).get(key) as IDBRequest<T>;
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).getAll() as IDBRequest<T[]>;
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
}

async function writeOne(store: string, action: (objectStore: IDBObjectStore) => void): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    action(tx.objectStore(store));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return readOne<T>('kv', key);
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await writeOne('kv', (store) => { store.put(value, key); });
}

export async function kvDelete(key: string): Promise<void> {
  await writeOne('kv', (store) => { store.delete(key); });
}

export async function putIdentity(identity: StoredIdentity): Promise<void> {
  await kvSet('identity', identity);
}

export async function getIdentity(): Promise<StoredIdentity | undefined> {
  return kvGet<StoredIdentity>('identity');
}

export async function clearIdentity(): Promise<void> {
  await kvDelete('identity');
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['outbox', 'letterBody', 'profile', 'deletedForMe', 'peerKey', 'keyBackup', 'kv'], 'readwrite');
    for (const name of ['outbox', 'letterBody', 'profile', 'deletedForMe', 'peerKey', 'keyBackup']) {
      tx.objectStore(name).clear();
    }
    tx.objectStore('kv').delete('identity');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function outboxAdd(letter: OutboxLetter): Promise<void> {
  await writeOne('outbox', (store) => { store.put(letter); });
}

export async function outboxRemove(id: string): Promise<void> {
  await writeOne('outbox', (store) => { store.delete(id); });
}

export async function outboxAll(): Promise<OutboxLetter[]> {
  const rows = await readAll<OutboxLetter>('outbox');
  return (rows ?? []).sort((a, b) => a.composedAt - b.composedAt);
}

export async function outboxGet(id: string): Promise<OutboxLetter | undefined> {
  return readOne<OutboxLetter>('outbox', id);
}

export async function putLetterBody(row: LetterBodyRow): Promise<void> {
  await writeOne('letterBody', (store) => { store.put(row); });
}

export async function getLetterBody(letterId: string): Promise<LetterBodyRow | undefined> {
  return readOne<LetterBodyRow>('letterBody', letterId);
}

export async function allLetterBodies(): Promise<LetterBodyRow[]> {
  const rows = await readAll<LetterBodyRow>('letterBody');
  return rows ?? [];
}

export async function putProfileCache(row: ProfileCache): Promise<void> {
  await writeOne('profile', (store) => { store.put(row); });
}

export async function getProfileCache(accountId: string): Promise<ProfileCache | undefined> {
  return readOne<ProfileCache>('profile', accountId);
}

export async function addDeletedForMe(row: DeletedForMeRow): Promise<void> {
  await writeOne('deletedForMe', (store) => { store.put(row); });
}

export async function removeDeletedForMe(letterId: string): Promise<void> {
  await writeOne('deletedForMe', (store) => { store.delete(letterId); });
}

export async function getDeletedForMe(letterId: string): Promise<DeletedForMeRow | undefined> {
  return readOne<DeletedForMeRow>('deletedForMe', letterId);
}

export async function allDeletedForMe(): Promise<DeletedForMeRow[]> {
  const rows = await readAll<DeletedForMeRow>('deletedForMe');
  return rows ?? [];
}

export async function putPeerKey(row: PeerKeyRow): Promise<void> {
  await writeOne('peerKey', (store) => { store.put(row); });
}

export async function getPeerKey(accountId: string): Promise<PeerKeyRow | undefined> {
  return readOne<PeerKeyRow>('peerKey', accountId);
}

export async function putKeyBackup(row: KeyBackupRow): Promise<void> {
  await writeOne('keyBackup', (store) => { store.put(row); });
}

export async function allKeyBackups(): Promise<KeyBackupRow[]> {
  const rows = await readAll<KeyBackupRow>('keyBackup');
  return rows ?? [];
}
