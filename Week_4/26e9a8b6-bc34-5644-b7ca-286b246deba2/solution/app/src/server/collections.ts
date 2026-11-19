import { randomUUID } from 'node:crypto';
import { requireUser } from './access';
import { guideById, isUuid, roleOf, visibleTo } from './content';
import { one, pool, transaction, type Db } from './db';
import { conflict, forbidden, invalid, notFound, unconfirmed } from './errors';
import { requiredText, type Ctx } from './http';
import { limits } from './config';
import { slugify } from './lifecycle';
import type { Visibility } from '../shared/types';

interface CollectionRow { id: string; slug: string; title: string; visibility: Visibility; owner_id: string; owner_name: string }

async function collectionFor(ctx: Ctx, id: string): Promise<CollectionRow> {
  const row = isUuid(id)
    ? await one<CollectionRow>(pool, 'SELECT c.id, c.slug, c.title, c.visibility, c.owner_id, u.name AS owner_name FROM collections c JOIN users u ON u.id = c.owner_id WHERE c.id = $1', [id])
    : undefined;
  if (!row || (row.visibility === 'private' && row.owner_id !== ctx.user?.id)) throw notFound();
  return row;
}

export async function createCollection(ctx: Ctx): Promise<unknown> {
  const user = requireUser(ctx, true);
  const body = await ctx.json();
  const title = requiredText(body, 'title', limits.guide_title_max);
  const { visibility } = body;
  if (visibility !== 'public' && visibility !== 'private') throw invalid('visibility');
  const id = randomUUID();
  const slug = slugify(title);
  await pool.query('INSERT INTO collections (id, slug, owner_id, title, visibility) VALUES ($1, $2, $3, $4, $5)', [id, slug, user.id, title, visibility]);
  return { id, slug, title };
}

async function visibleItems(db: Db, ctx: Ctx, collectionId: string): Promise<{ guide_id: string; title: string; slug: string; position: number }[]> {
  const rows = await db.query<{ guide_id: string; position: number }>('SELECT guide_id, position FROM collection_items WHERE collection_id = $1 ORDER BY position', [collectionId]);
  const items: { guide_id: string; title: string; slug: string; position: number }[] = [];
  for (const row of rows.rows) {
    const guide = await guideById(db, row.guide_id);
    if (!guide) continue;
    const role = await roleOf(db, guide, ctx.user);
    if (role !== 'none' || (visibleTo(guide, role) && guide.state === 'published')) items.push({ guide_id: guide.id, title: guide.title, slug: guide.slug, position: row.position });
  }
  return items;
}

export async function readCollection(ctx: Ctx): Promise<unknown> {
  const collection = await collectionFor(ctx, ctx.params.id!);
  return {
    id: collection.id, slug: collection.slug, title: collection.title, visibility: collection.visibility, owner_name: collection.owner_name,
    items: await visibleItems(pool, ctx, collection.id),
  };
}

export async function addItem(ctx: Ctx): Promise<unknown> {
  const user = requireUser(ctx);
  const collection = await collectionFor(ctx, ctx.params.id!);
  if (collection.owner_id !== user.id) throw forbidden();
  if (!user.confirmed) throw unconfirmed();
  const { guide_id: guideId } = await ctx.json();
  const guide = typeof guideId === 'string' ? await guideById(pool, guideId) : null;
  const role = guide ? await roleOf(pool, guide, user) : 'none';
  if (!guide || !visibleTo(guide, role) || (guide.state !== 'published' && guide.ownerId !== user.id)) throw notFound();
  return transaction(async (db) => {
    await db.query('SELECT 1 FROM collections WHERE id = $1 FOR UPDATE', [collection.id]);
    if (await one(db, 'SELECT 1 FROM collection_items WHERE collection_id = $1 AND guide_id = $2', [collection.id, guide.id])) throw conflict('already_in_collection');
    const next = await one<{ n: number }>(db, 'SELECT coalesce(max(position), 0) + 1 AS n FROM collection_items WHERE collection_id = $1', [collection.id]);
    await db.query('INSERT INTO collection_items (collection_id, guide_id, position) VALUES ($1, $2, $3)', [collection.id, guide.id, next!.n]);
    return { position: next!.n };
  });
}

export async function moveItem(ctx: Ctx): Promise<unknown> {
  const user = requireUser(ctx);
  const collection = await collectionFor(ctx, ctx.params.id!);
  if (collection.owner_id !== user.id) throw forbidden();
  if (!user.confirmed) throw unconfirmed();
  const { position } = await ctx.json();
  return transaction(async (db) => {
    await db.query('SELECT 1 FROM collections WHERE id = $1 FOR UPDATE', [collection.id]);
    const rows = await db.query<{ guide_id: string }>('SELECT guide_id FROM collection_items WHERE collection_id = $1 ORDER BY position', [collection.id]);
    const order = rows.rows.map((r) => r.guide_id);
    const from = order.indexOf(ctx.params.guideId!);
    if (from < 0) throw notFound();
    if (!Number.isInteger(position) || (position as number) < 1 || (position as number) > order.length) throw invalid('position');
    order.splice((position as number) - 1, 0, ...order.splice(from, 1));
    for (const [i, id] of order.entries()) await db.query('UPDATE collection_items SET position = $1 WHERE collection_id = $2 AND guide_id = $3', [i + 1, collection.id, id]);
    return { order };
  });
}
