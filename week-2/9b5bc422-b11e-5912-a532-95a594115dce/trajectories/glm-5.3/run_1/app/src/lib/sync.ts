// The sync engine: sends the device's changes to the account and applies the
// account's changes to the device.
import * as db from './store';
import { useApp, broadcastChange } from './app';
import type { Block, Column, Connector, DocumentMeta, Note, Row, TableMeta, Change } from '../../shared/domain';

interface SyncCallbacks {
  onDropped: (documentId: string) => void;
}

let callbacks: SyncCallbacks = {
  onDropped: () => {},
};

export function setSyncCallbacks(cb: SyncCallbacks): void {
  callbacks = cb;
}

interface PushChange extends Change {
  createOnly?: boolean;
}

interface PushResult {
  id: string;
  recordId: string;
  version: number;
  conflict: boolean;
  deleted: boolean;
  dropped: boolean;
}

let pushing = false;
let pullAgain = false;

export async function pushOutbox(): Promise<void> {
  const s = useApp.getState();
  if (!s.signedIn || !s.syncingOn || pushing) {
    if (pushing) pullAgain = true;
    return;
  }
  const entries = await db.getOutbox();
  if (entries.length === 0) {
    await sendFiles();
    return;
  }
  pushing = true;
  useApp.setState({ pushInFlight: true, pushAttempted: true });
  const changes: PushChange[] = await Promise.all(
    entries.map(async (e) => ({
      id: e.changeId,
      kind: e.kind as Change['kind'],
      recordId: e.recordId,
      documentId: e.documentId,
      deleted: e.deleted,
      payload: e.payload,
      baseVersion: await db.getVersion(e.recordId),
    }))
  );
  try {
    const res = await fetch('/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes }),
    });
    if (res.status === 503 || !res.ok) {
      useApp.setState({ pushInFlight: false });
      return;
    }
    const body = await res.json();
    const results: PushResult[] = body.results ?? [];
    for (const r of results) {
      const entry = entries.find((e) => e.changeId === r.id);
      if (!entry) continue;
      if (r.dropped) {
        callbacks.onDropped(entry.documentId ?? entry.recordId);
        continue;
      }
      await db.setVersion(entry.recordId, r.version);
      await db.deleteOutbox(entry.changeId);
    }
    // The pull cursor only moves when changes have been pulled and applied:
    // the push cursor includes other devices' un-pulled changes.
    await sendFiles();
    await pullChanges();
  } catch (err) {
    console.error('push error', err);
  } finally {
    pushing = false;
    useApp.setState({ pushInFlight: false });
    if (pullAgain) {
      pullAgain = false;
      void pushOutbox();
    }
  }
}

// Files waiting to be stored. They enter 'waiting' on the device and are
// 'stored' only after the server says object storage confirmed them.
async function sendFiles(): Promise<void> {
  const s = useApp.getState();
  if (!s.signedIn || !s.syncingOn) return;
  const waiting = (await db.getAttachments()).filter((a) => a.state === 'waiting');
  for (const file of waiting) {
    if (!file.bytes) continue;
    try {
      const res = await fetch(`/api/attachments/${file.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': file.contentType || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
          'X-Document-Id': file.documentId,
        },
        body: file.bytes,
      });
      if (res.ok) {
        await db.putAttachment({ ...file, state: 'stored', bytes: undefined });
        useApp.getState().announce(`Stored ${file.name}.`);
      } else if (res.status === 413) {
        await db.putAttachment({ ...file, state: 'refused', bytes: undefined });
        useApp.getState().announce(`Refused ${file.name}.`);
      } else if (res.status === 507) {
        await db.putAttachment({ ...file, state: 'refused', bytes: undefined });
        useApp.getState().announce(`Refused ${file.name}.`);
      }
      // 503 and network errors keep the file waiting; retry at the next tick
    } catch (err) {
      console.error('file send error', err);
    }
  }
  await useApp.getState().reload();
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

export async function pushUpload(changes: UploadChange[]): Promise<boolean> {
  const s = useApp.getState();
  if (!s.signedIn) return false;
  pushing = true;
  useApp.setState({ pushInFlight: true });
  let ok = true;
  try {
    // Send in batches; the server answers per change.
    for (let i = 0; i < changes.length; i += 200) {
      const batch = changes.slice(i, i + 200).map((c) => ({
        id: c.id,
        kind: c.kind as Change['kind'],
        recordId: c.recordId,
        documentId: c.documentId,
        deleted: c.deleted,
        payload: c.payload,
        baseVersion: c.baseVersion,
        createOnly: c.createOnly,
      }));
      const res = await fetch('/api/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes: batch }),
      });
      if (!res.ok) {
        ok = false;
        break;
      }
      const body = await res.json();
      for (const r of body.results ?? [] as PushResult[]) {
        const entry = changes.find((c) => c.id === r.id);
        if (!entry) continue;
        if (r.dropped) {
          callbacks.onDropped(entry.documentId ?? entry.recordId);
          continue;
        }
        await db.setVersion(entry.recordId, r.version);
      }
    }
    await sendFiles();
  } catch (err) {
    console.error('upload error', err);
    ok = false;
  } finally {
    pushing = false;
    useApp.setState({ pushInFlight: false });
  }
  return ok;
}

interface PulledChange {
  id: string;
  kind: Change['kind'];
  recordId: string;
  version: number;
  conflict: boolean;
  conflictValues: [unknown, unknown] | null;
  payload: unknown;
  deleted: boolean;
  deviceId: string | null;
}

export async function pullChanges(): Promise<void> {
  const s = useApp.getState();
  if (!s.signedIn || !s.syncingOn) return;
  let cursor = s.cursor;
  try {
    while (true) {
      const res = await fetch(`/api/sync/pull?since=${cursor}`);
      if (!res.ok) return;
      const body = await res.json();
      const changes: PulledChange[] = body.changes ?? [];
      if (changes.length === 0) {
        await db.setMeta('cursor', body.cursor);
        useApp.setState({ cursor: body.cursor });
        break;
      }
      for (const change of changes) {
        await applyPulled(change);
        await db.setVersion(change.recordId, change.version);
      }
      cursor = body.cursor;
      await db.setMeta('cursor', cursor);
      useApp.setState({ cursor });
      if (changes.length < 5000) break;
    }
    broadcastChange();
    await useApp.getState().reload();
  } catch (err) {
    console.error('pull error', err);
  }
}

function payloadEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

async function applyPulled(change: PulledChange): Promise<void> {
  const app = useApp.getState();
  const hasLocalEdit = (await db.getOutbox()).some((e) => e.recordId === change.recordId);

  if (change.conflict && change.conflictValues) {
    const [a, b] = change.conflictValues;
    const field = differingField(change.kind, a, b);
    const values = extractValues(change.kind, a, b, field);
    if (values.length === 2 && values[0] !== values[1]) {
      const bothKept = new Map(app.bothKept);
      bothKept.set(change.recordId, values);
      const fields = new Map(app.bothKeptFields);
      fields.set(change.recordId, field);
      useApp.setState({ bothKept, bothKeptFields: fields });
    } else {
      // same value after all: just clear any marker
      await clearMarker(change.recordId);
    }
    await db.setVersion(change.recordId, change.version);
    return;
  }

  await clearMarker(change.recordId);

  if (change.deleted) {
    await applyDeleted(change);
    return;
  }

  if (hasLocalEdit) {
    // the local change is newer; conflict detection happens at push time
    return;
  }

  switch (change.kind) {
    case 'document': {
      const payload = change.payload as DocumentMeta & { gone?: boolean };
      if (payload.gone) return;
      if (payload.journal) await ensureJournalNoteLocal(payload);
      else await db.putDocument(payload);
      break;
    }
    case 'block':
      await db.putBlock(change.payload as Block);
      break;
    case 'note':
      await db.putNote(change.payload as Note);
      break;
    case 'connector':
      await db.putConnector(change.payload as Connector);
      break;
    case 'table':
      await db.putTable(change.payload as TableMeta);
      break;
    case 'column':
      await db.putColumn(change.payload as Column);
      break;
    case 'row':
      await db.putRow(change.payload as Row);
      break;
    case 'attachment':
      // attachments arrive from the server when they are stored
      break;
  }
}

async function ensureJournalNoteLocal(payload: DocumentMeta): Promise<void> {
  // Two devices that created the same date end with one note. The blocks are
  // pulled separately; only make sure the note's document record exists.
  await db.putDocument(payload);
  void payloadEquals;
}

async function clearMarker(recordId: string): Promise<void> {
  const app = useApp.getState();
  if (app.bothKept.has(recordId)) {
    const bothKept = new Map(app.bothKept);
    bothKept.delete(recordId);
    const fields = new Map(app.bothKeptFields);
    fields.delete(recordId);
    useApp.setState({ bothKept, bothKeptFields: fields });
  }
}

async function applyDeleted(change: PulledChange): Promise<void> {
  const app = useApp.getState();
  switch (change.kind) {
    case 'document': {
      const doc = app.documents.find((d) => d.id === change.recordId);
      const hadEdits = (await db.getOutbox()).some((e) => e.documentId === change.recordId);
      await db.deleteRecordsForDocument(change.recordId);
      if (hadEdits && doc && (change.payload as { gone?: boolean } | null)?.gone) {
        app.showNotice(`"${doc.title || 'Untitled'}" was deleted forever on another device, so your changes to it were not kept.`);
      }
      break;
    }
    case 'block':
      await db.deleteBlock(change.recordId);
      break;
    case 'note':
      await db.deleteNote(change.recordId);
      break;
    case 'connector':
      await db.deleteConnector(change.recordId);
      break;
    case 'column':
      await db.deleteColumn(change.recordId);
      break;
    case 'row':
      await db.deleteRow(change.recordId);
      break;
    case 'attachment':
      await db.deleteAttachment(change.recordId);
      break;
  }
}

// Both kept: find the field that differs between the two payloads.
function differingField(kind: string, a: unknown, b: unknown): string {
  if (kind === 'document') return 'title';
  if (kind === 'block' || kind === 'note') return 'text';
  if (kind === 'row') {
    const ra = (a as Row).values ?? {};
    const rb = (b as Row).values ?? {};
    for (const key of Object.keys(ra)) {
      if (String(ra[key]) !== String(rb[key])) return key;
    }
    return 'text';
  }
  return 'text';
}

function extractValues(kind: string, a: unknown, b: unknown, field: string): string[] {
  const pick = (payload: unknown): string => {
    if (payload == null) return '';
    const p = payload as Record<string, unknown>;
    if (kind === 'row') {
      const v = (p.values as Record<string, unknown>)?.[field];
      return v == null ? '' : String(v);
    }
    const v = p[field];
    return v == null ? '' : String(v);
  };
  return [pick(a), pick(b)];
}

