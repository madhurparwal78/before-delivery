import type { CollectionDetail } from "../shared/types";
import { loadVisiblePen, penColumns, penFrom, visibleToSql, type PenRow } from "./access";
import { newId, type UserRow } from "./auth";
import { one, pool, rows, transaction, type Queryable } from "./db";
import { ApiError, notFound, validation } from "./errors";
import { empty, json, readJson, requireUser, type Context, type Reply } from "./http";
import { toSummary } from "./pens";

interface CollectionRow {
  id: string;
  title: string;
}

function collectionTitleError(title: unknown): string | null {
  return typeof title === "string" && [...title].length >= 1 && [...title].length <= 80 ? null : "Give the collection a title of 1 to 80 characters.";
}

async function ownedCollection(db: Queryable, id: string, user: UserRow, lock = false): Promise<CollectionRow> {
  const row = await one<CollectionRow>(db, `SELECT id, title FROM collections WHERE id = $1 AND owner_id = $2${lock ? " FOR UPDATE" : ""}`, [id, user.id]);
  if (!row) throw notFound();
  return row;
}

async function visiblePens(db: Queryable, collectionId: string, user: UserRow): Promise<PenRow[]> {
  return rows<PenRow>(
    db,
    `SELECT ${penColumns} FROM collection_pens c JOIN ${penFrom} ON p.id = c.pen_id
     WHERE c.collection_id = $1 AND ${visibleToSql("$2")} ORDER BY c.position, p.id`,
    [collectionId, user.id],
  );
}

async function detail(db: Queryable, collection: CollectionRow, user: UserRow): Promise<CollectionDetail> {
  return { id: collection.id, title: collection.title, pens: (await visiblePens(db, collection.id, user)).map(toSummary) };
}

export async function listCollections(ctx: Context): Promise<Reply> {
  const user = requireUser(ctx);
  const found = await rows<{ id: string; title: string; count: number }>(
    pool,
    `SELECT k.id, k.title,
       (SELECT count(*)::int FROM collection_pens c JOIN pens p ON p.id = c.pen_id WHERE c.collection_id = k.id AND ${visibleToSql("$1")}) AS count
     FROM collections k WHERE k.owner_id = $1 ORDER BY k.created_at DESC, k.id`,
    [user.id],
  );
  return json(200, { collections: found });
}

export async function createCollection(ctx: Context): Promise<Reply> {
  const user = requireUser(ctx);
  const body = readJson(ctx);
  const title = body.title === undefined ? "Untitled collection" : body.title;
  const error = collectionTitleError(title);
  if (error) throw validation({ title: error });
  const id = newId();
  await pool.query("INSERT INTO collections (id, owner_id, title) VALUES ($1, $2, $3)", [id, user.id, title]);
  return json(201, { id, title, pens: [] });
}

export async function getCollection(ctx: Context): Promise<Reply> {
  const user = requireUser(ctx);
  const collection = await ownedCollection(pool, ctx.params[0] as string, user);
  return json(200, await detail(pool, collection, user));
}

export async function updateCollection(ctx: Context): Promise<Reply> {
  const user = requireUser(ctx);
  const result = await transaction(async (client) => {
    const collection = await ownedCollection(client, ctx.params[0] as string, user, true);
    const body = readJson(ctx);
    const fields: Record<string, string> = {};
    if (body.title !== undefined) {
      const error = collectionTitleError(body.title);
      if (error) fields.title = error;
    }
    const current = (await visiblePens(client, collection.id, user)).map((pen) => pen.id);
    const order = body.order;
    if (order !== undefined) {
      const valid =
        Array.isArray(order) &&
        order.length === current.length &&
        new Set(order).size === order.length &&
        order.every((id) => typeof id === "string" && current.includes(id));
      if (!valid) fields.order = "Send exactly the pens in this collection, in their new order.";
    }
    if (Object.keys(fields).length > 0) throw validation(fields);
    if (typeof body.title === "string") await client.query("UPDATE collections SET title = $2 WHERE id = $1", [collection.id, body.title]);
    if (Array.isArray(order)) {
      for (const [position, penId] of order.entries()) {
        await client.query("UPDATE collection_pens SET position = $3 WHERE collection_id = $1 AND pen_id = $2", [collection.id, penId, position]);
      }
    }
    return detail(client, await ownedCollection(client, collection.id, user), user);
  });
  return json(200, result);
}

export async function addCollectionPen(ctx: Context): Promise<Reply> {
  const user = requireUser(ctx);
  const result = await transaction(async (client) => {
    const collection = await ownedCollection(client, ctx.params[0] as string, user, true);
    const { pen_id: penId } = readJson(ctx);
    if (typeof penId !== "string") throw notFound();
    const pen = await loadVisiblePen(client, penId, user);
    if (await one(client, "SELECT 1 FROM collection_pens WHERE collection_id = $1 AND pen_id = $2", [collection.id, pen.id])) {
      throw new ApiError("duplicate", { message: `${pen.title} is already in this collection.` });
    }
    await client.query(
      "INSERT INTO collection_pens (collection_id, pen_id, position) VALUES ($1, $2, (SELECT coalesce(max(position) + 1, 0) FROM collection_pens WHERE collection_id = $1))",
      [collection.id, pen.id],
    );
    return detail(client, collection, user);
  });
  return json(201, result);
}

export async function removeCollectionPen(ctx: Context): Promise<Reply> {
  const user = requireUser(ctx);
  const collection = await ownedCollection(pool, ctx.params[0] as string, user);
  const removed = await pool.query("DELETE FROM collection_pens WHERE collection_id = $1 AND pen_id = $2", [collection.id, ctx.params[1]]);
  if (removed.rowCount === 0) throw notFound();
  return empty(204);
}

export async function deleteCollection(ctx: Context): Promise<Reply> {
  const user = requireUser(ctx);
  const collection = await ownedCollection(pool, ctx.params[0] as string, user);
  await pool.query("DELETE FROM collections WHERE id = $1", [collection.id]);
  return empty(204);
}
