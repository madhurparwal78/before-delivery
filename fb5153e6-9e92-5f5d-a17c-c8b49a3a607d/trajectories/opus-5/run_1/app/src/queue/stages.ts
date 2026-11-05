import { config } from '../config.js';
import { query, queryOne } from '../db/pool.js';
import type { StageName } from '../db/uploads.js';
import { findModelById } from '../db/models.js';
import { activePlan } from '../db/plan.js';
import { isSourceUnit, sourceUnitFactor } from '../domain/model.js';
import type { Camera } from '../shared/viewer.js';
import { round1 } from '../shared/viewer.js';
import { GltfInvalidError, parseGlb, readGeometry, scaleGlbPositions } from '../media/gltf.js';
import { assembleGlbFromPackage } from '../media/package.js';
import { writeBinaryStl } from '../media/stl.js';
import { renderPreview } from '../media/render.js';
import { getObject, objectKeys, objectLength, putObject } from '../services/s3.js';
import { syncModel } from '../services/indexer.js';

/** A stage failure caused by the package itself: one attempt, no retry. */
export class PermanentStageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentStageError';
  }
}

interface RevisionRow {
  id: number;
  model_id: number;
  revision: number;
  original_sha256: string;
  source_unit: string;
  package_kind: string;
}

async function loadRevision(revisionId: number): Promise<RevisionRow> {
  const row = await queryOne<RevisionRow>(`SELECT * FROM revisions WHERE id = $1`, [revisionId]);
  if (row === null) throw new Error(`Revision ${revisionId} is missing`);
  return row;
}

/** Reads the original and returns it as a glTF binary in its source units. */
async function sourceGlb(revision: RevisionRow): Promise<Buffer> {
  const original = await getObject(objectKeys.original(revision.original_sha256));
  if (original === null) throw new Error('The original is missing from object storage');
  return revision.package_kind === 'gltf-package'
    ? assembleGlbFromPackage(original)
    : original;
}

function factorFor(sourceUnit: string): number {
  if (!isSourceUnit(sourceUnit)) throw new Error(`Unknown source unit ${sourceUnit}`);
  return sourceUnitFactor(sourceUnit);
}

/** The GLB in metres: the source's up direction with positions times the factor. */
async function metreGlb(revision: RevisionRow): Promise<Buffer> {
  return scaleGlbPositions(parseGlb(await sourceGlb(revision)), factorFor(revision.source_unit));
}

async function confirmWrite(objectKey: string, expected: number): Promise<void> {
  const length = await objectLength(objectKey);
  if (length !== expected) {
    throw new Error(`Object ${objectKey} read back as ${String(length)} bytes`);
  }
}

async function recordDerivative(
  revisionId: number,
  kind: 'glb' | 'stl' | 'preview',
  objectKey: string,
  byteLength: number,
): Promise<void> {
  await query(
    `INSERT INTO derivatives (revision_id, kind, object_key, bytes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (revision_id, kind) DO UPDATE SET object_key = EXCLUDED.object_key, bytes = EXCLUDED.bytes`,
    [revisionId, kind, objectKey, byteLength],
  );
}

/**
 * Validate reads the package as a 3D model and measures it. It fails at once,
 * with no retry, when the package itself cannot be read.
 */
async function runValidate(revision: RevisionRow): Promise<void> {
  let geometry;
  try {
    geometry = readGeometry(parseGlb(await metreGlb(revision)));
  } catch (error) {
    if (error instanceof GltfInvalidError) throw new PermanentStageError(error.message);
    throw error;
  }
  const { box } = geometry;
  const width = round1((box.max[0] - box.min[0]) * 1000);
  const height = round1((box.max[1] - box.min[1]) * 1000);
  const depth = round1((box.max[2] - box.min[2]) * 1000);
  const radius = round1(Math.hypot(width, height, depth) / 2);
  await query(
    `UPDATE revisions SET width_mm = $2, height_mm = $3, depth_mm = $4, bounding_radius_mm = $5
     WHERE id = $1`,
    [revision.id, width, height, depth, radius],
  );
}

/** Transcode writes the GLB in metres and the binary STL in millimetres. */
async function runTranscode(revision: RevisionRow, slug: string): Promise<void> {
  const glb = await metreGlb(revision);
  const geometry = readGeometry(parseGlb(glb));
  const stl = writeBinaryStl(geometry.triangles);

  const glbKey = objectKeys.derivative(slug, revision.revision, 'model.glb');
  await putObject(glbKey, glb, 'model/gltf-binary');
  await confirmWrite(glbKey, glb.length);
  await recordDerivative(revision.id, 'glb', glbKey, glb.length);

  const stlKey = objectKeys.derivative(slug, revision.revision, 'model.stl');
  await putObject(stlKey, stl, 'model/stl');
  await confirmWrite(stlKey, stl.length);
  await recordDerivative(revision.id, 'stl', stlKey, stl.length);
}

/** Preview renders the model from its default camera on the bone ground. */
async function runPreview(
  revision: RevisionRow,
  slug: string,
  camera: Camera,
  boundingRadiusMm: number,
): Promise<void> {
  const geometry = readGeometry(parseGlb(await metreGlb(revision)));
  const png = renderPreview(geometry.triangles, geometry.box, camera, boundingRadiusMm);
  const key = objectKeys.derivative(slug, revision.revision, 'preview.png');
  await putObject(key, png, 'image/png');
  await confirmWrite(key, png.length);
  await recordDerivative(revision.id, 'preview', key, png.length);
}

/** Publish makes the revision current and carries its measurements onto the model. */
async function runPublish(revision: RevisionRow): Promise<void> {
  await query(
    `UPDATE models m
     SET width_mm = COALESCE(r.width_mm, m.width_mm),
         height_mm = COALESCE(r.height_mm, m.height_mm),
         depth_mm = COALESCE(r.depth_mm, m.depth_mm),
         bounding_radius_mm = COALESCE(r.bounding_radius_mm, m.bounding_radius_mm),
         updated_at = now()
     FROM revisions r
     WHERE r.id = $1 AND m.id = r.model_id`,
    [revision.id],
  );
  await query(`UPDATE revisions SET published_at = now() WHERE id = $1`, [revision.id]);
}

export async function runStage(name: StageName, revisionId: number): Promise<void> {
  const revision = await loadRevision(revisionId);
  const model = await findModelById(revision.model_id, await activePlan());
  if (model === null) throw new Error(`Model ${revision.model_id} is missing`);

  switch (name) {
    case 'validate':
      await runValidate(revision);
      return;
    case 'transcode':
      await runTranscode(revision, model.slug);
      return;
    case 'preview': {
      const measured = await queryOne<{ bounding_radius_mm: string | null }>(
        `SELECT bounding_radius_mm FROM revisions WHERE id = $1`,
        [revisionId],
      );
      const radius = Number(measured?.bounding_radius_mm ?? model.boundingRadiusMm);
      await runPreview(revision, model.slug, model.defaultCamera, radius);
      return;
    }
    case 'index':
      await syncModel(model);
      return;
    case 'publish':
      await runPublish(revision);
      return;
  }
}

/** The published retry schedule, in order. */
export function retryDelaysSeconds(): readonly number[] {
  return config.queueRetrySeconds;
}

export function maxAttempts(): number {
  return retryDelaysSeconds().length + 1;
}
