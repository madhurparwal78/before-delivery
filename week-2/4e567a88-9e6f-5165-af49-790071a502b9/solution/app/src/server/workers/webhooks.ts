// Webhook delivery: signed POSTs with the same event id and body on every attempt, retries on the
// published backoff, the endpoint's consecutive-failure counter, and disabling at the sixth failure.
// Each endpoint gets its events one at a time, oldest first: later events wait behind a retrying one.

import { createHmac } from "node:crypto";
import { config } from "../config";
import { one, pool, rows, tx } from "../db";
import { mailEndpointDisabled } from "../domain/notices";
import { checkAddress, pinnedRequest } from "../services/outbound";
import { reason } from "../log";
import { loop } from "./loop";

const TICK_MS = 250;
const ATTEMPT_MS = 5_000;
const RETRIES = 5;
const DISABLE_AT = 6;

interface DueEvent {
  id: string;
  endpoint_id: string;
  body: string;
  attempts: number;
  url: string;
  secret: string;
}

/** Endpoints with an attempt under way. */
const inFlight = new Set<string>();

/** POSTs once to a re-checked address; any 2xx within 5 seconds succeeds, a refused address, a redirect or anything else fails. */
async function attempt(event: DueEvent): Promise<{ ok: boolean; status: number | null }> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", event.secret).update(`${timestamp}.${event.body}`).digest("hex");
  try {
    const checked = await checkAddress(event.url);
    const answer = await pinnedRequest(checked, {
      method: "POST",
      timeoutMs: ATTEMPT_MS,
      maxBytes: 65_536,
      body: Buffer.from(event.body, "utf8"),
      headers: {
        "Content-Type": "application/json",
        "Dispatch-Event-Id": event.id,
        "Dispatch-Timestamp": timestamp,
        "Dispatch-Signature": `v1=${signature}`,
      },
    });
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status };
  } catch {
    return { ok: false, status: null };
  }
}

const retryDelayMs = (failedAttempt: number): number => config.webhookRetryBaseSeconds * 2 ** (failedAttempt - 1) * 1000;

async function deliver(event: DueEvent): Promise<void> {
  const result = await attempt(event);
  const number = event.attempts + 1;
  const now = new Date();
  const disabled = await tx(async (client) => {
    const endpoint = await one<{ state: string; consecutive_failures: number; url: string; team_name: string }>(client,
      `SELECT e.state, e.consecutive_failures, e.url, t.name AS team_name FROM webhook_endpoints e
       JOIN teams t ON t.id = e.team_id WHERE e.id = $1 FOR UPDATE OF e`, [event.endpoint_id]);
    if (!endpoint) return null;
    const failures = result.ok ? 0 : endpoint.consecutive_failures + 1;
    const state = failures === 0 ? "active" : failures >= DISABLE_AT ? "disabled" : "failing";
    const retryAt = !result.ok && number <= RETRIES && state !== "disabled" ? new Date(now.getTime() + retryDelayMs(number)) : null;
    await client.query("UPDATE webhook_events SET attempts = $2, next_attempt_at = $3 WHERE id = $1", [event.id, number, retryAt]);
    await client.query(
      `INSERT INTO webhook_deliveries (event_id, endpoint_id, attempt, attempted_at, status_code, outcome, next_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [event.id, event.endpoint_id, number, now, result.status, result.ok ? "delivered" : "failed", retryAt]);
    await client.query("UPDATE webhook_endpoints SET consecutive_failures = $2, state = $3, last_status_code = $4 WHERE id = $1",
      [event.endpoint_id, failures, state, result.status]);
    if (state !== "disabled" || endpoint.state === "disabled") return null;
    await client.query(
      `INSERT INTO webhook_deliveries (event_id, endpoint_id, attempt, attempted_at, status_code, outcome, next_attempt_at)
       SELECT id, endpoint_id, attempts + 1, $2, NULL, 'skipped_disabled', NULL FROM webhook_events
       WHERE endpoint_id = $1 AND next_attempt_at IS NOT NULL`, [event.endpoint_id, now]);
    await client.query("UPDATE webhook_events SET next_attempt_at = NULL WHERE endpoint_id = $1", [event.endpoint_id]);
    return endpoint;
  });
  if (disabled) await mailEndpointDisabled(disabled.team_name, disabled.url, result.status);
}

/** The oldest undelivered event of each enabled endpoint, when its next attempt is due. */
async function pass(): Promise<void> {
  const due = await rows<DueEvent>(pool,
    `SELECT * FROM (
       SELECT DISTINCT ON (v.endpoint_id) v.id, v.endpoint_id, v.body, v.attempts, v.next_attempt_at, e.url, e.secret
       FROM webhook_events v JOIN webhook_endpoints e ON e.id = v.endpoint_id
       WHERE v.next_attempt_at IS NOT NULL AND e.state <> 'disabled'
       ORDER BY v.endpoint_id, v.created_at, v.id) head
     WHERE head.next_attempt_at <= now()`);
  for (const event of due) {
    if (inFlight.has(event.endpoint_id)) continue;
    inFlight.add(event.endpoint_id);
    deliver(event)
      .catch((error: unknown) => console.error(`webhook event ${event.id} failed: ${reason(error)}`))
      .finally(() => {
        inFlight.delete(event.endpoint_id);
        deliveries.nudge();
      });
  }
}

const deliveries = loop("webhook delivery", TICK_MS, pass);
export const startWebhooks = deliveries.start;
export const nudgeWebhooks = deliveries.nudge;
