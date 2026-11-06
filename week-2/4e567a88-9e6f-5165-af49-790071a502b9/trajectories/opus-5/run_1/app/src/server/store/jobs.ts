import { Queryable, big, bigOrNull, db } from '../db';
import { Context, JobRecord, JobStatus, Priority } from '../types';

interface JobDbRow {
  id: string;
  num: string;
  team_id: string;
  model_slug: string;
  status: string;
  priority: string;
  context: string;
  submitted_by: string;
  submitted_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  attempts: number;
  lapses: number;
  failure_reason: string | null;
  input: Record<string, unknown>;
  rate_id: string;
  rate_micro_per_unit: string;
  unit: string;
  estimated_units_micro: string;
  billed_units_micro: string | null;
  reserved_micro: string;
  charged_micro: string | null;
  period_start: Date;
}

const COLUMNS = `id, num, team_id, model_slug, status, priority, context, submitted_by, submitted_at, started_at,
  finished_at, attempts, lapses, failure_reason, input, rate_id, rate_micro_per_unit, unit,
  estimated_units_micro, billed_units_micro, reserved_micro, charged_micro, period_start`;

export const DISPATCH_ORDER = `CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, submitted_at, num`;

function toJob(row: JobDbRow): JobRecord {
  return {
    id: row.id,
    num: big(row.num),
    teamId: row.team_id,
    modelSlug: row.model_slug,
    status: row.status as JobStatus,
    priority: row.priority as Priority,
    context: row.context as Context,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    attempts: row.attempts,
    lapses: row.lapses,
    failureReason: row.failure_reason,
    input: row.input,
    rateId: row.rate_id,
    rateMicroPerUnit: big(row.rate_micro_per_unit),
    unit: row.unit,
    estimatedUnitsMicro: big(row.estimated_units_micro),
    billedUnitsMicro: bigOrNull(row.billed_units_micro),
    reservedMicro: big(row.reserved_micro),
    chargedMicro: bigOrNull(row.charged_micro),
    periodStart: row.period_start,
  };
}

export interface NewJob {
  teamId: string;
  modelSlug: string;
  priority: Priority;
  context: Context;
  submittedBy: string;
  input: Record<string, unknown>;
  rateId: string;
  rateMicroPerUnit: bigint;
  unit: string;
  estimatedUnitsMicro: bigint;
  reservedMicro: bigint;
  periodStart: Date;
  inputAssetIds: readonly string[];
}

export async function insertJob(client: Queryable, input: NewJob): Promise<JobRecord> {
  const { rows: sequence } = await client.query<{ value: string }>(`SELECT nextval('job_seq')::text AS value`);
  const num = sequence[0]!.value;
  const id = `j_${num}`;
  const { rows } = await client.query<JobDbRow>(
    `INSERT INTO jobs (id, num, team_id, model_slug, status, priority, context, submitted_by, submitted_at,
       attempts, lapses, input, rate_id, rate_micro_per_unit, unit, estimated_units_micro, reserved_micro, period_start)
     VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7, now(), 0, 0, $8, $9, $10, $11, $12, $13, $14)
     RETURNING ${COLUMNS}`,
    [
      id,
      num,
      input.teamId,
      input.modelSlug,
      input.priority,
      input.context,
      input.submittedBy,
      JSON.stringify(input.input),
      input.rateId,
      input.rateMicroPerUnit.toString(),
      input.unit,
      input.estimatedUnitsMicro.toString(),
      input.reservedMicro.toString(),
      input.periodStart,
    ],
  );
  for (const [index, assetId] of input.inputAssetIds.entries()) {
    await client.query('INSERT INTO job_input_assets (job_id, asset_id, position) VALUES ($1, $2, $3)', [
      id,
      assetId,
      index + 1,
    ]);
  }
  return toJob(rows[0]!);
}

export async function jobById(id: string, client: Queryable = db): Promise<JobRecord | null> {
  const { rows } = await client.query<JobDbRow>(`SELECT ${COLUMNS} FROM jobs WHERE id = $1`, [id]);
  return rows[0] ? toJob(rows[0]) : null;
}

export async function jobsOfTeam(
  teamId: string,
  status: string | null,
  limit: number,
  cursor: bigint | null,
): Promise<JobRecord[]> {
  const { rows } = await db.query<JobDbRow>(
    `SELECT ${COLUMNS} FROM jobs
      WHERE team_id = $1
        AND ($2::text IS NULL OR status = $2)
        AND ($3::bigint IS NULL OR num < $3)
      ORDER BY num DESC LIMIT $4`,
    [teamId, status, cursor === null ? null : cursor.toString(), limit],
  );
  return rows.map(toJob);
}

export async function allJobsOfTeam(teamId: string): Promise<JobRecord[]> {
  const { rows } = await db.query<JobDbRow>(`SELECT ${COLUMNS} FROM jobs WHERE team_id = $1 ORDER BY num DESC`, [
    teamId,
  ]);
  return rows.map(toJob);
}

export async function queuedJobsOfTeam(teamId: string, client: Queryable = db): Promise<JobRecord[]> {
  const { rows } = await client.query<JobDbRow>(
    `SELECT ${COLUMNS} FROM jobs WHERE team_id = $1 AND status = 'queued' ORDER BY ${DISPATCH_ORDER}`,
    [teamId],
  );
  return rows.map(toJob);
}

export async function activeJobsOfTeam(teamId: string): Promise<JobRecord[]> {
  const { rows } = await db.query<JobDbRow>(
    `SELECT ${COLUMNS} FROM jobs WHERE team_id = $1 AND status IN ('queued', 'leased', 'running') ORDER BY num`,
    [teamId],
  );
  return rows.map(toJob);
}

export async function runningCount(client: Queryable, teamId: string): Promise<number> {
  const { rows } = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM jobs WHERE team_id = $1 AND status IN ('leased', 'running')`,
    [teamId],
  );
  return Number.parseInt(rows[0]!.count, 10);
}

/** Claims the next queued job for a team, or nothing when the team is at its concurrency budget. */
export async function claimNextQueued(client: Queryable, teamId: string): Promise<JobRecord | null> {
  const { rows } = await client.query<JobDbRow>(
    `SELECT ${COLUMNS} FROM jobs WHERE team_id = $1 AND status = 'queued'
      ORDER BY ${DISPATCH_ORDER} LIMIT 1 FOR UPDATE SKIP LOCKED`,
    [teamId],
  );
  return rows[0] ? toJob(rows[0]) : null;
}

export async function markLeased(client: Queryable, jobId: string, leaseExpiresAt: Date): Promise<void> {
  await client.query(
    `UPDATE jobs SET status = 'leased', attempts = attempts + 1, lease_expires_at = $2 WHERE id = $1`,
    [jobId, leaseExpiresAt],
  );
}

export async function markRunning(jobId: string, leaseExpiresAt: Date): Promise<void> {
  await db.query(
    `UPDATE jobs SET status = 'running', started_at = COALESCE(started_at, now()), lease_expires_at = $2
      WHERE id = $1 AND status = 'leased'`,
    [jobId, leaseExpiresAt],
  );
}

export async function renewLease(jobId: string, leaseExpiresAt: Date): Promise<void> {
  await db.query(`UPDATE jobs SET lease_expires_at = $2 WHERE id = $1 AND status IN ('leased', 'running')`, [
    jobId,
    leaseExpiresAt,
  ]);
}

export async function markSucceeded(
  client: Queryable,
  jobId: string,
  billedUnitsMicro: bigint,
  chargedMicro: bigint,
): Promise<void> {
  await client.query(
    `UPDATE jobs SET status = 'succeeded', finished_at = now(), billed_units_micro = $2, charged_micro = $3,
       lease_expires_at = NULL WHERE id = $1`,
    [jobId, billedUnitsMicro.toString(), chargedMicro.toString()],
  );
}

export async function markFailed(client: Queryable, jobId: string, reason: string): Promise<void> {
  await client.query(
    `UPDATE jobs SET status = 'failed', finished_at = now(), failure_reason = $2, lease_expires_at = NULL
      WHERE id = $1`,
    [jobId, reason],
  );
}

export async function markCancelled(client: Queryable, jobId: string): Promise<void> {
  await client.query(
    `UPDATE jobs SET status = 'cancelled', finished_at = now(), lease_expires_at = NULL WHERE id = $1`,
    [jobId],
  );
}

export async function markRequeued(client: Queryable, jobId: string): Promise<void> {
  await client.query(
    `UPDATE jobs SET status = 'queued', lapses = lapses + 1, lease_expires_at = NULL, started_at = NULL WHERE id = $1`,
    [jobId],
  );
}

export async function lapsedLeases(): Promise<JobRecord[]> {
  const { rows } = await db.query<JobDbRow>(
    `SELECT ${COLUMNS} FROM jobs WHERE status IN ('leased', 'running') AND lease_expires_at < now()`,
  );
  return rows.map(toJob);
}

export async function outputAssetIds(jobId: string, client: Queryable = db): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM assets WHERE job_id = $1 AND kind = 'output' ORDER BY output_index`,
    [jobId],
  );
  return rows.map((row) => row.id);
}

export async function inputAssetIds(jobId: string, client: Queryable = db): Promise<string[]> {
  const { rows } = await client.query<{ asset_id: string }>(
    'SELECT asset_id FROM job_input_assets WHERE job_id = $1 ORDER BY position',
    [jobId],
  );
  return rows.map((row) => row.asset_id);
}

/** Charges of succeeded jobs plus live reservations of in-flight jobs, both submitted in the period. */
export async function periodSpendMicro(client: Queryable, teamId: string, periodStart: Date): Promise<bigint> {
  const { rows } = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(
        CASE WHEN status = 'succeeded' THEN charged_micro
             WHEN status IN ('queued', 'leased', 'running') THEN reserved_micro
             ELSE 0 END), 0)::text AS total
       FROM jobs WHERE team_id = $1 AND period_start = $2`,
    [teamId, periodStart],
  );
  return big(rows[0]!.total);
}

export async function recordSubmissionAttempt(
  client: Queryable,
  teamId: string,
  periodStart: Date,
  refusedHardCap: boolean,
): Promise<void> {
  await client.query(
    `INSERT INTO last_submissions (team_id, period_start, refused_hard_cap, at) VALUES ($1, $2, $3, now())
     ON CONFLICT (team_id) DO UPDATE SET period_start = EXCLUDED.period_start,
       refused_hard_cap = EXCLUDED.refused_hard_cap, at = EXCLUDED.at`,
    [teamId, periodStart, refusedHardCap],
  );
}

export async function lastSubmissionRefusedHardCap(teamId: string, periodStart: Date): Promise<boolean> {
  const { rows } = await db.query<{ refused_hard_cap: boolean }>(
    'SELECT refused_hard_cap FROM last_submissions WHERE team_id = $1 AND period_start = $2',
    [teamId, periodStart],
  );
  return rows[0]?.refused_hard_cap ?? false;
}

export async function recentReplays(teamId: string): Promise<{ job_id: string; at: string }[]> {
  const { rows } = await db.query<{ job_id: string; at: Date }>(
    `SELECT job_id, at FROM replays WHERE team_id = $1 AND at > now() - interval '10 seconds' ORDER BY at DESC`,
    [teamId],
  );
  return rows.map((row) => ({ job_id: row.job_id, at: row.at.toISOString() }));
}

export async function recordReplay(client: Queryable, teamId: string, jobId: string): Promise<void> {
  await client.query('INSERT INTO replays (team_id, job_id, at) VALUES ($1, $2, now())', [teamId, jobId]);
}
