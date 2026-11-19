import type { EntryFields } from "../../shared/api";

// What the logbook keeps on this device until the server acknowledges it: entries and voice memos, in IndexedDB,
// so they survive a reload and a closed tab.

export interface KeptMemo {
  blob: Blob;
  type: string;
  durationMs: number;
}

export interface KeptEntry {
  id: string;
  owner: string;
  order: number;
  fields: EntryFields;
  /** The rejection line once the server refused it; a rejected entry is never sent again. */
  rejection: string | null;
  memo: KeptMemo | null;
}

/** A memo whose entry is saved but whose bytes have not reached storage yet. */
export interface PendingMemo extends KeptMemo {
  entryId: string;
  owner: string;
}

const DATABASE = "lanternfish-device";
const ENTRIES = "kept-entries";
const MEMOS = "pending-memos";

let opened: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(ENTRIES, { keyPath: "id" });
      request.result.createObjectStore(MEMOS, { keyPath: "entryId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opened;
}

function settle<T>(request: IDBRequest<T>, transaction: IDBTransaction): Promise<T> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, work: (objects: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const transaction = (await database()).transaction(store, mode);
  return settle(work(transaction.objectStore(store)), transaction);
}

export async function keptEntries(owner: string): Promise<KeptEntry[]> {
  const all: KeptEntry[] = await run(ENTRIES, "readonly", (objects) => objects.getAll());
  return all.filter((entry) => entry.owner === owner).sort((a, b) => a.order - b.order);
}

export const keepEntry = (entry: KeptEntry): Promise<IDBValidKey> => run(ENTRIES, "readwrite", (objects) => objects.put(entry));
export const forgetEntry = (id: string): Promise<undefined> => run(ENTRIES, "readwrite", (objects) => objects.delete(id));

export async function pendingMemos(owner: string): Promise<PendingMemo[]> {
  const all: PendingMemo[] = await run(MEMOS, "readonly", (objects) => objects.getAll());
  return all.filter((memo) => memo.owner === owner);
}

export const keepMemo = (memo: PendingMemo): Promise<IDBValidKey> => run(MEMOS, "readwrite", (objects) => objects.put(memo));
export const forgetMemo = (entryId: string): Promise<undefined> => run(MEMOS, "readwrite", (objects) => objects.delete(entryId));
