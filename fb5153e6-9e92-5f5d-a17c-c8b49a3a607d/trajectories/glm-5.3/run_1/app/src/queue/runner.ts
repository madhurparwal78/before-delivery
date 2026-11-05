import { query, one, withTransaction, type DbClient } from '../db/db.js';
import { config } from '../config.js';
import { getObject, putObject, derivativeKey, originalKey } from '../providers/storage.js';
import { isGlb, meshBounds, scaleMesh, buildGlb } from '../geometry/glb.js';
import { isZip } from '../geometry/zip.js';
import { buildStl } from '../geometry/stl.js';
import { renderPreview } from '../geometry/raster.js';
import { loadPackage, UNIT_FACTORS } from '../geometry/packages.js';
import { reconcileModelIndex, getModelById, type ModelRow } from '../domain/models.js';
import { ApiError } from '../errors.js';

export const STAGE_NAMES = ['validate', 'transcode', 'preview', 'index', 'publish'] as const;
export type StageName = (typeof STAGE_NAMES)[number];

export interface StageRow {
  name: StageName;
  status: 'pending' | 'running' | 'confirmed' | 'failed';
  attempts: number;
  next_attempt_at: string | null;
}

export interface UploadRow {
  ref: string;
  model_id: number;
  revision_id: number;
  status: 'in_progress' | 'completed' | 'failed';
  created_at: string;
}

/** Creates the upload and its five stage rows; joins the caller's transaction when given. */
export async function createUpload(modelId: number, revisionId: number, existing?: DbClient): Promise<string> {
  const ref = `up_${randomAlnum(12)}`;
  const insert = async (client: DbClient): Promise<void> => {
    await client.query(`INSERT INTO uploads (ref, model_id, revision_id) VALUES ($1, $2, $3)`, [ref, modelId, revisionId]);
    for (let i = 0; i < STAGE_NAMES.length; i++) {
      await client.query(
        `INSERT INTO upload_stages (upload_ref, name, idx, status) VALUES ($1, $2, $3, 'pending')`,
        [ref, STAGE_NAMES[i], i],
      );
    }
  };
  if (existing !== undefined) {
    await insert(existing);
    return ref;
  }
  await withTransaction(insert);
  return ref;
}

function randomAlnum(length: number): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = Buffer.alloc(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[(bytes[i] ?? 0) % alphabet.length];
  }
  return out;
}

export async function getUpload(ref: string): Promise<{ upload: UploadRow; stages: StageRow[]; model: ModelRow } | null> {
  const upload = await one<UploadRow>(
    `SELECT ref, model_id, revision_id, status, created_at FROM uploads WHERE ref = $1`,
    [ref],
  );
  if (upload === null) return null;
  const stages = await query<StageRow>(
    `SELECT name, status, attempts, next_attempt_at FROM upload_stages WHERE upload_ref = $1 ORDER BY idx`,
    [ref],
  );
  const model = await getModelById(upload.model_id);
  if (model === null) return null;
  return { upload, stages: stages.rows, model };
}

/** Requeue restarts a failed upload from its failed stage with attempts reset. */
export async function requeueUpload(ref: string): Promise<void> {
  await withTransaction(async client => {
    const upload = await client.query<UploadRow>(
      `SELECT ref, model_id, revision_id, status, created_at FROM uploads WHERE ref = $1 FOR UPDATE`,
      [ref],
    );
    const row = upload.rows[0];
    if (row === undefined || row.status !== 'failed') return;
    const stages = await client.query<{ name: StageName; status: string; idx: number }>(
      `SELECT name, status, idx FROM upload_stages WHERE upload_ref = $1 ORDER BY idx`,
      [ref],
    );
    const failed = stages.rows.find(stage => stage.status === 'failed');
    const firstIdx = failed?.idx ?? 0;
    for (const stage of stages.rows) {
      if (stage.idx >= firstIdx) {
        await client.query(
          `UPDATE upload_stages SET status = 'pending', attempts = 0, next_attempt_at = NULL, confirmed_at = NULL WHERE upload_ref = $1 AND name = $2`,
          [ref, stage.name],
        );
      }
    }
    await client.query(`UPDATE uploads SET status = 'in_progress' WHERE ref = $1`, [ref]);
  });
}

const running = new Set<string>();

/** Polls for due queue work and runs the next runnable stage. */
export async function tickQueue(): Promise<void> {
  const due = await query<{ ref: string }>(
    `SELECT DISTINCT us.upload_ref AS ref
     FROM upload_stages us
     JOIN uploads u ON u.ref = us.upload_ref
     WHERE u.status = 'in_progress'
       AND (
         (us.status = 'running' AND us.started_at < now() - interval '5 minutes')
         OR (us.status = 'pending' AND (us.next_attempt_at IS NULL OR us.next_attempt_at <= now()))
       )
     ORDER BY us.upload_ref
     LIMIT 10`,
  );
  for (const row of due.rows) {
    if (running.has(row.ref)) continue;
    running.add(row.ref);
    void (async () => {
      try {
        await runNextStage(row.ref);
      } finally {
        running.delete(row.ref);
      }
    })();
  }
}

interface StageClaim {
  upload: UploadRow;
  stage: { name: StageName; idx: number };
}

async function claimStage(ref: string): Promise<StageClaim | null> {
  return withTransaction(async client => {
    const uploadRow = await client.query<UploadRow>(
      `SELECT ref, model_id, revision_id, status, created_at FROM uploads WHERE ref = $1 FOR UPDATE`,
      [ref],
    );
    const upload = uploadRow.rows[0];
    if (upload === undefined || upload.status !== 'in_progress') return null;
    const stages = await client.query<{ name: StageName; status: string; attempts: number; idx: number }>(
      `SELECT name, status, attempts, idx FROM upload_stages WHERE upload_ref = $1 ORDER BY idx`,
      [ref],
    );
    for (const stage of stages.rows) {
      if (stage.status === 'confirmed') continue;
      if (stage.status === 'failed') {
        await client.query(`UPDATE uploads SET status = 'failed' WHERE ref = $1`, [ref]);
        return null;
      }
      if (stage.status === 'running') return null;
      await client.query(
        `UPDATE upload_stages SET status = 'running', started_at = now(), attempts = attempts + 1 WHERE upload_ref = $1 AND name = $2`,
        [ref, stage.name],
      );
      return { upload, stage: { name: stage.name, idx: stage.idx } };
    }
    return null;
  });
}

async function runNextStage(ref: string): Promise<void> {
  const claimed = await claimStage(ref);
  if (claimed === null) return;
  const { upload, stage } = claimed;
  try {
    await runStage(upload, stage.name);
    await query(
      `UPDATE upload_stages SET status = 'confirmed', confirmed_at = now(), next_attempt_at = NULL WHERE upload_ref = $1 AND name = $2`,
      [ref, stage.name],
    );
    const stages = await query<{ status: string }>(`SELECT status FROM upload_stages WHERE upload_ref = $1`, [ref]);
    if (stages.rows.every(entry => entry.status === 'confirmed')) {
      await query(`UPDATE uploads SET status = 'completed' WHERE ref = $1`, [ref]);
    }
  } catch (err) {
    await handleStageFailure(upload, stage.name, err instanceof Error ? err : new Error(String(err)));
  }
}

function isPackageProblem(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 415 || err.status === 422);
}

async function runStage(upload: UploadRow, stage: StageName): Promise<void> {
  const model = await getModelById(upload.model_id);
  const revision = await one<{ id: number; revision_no: number; source_checksum: string; source_unit: string }>(
    `SELECT id, revision_no, source_checksum, source_unit FROM model_revisions WHERE id = $1`,
    [upload.revision_id],
  );
  if (model === null || revision === null) throw new Error('missing model or revision');
  const original = await getObject(originalKey(revision.source_checksum));

  if (stage === 'validate') {
    loadPackage(original, detect(original));
    return;
  }
  if (stage === 'transcode') {
    const loaded = loadPackage(original, detect(original));
    const factor = UNIT_FACTORS[revision.source_unit] ?? 1;
    const mesh = scaleMesh(loaded.mesh, factor);
    const glb = buildGlb(mesh, { title: model.title });
    const stl = buildStl(mesh);
    await putObject(derivativeKey(model.slug, revision.revision_no, 'model.glb'), glb, 'model/gltf-binary');
    await putObject(derivativeKey(model.slug, revision.revision_no, 'model.stl'), stl, 'application/octet-stream');
    const box = meshBounds(mesh);
    await query(
      `UPDATE model_revisions SET dims_set = true, width_mm = $2, height_mm = $3, depth_mm = $4, bounding_radius_mm = $5
       WHERE id = $1`,
      [
        revision.id,
        round1((box.max[0] - box.min[0]) * 1000),
        round1((box.max[1] - box.min[1]) * 1000),
        round1((box.max[2] - box.min[2]) * 1000),
        round1((Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) / 2) * 1000),
      ],
    );
    return;
  }
  if (stage === 'preview') {
    const loaded = loadPackage(original, detect(original));
    const factor = UNIT_FACTORS[revision.source_unit] ?? 1;
    const mesh = scaleMesh(loaded.mesh, factor);
    const box = meshBounds(mesh);
    const png = renderPreview(
      mesh,
      { azimuth: model.cam_azimuth, tilt: model.cam_tilt, distanceFactor: model.cam_distance_factor, fov: model.cam_fov },
      box,
    );
    await putObject(derivativeKey(model.slug, revision.revision_no, 'preview.png'), png, 'image/png');
    return;
  }
  if (stage === 'index') {
    // Index writes the document when the model is visible, removes it otherwise; confirms when Meilisearch confirms.
    await reconcileModelIndex(model.id);
    return;
  }
  // publish: the revision becomes current and its files become what everyone is served.
  await withTransaction(async client => {
    await client.query(`UPDATE model_revisions SET current = false WHERE model_id = $1`, [model.id]);
    await client.query(`UPDATE model_revisions SET current = true WHERE id = $1`, [revision.id]);
    const dims = await client.query<{ width_mm: string; height_mm: string; depth_mm: string; bounding_radius_mm: string }>(
      `SELECT width_mm, height_mm, depth_mm, bounding_radius_mm FROM model_revisions WHERE id = $1`,
      [revision.id],
    );
    const dim = dims.rows[0];
    await client.query(
      `UPDATE models SET revision = $2, rebuilding = false, outdated = false, has_glb = true, has_stl = true,
         width_mm = $3, height_mm = $4, depth_mm = $5, bounding_radius_mm = $6,
         index_state = CASE WHEN state = 'published' AND visibility = 'public' AND NOT read_only THEN 'dirty' ELSE index_state END
       WHERE id = $1`,
      [model.id, revision.revision_no, dim?.width_mm ?? '50', dim?.height_mm ?? '50', dim?.depth_mm ?? '50', dim?.bounding_radius_mm ?? '43.3'],
    );
  });
}

function round1(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function detect(original: Buffer): 'glb' | 'gltf-package' {
  if (isGlb(original)) return 'glb';
  if (isZip(original)) return 'gltf-package';
  throw new ApiError(415, 'unsupported_type');
}

async function handleStageFailure(upload: UploadRow, stage: StageName, err: Error): Promise<void> {
  const current = await one<{ attempts: number }>(
    `SELECT attempts FROM upload_stages WHERE upload_ref = $1 AND name = $2`,
    [upload.ref, stage],
  );
  const attempts = current?.attempts ?? 1;
  const retrySchedule = config.queueRetrySeconds;
  const failNow = (stage === 'validate' && isPackageProblem(err)) || attempts >= retrySchedule.length + 1;
  if (failNow) {
    await query(
      `UPDATE upload_stages SET status = 'failed', next_attempt_at = NULL WHERE upload_ref = $1 AND name = $2`,
      [upload.ref, stage],
    );
    await query(`UPDATE uploads SET status = 'failed' WHERE ref = $1`, [upload.ref]);
    return;
  }
  const delaySeconds = retrySchedule[attempts - 1] ?? 600;
  await query(
    `UPDATE upload_stages SET status = 'pending', next_attempt_at = now() + make_interval(secs => $3::double precision) WHERE upload_ref = $1 AND name = $2`,
    [upload.ref, stage, delaySeconds],
  );
}

export interface QueueCounts {
  pending: number;
  running: number;
  failed: number;
}

export async function queueCounts(): Promise<QueueCounts> {
  const rows = await query<{ status: string; current_stage: string }>(
    `SELECT u.status::text AS status,
       COALESCE((SELECT s.status::text FROM upload_stages s WHERE s.upload_ref = u.ref AND s.status <> 'confirmed' ORDER BY s.idx LIMIT 1), 'none') AS current_stage
     FROM uploads u`,
  );
  let pending = 0;
  let runningCount = 0;
  let failed = 0;
  for (const row of rows.rows) {
    if (row.status === 'failed') {
      failed += 1;
      continue;
    }
    if (row.status !== 'in_progress') continue;
    if (row.current_stage === 'running') runningCount += 1;
    else pending += 1;
  }
  return { pending, running: runningCount, failed };
}

export interface StageStatusEntry {
  name: StageName;
  status: 'pending' | 'running' | 'confirmed' | 'failed';
  attempts: number;
  next_attempt_at: string | null;
}

export async function uploadStatus(ref: string): Promise<{
  upload: string;
  model: string;
  status: 'in_progress' | 'completed' | 'failed';
  stages: StageStatusEntry[];
} | null> {
  const data = await getUpload(ref);
  if (data === null) return null;
  return {
    upload: data.upload.ref,
    model: data.model.slug,
    status: data.upload.status,
    stages: data.stages.map(stage => ({
      name: stage.name,
      status: stage.status,
      attempts: stage.attempts,
      next_attempt_at: stage.next_attempt_at,
    })),
  };
}
