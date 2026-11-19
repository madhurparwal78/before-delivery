import { createHmac, timingSafeEqual } from "node:crypto";
import type { OpsWorkspace, WorkspaceState } from "../../shared/types.js";
import { isoInstant } from "../../shared/time.js";
import { operator } from "../auth.js";
import { config } from "../config.js";
import { sql } from "../db.js";
import { HttpError, json, parseJson, route } from "../http.js";
import { EVENT_TYPES, settleState, type EventType } from "../subscription.js";
import { isUuid } from "./tasks.js";

/** v1=<hex HMAC-SHA256 of "<timestamp>.<raw body>"> keyed with the Kill Bill API secret (modules/webhooks). */
function signatureValid(timestamp: string, raw: Buffer, header: string): boolean {
  const expected = Buffer.from(
    `v1=${createHmac("sha256", config.killbill.apiSecret).update(`${timestamp}.`).update(raw).digest("hex")}`,
  );
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

route(
  "POST",
  "/api/billing/callbacks",
  async (ctx) => {
    const timestamp = String(ctx.req.headers["x-tidemark-timestamp"] ?? "");
    const signature = String(ctx.req.headers["x-tidemark-signature"] ?? "");
    if (!signatureValid(timestamp, ctx.raw, signature)) {
      throw new HttpError(401, "invalid_signature", "The callback signature doesn't match.");
    }
    const sent = /^\d+$/.test(timestamp) ? Number(timestamp) : NaN;
    if (!(Math.abs(Date.now() / 1000 - sent) <= config.billingCallbackToleranceSeconds)) {
      throw new HttpError(401, "stale_timestamp", "The callback timestamp is outside the allowed window.");
    }
    const body = parseJson(ctx);
    const eventId = typeof body.eventId === "string" && body.eventId.length > 0 && body.eventId.length <= 200 ? body.eventId : null;
    const [seen] = eventId ? await sql`SELECT 1 FROM billing_events WHERE event_id = ${eventId}` : [];
    if (seen) return json(200, { received: true, duplicate: true });
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
    const [workspace] = isUuid(workspaceId) ? await sql`SELECT id FROM workspaces WHERE id = ${workspaceId}` : [];
    if (!workspace) throw new HttpError(404, "unknown_workspace", "No workspace has that id.");
    const occurredAt = typeof body.occurredAt === "string" ? Date.parse(body.occurredAt) : NaN;
    const type = (EVENT_TYPES as readonly string[]).includes(String(body.type)) ? (body.type as EventType) : null;
    const seats = body.seats;
    const fields: Record<string, string> = {};
    if (!eventId) fields.eventId = "Send an event id.";
    if (!type) fields.type = "Unknown event type.";
    if (!Number.isFinite(occurredAt) || !/Z$/.test(String(body.occurredAt))) fields.occurredAt = "Send an ISO 8601 UTC instant.";
    if (type === "seats.changed" && !(Number.isInteger(seats) && Number(seats) >= 0)) fields.seats = "Send the billed seat count.";
    if (Object.keys(fields).length || !eventId || !type) throw new HttpError(422, "validation_failed", "The callback is incomplete.", { fields });
    const result = await sql.begin(async (tx) => {
      await tx`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`;
      const [stored] = await tx`
        INSERT INTO billing_events (event_id, workspace_id, type, occurred_at, seats)
        VALUES (${eventId}, ${workspaceId}, ${type}, ${new Date(occurredAt)}, ${type === "seats.changed" ? Number(seats) : null})
        ON CONFLICT (event_id) DO NOTHING RETURNING event_id`;
      if (!stored) return { received: true, duplicate: true };
      if (type === "seats.changed") {
        const [newest] = await tx<{ event_id: string }[]>`
          SELECT event_id FROM billing_events WHERE workspace_id = ${workspaceId} AND type = 'seats.changed'
          ORDER BY occurred_at DESC, event_id DESC LIMIT 1`;
        return { received: true, applied: newest.event_id === eventId };
      }
      const replayed = await settleState(tx, workspaceId, Date.now());
      return { received: true, applied: replayed.applied.has(eventId) };
    });
    return json(200, result);
  },
  "json",
);

route("GET", "/api/ops/workspaces", async (ctx) => {
  await operator(ctx);
  const rows = await sql<
    {
      id: string;
      name: string;
      state: WorkspaceState;
      trial_ends_at: Date;
      active_seats: number;
      billed_seats: number | null;
      last_billing_event_at: Date | null;
      pending: number;
      sent: number;
      batches: number;
      last_import_at: Date | null;
    }[]
  >`
    SELECT w.id, w.name, w.state, w.trial_ends_at,
      (SELECT e.seats FROM billing_events e WHERE e.workspace_id = w.id AND e.type = 'seats.changed' ORDER BY e.occurred_at DESC, e.event_id DESC LIMIT 1) AS billed_seats,
      (SELECT count(*)::int FROM members m WHERE m.workspace_id = w.id AND m.removed_at IS NULL AND m.status IN ('active','invited')) AS active_seats,
      (SELECT max(received_at) FROM billing_events e WHERE e.workspace_id = w.id) AS last_billing_event_at,
      (SELECT count(*)::int FROM outbox o WHERE o.workspace_id = w.id AND o.status = 'pending') AS pending,
      (SELECT count(*)::int FROM outbox o WHERE o.workspace_id = w.id AND o.status = 'done') AS sent,
      (SELECT count(*)::int FROM import_batches b WHERE b.workspace_id = w.id) AS batches,
      (SELECT max(created_at) FROM import_batches b WHERE b.workspace_id = w.id) AS last_import_at
    FROM workspaces w ORDER BY w.created_at DESC`;
  const workspaces: OpsWorkspace[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    state: r.state,
    trialEndsAt: isoInstant(r.trial_ends_at.getTime()),
    activeSeats: r.active_seats,
    billedSeats: r.billed_seats,
    lastBillingEventAt: r.last_billing_event_at ? isoInstant(r.last_billing_event_at.getTime()) : null,
    outbox: { pending: r.pending, sent: r.sent },
    imports: { batches: r.batches, lastAt: r.last_import_at ? isoInstant(r.last_import_at.getTime()) : null },
  }));
  return json(200, { workspaces });
});
