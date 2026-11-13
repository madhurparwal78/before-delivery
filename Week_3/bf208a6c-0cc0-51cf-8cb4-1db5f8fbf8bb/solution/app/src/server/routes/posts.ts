import { randomUUID } from "node:crypto";
import { authorize, open, openPost, type Open } from "../access";
import { kickPushes, kickRemoval } from "../background";
import { config } from "../config";
import { maybeOne, one, pool, type Db } from "../db";
import { writeBoard, type BoardWrite } from "../events";
import { detect, storedName } from "../files";
import { ApiError, conflict, empty, invalid, isUuid, json, notFound, param, parseJson, serviceDown, text, type Reply, type Request } from "../http";
import { lockPost, nextPosition, publishedOrder, writeOrders, type PostLock } from "../postStore";
import { StorageError, putObject } from "../services/storage";
import { loadPost } from "../views";
import { maxPosition, relocate } from "../../shared/order";
import { MESSAGES, orderLockedMessage, positionRangeMessage, postFieldErrors } from "../../shared/rules";
import type { Conflict, Post, PostState, Sort } from "../../shared/types";

/** The version check: of simultaneous writes carrying one version, the first to take the board lock wins. */
function requireVersion(post: PostLock, version: number): void {
  if (post.version === version) return;
  const body: Conflict = { error: "conflict", post: { section_id: post.section_id, position: post.position ?? 0, version: post.version }, moved_by: post.last_actor };
  throw new ApiError(409, body);
}

function versionOf(body: Record<string, unknown>): number {
  const version = body["version"];
  if (typeof version !== "number" || !Number.isInteger(version)) throw invalid({ version: MESSAGES.version });
  return version;
}

/** Who sees a post's events: a held post's go to its author and the moderators only. */
const audienceOf = (state: PostState, authorId: string) => (state === "published" ? ({ scope: "all" } as const) : ({ scope: "staff", alsoUser: authorId } as const));

async function sectionOf(db: Db, boardId: string, sectionId: unknown): Promise<string> {
  const section = isUuid(sectionId) ? await maybeOne<{ id: string }>(db, `SELECT id FROM sections WHERE id = $1 AND board_id = $2`, [sectionId, boardId]) : null;
  if (!section) throw notFound();
  return section.id;
}

async function readForm(request: Request): Promise<FormData> {
  const type = request.req.headers["content-type"] ?? "";
  if (!type.startsWith("multipart/form-data")) return new FormData();
  return new Response(new Uint8Array(request.body), { headers: { "content-type": type } }).formData().catch(() => new FormData());
}

export async function create(request: Request): Promise<Reply> {
  const access = await open(request, { boardId: param(request, "id") });
  const form = await readForm(request);
  const sectionId = await sectionOf(pool, access.board.id, form.get("section_id"));
  const author = authorize(access, "contribute");
  const upload = form.get("file");
  const file = upload instanceof File ? { name: upload.name, bytes: Buffer.from(await upload.arrayBuffer()) } : null;
  if (file && file.bytes.length > config.uploadMaxBytes) throw new ApiError(413, { error: "file_too_large" });
  const detected = file ? detect(file.bytes) : null;
  if (file && !detected) throw new ApiError(415, { error: "unsupported_type" });
  const title = text(form.get("title")).trim();
  const body = text(form.get("body")).trim();
  const errors = postFieldErrors(title, body);
  if (Object.keys(errors).length) throw invalid(errors);

  const postId = randomUUID();
  const attachmentId = randomUUID();
  if (file && detected) {
    try {
      await putObject(`boards/${access.board.id}/posts/${postId}/${attachmentId}`, file.bytes, detected.contentType);
    } catch (error) {
      if (error instanceof StorageError) throw serviceDown("storage_unavailable");
      throw error;
    }
  }
  const held = access.board.approval && access.role === "contributor";
  const state: PostState = held ? "awaiting_approval" : "published";
  try {
    await writeBoard(access.board.id, async ({ db, emit }) => {
      await db.query(
        `INSERT INTO posts (id, board_id, section_id, author_id, title, body, state, position, last_actor_id, push)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $4, $9)`,
        [postId, access.board.id, sectionId, author.id, title, body, state, held ? null : await nextPosition(db, sectionId), held ? "pending" : null],
      );
      if (file && detected) {
        await db.query(`INSERT INTO attachments (id, post_id, file_name, content_type, size) VALUES ($1, $2, $3, $4, $5)`, [attachmentId, postId, storedName(file.name), detected.contentType, file.bytes.length]);
      }
      await emit({ type: "post_created", post_id: postId, title, actor: { id: author.id, display_name: author.display_name }, state }, audienceOf(state, author.id));
    });
  } catch (error) {
    if (file) {
      await pool.query(`INSERT INTO storage_removals (prefix) VALUES ($1) ON CONFLICT DO NOTHING`, [`boards/${access.board.id}/posts/${postId}/`]);
      kickRemoval();
    }
    throw error;
  }
  if (held) kickPushes();
  return json(201, await loadPost(pool, postId, access));
}

export async function get(request: Request): Promise<Reply> {
  const { access, post } = await openPost(request, param(request, "id"));
  return json(200, await loadPost(pool, post.id, access));
}

export async function edit(request: Request): Promise<Reply> {
  const { access, post } = await openPost(request, param(request, "id"));
  const editor = authorize(access, "editPost", post);
  const body = parseJson(request.body);
  const version = versionOf(body);
  const saved = await writeBoard(access.board.id, async ({ db, emit }) => {
    const locked = await lockPost(db, post.id);
    if (!locked) throw notFound();
    requireVersion(locked, version);
    const title = body["title"] === undefined ? locked.title : text(body["title"]).trim();
    const description = body["body"] === undefined ? locked.body : text(body["body"]).trim();
    const errors = postFieldErrors(title, description);
    if (Object.keys(errors).length) throw invalid(errors);
    await db.query(`UPDATE posts SET title = $2, body = $3, version = version + 1, last_actor_id = $4 WHERE id = $1`, [post.id, title, description, editor.id]);
    await emit({ type: "post_updated", post_id: post.id }, audienceOf(locked.state, locked.author_id));
    return loadPost(db, post.id, access);
  });
  return json(200, saved);
}

async function moveWithin(write: BoardWrite, access: Open, mover: { id: string; display_name: string }, locked: PostLock, version: number, sectionId: string, requested: unknown): Promise<Post> {
  const { db, emit } = write;
  if (locked.state !== "published") throw conflict("not_published");
  requireVersion(locked, version);
  const settings = await one<{ sort: Sort; grouping: string }>(db, `SELECT sort, grouping FROM boards WHERE id = $1`, [access.board.id]);
  if (settings.grouping === "author") throw invalid({ position: MESSAGES.movingOffByAuthor });
  if (settings.sort !== "by_hand" && locked.section_id === sectionId) throw invalid({ position: orderLockedMessage(settings.sort) });
  const { count } = await one<{ count: number }>(db, `SELECT count(*) AS count FROM posts WHERE section_id = $1 AND state = 'published' AND id <> $2`, [sectionId, locked.id]);
  const highest = maxPosition(count);
  const position = settings.sort === "by_hand" ? requested : highest;
  if (typeof position !== "number" || !Number.isInteger(position) || position < 1 || position > highest) throw invalid({ position: positionRangeMessage(highest) });
  const orders: Record<string, string[]> = {};
  for (const id of new Set([locked.section_id, sectionId])) orders[id] = await publishedOrder(db, id);
  await writeOrders(db, relocate(orders, { postId: locked.id, sectionId, position }));
  await db.query(`UPDATE posts SET section_id = $2, version = version + 1, last_actor_id = $3 WHERE id = $1`, [locked.id, sectionId, mover.id]);
  await emit({ type: "post_moved", post_id: locked.id, title: locked.title, actor: { id: mover.id, display_name: mover.display_name } });
  return loadPost(db, locked.id, access);
}

export async function move(request: Request): Promise<Reply> {
  const { access, post } = await openPost(request, param(request, "id"));
  const body = parseJson(request.body);
  const sectionId = await sectionOf(pool, access.board.id, body["section_id"]);
  const mover = authorize(access, "changePost", post);
  const version = versionOf(body);
  const moved = await writeBoard(access.board.id, async (write) => {
    const locked = await lockPost(write.db, post.id);
    if (!locked) throw notFound();
    return moveWithin(write, access, mover, locked, version, sectionId, body["position"]);
  });
  return json(200, moved);
}

export async function remove(request: Request): Promise<Reply> {
  const { access, post } = await openPost(request, param(request, "id"));
  const actor = authorize(access, "changePost", post);
  await writeBoard(access.board.id, async ({ db, emit }) => {
    const locked = await lockPost(db, post.id);
    if (!locked) throw notFound();
    await db.query(`DELETE FROM posts WHERE id = $1`, [post.id]);
    if (locked.state === "published") await writeOrders(db, { [locked.section_id]: await publishedOrder(db, locked.section_id) });
    await db.query(`INSERT INTO storage_removals (prefix) VALUES ($1) ON CONFLICT DO NOTHING`, [`boards/${access.board.id}/posts/${post.id}/`]);
    await emit({ type: "post_deleted", post_id: post.id, title: locked.title, actor: { id: actor.id, display_name: actor.display_name } }, audienceOf(locked.state, locked.author_id));
  });
  kickRemoval();
  return empty(204);
}

export async function approve(request: Request): Promise<Reply> {
  const { access, post } = await openPost(request, param(request, "id"));
  authorize(access, "moderate");
  const published = await writeBoard(access.board.id, async ({ db, emit }) => {
    const locked = await lockPost(db, post.id);
    if (!locked) throw notFound();
    if (locked.state !== "awaiting_approval") throw conflict("not_held");
    await db.query(`UPDATE posts SET state = 'published', push = NULL, position = $2 WHERE id = $1`, [post.id, await nextPosition(db, locked.section_id)]);
    await emit({ type: "post_published", post_id: post.id, title: locked.title, author_id: locked.author_id });
    return loadPost(db, post.id, access);
  });
  return json(200, published);
}

export async function reject(request: Request): Promise<Reply> {
  const { access, post } = await openPost(request, param(request, "id"));
  authorize(access, "moderate");
  await writeBoard(access.board.id, async ({ db, emit }) => {
    const locked = await lockPost(db, post.id);
    if (!locked) throw notFound();
    if (locked.state !== "awaiting_approval") throw conflict("not_held");
    await db.query(`DELETE FROM posts WHERE id = $1`, [post.id]);
    await db.query(`INSERT INTO storage_removals (prefix) VALUES ($1) ON CONFLICT DO NOTHING`, [`boards/${access.board.id}/posts/${post.id}/`]);
    await emit({ type: "post_rejected", post_id: post.id, title: locked.title, author_id: locked.author_id }, { scope: "staff", alsoUser: locked.author_id });
  });
  kickRemoval();
  return empty(204);
}
