import { call } from './api.js';

interface QueuedReading {
  readonly operationId: string;
  readonly siteId: string;
  readonly cell: string;
  readonly value: { readonly text: string; readonly unit: string };
  readonly capturedAt: string;
  state: 'waiting' | 'rejected';
  errors?: Record<string, string>;
}

export interface SyncState {
  readonly waiting: number;
  readonly needsFixing: number;
  readonly sending: boolean;
}

const DATABASE = 'gevelwerk-readings';
const STORE = 'operations';
const BATCH = 500;

let database: Promise<IDBDatabase> | null = null;
const watchers = new Set<(state: SyncState) => void>();
let sending = false;
let lastRejection: QueuedReading | null = null;

function open(): Promise<IDBDatabase> {
  if (database !== null) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'operationId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}

async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const open_ = await open();
  return new Promise((resolve, reject) => {
    const transaction = open_.transaction(STORE, mode);
    const request = work(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

export async function readQueue(): Promise<QueuedReading[]> {
  return withStore<QueuedReading[]>('readonly', (store) => store.getAll());
}

export async function enqueue(reading: Omit<QueuedReading, 'state'>): Promise<void> {
  await withStore('readwrite', (store) => store.put({ ...reading, state: 'waiting' }));
  await announce();
  void sync();
}

export async function dropOperation(operationId: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(operationId));
  await announce();
}

export function watchSync(watcher: (state: SyncState) => void): () => void {
  watchers.add(watcher);
  void announce();
  return () => watchers.delete(watcher);
}

export function lastRejected(): QueuedReading | null {
  return lastRejection;
}

async function announce(): Promise<void> {
  const queued = await readQueue();
  const state: SyncState = {
    waiting: queued.filter((entry) => entry.state === 'waiting').length,
    needsFixing: queued.filter((entry) => entry.state === 'rejected').length,
    sending,
  };
  for (const watcher of [...watchers]) watcher(state);
}

interface SyncResult {
  readonly operationId: string;
  readonly status: 'applied' | 'duplicate' | 'rejected' | 'conflict';
  readonly code?: string;
  readonly errors?: Record<string, string>;
}

/** Sends the queue; the count falls only on the server's acknowledgement. */
export async function sync(): Promise<void> {
  if (sending) return;
  const queued = (await readQueue()).filter((entry) => entry.state === 'waiting');
  if (queued.length === 0) {
    await announce();
    return;
  }
  sending = true;
  await announce();
  try {
    const sites = new Map<string, QueuedReading[]>();
    for (const entry of queued) {
      sites.set(entry.siteId, [...(sites.get(entry.siteId) ?? []), entry]);
    }
    for (const [siteId, entries] of sites) {
      for (let start = 0; start < entries.length; start += BATCH) {
        const batch = entries.slice(start, start + BATCH);
        const answer = await call<{ results: SyncResult[] }>(`/api/sites/${siteId}/readings/sync`, {
          method: 'POST',
          body: {
            operations: batch.map((entry) => ({
              operationId: entry.operationId,
              cell: entry.cell,
              value: entry.value,
              capturedAt: entry.capturedAt,
            })),
          },
        });
        for (const result of answer.results) {
          const entry = batch.find((candidate) => candidate.operationId === result.operationId);
          if (entry === undefined) continue;
          if (result.status === 'applied' || result.status === 'duplicate') {
            await withStore('readwrite', (store) => store.delete(entry.operationId));
            continue;
          }
          lastRejection = { ...entry, state: 'rejected', errors: result.errors ?? {} };
          await withStore('readwrite', (store) => store.put(lastRejection as QueuedReading));
        }
      }
    }
  } catch {
    // No signal or no records: the queue keeps every operation for the next try.
  } finally {
    sending = false;
    await announce();
  }
}

window.addEventListener('online', () => void sync());
setInterval(() => void sync(), 15_000);
