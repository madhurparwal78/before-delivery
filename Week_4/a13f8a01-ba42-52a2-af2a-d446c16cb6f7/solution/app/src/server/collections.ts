import type { Collection, CollectionSummary, PenSummary, User } from "../shared/types.js";
import { canSee, requireVisible } from "./access.js";
import { pool, transaction } from "./db.js";
import { ApiError, notFound, validation } from "./errors.js";
import { ID_SHAPE, newId } from "./ids.js";
import { checkTitle, findPen, PEN_COLUMNS, toSummary, type PenRow } from "./pens.js";

interface CollectionRow {
  id: string;
  title: string;
}

async function ownedCollection(id: string, owner: User): Promise<CollectionRow> {
  const found = ID_SHAPE.test(id)
    ? await pool.query<CollectionRow>("SELECT id, title FROM collections WHERE id = $1 AND owner_id = $2", [id, owner.id])
    : { rows: [] };
  const row = found.rows[0];
  if (!row) throw notFound();
  return row;
}

async function visiblePens(collectionId: string, owner: User): Promise<PenSummary[]> {
  const found = await pool.query<PenRow>(
    `SELECT ${PEN_COLUMNS} FROM collection_pens cp JOIN pens p ON p.id = cp.pen_id JOIN users u ON u.id = p.owner_id
     WHERE cp.collection_id = $1 ORDER BY cp.position`,
    [collectionId],
  );
  return found.rows.filter((row) => canSee(row, owner)).map(toSummary);
}

export async function listCollections(owner: User): Promise<CollectionSummary[]> {
  const found = await pool.query<CollectionRow>("SELECT id, title FROM collections WHERE owner_id = $1 ORDER BY created_at, id", [owner.id]);
  return Promise.all(
    found.rows.map(async (row) => ({ id: row.id, title: row.title, count: (await visiblePens(row.id, owner)).length })),
  );
}

export async function readCollection(id: string, owner: User): Promise<Collection> {
  const row = await ownedCollection(id, owner);
  return { id: row.id, title: row.title, pens: await visiblePens(row.id, owner) };
}

export async function createCollection(owner: User, title: unknown): Promise<Collection> {
  const checked = title === undefined ? "Untitled collection" : checkTitle(title, "collection");
  const id = newId();
  await pool.query("INSERT INTO collections (id, owner_id, title) VALUES ($1, $2, $3)", [id, owner.id, checked]);
  return { id, title: checked, pens: [] };
}

export async function changeCollection(id: string, owner: User, changes: { title?: unknown; order?: unknown }): Promise<Collection> {
  const row = await ownedCollection(id, owner);
  const title = changes.title === undefined ? undefined : checkTitle(changes.title, "collection");
  let order: string[] | undefined;
  if (changes.order !== undefined) {
    const current = (await visiblePens(row.id, owner)).map((pen) => pen.id);
    const wanted = changes.order;
    const same =
      Array.isArray(wanted) &&
      wanted.length === current.length &&
      new Set(wanted).size === wanted.length &&
      wanted.every((penId) => typeof penId === "string" && current.includes(penId));
    if (!same) throw validation({ order: "Send every pen in the collection exactly once." });
    order = wanted as string[];
  }
  await transaction(async (tx) => {
    if (title !== undefined) await tx.query("UPDATE collections SET title = $2 WHERE id = $1", [row.id, title]);
    for (const [position, penId] of (order ?? []).entries()) {
      await tx.query("UPDATE collection_pens SET position = $3 WHERE collection_id = $1 AND pen_id = $2", [row.id, penId, position]);
    }
  });
  return readCollection(id, owner);
}

export async function addToCollection(id: string, owner: User, penId: unknown): Promise<Collection> {
  const row = await ownedCollection(id, owner);
  const pen = requireVisible(typeof penId === "string" ? await findPen(penId) : null, owner);
  const added = await pool.query(
    `INSERT INTO collection_pens (collection_id, pen_id, position)
     SELECT $1, $2, COALESCE(max(position) + 1, 0) FROM collection_pens WHERE collection_id = $1
     ON CONFLICT DO NOTHING`,
    [row.id, pen.id],
  );
  if (added.rowCount === 0) throw new ApiError("duplicate", `${pen.title} is already in this collection.`);
  return readCollection(id, owner);
}

export async function removeFromCollection(id: string, owner: User, penId: string): Promise<void> {
  const row = await ownedCollection(id, owner);
  await pool.query("DELETE FROM collection_pens WHERE collection_id = $1 AND pen_id = $2", [row.id, penId]);
}

export async function deleteCollection(id: string, owner: User): Promise<void> {
  const row = await ownedCollection(id, owner);
  await pool.query("DELETE FROM collections WHERE id = $1", [row.id]);
}
