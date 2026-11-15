import { VISIBILITIES, type ForkedFrom, type Pen, type PenSummary, type User, type Version, type Visibility } from "../shared/types.js";
import { canSee, requireVisible, type PenAccess } from "./access.js";
import { config, SEARCH_LIMIT } from "./config.js";
import { pool, transaction, type Tx } from "./db.js";
import { validation } from "./errors.js";
import { newId, ID_SHAPE } from "./ids.js";
import { deletePrefix } from "./storage.js";
import { readVersion } from "./versions.js";

export interface PenRow extends PenAccess {
  id: string;
  owner: string;
  ownerEmail: string;
  title: string;
  starter: number | null;
  forkOfPen: string | null;
  forkOfVersion: number | null;
  updatedAt: Date;
  head: number;
  likes: number;
  forks: number;
  tags: string[];
}

type Queryable = Pick<Tx, "query">;

export const PEN_COLUMNS = `
  p.id, p.owner_id AS "ownerId", u.handle AS owner, u.email AS "ownerEmail", p.title, p.visibility, p.starter,
  p.fork_of_pen AS "forkOfPen", p.fork_of_version AS "forkOfVersion", p.updated_at AS "updatedAt",
  COALESCE((SELECT max(v.number) FROM versions v WHERE v.pen_id = p.id), 0)::int AS head,
  (SELECT count(*) FROM pen_likes l WHERE l.pen_id = p.id)::int AS likes,
  (SELECT count(*) FROM pens f WHERE f.fork_of_pen = p.id)::int AS forks,
  COALESCE((SELECT array_agg(t.tag ORDER BY t.position) FROM pen_tags t WHERE t.pen_id = p.id), '{}') AS tags`;

const PEN_FROM = "FROM pens p JOIN users u ON u.id = p.owner_id";

export async function findPen(id: string, db: Queryable = pool): Promise<PenRow | null> {
  if (!ID_SHAPE.test(id)) return null;
  const found = await db.query<PenRow>(`SELECT ${PEN_COLUMNS} ${PEN_FROM} WHERE p.id = $1`, [id]);
  return found.rows[0] ?? null;
}

export async function visiblePen(id: string, viewer: User | null): Promise<PenRow> {
  return requireVisible(await findPen(id), viewer);
}

export function toSummary(row: PenRow): PenSummary {
  return {
    id: row.id,
    title: row.title,
    owner: row.owner,
    visibility: row.visibility,
    tags: row.tags,
    head: row.head,
    updated_at: row.updatedAt.toISOString(),
    likes: row.likes,
    forks: row.forks,
  };
}

async function forkedFrom(row: PenRow, viewer: User | null, db: Queryable): Promise<ForkedFrom> {
  if (row.forkOfPen === null || row.forkOfVersion === null) return null;
  const source = await findPen(row.forkOfPen, db);
  if (source === null) return { removed: true };
  if (!canSee(source, viewer)) return { hidden: true };
  return { pen_id: source.id, version: row.forkOfVersion, title: source.title, owner: source.owner };
}

export async function headVersion(row: PenRow): Promise<Version | null> {
  return row.head === 0 ? null : readVersion(row.id, row.head);
}

/** The pen as the viewer sees it. A caller that just wrote the head version passes it in and the db it wrote through. */
export async function fullPen(row: PenRow, viewer: User | null, db: Queryable = pool, head?: Version): Promise<Pen> {
  const liked =
    viewer === null ? false : (await db.query("SELECT 1 FROM pen_likes WHERE pen_id = $1 AND user_id = $2", [row.id, viewer.id])).rowCount === 1;
  return { ...toSummary(row), liked, forked_from: await forkedFrom(row, viewer, db), version: head ?? (await headVersion(row)) };
}

export async function listOwnPens(userId: string): Promise<PenSummary[]> {
  const found = await pool.query<PenRow>(`SELECT ${PEN_COLUMNS} ${PEN_FROM} WHERE p.owner_id = $1 ORDER BY p.updated_at DESC, p.id`, [userId]);
  return found.rows.map(toSummary);
}

export function checkTitle(raw: unknown, subject: "pen" | "collection" = "pen"): string {
  const title = typeof raw === "string" ? raw.trim() : "";
  const length = [...title].length;
  if (length < 1 || length > 80 || title.includes("\u0000")) throw validation({ title: `Give the ${subject} a title of 1 to 80 characters.` });
  return title;
}

interface NewPen {
  ownerId: string;
  title: string;
  visibility: Visibility;
  tags?: readonly string[];
  forkOf?: { pen: string; version: number };
  starter?: number;
}

export async function insertPen(tx: Tx, pen: NewPen): Promise<string> {
  const id = newId();
  await tx.query(
    `INSERT INTO pens (id, owner_id, title, visibility, starter, fork_of_pen, fork_of_version) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, pen.ownerId, pen.title, pen.visibility, pen.starter ?? null, pen.forkOf?.pen ?? null, pen.forkOf?.version ?? null],
  );
  await writeTags(tx, id, pen.tags ?? []);
  return id;
}

async function writeTags(tx: Tx, penId: string, tags: readonly string[]): Promise<void> {
  await tx.query("DELETE FROM pen_tags WHERE pen_id = $1", [penId]);
  for (const [position, tag] of tags.entries()) {
    await tx.query("INSERT INTO pen_tags (pen_id, position, tag) VALUES ($1, $2, $3)", [penId, position, tag]);
  }
}

const TAG_SHAPE = /^[a-z0-9-]{1,24}$/;

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function checkTags(raw: unknown): string[] {
  if (!isStringList(raw) || !raw.every((tag) => TAG_SHAPE.test(tag))) {
    throw validation({ tags: "Tags use 1 to 24 lowercase letters, digits or hyphens." });
  }
  if (new Set(raw).size !== raw.length) throw validation({ tags: "That tag is already on this pen." });
  if (raw.length > config.maxTags) throw validation({ tags: `A pen can have up to ${config.maxTags} tags.` });
  return raw;
}

export function checkVisibility(raw: unknown): Visibility {
  const found = VISIBILITIES.find((value) => value === raw);
  if (found === undefined) throw validation({ visibility: "Choose private, unlisted or public." });
  return found;
}

interface PenChanges {
  title?: unknown;
  visibility?: unknown;
  tags?: unknown;
}

export async function patchPen(row: PenRow, changes: PenChanges): Promise<void> {
  const title = changes.title === undefined ? undefined : checkTitle(changes.title);
  const visibility = changes.visibility === undefined ? undefined : checkVisibility(changes.visibility);
  const tags = changes.tags === undefined ? undefined : checkTags(changes.tags);
  await transaction(async (tx) => {
    let touched = false;
    if (title !== undefined && title !== row.title) {
      await tx.query("UPDATE pens SET title = $2 WHERE id = $1", [row.id, title]);
      touched = true;
    }
    if (visibility !== undefined && visibility !== row.visibility) {
      await tx.query("UPDATE pens SET visibility = $2 WHERE id = $1", [row.id, visibility]);
      touched = true;
    }
    if (tags !== undefined && tags.join(",") !== row.tags.join(",")) {
      await writeTags(tx, row.id, tags);
      touched = true;
    }
    if (touched) await tx.query("UPDATE pens SET updated_at = clock_timestamp() WHERE id = $1", [row.id]);
  });
}

export async function deletePen(row: PenRow): Promise<void> {
  await transaction(async (tx) => {
    await tx.query("SELECT id FROM pens WHERE id = $1 FOR UPDATE", [row.id]);
    await tx.query("DELETE FROM pens WHERE id = $1", [row.id]);
    await deletePrefix(`pens/${row.id}/`);
  });
}

export async function setLike(row: PenRow, viewer: User, liked: boolean): Promise<number> {
  if (liked) {
    await pool.query("INSERT INTO pen_likes (pen_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [row.id, viewer.id]);
  } else {
    await pool.query("DELETE FROM pen_likes WHERE pen_id = $1 AND user_id = $2", [row.id, viewer.id]);
  }
  return (await visiblePen(row.id, viewer)).likes;
}

function likePattern(token: string): string {
  return `%${token.replace(/[\\%_]/g, "\\$&")}%`;
}

export async function searchPens(query: string): Promise<{ query: string; total: number; pens: PenSummary[] }> {
  const tokens = query.split(/\s+/).filter((token) => token !== "");
  // Postgres text cannot hold a NUL, so no stored pen can match a term that carries one.
  if (tokens.length === 0 || query.includes("\u0000")) return { query, total: 0, pens: [] };
  const params: string[] = [];
  const conditions = ["p.visibility = 'public'"];
  for (const token of tokens) {
    if (token.toLowerCase().startsWith("tag:")) {
      params.push(token.slice(4).toLowerCase());
      conditions.push(`EXISTS (SELECT 1 FROM pen_tags t WHERE t.pen_id = p.id AND t.tag = $${params.length})`);
    } else {
      params.push(likePattern(token));
      const slot = `$${params.length}`;
      conditions.push(
        `(p.title ILIKE ${slot} OR u.handle ILIKE ${slot} OR EXISTS (SELECT 1 FROM pen_tags t WHERE t.pen_id = p.id AND t.tag ILIKE ${slot}))`,
      );
    }
  }
  const found = await pool.query<PenRow & { total: number }>(
    `SELECT ${PEN_COLUMNS}, count(*) OVER ()::int AS total ${PEN_FROM} WHERE ${conditions.join(" AND ")}
     ORDER BY likes DESC, p.updated_at DESC, p.id LIMIT ${SEARCH_LIMIT}`,
    params,
  );
  return { query, total: found.rows[0]?.total ?? 0, pens: found.rows.map(toSummary) };
}
