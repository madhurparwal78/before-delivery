import crypto from 'node:crypto';
import { pool, type DbClient } from './db.js';

export type JobKind = 'render_submit' | 'render_progress' | 'render_store' | 'pdf' | 'email' | 'crew_alert' | 'webhook';

export interface JobRow {
  id: string;
  kind: JobKind;
  commission_id: string | null;
  payload: Record<string, unknown>;
  status: 'pending' | 'running' | 'done' | 'failed';
  attempts: number;
  last_error: string | null;
  run_after: Date;
  lease_expires: Date | null;
  lease_token: string | null;
  created_at: Date;
  finished_at: Date | null;
  done_key: string | null;
}

export type ClaimedJobAlias = ClaimedJob;

const LEASE_SECONDS = 30;
const RETRY_SECONDS = 10;

/** Records a job inside the caller's transaction. done_key makes the effect exactly-once. */
export async function enqueueJob(
  tx: DbClient,
  kind: JobKind,
  commissionId: string | null,
  payload: Record<string, unknown>,
  doneKey?: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await tx.query(
    `INSERT INTO jobs (id, kind, commission_id, payload, status, attempts, done_key)
     VALUES ($1, $2, $3, $4, 'pending', 0, $5)`,
    [id, kind, commissionId, JSON.stringify(payload), doneKey ?? null],
  );
  return id;
}

interface ClaimedJob {
  id: string;
  kind: JobKind;
  commission_id: string | null;
  payload: Record<string, unknown>;
  lease_token: string;
}

/** Claims one runnable job with a row lock so several instances run each job once. */
export async function claimJob(): Promise<ClaimedJob | null> {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    const res = await tx.query(
      `SELECT id, kind, commission_id, payload FROM jobs
       WHERE status IN ('pending', 'failed') AND run_after <= now()
          OR (status = 'running' AND lease_expires < now())
       ORDER BY run_after ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
    );
    const row = res.rows[0] as { id: string; kind: JobKind; commission_id: string | null; payload: Record<string, unknown> } | undefined;
    if (!row) {
      await tx.query('COMMIT');
      return null;
    }
    const leaseToken = crypto.randomBytes(16).toString('hex');
    await tx.query(
      `UPDATE jobs SET status = 'running', attempts = attempts + 1, lease_token = $2, lease_expires = now() + interval '${LEASE_SECONDS} seconds' WHERE id = $1`,
      [row.id, leaseToken],
    );
    await tx.query('COMMIT');
    return { id: row.id, kind: row.kind, commission_id: row.commission_id, payload: row.payload, lease_token: leaseToken };
  } catch (e) {
    await tx.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    tx.release();
  }
}

export async function finishJob(jobId: string, leaseToken: string): Promise<void> {
  await pool.query(
    `UPDATE jobs SET status = 'done', finished_at = now(), lease_token = NULL, lease_expires = NULL, last_error = NULL WHERE id = $1 AND lease_token = $2`,
    [jobId, leaseToken],
  );
}

export async function failJob(jobId: string, leaseToken: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE jobs SET status = 'failed', last_error = $3, run_after = now() + interval '${RETRY_SECONDS} seconds', lease_token = NULL, lease_expires = NULL WHERE id = $1 AND lease_token = $2`,
    [jobId, leaseToken, error.slice(0, 500)],
  );
}

