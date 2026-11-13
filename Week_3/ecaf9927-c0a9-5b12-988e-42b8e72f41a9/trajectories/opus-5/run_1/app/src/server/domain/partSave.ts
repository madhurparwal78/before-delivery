import type { ConfirmedFigures, EntityGeometry, Part } from '../../shared/api.js';
import { buildProfile } from '../../shared/profile.js';
import { pool, withTransaction, type Db } from '../db.js';
import { errors } from '../errors.js';
import {
  buildBody,
  massProperties,
  OPERATION_WORD,
  type FeatureSpec,
  type Mesh,
} from '../geometry/body.js';
import {
  findPartRecord,
  listConstraintRecords,
  listEntityRecords,
  listFeatureRecords,
  listSketchRecords,
  lockPartRecord,
  solveStored,
  toPartResource,
  type PartRecord,
} from '../repo/parts.js';
import { findMaterial } from '../repo/workspace.js';
import { noteStorageOutcome, putBodyObject } from '../storage.js';

export function bodyObjectKey(partId: string, build: number): string {
  return `bodies/${partId}/build-${build}.json`;
}

type PreparedBuild = { build: number; mesh: Mesh; objectKey: string };

/** Gathers the extrude inputs, rebuilds the body and takes the part's next build number. */
async function prepareBuild(db: Db, part: PartRecord): Promise<PreparedBuild | null> {
  const features = await listFeatureRecords(db, part.id);
  if (features.length === 0) return null;

  const sketches = await listSketchRecords(db, part.id);
  const specs: FeatureSpec[] = [];
  for (const feature of features) {
    const sketch = sketches.find((candidate) => candidate.id === feature.sketch_id);
    if (!sketch) throw errors.notFound();
    const entities = await listEntityRecords(db, sketch.id);
    const constraints = await listConstraintRecords(db, sketch.id);
    const solved = solveStored(entities, constraints);
    const profile = buildProfile(
      entities.map((entity) => solved.geometry.get(entity.id) as EntityGeometry),
    );
    if (profile === null || solved.slack !== 0) throw errors.profileNotReady(sketch.name);
    specs.push({
      name: feature.name,
      operation: feature.operation,
      direction: feature.direction,
      depthMm: feature.depth_mm,
      plane: sketch.plane,
      offsetMm: sketch.offset_mm,
      profile,
    });
  }

  const outcome = buildBody(specs);
  if (!outcome.ok) {
    const word = OPERATION_WORD[outcome.failure.operation];
    throw outcome.failure.reason === 'empty' ? errors.emptyBody(word) : errors.separateBodies(word);
  }

  const build = part.next_build;
  await db.query(
    `update parts set body_status = 'saving', body_build = $2, next_build = $2 + 1 where id = $1`,
    [part.id, build],
  );
  return { build, mesh: outcome.mesh, objectKey: bodyObjectKey(part.id, build) };
}

async function finishBuild(part: PartRecord, prepared: PreparedBuild): Promise<void> {
  const payload = JSON.stringify({
    part_id: part.id,
    build: prepared.build,
    units: 'mm',
    vertices: prepared.mesh.vertices,
    triangles: prepared.mesh.triangles,
  });
  const outcome = await putBodyObject(prepared.objectKey, payload);
  noteStorageOutcome(outcome);
  if (outcome === 'refused') {
    await pool.query(
      `update parts set body_status = 'not_stored' where id = $1 and body_build = $2`,
      [part.id, prepared.build],
    );
    return;
  }
  const material = await findMaterial(pool, part.material_id);
  const properties = massProperties(prepared.mesh);
  const confirmed: ConfirmedFigures = {
    build: prepared.build,
    object_key: prepared.objectKey,
    volume_mm3: properties.volume_mm3,
    area_mm2: properties.area_mm2,
    centroid_mm: properties.centroid_mm,
    mass_g: ((material?.density_g_cm3 ?? 0) * properties.volume_mm3) / 1000,
  };
  await pool.query(
    `update parts set body_status = 'stored', confirmed = $3 where id = $1 and body_build = $2`,
    [part.id, prepared.build, JSON.stringify(confirmed)],
  );
}

/**
 * Every accepted change to a part runs through here: the change and the rebuild commit
 * together, then the body object is written and the confirmed figures follow.
 */
export async function runPartSave<T>(
  partId: string,
  mutate: (db: Db, part: PartRecord) => Promise<T>,
): Promise<{ part: Part; result: T }> {
  const committed = await withTransaction(async (db) => {
    const part = await lockPartRecord(db, partId);
    if (!part) throw errors.notFound();
    const result = await mutate(db, part);
    const reloaded = (await findPartRecord(db, partId)) as PartRecord;
    const prepared = await prepareBuild(db, reloaded);
    return { result, prepared, record: reloaded };
  });

  if (committed.prepared) await finishBuild(committed.record, committed.prepared);
  const record = (await findPartRecord(pool, partId)) as PartRecord;
  return { part: await toPartResource(pool, record), result: committed.result };
}

/** Marks builds abandoned by a stopped server, at boot. */
export async function clearInterruptedSaves(): Promise<void> {
  await pool.query(`update parts set body_status = 'not_stored' where body_status = 'saving'`);
}
