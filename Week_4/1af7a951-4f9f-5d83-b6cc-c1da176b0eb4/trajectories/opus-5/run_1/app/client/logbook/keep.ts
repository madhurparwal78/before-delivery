import type { Technique } from '../api.js';

const ENTRIES_KEY = 'lf.kept.entries';
const DB_NAME = 'lanternfish';
const MEMO_STORE = 'memos';

export interface KeptEntry {
  id: string;
  enrollmentId: string;
  title: string;
  text: string;
  dreamsRecalled: number;
  lucid: boolean;
  wbtb: boolean;
  technique: Technique;
  techniqueMinutes: number;
  rejectedReason: string | null;
  writtenAt: number;
  nightKey: string;
  hasMemo: boolean;
}

export interface KeptMemo {
  entryId: string;
  enrollmentId: string;
  blob: Blob;
  durationMs: number;
}

function isKeptEntry(value: unknown): value is KeptEntry {
  if (typeof value !== 'object' || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return typeof record['id'] === 'string' && typeof record['enrollmentId'] === 'string';
}

function readAll(): KeptEntry[] {
  const raw = localStorage.getItem(ENTRIES_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isKeptEntry);
  } catch {
    return [];
  }
}

function writeAll(entries: readonly KeptEntry[]): void {
  localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries));
}

export function keptEntriesOf(enrollmentId: string): KeptEntry[] {
  return readAll()
    .filter((entry) => entry.enrollmentId === enrollmentId)
    .sort((left, right) => left.writtenAt - right.writtenAt);
}

export function putKeptEntry(entry: KeptEntry): void {
  const all = readAll().filter((candidate) => candidate.id !== entry.id);
  all.push(entry);
  writeAll(all);
}

export function rejectKeptEntry(id: string, reason: string): void {
  writeAll(
    readAll().map((entry) => (entry.id === id ? { ...entry, rejectedReason: reason } : entry)),
  );
}

export function removeKeptEntry(id: string): void {
  writeAll(readAll().filter((entry) => entry.id !== id));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MEMO_STORE)) {
        db.createObjectStore(MEMO_STORE, { keyPath: 'entryId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(MEMO_STORE, mode);
    const request = run(transaction.objectStore(MEMO_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function isKeptMemo(value: unknown): value is KeptMemo {
  if (typeof value !== 'object' || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return (
    typeof record['entryId'] === 'string' &&
    typeof record['enrollmentId'] === 'string' &&
    record['blob'] instanceof Blob &&
    typeof record['durationMs'] === 'number'
  );
}

export async function putKeptMemo(memo: KeptMemo): Promise<void> {
  await withStore('readwrite', (store) => store.put(memo));
}

export async function keptMemo(entryId: string): Promise<KeptMemo | null> {
  const found: unknown = await withStore('readonly', (store) => store.get(entryId));
  return isKeptMemo(found) ? found : null;
}

export async function keptMemosOf(enrollmentId: string): Promise<KeptMemo[]> {
  const found: unknown = await withStore('readonly', (store) => store.getAll());
  if (!Array.isArray(found)) return [];
  return found.filter(isKeptMemo).filter((memo) => memo.enrollmentId === enrollmentId);
}

export async function removeKeptMemo(entryId: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(entryId));
}
