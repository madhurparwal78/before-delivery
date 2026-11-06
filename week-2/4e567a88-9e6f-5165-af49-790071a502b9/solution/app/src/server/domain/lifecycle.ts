// The job state machine, and what a final state does to the ledger and the webhook queue. Every status
// change in the app goes through `assertEdge`; every final state goes through `finishJob`.

import { randomBytes } from "node:crypto";
import type pg from "pg";
import { rows } from "../db";
import { stringify } from "../http";
import { amountFor } from "../../shared/money";
import { postMovement } from "./ledger";
import { currentPolicy } from "./policy";
import { loadJobs, projectJob, type JobRow, type JobStatus, type Viewer } from "./visibility";

const EDGES: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["leased", "failed", "cancelled"],
  leased: ["running", "queued", "failed", "cancelled"],
  running: ["succeeded", "queued", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
};


function assertEdge(from: JobStatus, to: JobStatus): void {
  if (!EDGES[from].includes(to)) throw new Error(`a job cannot move from ${from} to ${to}`);
}

export const isFinal = (status: JobStatus): boolean => EDGES[status].length === 0;

/** Moves a job the caller holds locked along one edge, setting the extra columns given. */
export async function moveJob(client: pg.PoolClient, job: JobRow, to: JobStatus, set: Record<string, unknown> = {}): Promise<void> {
  assertEdge(job.status, to);
  const columns = Object.keys(set);
  await client.query(
    `UPDATE jobs SET status = $2${columns.map((c, i) => `, ${c} = $${i + 3}`).join("")} WHERE id = $1`,
    [job.id, to, ...columns.map((c) => set[c])]);
}

type Outcome =
  | { status: "succeeded"; billedUnitsMicro: bigint }
  | { status: "failed"; reason: "input_deleted" | "model_blocked" | "storage_unavailable" | "lease_expired" }
  | { status: "cancelled" };

type EventType = "job.succeeded" | "job.failed" | "job.cancelled";

/**
 * Settles or releases the reservation of a job the caller holds locked, records the final state and queues
 * one event per endpoint of the team. Returns true when an event was queued for delivery.
 */
export async function finishJob(client: pg.PoolClient, job: JobRow, outcome: Outcome, now: Date): Promise<boolean> {
  const charge = outcome.status === "succeeded" ? amountFor(outcome.billedUnitsMicro, job.rate_micro) : null;
  await moveJob(client, job, outcome.status, {
    finished_at: now,
    lease_expires_at: null,
    failure_reason: outcome.status === "failed" ? outcome.reason : null,
    billed_units_micro: outcome.status === "succeeded" ? outcome.billedUnitsMicro : null,
    charged_micro: charge,
  });
  const unused = job.reserved_micro - (charge ?? 0n);
  if (charge !== null) await postMovement(client, { teamId: job.team_id, kind: "settle", amount: charge, at: now, jobId: job.id });
  if (unused > 0n) await postMovement(client, { teamId: job.team_id, kind: "release", amount: unused, at: now, jobId: job.id });
  return queueEvents(client, job.id, `job.${outcome.status}`, now);
}

interface EndpointRow {
  id: string;
  state: "active" | "failing" | "disabled";
  created_by: string;
  role: Viewer["role"];
  team_id: string | null;
}

/** One event per endpoint, carrying the job as the endpoint's creator may see it. */
async function queueEvents(client: pg.PoolClient, jobId: string, type: EventType, now: Date): Promise<boolean> {
  const [job] = await loadJobs(client, "j.id = $1", [jobId]);
  const endpoints = await rows<EndpointRow>(client,
    `SELECT e.id, e.state, e.created_by, m.role, m.team_id FROM webhook_endpoints e
     JOIN members m ON m.id = e.created_by WHERE e.team_id = $1`, [job.team_id]);
  if (!endpoints.length) return false;
  const policy = await currentPolicy(client);
  for (const endpoint of endpoints) {
    const viewer: Viewer = { id: endpoint.created_by, role: endpoint.role, team_id: endpoint.team_id };
    const eventId = `evt_${randomBytes(12).toString("hex")}`;
    const body = stringify({ id: eventId, type, created_at: now.toISOString(), data: { job: projectJob(job, viewer, policy, false) } });
    const disabled = endpoint.state === "disabled";
    await client.query(
      `INSERT INTO webhook_events (id, endpoint_id, job_id, type, body, created_at, attempts, next_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [eventId, endpoint.id, jobId, type, body, now, disabled ? 1 : 0, disabled ? null : now]);
    if (disabled) {
      await client.query(
        `INSERT INTO webhook_deliveries (event_id, endpoint_id, attempt, attempted_at, status_code, outcome, next_attempt_at)
         VALUES ($1, $2, 1, $3, NULL, 'skipped_disabled', NULL)`, [eventId, endpoint.id, now]);
    }
  }
  return endpoints.some((e) => e.state !== "disabled");
}
