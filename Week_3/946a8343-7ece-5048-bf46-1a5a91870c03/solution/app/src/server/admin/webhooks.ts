// Webhooks (DP-45): signed deliveries, allow-listed targets, retries on the server clock, delivery rows and redelivery.
import { randomUUID } from "node:crypto";
import { config } from "../config.ts";
import { iso, now } from "../clock.ts";
import { db, withTx, type Queryable, type Tx } from "../db.ts";
import { onDue } from "../deadlines.ts";
import { projectScope, requireAction, type ProjectRow } from "../access.ts";
import { FieldErrors, fieldError, notFound } from "../errors.ts";
import { intParam, json, type Router } from "../http.ts";
import type { BranchUpdate } from "../repo/types.ts";
import { bodyOf, strings, text } from "./input.ts";
import { isWebhookEvent, signature, targetAllowed, targetOf, WEBHOOK_EVENTS, type WebhookEvent } from "./rules.ts";
import { isRecord } from "../json.ts";

const RESPONSE_TIMEOUT_MS = 10_000;
const TARGET_MESSAGE = "This target isn't on the allow-list.";

interface WebhookRow {
  readonly id: number;
  readonly url: string;
  readonly events: string[];
}

export async function webhookViews(q: Queryable, projectId: number): Promise<WebhookRow[]> {
  return q.q<WebhookRow>("SELECT id, url, events FROM webhooks WHERE project_id = $1 ORDER BY id", [projectId]);
}

// Attempts in flight: a clock tick waits for them, so a tick never misses an attempt whose answer is still being recorded.
const inFlight = new Set<Promise<void>>();

function track(running: Promise<void>): void {
  const settled = running.catch((error: unknown) => console.error("webhook attempt failed", error)).finally(() => inFlight.delete(settled));
  inFlight.add(settled);
}

async function startDelivery(tx: Tx, webhookId: number, event: string, body: string): Promise<number> {
  const created = await tx.one<{ id: number }>(
    "INSERT INTO webhook_deliveries (webhook_id, uuid, event, body, state, created_at) VALUES ($1, $2, $3, $4, 'pending', $5) RETURNING id",
    [webhookId, randomUUID(), event, body, now()],
  );
  tx.afterCommit(() => {
    track(attempt(created.id));
  });
  return created.id;
}

// Writes the delivery for every webhook of the project that subscribed to the event. Confidential issues are never sent.
export async function dispatchWebhook(tx: Tx, project: ProjectRow, event: WebhookEvent, payload: Record<string, unknown>): Promise<void> {
  const hooks = await tx.q<{ id: number }>("SELECT id FROM webhooks WHERE project_id = $1 AND $2 = ANY(events) ORDER BY id", [project.id, event]);
  if (hooks.length === 0) return;
  if (event === "issue") {
    const issue = payload["issue"];
    const iid = isRecord(issue) ? issue["iid"] : undefined;
    if (typeof iid === "number") {
      const hidden = await tx.maybe("SELECT 1 FROM issues WHERE project_id = $1 AND iid = $2 AND confidential", [project.id, iid]);
      if (hidden !== undefined) return;
    }
  }
  const body = JSON.stringify({ event, project: { id: project.id, path: project.path }, ...payload });
  for (const hook of hooks) await startDelivery(tx, hook.id, event, body);
}

export async function dispatchPushWebhook(tx: Tx, update: BranchUpdate): Promise<void> {
  await dispatchWebhook(tx, update.project, "push", {
    ref: `refs/heads/${update.branch}`,
    before: update.oldHead,
    after: update.newHead,
    commits: update.newCommits.map((commit) => ({ id: commit.id, message: commit.message, author: commit.author })),
    user: update.actor.username,
  });
}

interface DueDelivery {
  readonly id: number;
  readonly uuid: string;
  readonly event: string;
  readonly body: string;
  readonly state: string;
  readonly url: string;
  readonly secret: string;
  readonly made: number;
}

async function send(delivery: DueDelivery, timestamp: number): Promise<number | null> {
  if (!targetAllowed(delivery.url, config.webhookAllow)) return null;
  try {
    const response = await fetch(delivery.url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(RESPONSE_TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        "x-spurline-event": delivery.event,
        "x-spurline-delivery": delivery.uuid,
        "x-spurline-timestamp": String(timestamp),
        "x-spurline-signature": signature(delivery.secret, timestamp, delivery.body),
      },
      body: delivery.body,
    });
    void response.body?.cancel().catch(() => undefined);
    return response.status;
  } catch {
    return null;
  }
}

// One attempt: send, record the answer, then either finish the delivery or schedule the next gap.
async function attempt(deliveryId: number): Promise<void> {
  const delivery = await db.maybe<DueDelivery>(
    `SELECT d.id, d.uuid, d.event, d.body, d.state, w.url, w.secret,
            (SELECT count(*) FROM webhook_attempts a WHERE a.delivery_id = d.id)::int AS made
       FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id WHERE d.id = $1`,
    [deliveryId],
  );
  if (delivery === undefined || delivery.state !== "pending") return;
  const at = now();
  const status = await send(delivery, Math.floor(at / 1000));
  const gaps = config.webhookRetryMs;
  const delivered = status !== null && status >= 200 && status < 300;
  const gap = gaps[delivery.made];
  const state = delivered ? "delivered" : gap === undefined ? "failed" : "pending";
  await withTx(async (tx) => {
    await tx.q("INSERT INTO webhook_attempts (delivery_id, number, status_code, at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [
      delivery.id,
      delivery.made + 1,
      status,
      at,
    ]);
    await tx.q("UPDATE webhook_deliveries SET state = $2, next_at = $3 WHERE id = $1", [
      delivery.id,
      state,
      state === "pending" && gap !== undefined ? at + gap : null,
    ]);
  });
}

// In grading mode a clock tick returns only after every attempt it caused is recorded; a live server never waits on a slow target.
async function attemptDue(): Promise<void> {
  const settled = (): Promise<unknown> => (config.grading ? Promise.all([...inFlight]) : Promise.resolve());
  await settled();
  const due = await db.q<{ id: number }>(
    "UPDATE webhook_deliveries SET next_at = NULL WHERE state = 'pending' AND next_at IS NOT NULL AND next_at <= $1 RETURNING id",
    [now()],
  );
  for (const row of due) track(attempt(row.id));
  await settled();
}

interface DeliveryView {
  readonly id: number;
  readonly uuid: string;
  readonly short_id: string;
  readonly event: string;
  readonly attempts: Array<{ number: number; status_code: number | null; at: string }>;
  readonly state: string;
  readonly next_at: string | null;
}

async function deliveryViews(q: Queryable, webhookId: number): Promise<DeliveryView[]> {
  const rows = await q.q<{ id: number; uuid: string; event: string; state: string; next_at: number | null }>(
    "SELECT id, uuid, event, state, next_at FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY id DESC LIMIT 100",
    [webhookId],
  );
  const attempts = await q.q<{ delivery_id: number; number: number; status_code: number | null; at: number }>(
    "SELECT delivery_id, number, status_code, at FROM webhook_attempts WHERE delivery_id = ANY($1) ORDER BY delivery_id, number",
    [rows.map((row) => row.id)],
  );
  return rows.map((row) => ({
    id: row.id,
    uuid: row.uuid,
    short_id: row.uuid.slice(0, 7),
    event: row.event,
    attempts: attempts
      .filter((entry) => entry.delivery_id === row.id)
      .map((entry) => ({ number: entry.number, status_code: entry.status_code, at: iso(entry.at) })),
    state: row.state,
    next_at: row.next_at === null ? null : iso(row.next_at),
  }));
}

export function registerWebhookRoutes(router: Router): void {
  onDue(attemptDue);

  router.post("/api/projects/:id/webhooks", (ctx) =>
    withTx(async (tx) => {
      const { project, access } = await projectScope(tx, ctx.user, intParam(ctx, "id"));
      requireAction(access, "settings");
      await tx.lockProject(project.id);
      const body = bodyOf(ctx.body);
      const errors = new FieldErrors();
      const url = text(body, "url") ?? "";
      const secret = text(body, "secret") ?? "";
      const events = strings(body, "events");
      if (targetOf(url) === null) errors.add("url", "Enter an http or https URL.");
      if (secret === "") errors.add("secret", "Secret can't be blank.");
      if (events === undefined || events.length === 0) errors.add("events", "Choose at least one event.");
      else {
        const unknown = events.find((event) => !isWebhookEvent(event));
        if (unknown !== undefined) errors.add("events", `Events can be ${WEBHOOK_EVENTS.join(", ")}.`);
      }
      errors.throwIfAny();
      if (!targetAllowed(url, config.webhookAllow)) {
        throw fieldError("target_not_allowed", "url", TARGET_MESSAGE);
      }
      const created = await tx.one<{ id: number }>(
        "INSERT INTO webhooks (project_id, url, secret, events, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [project.id, url, secret, [...new Set(events ?? [])], now()],
      );
      return json(201, { id: created.id, seq: await tx.currentSeq(project.id) });
    }),
  );

  router.get("/api/projects/:id/webhooks", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "settings");
    return json(200, { webhooks: await webhookViews(db, project.id) });
  });

  router.get("/api/projects/:id/webhooks/:hook/deliveries", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "settings");
    const hook = Number(ctx.params["hook"]);
    const exists = Number.isInteger(hook) && (await db.maybe("SELECT 1 FROM webhooks WHERE id = $1 AND project_id = $2", [hook, project.id])) !== undefined;
    if (!exists) throw notFound();
    return json(200, { deliveries: await deliveryViews(db, hook) });
  });

  router.post("/api/deliveries/:delivery/redeliver", (ctx) =>
    withTx(async (tx) => {
      const delivery = Number(ctx.params["delivery"]);
      const found = Number.isInteger(delivery)
        ? await tx.maybe<{ webhook_id: number; event: string; body: string; project_id: number }>(
            `SELECT d.webhook_id, d.event, d.body, w.project_id FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id WHERE d.id = $1`,
            [delivery],
          )
        : undefined;
      if (found === undefined) throw notFound();
      const { access } = await projectScope(tx, ctx.user, found.project_id);
      requireAction(access, "settings");
      await tx.lockProject(found.project_id);
      const id = await startDelivery(tx, found.webhook_id, found.event, found.body);
      return json(201, { id, seq: await tx.currentSeq(found.project_id) });
    }),
  );
}

