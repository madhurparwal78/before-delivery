import { randomUUID } from 'node:crypto';
import { query, type Queryable } from '../db/pool.js';
import { publishNow } from './events.js';

/**
 * The durable job table. Every email, PDF, render submission, preview storage,
 * crew alert and CRM event is a row created in the same transaction as the
 * change that causes it, so nothing is lost to a restart or an outage.
 */

export type JobKind =
  | 'render_submit'
  | 'render_store'
  | 'pdf'
  | 'email'
  | 'crew_alert'
  | 'webhook';

export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface JobRow {
  id: string;
  kind: JobKind;
  commission_id: string | null;
  payload: Record<string, unknown>;
  dedupe_key: string;
  status: JobStatus;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  finished_at: Date | null;
}

export interface EnqueueRequest {
  kind: JobKind;
  commissionId?: string | null;
  payload?: Record<string, unknown>;
  /** Names the job's effect; a second row with the same key is never created. */
  dedupeKey: string;
  runAt?: Date;
}

const LEASE_SECONDS = 30;
const RETRY_SECONDS = 5;

/** Add a job. Call inside the transaction that records the change. */
export async function enqueue(tx: Queryable, request: EnqueueRequest): Promise<string> {
  const id = randomUUID();
  const result = await tx.query<{ id: string }>(
    `INSERT INTO jobs (id, kind, commission_id, payload, dedupe_key, run_at)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()))
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [
      id,
      request.kind,
      request.commissionId ?? null,
      JSON.stringify(request.payload ?? {}),
      request.dedupeKey,
      request.runAt ?? null,
    ],
  );
  return result.rows[0]?.id ?? id;
}

/**
 * Claim due jobs with row locks, so several app instances sharing one database
 * run each job once. A running job whose lease has lapsed is claimed again.
 */
export async function claimJobs(limit: number): Promise<JobRow[]> {
  const result = await query<JobRow>(
    `WITH due AS (
       SELECT id FROM jobs
        WHERE (status = 'pending' AND run_at <= now())
           OR (status = 'running' AND lease_expires_at < now())
        ORDER BY run_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE jobs
        SET status = 'running',
            attempts = jobs.attempts + 1,
            lease_expires_at = now() + ($2 || ' seconds')::interval
      WHERE jobs.id IN (SELECT id FROM due)
      RETURNING jobs.*`,
    [limit, String(LEASE_SECONDS)],
  );
  return result.rows;
}

export async function markDone(jobId: string): Promise<void> {
  await query(
    `UPDATE jobs SET status = 'done', finished_at = now(), lease_expires_at = NULL, last_error = NULL
      WHERE id = $1`,
    [jobId],
  );
  await publishNow({ type: 'job.updated', jobId, status: 'done', audience: ['producer'] });
}

/** Put the job back for another attempt; its service will be asked again. */
export async function markRetry(jobId: string, error: string): Promise<void> {
  await query(
    `UPDATE jobs
        SET status = 'pending',
            last_error = $2,
            lease_expires_at = NULL,
            run_at = now() + ($3 || ' seconds')::interval
      WHERE id = $1`,
    [jobId, error.slice(0, 1000), String(RETRY_SECONDS)],
  );
  await publishNow({ type: 'job.updated', jobId, status: 'pending', audience: ['producer'] });
}

/** A job that can never succeed, for example a render the provider rejected. */
export async function markFailed(jobId: string, error: string): Promise<void> {
  await query(
    `UPDATE jobs
        SET status = 'failed', last_error = $2, finished_at = now(), lease_expires_at = NULL
      WHERE id = $1`,
    [jobId, error.slice(0, 1000)],
  );
  await publishNow({ type: 'job.updated', jobId, status: 'failed', audience: ['producer'] });
}

export async function listJobs(filters: {
  status?: string;
  commissionId?: string;
}): Promise<JobRow[]> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.commissionId) {
    params.push(filters.commissionId);
    conditions.push(`commission_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query<JobRow>(
    `SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT 500`,
    params,
  );
  return result.rows;
}

