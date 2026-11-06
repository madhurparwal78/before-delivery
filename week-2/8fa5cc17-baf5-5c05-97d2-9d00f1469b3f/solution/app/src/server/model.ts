// Loading records and writing them as the API's object, block and type JSON.
import type { Db } from './db.ts';
import type { Json } from './errors.ts';

export const iso = (d: unknown): string => (d instanceof Date ? d : new Date(String(d))).toISOString();

/** The backlink count: the number of stored link edges ending at an object. */
export const BACKLINKS_SQL = (objectColumn: string): string =>
  `(SELECT count(*)::int FROM link_edges le WHERE le.to_object_id = ${objectColumn})`;

export async function backlinkCount(q: Db, objectId: string): Promise<number> {
  const [row] = await q.query<{ n: number }>(`SELECT ${BACKLINKS_SQL('$1::uuid')} AS n`, [objectId]);
  return row.n;
}

export interface FieldRow { name: string; kind: string; required: boolean; options: string[] | null; target_type_id: string | null }
export interface TypeRow { id: string; name: string; builtin: boolean; fields: FieldRow[] }

export const LIBRARY_ORDER = 'ORDER BY t.builtin_rank NULLS LAST, t.created_at, t.id';

export async function loadTypes(q: Db): Promise<TypeRow[]> {
  const types = await q.query<{ id: string; name: string; builtin: boolean }>(
    `SELECT t.id, t.name, t.builtin_rank IS NOT NULL AS builtin FROM object_types t ${LIBRARY_ORDER}`);
  const fields = await q.query<FieldRow & { type_id: string }>(
    'SELECT type_id, name, kind, required, options, target_type_id FROM fields ORDER BY position');
  return types.map((t) => ({ ...t, fields: fields.filter((f) => f.type_id === t.id).map(({ type_id: _t, ...f }) => f) }));
}

export function typeJson(t: TypeRow): Json {
  return {
    id: t.id, name: t.name, builtin: t.builtin,
    fields: t.fields.map((f) => ({ name: f.name, kind: f.kind, required: f.required, options: f.options, target_type_id: f.target_type_id })),
  };
}

export interface ObjectRow {
  id: string; type_id: string; type_name: string; title: string; daily_date: string | null;
  properties: Record<string, Json>; share_visibility: string; collection_ids: string[]; backlinks: number;
  created_at: Date; updated_at: Date;
}

export const OBJECT_SELECT = `
  SELECT o.id, o.type_id, t.name AS type_name, o.title, o.daily_date, o.properties, o.share_visibility,
         COALESCE((SELECT array_agg(cm.collection_id::text ORDER BY cm.collection_id) FROM collection_members cm WHERE cm.object_id = o.id), '{}') AS collection_ids,
         ${BACKLINKS_SQL('o.id')} AS backlinks, o.created_at, o.updated_at
    FROM objects o JOIN object_types t ON t.id = o.type_id`;

export function objectJson(o: ObjectRow, fields: FieldRow[], blocks?: Json[]): Json {
  const properties: Record<string, Json> = {};
  for (const f of fields) properties[f.name] = o.properties[f.name] ?? null;
  return {
    id: o.id, type_id: o.type_id, type_name: o.type_name, title: o.title, daily_date: o.daily_date, properties,
    share_visibility: o.share_visibility, collection_ids: o.collection_ids, backlinks: o.backlinks,
    created_at: iso(o.created_at), updated_at: iso(o.updated_at), ...(blocks ? { blocks } : {}),
  };
}

export async function fieldsOf(q: Db, typeId: string): Promise<FieldRow[]> {
  return q.query<FieldRow>('SELECT name, kind, required, options, target_type_id FROM fields WHERE type_id = $1 ORDER BY position', [typeId]);
}

export async function loadObject(q: Db, id: string): Promise<ObjectRow | undefined> {
  return (await q.query<ObjectRow>(`${OBJECT_SELECT} WHERE o.id = $1`, [id]))[0];
}

export interface BlockRow {
  id: string; object_id: string; kind: 'text' | 'quote' | 'attachment'; position: number;
  body: string | null; version: number | null;
  origin_block_id: string | null; origin_object_id: string | null; origin_title: string | null; origin_backlinks: number | null;
  attachment_id: string | null; filename: string | null; content_type: string | null; size_bytes: number | null;
}

export const BLOCK_SELECT = `
  SELECT b.id, b.object_id, b.kind, b.position,
         COALESCE(ob.body, b.body) AS body, COALESCE(ob.version, b.version) AS version,
         ob.id AS origin_block_id, ob.object_id AS origin_object_id, oo.title AS origin_title,
         CASE WHEN ob.id IS NULL THEN NULL ELSE ${BACKLINKS_SQL('ob.object_id')} END AS origin_backlinks,
         a.id AS attachment_id, a.filename, a.content_type, a.size_bytes
    FROM blocks b
    LEFT JOIN blocks ob ON ob.id = b.origin_block_id
    LEFT JOIN objects oo ON oo.id = ob.object_id
    LEFT JOIN attachments a ON a.id = b.attachment_id`;

export function blockJson(b: BlockRow): Json {
  return {
    id: b.id, object_id: b.object_id, kind: b.kind, position: b.position,
    body: b.kind === 'attachment' ? null : b.body, version: b.kind === 'attachment' ? null : b.version,
    origin: b.origin_block_id
      ? { block_id: b.origin_block_id, object_id: b.origin_object_id, object_title: b.origin_title, backlinks: b.origin_backlinks }
      : null,
    attachment: b.attachment_id
      ? { id: b.attachment_id, filename: b.filename, content_type: b.content_type, size_bytes: b.size_bytes }
      : null,
  };
}

export async function loadBlocks(q: Db, objectId: string): Promise<BlockRow[]> {
  return q.query<BlockRow>(`${BLOCK_SELECT} WHERE b.object_id = $1 ORDER BY b.position`, [objectId]);
}

export async function loadBlock(q: Db, id: string): Promise<BlockRow | undefined> {
  return (await q.query<BlockRow>(`${BLOCK_SELECT} WHERE b.id = $1`, [id]))[0];
}

/** The full object JSON with its blocks, or undefined when it does not exist. */
export async function fullObject(q: Db, id: string): Promise<Json | undefined> {
  const o = await loadObject(q, id);
  if (!o) return undefined;
  return objectJson(o, await fieldsOf(q, o.type_id), (await loadBlocks(q, id)).map(blockJson));
}
