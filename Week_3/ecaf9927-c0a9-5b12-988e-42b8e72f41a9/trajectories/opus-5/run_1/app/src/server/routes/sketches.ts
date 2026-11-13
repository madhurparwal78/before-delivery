import {
  CONSTRAINT_KINDS,
  CONSTRAINT_LABEL_WORD,
  DIMENSION_KINDS,
  type ConstraintKind,
  type EntityGeometry,
  type EntityType,
  type Part,
  type Sketch,
} from '../../shared/api.js';
import { newId } from '../auth.js';
import { pool, type Db } from '../db.js';
import { runPartSave } from '../domain/partSave.js';
import { requireRevision } from '../domain/revision.js';
import { errors } from '../errors.js';
import { route, type Ctx, type Route } from '../http.js';
import {
  constraintLabel,
  entityLabel,
  findSketchRecord,
  listConstraintRecords,
  listEntityRecords,
  listFeaturesUsingSketch,
  lockSketchRecord,
  nextLabelNumber,
  peekLabelNumber,
  toSketchResource,
  toSolverConstraints,
  toSolverEntities,
  type ConstraintRecord,
  type EntityRecord,
  type SketchRecord,
} from '../repo/parts.js';
import { findPartRecord, toPartResource } from '../repo/parts.js';
import { nameConflict } from '../solver/conflicts.js';
import {
  orderSeparationRefs,
  referencesFit,
  solveSketch,
  type SolverConstraint,
} from '../solver/sketch.js';
import { Reader } from '../validate.js';

const ENTITY_TYPES = ['point', 'line', 'circle', 'arc'] as const;

async function requireSketch(id: string): Promise<SketchRecord> {
  const sketch = await findSketchRecord(pool, id);
  if (!sketch) throw errors.notFound();
  return sketch;
}

function staleThing(sketch: SketchRecord, partName: string): string {
  return `${sketch.name} on ${partName}`;
}

async function bumpSketch(db: Db, sketchId: string, memberId: string): Promise<void> {
  await db.query('update sketches set revision = revision + 1, saved_by = $2 where id = $1', [
    sketchId,
    memberId,
  ]);
}

/** A sketch an extrude uses must stay fully held. */
async function guardDrivenSketch(
  db: Db,
  sketch: SketchRecord,
  entities: EntityRecord[],
  constraints: ConstraintRecord[],
): Promise<void> {
  const drives = await listFeaturesUsingSketch(db, sketch.id);
  if (drives.length === 0) return;
  const solved = solveSketch(toSolverEntities(entities), toSolverConstraints(constraints));
  if (solved !== null && solved.slack === 0) return;
  throw errors.sketchDrivesFeature(sketch.name, (drives[0] as { name: string }).name);
}

function readEntityGeometry(ctx: Ctx, reader: Reader): EntityGeometry {
  const source = (typeof ctx.body.entity === 'object' && ctx.body.entity !== null
    ? ctx.body.entity
    : {}) as Record<string, unknown>;
  const type = reader.choice<EntityType>(source.type, ENTITY_TYPES, 'entity.type');
  const point = (raw: unknown, path: string): { x: number; y: number } => {
    const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    return {
      x: reader.length(value.x, `${path}.x`, 'coordinate'),
      y: reader.length(value.y, `${path}.y`, 'coordinate'),
    };
  };
  if (type === 'point') {
    return {
      type: 'point',
      x: reader.length(source.x, 'entity.x', 'coordinate'),
      y: reader.length(source.y, 'entity.y', 'coordinate'),
    };
  }
  if (type === 'line') {
    return { type: 'line', start: point(source.start, 'entity.start'), end: point(source.end, 'entity.end') };
  }
  if (type === 'circle') {
    return {
      type: 'circle',
      center: point(source.center, 'entity.center'),
      radius: reader.length(source.radius, 'entity.radius'),
    };
  }
  return {
    type: 'arc',
    center: point(source.center, 'entity.center'),
    radius: reader.length(source.radius, 'entity.radius'),
    start_angle_deg: reader.angle(source.start_angle_deg, 'entity.start_angle_deg'),
    end_angle_deg: reader.angle(source.end_angle_deg, 'entity.end_angle_deg'),
  };
}

async function sketchAndPart(
  sketchId: string,
  partId: string,
): Promise<{ sketch: Sketch; part: Part }> {
  const sketch = await requireSketch(sketchId);
  const part = await findPartRecord(pool, partId);
  return {
    sketch: await toSketchResource(pool, sketch),
    part: await toPartResource(pool, part as NonNullable<typeof part>),
  };
}

export const sketchRoutes: Route[] = [
  route('GET', '/api/sketches/:sid', async (ctx) => {
    const sketch = await requireSketch(ctx.params.sid as string);
    return { status: 200, json: { sketch: await toSketchResource(pool, sketch) } };
  }),

  route('POST', '/api/sketches/:sid/entities', async (ctx) => {
    const existing = await requireSketch(ctx.params.sid as string);
    const saved = await runPartSave(existing.part_id, async (db, part) => {
      const sketch = (await lockSketchRecord(db, existing.id)) as SketchRecord;
      const reader = new Reader(ctx.member.units);
      const base = reader.baseRevision(ctx.body.base_revision);
      if (!Number.isNaN(base)) await requireRevision(db, base, sketch, staleThing(sketch, part.name));
      const geometry = readEntityGeometry(ctx, reader);
      reader.done();

      const id = newId();
      const label = entityLabel(geometry.type, await nextLabelNumber(db, sketch.id, geometry.type));
      await db.query(
        'insert into sketch_entities (id, sketch_id, label, geometry) values ($1, $2, $3, $4)',
        [id, sketch.id, label, JSON.stringify(geometry)],
      );
      await guardDrivenSketch(
        db,
        sketch,
        await listEntityRecords(db, sketch.id),
        await listConstraintRecords(db, sketch.id),
      );
      await bumpSketch(db, sketch.id, ctx.member.id);
      return id;
    });
    const resources = await sketchAndPart(existing.id, existing.part_id);
    const entity = resources.sketch.entities.find((candidate) => candidate.id === saved.result);
    return { status: 201, json: { ...resources, entity } };
  }),

  route('DELETE', '/api/sketches/:sid/entities/:eid', async (ctx) => {
    const existing = await requireSketch(ctx.params.sid as string);
    await runPartSave(existing.part_id, async (db, part) => {
      const sketch = (await lockSketchRecord(db, existing.id)) as SketchRecord;
      const entities = await listEntityRecords(db, sketch.id);
      if (!entities.some((candidate) => candidate.id === ctx.params.eid)) throw errors.notFound();
      const reader = new Reader(ctx.member.units);
      const base = reader.baseRevision(Number(ctx.query.get('base_revision')));
      if (!Number.isNaN(base)) await requireRevision(db, base, sketch, staleThing(sketch, part.name));
      reader.done();

      const constraints = await listConstraintRecords(db, sketch.id);
      const doomed = constraints.filter((constraint) =>
        constraint.refs.some((ref) => ref === ctx.params.eid || ref.startsWith(`${ctx.params.eid}.`)),
      );
      for (const constraint of doomed) {
        await db.query('delete from sketch_constraints where id = $1', [constraint.id]);
      }
      await db.query('delete from sketch_entities where id = $1', [ctx.params.eid]);
      await guardDrivenSketch(
        db,
        sketch,
        await listEntityRecords(db, sketch.id),
        await listConstraintRecords(db, sketch.id),
      );
      await bumpSketch(db, sketch.id, ctx.member.id);
    });
    return { status: 200, json: await sketchAndPart(existing.id, existing.part_id) };
  }),

  route('POST', '/api/sketches/:sid/constraints', async (ctx) => {
    const existing = await requireSketch(ctx.params.sid as string);
    const saved = await runPartSave(existing.part_id, (db, part) =>
      addConstraint(ctx, db, existing.id, part.name),
    );
    const resources = await sketchAndPart(existing.id, existing.part_id);
    const constraint = resources.sketch.constraints.find(
      (candidate) => candidate.id === saved.result,
    );
    return { status: 201, json: { ...resources, constraint } };
  }),

  route('PATCH', '/api/sketches/:sid/constraints/:cid', async (ctx) => {
    const existing = await requireSketch(ctx.params.sid as string);
    await runPartSave(existing.part_id, (db, part) =>
      editConstraint(ctx, db, existing.id, part.name),
    );
    const resources = await sketchAndPart(existing.id, existing.part_id);
    const constraint = resources.sketch.constraints.find(
      (candidate) => candidate.id === ctx.params.cid,
    );
    return { status: 200, json: { ...resources, constraint } };
  }),

  route('DELETE', '/api/sketches/:sid/constraints/:cid', async (ctx) => {
    const existing = await requireSketch(ctx.params.sid as string);
    await runPartSave(existing.part_id, async (db, part) => {
      const sketch = (await lockSketchRecord(db, existing.id)) as SketchRecord;
      const constraints = await listConstraintRecords(db, sketch.id);
      if (!constraints.some((candidate) => candidate.id === ctx.params.cid)) throw errors.notFound();
      const reader = new Reader(ctx.member.units);
      const base = reader.baseRevision(Number(ctx.query.get('base_revision')));
      if (!Number.isNaN(base)) await requireRevision(db, base, sketch, staleThing(sketch, part.name));
      reader.done();
      await db.query('delete from sketch_constraints where id = $1', [ctx.params.cid]);
      await guardDrivenSketch(
        db,
        sketch,
        await listEntityRecords(db, sketch.id),
        await listConstraintRecords(db, sketch.id),
      );
      await bumpSketch(db, sketch.id, ctx.member.id);
    });
    return { status: 200, json: await sketchAndPart(existing.id, existing.part_id) };
  }),
];

async function addConstraint(ctx: Ctx, db: Db, sketchId: string, partName: string): Promise<string> {
  const sketch = (await lockSketchRecord(db, sketchId)) as SketchRecord;
  const reader = new Reader(ctx.member.units);
  const base = reader.baseRevision(ctx.body.base_revision);
  if (!Number.isNaN(base)) await requireRevision(db, base, sketch, staleThing(sketch, partName));

  const kind = reader.choice<ConstraintKind>(ctx.body.kind, CONSTRAINT_KINDS, 'kind');
  const rawRefs = Array.isArray(ctx.body.refs) ? ctx.body.refs : [];
  const refs = rawRefs.filter((ref): ref is string => typeof ref === 'string');
  const needsValue = DIMENSION_KINDS.includes(kind);
  const value = needsValue ? reader.length(ctx.body.value, 'value') : null;
  const tolerance = needsValue ? reader.tolerance(ctx.body.tolerance) : undefined;

  const entityRecords = await listEntityRecords(db, sketch.id);
  const entities = toSolverEntities(entityRecords);
  const candidate: SolverConstraint = {
    id: 'candidate',
    kind,
    refs: orderSeparationRefs(kind, refs, entities),
    valueMm: value,
    fixAt: null,
  };
  if (!referencesFit(candidate, entities)) reader.refsFailed(CONSTRAINT_LABEL_WORD[kind]);
  reader.done();

  if (kind === 'fix') {
    candidate.fixAt = await pointPositionOf(db, sketch, refs[0] as string);
  }

  const constraintRecords = await listConstraintRecords(db, sketch.id);
  const existing = toSolverConstraints(constraintRecords);
  const solved = solveSketch(entities, [...existing, candidate]);
  if (solved === null) {
    const refusedLabel = constraintLabel(kind, await peekLabelNumber(db, sketch.id, kind));
    if (existing.length === 0) throw errors.unsolvable();
    const named = nameConflict(candidate, existing, entities);
    const record = constraintRecords.find((item) => item.id === named.id) as ConstraintRecord;
    throw errors.overConstrained(refusedLabel, { id: record.id, label: record.label });
  }

  const id = newId();
  const label = constraintLabel(kind, await nextLabelNumber(db, sketch.id, kind));
  await db.query(
    `insert into sketch_constraints (id, sketch_id, label, kind, refs, value_mm, tolerance, fix_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      sketch.id,
      label,
      kind,
      JSON.stringify(candidate.refs),
      value,
      tolerance ? JSON.stringify(tolerance) : null,
      candidate.fixAt ? JSON.stringify(candidate.fixAt) : null,
    ],
  );
  await persistGeometry(db, entityRecords, solved.geometry);
  await bumpSketch(db, sketch.id, ctx.member.id);
  return id;
}

async function editConstraint(ctx: Ctx, db: Db, sketchId: string, partName: string): Promise<void> {
  const sketch = (await lockSketchRecord(db, sketchId)) as SketchRecord;
  const constraintRecords = await listConstraintRecords(db, sketch.id);
  const target = constraintRecords.find((candidate) => candidate.id === ctx.params.cid);
  if (!target) throw errors.notFound();

  const reader = new Reader(ctx.member.units);
  const base = reader.baseRevision(ctx.body.base_revision);
  if (!Number.isNaN(base)) await requireRevision(db, base, sketch, staleThing(sketch, partName));
  const value = ctx.body.value === undefined ? target.value_mm : reader.length(ctx.body.value, 'value');
  const tolerance = reader.tolerance(ctx.body.tolerance);
  reader.done();

  const entityRecords = await listEntityRecords(db, sketch.id);
  const entities = toSolverEntities(entityRecords);
  const constraints = toSolverConstraints(constraintRecords).map((constraint) =>
    constraint.id === target.id ? { ...constraint, valueMm: value } : constraint,
  );
  const solved = solveSketch(entities, constraints);
  if (solved === null) throw errors.unsolvable();

  await db.query('update sketch_constraints set value_mm = $2, tolerance = $3 where id = $1', [
    target.id,
    value,
    tolerance === undefined
      ? target.tolerance === null
        ? null
        : JSON.stringify(target.tolerance)
      : tolerance === null
        ? null
        : JSON.stringify(tolerance),
  ]);
  await persistGeometry(db, entityRecords, solved.geometry);
  await bumpSketch(db, sketch.id, ctx.member.id);
}

async function persistGeometry(
  db: Db,
  records: EntityRecord[],
  geometry: Map<string, EntityGeometry>,
): Promise<void> {
  for (const record of records) {
    await db.query('update sketch_entities set geometry = $2 where id = $1', [
      record.id,
      JSON.stringify(geometry.get(record.id)),
    ]);
  }
}

async function pointPositionOf(
  db: Db,
  sketch: SketchRecord,
  ref: string,
): Promise<{ x: number; y: number }> {
  const resource = await toSketchResource(db, sketch);
  const point = resource.points.find((candidate) => candidate.ref === ref) as { x: number; y: number };
  return { x: point.x, y: point.y };
}
