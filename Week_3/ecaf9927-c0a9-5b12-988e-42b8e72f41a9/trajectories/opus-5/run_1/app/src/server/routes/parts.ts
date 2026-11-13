import type { Direction, EntityGeometry, Operation, Plane } from '../../shared/api.js';
import { buildProfile } from '../../shared/profile.js';
import { newId } from '../auth.js';
import { pool, type Db } from '../db.js';
import { errors } from '../errors.js';
import { runPartSave } from '../domain/partSave.js';
import { withIdempotency } from '../domain/idempotency.js';
import { requireRevision } from '../domain/revision.js';
import { route, type Ctx, type Route } from '../http.js';
import {
  findPartRecord,
  findSketchRecord,
  listConstraintRecords,
  listEntityRecords,
  listFeatureRecords,
  listPartRecords,
  solveStored,
  toFeatureResource,
  toPartResource,
  toSketchResource,
  type FeatureRecord,
  type PartRecord,
} from '../repo/parts.js';
import { listMaterials, nameTaken, WORKSPACE_ID } from '../repo/workspace.js';
import { getBodyObject } from '../storage.js';
import { readIdempotencyKey, Reader, requireFounder } from '../validate.js';

const PLANES = ['top', 'front', 'right'] as const;
const DIRECTIONS = ['normal', 'reverse', 'symmetric'] as const;
const OPERATIONS = ['new', 'join', 'cut', 'intersect'] as const;

export async function requirePart(id: string): Promise<PartRecord> {
  const part = await findPartRecord(pool, id);
  if (!part) throw errors.notFound();
  return part;
}

async function bumpPart(db: Db, partId: string, memberId: string): Promise<void> {
  await db.query('update parts set revision = revision + 1, saved_by = $2 where id = $1', [
    partId,
    memberId,
  ]);
}

export const partRoutes: Route[] = [
  route('GET', '/api/parts', async () => {
    const records = await listPartRecords();
    const parts = [];
    for (const record of records) parts.push(await toPartResource(pool, record));
    return { status: 200, json: { parts } };
  }),

  route('POST', '/api/parts', async (ctx) => {
    requireFounder(ctx.member);
    const reader = new Reader(ctx.member.units);
    const name = reader.name(ctx.body.name);
    const materials = await listMaterials();
    const materialId = reader.materialId(
      ctx.body.material_id,
      materials.map((material) => material.id),
    );
    if (name !== '' && (await nameTaken(pool, name, null))) reader.nameTaken();
    reader.done();
    const id = newId();
    await pool.query(
      `insert into parts (id, workspace_id, name, material_id, saved_by, body_status)
       values ($1, $2, $3, $4, $5, 'none')`,
      [id, WORKSPACE_ID, name, materialId, ctx.member.id],
    );
    const record = (await findPartRecord(pool, id)) as PartRecord;
    return { status: 201, json: { part: await toPartResource(pool, record) } };
  }),

  route('GET', '/api/parts/:id', async (ctx) => {
    const record = await requirePart(ctx.params.id as string);
    return { status: 200, json: { part: await toPartResource(pool, record) } };
  }),

  route('PATCH', '/api/parts/:id', async (ctx) => {
    const existing = await requirePart(ctx.params.id as string);
    requireFounder(ctx.member);
    const saved = await runPartSave(existing.id, async (db, part) => {
      const reader = new Reader(ctx.member.units);
      const base = reader.baseRevision(ctx.body.base_revision);
      if (!Number.isNaN(base)) await requireRevision(db, base, part, part.name);
      const name = ctx.body.name === undefined ? part.name : reader.name(ctx.body.name);
      const materials = await listMaterials(db);
      const materialId =
        ctx.body.material_id === undefined
          ? part.material_id
          : reader.materialId(ctx.body.material_id, materials.map((material) => material.id));
      if (name !== part.name && name !== '' && (await nameTaken(db, name, part.id))) reader.nameTaken();
      reader.done();
      await db.query(
        'update parts set name = $2, material_id = $3, revision = revision + 1, saved_by = $4 where id = $1',
        [part.id, name, materialId, ctx.member.id],
      );
    });
    return { status: 200, json: { part: saved.part } };
  }),

  route('POST', '/api/parts/:id/save', async (ctx) => {
    const existing = await requirePart(ctx.params.id as string);
    const saved = await runPartSave(existing.id, async () => undefined);
    return { status: 200, json: { part: saved.part } };
  }),

  route('GET', '/api/parts/:id/body', async (ctx) => {
    const record = await requirePart(ctx.params.id as string);
    if (!record.confirmed) throw errors.notFound();
    const body = await getBodyObject(record.confirmed.object_key).catch(() => null);
    if (!body) throw errors.storageUnavailable();
    return { status: 200, raw: { body, contentType: 'application/json' } };
  }),

  route('POST', '/api/parts/:id/sketches', async (ctx) => {
    const existing = await requirePart(ctx.params.id as string);
    requireFounder(ctx.member);
    const saved = await runPartSave(existing.id, async (db, part) => {
      const reader = new Reader(ctx.member.units);
      const base = reader.baseRevision(ctx.body.base_revision);
      if (!Number.isNaN(base)) await requireRevision(db, base, part, part.name);
      const plane = reader.choice<Plane>(ctx.body.plane, PLANES, 'plane');
      const offset = reader.length(ctx.body.offset, 'offset', 'coordinate');
      reader.done();
      const id = newId();
      await db.query(
        `insert into sketches (id, part_id, name, plane, offset_mm, saved_by)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, part.id, `Sketch ${part.next_sketch_seq}`, plane, offset, ctx.member.id],
      );
      await db.query('update parts set next_sketch_seq = next_sketch_seq + 1 where id = $1', [part.id]);
      await bumpPart(db, part.id, ctx.member.id);
      return id;
    });
    const record = await findSketchRecord(pool, saved.result);
    return {
      status: 201,
      json: {
        sketch: await toSketchResource(pool, record as NonNullable<typeof record>),
        part: saved.part,
      },
    };
  }),

  route('POST', '/api/parts/:id/features', async (ctx) => {
    const existing = await requirePart(ctx.params.id as string);
    requireFounder(ctx.member);
    const key = readIdempotencyKey(ctx.header('idempotency-key'));
    const outcome = await withIdempotency(ctx.member.id, ctx.path, key, ctx.body, async () => {
      const saved = await runPartSave(existing.id, (db, part) => createFeature(ctx, db, part));
      return {
        status: 201,
        response: { feature: toFeatureResource(saved.result), part: saved.part },
      };
    });
    return {
      status: outcome.status,
      json: outcome.response,
      headers: outcome.replayed ? { 'idempotent-replayed': 'true' } : ({} as Record<string, string>),
    };
  }),

  route('PATCH', '/api/parts/:id/features/:fid', async (ctx) => {
    const existing = await requirePart(ctx.params.id as string);
    requireFounder(ctx.member);
    const features = await listFeatureRecords(pool, existing.id);
    const feature = features.find((candidate) => candidate.id === ctx.params.fid);
    if (!feature) throw errors.notFound();
    const saved = await runPartSave(existing.id, async (db, part) => {
      const reader = new Reader(ctx.member.units);
      const base = reader.baseRevision(ctx.body.base_revision);
      if (!Number.isNaN(base)) await requireRevision(db, base, part, part.name);
      const depth = ctx.body.depth === undefined ? feature.depth_mm : reader.length(ctx.body.depth, 'depth');
      const direction =
        ctx.body.direction === undefined
          ? feature.direction
          : reader.choice<Direction>(ctx.body.direction, DIRECTIONS, 'direction');
      reader.done();
      await db.query('update features set depth_mm = $2, direction = $3 where id = $1', [
        feature.id,
        depth,
        direction,
      ]);
      await bumpPart(db, part.id, ctx.member.id);
    });
    const updated = (await listFeatureRecords(pool, existing.id)).find(
      (candidate) => candidate.id === feature.id,
    ) as FeatureRecord;
    return { status: 200, json: { feature: toFeatureResource(updated), part: saved.part } };
  }),
];

async function createFeature(ctx: Ctx, db: Db, part: PartRecord): Promise<FeatureRecord> {
  const reader = new Reader(ctx.member.units);
  const base = reader.baseRevision(ctx.body.base_revision);
  if (!Number.isNaN(base)) await requireRevision(db, base, part, part.name);

  const sketchId = typeof ctx.body.sketch_id === 'string' ? ctx.body.sketch_id : '';
  const sketch = await findSketchRecord(db, sketchId);
  if (!sketch || sketch.part_id !== part.id) throw errors.notFound();

  const existingFeatures = await listFeatureRecords(db, part.id);
  const operation = reader.choice<Operation>(ctx.body.operation, OPERATIONS, 'operation');
  const first = existingFeatures.length === 0;
  if ((first && operation !== 'new') || (!first && operation === 'new')) reader.operationFailed();
  const depth = reader.length(ctx.body.depth, 'depth');
  const direction = reader.choice<Direction>(ctx.body.direction, DIRECTIONS, 'direction');
  reader.done();

  const entities = await listEntityRecords(db, sketch.id);
  const constraints = await listConstraintRecords(db, sketch.id);
  const solved = solveStored(entities, constraints);
  const profile = buildProfile(
    entities.map((entity) => solved.geometry.get(entity.id) as EntityGeometry),
  );
  if (solved.slack !== 0 || profile === null) throw errors.profileNotReady(sketch.name);

  const id = newId();
  await db.query(
    `insert into features (id, part_id, name, sketch_id, operation, depth_mm, direction)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, part.id, `Extrude ${part.next_feature_seq}`, sketch.id, operation, depth, direction],
  );
  await db.query('update parts set next_feature_seq = next_feature_seq + 1 where id = $1', [part.id]);
  await bumpPart(db, part.id, ctx.member.id);
  return {
    id,
    part_id: part.id,
    name: `Extrude ${part.next_feature_seq}`,
    sketch_id: sketch.id,
    operation,
    depth_mm: depth,
    direction,
  };
}
