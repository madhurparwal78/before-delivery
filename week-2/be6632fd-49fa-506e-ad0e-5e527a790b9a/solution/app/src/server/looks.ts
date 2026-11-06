// The lookbook (brief: API → Looks; Business rules → Looks).
import { randomUUID } from "node:crypto";
import { COPY, FIELD, staleStart } from "../shared/copy";
import { marketTime } from "../shared/format";
import { instantText } from "../shared/time";
import { type Member, requireRole, staff } from "./auth";
import { type Db, nowSeconds, one, pool, rows, tx } from "./db";
import { type DropRow, staffDrop } from "./drops";
import { ApiError, type Json, type Reply, notFound, reply, route, validationFailed } from "./http";
import { THUMB_WIDTHS, normaliseImage, thumbnail } from "./images";
import { publicDrop } from "./public";
import { deleteObject, getObject, putObject } from "./s3";
import { type Fields, failed, isUuid, requiredText } from "./validate";

interface Look {
  id: string;
  position: number;
  title: string;
  altText: string;
  width: number;
  height: number;
  contentType: string;
  sizeBytes: number;
  objectKey: string;
}

export async function looksOf(db: Db, dropId: string): Promise<Look[]> {
  return rows<Look>(
    db,
    `SELECT id, position, title, alt_text AS "altText", width, height, content_type AS "contentType", size_bytes AS "sizeBytes", object_key AS "objectKey"
     FROM looks WHERE drop_id = $1 ORDER BY position`,
    [dropId],
  );
}

function lookJson(dropId: string, l: Look): Json {
  return {
    id: l.id,
    position: l.position,
    title: l.title,
    altText: l.altText,
    width: l.width,
    height: l.height,
    contentType: l.contentType,
    sizeBytes: l.sizeBytes,
    imageUrl: `/api/drops/${dropId}/looks/${l.id}/image`,
  };
}

async function lookbookJson(db: Db, dropId: string): Promise<Json> {
  const drop = await one<Pick<DropRow, "look_order_version" | "look_saved_by" | "look_saved_at">>(
    db,
    "SELECT look_order_version, look_saved_by, look_saved_at FROM drops WHERE id = $1",
    [dropId],
  );
  return {
    items: (await looksOf(db, dropId)).map((l) => lookJson(dropId, l)),
    orderVersion: drop?.look_order_version ?? 1,
    savedBy: drop?.look_saved_by ?? null,
    savedAt: drop?.look_saved_at ? instantText(drop.look_saved_at.getTime()) : null,
  };
}

const thumbs = new Map<string, Buffer>();

/** The look's stored image; `?w=` with one of THUMB_WIDTHS gets it scaled down (kept for the next asker), any other value the original. */
async function imageReply(db: Db, dropId: string, lookId: string, width: string | null): Promise<Reply> {
  const look = isUuid(lookId) ? await one<{ object_key: string; content_type: string }>(db, "SELECT object_key, content_type FROM looks WHERE id = $1 AND drop_id = $2", [lookId, dropId]) : undefined;
  if (!look) throw notFound();
  const w = THUMB_WIDTHS.find((n) => String(n) === width);
  const headers = { "Cache-Control": "private, max-age=300" };
  if (!w) return { status: 200, bytes: await getObject(look.object_key), contentType: look.content_type, headers };
  const key = `${look.object_key}@${w}`;
  let bytes = thumbs.get(key);
  if (!bytes) {
    bytes = await thumbnail(await getObject(look.object_key), w);
    if (thumbs.size >= 500) thumbs.delete(thumbs.keys().next().value as string);
    thumbs.set(key, bytes);
  }
  return { status: 200, bytes, contentType: look.content_type, headers };
}

route("GET", "/api/drops/{dropId}/looks", "none", async (ctx) => {
  const me = await staff(ctx);
  const drop = await staffDrop(pool, me, ctx.params.dropId);
  return reply(200, await lookbookJson(pool, drop.id));
});

route("GET", "/api/drops/{dropId}/looks/{lookId}/image", "none", async (ctx) => {
  const me = await staff(ctx);
  const drop = await staffDrop(pool, me, ctx.params.dropId);
  return imageReply(pool, drop.id, ctx.params.lookId, ctx.query("w"));
});

route("GET", "/api/public/drops/{slug}/looks/{lookId}/image", "none", async (ctx) => {
  const drop = await publicDrop(pool, ctx.params.slug);
  return imageReply(pool, drop.id, ctx.params.lookId, ctx.query("w"));
});

route(
  "POST",
  "/api/drops/{dropId}/looks",
  "multipart",
  async (ctx) => {
    const me = await staff(ctx);
    const drop = await staffDrop(pool, me, ctx.params.dropId);
    requireRole(me, "merchandiser");
    const { file, fields: parts } = ctx.multipart(FIELD.imageType);
    const fields: Fields = {};
    const title = requiredText(parts.title, "title", 80, fields);
    const altText = requiredText(parts.altText, "altText", 250, fields);
    const verdict = file ? await normaliseImage(file.data) : null;
    if (!file || !file.data.length) fields.file = FIELD.required;
    else if (verdict && !verdict.ok) fields.file = verdict.reason === "pixels" ? FIELD.imagePixels : FIELD.imageType;
    if (failed(fields) || !verdict?.ok) throw validationFailed(fields);
    const id = randomUUID();
    const key = `looks/${drop.id}/${id}.${verdict.image.extension}`;
    await putObject(key, verdict.image.bytes, verdict.image.contentType);
    try {
      return await tx(async (db) => {
        const locked = await one<{ look_order_version: number }>(db, "SELECT look_order_version FROM drops WHERE id = $1 FOR UPDATE", [drop.id]);
        const next = await one<{ n: number }>(db, "SELECT coalesce(max(position), 0)::int + 1 AS n FROM looks WHERE drop_id = $1", [drop.id]);
        await db.query(
          `INSERT INTO looks (id, drop_id, position, title, alt_text, width, height, content_type, size_bytes, object_key, stored)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)`,
          [id, drop.id, next?.n ?? 1, title, altText, verdict.image.width, verdict.image.height, verdict.image.contentType, verdict.image.bytes.length, key],
        );
        const version = (locked?.look_order_version ?? 1) + 1;
        await db.query("UPDATE drops SET look_order_version = $2, look_saved_by = $3, look_saved_at = $4 WHERE id = $1", [drop.id, version, me.name, nowSeconds()]);
        const look = (await looksOf(db, drop.id)).find((l) => l.id === id) as Look;
        return reply(201, { look: lookJson(drop.id, look), orderVersion: version });
      });
    } catch (error) {
      await deleteObject(key).catch(() => undefined);
      throw error;
    }
  },
  { fileLimit: 8_000_000, tooLarge: COPY.photoTooLarge },
);

async function reorder(db: Db, me: Member, dropId: string, body: Record<string, unknown>): Promise<Reply> {
  const drop = await one<Pick<DropRow, "look_order_version" | "look_saved_by" | "look_saved_at">>(
    db,
    "SELECT look_order_version, look_saved_by, look_saved_at FROM drops WHERE id = $1 FOR UPDATE",
    [dropId],
  );
  const current = drop?.look_order_version ?? 1;
  if (body.orderVersion !== current) {
    const savedAt = drop?.look_saved_at ? drop.look_saved_at.getTime() : Date.now();
    throw new ApiError(412, "stale_version", staleStart(drop?.look_saved_by ?? me.name, marketTime(savedAt)), {
      savedBy: drop?.look_saved_by ?? null,
      savedAt: instantText(savedAt),
      current: await lookbookJson(db, dropId),
    });
  }
  const looks = await looksOf(db, dropId);
  const ids = Array.isArray(body.lookIds) ? body.lookIds : [];
  const exact = ids.length === looks.length && new Set(ids).size === ids.length && looks.every((l) => ids.includes(l.id));
  if (!exact) throw validationFailed({ lookIds: "List each look of this drop exactly once." });
  for (const [i, id] of ids.entries()) await db.query("UPDATE looks SET position = $3 WHERE id = $1 AND drop_id = $2", [id, dropId, -(i + 1)]);
  await db.query("UPDATE looks SET position = -position WHERE drop_id = $1", [dropId]);
  await db.query("UPDATE drops SET look_order_version = $2, look_saved_by = $3, look_saved_at = $4 WHERE id = $1", [dropId, current + 1, me.name, nowSeconds()]);
  return reply(200, await lookbookJson(db, dropId));
}

route("PUT", "/api/drops/{dropId}/looks/order", "json", async (ctx) => {
  const me = await staff(ctx);
  const drop = await staffDrop(pool, me, ctx.params.dropId);
  requireRole(me, "merchandiser");
  const body = ctx.json();
  return tx((db) => reorder(db, me, drop.id, body));
});
