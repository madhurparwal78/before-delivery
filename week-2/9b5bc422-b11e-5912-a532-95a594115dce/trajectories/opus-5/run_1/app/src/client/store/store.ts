import { CREATE, materialise } from '../../domain/materialise.ts';
import { buildOp, uuid, type OpDraft } from '../../domain/ops.ts';
import { seedOps } from '../../domain/seed.ts';
import { todayOnDevice } from '../../domain/format.ts';
import type { AttachmentState, StoredOp, Workspace } from '../../domain/types.ts';
import { allFiles, allOps, dropOps, putOps, readMeta, writeMeta, type StoredFile } from './local.ts';
import { applyScheme, loadPrefs, savePrefs, type Prefs } from './prefs.ts';

export type Account = { user: { id: string; email: string }; device: { id: string; name: string } };

export type FileView = {
  id: string;
  name: string;
  size: number;
  contentType: string;
  state: AttachmentState;
  refusal: 'too-large' | 'account-full' | null;
};

export type DocumentPending = 'local' | 'waiting';

export type Pending = {
  entities: Set<string>;
  items: number;
  byDocument: Map<string, DocumentPending>;
};

export type State = {
  version: number;
  ready: boolean;
  deviceId: string;
  ops: StoredOp[];
  deletedForever: Set<string>;
  workspace: Workspace;
  files: Map<string, FileView>;
  account: Account | null;
  syncMode: 'off' | 'on';
  choiceMade: boolean;
  uploadDialogOpen: boolean;
  online: boolean;
  serviceAvailable: boolean;
  storageAvailable: boolean;
  announcement: string;
  notices: { id: string; text: string }[];
  prefs: Prefs;
  pending: Pending;
};

const emptyWorkspace = materialise([]);

let state: State = {
  version: 0,
  ready: false,
  deviceId: '',
  ops: [],
  deletedForever: new Set(),
  workspace: emptyWorkspace,
  files: new Map(),
  account: null,
  syncMode: 'off',
  choiceMade: false,
  uploadDialogOpen: false,
  online: true,
  serviceAvailable: true,
  storageAvailable: true,
  announcement: '',
  notices: [],
  prefs: { density: 'List', scheme: 'System', savedFilters: [], canvas: {}, folders: [] },
  pending: { entities: new Set(), items: 0, byDocument: new Map() },
};

const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function snapshot(): State {
  return state;
}

export function syncing(): boolean {
  return !!state.account && state.syncMode === 'on';
}

function documentOf(entity: string, entityId: string, workspace: Workspace): string | null {
  if (entity === 'document') return entityId;
  if (entity === 'block') return workspace.blocks.get(entityId)?.documentId ?? null;
  if (entity === 'note') return workspace.notes.get(entityId)?.documentId ?? null;
  if (entity === 'connector') return workspace.connectors.get(entityId)?.documentId ?? null;
  if (entity === 'attachment') return workspace.attachments.get(entityId)?.documentId ?? null;
  return null;
}

function derivePending(ops: StoredOp[], workspace: Workspace, files: Map<string, FileView>): Pending {
  const entities = new Set<string>();
  const byDocument = new Map<string, DocumentPending>();
  for (const op of ops) {
    if (op.status === 'confirmed' || op.seed) continue;
    if (op.entity === 'attachment' && files.get(op.entityId)?.state === 'refused') continue;
    entities.add(`${op.entity}:${op.entityId}`);
    const documentId = documentOf(op.entity, op.entityId, workspace);
    if (!documentId) continue;
    if (op.status === 'local') byDocument.set(documentId, 'local');
    else if (!byDocument.has(documentId)) byDocument.set(documentId, 'waiting');
  }
  for (const file of files.values()) {
    if (file.state === 'waiting') entities.add(`attachment:${file.id}`);
    if (file.state === 'refused') entities.delete(`attachment:${file.id}`);
  }
  return { entities, items: entities.size, byDocument };
}

function recompute(): void {
  state.workspace = materialise(state.ops, state.deletedForever);
  state.pending = derivePending(state.ops, state.workspace, state.files);
}

function emit(): void {
  state = { ...state, version: state.version + 1 };
  for (const listener of listeners) listener();
}

export function update(change: Partial<State>): void {
  state = { ...state, ...change };
  recompute();
  emit();
}

let announcementQueue: string[] = [];
let announcementTimer: number | null = null;

function nextAnnouncement(): void {
  if (!announcementQueue.length) {
    announcementTimer = null;
    return;
  }
  state.announcement = announcementQueue.shift() as string;
  emit();
  announcementTimer = window.setTimeout(nextAnnouncement, 1000);
}

/** Each message stays long enough to be read before the next one replaces it. */
export function announce(text: string): void {
  announcementQueue.push(text);
  if (announcementTimer === null) nextAnnouncement();
}

export function notice(text: string): void {
  if (state.notices.some((item) => item.text === text)) return;
  state.notices = [...state.notices, { id: uuid(), text }];
  emit();
}

export function dismissNotice(id: string): void {
  state.notices = state.notices.filter((item) => item.id !== id);
  emit();
}

export function setPrefs(change: Partial<Prefs>): void {
  state.prefs = { ...state.prefs, ...change };
  savePrefs(state.prefs);
  if (change.scheme) applyScheme(change.scheme);
  emit();
}

function tell(): void {
  channel?.postMessage({ kind: 'ops' });
}

let pokeSync: () => void = () => undefined;

export function onSyncPoke(fn: () => void): void {
  pokeSync = fn;
}

function documentIdFor(draft: OpDraft): string | undefined {
  if (draft.documentId) return draft.documentId;
  if (draft.entity === 'document') return draft.entityId;
  if (draft.entity === 'table' || draft.entity === 'row') return undefined;
  if (draft.field === CREATE) return (draft.value as { documentId?: string })?.documentId;
  return documentOf(draft.entity, draft.entityId, state.workspace) ?? undefined;
}

/** Every change is written to device storage before anything else happens. */
export async function apply(drafts: OpDraft[]): Promise<StoredOp[]> {
  const written: StoredOp[] = [];
  for (const draft of drafts) {
    const op: StoredOp = {
      ...buildOp({ ...draft, documentId: documentIdFor(draft) }, state.deviceId),
      status: 'local',
    };
    written.push(op);
  }
  state.ops = [...state.ops, ...written];
  recompute();
  emit();
  await putOps(written);
  tell();
  pokeSync();
  return written;
}

/** Repeated edits to one field keep one waiting change. */
export async function applyField(draft: OpDraft): Promise<void> {
  const existing = state.ops.find(
    (op) =>
      op.status === 'local' &&
      op.entity === draft.entity &&
      op.entityId === draft.entityId &&
      op.field === draft.field &&
      op.slot === draft.slot,
  );
  if (!existing) {
    await apply([draft]);
    return;
  }
  const updated: StoredOp = { ...existing, value: draft.value, at: new Date().toISOString() };
  state.ops = state.ops.map((op) => (op.id === existing.id ? updated : op));
  recompute();
  emit();
  await putOps([updated]);
  tell();
  pokeSync();
}

export async function markOps(ids: Set<string>, status: StoredOp['status'], seqs?: Map<string, number>): Promise<void> {
  if (!ids.size) return;
  const changed: StoredOp[] = [];
  state.ops = state.ops.map((op) => {
    if (!ids.has(op.id)) return op;
    const next: StoredOp = { ...op, status };
    const seq = seqs?.get(op.id);
    if (seq !== undefined) next.seq = seq;
    changed.push(next);
    return next;
  });
  recompute();
  emit();
  await putOps(changed);
}

export async function takeRemoteOps(incoming: StoredOp[]): Promise<void> {
  if (!incoming.length) return;
  const byId = new Map(state.ops.map((op) => [op.id, op]));
  const written: StoredOp[] = [];
  for (const op of incoming) {
    const existing = byId.get(op.id);
    if (existing && existing.seq === op.seq) continue;
    written.push({ ...op, status: 'confirmed' });
  }
  if (!written.length) return;
  const ids = new Set(written.map((op) => op.id));
  state.ops = [...state.ops.filter((op) => !ids.has(op.id)), ...written];
  recompute();
  emit();
  await putOps(written);
  tell();
}

export async function forgetDocuments(documentIds: string[]): Promise<void> {
  if (!documentIds.length) return;
  const buried = new Set(documentIds);
  state.deletedForever = new Set([...state.deletedForever, ...buried]);
  const gone = state.ops.filter((op) => {
    const documentId = documentOf(op.entity, op.entityId, state.workspace);
    return documentId !== null && buried.has(documentId);
  });
  state.ops = state.ops.filter((op) => !gone.includes(op));
  recompute();
  emit();
  await writeMeta('deletedForever', [...state.deletedForever]);
  await dropOps(gone.map((op) => op.id));
  tell();
  pokeSync();
}

export function setFile(file: StoredFile): void {
  state.files = new Map(state.files).set(file.id, {
    id: file.id,
    name: file.name,
    size: file.size,
    contentType: file.contentType,
    state: file.state,
    refusal: file.refusal,
  });
  recompute();
  emit();
}

export async function setSyncMode(mode: 'off' | 'on', choiceMade: boolean): Promise<void> {
  state.syncMode = mode;
  state.choiceMade = choiceMade;
  recompute();
  emit();
  await writeMeta('syncMode', mode);
  await writeMeta('choiceMade', choiceMade);
  pokeSync();
}

export async function reloadFromDisk(): Promise<void> {
  const ops = await allOps();
  state.ops = ops;
  const files = await allFiles();
  state.files = new Map(
    files.map((file) => [
      file.id,
      {
        id: file.id,
        name: file.name,
        size: file.size,
        contentType: file.contentType,
        state: file.state,
        refusal: file.refusal,
      },
    ]),
  );
  recompute();
  emit();
}

export async function boot(options: { seed: boolean }): Promise<void> {
  const prefs = loadPrefs();
  state.prefs = prefs;
  applyScheme(prefs.scheme);

  let deviceId = await readMeta<string>('deviceId');
  if (!deviceId) {
    deviceId = uuid();
    await writeMeta('deviceId', deviceId);
  }
  state.deviceId = deviceId;
  state.deletedForever = new Set((await readMeta<string[]>('deletedForever')) ?? []);
  state.syncMode = (await readMeta<'off' | 'on'>('syncMode')) ?? 'off';
  state.choiceMade = (await readMeta<boolean>('choiceMade')) ?? false;
  state.online = navigator.onLine;

  const seeded = await readMeta<boolean>('seeded');
  await reloadFromDisk();
  if (options.seed && !seeded) {
    const ops: StoredOp[] = seedOps(todayOnDevice(), new Date().toISOString()).map((op) => ({
      ...op,
      status: 'local',
    }));
    state.ops = [...state.ops, ...ops];
    await putOps(ops);
    await writeMeta('seeded', true);
  }

  channel = new BroadcastChannel('oddment');
  channel.onmessage = (event) => {
    if ((event.data as { kind?: string })?.kind === 'ops') void reloadFromDisk();
  };

  window.addEventListener('online', () => {
    update({ online: true });
    pokeSync();
  });
  window.addEventListener('offline', () => update({ online: false }));

  state.ready = true;
  recompute();
  emit();
}
