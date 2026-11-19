// References, plucked stills and media (brief: API > Endpoints; Business rules > Objects and references,
// Upload hygiene, Timecode, Media access).
import { randomUUID } from "node:crypto";
import { memberWorkspace, reaches, requireAccount, requireSeat, sessionAccount } from "../access.js";
import { decodeCursor, encodeCursor, parseLimit } from "../cursor.js";
import { many, one, pool, returning, transaction } from "../db.js";
import { invalid, refuse } from "../errors.js";
import { removeMetadata } from "../hygiene.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PoolClient } from "pg";
import { route, send, noContent, type FilePart } from "../http.js";
import { isLocked, type Status } from "../../shared/lifecycle.js";
import { bumpVersion, clusterOrUnknown, entryView, REFERENCE_SELECT, referenceView, type ReferenceRow } from "../records.js";
import { linkForToken } from "../reviewLinks.js";
import { deleteObject, getObject, objectKey, putObject } from "../storage.js";
import { isFrameRate, timecode, totalFrames, type FrameRate } from "../../shared/timecode.js";
import { Fields, frameMessage, isTitle, isUuid, MESSAGES } from "../validate.js";

const LIST_DEFAULT = 50;
const LIST_MAX = 100;

route("GET", "/api/workspaces/:ws/references", async (ctx) => {
  const account = await requireAccount(ctx);
  const ws = await memberWorkspace(account, ctx.params.ws ?? "");
  const fields = new Fields();
  const limit = parseLimit(ctx.query.get("limit"), LIST_DEFAULT, LIST_MAX);
  fields.check(limit !== null, "limit", MESSAGES.limit);
  const rawCursor = ctx.query.get("cursor");
  const after = rawCursor === null ? null : decodeCursor(rawCursor, "references", ws.slug);
  fields.check(rawCursor === null || after !== null, "cursor", MESSAGES.cursor);
  if (fields.failed || limit === null) throw invalid(fields.errors);
  const rows = await many<ReferenceRow>(
    pool,
    `${REFERENCE_SELECT} WHERE r.workspace_id = $1 ${after ? "AND (r.created_at, r.id) < ($3, $4)" : ""}
     ORDER BY r.created_at DESC, r.id DESC LIMIT $2`,
    after ? [ws.id, limit + 1, after.sortValue, after.id] : [ws.id, limit + 1],
  );
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  send(ctx.res, 200, {
    items: items.map(referenceView),
    nextCursor: rows.length > limit && last ? encodeCursor("references", ws.slug, last.created_at, last.id) : null,
  });
});

/** A clip's frame rate and duration, or null after recording which of them is invalid. */
function clipTiming(sent: Map<string, string>, fields: Fields): { frameRate: FrameRate; durationMs: number } | null {
  const frameRate = Number(sent.get("frameRate"));
  const durationMs = Number(sent.get("durationMs"));
  const rateOk = isFrameRate(frameRate);
  const durationOk = Number.isInteger(durationMs) && durationMs >= 1 && durationMs <= 3_600_000;
  fields.check(rateOk, "frameRate", MESSAGES.frameRate).check(durationOk, "durationMs", MESSAGES.durationMs);
  return rateOk && durationOk ? { frameRate, durationMs } : null;
}

/** Stores the object first; the row exists only once its file is stored (brief: Objects and references). */
async function storeThenInsert<T>(key: string, data: Buffer, contentType: string, metadata: Record<string, string>, insert: () => Promise<T>): Promise<T> {
  await putObject(key, data, contentType, metadata);
  try {
    return await insert();
  } catch (error) {
    await deleteObject(key).catch(() => undefined);
    throw error;
  }
}

function singleFile(files: FilePart[] | undefined): FilePart | null {
  return files && files.length === 1 ? (files[0] ?? null) : null;
}

const stem = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return [...(dot > 0 ? name.slice(0, dot) : name)].slice(0, 80).join("");
};

route(
  "POST",
  "/api/workspaces/:ws/references",
  async (ctx) => {
    const account = await requireAccount(ctx);
    const ws = await memberWorkspace(account, ctx.params.ws ?? "");
    await requireSeat(pool, account, ws.id);
    const file = singleFile(ctx.multipart.files.get("file"));
    const sentTitle = ctx.multipart.fields.get("title");
    const fields = new Fields().check(file !== null, "file", MESSAGES.file);
    const timing = file?.type.kind === "clip" ? clipTiming(ctx.multipart.fields, fields) : null;
    if (file?.type.kind === "clip" || sentTitle !== undefined) fields.check(isTitle(sentTitle ?? null), "title", MESSAGES.title);
    if (fields.failed || !file) throw invalid(fields.errors);
    const data = removeMetadata(file.data, file.type);
    if (!data) throw refuse("unsupported_media_type");
    const id = randomUUID();
    const title = sentTitle ?? (stem(file.filename) || id);
    await storeThenInsert(objectKey(ws.slug, id, file.type.ext), data, file.type.contentType, {}, async () => {
      await pool.query(
        `INSERT INTO "references" (id, workspace_id, kind, title, content_type, ext, created_at, created_by, frame_rate, duration_ms, total_frames)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [id, ws.id, file.type.kind, title, file.type.contentType, file.type.ext, ctx.now, account.id, timing?.frameRate ?? null, timing?.durationMs ?? null,
          timing ? totalFrames(timing.durationMs, timing.frameRate) : null],
      );
    });
    const row = await returning<ReferenceRow>(pool, `${REFERENCE_SELECT} WHERE r.id = $1`, [id]);
    send(ctx.res, 201, referenceView(row));
  },
  { part: "file" },
);

route("DELETE", "/api/workspaces/:ws/references/:id", async (ctx) => {
  const account = await requireAccount(ctx);
  const ws = await memberWorkspace(account, ctx.params.ws ?? "");
  const id = ctx.params.id ?? "";
  const reference = isUuid(id) ? await one<ReferenceRow>(pool, `${REFERENCE_SELECT} WHERE r.id = $1 AND r.workspace_id = $2`, [id, ws.id]) : null;
  if (!reference) throw refuse("not_found");
  await requireSeat(pool, account, ws.id);
  await transaction(async (client) => {
    await client.query(`SELECT 1 FROM "references" WHERE id = $1 FOR UPDATE`, [id]);
    const holders = await many<{ cluster_id: string; position: number; status: Status }>(
      client,
      `SELECT e.cluster_id, e.position, c.status FROM entries e JOIN clusters c ON c.id = e.cluster_id
        WHERE e.reference_id = $1 ORDER BY e.cluster_id FOR UPDATE OF c`,
      [id],
    );
    if (holders.some((h) => isLocked(h.status))) throw refuse("cluster_locked");
    for (const h of holders) {
      await client.query("DELETE FROM entries WHERE cluster_id = $1 AND reference_id = $2", [h.cluster_id, id]);
      await client.query("UPDATE entries SET position = position - 1 WHERE cluster_id = $1 AND position > $2", [h.cluster_id, h.position]);
      await bumpVersion(client, h.cluster_id, ctx.now);
    }
    await client.query(`DELETE FROM "references" WHERE id = $1`, [id]);
    await deleteObject(objectKey(ws.slug, id, reference.ext));
  });
  noContent(ctx.res);
});

route(
  "POST",
  "/api/workspaces/:ws/clips/:clipId/stills",
  async (ctx) => {
    const account = await requireAccount(ctx);
    const ws = await memberWorkspace(account, ctx.params.ws ?? "");
    const clipId = ctx.params.clipId ?? "";
    const clip = isUuid(clipId) ? await one<ReferenceRow>(pool, `${REFERENCE_SELECT} WHERE r.id = $1 AND r.workspace_id = $2 AND r.kind = 'clip'`, [clipId, ws.id]) : null;
    const clusterId = ctx.multipart.fields.get("clusterId") ?? "";
    const target = clip ? await clusterOrUnknown(pool, clusterId) : null;
    if (!clip || !target || target.workspace_id !== ws.id || clip.frame_rate === null || clip.total_frames === null) throw refuse("not_found");
    await requireSeat(pool, account, ws.id);
    if (isLocked(target.status)) throw refuse("cluster_locked");
    const still = singleFile(ctx.multipart.files.get("still"));
    const frameText = ctx.multipart.fields.get("frameIndex") ?? "";
    const frameIndex = /^-?\d+$/.test(frameText) ? Number(frameText) : NaN;
    const fields = new Fields()
      .check(still !== null, "file", MESSAGES.file)
      .check(Number.isInteger(frameIndex) && frameIndex >= 0 && frameIndex < clip.total_frames, "frameIndex", frameMessage(clip.total_frames - 1));
    if (fields.failed || !still) throw invalid(fields.errors);
    const data = removeMetadata(still.data, still.type);
    if (!data) throw refuse("unsupported_media_type");
    const id = randomUUID();
    const tc = timecode(frameIndex, clip.frame_rate);
    const placed = await storeThenInsert(objectKey(ws.slug, id, "png"), data, "image/png", { "source-clip": clip.id, timecode: tc }, () =>
      transaction(async (client) => {
        const cluster = await clusterOrUnknown(client, target.id, true);
        if (isLocked(cluster.status)) throw refuse("cluster_locked");
        await client.query(
          `INSERT INTO "references" (id, workspace_id, kind, title, content_type, ext, created_at, created_by, source_clip_id, source_clip_title, frame_index, timecode)
           VALUES ($1, $2, 'still', $3, 'image/png', 'png', $4, $5, $6, $7, $8, $9)`,
          [id, ws.id, `${clip.title} @ ${tc}`, ctx.now, account.id, clip.id, clip.title, frameIndex, tc],
        );
        return appendEntry(client, cluster.id, id, false, account.id, ctx.now);
      }),
    );
    const reference = await returning<ReferenceRow>(pool, `${REFERENCE_SELECT} WHERE r.id = $1`, [id]);
    send(ctx.res, 201, {
      reference: referenceView(reference),
      entry: entryView({ entry_id: placed.entry_id, position: placed.position, is_private: false }),
      cluster: { id: target.id, itemCount: placed.item_count, version: placed.version },
    });
  },
  { part: "still" },
);

/** Appends at the end under the cluster row lock, so simultaneous appends each get their own slot. */
export async function appendEntry(client: PoolClient, clusterId: string, referenceId: string, isPrivate: boolean, addedBy: string, now: Date) {
  const entry = await returning<{ entry_id: string; position: number }>(
    client,
    `INSERT INTO entries (cluster_id, reference_id, position, is_private, added_by, added_at)
     SELECT $1, $2, coalesce(max(position), 0) + 1, $3, $4, $5 FROM entries WHERE cluster_id = $1
     RETURNING id AS entry_id, position`,
    [clusterId, referenceId, isPrivate, addedBy, now],
  );
  return { ...entry, ...(await bumpVersion(client, clusterId, now)) };
}

interface MediaRow {
  id: string;
  workspace_id: string;
  workspace_slug: string;
  group_id: string;
  content_type: string;
  ext: string;
}

/** Media access (brief: Business rules > Media access): the one place it is decided. */
async function mediaAllowed(row: MediaRow, review: string | null, ctx: { req: IncomingMessage; now: Date }): Promise<boolean> {
  if (review !== null) {
    const found = await linkForToken(pool, review, ctx.now);
    if (!found || found.state !== "live") return false;
    return (await one(pool, "SELECT 1 FROM entries WHERE cluster_id = $1 AND reference_id = $2", [found.link.cluster_id, row.id])) !== null;
  }
  const account = await sessionAccount(ctx.req);
  if (account && reaches(account, { id: row.workspace_id, group_id: row.group_id })) return true;
  const shown = await one(
    pool,
    "SELECT 1 FROM entries e JOIN clusters c ON c.id = e.cluster_id WHERE e.reference_id = $1 AND NOT e.is_private AND c.status = 'public' LIMIT 1",
    [row.id],
  );
  return shown !== null;
}

route("GET", "/media/:id", async (ctx) => {
  const id = ctx.params.id ?? "";
  const row = isUuid(id)
    ? await one<MediaRow>(
        pool,
        `SELECT r.id, r.workspace_id, w.slug AS workspace_slug, w.group_id, r.content_type, r.ext
           FROM "references" r JOIN workspaces w ON w.id = r.workspace_id WHERE r.id = $1`,
        [id],
      )
    : null;
  if (!row || !(await mediaAllowed(row, ctx.query.get("review"), ctx))) throw refuse("not_found");
  const etag = `"${row.id}"`;
  const headers: Record<string, string> = {
    "Content-Type": row.content_type,
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `inline; filename="${row.id}.${row.ext}"`,
    "Cache-Control": "private, no-cache",
    "Accept-Ranges": "bytes",
    ETag: etag,
  };
  const range = ctx.req.headers.range;
  if (!range && ctx.req.headers["if-none-match"] === etag) {
    ctx.res.writeHead(304, headers);
    ctx.res.end();
    return;
  }
  const object = await getObject(objectKey(row.workspace_slug, row.id, row.ext), range);
  for (const name of ["content-length", "content-range"]) {
    const value = object.headers.get(name);
    if (value) headers[name === "content-length" ? "Content-Length" : "Content-Range"] = value;
  }
  ctx.res.writeHead(object.status === 206 ? 206 : 200, headers);
  if (ctx.req.method === "HEAD" || !object.body) {
    ctx.res.end();
    return;
  }
  await streamTo(ctx.res, object.body);
});

/** Copies a stored object to the response. A reader that leaves mid-stream (a seeking video) ends this copy only. */
async function streamTo(res: ServerResponse, body: ReadableStream<Uint8Array>): Promise<void> {
  const reader = body.getReader();
  let open = true;
  const closed = new Promise<void>((resolve) => res.once("close", () => {
    open = false;
    resolve();
  }));
  void closed.then(() => reader.cancel().catch(() => undefined));
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !open) break;
      if (!res.write(value)) await Promise.race([new Promise((resolve) => res.once("drain", resolve)), closed]);
    }
    res.end();
  } catch {
    res.destroy();
  }
}
