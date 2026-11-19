import type { Collection } from '../../shared/api';
import { requireUser } from '../auth';
import { one, query } from '../db';
import { penSummary, PEN_SELECT, requireVisiblePen, type PenRow } from '../domain/pens';
import { requireTitle, validationError } from '../domain/validate';
import { apiError, notFound } from '../errors';
import { json, noContent, type Ctx, type Reply, type Router } from '../http';
import { newId } from '../util';

interface CollectionRow {
  id: string;
  owner_id: string;
  title: string;
}

const requireOwnCollection = async (id: string, ownerId: string): Promise<CollectionRow> => {
  const row = await one<CollectionRow>(
    'select id, owner_id, title from collections where id = $1 and owner_id = $2',
    [id, ownerId],
  );
  if (!row) throw notFound();
  return row;
};

/** A collection shows only the pens its owner can currently see, in the stored order. */
const collectionPens = async (collectionId: string, ownerId: string): Promise<PenRow[]> =>
  query<PenRow>(
    `${PEN_SELECT}
      join collection_pens cp on cp.pen_id = p.id
     where cp.collection_id = $1 and (p.visibility <> 'private' or p.owner_id = $2)
     order by cp.position asc`,
    [collectionId, ownerId],
  );

const shape = async (row: CollectionRow, ownerId: string): Promise<Collection> => ({
  id: row.id,
  title: row.title,
  pens: (await collectionPens(row.id, ownerId)).map(penSummary),
});

const listCollections = async (ctx: Ctx): Promise<Reply> => {
  const user = requireUser(ctx.user);
  const rows = await query<{ id: string; title: string; count: number }>(
    `select c.id, c.title,
            (select count(*) from collection_pens cp join pens p on p.id = cp.pen_id
              where cp.collection_id = c.id and (p.visibility <> 'private' or p.owner_id = $1))::int as count
       from collections c where c.owner_id = $1 order by c.created_at asc`,
    [user.id],
  );
  return json(200, { collections: rows });
};

const createCollection = async (ctx: Ctx): Promise<Reply> => {
  const user = requireUser(ctx.user);
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const title = body.title === undefined ? 'Untitled collection' : requireTitle(body.title);
  const id = newId();
  await query('insert into collections (id, owner_id, title) values ($1, $2, $3)', [
    id,
    user.id,
    title,
  ]);
  return json(201, { id, title, pens: [] });
};

const getCollection = async (ctx: Ctx): Promise<Reply> => {
  const user = requireUser(ctx.user);
  const row = await requireOwnCollection(ctx.params.id!, user.id);
  return json(200, await shape(row, user.id));
};

const patchCollection = async (ctx: Ctx): Promise<Reply> => {
  const user = requireUser(ctx.user);
  const row = await requireOwnCollection(ctx.params.id!, user.id);
  const body = (ctx.body ?? {}) as Record<string, unknown>;

  if (body.title !== undefined) {
    await query('update collections set title = $2 where id = $1', [row.id, requireTitle(body.title)]);
  }

  if (body.order !== undefined) {
    const order = body.order;
    const current = (await collectionPens(row.id, user.id)).map((pen) => pen.id);
    const sameSet =
      Array.isArray(order) &&
      order.length === current.length &&
      new Set(order as unknown[]).size === current.length &&
      (order as unknown[]).every((id) => typeof id === 'string' && current.includes(id));
    if (!sameSet) validationError({ order: 'Send exactly the pens this collection holds.' });
    let position = 0;
    for (const penId of order as string[]) {
      await query(
        'update collection_pens set position = $3 where collection_id = $1 and pen_id = $2',
        [row.id, penId, position],
      );
      position += 1;
    }
  }

  const updated = await requireOwnCollection(row.id, user.id);
  return json(200, await shape(updated, user.id));
};

const addPen = async (ctx: Ctx): Promise<Reply> => {
  const user = requireUser(ctx.user);
  const row = await requireOwnCollection(ctx.params.id!, user.id);
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  if (typeof body.pen_id !== 'string') validationError({ pen_id: 'Send the pen id.' });
  const pen = await requireVisiblePen(body.pen_id as string, user.id);
  const existing = await one<{ one: number }>(
    'select 1 as one from collection_pens where collection_id = $1 and pen_id = $2',
    [row.id, pen.id],
  );
  if (existing) throw apiError('duplicate');
  const next = await one<{ next: number }>(
    'select coalesce(max(position) + 1, 0)::int as next from collection_pens where collection_id = $1',
    [row.id],
  );
  await query(
    'insert into collection_pens (collection_id, pen_id, position) values ($1, $2, $3)',
    [row.id, pen.id, next?.next ?? 0],
  );
  return json(201, await shape(row, user.id));
};

const removePen = async (ctx: Ctx): Promise<Reply> => {
  const user = requireUser(ctx.user);
  const row = await requireOwnCollection(ctx.params.id!, user.id);
  await query('delete from collection_pens where collection_id = $1 and pen_id = $2', [
    row.id,
    ctx.params.penId!,
  ]);
  return noContent();
};

const deleteCollection = async (ctx: Ctx): Promise<Reply> => {
  const user = requireUser(ctx.user);
  const row = await requireOwnCollection(ctx.params.id!, user.id);
  await query('delete from collections where id = $1', [row.id]);
  return noContent();
};

export const registerCollectionRoutes = (router: Router): void => {
  router.add('GET', '/api/collections', listCollections);
  router.add('POST', '/api/collections', createCollection);
  router.add('GET', '/api/collections/:id', getCollection);
  router.add('PATCH', '/api/collections/:id', patchCollection);
  router.add('POST', '/api/collections/:id/pens', addPen);
  router.add('DELETE', '/api/collections/:id/pens/:penId', removePen);
  router.add('DELETE', '/api/collections/:id', deleteCollection);
};
