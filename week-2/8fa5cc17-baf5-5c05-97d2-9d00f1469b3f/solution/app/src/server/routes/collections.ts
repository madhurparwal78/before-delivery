// Collections, their boards and their share links.
import { randomBytes, randomUUID } from 'node:crypto';
import { db, one, transaction, type Tx } from '../db.ts';
import { apiError, FieldErrors, notFound, validation, type Json } from '../errors.ts';
import { emit } from '../events.ts';
import { isUuid, noContent, objectBody, ok, route, type Request, type Route } from '../http.ts';
import { fieldsOf, objectJson, OBJECT_SELECT, type ObjectRow } from '../model.ts';
import { ACTIVE_LINK_SQL, dropLinkCache, linkStatus, shareLinkJson, SHARE_LINK_SELECT, type ShareLinkRow } from '../share.ts';
import { loadSettings } from '../workspace.ts';
import { byTitle } from './objects.ts';
import { defaultPosition, validCoord } from '../../shared/board.ts';
import { compareIds, compareText } from '../../shared/query.ts';
import { isLocalMinute, localMinute, localMinuteToInstant } from '../../shared/time.ts';

const MAX_DAYS_MS = 90 * 86_400_000;
const MAX_POSITIONS = 200;
const NAME_LIMIT = 120;

async function collectionOr404(q: Tx | typeof db, id: string): Promise<{ id: string; name: string }> {
  const row = await one<{ id: string; name: string }>(q, 'SELECT id, name FROM collections WHERE id = $1', [id]);
  if (!row) throw notFound();
  return row;
}

async function listCollections() {
  const rows = await db.query<{ id: string; name: string; object_count: number }>(
    `SELECT c.id, c.name, (SELECT count(*)::int FROM collection_members m WHERE m.collection_id = c.id) AS object_count FROM collections c`);
  return ok({ collections: rows.sort((a, b) => compareText(a.name, b.name) || compareIds(a.id, b.id)) });
}

async function createCollection(req: Request) {
  const body = objectBody(req);
  const created = await transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(18473)');
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || [...name].length > NAME_LIMIT) throw validation({ name: 'Give the collection a name.' });
    if ((await tx.query('SELECT 1 FROM collections WHERE lower(name) = lower($1)', [name])).length) {
      throw validation({ name: 'A collection with this name already exists.' });
    }
    const id = randomUUID();
    await tx.query('INSERT INTO collections (id, name, created_at) VALUES ($1, $2, now())', [id, name]);
    return { id, name, object_count: 0 };
  });
  return ok(created, 201);
}

async function members(collectionId: string): Promise<ObjectRow[]> {
  return byTitle(await db.query<ObjectRow>(
    `${OBJECT_SELECT} WHERE o.id IN (SELECT object_id FROM collection_members WHERE collection_id = $1)`, [collectionId]));
}

async function getCollection(req: Request) {
  const c = await collectionOr404(db, req.params.id);
  const objects: Json[] = [];
  for (const o of await members(c.id)) objects.push(objectJson(o, await fieldsOf(db, o.type_id)));
  return ok({ id: c.id, name: c.name, objects });
}

async function addMember(req: Request) {
  const body = objectBody(req);
  await transaction(async (tx) => {
    await collectionOr404(tx, req.params.id);
    const exists = isUuid(body.object_id) && (await tx.query('SELECT 1 FROM objects WHERE id = $1', [body.object_id])).length > 0;
    if (!exists) throw validation({ object_id: 'That note no longer exists.' });
    const added = await tx.query('INSERT INTO collection_members (collection_id, object_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING object_id',
      [req.params.id, body.object_id]);
    if (added.length) await emit(tx, 'object.saved', { object_id: body.object_id as string });
  });
  return noContent();
}

async function removeMember(req: Request) {
  await transaction(async (tx) => {
    await collectionOr404(tx, req.params.id);
    const removed = await tx.query('DELETE FROM collection_members WHERE collection_id = $1 AND object_id = $2 RETURNING object_id',
      [req.params.id, req.params.objectId]);
    if (!removed.length) throw notFound();
    await tx.query('DELETE FROM board_positions WHERE collection_id = $1 AND object_id = $2', [req.params.id, req.params.objectId]);
    await emit(tx, 'object.saved', { object_id: req.params.objectId });
  });
  return noContent();
}

async function deleteCollection(req: Request) {
  const revoked = await transaction(async (tx) => {
    await collectionOr404(tx, req.params.id);
    const links = await tx.query<{ id: string }>(
      `UPDATE share_links SET revoked_at = now() WHERE collection_id = $1 AND ${ACTIVE_LINK_SQL} RETURNING id`, [req.params.id]);
    const memberIds = await tx.query<{ object_id: string }>('SELECT object_id FROM collection_members WHERE collection_id = $1', [req.params.id]);
    await tx.query('DELETE FROM collections WHERE id = $1', [req.params.id]);
    for (const l of links) await emit(tx, 'share_link.changed', { collection_id: req.params.id, share_link_id: l.id });
    for (const m of memberIds) await emit(tx, 'object.saved', { object_id: m.object_id });
    return links.map((l) => l.id);
  });
  for (const id of revoked) await dropLinkCache(id);
  return noContent();
}

// --- Boards -------------------------------------------------------------------

async function boardJson(collectionId: string): Promise<Json> {
  const objects = await members(collectionId);
  const stored = new Map((await db.query<{ object_id: string; x: number; y: number }>(
    'SELECT object_id, x, y FROM board_positions WHERE collection_id = $1', [collectionId])).map((p) => [p.object_id, p]));
  const ids = new Set(objects.map((o) => o.id));
  const edges = await db.query<{ id: string; from_object_id: string; to_object_id: string }>(
    'SELECT id, from_object_id, to_object_id FROM link_edges WHERE from_object_id = ANY($1::uuid[]) AND to_object_id = ANY($1::uuid[]) ORDER BY id', [[...ids]]);
  return {
    collection_id: collectionId,
    cards: objects.map((o, i) => {
      const p = stored.get(o.id);
      const at = p ?? defaultPosition(i);
      return { object_id: o.id, title: o.title, x: at.x, y: at.y, stored: Boolean(p) };
    }),
    edges: edges.map((e) => ({ id: e.id, from: e.from_object_id, to: e.to_object_id })),
  };
}

async function getBoard(req: Request) {
  await collectionOr404(db, req.params.id);
  return ok(await boardJson(req.params.id));
}

async function putBoard(req: Request) {
  const body = objectBody(req);
  await transaction(async (tx) => {
    await collectionOr404(tx, req.params.id);
    const positions = Array.isArray(body.positions) ? body.positions : null;
    if (!positions || positions.length < 1 || positions.length > MAX_POSITIONS) throw validation({ positions: 'Send 1 to 200 positions.' });
    const memberIds = new Set((await tx.query<{ object_id: string }>('SELECT object_id FROM collection_members WHERE collection_id = $1', [req.params.id])).map((r) => r.object_id));
    const errors = new FieldErrors();
    const clean: Array<{ object_id: string; x: number; y: number }> = [];
    positions.forEach((p: unknown, i: number) => {
      const e = p !== null && typeof p === 'object' ? (p as Record<string, unknown>) : {};
      if (!isUuid(e.object_id) || !memberIds.has(e.object_id)) errors.add(`positions.${i}.object_id`, 'That note is not in this collection.');
      if (!validCoord(e.x as number)) errors.add(`positions.${i}.x`, 'Use a multiple of 8 between -8000 and 8000.');
      if (!validCoord(e.y as number)) errors.add(`positions.${i}.y`, 'Use a multiple of 8 between -8000 and 8000.');
      clean.push({ object_id: e.object_id as string, x: e.x as number, y: e.y as number });
    });
    errors.throwIfAny();
    for (const p of clean) {
      await tx.query(`INSERT INTO board_positions (collection_id, object_id, x, y) VALUES ($1, $2, $3, $4)
                      ON CONFLICT (collection_id, object_id) DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y`, [req.params.id, p.object_id, p.x, p.y]);
    }
    await emit(tx, 'board.saved', { collection_id: req.params.id, positions: clean });
  });
  return ok(await boardJson(req.params.id));
}

// --- Share links ----------------------------------------------------------------

async function listLinks(req: Request) {
  await collectionOr404(db, req.params.id);
  const { home_time_zone: zone } = await loadSettings(db);
  const rows = await db.query<ShareLinkRow>(`${SHARE_LINK_SELECT} WHERE collection_id = $1 ORDER BY created_at DESC, id DESC`, [req.params.id]);
  return ok({ share_links: rows.map((l) => shareLinkJson(l, zone)) });
}

const newToken = (): string => randomBytes(24).toString('base64url');

async function insertLink(tx: Tx, collectionId: string, expires: Date): Promise<ShareLinkRow> {
  const [row] = await tx.query<ShareLinkRow>(
    `INSERT INTO share_links (id, collection_id, token, expires_at, created_at) VALUES ($1, $2, $3, $4, clock_timestamp())
     RETURNING id, collection_id, token, expires_at, created_at, revoked_at`, [randomUUID(), collectionId, newToken(), expires]);
  await emit(tx, 'share_link.changed', { collection_id: collectionId, share_link_id: row.id });
  return row;
}

async function createLink(req: Request) {
  const body = objectBody(req);
  const { home_time_zone: zone } = await loadSettings(db);
  const link = await transaction(async (tx) => {
    await collectionOr404(tx, req.params.id);
    const value = body.expires_at;
    if (!isLocalMinute(value)) throw validation({ expires_at: 'Use a date and time.' });
    const instant = localMinuteToInstant(value, zone);
    if (instant === null) throw validation({ expires_at: 'That time does not exist in your home clock.' });
    const now = Date.now();
    if (value <= localMinute(now, zone)) throw validation({ expires_at: 'Choose a time after the current minute.' });
    if (instant - now > MAX_DAYS_MS) throw validation({ expires_at: 'Links can last at most 90 days.' });
    return insertLink(tx, req.params.id, new Date(instant));
  });
  return ok(shareLinkJson(link, zone), 201);
}

/** Ends an active link; of simultaneous requests exactly one wins and the rest see it revoked. */
async function endLink(tx: Tx, id: string): Promise<ShareLinkRow> {
  const current = await one<ShareLinkRow>(tx, `${SHARE_LINK_SELECT} WHERE id = $1`, [id]);
  if (!current) throw notFound();
  const [ended] = await tx.query<ShareLinkRow>(
    `UPDATE share_links SET revoked_at = clock_timestamp() WHERE id = $1 AND ${ACTIVE_LINK_SQL}
     RETURNING id, collection_id, token, expires_at, created_at, revoked_at`, [id]);
  if (!ended) {
    const fresh = await one<ShareLinkRow>(tx, `${SHARE_LINK_SELECT} WHERE id = $1`, [id]);
    throw apiError(409, 'link_not_active', { status: linkStatus(fresh ?? current) });
  }
  await emit(tx, 'share_link.changed', { collection_id: ended.collection_id, share_link_id: ended.id });
  return ended;
}

async function revokeLink(req: Request) {
  const { home_time_zone: zone } = await loadSettings(db);
  const ended = await transaction((tx) => endLink(tx, req.params.id));
  await dropLinkCache(ended.id);
  return ok(shareLinkJson(ended, zone));
}

async function regenerateLink(req: Request) {
  const { home_time_zone: zone } = await loadSettings(db);
  const { ended, fresh } = await transaction(async (tx) => {
    const old = await endLink(tx, req.params.id);
    return { ended: old, fresh: await insertLink(tx, old.collection_id, old.expires_at) };
  });
  await dropLinkCache(ended.id);
  return ok(shareLinkJson(fresh, zone), 201);
}

export const collectionRoutes: Route[] = [
  route('GET', '/api/collections', 'none', listCollections),
  route('POST', '/api/collections', 'json', createCollection),
  route('GET', '/api/collections/:id', 'none', getCollection),
  route('DELETE', '/api/collections/:id', 'none', deleteCollection),
  route('POST', '/api/collections/:id/objects', 'json', addMember),
  route('DELETE', '/api/collections/:id/objects/:objectId', 'none', removeMember),
  route('GET', '/api/collections/:id/board', 'none', getBoard),
  route('PUT', '/api/collections/:id/board', 'json', putBoard),
  route('GET', '/api/collections/:id/share-links', 'none', listLinks),
  route('POST', '/api/collections/:id/share-links', 'json', createLink),
  route('POST', '/api/share-links/:id/revoke', 'none', revokeLink),
  route('POST', '/api/share-links/:id/regenerate', 'none', regenerateLink),
];
