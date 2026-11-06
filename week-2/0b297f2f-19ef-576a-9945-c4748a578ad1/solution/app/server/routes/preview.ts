import { randomUUID } from "node:crypto";
import { read, type Db } from "../db.js";
import { ApiError, imageStoreUnavailable, notFound, validationFailed } from "../errors.js";
import { writeEvent } from "../events.js";
import { museumDisplay, previewNext, publishTime, startsNewPreview, type PreviewStatus } from "../domain/preview.js";
import { json, jsonBody, route, type Ctx, type Route } from "../http.js";
import { exhibition, requireRole } from "../model.js";
import { config } from "../config.js";
import { deliverQueued } from "../publisher.js";
import { getObject, StoreUnavailable } from "../s3.js";
import { idempotentChange } from "./support.js";

const conflict = () => new ApiError(409, "preview_conflict", "The preview can't make that change from its current state.");

interface PreviewTimes {
  id: string;
  date: string | null;
  published_at: Date | null;
  withdrawn_at: Date | null;
}

/** A previews row, typed by the schema's checks: a scheduled preview always has its publish time. */
type PreviewRow = PreviewTimes &
  ({ status: "scheduled"; publish_at: Date } | { status: Exclude<PreviewStatus, "scheduled">; publish_at: Date | null });

interface RecipientRow {
  lender_id: string;
  lender_name: string;
  email: string;
  delivery: "queued" | "sent" | "cancelled";
  sent_at: Date | null;
}

async function currentRow(db: Db, lock = false) {
  const { rows } = await db.query<PreviewRow>(
    `SELECT * FROM previews ORDER BY created_at DESC LIMIT 1${lock ? " FOR UPDATE" : ""}`,
  );
  return rows[0];
}

/** The preview shape (brief: API, Shapes); remainingMs is the server's own countdown. */
async function previewView(db: Db) {
  const row = await currentRow(db);
  const { timeZone } = await exhibition(db);
  const now = Date.now();
  const recipients = (
    await db.query<RecipientRow>(
      `SELECT r.lender_id, r.lender_name, r.email, r.delivery, r.sent_at FROM recipients r
       JOIN lenders l ON l.id = r.lender_id WHERE r.preview_id = $1 ORDER BY l.position`,
      [row.id],
    )
  ).rows.map((r) => ({
    lenderId: r.lender_id,
    lenderName: r.lender_name,
    email: r.email,
    delivery: r.delivery,
    sentAt: r.sent_at ? r.sent_at.toISOString() : null,
  }));
  const at = (value: Date | null) => (value ? value.toISOString() : null);
  const shown = (value: Date | null) => (value ? museumDisplay(value, timeZone) : null);
  return {
    id: row.id,
    status: row.status,
    date: row.date,
    publishAt: at(row.publish_at),
    publishAtDisplay: shown(row.publish_at),
    remainingMs: row.status === "scheduled" ? Math.max(0, row.publish_at.getTime() - now) : null,
    publishedAt: at(row.published_at),
    publishedAtDisplay: shown(row.published_at),
    withdrawnAt: at(row.withdrawn_at),
    withdrawnAtDisplay: shown(row.withdrawn_at),
    recipients,
  };
}

async function schedule(ctx: Ctx) {
  return idempotentChange(ctx, "POST /api/preview/schedule", async (db, idem) => {
    requireRole(ctx.staff, "curator");
    idem?.assertNoConflict();
    const row = await currentRow(db, true);
    if (!previewNext("schedule", row.status)) throw conflict();
    const ex = await exhibition(db);
    const checked = publishTime(jsonBody(ctx).date, new Date(), ex.timeZone, config.publishDelaySeconds);
    if (!checked.ok) {
      throw validationFailed({
        date:
          checked.field === "badly_formed"
            ? "Enter a date as YYYY-MM-DD."
            : "Choose a later date: 09:00 museum time on that date is less than 2 hours away.",
      });
    }
    const date = jsonBody(ctx).date as string;
    let id = row.id;
    if (startsNewPreview(row.status)) {
      id = randomUUID();
      await db.query(
        "INSERT INTO previews (id, exhibition_id, status, date, publish_at) VALUES ($1,$2,'scheduled',$3,$4)",
        [id, ex.id, date, checked.publishAt],
      );
    } else {
      await db.query("UPDATE previews SET status = 'scheduled', date = $2, publish_at = $3 WHERE id = $1", [
        id,
        date,
        checked.publishAt,
      ]);
    }
    const seq = await writeEvent(db, "preview.scheduled", ctx.staff, {
      previewId: id,
      publishAtDisplay: museumDisplay(checked.publishAt, ex.timeZone),
    });
    return { status: 200, body: { preview: await previewView(db), seq } };
  });
}

async function cancel(ctx: Ctx) {
  return idempotentChange(ctx, "POST /api/preview/cancel", async (db, idem) => {
    requireRole(ctx.staff, "curator");
    idem?.assertNoConflict();
    const row = await currentRow(db, true);
    if (!previewNext("cancel", row.status)) throw conflict();
    await db.query("UPDATE previews SET status = 'draft', date = NULL, publish_at = NULL WHERE id = $1", [row.id]);
    const seq = await writeEvent(db, "preview.cancelled", ctx.staff, { previewId: row.id });
    return { status: 200, body: { preview: await previewView(db), seq } };
  });
}

async function withdraw(ctx: Ctx) {
  const reply = await idempotentChange(ctx, "POST /api/preview/withdraw", async (db, idem) => {
    requireRole(ctx.staff, "curator");
    idem?.assertNoConflict();
    const row = await currentRow(db, true);
    if (!previewNext("withdraw", row.status)) throw conflict();
    await db.query("UPDATE previews SET status = 'withdrawn', withdrawn_at = now() WHERE id = $1", [row.id]);
    await db.query("UPDATE recipients SET notice = 'queued' WHERE preview_id = $1 AND delivery = 'sent'", [row.id]);
    await db.query("UPDATE recipients SET delivery = 'cancelled' WHERE preview_id = $1 AND delivery = 'queued'", [row.id]);
    const seq = await writeEvent(db, "preview.withdrawn", ctx.staff, { previewId: row.id });
    return { status: 200, body: { preview: await previewView(db), seq } };
  });
  // Withdrawal notices leave with the withdrawal; a relay that is down keeps them queued for retry.
  await deliverQueued().catch(() => undefined);
  return reply;
}

type LinkState = { state: "valid"; previewId: string; lenderId: string } | { state: "unknown" } | { state: "withdrawn" };

/** What a capability link grants: one lender's snapshot in one preview, until withdrawal. */
export async function linkState(token: string): Promise<LinkState> {
  return read(async (db) => {
    // Tokens are URL-safe characters only; anything else (a NUL byte included) names no link.
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(token)) return { state: "unknown" };
    const { rows } = await db.query(
      "SELECT r.preview_id, r.lender_id, p.status FROM recipients r JOIN previews p ON p.id = r.preview_id WHERE r.token = $1",
      [token],
    );
    if (!rows[0]) return { state: "unknown" };
    if (rows[0].status === "withdrawn") return { state: "withdrawn" };
    return { state: "valid", previewId: rows[0].preview_id, lenderId: rows[0].lender_id };
  });
}

async function snapshotFile(ctx: Ctx, file: "snapshot.json" | "snapshot.png", contentType: string) {
  const link = await linkState(ctx.params.token);
  if (link.state === "unknown") throw notFound();
  if (link.state === "withdrawn") throw new ApiError(410, "link_withdrawn", "This preview has been withdrawn by the museum.");
  let stored;
  try {
    stored = await getObject(`previews/${link.previewId}/${link.lenderId}/${file}`);
  } catch (error) {
    if (error instanceof StoreUnavailable) throw imageStoreUnavailable();
    throw error;
  }
  if (!stored) throw notFound();
  return { status: 200, raw: stored.body, contentType, headers: { "Cache-Control": "no-store" } };
}

export const previewRoutes: Route[] = [
  route("GET", "/api/preview", () => read(async (db) => json(200, { preview: await previewView(db) }))),
  route("POST", "/api/preview/schedule", schedule),
  route("POST", "/api/preview/cancel", cancel),
  route("POST", "/api/preview/withdraw", withdraw),
  route("GET", "/api/p/:token", (ctx) => snapshotFile(ctx, "snapshot.json", "application/json; charset=utf-8"), false),
  route("GET", "/api/p/:token/snapshot.png", (ctx) => snapshotFile(ctx, "snapshot.png", "image/png"), false),
];
