// Device storage: IndexedDB. Every edit is written here before the interface
// confirms it, and it survives reloads and offline use.
import type { Block, Column, Connector, DocumentMeta, Note, Row, TableMeta } from '../../shared/domain';

const DB_NAME = 'oddment';
const DB_VERSION = 1;

export interface AttachmentRecord {
  id: string;
  documentId: string;
  blockId: string;
  name: string;
  size: number;
  contentType: string;
  state: 'waiting' | 'stored' | 'refused';
  bytes?: Blob;
}

export interface SyncMeta {
  id: string;
  value: unknown;
}

export interface RecordVersion {
  id: string;
  version: number;
}

export interface OutboxEntry {
  changeId: string;
  kind: string;
  recordId: string;
  documentId: string | null;
  deleted: boolean;
  payload: unknown;
  baseVersion: number | null;
}

const STORES = ['documents', 'blocks', 'notes', 'connectors', 'tables', 'columns', 'rows', 'attachments', 'meta', 'versions', 'outbox'] as const;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'id' });
        }
      }
      // versions is keyed by recordId
      if (db.objectStoreNames.contains('versions')) {
        // created with keyPath id above; recreate is not possible, so use it as is
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const request = fn(t.objectStore(store));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      })
  );
}

// -- documents

export async function getDocuments(): Promise<DocumentMeta[]> {
  return tx<DocumentMeta[]>('documents', 'readonly', (s) => s.getAll());
}

export async function putDocument(doc: DocumentMeta): Promise<void> {
  await tx('documents', 'readwrite', (s) => s.put(doc));
}

export async function deleteDocument(id: string): Promise<void> {
  await tx('documents', 'readwrite', (s) => s.delete(id));
}

// -- blocks

export async function getBlocks(documentId?: string): Promise<Block[]> {
  const all = await tx<Block[]>('blocks', 'readonly', (s) => s.getAll());
  return documentId ? all.filter((b) => b.documentId === documentId) : all;
}

export async function putBlock(b: Block): Promise<void> {
  await tx('blocks', 'readwrite', (s) => s.put(b));
}

export async function putBlocks(bs: Block[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction('blocks', 'readwrite');
    const s = t.objectStore('blocks');
    for (const b of bs) s.put(b);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function deleteBlock(id: string): Promise<void> {
  await tx('blocks', 'readwrite', (s) => s.delete(id));
}

// -- notes, connectors

export async function getNotes(documentId?: string): Promise<Note[]> {
  const all = await tx<Note[]>('notes', 'readonly', (s) => s.getAll());
  return documentId ? all.filter((n) => n.documentId === documentId) : all;
}

export async function putNote(n: Note): Promise<void> {
  await tx('notes', 'readwrite', (s) => s.put(n));
}

export async function deleteNote(id: string): Promise<void> {
  await tx('notes', 'readwrite', (s) => s.delete(id));
}

export async function getConnectors(documentId?: string): Promise<Connector[]> {
  const all = await tx<Connector[]>('connectors', 'readonly', (s) => s.getAll());
  return documentId ? all.filter((c) => c.documentId === documentId) : all;
}

export async function putConnector(c: Connector): Promise<void> {
  await tx('connectors', 'readwrite', (s) => s.put(c));
}

export async function deleteConnector(id: string): Promise<void> {
  await tx('connectors', 'readwrite', (s) => s.delete(id));
}

// -- tables

export async function getTables(): Promise<TableMeta[]> {
  return tx<TableMeta[]>('tables', 'readonly', (s) => s.getAll());
}

export async function putTable(t: TableMeta): Promise<void> {
  await tx('tables', 'readwrite', (s) => s.put(t));
}

export async function getColumns(tableId?: string): Promise<Column[]> {
  const all = await tx<Column[]>('columns', 'readonly', (s) => s.getAll());
  return tableId ? all.filter((c) => c.tableId === tableId) : all;
}

export async function putColumn(c: Column): Promise<void> {
  await tx('columns', 'readwrite', (s) => s.put(c));
}

export async function deleteColumn(id: string): Promise<void> {
  await tx('columns', 'readwrite', (s) => s.delete(id));
}

export async function getRows(tableId?: string): Promise<Row[]> {
  const all = await tx<Row[]>('rows', 'readonly', (s) => s.getAll());
  return tableId ? all.filter((r) => r.tableId === tableId) : all;
}

export async function putRow(r: Row): Promise<void> {
  await tx('rows', 'readwrite', (s) => s.put(r));
}

export async function deleteRow(id: string): Promise<void> {
  await tx('rows', 'readwrite', (s) => s.delete(id));
}

// -- attachments

export async function getAttachments(): Promise<AttachmentRecord[]> {
  return tx<AttachmentRecord[]>('attachments', 'readonly', (s) => s.getAll());
}

export async function putAttachment(a: AttachmentRecord): Promise<void> {
  await tx('attachments', 'readwrite', (s) => s.put(a));
}

export async function deleteAttachment(id: string): Promise<void> {
  await tx('attachments', 'readwrite', (s) => s.delete(id));
}

// -- meta (settings that stay on this device)

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await tx<SyncMeta | undefined>('meta', 'readonly', (s) => s.get(key));
  return row ? (row.value as T) : fallback;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await tx('meta', 'readwrite', (s) => s.put({ id: key, value }));
}

// -- record versions (last version of each record the account confirmed)

export async function getVersion(recordId: string): Promise<number> {
  const row = await tx<RecordVersion | undefined>('versions', 'readonly', (s) => s.get(recordId));
  return row ? row.version : 0;
}

export async function getVersions(): Promise<RecordVersion[]> {
  return tx<RecordVersion[]>('versions', 'readonly', (s) => s.getAll());
}

export async function setVersion(recordId: string, version: number): Promise<void> {
  await tx('versions', 'readwrite', (s) => s.put({ id: recordId, version }));
}

// -- outbox (changes waiting to leave the device)

export async function getOutbox(): Promise<OutboxEntry[]> {
  return tx<OutboxEntry[]>('outbox', 'readonly', (s) => s.getAll());
}

export async function putOutbox(entry: OutboxEntry): Promise<void> {
  await tx('outbox', 'readwrite', (s) => s.put({ ...entry, id: entry.changeId }));
}

export async function deleteOutbox(changeId: string): Promise<void> {
  await tx('outbox', 'readwrite', (s) => s.delete(changeId));
}

export async function clearOutbox(): Promise<void> {
  await tx('outbox', 'readwrite', (s) => s.clear());
}

// -- bulk clear (sign out, delete forever)

export async function deleteRecordsForDocument(documentId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(['blocks', 'notes', 'connectors', 'attachments', 'documents', 'outbox', 'versions'], 'readwrite');
    const blockIds: string[] = [];
    t.objectStore('blocks').openCursor().onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        const b = cursor.value as Block;
        if (b.documentId === documentId) {
          blockIds.push(b.id);
          cursor.delete();
        }
        cursor.continue();
      }
    };
    t.objectStore('notes').openCursor().onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        const n = cursor.value as Note;
        if (n.documentId === documentId) cursor.delete();
        cursor.continue();
      }
    };
    t.objectStore('connectors').openCursor().onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        const c = cursor.value as Connector;
        if (c.documentId === documentId) cursor.delete();
        cursor.continue();
      }
    };
    t.objectStore('attachments').openCursor().onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        const a = cursor.value as AttachmentRecord;
        if (a.documentId === documentId) cursor.delete();
        cursor.continue();
      }
    };
    t.objectStore('documents').delete(documentId);
    t.objectStore('outbox').openCursor().onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        const o = cursor.value as OutboxEntry;
        if (o.documentId === documentId || blockIds.includes(o.recordId)) cursor.delete();
        cursor.continue();
      }
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
