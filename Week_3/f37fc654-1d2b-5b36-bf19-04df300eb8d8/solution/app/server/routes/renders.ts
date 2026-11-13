// Concept previews: render jobs, the provider's verified callbacks and the stored preview
// (brief: API › Renders, Business rules › Render jobs, Reference images).
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { requireCaller } from "../auth.js";
import { commissionFor } from "../commissions.js";
import { config } from "../config.js";
import { isUniqueViolation, notify, one, pool, tx } from "../db.js";
import { fail, invalid, jsonBody, noContent, ok, record, UUID, type Request, type Router } from "../http.js";
import { enqueue } from "../jobs.js";
import { getObject } from "../providers/s3.js";
import { imageKind } from "../rules/content.js";
import { fetchReferenceImage } from "../rules/ssrf.js";

const CALLBACK_LIMIT = 16_777_216;
const TIMESTAMP_WINDOW_S = 300;

export const previewKey = (commissionId: string, renderId: string): string => `commissions/${commissionId}/renders/${renderId}.png`;

interface RenderRow {
  id: string; commission_id: string; state: string; progress: number; provider_job_id: string | null; failure_reason: string | null;
  preview_sha256: string | null; terminal_event: string | null; created_at: Date;
}

const renderView = (r: RenderRow) => ({
  id: r.id, commissionId: r.commission_id, state: r.state, progress: r.progress, providerJobId: r.provider_job_id,
  failureReason: r.failure_reason, previewSha256: r.preview_sha256,
});

async function request(req: Request) {
  const caller = await requireCaller(req);
  const c = await commissionFor(pool, caller, req.params.id, ["owner", "producer"]);
  const body = record(jsonBody(req));
  const photoId = String(body.venuePhotoFileId ?? "");
  const photo = UUID.test(photoId)
    ? await one("SELECT 1 FROM files WHERE id = $1 AND commission_id = $2 AND kind = 'venue_photo' AND status = 'stored'", [photoId, c.id])
    : null;
  if (!photo) fail(404, "not_found");
  if (!["briefed", "previewed", "placed"].includes(c.state)) fail(409, "illegal_state");
  const address = typeof body.referenceImageUrl === "string" ? body.referenceImageUrl.trim() : "";
  let reference: { sourceUrl: string; contentType: string; bytes: Buffer } | null = null;
  if (address) {
    const fetched = await fetchReferenceImage(address);
    if (!fetched.ok) {
      invalid({ referenceImageUrl: fetched.reason === "unsafe" ? "That address can't be used for a reference image." : "We couldn't fetch an image from that address." });
    }
    reference = fetched;
  }
  const id = randomUUID();
  const row = await tx(async (db) => {
    const created = await one<RenderRow & Record<string, unknown>>(
      `INSERT INTO render_jobs (id, commission_id, venue_photo_file_id, reference_url, reference_content_type, reference_sha256, reference_bytes, layout, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued') RETURNING *`,
      [id, c.id, photoId, reference?.sourceUrl ?? null, reference?.contentType ?? null,
        reference ? createHash("sha256").update(reference.bytes).digest("hex") : null, reference?.bytes ?? null,
        c.layout.length ? JSON.stringify(c.layout) : null],
      db,
    );
    await enqueue(db, "render_submit", c.id, { renderJobId: id, callbackUrl: `${config.publicUrl}/api/render-callbacks` });
    return created as RenderRow;
  });
  return ok({ id: row.id, commissionId: c.id, state: row.state, progress: row.progress, createdAt: row.created_at.toISOString() }, 202);
}

async function renderFor(req: Request): Promise<RenderRow> {
  const caller = await requireCaller(req);
  if (!UUID.test(req.params.id)) fail(404, "not_found");
  const row = await one<RenderRow & Record<string, unknown>>("SELECT * FROM render_jobs WHERE id = $1", [req.params.id]);
  if (!row) fail(404, "not_found");
  await commissionFor(pool, caller, row.commission_id, ["owner", "producer"]);
  return row;
}

async function read(req: Request) {
  return ok(renderView(await renderFor(req)));
}

async function preview(req: Request) {
  const row = await renderFor(req);
  if (row.state !== "ready") fail(409, "not_ready");
  return { status: 200, bytes: await getObject(previewKey(row.commission_id, row.id)), headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } };
}

/** `v1=` + hex HMAC-SHA256 of `<timestamp>.<raw body>`, compared in constant time. */
function signatureValid(timestamp: string, raw: Buffer, given: string): boolean {
  const expected = Buffer.from(`v1=${createHmac("sha256", config.render.webhookSecret).update(`${timestamp}.`).update(raw).digest("hex")}`);
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function callback(req: Request) {
  const timestamp = String(req.headers["x-render-timestamp"] ?? "");
  if (!signatureValid(timestamp, req.raw, String(req.headers["x-render-signature"] ?? ""))) fail(401, "bad_signature");
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > TIMESTAMP_WINDOW_S) fail(401, "stale_timestamp");
  const event = record(jsonBody(req));
  const jobRef = String(event.jobRef ?? "");
  const eventId = String(event.eventId ?? "");
  const type = String(event.type ?? "");
  const known = UUID.test(jobRef) ? await one<RenderRow & Record<string, unknown>>("SELECT * FROM render_jobs WHERE id = $1", [jobRef]) : null;
  if (!known) fail(404, "not_found");
  let png: Buffer | null = null;
  if (type === "render.completed") {
    const previewBody = record(event.preview);
    png = typeof previewBody.base64 === "string" ? Buffer.from(previewBody.base64, "base64") : null;
    if (!png || imageKind(png) !== "image/png") invalid({ preview: "Preview must be a PNG image." });
  }
  await tx(async (db) => {
    try {
      await db.query("SAVEPOINT event");
      await db.query("INSERT INTO render_callbacks (event_id, render_job_id) VALUES ($1, $2)", [eventId, jobRef]);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      await db.query("ROLLBACK TO SAVEPOINT event");
      return;
    }
    const render = (await one<RenderRow & Record<string, unknown>>("SELECT * FROM render_jobs WHERE id = $1 FOR UPDATE", [jobRef], db)) as RenderRow;
    if (render.terminal_event) return;
    const progress = Math.max(render.progress, Math.min(100, Math.max(0, Math.round(Number(event.progress) || 0))));
    const verified = ["queued", "submitted"].includes(render.state) ? "callback_verified" : render.state;
    if (type === "render.completed" && png) {
      await db.query(
        "UPDATE render_jobs SET state = $2, progress = 100, terminal_event = $3, preview_bytes = $4, preview_sha256 = $5, updated_at = now() WHERE id = $1",
        [jobRef, verified, eventId, png, createHash("sha256").update(png).digest("hex")],
      );
      await enqueue(db, "render_store", render.commission_id, { renderJobId: jobRef });
    } else if (type === "render.failed") {
      await db.query("UPDATE render_jobs SET state = 'failed', terminal_event = $2, failure_reason = $3, updated_at = now() WHERE id = $1",
        [jobRef, eventId, String(event.failureReason ?? "render_failed").slice(0, 200)]);
    } else {
      await db.query("UPDATE render_jobs SET state = $2, progress = $3, updated_at = now() WHERE id = $1", [jobRef, verified, progress]);
    }
    const state = type === "render.failed" ? "failed" : verified;
    await notify(db, "render.updated", { renderId: jobRef, state, progress: type === "render.completed" ? 100 : progress, commissionId: render.commission_id });
  });
  return noContent();
}

export function registerRenders(router: Router): void {
  router.add("POST", "/api/commissions/:id/renders", request);
  router.add("GET", "/api/renders/:id", read);
  router.add("GET", "/api/renders/:id/preview", preview);
  router.add("POST", "/api/render-callbacks", callback, CALLBACK_LIMIT);
}
