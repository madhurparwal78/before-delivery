// Object types, typed fields and objects.
import { randomUUID } from 'node:crypto';
import { db, one, transaction, type Tx } from '../db.ts';
import { apiError, FieldErrors, notFound, validation, type Json } from '../errors.ts';
import { announceCounts, lockObjects, setRelationEdge } from '../edges.ts';
import { emit } from '../events.ts';
import { isUuid, noContent, objectBody, ok, route, type Request, type Route } from '../http.ts';
import { fieldsOf, fullObject, loadObject, loadTypes, objectJson, OBJECT_SELECT, typeJson, type FieldRow, type ObjectRow } from '../model.ts';
import { checkProperties } from '../properties.ts';
import { deleteEventually } from '../storage.ts';
import { compareIds, compareText } from '../../shared/query.ts';

const NAME_LIMIT = 60;
const TITLE_LIMIT = 200;
const KINDS = ['text', 'number', 'date', 'url', 'select', 'relation'];
/** The built-in Daily note type's place in library order. */
export const DAILY_RANK = 3;
const codePoints = (s: string): number => [...s].length;

interface FieldInput { name: string; kind: string; required: boolean; options: string[] | null; target_type_id: string | null }

/** Checks one field; `prefix` is `fields.<i>.` on type creation and empty when adding a field. */
async function checkField(tx: Tx, raw: unknown, prefix: string, taken: string[], errors: FieldErrors): Promise<FieldInput> {
  const f = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const name = typeof f.name === 'string' ? f.name.trim() : '';
  if (!name || codePoints(name) > NAME_LIMIT) errors.add(`${prefix}name`, 'Give the field a name.');
  else if (taken.includes(name.toLowerCase())) errors.add(`${prefix}name`, 'Field names must be different.');
  const kind = typeof f.kind === 'string' ? f.kind : '';
  if (!KINDS.includes(kind)) errors.add(`${prefix}kind`, 'Choose text, number, date, url, select or relation.');
  let options: string[] | null = null;
  if (kind === 'select') {
    options = Array.isArray(f.options)
      ? [...new Set(f.options.filter((o): o is string => typeof o === 'string').map((o) => o.trim()).filter(Boolean))]
      : [];
    if (!options.length) errors.add(`${prefix}options`, 'Add at least one option.');
  }
  let target: string | null = null;
  if (kind === 'relation') {
    const found = isUuid(f.target_type_id) ? await tx.query('SELECT 1 FROM object_types WHERE id = $1', [f.target_type_id]) : [];
    if (!found.length) errors.add(`${prefix}target_type_id`, 'Choose the type this field links to.');
    else target = f.target_type_id as string;
  }
  return { name, kind, required: f.required === true, options, target_type_id: target };
}

async function insertField(tx: Tx, typeId: string, field: FieldInput): Promise<void> {
  const [{ n }] = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM fields WHERE type_id = $1', [typeId]);
  await tx.query(
    'INSERT INTO fields (id, type_id, position, name, kind, required, options, target_type_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [randomUUID(), typeId, n, field.name, field.kind, field.required, field.options ? JSON.stringify(field.options) : null, field.target_type_id]);
}

async function typeById(q: Tx | typeof db, id: string): Promise<Json> {
  const t = (await loadTypes(q)).find((x) => x.id === id);
  if (!t) throw notFound();
  return typeJson(t);
}

async function listTypes() {
  return ok({ types: (await loadTypes(db)).map(typeJson) });
}

async function createType(req: Request) {
  const body = objectBody(req);
  const created = await transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(18472)');
    const errors = new FieldErrors();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || codePoints(name) > NAME_LIMIT) errors.add('name', 'Give the type a name.');
    else if ((await tx.query('SELECT 1 FROM object_types WHERE lower(name) = lower($1)', [name])).length) {
      errors.add('name', 'A type with this name already exists.');
    }
    const fields: FieldInput[] = [];
    const rawFields = Array.isArray(body.fields) ? body.fields : [];
    for (const [i, raw] of rawFields.entries()) {
      fields.push(await checkField(tx, raw, `fields.${i}.`, fields.map((f) => f.name.toLowerCase()), errors));
    }
    errors.throwIfAny();
    const id = randomUUID();
    await tx.query('INSERT INTO object_types (id, name, builtin_rank, created_at) VALUES ($1, $2, NULL, clock_timestamp())', [id, name]);
    for (const f of fields) await insertField(tx, id, f);
    return typeById(tx, id);
  });
  return ok(created, 201);
}

async function addField(req: Request) {
  const body = objectBody(req);
  const result = await transaction(async (tx) => {
    const type = await one<{ builtin_rank: number | null }>(tx, 'SELECT builtin_rank FROM object_types WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!type) throw notFound();
    if (type.builtin_rank === DAILY_RANK) throw apiError(409, 'builtin_type');
    const errors = new FieldErrors();
    const taken = (await fieldsOf(tx, req.params.id)).map((f) => f.name.toLowerCase());
    const field = await checkField(tx, body, '', taken, errors);
    errors.throwIfAny();
    await insertField(tx, req.params.id, field);
    return typeById(tx, req.params.id);
  });
  return ok(result, 201);
}

async function deleteType(req: Request) {
  await transaction(async (tx) => {
    const type = await one<{ builtin_rank: number | null }>(tx, 'SELECT builtin_rank FROM object_types WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!type) throw notFound();
    if (type.builtin_rank !== null) throw apiError(409, 'builtin_type');
    const used = await tx.query(
      'SELECT 1 FROM objects WHERE type_id = $1 UNION ALL SELECT 1 FROM fields WHERE target_type_id = $1 AND type_id <> $1 LIMIT 1', [req.params.id]);
    if (used.length) throw apiError(409, 'type_in_use');
    await tx.query('DELETE FROM object_types WHERE id = $1', [req.params.id]);
  });
  return noContent();
}

export function byTitle<T extends { title: string; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => compareText(a.title, b.title) || compareIds(a.id, b.id));
}

async function listObjects(req: Request) {
  const typeId = req.query.get('type_id');
  if (!isUuid(typeId)) throw validation({ type_id: 'Choose a type.' });
  const rows = await db.query<ObjectRow>(`${OBJECT_SELECT} WHERE o.type_id = $1`, [typeId]);
  const fields = await fieldsOf(db, typeId);
  return ok({ objects: byTitle(rows).map((o) => objectJson(o, fields)) });
}

function checkTitle(value: unknown, errors: FieldErrors): string {
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title || codePoints(title) > TITLE_LIMIT) errors.add('title', 'Give the note a title.');
  return title;
}

/** Writes relation edges for every relation field whose value changed; returns objects whose counts changed. */
async function syncRelations(tx: Tx, objectId: string, fields: FieldRow[], before: Record<string, Json>, after: Record<string, Json>): Promise<string[]> {
  const touched: string[] = [];
  for (const f of fields) {
    if (f.kind !== 'relation' || (before[f.name] ?? null) === (after[f.name] ?? null)) continue;
    touched.push(...await setRelationEdge(tx, objectId, f.name, (after[f.name] as string | null) ?? null));
  }
  return touched;
}

async function createObject(req: Request) {
  const body = objectBody(req);
  const id = randomUUID();
  await transaction(async (tx) => {
    const errors = new FieldErrors();
    const type = isUuid(body.type_id)
      ? await one<{ builtin_rank: number | null }>(tx, 'SELECT builtin_rank FROM object_types WHERE id = $1', [body.type_id])
      : undefined;
    if (!type) errors.add('type_id', 'Choose a type.');
    else if (type.builtin_rank === DAILY_RANK) errors.add('type_id', 'Daily notes are created from Today.');
    const title = checkTitle(body.title, errors);
    const fields = type ? await fieldsOf(tx, body.type_id as string) : [];
    const properties = type ? await checkProperties(tx, fields, body.properties, {}, errors, { creating: true, objectId: null }) : {};
    errors.throwIfAny();
    const targets = fields.filter((f) => f.kind === 'relation').map((f) => properties[f.name]).filter((v): v is string => typeof v === 'string');
    await lockObjects(tx, targets);
    await tx.query(
      `INSERT INTO objects (id, type_id, title, properties, share_visibility, created_at, updated_at) VALUES ($1, $2, $3, $4, 'follow', now(), now())`,
      [id, body.type_id, title, JSON.stringify(properties)]);
    const touched = await syncRelations(tx, id, fields, {}, properties);
    await emit(tx, 'object.saved', { object_id: id });
    await announceCounts(tx, touched);
  });
  return ok((await fullObject(db, id)) ?? null, 201);
}

async function getObject(req: Request) {
  const object = await fullObject(db, req.params.id);
  if (!object) throw notFound();
  return ok(object);
}

async function patchObject(req: Request) {
  const body = objectBody(req);
  await transaction(async (tx) => {
    const existing = await one<{ type_id: string; properties: Record<string, Json> }>(
      tx, 'SELECT type_id, properties FROM objects WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!existing) throw notFound();
    const errors = new FieldErrors();
    const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(body, k);
    const title = has('title') ? checkTitle(body.title, errors) : null;
    const fields = await fieldsOf(tx, existing.type_id);
    const properties = has('properties')
      ? await checkProperties(tx, fields, body.properties, existing.properties, errors, { creating: false, objectId: req.params.id })
      : existing.properties;
    if (has('share_visibility') && body.share_visibility !== 'follow' && body.share_visibility !== 'never') {
      errors.add('share_visibility', 'Choose follow or never.');
    }
    errors.throwIfAny();
    const targets = fields.filter((f) => f.kind === 'relation')
      .flatMap((f) => [existing.properties[f.name], properties[f.name]]).filter((v): v is string => typeof v === 'string');
    await lockObjects(tx, targets);
    await tx.query(
      `UPDATE objects SET title = COALESCE($2, title), properties = $3, share_visibility = COALESCE($4, share_visibility), updated_at = now() WHERE id = $1`,
      [req.params.id, title, JSON.stringify(properties), has('share_visibility') ? body.share_visibility : null]);
    const touched = await syncRelations(tx, req.params.id, fields, existing.properties, properties);
    await emit(tx, 'object.saved', { object_id: req.params.id });
    await announceCounts(tx, touched);
  });
  return ok((await fullObject(db, req.params.id)) ?? null);
}

/** Deletes an object and everything that pointed into it, in one transaction. */
async function deleteObject(req: Request) {
  const keys = await transaction(async (tx) => {
    const target = await loadObject(tx, req.params.id);
    if (!target) throw notFound();
    const outgoing = await tx.query<{ to_object_id: string }>('SELECT DISTINCT to_object_id FROM link_edges WHERE from_object_id = $1', [req.params.id]);
    // Quotes elsewhere of this object's blocks.
    const quotes = await tx.query<{ id: string; object_id: string }>(
      `SELECT q.id, q.object_id FROM blocks q JOIN blocks ob ON ob.id = q.origin_block_id
        WHERE ob.object_id = $1 AND q.object_id <> $1`, [req.params.id]);
    // Relation values elsewhere that point at it.
    const holders = await tx.query<{ id: string; type_id: string; name: string }>(
      `SELECT o.id, o.type_id, f.name FROM objects o JOIN fields f ON f.type_id = o.type_id
        WHERE f.kind = 'relation' AND o.properties ->> f.name = $1 AND o.id::text <> $1`, [req.params.id]);
    await lockObjects(tx, [req.params.id, ...outgoing.map((r) => r.to_object_id), ...quotes.map((q) => q.object_id), ...holders.map((h) => h.id)]);
    for (const q of quotes) await tx.query('DELETE FROM blocks WHERE id = $1', [q.id]);
    for (const hostId of new Set(quotes.map((q) => q.object_id))) await renumber(tx, hostId);
    for (const h of holders) {
      await tx.query(`UPDATE objects SET properties = jsonb_set(properties, ARRAY[$2::text], 'null'::jsonb), updated_at = now() WHERE id = $1`, [h.id, h.name]);
    }
    const attachments = await tx.query<{ storage_key: string }>('SELECT storage_key FROM attachments WHERE object_id = $1', [req.params.id]);
    await tx.query('DELETE FROM presence WHERE block_id IN (SELECT id FROM blocks WHERE object_id = $1)', [req.params.id]);
    await tx.query('UPDATE blocks SET origin_block_id = NULL WHERE object_id = $1', [req.params.id]);
    await tx.query('DELETE FROM objects WHERE id = $1', [req.params.id]);
    for (const q of quotes) await emit(tx, 'block.removed', { object_id: q.object_id, block_id: q.id });
    for (const h of new Set(holders.map((x) => x.id))) await emit(tx, 'object.saved', { object_id: h });
    await emit(tx, 'object.removed', { object_id: req.params.id });
    await announceCounts(tx, outgoing.map((r) => r.to_object_id));
    return attachments.map((a) => a.storage_key);
  });
  deleteEventually(keys);
  return noContent();
}

/** Positions in an object close up and renumber from 1. */
export async function renumber(tx: Tx, objectId: string): Promise<void> {
  await tx.query(
    `UPDATE blocks b SET position = r.n FROM (SELECT id, row_number() OVER (ORDER BY position, id) AS n FROM blocks WHERE object_id = $1) r
      WHERE b.id = r.id AND b.position <> r.n`, [objectId]);
}

async function backlinks(req: Request) {
  if (!(await loadObject(db, req.params.id))) throw notFound();
  const rows = await db.query<{ edge_id: string; from_object_id: string; from_title: string; kind: string; field_name: string | null; block_id: string | null; created_at: Date }>(
    `SELECT le.id AS edge_id, le.from_object_id, o.title AS from_title, le.kind, le.field_name, le.quote_block_id AS block_id, le.created_at
       FROM link_edges le JOIN objects o ON o.id = le.from_object_id
      WHERE le.to_object_id = $1 ORDER BY le.created_at DESC, le.id DESC`, [req.params.id]);
  return ok({
    count: rows.length,
    backlinks: rows.map((r) => ({ edge_id: r.edge_id, from_object_id: r.from_object_id, from_title: r.from_title, kind: r.kind, field_name: r.field_name, block_id: r.block_id })),
  });
}

export const objectRoutes: Route[] = [
  route('GET', '/api/types', 'none', listTypes),
  route('POST', '/api/types', 'json', createType),
  route('POST', '/api/types/:id/fields', 'json', addField),
  route('DELETE', '/api/types/:id', 'none', deleteType),
  route('GET', '/api/objects', 'none', listObjects),
  route('POST', '/api/objects', 'json', createObject),
  route('GET', '/api/objects/:id', 'none', getObject),
  route('PATCH', '/api/objects/:id', 'json', patchObject),
  route('DELETE', '/api/objects/:id', 'none', deleteObject),
  route('GET', '/api/objects/:id/backlinks', 'none', backlinks),
];
