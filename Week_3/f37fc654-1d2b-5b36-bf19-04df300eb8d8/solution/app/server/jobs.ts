// The durable job table: every email, PDF, render submission, preview storage, crew alert and CRM event.
// Jobs are created in the same transaction as the change that causes them, claimed with row locks
// (several instances run each job once), leased for 30 s and retried at least every 10 s.
import { randomUUID } from "node:crypto";
import type { ServiceName } from "../shared/copy.js";
import { notify, pool, query, type Db } from "./db.js";
import { serviceStatus } from "./providers/status.js";

export type JobKind = "render_submit" | "render_store" | "pdf" | "email" | "crew_alert" | "webhook";

export interface Job {
  id: string;
  kind: JobKind;
  commission_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}

/** A job that cannot take effect yet; it is retried without counting as a failure of the service. */
export class NotYet extends Error {}

const LEASE_MS = 30_000;
const MAX_RETRY_MS = 10_000;

export async function enqueue(db: Db, kind: JobKind, commissionId: string | null, payload: Record<string, unknown>, id: string = randomUUID()): Promise<string> {
  await db.query(
    "INSERT INTO jobs (id, kind, commission_id, payload, status, run_at) VALUES ($1, $2, $3, $4, 'pending', $5)",
    [id, kind, commissionId, JSON.stringify(payload), new Date()],
  );
  await db.query("SELECT pg_notify('spindrift_jobs', '')");
  return id;
}

type Handlers = Record<JobKind, (job: Job) => Promise<void>>;

/** The services each kind of job needs; an instance claims only jobs whose services it can reach. */
const NEEDS: Record<JobKind, ServiceName[]> = {
  render_submit: ["renderProvider", "minio"],
  render_store: ["minio"],
  pdf: ["gotenberg", "minio"],
  email: ["mailpit"],
  crew_alert: ["ntfy"],
  webhook: ["svix"],
};

async function claimable(): Promise<JobKind[]> {
  const services = await serviceStatus();
  return (Object.keys(NEEDS) as JobKind[]).filter((kind) => NEEDS[kind].every((name) => services[name] === "up"));
}

async function claim(kinds: JobKind[]): Promise<Job[]> {
  const now = new Date();
  return query<Job & Record<string, unknown>>(
    `UPDATE jobs SET status = 'running', locked_until = $2, attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM jobs
       WHERE ((status = 'pending' AND run_at <= $1) OR (status = 'running' AND locked_until < $1)) AND kind = ANY($3)
       ORDER BY run_at LIMIT 8 FOR UPDATE SKIP LOCKED)
     RETURNING id, kind, commission_id, payload, attempts`,
    [now, new Date(now.getTime() + LEASE_MS), kinds],
  );
}

async function settle(job: Job, error: unknown): Promise<void> {
  if (!error) {
    await query("UPDATE jobs SET status = 'done', finished_at = now(), locked_until = NULL, last_error = NULL WHERE id = $1", [job.id]);
  } else {
    const delay = Math.min(MAX_RETRY_MS, 1000 * 2 ** Math.min(job.attempts - 1, 4));
    const message = error instanceof Error ? error.message : String(error);
    await query("UPDATE jobs SET status = 'pending', run_at = $2, locked_until = NULL, last_error = $3 WHERE id = $1", [job.id, new Date(Date.now() + delay), message.slice(0, 500)]);
  }
  await notify(pool, "job.updated", { jobId: job.id, status: error ? "pending" : "done", commissionId: job.commission_id });
}

let wake: (() => void) | null = null;

export function wakeWorker(): void {
  wake?.();
}

/** Runs forever: claims due jobs, runs the periodic sweeps, sleeps until woken or 500 ms pass. */
export async function runWorker(handlers: Handlers, sweeps: () => Promise<void>): Promise<never> {
  for (;;) {
    try {
      await sweeps();
      const jobs = await claim(await claimable());
      await Promise.all(jobs.map(async (job) => settle(job, await handlers[job.kind](job).then(() => null, (e: unknown) => e ?? new Error("failed")))));
      if (jobs.length) continue;
    } catch {
      // The database itself is unreachable; try again shortly.
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 500);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}
