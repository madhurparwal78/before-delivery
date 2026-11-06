// Blocks: creating, merging edits, deleting, moving, quotes, presence, revisions and block search.
import { randomUUID } from 'node:crypto';
import { db, one, transaction, type Db, type Tx } from '../db.ts';
import { apiError, FieldErrors, notFound, validation, type Json } from '../errors.ts';
import { addQuoteEdge, announceCounts, lockObjects } from '../edges.ts';
import { emit } from '../events.ts';
import { isUuid, noContent, objectBody, ok, route, type Request, type Route } from '../http.ts';
import { backlinkCount, blockJson, loadBlock, type BlockRow } from '../model.ts';
import { dropPresence, reportPresence } from '../presence.ts';
import { deleteEventually } from '../storage.ts';
import { renumber } from './objects.ts';
import { wordDiff } from '../../shared/diff.ts';
import { opsFit, transformPair, type Op } from '../../shared/ot.ts';
import { applyOpsToBody, BLOCK_LIMIT, editText, plainText, sanitizeBody } from '../../shared/richtext.ts';
import { SEARCH_CAP } from '../../shared/search.ts';

export const REVISIONS_KEPT = 200;
const EXCERPT_CHARS = 60;
const SEARCH_LIMIT = 20;
const EDIT_ID = /^[\x21-\x7e]{1,64}$/;
const BODY_TOO_LONG = 'A block can hold at most 20,000 characters.';
const NOT_IN_NOTE = 'That block is not in this note.';

const cut = (text: string, n: number): string => [...text].slice(0, n).join('');

/** Sanitises a body to its stored form; adds the 422 when it is too long. */
export function storedBody(value: unknown, errors: FieldErrors): string {
  const body = typeof value === 'string' ? sanitizeBody(value) : '';
  if (typeof value !== 'string' || body.length > BLOCK_LIMIT) errors.add('body', BODY_TOO_LONG);
  return body;
}

/** The position a new block takes: after `afterId` when it is in the object, else at the end. */
async function slotAfter(tx: Tx, objectId: string, afterId: string | null): Promise<number> {
  if (afterId) {
    const after = await one<{ position: number }>(tx, 'SELECT position FROM blocks WHERE id = $1 AND object_id = $2', [afterId, objectId]);
    if (after) {
      await tx.query('UPDATE blocks SET position = position + 1 WHERE object_id = $1 AND position > $2', [objectId, after.position]);
      return after.position + 1;
    }
  }
  const [{ n }] = await tx.query<{ n: number }>('SELECT COALESCE(max(position), 0)::int AS n FROM blocks WHERE object_id = $1', [objectId]);
  return n + 1;
}

/** Whether `afterId` (when given) names a block of the object. */
export async function afterIsValid(tx: Tx, objectId: string, afterId: unknown): Promise<boolean> {
  if (afterId === null || afterId === undefined) return true;
  if (!isUuid(afterId)) return false;
  return (await tx.query('SELECT 1 FROM blocks WHERE id = $1 AND object_id = $2', [afterId, objectId])).length > 0;
}

export const touchObject = (tx: Tx, objectId: string): Promise<unknown> =>
  tx.query('UPDATE objects SET updated_at = now() WHERE id = $1', [objectId]);

/** Emits `block.saved` for a block and for every quote block that shows it. */
async function announceBlock(tx: Tx, blockId: string, extra: { ops: Op[] | null; base_version: number; label: string; edit_id: string | null }): Promise<void> {
  const shown = await tx.query<{ id: string }>('SELECT id FROM blocks WHERE id = $1 OR origin_block_id = $1 ORDER BY (id = $1) DESC, id', [blockId]);
  for (const { id } of shown) {
    const b = await loadBlock(tx, id);
    if (b) await emit(tx, 'block.saved', { object_id: b.object_id, block: blockJson(b), ...extra });
  }
}

/** Inserts a text block with its first revision and announces it. */
export async function insertTextBlock(tx: Tx, objectId: string, body: string, afterId: string | null, label: string): Promise<string> {
  const id = randomUUID();
  const position = await slotAfter(tx, objectId, afterId);
  await tx.query(
    `INSERT INTO blocks (id, object_id, kind, position, body, plain, version, edited_at) VALUES ($1, $2, 'text', $3, $4, $5, 1, clock_timestamp())`,
    [id, objectId, position, body, plainText(body)]);
  await tx.query(`INSERT INTO revisions (block_id, version, body, ops, edit_kind, label, created_at) VALUES ($1, 1, $2, NULL, 'create', $3, clock_timestamp())`,
    [id, body, label]);
  await touchObject(tx, objectId);
  await announceBlock(tx, id, { ops: null, base_version: 0, label, edit_id: null });
  return id;
}

async function requireObject(tx: Tx, id: string): Promise<void> {
  if (!(await tx.query('SELECT 1 FROM objects WHERE id = $1', [id])).length) throw notFound();
}

async function createBlock(req: Request) {
  const body = objectBody(req);
  const id = await transaction(async (tx) => {
    await requireObject(tx, req.params.id);
    const errors = new FieldErrors();
    const stored = storedBody(body.body, errors);
    if (!(await afterIsValid(tx, req.params.id, body.after_block_id))) errors.add('after_block_id', NOT_IN_NOTE);
    errors.throwIfAny();
    return insertTextBlock(tx, req.params.id, stored, (body.after_block_id as string | null | undefined) ?? null, req.session.label);
  });
  return ok(blockJson(await blockOr404(db, id)), 201);
}

export async function blockOr404(q: Db, id: string): Promise<BlockRow> {
  const b = await loadBlock(q, id);
  if (!b) throw notFound();
  return b;
}

const conflict = async (tx: Tx, requestedId: string) =>
  apiError(409, 'version_conflict', { current: blockJson(await blockOr404(tx, requestedId)) });

interface OriginRow { id: string; object_id: string; body: string; version: number }

/** The text block an edit acts on (the origin for a quote block), locked for the commit. */
async function lockOrigin(tx: Tx, requested: BlockRow): Promise<OriginRow> {
  if (requested.kind === 'attachment') throw apiError(409, 'not_editable');
  const origin = await one<OriginRow>(tx,
    'SELECT id, object_id, body, version FROM blocks WHERE id = $1 FOR UPDATE', [requested.origin_block_id ?? requested.id]);
  if (!origin) throw notFound();
  return origin;
}

/** Commits a new version of a text block with its revision, and announces it. */
async function commitVersion(tx: Tx, origin: OriginRow, body: string, kind: 'ops' | 'replace' | 'restore', ops: Op[] | null, label: string, editId: string | null): Promise<void> {
  const version = origin.version + 1;
  await tx.query('UPDATE blocks SET body = $2, plain = $3, version = $4, edited_at = clock_timestamp() WHERE id = $1',
    [origin.id, body, plainText(body), version]);
  await tx.query(`INSERT INTO revisions (block_id, version, body, ops, edit_kind, label, created_at) VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
    [origin.id, version, body, ops ? JSON.stringify(ops) : null, kind, label]);
  await tx.query('DELETE FROM revisions WHERE block_id = $1 AND version <= $2', [origin.id, version - REVISIONS_KEPT]);
  await touchObject(tx, origin.object_id);
  await announceBlock(tx, origin.id, { ops, base_version: origin.version, label, edit_id: editId });
}

/** Transforms ops made on `base` over every later committed revision, in commit order; null on a conflict case. */
async function transformOverLater(tx: Tx, blockId: string, base: number, ops: Op[]): Promise<Op[] | null> {
  const later = await tx.query<{ ops: Op[] | null; edit_kind: string }>(
    'SELECT ops, edit_kind FROM revisions WHERE block_id = $1 AND version > $2 ORDER BY version', [blockId, base]);
  let incoming = ops;
  for (const rev of later) {
    if (rev.edit_kind !== 'ops' || !rev.ops) return null;
    const t = transformPair(rev.ops, incoming);
    if (!t) return null;
    incoming = t.incoming;
  }
  return incoming;
}

async function patchBlock(req: Request) {
  const body = objectBody(req);
  const errors = new FieldErrors();
  const base = body.base_version;
  if (typeof base !== 'number' || !Number.isInteger(base) || base < 1) errors.add('base_version', 'Send the version you started from.');
  if (body.edit_id !== undefined && (typeof body.edit_id !== 'string' || !EDIT_ID.test(body.edit_id))) errors.add('edit_id', 'Use 1 to 64 visible characters.');
  const editId = typeof body.edit_id === 'string' ? body.edit_id : null;
  const replacing = typeof body.body === 'string' && body.ops === undefined;
  await transaction(async (tx) => {
    const requested = await blockOr404(tx, req.params.id);
    const origin = await lockOrigin(tx, requested);
    errors.throwIfAny();
    const baseVersion = base as number;
    if (replacing) {
      if (baseVersion !== origin.version) throw await conflict(tx, requested.id);
      const stored = storedBody(body.body, errors);
      errors.throwIfAny();
      await commitVersion(tx, origin, stored, 'replace', null, req.session.label, editId);
      return;
    }
    if (baseVersion > origin.version) throw validation({ base_version: 'Send the version you started from.' });
    const baseRev = await one<{ body: string }>(tx, 'SELECT body FROM revisions WHERE block_id = $1 AND version = $2', [origin.id, baseVersion]);
    if (!baseRev) throw await conflict(tx, requested.id);
    if (!opsFit(body.ops, editText(baseRev.body).length)) throw validation({ ops: `Those changes don't fit version ${baseVersion}.` });
    const merged = await transformOverLater(tx, origin.id, baseVersion, body.ops);
    if (!merged) throw await conflict(tx, requested.id);
    const next = applyOpsToBody(origin.body, merged);
    if (next.length > BLOCK_LIMIT) throw validation({ body: BODY_TOO_LONG });
    await commitVersion(tx, origin, next, 'ops', merged, req.session.label, editId);
  });
  return ok(blockJson(await blockOr404(db, req.params.id)));
}

async function deleteBlock(req: Request) {
  let reply: { status: number; body?: Json } = { status: 204 };
  let keys: string[] = [];
  await transaction(async (tx) => {
    const b = await blockOr404(tx, req.params.id);
    if (b.kind === 'quote') {
      await lockObjects(tx, [b.origin_object_id as string]);
      await tx.query('DELETE FROM blocks WHERE id = $1', [b.id]);
      await renumber(tx, b.object_id);
      await touchObject(tx, b.object_id);
      await emit(tx, 'block.removed', { object_id: b.object_id, block_id: b.id });
      const counts = await announceCounts(tx, [b.origin_object_id as string]);
      reply = { status: 200, body: { origin_object_id: b.origin_object_id, origin_backlinks: counts.get(b.origin_object_id as string) ?? 0 } };
      return;
    }
    if (b.kind === 'text') {
      const [{ n }] = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM blocks WHERE origin_block_id = $1', [b.id]);
      if (n > 0) throw apiError(409, 'block_quoted', { quoted_in: n });
    } else {
      keys = (await tx.query<{ storage_key: string }>('SELECT storage_key FROM attachments WHERE id = $1', [b.attachment_id])).map((r) => r.storage_key);
    }
    await tx.query('DELETE FROM presence WHERE block_id = $1', [b.id]);
    await tx.query('DELETE FROM blocks WHERE id = $1', [b.id]);
    if (b.attachment_id) await tx.query('DELETE FROM attachments WHERE id = $1', [b.attachment_id]);
    await renumber(tx, b.object_id);
    await touchObject(tx, b.object_id);
    await emit(tx, 'block.removed', { object_id: b.object_id, block_id: b.id });
  });
  deleteEventually(keys);
  return reply;
}

async function moveBlock(req: Request) {
  const body = objectBody(req);
  await transaction(async (tx) => {
    const b = await blockOr404(tx, req.params.id);
    if (b.kind === 'attachment') throw apiError(409, 'not_movable');
    const errors = new FieldErrors();
    const targetId = body.object_id;
    const target = isUuid(targetId) ? await one<{ id: string }>(tx, 'SELECT id FROM objects WHERE id = $1', [targetId]) : undefined;
    if (!target) errors.add('object_id', 'That note no longer exists.');
    else if (b.kind === 'quote' && b.origin_object_id === target.id) errors.add('object_id', 'Quote a block from another note.');
    else if (b.kind === 'text' && (await tx.query('SELECT 1 FROM blocks WHERE origin_block_id = $1 AND object_id = $2', [b.id, target.id])).length) {
      errors.add('object_id', 'That note quotes this block.');
    }
    if (target && (body.after_block_id === b.id || !(await afterIsValid(tx, target.id, body.after_block_id)))) errors.add('after_block_id', NOT_IN_NOTE);
    errors.throwIfAny();
    const to = (target as { id: string }).id;
    const quotes = b.kind === 'text' ? await tx.query<{ id: string }>('SELECT id FROM blocks WHERE origin_block_id = $1', [b.id]) : [];
    const countChanges = quotes.length ? [b.object_id, to] : [];
    await lockObjects(tx, [b.object_id, to, ...(b.origin_object_id ? [b.origin_object_id] : [])]);
    await placeBlock(tx, b.id, b.object_id, to, (body.after_block_id as string | null | undefined) ?? null);
    if (b.kind === 'quote') await tx.query('UPDATE link_edges SET from_object_id = $2 WHERE quote_block_id = $1', [b.id, to]);
    if (quotes.length) await tx.query('UPDATE link_edges SET to_object_id = $2 WHERE quote_block_id = ANY($1::uuid[])', [quotes.map((q) => q.id), to]);
    await touchObject(tx, b.object_id);
    await touchObject(tx, to);
    await emit(tx, 'block.removed', { object_id: b.object_id, block_id: b.id });
    await announceBlock(tx, b.id, { ops: null, base_version: b.version ?? 0, label: req.session.label, edit_id: null });
    await announceCounts(tx, countChanges);
  });
  return ok(blockJson(await blockOr404(db, req.params.id)));
}

/** Moves a block into `to` directly after `afterId` (or at its end); both objects renumber from 1. */
async function placeBlock(tx: Tx, blockId: string, from: string, to: string, afterId: string | null): Promise<void> {
  await tx.query('UPDATE blocks SET object_id = $2 WHERE id = $1', [blockId, to]);
  if (from !== to) await renumber(tx, from);
  const ids = (await tx.query<{ id: string }>('SELECT id FROM blocks WHERE object_id = $1 AND id <> $2 ORDER BY position, id', [to, blockId])).map((r) => r.id);
  ids.splice(afterId ? ids.indexOf(afterId) + 1 : ids.length, 0, blockId);
  await tx.query('UPDATE blocks b SET position = x.n FROM unnest($1::uuid[]) WITH ORDINALITY AS x(id, n) WHERE b.id = x.id', [ids]);
}

async function quoteBlock(req: Request) {
  const body = objectBody(req);
  const result = await transaction(async (tx) => {
    await requireObject(tx, req.params.id);
    const errors = new FieldErrors();
    const picked = isUuid(body.origin_block_id) ? await loadBlock(tx, body.origin_block_id) : undefined;
    // Quoting a quote block quotes that quote's origin.
    const origin = picked?.kind === 'quote' ? await loadBlock(tx, picked.origin_block_id as string) : picked;
    if (!origin) errors.add('origin_block_id', 'That block no longer exists.');
    else if (origin.kind !== 'text') errors.add('origin_block_id', 'Only text blocks can be quoted.');
    else if (origin.object_id === req.params.id) errors.add('origin_block_id', 'Quote a block from another note.');
    if (!(await afterIsValid(tx, req.params.id, body.after_block_id))) errors.add('after_block_id', NOT_IN_NOTE);
    errors.throwIfAny();
    const o = origin as BlockRow;
    await lockObjects(tx, [o.object_id, req.params.id]);
    const id = randomUUID();
    const position = await slotAfter(tx, req.params.id, (body.after_block_id as string | null | undefined) ?? null);
    await tx.query(`INSERT INTO blocks (id, object_id, kind, position, origin_block_id, edited_at) VALUES ($1, $2, 'quote', $3, $4, clock_timestamp())`,
      [id, req.params.id, position, o.id]);
    await addQuoteEdge(tx, req.params.id, o.object_id, id);
    await touchObject(tx, req.params.id);
    const quoteRow = await blockOr404(tx, id);
    await emit(tx, 'block.saved', { object_id: req.params.id, block: blockJson(quoteRow), ops: null, base_version: 0, label: req.session.label, edit_id: null });
    const counts = await announceCounts(tx, [o.object_id]);
    return { block: blockJson(quoteRow), origin_backlinks: counts.get(o.object_id) ?? (await backlinkCount(tx, o.object_id)) };
  });
  return ok(result, 201);
}

async function postPresence(req: Request) {
  const b = await blockOr404(db, req.params.id);
  if (b.kind === 'attachment') throw apiError(409, 'not_editable');
  await reportPresence(req.session, b.origin_block_id ?? b.id, objectBody(req));
  return noContent();
}

async function deletePresence(req: Request) {
  const b = await loadBlock(db, req.params.id);
  if (b) await dropPresence(req.session.id, b.origin_block_id ?? b.id);
  return noContent();
}

/** The text block whose history a request reads: the origin for a quote block. */
async function historyBlock(id: string): Promise<string> {
  const b = await loadBlock(db, id);
  if (!b || b.kind === 'attachment') throw notFound();
  return b.origin_block_id ?? b.id;
}

async function revisions(req: Request) {
  const id = await historyBlock(req.params.id);
  const rows = await db.query<{ version: number; body: string; label: string; created_at: Date }>(
    'SELECT version, body, label, created_at FROM revisions WHERE block_id = $1 ORDER BY version DESC', [id]);
  return ok({ revisions: rows.map((r) => ({ version: r.version, body: r.body, plain: plainText(r.body), label: r.label, created_at: r.created_at.toISOString() })) });
}

async function keptBody(blockId: string, version: unknown): Promise<string | undefined> {
  const v = typeof version === 'string' && /^\d+$/.test(version) ? Number(version) : version;
  if (typeof v !== 'number' || !Number.isInteger(v)) return undefined;
  return (await one<{ body: string }>(db, 'SELECT body FROM revisions WHERE block_id = $1 AND version = $2', [blockId, v]))?.body;
}

async function diff(req: Request) {
  const id = await historyBlock(req.params.id);
  const from = await keptBody(id, req.query.get('from'));
  const to = await keptBody(id, req.query.get('to'));
  const errors = new FieldErrors();
  if (from === undefined) errors.add('from', 'That version is not kept.');
  if (to === undefined) errors.add('to', 'That version is not kept.');
  errors.throwIfAny();
  return ok({ from: Number(req.query.get('from')), to: Number(req.query.get('to')), ops: wordDiff(plainText(from as string), plainText(to as string)) });
}

async function restore(req: Request) {
  const body = objectBody(req);
  await transaction(async (tx) => {
    const requested = await blockOr404(tx, req.params.id);
    const origin = await lockOrigin(tx, requested);
    if (typeof body.base_version !== 'number' || !Number.isInteger(body.base_version)) throw validation({ base_version: 'Send the version you started from.' });
    if (body.base_version !== origin.version) throw await conflict(tx, requested.id);
    const kept = await keptBody(origin.id, body.version);
    if (kept === undefined) throw validation({ version: 'That version is not kept.' });
    await commitVersion(tx, origin, kept, 'restore', null, req.session.label, null);
  });
  return ok(blockJson(await blockOr404(db, req.params.id)));
}

async function searchBlocks(req: Request) {
  const q = (req.query.get('q') ?? '').trim();
  if ([...q].length > SEARCH_CAP) throw validation({ q: 'Search with at most 200 characters.' });
  const exclude = req.query.get('exclude_object_id');
  const rows = await db.query<{ id: string; object_id: string; title: string; plain: string }>(
    `SELECT b.id, b.object_id, o.title, b.plain FROM blocks b JOIN objects o ON o.id = b.object_id
      WHERE b.kind = 'text' AND ($1 = '' OR strpos(lower(b.plain), lower($1)) > 0)
        AND ($2::uuid IS NULL OR b.object_id <> $2::uuid)
      ORDER BY b.edited_at DESC, b.id LIMIT $3`, [q, isUuid(exclude) ? exclude : null, SEARCH_LIMIT]);
  return ok({ results: rows.map((r) => ({ block_id: r.id, object_id: r.object_id, object_title: r.title, excerpt: cut(r.plain, EXCERPT_CHARS) })) });
}

export const blockRoutes: Route[] = [
  route('POST', '/api/objects/:id/blocks', 'json', createBlock),
  route('GET', '/api/blocks/search', 'none', searchBlocks),
  route('PATCH', '/api/blocks/:id', 'json', patchBlock),
  route('DELETE', '/api/blocks/:id', 'none', deleteBlock),
  route('POST', '/api/blocks/:id/move', 'json', moveBlock),
  route('POST', '/api/blocks/:id/presence', 'json', postPresence),
  route('DELETE', '/api/blocks/:id/presence', 'none', deletePresence),
  route('GET', '/api/blocks/:id/revisions', 'none', revisions),
  route('GET', '/api/blocks/:id/diff', 'none', diff),
  route('POST', '/api/blocks/:id/restore', 'json', restore),
  route('POST', '/api/objects/:id/quotes', 'json', quoteBlock, { idempotent: true }),
];
