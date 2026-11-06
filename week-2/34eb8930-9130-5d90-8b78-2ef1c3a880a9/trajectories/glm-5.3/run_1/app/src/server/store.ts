import type { Pool } from 'pg';
import { putObject, getObject, deleteObject } from './s3.js';
import { emptyModel, modelBlocks, replayDelta, type DocModel, type ModelComment, type ModelSuggestion, type RevisionDelta, type TextDelta } from '../domain/model.js';
import { applyOpFrame, applyDecision, applyDecideAll, applyReplaceAll, type FrameOutcome } from '../domain/suggest.js';
import { transformAll, type AppliedChange } from '../domain/transform.js';
import type { Op } from '../domain/ot.js';
import type { DomainRole, Mode } from '../domain/types.js';

export type PersonInfo = { personId: string; displayName: string; colour: string };

export type SocketRef = { send: (frame: unknown) => void; ws?: { close: () => void } };

/** The live proposal: its model, presence and save pipeline state. */
export type LiveDoc = {
  id: string;
  title: string;
  client: string;
  ownerId: string;
  model: DocModel;
  savedRevision: number;
  saveFailed: boolean;
  /** true while a storage write for this doc is in flight */
  saving: boolean;
  /** true when changes are waiting to be written to storage */
  dirty: boolean;
  saveTimer: NodeJS.Timeout | null;
  retryTimer: NodeJS.Timeout | null;
  /** in-memory applied history since the doc was loaded, for transforming op frames */
  history: { revision: number; textOps: TextDelta[] }[];
  /** per-person presence: last input (op/caret/mode) and last heartbeat */
  presence: Map<string, { lastInput: number; lastSeen: number; state: 'active' | 'idle' }>;
  /** serialises mutations so concurrent frames apply in receive order */
  queue: Promise<unknown>;
  /** open sockets joined to this doc, by person id */
  joined: Map<string, Set<SocketRef>>;
  /** the database pool, for the save pipeline */
  dbPool: Pool;
};

export const liveDocs = new Map<string, LiveDoc>();

export type StorageBody = {
  documentId: string;
  revision: number;
  text: string;
  blocks: { style: string; at: number; length: number }[];
  marks: DocModel['marks'];
  lineStyles: string[];
  suggestions: ModelSuggestion[];
};

export function buildBody(doc: LiveDoc): StorageBody {
  return {
    documentId: doc.id,
    revision: doc.model.revision,
    text: doc.model.text,
    blocks: modelBlocks(doc.model),
    marks: doc.model.marks,
    lineStyles: doc.model.lineStyles,
    suggestions: doc.model.suggestions,
  };
}

export async function putBody(doc: LiveDoc): Promise<void> {
  const body = JSON.stringify(buildBody(doc));
  await Promise.race([
    putObject(`documents/${doc.id}.json`, body),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('storage write timeout')), 5000)),
  ]);
}

export async function getBody(documentId: string): Promise<StorageBody | null> {
  const res = await Promise.race([
    getObject(`documents/${documentId}.json`),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('storage read timeout')), 5000)),
  ]);
  return res === null ? null : (JSON.parse(res) as StorageBody);
}

export async function deleteBody(documentId: string): Promise<void> {
  await Promise.race([
    deleteObject(`documents/${documentId}.json`),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('storage delete timeout')), 5000)),
  ]);
}

function modelFromBody(body: StorageBody): DocModel {
  return {
    revision: body.revision,
    text: body.text,
    lineStyles: (body.lineStyles as DocModel['lineStyles']) ?? body.blocks.map((b) => b.style as DocModel['lineStyles'][number]),
    marks: body.marks,
    suggestions: body.suggestions.map((s) => ({ ...s })),
    comments: [],
  };
}

async function loadComments(pool: Pool, documentId: string): Promise<ModelComment[]> {
  const rows = await pool.query(
    `SELECT c.id, c.author_id, c.body, c.mentions, c.anchor, c.content_deleted, c.status, c.created_at
     FROM comments c WHERE c.document_id = $1 AND c.parent_id IS NULL ORDER BY c.created_at, c.id`,
    [documentId],
  );
  const replies = await pool.query(
    `SELECT r.id, r.comment_id, r.author_id, r.body, r.created_at FROM comment_replies r
     JOIN comments c ON c.id = r.comment_id WHERE c.document_id = $1 ORDER BY r.created_at, r.id`,
    [documentId],
  );
  const byComment = new Map<string, ModelComment['replies']>();
  for (const rep of replies.rows as { comment_id: string; id: string; author_id: string; body: string; created_at: Date }[]) {
    const list = byComment.get(rep.comment_id) ?? [];
    list.push({ id: rep.id, authorId: rep.author_id, body: rep.body, createdAt: rep.created_at.toISOString() });
    byComment.set(rep.comment_id, list);
  }
  return (rows.rows as Record<string, never>[]).map((c) => {
    const row = c as unknown as { id: string; author_id: string; body: string; mentions: string[]; anchor: { at: number; length: number } | null; content_deleted: boolean; status: ModelComment['status']; created_at: Date };
    return {
      id: row.id,
      authorId: row.author_id,
      body: row.body,
      mentions: row.mentions ?? [],
      anchor: row.anchor ?? null,
      contentDeleted: row.content_deleted,
      status: row.status,
      replies: byComment.get(row.id) ?? [],
      createdAt: row.created_at.toISOString(),
    };
  });
}

export type LoadResult = { ok: true; doc: LiveDoc } | { ok: false; reason: 'not_found' | 'storage_unavailable' };

/** Loads a proposal as its stored object plus the operations recorded after it (DP-43). */
export async function loadDocument(pool: Pool, documentId: string): Promise<LoadResult> {
  const live = liveDocs.get(documentId);
  if (live) return { ok: true, doc: live };
  const row = await pool.query(
    `SELECT id, title, client, owner_id, revision, saved_revision, save_failed, object_required
     FROM documents WHERE id = $1 AND deleted = false`,
    [documentId],
  );
  if (!row.rowCount) return { ok: false, reason: 'not_found' };
  const r = row.rows[0] as { id: string; title: string; client: string; owner_id: string; revision: number; saved_revision: number; save_failed: boolean; object_required: boolean };
  const savedRevision = r.saved_revision;
  let model: DocModel;
  if (savedRevision > 0 || r.object_required) {
    let body: StorageBody | null;
    try {
      body = await getBody(documentId);
    } catch {
      return { ok: false, reason: 'storage_unavailable' };
    }
    model = body ? modelFromBody(body) : emptyModel();
  } else {
    model = emptyModel();
  }
  const deltas = await pool.query(
    `SELECT revision, delta FROM revisions WHERE document_id = $1 AND revision > $2 ORDER BY revision`,
    [documentId, model.revision],
  );
  for (const d of deltas.rows as { revision: number; delta: RevisionDelta }[]) {
    replayDelta(model, d.delta);
  }
  model.comments = await loadComments(pool, documentId);
  const doc: LiveDoc = {
    id: documentId,
    title: r.title,
    client: r.client,
    ownerId: r.owner_id,
    model,
    savedRevision,
    saveFailed: r.save_failed && savedRevision < model.revision,
    saving: false,
    dirty: false,
    saveTimer: null,
    retryTimer: null,
    history: [],
    presence: new Map(),
    queue: Promise.resolve(),
    joined: new Map(),
    dbPool: pool,
  };
  liveDocs.set(documentId, doc);
  return { ok: true, doc };
}

/** Runs a mutating step in the doc's queue so frames apply in the order they arrive. */
export function enqueue<T>(doc: LiveDoc, step: () => Promise<T> | T): Promise<T> {
  const run = doc.queue.then(step);
  doc.queue = run.catch(() => undefined);
  return run;
}

/** Collects the text changes applied after baseRevision, for transforming an incoming op frame. */
async function appliedSince(pool: Pool, doc: LiveDoc, baseRevision: number): Promise<AppliedChange[]> {
  const out: AppliedChange[] = [];
  const push = (ops: TextDelta[]): void => {
    for (const op of ops) {
      if ('ins' in op) out.push({ kind: 'insert', at: op.at, length: op.ins.length });
      else if ('del' in op) out.push({ kind: 'delete', from: op.at, cut: op.del });
    }
  };
  if (baseRevision === doc.model.revision) return out;
  const start = doc.history.length > 0 ? doc.history[0]!.revision - 1 : doc.model.revision;
  if (baseRevision >= start) {
    for (const h of doc.history) if (h.revision > baseRevision) push(h.textOps);
    return out;
  }
  const rows = await pool.query(
    `SELECT revision, delta FROM revisions WHERE document_id = $1 AND revision > $2 ORDER BY revision`,
    [doc.id, baseRevision],
  );
  for (const row of rows.rows as { delta: RevisionDelta }[]) push(row.delta.textOps);
  return out;
}

export type OpResult =
  | { ok: true; outcome: FrameOutcome }
  | { ok: false; error: string; fields?: Record<string, string> };

/** Applies an op frame, transforming it against every change after its baseRevision. */
export async function acceptOpFrame(
  pool: Pool,
  doc: LiveDoc,
  authorId: string,
  authorRole: DomainRole,
  mode: Mode,
  ops: Op[],
  baseRevision: number,
): Promise<OpResult> {
  if (baseRevision > doc.model.revision) return { ok: false, error: 'invalid' };
  const applied = await appliedSince(pool, doc, baseRevision);
  const transformed = ops.flatMap((op) => transformAll(op, applied));
  const result = applyOpFrame(doc.model, authorId, authorRole, mode, transformed, doc.model.revision);
  if ('error' in result) return { ok: false, error: result.error, fields: result.fields };
  doc.history.push({ revision: result.delta.revision, textOps: result.delta.textOps });
  await persistRevision(pool, doc, result.delta);
  return { ok: true, outcome: result };
}

/** Persists a revision delta and syncs comment anchors to the database. */
async function persistRevision(pool: Pool, doc: LiveDoc, delta: RevisionDelta): Promise<void> {
  await pool.query(
    `INSERT INTO revisions (document_id, revision, author_id, mode, delta) VALUES ($1,$2,$3,$4,$5)`,
    [doc.id, delta.revision, delta.authorId, delta.mode, JSON.stringify(delta)],
  );
  await pool.query(`UPDATE documents SET revision = $2, updated_at = now() WHERE id = $1`, [doc.id, delta.revision]);
  await syncCommentAnchors(pool, doc);
  scheduleSave(doc);
}

export async function syncCommentAnchors(pool: Pool, doc: LiveDoc): Promise<void> {
  for (const c of doc.model.comments) {
    await pool.query(
      `UPDATE comments SET anchor = $2, content_deleted = $3 WHERE id = $1`,
      [c.id, c.anchor ? JSON.stringify(c.anchor) : null, c.contentDeleted],
    );
  }
}

/** Decides one suggestion; the first decision the server receives applies (DP-22). */
export async function decideSuggestion(
  pool: Pool,
  doc: LiveDoc,
  suggestionId: string,
  decision: 'accept' | 'reject',
  decidedById: string,
): Promise<{ applied: boolean; status: 'accepted' | 'rejected'; delta: RevisionDelta } | null> {
  const sug = doc.model.suggestions.find((s) => s.id === suggestionId);
  if (!sug || sug.status !== 'open') return null;
  const result = applyDecision(doc.model, sug, decision, decidedById);
  if (!result) return null;
  doc.history.push({ revision: result.delta.revision, textOps: result.delta.textOps });
  await persistRevision(pool, doc, result.delta);
  return result;
}

/** Accept all or Reject all: settles every card still open when the server processes it. */
export async function decideAll(
  pool: Pool,
  doc: LiveDoc,
  decision: 'accept' | 'reject',
  decidedById: string,
): Promise<{ count: number; suggestionIds: string[]; delta: RevisionDelta }> {
  const result = applyDecideAll(doc.model, decision, decidedById);
  doc.history.push({ revision: result.delta.revision, textOps: result.delta.textOps });
  await persistRevision(pool, doc, result.delta);
  return result;
}

/** Replace all while suggesting makes one credited replacement per match, never a direct edit (DP-20). */
export async function replaceAll(
  pool: Pool,
  doc: LiveDoc,
  authorId: string,
  authorRole: DomainRole,
  mode: Mode,
  find: string,
  replace: string,
  matchCase: boolean,
): Promise<{ outcome: FrameOutcome } | { error: string }> {
  const outcome = applyReplaceAll(doc.model, authorId, authorRole, mode, find, replace, matchCase);
  doc.history.push({ revision: outcome.delta.revision, textOps: outcome.delta.textOps });
  await persistRevision(pool, doc, outcome.delta);
  return { outcome };
}

/** The save pipeline: writes the body within one second, batches, and retries every 5 seconds (DP-41, DP-42). */
export function scheduleSave(doc: LiveDoc): void {
  doc.dirty = true;
  doc.saveFailed = doc.saveFailed && doc.savedRevision < doc.model.revision;
  if (doc.saveTimer || doc.saving) return;
  doc.saveTimer = setTimeout(() => {
    doc.saveTimer = null;
    void flushSave(doc);
  }, 300);
}

async function flushSave(doc: LiveDoc): Promise<void> {
  if (doc.saving) return;
  const revision = doc.model.revision;
  doc.saving = true;
  doc.dirty = false;
  try {
    await putBody(doc);
    doc.saving = false;
    doc.savedRevision = Math.max(doc.savedRevision, revision);
    doc.saveFailed = false;
    void doc.dbPool.query(`UPDATE documents SET saved_revision = $2, save_failed = false, object_required = true WHERE id = $1`, [doc.id, doc.savedRevision]);
    if (doc.model.revision > doc.savedRevision) scheduleSave(doc);
    for (const sockets of doc.joined.values()) {
      for (const s of sockets) s.send({ type: 'saved', revision: doc.savedRevision });
    }
  } catch {
    doc.saving = false;
    doc.saveFailed = true;
    void doc.dbPool.query(`UPDATE documents SET save_failed = true WHERE id = $1`, [doc.id]);
    for (const sockets of doc.joined.values()) {
      for (const s of sockets) s.send({ type: 'save_failed', revision });
    }
    if (!doc.retryTimer) {
      doc.retryTimer = setTimeout(() => {
        doc.retryTimer = null;
        scheduleSave(doc);
      }, 5000);
    }
  }
}

/** Creates a proposal with an empty body at revision 0. */
export async function createDocument(pool: Pool, id: string, title: string, client: string, ownerId: string): Promise<LiveDoc> {
  await pool.query(
    `INSERT INTO documents (id, title, client, owner_id, revision, saved_revision, object_required)
     VALUES ($1,$2,$3,$4,0,0,false)`,
    [id, title, client, ownerId],
  );
  const doc: LiveDoc = {
    id,
    title,
    client,
    ownerId,
    model: emptyModel(),
    savedRevision: 0,
    saveFailed: false,
    saving: false,
    dirty: false,
    saveTimer: null,
    retryTimer: null,
    history: [],
    presence: new Map(),
    queue: Promise.resolve(),
    joined: new Map(),
    dbPool: pool,
  };
  liveDocs.set(id, doc);
  scheduleSave(doc);
  return doc;
}

export function saveStateOf(doc: LiveDoc): 'saved' | 'saving' | 'failed' {
  if (doc.saveFailed && doc.savedRevision < doc.model.revision) return 'failed';
  if (doc.savedRevision >= doc.model.revision) return 'saved';
  return 'saving';
}

/** Broadcasts a frame to every joined socket of a doc, except optionally one person's socket. */
export function broadcastDoc(doc: LiveDoc, frame: unknown, exceptSocket?: { send: (f: unknown) => void }): void {
  for (const [personId, sockets] of doc.joined) {
    for (const s of sockets) {
      if (s === exceptSocket) continue;
      s.send(frame);
    }
    void personId;
  }
}

export type { DomainRole, Mode };
