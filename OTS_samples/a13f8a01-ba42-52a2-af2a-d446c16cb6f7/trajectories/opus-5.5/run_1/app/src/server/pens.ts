import type { ForkedFrom, Pen, PenSummary, Visibility } from "../shared/types";
import { canView, loadVisiblePen, penColumns, penCounts, penFrom, requireOwner, requireVerified, type PenRow } from "./access";
import { newId, type UserRow } from "./auth";
import { config } from "./config";
import { one, pool, rows, transaction, type Queryable } from "./db";
import { ApiError, StorageUnavailable, validation } from "./errors";
import { announce, publishCounts } from "./events";
import { empty, json, readJson, requireUser, type Context, type JsonObject, type Reply } from "./http";
import { deletePrefix } from "./storage";
import { findVersion } from "./versions";

const visibilities: readonly Visibility[] = ["private", "unlisted", "public"];
const tagPattern = /^[a-z0-9-]{1,24}$/;

export function toSummary(pen: PenRow): PenSummary {
  return {
    id: pen.id,
    title: pen.title,
    owner: pen.owner_handle,
    visibility: pen.visibility,
    tags: pen.tags,
    head: pen.head,
    updated_at: pen.updated_at.toISOString(),
    likes: pen.likes,
    forks: pen.forks,
  };
}

async function forkedFrom(db: Queryable, pen: PenRow, viewerId: string | null): Promise<ForkedFrom> {
  if (pen.forked_from_pen === null) return null;
  const source = await one<PenRow>(db, `SELECT ${penColumns} FROM ${penFrom} WHERE p.id = $1`, [pen.forked_from_pen]);
  if (!source) return { removed: true };
  if (!canView(source, viewerId)) return { hidden: true };
  return { pen_id: source.id, version: pen.forked_from_version ?? 1, title: source.title, owner: source.owner_handle };
}

export async function toPen(db: Queryable, pen: PenRow, viewer: UserRow | null): Promise<Pen> {
  const liked = viewer ? Boolean(await one(db, "SELECT 1 FROM likes WHERE user_id = $1 AND pen_id = $2", [viewer.id, pen.id])) : false;
  return {
    ...toSummary(pen),
    liked,
    forked_from: await forkedFrom(db, pen, viewer?.id ?? null),
    version: pen.head === 0 ? null : await findVersion(db, pen.id, pen.head),
  };
}

export function titleError(title: unknown): string | null {
  return typeof title === "string" && [...title].length >= 1 && [...title].length <= 80 ? null : "Give the pen a title of 1 to 80 characters.";
}

export function tagsError(tags: unknown): string | null {
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string" || !tagPattern.test(tag))) return "Tags use 1 to 24 lowercase letters, digits or hyphens.";
  if (new Set(tags).size !== tags.length) return "That tag is already on this pen.";
  if (tags.length > config.maxTags) return `A pen can have up to ${config.maxTags} tags.`;
  return null;
}

export async function listMyPens(ctx: Context): Promise<Reply> {
  const user = requireUser(ctx);
  const found = await rows<PenRow>(pool, `SELECT ${penColumns} FROM ${penFrom} WHERE p.owner_id = $1 ORDER BY p.updated_at DESC, p.id`, [user.id]);
  return json(200, { pens: found.map(toSummary) });
}

export async function createPen(ctx: Context): Promise<Reply> {
  const user = requireUser(ctx);
  const body = readJson(ctx);
  const title = body.title === undefined ? "Untitled pen" : body.title;
  const error = titleError(title);
  if (error) throw validation({ title: error });
  const id = newId();
  await pool.query("INSERT INTO pens (id, owner_id, title, visibility) VALUES ($1, $2, $3, 'private')", [id, user.id, title]);
  return json(201, await toPen(pool, await loadVisiblePen(pool, id, user), user));
}

export async function getPen(ctx: Context): Promise<Reply> {
  const pen = await loadVisiblePen(pool, ctx.params[0] as string, ctx.user);
  return json(200, await toPen(pool, pen, ctx.user));
}

function patchFields(body: JsonObject): Record<string, string> {
  const fields: Record<string, string> = {};
  if (body.title !== undefined) {
    const error = titleError(body.title);
    if (error) fields.title = error;
  }
  if (body.visibility !== undefined && !visibilities.includes(body.visibility as Visibility)) fields.visibility = "Choose private, unlisted or public.";
  if (body.tags !== undefined) {
    const error = tagsError(body.tags);
    if (error) fields.tags = error;
  }
  return fields;
}

export async function updatePen(ctx: Context): Promise<Reply> {
  const user = requireUser(ctx);
  const penId = ctx.params[0] as string;
  const pen = await transaction(async (client) => {
    const current = await loadVisiblePen(client, penId, user, true);
    requireOwner(current, user);
    const body = readJson(ctx);
    const visibilityChange = body.visibility !== undefined && body.visibility !== current.visibility;
    if (visibilityChange) requireVerified(user);
    const fields = patchFields(body);
    if (Object.keys(fields).length > 0) throw validation(fields);
    const title = (body.title as string | undefined) ?? current.title;
    const visibility = (body.visibility as Visibility | undefined) ?? current.visibility;
    const tags = (body.tags as string[] | undefined) ?? current.tags;
    const changed = title !== current.title || visibility !== current.visibility || tags.join("\n") !== current.tags.join("\n");
    if (changed) {
      await client.query("UPDATE pens SET title = $2, visibility = $3, tags = $4, updated_at = now() WHERE id = $1", [penId, title, visibility, tags]);
    }
    return loadVisiblePen(client, penId, user);
  });
  return json(200, await toPen(pool, pen, user));
}

export async function deletePen(ctx: Context): Promise<Reply> {
  const user = requireUser(ctx);
  const pen = await loadVisiblePen(pool, ctx.params[0] as string, user);
  requireOwner(pen, user);
  await transaction(async (client) => {
    await client.query("SELECT 1 FROM pens WHERE id = $1 FOR UPDATE", [pen.id]);
    try {
      await deletePrefix(`pens/${pen.id}/`);
    } catch (error) {
      if (error instanceof StorageUnavailable) throw new ApiError("storage_unavailable", { message: "Storage is unreachable, so the pen was not deleted." });
      throw error;
    }
    await client.query("DELETE FROM pens WHERE id = $1", [pen.id]);
  });
  if (pen.forked_from_pen) announce(publishCounts(pen.forked_from_pen));
  return empty(204);
}

async function likeTarget(ctx: Context): Promise<{ user: UserRow; pen: PenRow }> {
  const user = requireUser(ctx);
  const pen = await loadVisiblePen(pool, ctx.params[0] as string, user);
  requireVerified(user);
  return { user, pen };
}

export async function likePen(ctx: Context): Promise<Reply> {
  const { user, pen } = await likeTarget(ctx);
  if (pen.visibility === "private") throw new ApiError("forbidden", { message: "Private pens cannot be liked." });
  const inserted = await pool.query("INSERT INTO likes (user_id, pen_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [user.id, pen.id]);
  if (inserted.rowCount) announce(publishCounts(pen.id));
  return json(200, { liked: true, likes: (await penCounts(pool, pen.id)).likes });
}

export async function unlikePen(ctx: Context): Promise<Reply> {
  const { user, pen } = await likeTarget(ctx);
  const removed = await pool.query("DELETE FROM likes WHERE user_id = $1 AND pen_id = $2", [user.id, pen.id]);
  if (removed.rowCount) announce(publishCounts(pen.id));
  return json(200, { liked: false, likes: (await penCounts(pool, pen.id)).likes });
}
