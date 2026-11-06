import type { Reply, RequestContext } from '../http/router.js';
import { empty, json } from '../http/router.js';
import { ApiError, fieldError, notFound, validationFailed } from '../http/errors.js';
import { requireAuthorOrEditor } from './guards.js';
import { query, queryOne } from '../db/pool.js';
import { graphemeLength, uniqueSlug } from '../domain/text.js';

interface CollectionRow {
  id: number;
  slug: string;
  name: string;
}

export interface CollectionPayload {
  readonly slug: string;
  readonly name: string;
  readonly item_count: number;
  readonly models: readonly string[];
}

/** An item count is always a recount of the collection's rows. */
async function payload(row: CollectionRow): Promise<CollectionPayload> {
  const models = await query<{ slug: string }>(
    `SELECT m.slug FROM collection_items i JOIN models m ON m.id = i.model_id
     WHERE i.collection_id = $1 ORDER BY i.added_at, m.id`,
    [row.id],
  );
  return {
    slug: row.slug,
    name: row.name,
    item_count: models.length,
    models: models.map((m) => m.slug),
  };
}

async function loadCollection(slug: string): Promise<CollectionRow> {
  const row = await queryOne<CollectionRow>(
    `SELECT id, slug, name FROM collections WHERE slug = $1`,
    [slug],
  );
  if (row === null) throw notFound();
  return row;
}

async function loadModelId(slug: unknown): Promise<number> {
  if (typeof slug !== 'string') throw notFound();
  const row = await queryOne<{ id: number }>(`SELECT id FROM models WHERE slug = $1`, [slug]);
  if (row === null) throw notFound();
  return row.id;
}

async function validName(name: unknown, excludeId: number | null): Promise<string> {
  const value = typeof name === 'string' ? name.trim() : '';
  const length = graphemeLength(value);
  if (length < 1 || length > 60) throw validationFailed([fieldError('name', 'name')]);
  const clash = await queryOne<{ id: number }>(
    `SELECT id FROM collections WHERE lower(name) = lower($1)`,
    [value],
  );
  if (clash !== null && clash.id !== excludeId) {
    throw validationFailed([fieldError('name', 'name')]);
  }
  return value;
}

async function listHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthorOrEditor(ctx);
  const rows = await query<CollectionRow>(
    `SELECT id, slug, name FROM collections ORDER BY created_at, id`,
  );
  const items = [];
  for (const row of rows) items.push(await payload(row));
  return json(200, { items });
}

async function createHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthorOrEditor(ctx);
  const name = await validName(ctx.body.name, null);
  const taken = new Set<string>();
  let slug = uniqueSlug(name, (candidate) => taken.has(candidate));
  for (;;) {
    const clash = await queryOne<{ id: number }>(`SELECT id FROM collections WHERE slug = $1`, [slug]);
    if (clash === null) break;
    taken.add(slug);
    slug = uniqueSlug(name, (candidate) => taken.has(candidate));
  }
  const row = await queryOne<CollectionRow>(
    `INSERT INTO collections (slug, name) VALUES ($1, $2) RETURNING id, slug, name`,
    [slug, name],
  );
  if (row === null) throw new Error('Collection row was not created');
  return json(201, await payload(row));
}

async function renameHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthorOrEditor(ctx);
  const collection = await loadCollection(ctx.params.collection ?? '');
  const name = await validName(ctx.body.name, collection.id);
  await query(`UPDATE collections SET name = $2 WHERE id = $1`, [collection.id, name]);
  return json(200, await payload({ ...collection, name }));
}

async function deleteHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthorOrEditor(ctx);
  const collection = await loadCollection(ctx.params.collection ?? '');
  await query(`DELETE FROM collections WHERE id = $1`, [collection.id]);
  return empty(204);
}

async function addItemHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthorOrEditor(ctx);
  const collection = await loadCollection(ctx.params.collection ?? '');
  const modelId = await loadModelId(ctx.body.model);
  const inserted = await query<{ model_id: number }>(
    `INSERT INTO collection_items (collection_id, model_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING model_id`,
    [collection.id, modelId],
  );
  if (inserted.length === 0) throw new ApiError('already_in_collection');
  return json(201, await payload(collection));
}

async function removeItemHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthorOrEditor(ctx);
  const collection = await loadCollection(ctx.params.collection ?? '');
  const modelId = await loadModelId(ctx.params.slug);
  const removed = await query<{ model_id: number }>(
    `DELETE FROM collection_items WHERE collection_id = $1 AND model_id = $2 RETURNING model_id`,
    [collection.id, modelId],
  );
  if (removed.length === 0) throw notFound();
  return empty(204);
}

async function moveItemHandler(ctx: RequestContext): Promise<Reply> {
  requireAuthorOrEditor(ctx);
  const from = await loadCollection(ctx.params.collection ?? '');
  const modelId = await loadModelId(ctx.params.slug);
  const to = await loadCollection(typeof ctx.body.to === 'string' ? ctx.body.to : '');

  const present = await queryOne<{ model_id: number }>(
    `SELECT model_id FROM collection_items WHERE collection_id = $1 AND model_id = $2`,
    [from.id, modelId],
  );
  if (present === null) throw notFound();
  const already = await queryOne<{ model_id: number }>(
    `SELECT model_id FROM collection_items WHERE collection_id = $1 AND model_id = $2`,
    [to.id, modelId],
  );
  if (already !== null) throw new ApiError('already_in_collection');

  await query(`DELETE FROM collection_items WHERE collection_id = $1 AND model_id = $2`, [
    from.id,
    modelId,
  ]);
  await query(`INSERT INTO collection_items (collection_id, model_id) VALUES ($1, $2)`, [
    to.id,
    modelId,
  ]);
  return json(200, { from: await payload(from), to: await payload(to) });
}

export const collectionsHandlerSet = {
  list: listHandler,
  create: createHandler,
  rename: renameHandler,
  remove: deleteHandler,
  addItem: addItemHandler,
  removeItem: removeItemHandler,
  moveItem: moveItemHandler,
};
