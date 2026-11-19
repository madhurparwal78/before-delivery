import type { DbClient } from '../platform/db.js';
import { ApiError, errors } from '../platform/errors.js';
import { writeAudit } from '../platform/audit.js';
import { config } from '../config.js';

export type JobKind = 'mail' | 'resume_erase' | 'sample_upload';

export type JobRow = {
  id: string;
  kind: string;
  state: 'pending' | 'running' | 'done' | 'dead';
  payload: Record<string, unknown>;
  attempts: number;
  refusals: number;
  last_error: string | null;
  next_attempt_at: Date;
  lease_until: Date | null;
  lease_owner: string | null;
  created_at: Date;
  finished_at: Date | null;
};

export type QueueResult = { queued: string };

export async function queueJob(
  client: DbClient,
  kind: JobKind,
  payload: Record<string, unknown>,
): Promise<string> {
  const rows = await client.query<{ id: string }>(
    `INSERT INTO jobs (kind, payload, state, next_attempt_at)
     VALUES ($1, $2::jsonb, 'pending', now())
     RETURNING id`,
    [kind, JSON.stringify(payload)],
  );
  return rows.rows[0].id as string;
}

export async function queueMail(
  client: DbClient,
  args: {
    to: { name: string; email: string };
    subject: string;
    body: string;
    jobId?: string;
  },
): Promise<string> {
  const id = args.jobId ?? (await queueJob(client, 'mail', {}));
  await client.query(
    `UPDATE jobs SET kind = 'mail', payload = $2::jsonb WHERE id = $1`,
    [id, JSON.stringify({ to: args.to, subject: args.subject, body: args.body })],
  );
  return id;
}

export type ClaimOutcome =
  | { claimed: true; job: JobRow }
  | { claimed: false };

export async function claimDueJob(
  client: DbClient,
  ownerId: string,
  kinds: JobKind[],
  now = new Date(),
): Promise<ClaimOutcome> {
  const rows = await client.query<JobRow & { payload: unknown }>(
    `UPDATE jobs SET state = 'running', lease_until = $1, lease_owner = $2, attempts = attempts + 1
     WHERE id = (
       SELECT id FROM jobs
       WHERE state = 'pending' AND kind = ANY($3) AND next_attempt_at <= $4
       ORDER BY next_attempt_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [new Date(now.getTime() + 60000).toISOString(), ownerId, kinds, now.toISOString()],
  );
  if (rows.rows.length === 0) return { claimed: false };
  const raw = rows.rows[0];
  return {
    claimed: true,
    job: {
      ...raw,
      payload: (typeof raw.payload === 'object' && raw.payload !== null ? raw.payload : {}) as Record<string, unknown>,
    },
  };
}

export type AttemptOutcome =
  | { outcome: 'done' }
  | { outcome: 'retry'; error: string }
  | { outcome: 'dead'; error: string };

export async function completeJob(client: DbClient, jobId: string): Promise<void> {
  await client.query(
    `UPDATE jobs SET state = 'done', finished_at = now(), lease_until = NULL, lease_owner = NULL WHERE id = $1`,
    [jobId],
  );
}

export async function failJob(
  client: DbClient,
  jobId: string,
  error: string,
  refused: boolean,
  now = new Date(),
): Promise<void> {
  const rows = await client.query<{ refusals: number }>(
    `SELECT refusals FROM jobs WHERE id = $1 FOR UPDATE`,
    [jobId],
  );
  const refusals = refused ? (rows.rows[0]?.refusals ?? 0) + 1 : rows.rows[0]?.refusals ?? 0;
  if (refused && refusals >= config.jobMaxAttempts) {
    await client.query(
      `UPDATE jobs SET state = 'dead', last_error = $2, refusals = $3, finished_at = now(),
         lease_until = NULL, lease_owner = NULL WHERE id = $1`,
      [jobId, error, refusals],
    );
    return;
  }
  const delay = refused
    ? Math.min(config.outboxRetryMaxSeconds, config.outboxRetrySeconds * 2 ** Math.max(0, refusals - 1))
    : config.outboxRetrySeconds;
  await client.query(
    `UPDATE jobs SET state = 'pending', last_error = $2, refusals = $3,
       next_attempt_at = $4, lease_until = NULL, lease_owner = NULL WHERE id = $1`,
    [jobId, error, refusals, new Date(now.getTime() + delay * 1000).toISOString()],
  );
}

export async function reclaimLapsedLeases(client: DbClient, now = new Date()): Promise<void> {
  await client.query(
    `UPDATE jobs SET state = 'pending', lease_until = NULL, lease_owner = NULL
     WHERE state = 'running' AND lease_until IS NOT NULL AND lease_until < $1`,
    [now.toISOString()],
  );
}

export async function retryDeadJob(client: DbClient, jobId: string, actor: string): Promise<void> {
  const rows = await client.query<{ state: string }>(
    `SELECT state FROM jobs WHERE id = $1 FOR UPDATE`,
    [jobId],
  );
  const row = rows.rows[0];
  if (!row) throw errors.notFoundConsole();
  if (row.state !== 'dead') {
    throw jobNotDead();
  }
  await client.query(
    `UPDATE jobs SET state = 'pending', attempts = 0, refusals = 0, last_error = NULL,
       next_attempt_at = now(), lease_until = NULL, lease_owner = NULL, finished_at = NULL
     WHERE id = $1`,
    [jobId],
  );
  await writeAudit(client, {
    actor,
    action: 'job.retry',
    targetType: 'job',
    targetId: jobId,
    detail: {},
  });
}

function jobNotDead(): ApiError {
  return new ApiError(409, 'job_not_dead', 'Only dead jobs can be retried.');
}

export function jobView(row: JobRow): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    attempts: row.attempts,
    refusals: row.refusals,
    last_error: row.last_error,
    next_attempt_at: new Date(row.next_attempt_at).toISOString(),
    created_at: new Date(row.created_at).toISOString(),
    finished_at: row.finished_at ? new Date(row.finished_at).toISOString() : null,
  };
}
