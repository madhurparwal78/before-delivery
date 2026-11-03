import { ApiError, invalid, notFound } from "../shared/errors.js";
import { pageCopy } from "../shared/notices.js";
import { isLive } from "../shared/publishing.js";
import type { PublishState, PublishStatus, WorkspaceDoc } from "../shared/types.js";
import { memberRole, requireEditor, requireOwner, workspaceOf } from "./access.js";
import type { User } from "./auth.js";
import { config } from "./config.js";
import { newId, one, pool } from "./db.js";
import type { Ctx } from "./http.js";
import { imageKey, imageType } from "./images.js";
import { publicMessagePage, renderSnapshot } from "./snapshot.js";
import { getObject, putConfirmed, StorageDown, storageUnavailable } from "./storage.js";
import { loadDoc } from "./workspaces.js";

interface PublishRow {
  publish_id: string;
  published_seq: number;
  state: "live" | "unpublished";
  images: string[];
  changed: boolean;
}

/** Bytes this instance has written or served since start: the public address keeps serving them in an outage. */
const held = new Map<string, Buffer>();
function hold(key: string, bytes: Buffer): void {
  held.delete(key);
  held.set(key, bytes);
  if (held.size > 2000) held.delete(held.keys().next().value as string);
}

function liveUrl(doc: WorkspaceDoc, pageId: string): string {
  const page = doc.pages.find((p) => p.id === pageId);
  return `${config.publicUrl}/p/${doc.slug}/${page?.slug ?? ""}`;
}

async function publishRow(pageId: string): Promise<PublishRow | undefined> {
  return one<PublishRow>(
    pool,
    `SELECT p.publish_id, p.published_seq, p.state, p.images,
       EXISTS (SELECT 1 FROM operations o WHERE o.workspace_id = p.workspace_id AND o.seq > p.published_seq AND $1 = ANY(o.pages)) AS changed
     FROM publishes p WHERE p.page_id = $1`,
    [pageId],
  );
}

/** The publish state, decided here: the stored row plus whether any later operation affected the page. */
function stateOf(row: PublishRow | undefined): PublishState {
  if (!row) return "not_published";
  if (row.state === "unpublished") return "unpublished";
  return row.changed ? "live_changed" : "live";
}

async function statusOf(doc: WorkspaceDoc, pageId: string): Promise<PublishStatus> {
  const row = await publishRow(pageId);
  const state = stateOf(row);
  return {
    state,
    publishId: row?.publish_id ?? null,
    publishedSeq: row?.published_seq ?? null,
    url: isLive(state) ? liveUrl(doc, pageId) : null,
  };
}

async function pageContext(user: User, pageId: string): Promise<{ workspaceId: string; role: Awaited<ReturnType<typeof memberRole>> }> {
  const workspaceId = await workspaceOf("page", pageId);
  return { workspaceId, role: await memberRole(user, workspaceId) };
}

/** Publishes running on this instance, so a status read right after a publish reflects its result. */
const running = new Map<string, Promise<unknown>>();

export function trackPublish<T>(pageId: string, work: () => Promise<T>): Promise<T> {
  const attempt = work();
  const settled = attempt.catch(() => undefined);
  running.set(pageId, settled);
  void settled.then(() => running.get(pageId) === settled && running.delete(pageId));
  return attempt;
}

export async function getStatus(user: User, pageId: string): Promise<PublishStatus> {
  await running.get(pageId);
  const { workspaceId } = await pageContext(user, pageId);
  return statusOf(await loadDoc(workspaceId), pageId);
}

/** Write one snapshot and its image copies, read it back, and only then record the page as live. */
export async function publishPage(workspaceId: string, pageId: string): Promise<PublishStatus> {
  const doc = await loadDoc(workspaceId);
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) throw notFound();
  const { html, images } = renderSnapshot(doc, page);
  const publishId = newId("pub");
  try {
    for (const imageId of images) {
      const bytes = await getObject(workspaceId, imageKey(workspaceId, imageId));
      if (!bytes) continue;
      const key = `snapshots/${pageId}/${publishId}/assets/${imageId}`;
      await putConfirmed(workspaceId, key, bytes, imageType(bytes) ?? "application/octet-stream");
      hold(key, bytes);
    }
    const key = `snapshots/${pageId}/${publishId}.html`;
    const bytes = Buffer.from(html, "utf8");
    await putConfirmed(workspaceId, key, bytes, "text/html; charset=utf-8");
    hold(key, bytes);
  } catch (error) {
    if (error instanceof StorageDown) throw storageUnavailable();
    throw error;
  }
  await pool.query(
    `INSERT INTO publishes (page_id, workspace_id, publish_id, published_seq, state, images, updated_at) VALUES ($1, $2, $3, $4, 'live', $5, now())
     ON CONFLICT (page_id) DO UPDATE SET publish_id = $3, published_seq = $4, state = 'live', images = $5, updated_at = now()`,
    [pageId, workspaceId, publishId, doc.seq, [...images]],
  );
  return { state: "live", publishId, publishedSeq: doc.seq, url: liveUrl(doc, pageId) };
}

/** POST /api/pages/<pageId>/publish, with the optional Idempotency-Key. */
export async function publish(user: User, pageId: string, header: string | string[] | undefined): Promise<PublishStatus> {
  const { workspaceId, role } = await pageContext(user, pageId);
  requireEditor(role);
  const key = checkIdempotencyKey(header);
  if (key === undefined) return publishPage(workspaceId, pageId);
  const claimed = await one(pool, "INSERT INTO idempotency_keys (key, page_id, status) VALUES ($1, $2, 'running') ON CONFLICT (key) DO NOTHING RETURNING key", [key, pageId]);
  if (!claimed) {
    const row = await one<{ page_id: string; status: string; response: PublishStatus | null }>(pool, "SELECT page_id, status, response FROM idempotency_keys WHERE key = $1", [key]);
    if (row?.page_id === pageId && row.status === "done" && row.response) return row.response;
    if (row?.page_id === pageId) throw new ApiError(409, "publish_in_progress", "This page is already being published with that key.");
    throw new ApiError(422, "idempotency_key_reused", "That Idempotency-Key was used for another page.", { "Idempotency-Key": "This key already published a different page." });
  }
  try {
    const status = await publishPage(workspaceId, pageId);
    await pool.query("UPDATE idempotency_keys SET status = 'done', response = $2 WHERE key = $1", [key, JSON.stringify(status)]);
    return status;
  } catch (error) {
    await pool.query("DELETE FROM idempotency_keys WHERE key = $1", [key]);
    throw error;
  }
}

function checkIdempotencyKey(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  const key = Array.isArray(value) ? value[0] : value;
  if (key.length < 1 || key.length > 64) throw invalid({ "Idempotency-Key": "An Idempotency-Key is 1 to 64 characters." });
  return key;
}

export async function unpublish(user: User, pageId: string): Promise<PublishStatus> {
  const { role } = await pageContext(user, pageId);
  requireOwner(role);
  const row = await one<{ publish_id: string; published_seq: number }>(
    pool,
    "UPDATE publishes SET state = 'unpublished', updated_at = now() WHERE page_id = $1 AND state = 'live' RETURNING publish_id, published_seq",
    [pageId],
  );
  if (!row) throw new ApiError(409, "not_live", "This page is not live.");
  return { state: "unpublished", publishId: row.publish_id, publishedSeq: row.published_seq, url: null };
}

async function fetchHeld(workspaceId: string, key: string): Promise<Buffer | null> {
  const cached = held.get(key);
  if (cached) return cached;
  const bytes = await getObject(workspaceId, key);
  if (bytes) hold(key, bytes);
  return bytes;
}

/** GET /p/<workspaceSlug>/<pageSlug>[/assets/<imageId>]: the latest live snapshot's bytes, unchanged. */
export async function servePublic(ctx: Ctx, workspaceSlug: string, pageSlug: string, imageId?: string): Promise<void> {
  const { res } = ctx;
  const notPublished = () => {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(publicMessagePage(pageCopy.publicNotFound.heading, pageCopy.publicNotFound.text));
  };
  const ws = await one<{ id: string; doc: WorkspaceDoc }>(pool, "SELECT id, doc FROM workspaces WHERE slug = $1", [workspaceSlug]);
  const page = ws?.doc.pages.find((p) => p.slug === pageSlug);
  if (!ws || !page) return notPublished();
  const row = await publishRow(page.id);
  if (!isLive(stateOf(row)) || !row || (imageId !== undefined && !row.images.includes(imageId))) return notPublished();
  const key = imageId === undefined ? `snapshots/${page.id}/${row.publish_id}.html` : `snapshots/${page.id}/${row.publish_id}/assets/${imageId}`;
  let bytes: Buffer | null;
  try {
    bytes = await fetchHeld(ws.id, key);
  } catch (error) {
    if (!(error instanceof StorageDown)) throw error;
    res.writeHead(503, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(publicMessagePage(pageCopy.publicUnavailable.heading, pageCopy.publicUnavailable.text));
    return;
  }
  if (!bytes) return notPublished();
  const type = imageId === undefined ? "text/html; charset=utf-8" : (imageType(bytes) ?? "application/octet-stream");
  res.writeHead(200, { "Content-Type": type, "Content-Length": bytes.length, "Cache-Control": "no-cache" });
  res.end(ctx.method === "HEAD" ? undefined : bytes);
}
