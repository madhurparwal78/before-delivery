import { query, queryOne } from './pool.js';

export type StageName = 'validate' | 'transcode' | 'preview' | 'index' | 'publish';
export type StageStatus = 'pending' | 'running' | 'confirmed' | 'failed';
export type UploadStatus = 'in_progress' | 'completed' | 'failed';

/** Stages run in this order; a stage starts only after the previous confirmed. */
export const STAGE_ORDER: readonly StageName[] = [
  'validate',
  'transcode',
  'preview',
  'index',
  'publish',
];

export interface StageRecord {
  readonly name: StageName;
  readonly status: StageStatus;
  readonly attempts: number;
  readonly nextAttemptAt: Date | null;
}

export interface UploadRecord {
  readonly id: number;
  readonly uploadRef: string;
  readonly modelId: number;
  readonly modelSlug: string;
  readonly revisionId: number;
  readonly status: UploadStatus;
  readonly stages: readonly StageRecord[];
  readonly createdAt: Date;
}

interface UploadDbRow {
  id: number;
  upload_ref: string;
  model_id: number;
  slug: string;
  revision_id: number;
  status: UploadStatus;
  created_at: Date;
}

interface StageDbRow {
  upload_id: number;
  name: StageName;
  status: StageStatus;
  attempts: number;
  next_attempt_at: Date | null;
}

const SELECT = `
  SELECT u.id, u.upload_ref, u.model_id, m.slug, u.revision_id, u.status, u.created_at
  FROM uploads u JOIN models m ON m.id = u.model_id`;

async function withStages(rows: readonly UploadDbRow[]): Promise<readonly UploadRecord[]> {
  if (rows.length === 0) return [];
  const stageRows = await query<StageDbRow>(
    `SELECT upload_id, name, status, attempts, next_attempt_at
     FROM upload_stages WHERE upload_id = ANY($1::int[]) ORDER BY position`,
    [rows.map((r) => r.id)],
  );
  return rows.map((row) => ({
    id: row.id,
    uploadRef: row.upload_ref,
    modelId: row.model_id,
    modelSlug: row.slug,
    revisionId: row.revision_id,
    status: row.status,
    createdAt: row.created_at,
    stages: stageRows
      .filter((s) => s.upload_id === row.id)
      .map((s) => ({
        name: s.name,
        status: s.status,
        attempts: s.attempts,
        nextAttemptAt: s.next_attempt_at,
      })),
  }));
}

export async function findUploadByRef(uploadRef: string): Promise<UploadRecord | null> {
  const rows = await query<UploadDbRow>(`${SELECT} WHERE u.upload_ref = $1`, [uploadRef]);
  return (await withStages(rows))[0] ?? null;
}

export async function latestUploadForModel(modelId: number): Promise<UploadRecord | null> {
  const rows = await query<UploadDbRow>(
    `${SELECT} WHERE u.model_id = $1 ORDER BY u.created_at DESC, u.id DESC LIMIT 1`,
    [modelId],
  );
  return (await withStages(rows))[0] ?? null;
}

export async function latestUploads(limit: number): Promise<readonly UploadRecord[]> {
  const rows = await query<UploadDbRow>(
    `${SELECT} ORDER BY u.created_at DESC, u.id DESC LIMIT $1`,
    [limit],
  );
  return withStages(rows);
}

/** Creates the upload with its five stages, the first one pending. */
export async function createUpload(
  uploadRef: string,
  modelId: number,
  revisionId: number,
): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO uploads (upload_ref, model_id, revision_id, status)
     VALUES ($1, $2, $3, 'in_progress') RETURNING id`,
    [uploadRef, modelId, revisionId],
  );
  if (row === null) throw new Error('Upload row was not created');
  for (const [position, name] of STAGE_ORDER.entries()) {
    await query(
      `INSERT INTO upload_stages (upload_id, name, position, status) VALUES ($1, $2, $3, 'pending')`,
      [row.id, name, position],
    );
  }
  return row.id;
}

/** Marks every stage confirmed, used for seeded revisions. */
export async function createConfirmedUpload(
  uploadRef: string,
  modelId: number,
  revisionId: number,
): Promise<void> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO uploads (upload_ref, model_id, revision_id, status)
     VALUES ($1, $2, $3, 'completed') RETURNING id`,
    [uploadRef, modelId, revisionId],
  );
  if (row === null) throw new Error('Upload row was not created');
  for (const [position, name] of STAGE_ORDER.entries()) {
    await query(
      `INSERT INTO upload_stages (upload_id, name, position, status, attempts)
       VALUES ($1, $2, $3, 'confirmed', 1)`,
      [row.id, name, position],
    );
  }
}

/** The queue column for a model: the state of its latest upload. */
export type QueueStatus = 'in_progress' | 'completed' | 'failed' | 'none';

export async function queueStatusFor(modelId: number): Promise<QueueStatus> {
  const upload = await latestUploadForModel(modelId);
  return upload === null ? 'none' : upload.status;
}

export interface QueueCounts {
  readonly pending: number;
  readonly running: number;
  readonly failed: number;
}

/**
 * `pending` counts uploads in progress whose current stage is pending, including
 * one waiting on a retry; `running` those whose current stage is running.
 */
export async function queueCounts(): Promise<QueueCounts> {
  const rows = await query<{ status: UploadStatus; stage: StageStatus | null }>(
    `SELECT u.status,
            (SELECT s.status FROM upload_stages s
             WHERE s.upload_id = u.id AND s.status <> 'confirmed'
             ORDER BY s.position LIMIT 1) AS stage
     FROM uploads u`,
  );
  let pending = 0;
  let running = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.status === 'failed') failed += 1;
    else if (row.status === 'in_progress') {
      if (row.stage === 'running') running += 1;
      else if (row.stage === 'pending') pending += 1;
    }
  }
  return { pending, running, failed };
}
