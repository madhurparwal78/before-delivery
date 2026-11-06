// The durable job queue in Postgres: a due job is claimed by one instance under a lease, a job whose lease expired
// is reclaimed by any instance (an attempt), failures back off exponentially up to the attempt limit, and a
// superseded worker's result is discarded (brief: Business rules, Jobs).
import { randomUUID } from "node:crypto";
import { now, plusSeconds } from "./clock.js";
import { config } from "./config.js";
import { background, currentContext, runAfterCommit, runAs } from "./context.js";
import { db } from "./db.js";
import { illegalTransition } from "./errors.js";
import { errorText, log } from "./log.js";
const JOB_KINDS = ["thumbnail", "dunning_retry", "due_reminder", "offer_pass", "csv_export"];
const handlers = new Map();
export function registerJob(kind, handler) {
    handlers.set(kind, handler);
}
/**
 * Queues a job. `activeKey` keeps one queued or running job per key; `onceKey` keeps one job per key forever.
 * Returns the job id, or null when a key already holds a job.
 */
export async function enqueueJob(client, job) {
    const id = randomUUID();
    const at = now();
    const { rows } = await client.query(`INSERT INTO jobs (id, kind, status, max_attempts, run_at, payload, active_key, once_key, request_id, created_at)
     VALUES ($1, $2, 'queued', $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING RETURNING id`, [
        id,
        job.kind,
        config.jobMaxAttempts,
        job.runAt ?? new Date(at),
        JSON.stringify(job.payload),
        job.activeKey ?? null,
        job.onceKey ?? null,
        currentContext().requestId,
        new Date(at),
    ]);
    return rows[0]?.id ?? null;
}
/** Job state edges (brief: Jobs): only a dead job can be retried, with its attempts back at 0. */
export async function retryJob(client, id) {
    const { rows } = await client.query(`SELECT status FROM jobs WHERE id = $1 FOR UPDATE`, [id]);
    const status = rows[0]?.status;
    if (status !== "dead")
        throw illegalTransition(status ?? "queued", "retry");
    await client.query(`UPDATE jobs SET status = 'queued', attempts = 0, run_at = $2, lease_expires_at = NULL, lease_token = NULL,
            lease_instance = NULL, last_error = NULL WHERE id = $1`, [id, new Date(now())]);
}
const instanceId = randomUUID();
const CONCURRENCY = 4;
const POLL_MS = 400;
let running = 0;
let stopped = false;
const backoffSeconds = (attempt) => Math.min(config.jobBackoffBaseSeconds * 2 ** (attempt - 1), config.jobBackoffMaxSeconds);
async function markDead(job, error) {
    await db.query(`UPDATE jobs SET status = 'dead', last_error = $2, lease_expires_at = NULL, lease_token = NULL WHERE id = $1`, [
        job.id,
        error,
    ]);
    await handlers.get(job.kind)?.onDead?.(db, job);
}
/** Running jobs whose lease expired at the attempt limit go dead instead of being reclaimed. */
async function buryExpired(at) {
    const { rows } = await db.query(`UPDATE jobs SET status = 'dead', last_error = 'lease expired', lease_expires_at = NULL, lease_token = NULL
      WHERE id IN (SELECT id FROM jobs WHERE status = 'running' AND lease_expires_at <= $1 AND attempts >= max_attempts
                    FOR UPDATE SKIP LOCKED)
      RETURNING *`, [at]);
    for (const job of rows)
        await handlers.get(job.kind)?.onDead?.(db, job);
}
async function claim() {
    const at = now();
    await buryExpired(new Date(at));
    const token = randomUUID();
    const { rows } = await db.query(`UPDATE jobs SET status = 'running', attempts = attempts + 1, lease_expires_at = $2, lease_token = $3, lease_instance = $4
      WHERE id = (SELECT id FROM jobs
                   WHERE (status = 'queued' AND run_at <= $1) OR (status = 'running' AND lease_expires_at <= $1)
                   ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING *`, [new Date(at), plusSeconds(at, config.jobLeaseSeconds), token, instanceId]);
    return rows[0] ?? null;
}
async function execute(job) {
    const handler = handlers.get(job.kind);
    const context = background(job.request_id);
    await runAs(context, async () => {
        try {
            if (!handler)
                throw new Error(`No handler for ${job.kind}`);
            const result = await handler.run(job);
            await runAfterCommit(context);
            const done = await db.query(`UPDATE jobs SET status = 'succeeded', result = $3, lease_expires_at = NULL WHERE id = $1 AND lease_token = $2 AND status = 'running'`, [job.id, job.lease_token, result === null ? null : JSON.stringify(result)]);
            if (done.rowCount === 0)
                log("warn", "job result discarded: lease was taken over", { job_id: job.id, kind: job.kind });
        }
        catch (error) {
            const message = errorText(error);
            log("warn", "job attempt failed", { job_id: job.id, kind: job.kind, attempt: job.attempts, error: message });
            if (job.attempts >= job.max_attempts) {
                const still = await db.query(`SELECT 1 FROM jobs WHERE id = $1 AND lease_token = $2 AND status = 'running'`, [
                    job.id,
                    job.lease_token,
                ]);
                if (still.rowCount)
                    await markDead(job, message);
                return;
            }
            await db.query(`UPDATE jobs SET status = 'queued', run_at = $3, last_error = $4, lease_expires_at = NULL, lease_token = NULL, lease_instance = NULL
          WHERE id = $1 AND lease_token = $2 AND status = 'running'`, [job.id, job.lease_token, plusSeconds(now(), backoffSeconds(job.attempts)), message]);
        }
    });
}
async function pump() {
    while (!stopped && running < CONCURRENCY) {
        const job = await claim();
        if (!job)
            return;
        running += 1;
        void execute(job).finally(() => {
            running -= 1;
        });
    }
}
export function startJobWorker() {
    const tick = () => {
        if (stopped)
            return;
        pump()
            .catch((error) => log("error", "job claim failed", { error: errorText(error) }))
            .finally(() => setTimeout(tick, POLL_MS));
    };
    setTimeout(tick, POLL_MS);
}
/** Stops claiming and returns this instance's leases to the queue with no attempt counted. */
export async function releaseJobLeases() {
    stopped = true;
    await db.query(`UPDATE jobs SET status = 'queued', attempts = greatest(attempts - 1, 0), lease_expires_at = NULL, lease_token = NULL,
            lease_instance = NULL WHERE status = 'running' AND lease_instance = $1`, [instanceId]);
}
export function jobJson(job, result, stamp) {
    return {
        id: job.id,
        kind: job.kind,
        status: job.status,
        attempts: job.attempts,
        max_attempts: job.max_attempts,
        run_at: stamp(job.run_at),
        last_error: job.last_error,
        result,
    };
}
