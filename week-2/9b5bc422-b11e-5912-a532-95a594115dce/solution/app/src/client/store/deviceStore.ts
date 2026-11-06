import type { WorkspaceRecord } from "../domain/types.ts";
import { recordKey } from "../domain/types.ts";

export type AccountSession = { user: { id: string; email: string }; device: { id: string; name: string } };
export type UploadChoice = "upload" | "keep";

export type DeviceMeta = {
  session: AccountSession | null;
  choices: Record<string, UploadChoice>;
  cursors: Record<string, number>;
  uploadPending: boolean;
  notices: string[];
};

const NAME = "oddment";
const RECORDS = "records";
const META = "meta";
const FILES = "files";
const META_KEY = "device";

const EMPTY_META: DeviceMeta = { session: null, choices: {}, cursors: {}, uploadPending: false, notices: [] };

function asPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function open(): Promise<IDBDatabase> {
  const request = indexedDB.open(NAME, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(RECORDS);
    request.result.createObjectStore(META);
    request.result.createObjectStore(FILES);
  };
  return asPromise(request);
}

let opened: Promise<IDBDatabase> | null = null;

/** Opened on first use, so a link reader's browser never gets a workspace database. */
export function deviceDatabase(): Promise<IDBDatabase> {
  opened ??= open();
  return opened;
}

type LoadedDevice = { records: WorkspaceRecord[]; meta: DeviceMeta };

/** Reads the device's workspace, creating the starter workspace once in the same transaction. */
export async function loadDevice(makeSeed: () => WorkspaceRecord[]): Promise<LoadedDevice> {
  const db = await deviceDatabase();
  const tx = db.transaction([RECORDS, META], "readwrite");
  const records = tx.objectStore(RECORDS);
  const meta = tx.objectStore(META);
  const stored = await asPromise(meta.get(META_KEY) as IDBRequest<DeviceMeta | undefined>);
  if (!stored) {
    for (const record of makeSeed()) records.put(record, recordKey(record.kind, record.id));
    meta.put(EMPTY_META, META_KEY);
  }
  const all = await asPromise(records.getAll() as IDBRequest<WorkspaceRecord[]>);
  return { records: all, meta: stored ?? EMPTY_META };
}

/** Writes records in the calling task and resolves once they are durable. */
export function saveRecords(db: IDBDatabase, records: readonly WorkspaceRecord[], removed: readonly string[]): Promise<void> {
  const tx = db.transaction(RECORDS, "readwrite");
  const store = tx.objectStore(RECORDS);
  for (const record of records) store.put(record, recordKey(record.kind, record.id));
  for (const key of removed) store.delete(key);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveMeta(meta: DeviceMeta): Promise<void> {
  const db = await deviceDatabase();
  db.transaction(META, "readwrite").objectStore(META).put(meta, META_KEY);
}

export async function saveFile(id: string, file: Blob): Promise<void> {
  const db = await deviceDatabase();
  await asPromise(db.transaction(FILES, "readwrite").objectStore(FILES).put(file, id));
}

export async function readFile(id: string): Promise<Blob | undefined> {
  const db = await deviceDatabase();
  return asPromise(db.transaction(FILES).objectStore(FILES).get(id) as IDBRequest<Blob | undefined>);
}

export async function removeFile(id: string): Promise<void> {
  const db = await deviceDatabase();
  await asPromise(db.transaction(FILES, "readwrite").objectStore(FILES).delete(id));
}
