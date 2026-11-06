// Webhook endpoints, signed events and the ordered retry schedule.
import type { Pool } from "./db.js";
import { newWebhookSecret, newEventId } from "./db.js";
import { ApiError } from "./jobs.js";
import { projectJob, payloadVisibleTo, type MemberRow, type JobRow } from "./domain.js";
import { jobRowFrom } from "./jobs.js";
import { createHmac } from "node:crypto";
import type { Outbound } from "./outbound.js";
import type { Config } from "./config.js";

export const MAX_ENDPOINTS_PER_TEAM = 5;
export const EVENT_TYPES = ["job.succeeded", "job.failed", "job.cancelled"] as const;

export interface EndpointRow {
  id: string;
  team_id: string;
  url: string;
  state: "active" | "failing" | "disabled";
  consecutive_failures: number;
  secret?: string;
  created_by: string;
  created_at: Date;
}

/** Create an endpoint; the URL must be public and the secret is shown once. */
export async function addEndpoint(
  pool: Pool,
  outbound: Outbound,
  teamId: string,
  url: string,
  creator: MemberRow,
): Promise<{ endpoint: EndpointRow; secret: string }> {
  try {
    await outbound.checkAddress(url);
  } catch {
    throw new ApiError(422, "validation_failed", "Fix the highlighted fields.", { url: "This address is not allowed. Use a public address." });
  }
  const count = await pool.one<{ n: number }>(`SELECT count(*)::int AS n FROM webhook_endpoints WHERE team_id = $1`, [teamId]);
  if ((count?.n ?? 0) >= MAX_ENDPOINTS_PER_TEAM) {
    throw new ApiError(409, "endpoint_limit_reached", "This team already has 5 endpoints.");
  }
  const secret = newWebhookSecret();
  const seq = await pool.one<{ nextval: number }>(`SELECT nextval('endpoint_seq') AS nextval`);
  const id = `we_${seq?.nextval}`;
  await pool.exec(
    `INSERT INTO webhook_endpoints (id, team_id, url, state, consecutive_failures, secret, created_by)
     VALUES ($1,$2,$3,'active',0,$4,$5)`,
    [id, teamId, url, secret, creator.id],
  );
  return {
    endpoint: {
      id, team_id: teamId, url, state: "active", consecutive_failures: 0, created_by: creator.id, created_at: new Date(),
    },
    secret,
  };
}

export function endpointRow(r: Record<string, unknown>): EndpointRow {
  return {
    id: r.id as string,
    team_id: r.team_id as string,
    url: r.url as string,
    state: r.state as EndpointRow["state"],
    consecutive_failures: Number(r.consecutive_failures ?? 0),
    created_by: r.created_by as string,
    created_at: r.created_at as Date,
  };
}

/** Record one event per enabled endpoint of the job's team when it reaches a final state. */
export async function onJobFinal(pool: Pool, jobId: string): Promise<void> {
  const job = await jobByIdChecked(pool, jobId);
  const type: (typeof EVENT_TYPES)[number] | null =
    job.status === "succeeded" ? "job.succeeded" : job.status === "failed" ? "job.failed" : job.status === "cancelled" ? "job.cancelled" : null;
  if (!type) return;
  const endpoints = await pool.many<Record<string, unknown>>(
    `SELECT * FROM webhook_endpoints WHERE team_id = $1 AND state IN ('active','failing')`,
    [job.team_id],
  );
  for (const row of endpoints) {
    const endpoint = endpointRow(row);
    const creator = await pool.one<MemberRow>(
      `SELECT id, name, email, role, team_id FROM members WHERE id = $1`,
      [endpoint.created_by],
    );
    if (!creator) continue;
    const visible = await payloadVisibleTo(pool, job, creator);
    const projection = projectJob(job, visible, null);
    projection.outputs = (await pool.many<{ asset_id: string }>(`SELECT asset_id FROM job_outputs WHERE job_id = $1 ORDER BY n`, [job.id])).map((r) => r.asset_id);
    const body = JSON.stringify({
      id: newEventId(),
      type,
      created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      data: { job: projection },
    });
    await pool.exec(
      `INSERT INTO webhook_events (id, endpoint_id, job_id, event_type, body, state, attempts)
       VALUES ($1,$2,$3,$4,$5,'waiting',0)`,
      [(JSON.parse(body) as { id: string }).id, endpoint.id, job.id, type, body],
    );
  }
}

async function jobByIdChecked(pool: Pool, jobId: string): Promise<JobRow> {
  const row = await pool.one<Record<string, unknown>>(
    `SELECT j.*, mem.name AS submitted_by_name, r.micro_per_unit::bigint AS rate_micro FROM jobs j
     JOIN members mem ON mem.id = j.submitted_by JOIN rates r ON r.id = j.rate_id WHERE j.id = $1`,
    [jobId],
  );
  if (!row) throw new ApiError(404, "not_found", "That job does not exist.");
  return jobRowFrom(row);
}

export interface DeliveryOutcome {
  delivered: boolean;
}

/**
 * The delivery loop: each endpoint sends its events one at a time, oldest first,
 * retrying on the published backoff schedule until delivered or abandoned.
 */
export async function deliverPending(
  pool: Pool,
  outbound: Outbound,
  cfg: Config,
  onDisabled: (endpoint: EndpointRow, lastStatusCode: number | null) => Promise<void>,
): Promise<void> {
  const endpoints = await pool.many<Record<string, unknown>>(
    `SELECT * FROM webhook_endpoints WHERE state IN ('active','failing')`,
  );
  for (const row of endpoints) {
    const endpoint = endpointRow(row);
    // The head event gates the rest.
    const head = await pool.one<{ id: string; body: unknown; attempts: number; next_attempt_at: Date | null }>(
      `SELECT id, body, attempts, next_attempt_at FROM webhook_events
       WHERE endpoint_id = $1 AND state = 'waiting'
       ORDER BY created_at ASC, id ASC LIMIT 1`,
      [endpoint.id],
    );
    if (!head) continue;
    if (head.next_attempt_at && head.next_attempt_at.getTime() > Date.now()) continue;
    const attemptNo = head.attempts + 1;
    const body = Buffer.from(JSON.stringify(head.body));
    const timestamp = Math.floor(Date.now() / 1000);
    const secret = await pool.one<{ secret: string }>(`SELECT secret FROM webhook_endpoints WHERE id = $1`, [endpoint.id]);
    const signature = createHmac("sha256", secret?.secret ?? "").update(`${timestamp}.${body.toString()}`).digest("hex");
    let statusCode: number | null = null;
    let delivered = false;
    try {
      const res = await outbound.fetch({
        url: endpoint.url,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Dispatch-Event-Id": head.id,
          "Dispatch-Timestamp": String(timestamp),
          "Dispatch-Signature": `v1=${signature}`,
        },
        body,
        followRedirects: 0,
        maxBytes: 1_000_000,
        timeoutMs: 5_000,
      });
      statusCode = res.status;
      delivered = res.status >= 200 && res.status < 300;
    } catch {
      delivered = false;
    }
    await pool.tx(async (tx) => {
      const seq = await tx.one<{ nextval: number }>(`SELECT nextval('delivery_seq') AS nextval`);
      const deliveryId = `wd_${seq?.nextval}`;
      let nextAttemptAt: Date | null = null;
      if (!delivered && attemptNo <= 6) {
        // Retries 1..5 run base × 2^(n-1) after each failure; the sixth fails for good.
        const retryIndex = Math.min(attemptNo, 6) - 1; // attempts after failure n
        const delay = cfg.webhookRetryBaseSeconds * Math.pow(2, Math.min(retryIndex, 4));
        nextAttemptAt = new Date(Date.now() + delay * 1000);
      }
      await tx.exec(
        `INSERT INTO webhook_deliveries (id, event_id, endpoint_id, attempt, attempted_at, status_code, outcome, next_attempt_at)
         VALUES ($1,$2,$3,$4,now(),$5,$6,$7)`,
        [deliveryId, head.id, endpoint.id, attemptNo, statusCode, delivered ? "delivered" : "failed", nextAttemptAt],
      );
      if (delivered) {
        await tx.exec(`UPDATE webhook_events SET state = 'delivered', attempts = $2 WHERE id = $1`, [head.id, attemptNo]);
        await tx.exec(`UPDATE webhook_endpoints SET state = 'active', consecutive_failures = 0 WHERE id = $1`, [endpoint.id]);
      } else if (attemptNo >= 6) {
        // Abandoned; the endpoint is disabled and the waiting events are skipped.
        await tx.exec(`UPDATE webhook_events SET state = 'abandoned', attempts = $2 WHERE id = $1`, [head.id, attemptNo]);
        await tx.exec(`UPDATE webhook_endpoints SET state = 'disabled', consecutive_failures = 6 WHERE id = $1`, [endpoint.id]);
        const waiting = await tx.many<{ id: string }>(
          `SELECT id FROM webhook_events WHERE endpoint_id = $1 AND state = 'waiting'`,
          [endpoint.id],
        );
        for (const w of waiting) {
          const wseq = await tx.one<{ nextval: number }>(`SELECT nextval('delivery_seq') AS nextval`);
          await tx.exec(
            `INSERT INTO webhook_deliveries (id, event_id, endpoint_id, attempt, attempted_at, status_code, outcome)
             VALUES ($1,$2,$3,1,now(),NULL,'skipped_disabled')`,
            [`wd_${wseq?.nextval}`, w.id, endpoint.id],
          );
          await tx.exec(`UPDATE webhook_events SET state = 'skipped' WHERE id = $1`, [w.id]);
        }
      } else {
        const failures = Math.min(attemptNo, 5);
        await tx.exec(
          `UPDATE webhook_events SET attempts = $2, next_attempt_at = $3 WHERE id = $1`,
          [head.id, attemptNo, nextAttemptAt],
        );
        await tx.exec(`UPDATE webhook_endpoints SET state = 'failing', consecutive_failures = $2 WHERE id = $1`, [endpoint.id, failures]);
      }
    });
    if (!delivered && attemptNo >= 6) {
      await onDisabled(endpoint, statusCode);
    }
  }
}

/** Re-enable a disabled endpoint (admin only). */
export async function enableEndpoint(pool: Pool, id: string): Promise<EndpointRow> {
  const row = await pool.one<Record<string, unknown>>(`SELECT * FROM webhook_endpoints WHERE id = $1`, [id]);
  if (!row) throw new ApiError(404, "not_found", "That endpoint does not exist.");
  const endpoint = endpointRow(row);
  if (endpoint.state !== "disabled") {
    throw new ApiError(409, "endpoint_not_disabled", "That endpoint is not disabled.");
  }
  await pool.exec(`UPDATE webhook_endpoints SET state = 'active', consecutive_failures = 0 WHERE id = $1`, [id]);
  const fresh = await pool.one<Record<string, unknown>>(`SELECT * FROM webhook_endpoints WHERE id = $1`, [id]);
  return endpointRow(fresh as Record<string, unknown>);
}
