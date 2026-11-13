import { randomBytes } from "node:crypto";
import { COPY } from "../shared/copy.js";
import type { Deliveries, Delivery, Endpoint } from "../shared/types.js";
import { nowIso } from "./clock.js";
import { db, tx, type Queryable, type Row } from "./db.js";
import { ApiError, notFound } from "./errors.js";
import { exclusive } from "./locks.js";
import { enqueue, sendJob } from "./outbox.js";
import { checkEndpointUrl } from "./ssrf.js";
import { providers } from "./status.js";
import { attemptsOf, registerEndpoint, removeEndpoint, resend, rotate, sendMessage, type SvixAttempt } from "./svix.js";

const MAX_ENDPOINTS = 5;
type Settled = Delivery["state"];

interface NoticeMessage {
  number: string; version: number; supersedesVersion: number | null; effectiveDate: string; title: string;
  rows: { skuCode: string; name: string; kind: string; oldMrpPaise: number; revisedMrpPaise: number }[];
}

/** One delivery per notice version per endpoint live now, written with the work that will hand it to Svix. */
export async function queueNoticeDeliveries(q: Queryable, m: NoticeMessage): Promise<void> {
  const live = await q.query("SELECT id, account_id FROM endpoints WHERE removed_at IS NULL ORDER BY seq");
  for (const ep of live.rows) {
    const eventId = `${m.number}-v${m.version}-${ep.id as string}`;
    const eventType = m.version === 1 ? "notice.published" : "notice.corrected";
    const payload = {
      eventType, eventId, noticeNumber: m.number, version: m.version, supersedesVersion: m.supersedesVersion,
      effectiveDate: m.effectiveDate, title: m.title, rows: m.rows, pdfPath: `/api/notices/${m.number}/versions/${m.version}/pdf`,
    };
    await q.query(
      "INSERT INTO deliveries (event_id, endpoint_id, account_id, event_type, notice_number, notice_version, payload, created_at, queued_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)",
      [eventId, ep.id, ep.account_id, eventType, m.number, m.version, JSON.stringify(payload), nowIso()],
    );
    await enqueue(q, sendJob(eventId));
  }
}

interface Held { redeliveryKnown: number | null; attempts: SvixAttempt[] }

/** State comes only from Svix attempts; a redelivery counts from the attempts known when it was requested. */
function judge(d: Held): { state: Settled; outstanding: boolean } {
  const finished = d.attempts.filter((a) => a.outcome !== "pending");
  if (d.redeliveryKnown !== null) {
    const newer = finished.length - d.redeliveryKnown;
    if (newer > 0 && finished.slice(0, newer).some((a) => a.outcome === "success")) return { state: "redelivered", outstanding: false };
    return { state: "failed", outstanding: newer <= 0 };
  }
  if (finished.some((a) => a.outcome === "success")) return { state: "delivered", outstanding: false };
  return { state: finished.length ? "failed" : "pending", outstanding: false };
}

const held = (r: Row): Held => ({ redeliveryKnown: (r.redelivery_known as number | null) ?? null, attempts: r.attempts as SvixAttempt[] });

async function refresh(r: Row, timeoutMs: number): Promise<Row> {
  if (!r.handed_over || !r.svix_msg_id || r.removed_at || ["delivered", "redelivered", "cancelled"].includes(r.state as string)) return r;
  try {
    const attempts = await attemptsOf(r.account_id as string, r.svix_msg_id as string, r.endpoint_id as string, timeoutMs);
    const next = { ...r, attempts };
    const { state } = judge(held(next));
    await db.query("UPDATE deliveries SET attempts = $2, state = $3 WHERE event_id = $1 AND state NOT IN ('cancelled')", [r.event_id, JSON.stringify(attempts), state]);
    return { ...next, state };
  } catch {
    return r;
  }
}

const SELECT = "SELECT d.*, e.url AS endpoint_url, e.removed_at FROM deliveries d JOIN endpoints e ON e.id = d.endpoint_id";

async function refreshed(rows: Row[]): Promise<Row[]> {
  if (!providers.svix) return rows;
  return Promise.all(rows.map((r) => refresh(r, 2500)));
}

function viewOf(r: Row): Delivery {
  const { outstanding } = judge(held(r));
  return {
    eventId: r.event_id as string, eventType: r.event_type as string, noticeNumber: (r.notice_number as string | null) ?? null,
    noticeVersion: (r.notice_version as number | null) ?? null, endpointId: r.endpoint_id as string, endpointUrl: r.endpoint_url as string,
    endpointRemoved: r.removed_at !== null, state: r.state as Settled, redeliveryRequested: r.state === "failed" && outstanding,
    attempts: (r.attempts as SvixAttempt[]).map((a) => ({ at: a.at, responseStatus: a.responseStatus, outcome: a.outcome })),
  };
}

export async function listDeliveries(accountId: string): Promise<Deliveries> {
  const rows = (await db.query(`${SELECT} WHERE d.account_id = $1 ORDER BY d.seq DESC`, [accountId])).rows;
  const fresh = await refreshed(rows);
  return { messagesQueued: !providers.svix, workQueued: !providers.broker, deliveries: fresh.map(viewOf) };
}

const endpointView = (r: Row): Endpoint => ({ id: r.id as string, url: r.url as string, registered: r.registered as boolean, createdAt: (r.created_at as Date).toISOString() });

export async function listEndpoints(accountId: string): Promise<Endpoint[]> {
  return (await db.query("SELECT * FROM endpoints WHERE account_id = $1 AND removed_at IS NULL ORDER BY seq", [accountId])).rows.map(endpointView);
}

async function ownEndpoint(accountId: string, id: string): Promise<Row> {
  const r = (await db.query("SELECT * FROM endpoints WHERE id = $1 AND account_id = $2 AND removed_at IS NULL", [id, accountId])).rows[0];
  if (!r) throw notFound();
  return r;
}

const refused = (reason: string): ApiError => new ApiError(422, "endpoint_refused", COPY.endpointRefused, { reason });

export async function saveEndpoint(accountId: string, bodyRaw: unknown): Promise<Endpoint & { signingSecret: string }> {
  const raw = (bodyRaw as { url?: unknown } | null)?.url;
  if (typeof raw !== "string") throw refused("invalid");
  const url = raw.trim();
  const created = await exclusive(`endpoints:${accountId}`, async () => {
    const live = (await db.query("SELECT normalized_url FROM endpoints WHERE account_id = $1 AND removed_at IS NULL", [accountId])).rows;
    if (live.length >= MAX_ENDPOINTS) throw new ApiError(409, "endpoint_limit", "You can keep up to 5 endpoints. Remove one first.");
    const checked = await checkEndpointUrl(url);
    if (live.some((e) => e.normalized_url === checked.normalized)) throw new ApiError(409, "endpoint_exists", "That endpoint is already saved.");
    if (checked.reason) throw refused(checked.reason);
    const id = randomBytes(8).toString("hex");
    const secret = `whsec_${randomBytes(24).toString("base64")}`;
    const row = (await db.query(
      "INSERT INTO endpoints (id, account_id, url, normalized_url, secret, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [id, accountId, url, checked.normalized, secret, nowIso()],
    )).rows[0]!;
    return { row, secret, normalized: checked.normalized };
  });
  const registered = await registerNow(created.row.id as string, accountId, created.normalized, created.secret);
  return { ...endpointView(created.row), registered, signingSecret: created.secret };
}

async function registerNow(id: string, accountId: string, url: string, secret: string): Promise<boolean> {
  try {
    await registerEndpoint({ id, accountId, url, secret });
    await db.query("UPDATE endpoints SET registered = true WHERE id = $1", [id]);
    return true;
  } catch {
    return false;
  }
}

export async function testEndpoint(accountId: string, id: string): Promise<{ eventId: string }> {
  const ep = await ownEndpoint(accountId, id);
  const checked = await checkEndpointUrl(ep.url as string);
  if (checked.reason) throw refused(checked.reason);
  const eventId = `test-${id}-${randomBytes(6).toString("hex")}`;
  const payload = { eventType: "interval.test", eventId, endpointId: id };
  await tx(async (q) => {
    await q.query(
      "INSERT INTO deliveries (event_id, endpoint_id, account_id, event_type, payload, created_at, queued_at) VALUES ($1,$2,$3,'interval.test',$4,$5,$5)",
      [eventId, id, accountId, JSON.stringify(payload), nowIso()],
    );
    await enqueue(q, sendJob(eventId));
  });
  return { eventId };
}

const rotating = new Set<string>();

export async function rotateSecret(accountId: string, id: string): Promise<{ id: string; signingSecret: string }> {
  const ep = await ownEndpoint(accountId, id);
  if (rotating.has(id)) throw new ApiError(409, "rotation_in_progress", COPY.rotationInProgress);
  rotating.add(id);
  try {
    const unavailable = new ApiError(503, "rotation_unavailable", COPY.rotationUnavailable);
    if (!ep.registered && !(await registerNow(id, accountId, ep.normalized_url as string, ep.secret as string))) throw unavailable;
    const secret = `whsec_${randomBytes(24).toString("base64")}`;
    try {
      await rotate(accountId, id, secret);
    } catch {
      throw unavailable;
    }
    await db.query("UPDATE endpoints SET secret = $2 WHERE id = $1", [id, secret]);
    return { id, signingSecret: secret };
  } finally {
    rotating.delete(id);
  }
}

export async function removeOwnEndpoint(accountId: string, id: string): Promise<void> {
  await ownEndpoint(accountId, id);
  const pending = (await db.query(`${SELECT} WHERE d.endpoint_id = $1`, [id])).rows;
  await refreshed(pending);
  await db.query("UPDATE endpoints SET removed_at = $2 WHERE id = $1", [id, nowIso()]);
  await db.query("UPDATE deliveries SET state = 'cancelled' WHERE endpoint_id = $1 AND state NOT IN ('delivered', 'redelivered', 'cancelled')", [id]);
  try {
    await removeEndpoint(accountId, id);
    await db.query("UPDATE endpoints SET svix_removed = true WHERE id = $1", [id]);
  } catch {
    // the reconciler repeats the removal once Svix answers
  }
}

async function requestRedelivery(r: Row): Promise<void> {
  const finished = (r.attempts as SvixAttempt[]).filter((a) => a.outcome !== "pending").length;
  await tx(async (q) => {
    await q.query("UPDATE deliveries SET redelivery_known = $2, resend_sent = false, queued_at = $3 WHERE event_id = $1", [r.event_id, finished, nowIso()]);
    await enqueue(q, sendJob(r.event_id as string));
  });
}

export async function redeliver(accountId: string, eventId: string): Promise<{ eventId: string; state: string; redeliveryRequested: true }> {
  const found = (await db.query(`${SELECT} WHERE d.event_id = $1 AND d.account_id = $2`, [eventId, accountId])).rows[0];
  if (!found) throw notFound();
  if (found.removed_at) throw new ApiError(409, "endpoint_removed", "That endpoint was removed.");
  const [r] = await refreshed([found]);
  if (r!.state !== "failed") throw new ApiError(409, "not_failed", "Only a failed message can be delivered again.");
  if (!judge(held(r!)).outstanding || r!.redelivery_known === null) await requestRedelivery(r!);
  return { eventId, state: "failed", redeliveryRequested: true };
}

export async function recoverFailed(accountId: string, id: string): Promise<{ requested: string[] }> {
  await ownEndpoint(accountId, id);
  const rows = await refreshed((await db.query(`${SELECT} WHERE d.endpoint_id = $1 ORDER BY d.seq DESC`, [id])).rows);
  const eligible = rows.filter((r) => r.state === "failed" && (r.redelivery_known === null || !judge(held(r)).outstanding));
  if (eligible.length === 0) throw new ApiError(409, "nothing_failed", COPY.nothingToRecover);
  for (const r of eligible) await requestRedelivery(r);
  return { requested: eligible.map((r) => r.event_id as string) };
}

type SendOutcome = "done" | "deferred" | "missing";

/** The `send` job: hands the message to Svix once, and resends it only for a request still outstanding. */
export function runSend(eventId: string): Promise<SendOutcome> {
  return exclusive(`send:${eventId}`, async () => {
    const d = (await db.query(`${SELECT} WHERE d.event_id = $1`, [eventId])).rows[0];
    if (!d) return "missing";
    if (d.removed_at) {
      await db.query("UPDATE deliveries SET state = 'cancelled' WHERE event_id = $1 AND state NOT IN ('delivered', 'redelivered', 'cancelled')", [eventId]);
      return "done";
    }
    if (d.state === "cancelled") return "done";
    let msgId = (d.svix_msg_id as string | null) ?? null;
    try {
      if (!d.handed_over) {
        const earlier = await db.query(
          "SELECT 1 FROM deliveries WHERE endpoint_id = $1 AND notice_number = $2 AND notice_version < $3 AND NOT handed_over AND state <> 'cancelled' LIMIT 1",
          [d.endpoint_id, d.notice_number, d.notice_version],
        );
        if (d.notice_number && earlier.rows.length) return "deferred";
        const ep = (await db.query("SELECT * FROM endpoints WHERE id = $1", [d.endpoint_id])).rows[0]!;
        if (!ep.registered) {
          await registerEndpoint({ id: ep.id as string, accountId: ep.account_id as string, url: ep.normalized_url as string, secret: ep.secret as string });
          await db.query("UPDATE endpoints SET registered = true WHERE id = $1", [ep.id]);
        }
        msgId = await sendMessage(d.account_id as string, {
          eventType: d.event_type as string, eventId, payload: d.payload, endpointId: d.endpoint_id as string,
        });
        await db.query("UPDATE deliveries SET handed_over = true, svix_msg_id = $2 WHERE event_id = $1", [eventId, msgId]);
      }
      if (d.redelivery_known !== null && !d.resend_sent && msgId) {
        await resend(d.account_id as string, msgId, d.endpoint_id as string);
        await db.query("UPDATE deliveries SET resend_sent = true WHERE event_id = $1", [eventId]);
      }
      return "done";
    } catch {
      return "deferred";
    }
  });
}

/** Work Svix still owes: endpoints to register or remove there, and deliveries whose job may have been lost to an outage. */
export async function reconcileSvix(): Promise<void> {
  if (!providers.svix) return;
  const toRegister = (await db.query("SELECT * FROM endpoints WHERE removed_at IS NULL AND NOT registered ORDER BY seq LIMIT 20")).rows;
  for (const ep of toRegister) {
    try {
      await registerEndpoint({ id: ep.id as string, accountId: ep.account_id as string, url: ep.normalized_url as string, secret: ep.secret as string });
      await db.query("UPDATE endpoints SET registered = true WHERE id = $1", [ep.id]);
    } catch {
      return;
    }
  }
  const toRemove = (await db.query("SELECT * FROM endpoints WHERE removed_at IS NOT NULL AND NOT svix_removed ORDER BY seq LIMIT 20")).rows;
  for (const ep of toRemove) {
    try {
      await removeEndpoint(ep.account_id as string, ep.id as string);
      await db.query("UPDATE endpoints SET svix_removed = true WHERE id = $1", [ep.id]);
    } catch {
      return;
    }
  }
  if (!providers.broker) return;
  const stale = new Date(Date.now() - 4000).toISOString();
  const owed = (await db.query(
    `SELECT d.event_id FROM deliveries d JOIN endpoints e ON e.id = d.endpoint_id
     WHERE e.removed_at IS NULL AND d.state <> 'cancelled' AND d.queued_at < $1
       AND (NOT d.handed_over OR (d.redelivery_known IS NOT NULL AND NOT d.resend_sent))
       AND NOT EXISTS (SELECT 1 FROM outbox o WHERE NOT o.published AND o.job->>'eventId' = d.event_id)
     LIMIT 50`,
    [stale],
  )).rows;
  for (const r of owed) {
    await tx(async (q) => {
      await q.query("UPDATE deliveries SET queued_at = $2 WHERE event_id = $1", [r.event_id, new Date().toISOString()]);
      await enqueue(q, sendJob(r.event_id as string));
    });
  }
}

