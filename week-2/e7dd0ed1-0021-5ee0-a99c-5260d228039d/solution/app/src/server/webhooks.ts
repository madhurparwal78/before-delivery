// Webhook endpoints, the event outbox and signed, ordered delivery (brief: Webhook endpoints; Events
// and delivery). Endpoint transitions: active ⇄ disabled → deleted. Delivery transitions:
// pending → delivered | dead; dead → pending by redeliver.
import { createHmac, randomUUID } from "node:crypto";
import type pg from "pg";
import { authorize, membership } from "./access.js";
import { config } from "./config.js";
import { one, pool, query, row, tx } from "./db.js";
import { ApiError, invalid, transition } from "./errors.js";
import { fieldErrors, isoOrNull, isoSecond, readJson, sendJson, sendNoContent, type Ctx } from "./http.js";
import { characters, ENDPOINT_LIMIT, WEBHOOK_ATTEMPTS, WEBHOOK_MESSAGES, webhookUrlAllowed } from "./limits.js";
import { enqueueMail, ownersOf } from "./mail.js";
import type { Bucket, Version } from "./objects.js";
import { newId, randomToken, seal, unseal } from "./secrets.js";
import { formatCount } from "../shared/format.js";

type EventType = "object.created" | "object.deleted" | "object.restored" | "version.removed";
const EVENT_TYPES: readonly EventType[] = ["object.created", "object.deleted", "object.restored", "version.removed"];

interface EndpointRow {
  id: string;
  workspace_id: string;
  url: string;
  events: EventType[];
  buckets: string[] | null;
  description: string;
  state: "active" | "disabled";
  sealed_secret: string;
  created_at: Date;
}

interface DeliveryRow {
  id: string;
  endpoint_id: string;
  event_id: string;
  event_type: EventType;
  sequence: number;
  state: "pending" | "delivered" | "dead";
  attempts: number;
  last_status: number | null;
  last_error: "http_status" | "timeout" | "connection_failed" | null;
  next_attempt_at: Date | null;
  delivered_at: Date | null;
  body: string;
}

const endpointJson = (e: EndpointRow): Record<string, unknown> => ({
  id: e.id, url: e.url, events: e.events, buckets: e.buckets, description: e.description, state: e.state,
  created_at: isoSecond(e.created_at),
});

const deliveryJson = (d: DeliveryRow): Record<string, unknown> => ({
  id: d.id, event_id: d.event_id, event_type: d.event_type, sequence: d.sequence, state: d.state, attempts: d.attempts,
  last_status: d.last_status, last_error: d.last_error, next_attempt_at: isoOrNull(d.next_attempt_at),
  delivered_at: isoOrNull(d.delivered_at),
});

// ---- Events ----

// Records one event in the change that causes it, with one delivery for every active endpoint that
// subscribes to its type and has its bucket in scope. Each endpoint's sequence is gapless.
export async function recordEvent(client: pg.PoolClient, bucket: Bucket, type: EventType, version: Version, at: Date,
                                  reason?: "lifecycle" | "request"): Promise<void> {
  const eventId = randomUUID();
  await client.query(
    "INSERT INTO events (id, workspace_id, type, occurred_at, bucket, key, version_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [eventId, bucket.workspace_id, type, at, bucket.name, version.key, version.version_id]);
  const endpoints = await query<{ id: string }>(client,
    `SELECT id FROM webhook_endpoints WHERE workspace_id = $1 AND state = 'active' AND $2 = ANY(events)
       AND (buckets IS NULL OR $3 = ANY(buckets)) ORDER BY id`, [bucket.workspace_id, type, bucket.name]);
  for (const endpoint of endpoints) {
    const allocated = await one<{ sequence: number }>(client,
      "UPDATE webhook_endpoints SET next_sequence = next_sequence + 1 WHERE id = $1 RETURNING next_sequence - 1 AS sequence",
      [endpoint.id]);
    if (!allocated) continue;
    const body = JSON.stringify({
      id: eventId, type, sequence: allocated.sequence, occurred_at: isoSecond(at), bucket: bucket.name, key: version.key,
      version_id: version.version_id, etag: version.etag, size: version.size, ...(reason ? { reason } : {}),
    });
    await client.query(
      `INSERT INTO deliveries (id, endpoint_id, event_id, event_type, sequence, state, next_attempt_at, body)
       VALUES ($1, $2, $3, $4, $5, 'pending', now(), $6)`, [newId(), endpoint.id, eventId, type, allocated.sequence, body]);
  }
  if (endpoints.length) wakeDeliveries();
}

// ---- Endpoint API ----

async function endpointFor(ctx: Ctx, client: pg.PoolClient | pg.Pool, workspaceId: string, lock = false): Promise<EndpointRow> {
  const endpoint = await one<EndpointRow>(client,
    `SELECT * FROM webhook_endpoints WHERE id = $1 AND workspace_id = $2${lock ? " FOR UPDATE" : ""}`,
    [ctx.params.id ?? "", workspaceId]);
  if (!endpoint) throw new ApiError("not_found");
  return endpoint;
}

export async function listEndpoints(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  authorize(m, "administer");
  const rows = await query<EndpointRow>(pool, "SELECT * FROM webhook_endpoints WHERE workspace_id = $1 ORDER BY created_at, id",
    [m.workspace.id]);
  sendJson(ctx, 200, { endpoints: rows.map(endpointJson) });
}

export async function createEndpoint(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  authorize(m, "administer");
  const body = await readJson(ctx);
  const created = await tx(async (client) => {
    await client.query("SELECT 1 FROM workspaces WHERE id = $1 FOR UPDATE", [m.workspace.id]);
    const count = await one<{ n: number }>(client, "SELECT count(*)::int AS n FROM webhook_endpoints WHERE workspace_id = $1",
      [m.workspace.id]);
    if ((count?.n ?? 0) >= ENDPOINT_LIMIT) throw new ApiError("endpoint_limit");
    const errors = fieldErrors(body, ["url", "events", "buckets", "description"], ["url", "events", "buckets", "description"]);
    if (!errors.url && !webhookUrlAllowed(body.url)) errors.url = WEBHOOK_MESSAGES.url;
    const events = body.events;
    if (!errors.events && !(Array.isArray(events) && events.length >= 1 && events.length <= 4 &&
        events.every((e) => typeof e === "string" && (EVENT_TYPES as readonly string[]).includes(e)) &&
        new Set(events).size === events.length)) errors.events = WEBHOOK_MESSAGES.events;
    const buckets = body.buckets;
    if (!errors.buckets && buckets !== null) {
      const names = await query<{ name: string }>(client, "SELECT name FROM buckets WHERE workspace_id = $1", [m.workspace.id]);
      const known = new Set(names.map((b) => b.name));
      if (!(Array.isArray(buckets) && buckets.length >= 1 && buckets.every((b) => typeof b === "string" && known.has(b)) &&
          new Set(buckets).size === buckets.length)) errors.buckets = WEBHOOK_MESSAGES.buckets;
    }
    if (!errors.description && !(typeof body.description === "string" && characters(body.description) <= 140)) {
      errors.description = WEBHOOK_MESSAGES.description;
    }
    if (Object.keys(errors).length) throw invalid(errors);
    const secret = `whsec_${randomToken(32)}`;
    const endpoint = await row<EndpointRow>(client,
      `INSERT INTO webhook_endpoints (id, workspace_id, url, events, buckets, description, state, sealed_secret, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, now()) RETURNING *`,
      [newId(), m.workspace.id, body.url, events, buckets, body.description, seal(secret)]);
    return { endpoint, secret };
  });
  sendJson(ctx, 201, { ...endpointJson(created.endpoint), secret: created.secret });
}

// Endpoint transitions, decided here and nowhere else: active ⇄ disabled, disabled → deleted.
// Deleting an endpoint discards its undelivered deliveries with it.
const ENDPOINT_EDGES: Record<"active" | "disabled" | "deleted", EndpointRow["state"]> = { active: "disabled", disabled: "active", deleted: "disabled" };

async function moveEndpoint(client: pg.PoolClient, endpoint: EndpointRow, to: "deleted"): Promise<null>;
async function moveEndpoint(client: pg.PoolClient, endpoint: EndpointRow, to: EndpointRow["state"]): Promise<EndpointRow>;
async function moveEndpoint(client: pg.PoolClient, endpoint: EndpointRow, to: keyof typeof ENDPOINT_EDGES): Promise<EndpointRow | null> {
  if (endpoint.state !== ENDPOINT_EDGES[to]) throw transition(endpoint.state, to);
  if (to === "deleted") {
    await client.query("DELETE FROM webhook_endpoints WHERE id = $1", [endpoint.id]);
    return null;
  }
  return row<EndpointRow>(client, "UPDATE webhook_endpoints SET state = $2 WHERE id = $1 RETURNING *", [endpoint.id, to]);
}

// POST …/webhooks/{id}/disable and …/enable: active ⇄ disabled.
export async function setEndpointState(ctx: Ctx): Promise<void> {
  const to = ctx.path.endsWith("/enable") ? "active" : "disabled";
  const m = await membership(ctx, ctx.params.ws ?? "");
  const updated = await tx(async (client) => {
    const endpoint = await endpointFor(ctx, client, m.workspace.id, true);
    authorize(m, "administer");
    return moveEndpoint(client, endpoint, to);
  });
  if (to === "active") wakeDeliveries();
  sendJson(ctx, 200, endpointJson(updated));
}


export async function deleteEndpoint(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  await tx(async (client) => {
    const endpoint = await endpointFor(ctx, client, m.workspace.id, true);
    authorize(m, "administer");
    await moveEndpoint(client, endpoint, "deleted");
  });
  sendNoContent(ctx);
}

export async function listDeliveries(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  const endpoint = await endpointFor(ctx, pool, m.workspace.id);
  authorize(m, "administer");
  const cursor = ctx.query.get("cursor");
  if (cursor !== null && !/^[1-9]\d{0,15}$/.test(cursor)) throw invalid({ cursor: "This page link is no longer valid." });
  const rows = await query<DeliveryRow>(pool,
    `SELECT * FROM deliveries WHERE endpoint_id = $1 AND ($2::bigint IS NULL OR sequence < $2) ORDER BY sequence DESC LIMIT 51`,
    [endpoint.id, cursor]);
  const page = rows.slice(0, 50);
  sendJson(ctx, 200, {
    deliveries: page.map(deliveryJson),
    next_cursor: rows.length > 50 ? String(page[page.length - 1]?.sequence) : null,
  });
}

export async function redeliver(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  const updated = await tx(async (client) => {
    const endpoint = await endpointFor(ctx, client, m.workspace.id);
    const delivery = await one<DeliveryRow>(client, "SELECT * FROM deliveries WHERE id = $1 AND endpoint_id = $2 FOR UPDATE",
      [ctx.params.delivery ?? "", endpoint.id]);
    if (!delivery) throw new ApiError("not_found");
    authorize(m, "administer");
    const requeued = await moveDelivery(client, delivery.id, "redeliver",
      { set: "attempts = 0, next_attempt_at = now(), last_status = NULL, last_error = NULL", params: [] });
    if (!requeued) throw transition(delivery.state, "pending");
    return requeued;
  });
  wakeDeliveries();
  sendJson(ctx, 202, deliveryJson(updated));
}

// ---- Delivery ----

// Delivery transitions, decided here and nowhere else: pending → delivered or dead, pending stays
// pending after a failed attempt (backoff), dead → pending by redeliver. The one delivery write moves
// the row along `edge` only from the edge's legal state, setting `change.set` ($1 is the id), and
// answers the moved row, if any.
const DELIVERY_EDGES = {
  deliver: { from: "pending", to: "delivered" },
  kill: { from: "pending", to: "dead" },
  backoff: { from: "pending", to: "pending" },
  redeliver: { from: "dead", to: "pending" },
} as const satisfies Record<string, { from: DeliveryRow["state"]; to: DeliveryRow["state"] }>;

async function moveDelivery(client: pg.PoolClient, id: string, edge: keyof typeof DELIVERY_EDGES,
                            change: { set: string; params: unknown[] }): Promise<DeliveryRow | undefined> {
  const { from, to } = DELIVERY_EDGES[edge];
  const n = change.params.length;
  return one<DeliveryRow>(client,
    `UPDATE deliveries SET state = $${n + 2}, ${change.set} WHERE id = $1 AND state = $${n + 3} RETURNING *`, [id, ...change.params, to, from]);
}

function signature(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", Buffer.from(secret, "utf8")).update(`${timestamp}.${body}`).digest("hex");
}

// After failed attempt k (1 to 5) the next attempt waits base × 2^(k−1) seconds.
const backoffSeconds = (attempt: number): number => config.webhookBackoffSeconds * 2 ** (attempt - 1);

interface Due {
  endpoint_id: string;
  url: string;
  sealed_secret: string;
  workspace_id: string;
  workspace_name: string;
  delivery: DeliveryRow;
}

// Each endpoint has at most one delivery in flight, attempted in ascending sequence; endpoints never
// wait on each other; disabled endpoints and suspended workspaces hold their deliveries.
async function claimDue(): Promise<Due[]> {
  return query<Due>(pool,
    `WITH heads AS (
       SELECT DISTINCT ON (d.endpoint_id) d.* FROM deliveries d WHERE d.state = 'pending' ORDER BY d.endpoint_id, d.sequence),
     ready AS (
       SELECT h.*, e.url, e.sealed_secret, e.workspace_id, w.name AS workspace_name FROM heads h
       JOIN webhook_endpoints e ON e.id = h.endpoint_id JOIN workspaces w ON w.id = e.workspace_id
       WHERE h.next_attempt_at <= now() AND e.state = 'active' AND w.status = 'active'
         AND (e.busy_until IS NULL OR e.busy_until < now())
       FOR UPDATE OF e SKIP LOCKED)
     UPDATE webhook_endpoints e SET busy_until = now() + interval '30 seconds' FROM ready r WHERE e.id = r.endpoint_id
     RETURNING r.endpoint_id, r.url, r.sealed_secret, r.workspace_id, r.workspace_name,
       json_build_object('id', r.id, 'endpoint_id', r.endpoint_id, 'event_id', r.event_id, 'event_type', r.event_type,
         'sequence', r.sequence, 'state', r.state, 'attempts', r.attempts, 'body', r.body) AS delivery`);
}

async function attempt(due: Due): Promise<void> {
  const d = due.delivery;
  const attemptNumber = d.attempts + 1;
  const timestamp = Math.floor(Date.now() / 1000);
  let status: number | null = null;
  let failure: DeliveryRow["last_error"] = null;
  try {
    const response = await fetch(due.url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        "Farshore-Event-Id": d.event_id,
        "Farshore-Event-Type": d.event_type,
        "Farshore-Delivery-Attempt": String(attemptNumber),
        "Farshore-Signature": `t=${timestamp},v1=${signature(unseal(due.sealed_secret), timestamp, d.body)}`,
      },
      body: d.body,
      signal: AbortSignal.timeout(5000),
    });
    status = response.status;
    await response.arrayBuffer().catch(() => undefined);
    if (status < 200 || status > 299) failure = "http_status";
  } catch (error) {
    failure = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "timeout" : "connection_failed";
  }
  await tx(async (client) => {
    if (!failure) {
      await moveDelivery(client, d.id, "deliver",
        { set: "attempts = $2, last_status = $3, last_error = NULL, next_attempt_at = NULL, delivered_at = now()", params: [attemptNumber, status] });
    } else if (attemptNumber >= WEBHOOK_ATTEMPTS) {
      const dead = await moveDelivery(client, d.id, "kill",
        { set: "attempts = $2, last_status = $3, last_error = $4, next_attempt_at = NULL", params: [attemptNumber, status, failure] });
      if (dead) {
        const host = new URL(due.url).host;
        for (const owner of await ownersOf(client, due.workspace_id)) {
          await enqueueMail(client, owner.email, `Webhook delivery failed in ${due.workspace_name}`, [
            `A webhook delivery in ${due.workspace_name} failed ${formatCount(attemptNumber)} times and stopped retrying.`, "",
            `Endpoint host: ${host}`, `Event type: ${d.event_type}`, `Sequence: ${formatCount(d.sequence)}`,
            `Attempts: ${formatCount(attemptNumber)}`, "", "Open the Deliveries page in the Farshore console to redeliver it.",
          ].join("\n"));
        }
      }
    } else {
      await moveDelivery(client, d.id, "backoff",
        { set: "attempts = $2, last_status = $3, last_error = $4, next_attempt_at = now() + make_interval(secs => $5)",
          params: [attemptNumber, status, failure, backoffSeconds(attemptNumber)] });
    }
    await client.query("UPDATE webhook_endpoints SET busy_until = NULL WHERE id = $1", [due.endpoint_id]);
  });
}

// Starts a delivery pass now; startDeliveryWorker points it at the running worker.
export let wakeDeliveries = (): void => undefined;

export function startDeliveryWorker(): void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      for (const due of await claimDue()) {
        void attempt(due).catch(() => pool.query("UPDATE webhook_endpoints SET busy_until = NULL WHERE id = $1", [due.endpoint_id]))
          .finally(() => wakeDeliveries());
      }
    } catch {
      // Postgres unavailable: the next tick retries.
    } finally {
      running = false;
    }
  };
  wakeDeliveries = () => void tick();
  setInterval(() => void tick(), 200).unref();
}
