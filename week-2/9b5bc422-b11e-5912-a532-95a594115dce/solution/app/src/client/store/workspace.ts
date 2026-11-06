import { useSyncExternalStore } from "react";
import type { ChangeMode, FieldValue, RecordKind } from "../../shared/sync.ts";
import { byOrder } from "../domain/order.ts";
import { seedRecords } from "../domain/seed.ts";
import { today } from "../domain/dates.ts";
import type { Column, RecordFields, SyncMeta, WorkspaceRecord } from "../domain/types.ts";
import { recordKey } from "../domain/types.ts";
import type { AccountSession, DeviceMeta } from "./deviceStore.ts";
import { deviceDatabase, loadDevice, saveMeta, saveRecords } from "./deviceStore.ts";

type TabMessage =
  | { type: "records"; records: WorkspaceRecord[]; removed: string[] }
  | { type: "meta"; meta: DeviceMeta };

const tabs = new BroadcastChannel("oddment");
const records = new Map<string, WorkspaceRecord>();
const listeners = new Set<() => void>();
let meta: DeviceMeta;
let version = 0;
let database: IDBDatabase;
let lastStamp = 0;
let writesInFlight = 0;

const durableListeners = new Set<(fromThisTab: boolean) => void>();
export const onDurable = (listener: (fromThisTab: boolean) => void): void => void durableListeners.add(listener);

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export const subscribeWorkspace = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useWorkspace = (): number => useSyncExternalStore(subscribeWorkspace, () => version);

/** Later than any stamp this device has given, so changes made in one clock tick still order. */
export function stamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

export const newId = (): string => crypto.randomUUID();

export async function loadWorkspace(): Promise<void> {
  const loaded = await loadDevice(() => seedRecords(Date.now(), today()));
  database = await deviceDatabase();
  meta = loaded.meta;
  for (const record of loaded.records) records.set(recordKey(record.kind, record.id), record);
  tabs.onmessage = (event: MessageEvent<TabMessage>) => {
    const message = event.data;
    if (message.type === "meta") {
      meta = message.meta;
    } else {
      for (const record of message.records) records.set(recordKey(record.kind, record.id), record);
      for (const key of message.removed) records.delete(key);
      for (const listener of removalListeners) listener(message.removed);
    }
    changed();
    if (message.type === "records") for (const listener of durableListeners) listener(false);
  };
}

const removalListeners = new Set<(keys: readonly string[]) => void>();
export const onRemoved = (listener: (keys: readonly string[]) => void): void => void removalListeners.add(listener);

/** The one write path: memory now, device storage in this same task, other tabs once durable. */
export function commit(updated: readonly WorkspaceRecord[], removed: readonly string[] = []): void {
  for (const record of updated) records.set(recordKey(record.kind, record.id), record);
  for (const key of removed) records.delete(key);
  writesInFlight += 1;
  const saved = saveRecords(database, updated, removed);
  changed();
  for (const listener of removalListeners) listener(removed);
  void saved.then(() => {
    writesInFlight -= 1;
    tabs.postMessage({ type: "records", records: [...updated], removed: [...removed] } satisfies TabMessage);
    changed();
    for (const listener of durableListeners) listener(true);
  });
}

export const allSaved = (): boolean => writesInFlight === 0;

export const getMeta = (): DeviceMeta => meta;

export function setMeta(next: DeviceMeta): void {
  meta = next;
  void saveMeta(next);
  tabs.postMessage({ type: "meta", meta: next } satisfies TabMessage);
  changed();
}

export const session = (): AccountSession | null => meta.session;

/** Syncing is on: signed in and having chosen to upload. */
export function isSyncing(): boolean {
  return meta.session !== null && meta.choices[meta.session.user.id] === "upload";
}

export const allRecords = (): IterableIterator<WorkspaceRecord> => records.values();

const isAttachment = (record: WorkspaceRecord): record is WorkspaceRecord<"attachment"> => record.kind === "attachment";

export const attachmentsOf = (documentId: string): WorkspaceRecord<"attachment">[] =>
  [...records.values()].filter(isAttachment).filter((attachment) => attachment.fields.documentId === documentId);

export const isWaitingAttachment = (record: WorkspaceRecord): record is WorkspaceRecord<"attachment"> => isAttachment(record) && record.fields.state === "waiting";

export const waitingAttachments = (): WorkspaceRecord<"attachment">[] => [...records.values()].filter(isWaitingAttachment);

export function getRecord<K extends RecordKind>(kind: K, id: string): WorkspaceRecord<K> | undefined {
  return records.get(recordKey(kind, id)) as WorkspaceRecord<K> | undefined;
}

const STRONGER_MODE: Record<ChangeMode, number> = { create: 0, slot: 1, edit: 2, pick: 2 };

const emptySync = (): SyncMeta => ({ versions: {}, dirty: {}, bothKept: {}, uploading: false });

/** A brand-new record: every field a change waiting for the account. */
export function newRecord<K extends RecordKind>(kind: K, id: string, fields: RecordFields[K]): WorkspaceRecord {
  const dirty = Object.fromEntries(Object.keys(fields).map((name) => [name, "edit" as const]));
  return { kind, id, fields, sync: { ...emptySync(), dirty } } as WorkspaceRecord;
}

/** A copy of `record` with `patch` applied and each truly changed field marked with `mode`. */
export function patched<K extends RecordKind>(record: WorkspaceRecord<K>, patch: Partial<RecordFields[K]>, mode: ChangeMode = "edit"): WorkspaceRecord<K> {
  const current = record.fields as Record<string, FieldValue>;
  const dirty = { ...record.sync.dirty };
  for (const [name, value] of Object.entries(patch)) {
    if (JSON.stringify(current[name]) === JSON.stringify(value)) continue;
    const held = dirty[name];
    if (!held || STRONGER_MODE[mode] >= STRONGER_MODE[held]) dirty[name] = mode;
  }
  return { ...record, fields: { ...record.fields, ...patch }, sync: { ...record.sync, dirty } };
}

type Index = {
  documents: WorkspaceRecord<"document">[];
  blocks: Map<string, WorkspaceRecord<"block">[]>;
  notes: Map<string, WorkspaceRecord<"note">[]>;
  connectors: Map<string, WorkspaceRecord<"connector">[]>;
  tables: WorkspaceRecord<"table">[];
  rows: Map<string, WorkspaceRecord<"row">[]>;
};

let index: Index = { documents: [], blocks: new Map(), notes: new Map(), connectors: new Map(), tables: [], rows: new Map() };
let indexVersion = -1;

const push = <T,>(map: Map<string, T[]>, key: string, value: T): void => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

function currentIndex(): Index {
  if (indexVersion === version) return index;
  const next: Index = { documents: [], blocks: new Map(), notes: new Map(), connectors: new Map(), tables: [], rows: new Map() };
  for (const record of records.values()) {
    if (record.kind === "document" && !record.fields.deletedForever) next.documents.push(record);
    else if (record.kind === "block" && !record.fields.deleted) push(next.blocks, record.fields.documentId, record);
    else if (record.kind === "note" && !record.fields.deleted) push(next.notes, record.fields.documentId, record);
    else if (record.kind === "connector" && !record.fields.deleted) push(next.connectors, record.fields.documentId, record);
    else if (record.kind === "table") next.tables.push(record);
    else if (record.kind === "row" && !record.fields.deleted) push(next.rows, record.fields.tableId, record);
  }
  for (const list of next.blocks.values()) list.sort(byOrder);
  for (const list of next.rows.values()) list.sort(byOrder);
  for (const list of next.notes.values()) list.sort((a, b) => a.fields.createdAt - b.fields.createdAt || (a.id < b.id ? -1 : 1));
  index = next;
  indexVersion = version;
  return next;
}

export const blocksOf = (documentId: string): WorkspaceRecord<"block">[] => currentIndex().blocks.get(documentId) ?? [];
export const notesOf = (documentId: string): WorkspaceRecord<"note">[] => currentIndex().notes.get(documentId) ?? [];
export const connectorsOf = (documentId: string): WorkspaceRecord<"connector">[] => currentIndex().connectors.get(documentId) ?? [];
export const tables = (): WorkspaceRecord<"table">[] => currentIndex().tables;
export const rowsOf = (tableId: string): WorkspaceRecord<"row">[] => currentIndex().rows.get(tableId) ?? [];
export const liveDocuments = (): WorkspaceRecord<"document">[] => currentIndex().documents;

/** Most recent content change on a document, from its own details and its blocks. */
export function lastChanged(document: WorkspaceRecord<"document">): number {
  return Math.max(document.fields.updatedAt, ...blocksOf(document.id).map((block) => block.fields.updatedAt));
}

/** A document the list counts: not a journal note, not in trash, not deleted forever. */
export const isListed = ({ fields }: WorkspaceRecord<"document">): boolean =>
  fields.journalDate === null && fields.trashedAt === null && !fields.deletedForever;

export function listedDocuments(): WorkspaceRecord<"document">[] {
  return liveDocuments()
    .filter(isListed)
    .map((document) => ({ document, changed: lastChanged(document) }))
    .sort((a, b) => b.changed - a.changed || a.document.fields.seedOrder - b.document.fields.seedOrder)
    .map(({ document }) => document);
}

type TrashedDocument = { document: WorkspaceRecord<"document">; trashedAt: number };

export const trashedDocuments = (): TrashedDocument[] =>
  liveDocuments()
    .flatMap((document) => (document.fields.trashedAt === null ? [] : [{ document, trashedAt: document.fields.trashedAt }]))
    .sort((a, b) => b.trashedAt - a.trashedAt);

export function columnsOf(table: WorkspaceRecord<"table">): Column[] {
  return Object.entries(table.fields)
    .filter(([name]) => name.startsWith("column:"))
    .map(([name, column]) => ({ ...(column as Column), id: name.slice("column:".length) }))
    .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));
}

export function cellsOf(row: WorkspaceRecord<"row">): { id: string; cells: Record<string, string | number | boolean | null> } {
  const cells: Record<string, string | number | boolean | null> = {};
  for (const [name, value] of Object.entries(row.fields)) {
    if (name.startsWith("cell:")) cells[name.slice("cell:".length)] = value as string | number | boolean | null;
  }
  return { id: row.id, cells };
}

export const isDirty = (record: WorkspaceRecord): boolean => Object.keys(record.sync.dirty).length > 0;

/** `<n>` of the published `<count>`: records with changes not yet on the account. */
export function waitingCount(): number {
  let count = 0;
  for (const record of records.values()) {
    if (record.kind === "attachment" && record.fields.state === "refused") continue;
    if (isDirty(record) || record.sync.uploading) count += 1;
  }
  return count;
}

type DocumentState = "On this device" | "Waiting to sync" | "Synced";

/** The Document change state of one document. */
export function documentState(documentId: string): DocumentState {
  const document = getRecord("document", documentId);
  if (!isSyncing() || !allSaved() || !document) return "On this device";
  const held = [document, ...blocksOf(documentId), ...notesOf(documentId), ...connectorsOf(documentId)];
  return held.some(isDirty) ? "Waiting to sync" : "Synced";
}

export const hasNotch = (record: WorkspaceRecord): boolean => isSyncing() && isDirty(record);
