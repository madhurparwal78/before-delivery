import { create } from 'zustand';
import type { Block, Column, Connector, DocumentMeta, Note, Row, TableMeta } from '../../shared/domain';
import * as db from './store';
import * as seed from './seed';
import { uuid, isoDate } from './util';
import { announce as announceMessage } from './announce';
import type { AttachmentRecord, OutboxEntry } from './store';
import { pushOutbox, pullChanges, setSyncCallbacks, pushUpload } from './sync';

export type SyncStateValue = 'synced' | 'syncing' | 'offline' | 'error';
export type DocumentStateValue = 'On this device' | 'Waiting to sync' | 'Synced';

export interface SavedFilter {
  id: string;
  name: string;
  search: string;
  folder: string | null;
  tag: string | null;
  starredOnly: boolean;
}

export interface Notice {
  id: string;
  text: string;
}

export interface FilterValues {
  search: string;
  folder: string | null;
  tag: string | null;
  starredOnly: boolean;
}

interface AppState {
  ready: boolean;
  documents: DocumentMeta[];
  blocks: Block[];
  notes: Note[];
  connectors: Connector[];
  tables: TableMeta[];
  columns: Column[];
  rows: Row[];
  attachments: AttachmentRecord[];

  density: 'List' | 'Card' | 'Grid';
  colourScheme: 'Light' | 'Dark' | 'System';
  savedFilters: SavedFilter[];

  signedIn: boolean;
  email: string | null;
  userId: string | null;
  deviceId: string | null;
  deviceName: string | null;
  syncingOn: boolean;
  uploadChosen: boolean;
  sessionChecked: boolean;

  networkOnline: boolean;
  serviceReachable: boolean;
  storageReachable: boolean;
  cursor: number;
  outbox: OutboxEntry[];
  bothKept: Map<string, string[]>;
  bothKeptFields: Map<string, string>;
  notices: Notice[];
  announcement: string;
  pushInFlight: boolean;
  pushAttempted: boolean;

  init(): Promise<void>;
  reload(): Promise<void>;
  markChange(kind: string, recordId: string, documentId: string | null, deleted: boolean, payload: unknown): Promise<void>;
  outboxForRecord(recordId: string): boolean;
  documentState(documentId: string): DocumentStateValue;
  syncSentence(): string;
  syncStateValue(): SyncStateValue;
  unsyncedCount(): number;
  refreshStatus(): Promise<void>;
  tick(): Promise<void>;
  setSession(user: { id: string; email: string }, device: { id: string; name: string }): Promise<void>;
  clearSession(): Promise<void>;
  signOut(): Promise<void>;
  chooseUpload(): Promise<void>;
  chooseKeep(): Promise<void>;
  resolveBothKept(recordId: string, value: string): Promise<void>;
  dismissNotice(id: string): void;
  showNotice(text: string): void;
  announce(text: string): void;
  setDensity(d: 'List' | 'Card' | 'Grid'): Promise<void>;
  setColourScheme(s: 'Light' | 'Dark' | 'System'): Promise<void>;
  saveFilter(name: string, values: FilterValues): Promise<void>;
  newDocument(): Promise<string>;
}

let changeCounter = 0;
function changeId(): string {
  changeCounter += 1;
  return `c-${Date.now()}-${changeCounter}`;
}

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('oddment') : null;
export function broadcastChange(): void {
  channel?.postMessage({ type: 'change' });
}
if (channel) {
  channel.onmessage = () => {
    void useApp.getState().reload();
  };
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  documents: [],
  blocks: [],
  notes: [],
  connectors: [],
  tables: [],
  columns: [],
  rows: [],
  attachments: [],

  density: 'List',
  colourScheme: 'System',
  savedFilters: [],

  signedIn: false,
  email: null,
  userId: null,
  deviceId: null,
  deviceName: null,
  syncingOn: false,
  uploadChosen: false,
  sessionChecked: false,

  networkOnline: true,
  serviceReachable: true,
  storageReachable: true,
  cursor: 0,
  outbox: [],
  bothKept: new Map(),
  bothKeptFields: new Map(),
  notices: [],
  announcement: '',
  pushInFlight: false,
  pushAttempted: false,

  async init() {
    const seeded = await db.getMeta('seeded', false);
    if (!seeded) {
      await writeSeed();
      await db.setMeta('seeded', true);
    }
    await get().reload();
    const density = await db.getMeta<'List' | 'Card' | 'Grid'>('density', 'List');
    const colourScheme = await db.getMeta<'Light' | 'Dark' | 'System'>('colourScheme', 'System');
    const savedFilters = await db.getMeta<SavedFilter[]>('savedFilters', seed.SEED_SAVED_FILTERS);
    const cursor = await db.getMeta('cursor', 0);
    const syncingOn = await db.getMeta('syncingOn', false);
    const uploadChosen = await db.getMeta('uploadChosen', false);
    const outbox = await db.getOutbox();
    set({ density, colourScheme, savedFilters, cursor, syncingOn, uploadChosen, outbox, ready: true });
    setSyncCallbacks({
      onDropped: (documentId) => {
        const doc = get().documents.find((d) => d.id === documentId);
        const hadEdits = get().outbox.some((e) => e.documentId === documentId);
        void dropDocumentLocally(documentId).then(() => get().reload());
        if (hadEdits && doc) {
          get().showNotice(`"${doc.title || 'Untitled'}" was deleted forever on another device, so your changes to it were not kept.`);
        }
      },
    });
    // The session is checked with the server; offline, the last known session
    // on this device is used so a reload does not look signed out.
    let sessionUser: { user?: { id: string; email: string }; device?: { id: string; name: string } } | null = null;
    let sessionAnswered = false;
    try {
      const res = await fetch('/api/session');
      if (res.ok) {
        sessionUser = await res.json();
        sessionAnswered = true;
      }
    } catch {
      // offline: the local workspace is unaffected
    }
    if (sessionUser && sessionUser.user) {
      const saved = { email: sessionUser.user.email, userId: sessionUser.user.id, deviceId: sessionUser.device!.id, deviceName: sessionUser.device!.name };
      await db.setMeta('session', saved);
      set({ signedIn: true, ...saved });
    } else if (sessionAnswered) {
      await db.setMeta('session', null);
      if (syncingOn) {
        // This device was syncing and now has no session: it was removed from
        // the account. Its work stays on the device.
        await db.setMeta('syncingOn', false);
        set({ syncingOn: false });
        get().showNotice('This device was removed from your account. Your work here stays on this device.');
      }
    } else {
      const saved = await db.getMeta<{ email: string; userId: string; deviceId: string; deviceName: string } | null>('session', null);
      if (saved) set({ signedIn: true, ...saved });
    }
    set({ sessionChecked: true });
    await get().refreshStatus();
  },

  async reload() {
    const [documents, blocks, notes, connectors, tables, columns, rows, attachments, outbox] = await Promise.all([
      db.getDocuments(),
      db.getBlocks(),
      db.getNotes(),
      db.getConnectors(),
      db.getTables(),
      db.getColumns(),
      db.getRows(),
      db.getAttachments(),
      db.getOutbox(),
    ]);
    set({ documents, blocks, notes, connectors, tables, columns, rows, attachments, outbox });
  },

  async markChange(kind, recordId, documentId, deleted, payload) {
    const version = await db.getVersion(recordId);
    const entry: OutboxEntry = {
      changeId: changeId(),
      kind,
      recordId,
      documentId,
      deleted,
      payload,
      baseVersion: version,
    };
    await db.putOutbox(entry);
    // One record, one outbox entry: the newest change per record wins.
    const all = await db.getOutbox();
    const byRecord = new Map<string, OutboxEntry>();
    for (const e of all) {
      const prev = byRecord.get(e.recordId);
      if (!prev || e.changeId === entry.changeId) byRecord.set(e.recordId, e);
    }
    const merged = [...byRecord.values()];
    await db.clearOutbox();
    for (const e of merged) await db.putOutbox(e);
    set({ outbox: merged });
    broadcastChange();
    if (get().syncingOn) {
      void pushOutbox();
    }
  },

  outboxForRecord(recordId) {
    return get().outbox.some((e) => e.recordId === recordId);
  },

  documentState(documentId) {
    const s = get();
    if (!s.syncingOn) return 'On this device';
    const pending = s.outbox.some((e) => e.documentId === documentId);
    if (!pending) return 'Synced';
    return s.pushAttempted ? 'Waiting to sync' : 'On this device';
  },

  syncSentence() {
    const s = get();
    const count = s.unsyncedCount();
    if (s.syncingOn && !s.networkOnline) return `You are offline. ${count} waiting to sync.`;
    if (!s.syncingOn && !s.networkOnline) return 'You are offline. This workspace is only on this device.';
    if (s.syncingOn && s.networkOnline && !s.serviceReachable) return `Sync is unavailable. ${count} waiting to sync.`;
    if (!s.syncingOn && !s.serviceReachable) return 'Sync is unavailable. This workspace is only on this device.';
    if (!s.syncingOn) return 'This workspace is only on this device.';
    if (count > 0 || s.pushInFlight) return `Syncing ${count}.`;
    return 'All changes are synced.';
  },

  syncStateValue() {
    const s = get();
    if (s.syncingOn && !s.networkOnline) return 'offline';
    if (!s.syncingOn && !s.networkOnline) return 'offline';
    if (s.syncingOn && s.networkOnline && !s.serviceReachable) return 'error';
    if (!s.syncingOn && !s.serviceReachable) return 'error';
    if (!s.syncingOn) return 'offline';
    if (s.unsyncedCount() > 0 || s.pushInFlight) return 'syncing';
    return 'synced';
  },

  unsyncedCount() {
    const s = get();
    let n = new Set(s.outbox.map((e) => e.recordId)).size;
    if (s.syncingOn) {
      for (const a of s.attachments) {
        if (a.state === 'waiting' && !s.outbox.some((e) => e.recordId === a.id)) n += 1;
      }
    }
    return n;
  },

  async refreshStatus() {
    let serviceReachable = false;
    let storageReachable = false;
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const body = await res.json();
        serviceReachable = body.sync === 'ok';
        storageReachable = body.storage === 'ok';
      }
    } catch {
      serviceReachable = false;
      storageReachable = false;
    }
    const networkOnline = navigator.onLine;
    const prev = get();
    set({ serviceReachable, storageReachable, networkOnline });
    const waitingFile = prev.attachments.some((a) => a.state === 'waiting');
    const hadNotice = prev.notices.some((n) => n.text.startsWith('Attachment storage is unavailable'));
    if (!storageReachable && waitingFile && !hadNotice) {
      get().showNotice('Attachment storage is unavailable. Waiting files stay on this device.');
    }
    if (storageReachable && hadNotice) {
      const id = prev.notices.find((n) => n.text.startsWith('Attachment storage is unavailable'))?.id;
      if (id) set({ notices: prev.notices.filter((n) => n.id !== id) });
    }
  },

  async tick() {
    await get().refreshStatus();
    if (get().syncingOn) {
      await pushOutbox();
      await pullChanges();
    }
  },

  async setSession(user, device) {
    set({ signedIn: true, email: user.email, userId: user.id, deviceId: device.id, deviceName: device.name });
  },

  async clearSession() {
    set({ signedIn: false, email: null, userId: null, deviceId: null, deviceName: null, syncingOn: false });
    await db.setMeta('syncingOn', false);
    await db.setMeta('session', null);
  },

  async signOut() {
    try {
      await fetch('/api/session', { method: 'DELETE' });
    } catch {
      // offline sign-out still clears the local session
    }
    await get().clearSession();
    get().announce('Signed out. This workspace stays on this device.');
  },

  async chooseUpload() {
    await db.setMeta('syncingOn', true);
    await db.setMeta('uploadChosen', true);
    set({ syncingOn: true, uploadChosen: true });
    const ok = await uploadWorkspace();
    if (ok) {
      // The whole device workspace is on the account now.
      await db.clearOutbox();
      set({ outbox: [] });
    }
    await pullChanges();
    get().announce('Workspace uploaded.');
    broadcastChange();
  },

  async chooseKeep() {
    await db.setMeta('syncingOn', false);
    await db.setMeta('uploadChosen', true);
    set({ syncingOn: false, uploadChosen: true });
    get().announce('Keeping this workspace on this device.');
  },

  async resolveBothKept(recordId, value) {
    const field = get().bothKeptFields.get(recordId) ?? 'text';
    const bothKept = new Map(get().bothKept);
    bothKept.delete(recordId);
    const bothKeptFields = new Map(get().bothKeptFields);
    bothKeptFields.delete(recordId);
    set({ bothKept, bothKeptFields });
    await resolveChange(recordId, field, value);
    get().announce('Kept one version.');
  },

  dismissNotice(id) {
    set({ notices: get().notices.filter((n) => n.id !== id) });
  },

  showNotice(text) {
    if (get().notices.some((n) => n.text === text)) return;
    set({ notices: [...get().notices, { id: uuid(), text }] });
  },

  announce(text) {
    announceMessage(text);
  },

  async setDensity(d) {
    await db.setMeta('density', d);
    set({ density: d });
  },

  async setColourScheme(s) {
    await db.setMeta('colourScheme', s);
    set({ colourScheme: s });
  },

  async saveFilter(name, values) {
    const filters = [...get().savedFilters];
    filters.push({ id: uuid(), name, ...values });
    await db.setMeta('savedFilters', filters);
    set({ savedFilters: filters });
    get().announce(`Saved filter "${name}".`);
  },

  async newDocument() {
    const id = uuid();
    try {
      sessionStorage.setItem('oddment-focus-title', '1');
    } catch {
      // private mode: focus handling is best effort
    }
    const now = Date.now();
    const doc: DocumentMeta = { id, title: '', folder: null, tags: [], starred: false, trashed: false, createdAt: now, updatedAt: now, journal: false };
    await db.putDocument(doc);
    const blockId = uuid();
    const firstBlock: Block = { id: blockId, documentId: id, type: 'paragraph', text: '', indent: 0, checked: false, order: 0 };
    await db.putBlock(firstBlock);
    await get().markChange('document', id, id, false, documentPayload(doc));
    await get().markChange('block', blockId, id, false, blockPayload(firstBlock));
    await get().reload();
    return id;
  },
}));

export function blockPayload(b: Block): Record<string, unknown> {
  return {
    id: b.id,
    documentId: b.documentId,
    type: b.type,
    text: b.text,
    indent: b.indent,
    checked: b.checked,
    order: b.order,
    card: b.card ?? null,
    tableId: b.tableId ?? null,
    attachmentId: b.attachmentId ?? null,
  };
}

export function documentPayload(d: DocumentMeta): Record<string, unknown> {
  return {
    id: d.id,
    title: d.title,
    folder: d.folder,
    tags: d.tags,
    starred: d.starred,
    trashed: d.trashed,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    journal: d.journal ?? false,
  };
}

export function rowPayload(r: Row): Record<string, unknown> {
  return { id: r.id, tableId: r.tableId, values: r.values };
}

export async function writeSeed(): Promise<void> {
  const allDocs = seed.seedDocuments();
  for (const d of allDocs) await db.putDocument(d);
  await db.putBlocks(seed.seedBlocks());
  for (const n of seed.seedNotes()) await db.putNote(n);
  for (const c of seed.seedConnectors()) await db.putConnector(c);
  for (const t of seed.seedTables()) await db.putTable(t);
  for (const c of seed.seedColumns()) await db.putColumn(c);
  for (const r of seed.seedRows()) await db.putRow(r);
  const today = isoDate(new Date());
  await ensureJournalNote(today);
}

// One note per date, with template blocks whose ids are fixed, so two devices
// end with one note and the template body once.
export async function ensureJournalNote(date: string): Promise<string> {
  const id = `journal-${date}`;
  const existing = (await db.getDocuments()).find((d) => d.id === id);
  if (existing) return id;
  const template = seed.TEMPLATES[0];
  const now = Date.now();
  await db.putDocument({
    id,
    title: '',
    folder: null,
    tags: [],
    starred: false,
    trashed: false,
    createdAt: now,
    updatedAt: now,
    journal: true,
  });
  const blocks: Block[] = template.blocks.map((b, i) => ({
    id: `${id}-${i + 1}`,
    documentId: id,
    type: b.type,
    text: b.text,
    indent: 0,
    checked: false,
    order: i,
  }));
  await db.putBlocks(blocks);
  return id;
}

async function dropDocumentLocally(documentId: string): Promise<void> {
  await db.deleteRecordsForDocument(documentId);
}

async function resolveChange(recordId: string, field: string, value: string): Promise<void> {
  const s = useApp.getState();
  const block = s.blocks.find((b) => b.id === recordId);
  if (block) {
    const updated = { ...block, text: value };
    await db.putBlock(updated);
    await s.markChange('block', recordId, block.documentId, false, blockPayload(updated));
    return;
  }
  const doc = s.documents.find((d) => d.id === recordId);
  if (doc) {
    const updated = { ...doc, title: value };
    await db.putDocument(updated);
    await s.markChange('document', recordId, recordId, false, documentPayload(updated));
    return;
  }
  const row = s.rows.find((r) => r.id === recordId);
  if (row) {
    const updated = { ...row, values: { ...row.values, [field]: value } };
    await db.putRow(updated);
    await s.markChange('row', recordId, row.tableId, false, rowPayload(updated));
    return;
  }
}

async function uploadWorkspace(): Promise<boolean> {
  const s = useApp.getState();
  const versions = await db.getVersions();
  const versionMap = new Map(versions.map((v) => [v.id, v.version]));
  const edited = new Set(s.outbox.map((e) => e.recordId));
  const changes: UploadChange[] = [];

  const addRecord = (kind: string, recordId: string, documentId: string | null, payload: unknown) => {
    const ver = versionMap.get(recordId) ?? 0;
    changes.push({
      id: changeId(),
      kind,
      recordId,
      documentId,
      deleted: false,
      payload,
      baseVersion: ver,
      createOnly: ver === 0 && !edited.has(recordId),
    });
  };

  for (const d of s.documents) addRecord('document', d.id, d.id, documentPayload(d));
  for (const b of s.blocks) addRecord('block', b.id, b.documentId, blockPayload(b));
  for (const n of s.notes) addRecord('note', n.id, n.documentId, { id: n.id, documentId: n.documentId, text: n.text, card: n.card, order: n.order });
  for (const c of s.connectors) addRecord('connector', c.id, c.documentId, { id: c.id, documentId: c.documentId, fromId: c.fromId, toId: c.toId });
  for (const t of s.tables) addRecord('table', t.id, null, { id: t.id, name: t.name, createdAt: t.createdAt, updatedAt: t.updatedAt });
  for (const c of s.columns) addRecord('column', c.id, c.tableId, { id: c.id, tableId: c.tableId, name: c.name, type: c.type, options: c.options, order: c.order });
  for (const r of s.rows) addRecord('row', r.id, r.tableId, rowPayload(r));

  return pushUpload(changes);
}

export interface UploadChange {
  id: string;
  kind: string;
  recordId: string;
  documentId: string | null;
  deleted: boolean;
  payload: unknown;
  baseVersion: number;
  createOnly: boolean;
}
