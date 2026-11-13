import { randomUUID } from 'node:crypto';
import type { ConstraintKind, Entity, Part, Point2, Sketch } from '../shared/api';
import { pool, type Db } from './db';
import { notFound, overConstrained, sketchDrivesFeature, unsolvable } from './errors';
import { FIELD_MESSAGES } from '../shared/messages';
import { CONSTRAINT_WORDS, isDimension, refsFit } from '../shared/constraint-rules';
import { analyzeSketch, anchored, conflictingConstraint, solveWith, type StoredConstraint } from './geometry/constraints';
import type { Analysis } from './geometry/solver';
import { parseAngle, parseCoordinate, parseLength, parseTolerance } from '../shared/lengths';
import { beginSave, savedPart } from './parts';
import {
  constraintJson,
  drivenBy,
  rememberAnalysis,
  loadSketch,
  partRow,
  sketchRow,
  sketchViewJson,
  type LoadedSketch,
  type MemberRow,
} from './repo';
import { Validator, objectBody, requireCurrentRevision } from './validate';

type EntityGeometry = Entity extends infer E ? (E extends Entity ? Omit<E, 'id' | 'label'> : never) : never;

const ENTITY_WORDS = { point: 'Point', line: 'Line', circle: 'Circle', arc: 'Arc' } as const;

const geometryOf = ({ id: _id, label: _label, ...geometry }: Entity): EntityGeometry => geometry as EntityGeometry;

/** Reads the geometry of a new entity; problems are reported under `entity.<field>`. */
function parseEntity(v: Validator, input: unknown, unit: MemberRow['units']): EntityGeometry | undefined {
  const raw = objectBody(input);
  const object = (value: unknown) => objectBody(value);
  const coordinate = (field: string, value: unknown) => v.take(`entity.${field}`, () => parseCoordinate(value, unit));
  const length = (field: string, value: unknown) => v.take(`entity.${field}`, () => parseLength(value, unit));
  const point = (field: string, value: unknown): Point2 => {
    const p = object(value);
    return { x: coordinate(`${field}.x`, p['x']) ?? 0, y: coordinate(`${field}.y`, p['y']) ?? 0 };
  };
  switch (raw['type']) {
    case 'point':
      return { type: 'point', x: coordinate('x', raw['x']) ?? 0, y: coordinate('y', raw['y']) ?? 0 };
    case 'line': {
      const start = point('start', raw['start']);
      const end = point('end', raw['end']);
      if (start.x === end.x && start.y === end.y) v.fail('entity.end.x', FIELD_MESSAGES.lengthRange);
      return { type: 'line', start, end };
    }
    case 'circle':
      return { type: 'circle', center: point('center', raw['center']), radius: length('radius', raw['radius']) ?? 1 };
    case 'arc':
      return {
        type: 'arc',
        center: point('center', raw['center']),
        radius: length('radius', raw['radius']) ?? 1,
        start_angle_deg: v.take('entity.start_angle_deg', () => parseAngle(raw['start_angle_deg'])) ?? 0,
        end_angle_deg: v.take('entity.end_angle_deg', () => parseAngle(raw['end_angle_deg'])) ?? 0,
      };
    default:
      v.fail('entity.type', FIELD_MESSAGES.option);
      return undefined;
  }
}

interface Change<T> {
  extra: T;
  /** The analysis of the sketch as it is after this change, when the change had to compute it anyway. */
  analysis?: Analysis;
}

interface ChangeContext {
  db: Db;
  member: MemberRow;
  sketch: LoadedSketch;
  v: Validator;
}

/**
 * One sketch change, in the order the API promises: the stale-revision check, the change's own validation and
 * refusals, then the sketch revision bump and the part save. Everything rolls back when anything is refused.
 */
async function changeSketch<T>(
  member: MemberRow,
  sketchId: string,
  baseInput: unknown,
  run: (context: ChangeContext) => Promise<Change<T>>,
): Promise<{ sketch: Sketch; part: Part } & T> {
  const { partId } = await sketchRow(pool, sketchId);
  let extra!: T;
  let analysis: Analysis | undefined;
  let nextRevision = 0;
  const part = await savedPart(partId, async (db) => {
    const partRecord = await partRow(db, partId, true);
    const sketch = await loadSketch(db, sketchId, true);
    const v = new Validator();
    await requireCurrentRevision(db, v, baseInput, sketch.row, `${sketch.row.name} on ${partRecord.name}`);
    const change = await run({ db, member, sketch, v });
    extra = change.extra;
    analysis = change.analysis;
    nextRevision = sketch.row.revision + 1;
    await db.query('UPDATE sketches SET revision = revision + 1, saved_by = $2 WHERE id = $1', [sketchId, member.id]);
    return beginSave(db, partId);
  });
  // Handed over only now: a refused save above rolls the revision back, and the analysis must not outlive it.
  if (analysis) rememberAnalysis(sketchId, nextRevision, analysis);
  return { sketch: await sketchViewJson(pool, sketchId), part, ...extra };
}

/** A sketch that drives an extrude must stay fully held. */
async function mustStayFullyHeld(db: Db, sketch: LoadedSketch, entities: readonly Entity[], constraints: readonly StoredConstraint[]) {
  const [driven] = await drivenBy(db, sketch.row.id);
  if (driven && analyzeSketch(entities, constraints).slack > 0) throw sketchDrivesFeature(sketch.row.name, driven.name);
}

async function writeGeometry(db: Db, before: readonly Entity[], after: readonly Entity[]): Promise<void> {
  for (const [i, entity] of after.entries()) {
    const old = before[i] as Entity;
    if (JSON.stringify(old) !== JSON.stringify(entity)) {
      await db.query('UPDATE entities SET geometry = $2 WHERE id = $1', [entity.id, JSON.stringify(geometryOf(entity))]);
    }
  }
}

export async function addEntity(member: MemberRow, sketchId: string, input: unknown) {
  const body = objectBody(input);
  return changeSketch(member, sketchId, body['base_revision'], async ({ db, sketch, v }) => {
    const geometry = parseEntity(v, body['entity'], member.units);
    v.done();
    const [driven] = await drivenBy(db, sketchId);
    if (driven) throw sketchDrivesFeature(sketch.row.name, driven.name);
    const { type } = geometry as EntityGeometry;
    const label = `${ENTITY_WORDS[type]} ${(sketch.row.entityCounters[type] ?? 0) + 1}`;
    const entity = { id: randomUUID(), label, ...(geometry as EntityGeometry) } as Entity;
    await db.query('INSERT INTO entities (id, sketch_id, label, geometry) VALUES ($1, $2, $3, $4)', [
      entity.id,
      sketchId,
      label,
      JSON.stringify(geometry),
    ]);
    await db.query('UPDATE sketches SET entity_counters = entity_counters || $2::jsonb WHERE id = $1', [
      sketchId,
      JSON.stringify({ [type]: (sketch.row.entityCounters[type] ?? 0) + 1 }),
    ]);
    return { extra: { entity } };
  });
}

export async function deleteEntity(member: MemberRow, sketchId: string, entityId: string, base: unknown) {
  return changeSketch(member, sketchId, base, async ({ db, sketch, v }) => {
    const gone = sketch.entities.find((e) => e.id === entityId);
    if (!gone) throw notFound();
    v.done();
    const entities = sketch.entities.filter((e) => e.id !== entityId);
    const constraints = sketch.constraints.filter((c) => !c.refs.some((ref) => ref.split('.')[0] === entityId));
    await mustStayFullyHeld(db, sketch, entities, constraints);
    await db.query('DELETE FROM constraints WHERE sketch_id = $1 AND NOT (id = ANY($2))', [sketchId, constraints.map((c) => c.id)]);
    await db.query('DELETE FROM entities WHERE id = $1', [entityId]);
    return { extra: {} };
  });
}

const KINDS = Object.keys(CONSTRAINT_WORDS) as ConstraintKind[];

function parseDimension(v: Validator, kind: ConstraintKind, body: Record<string, unknown>, unit: MemberRow['units'], valueRequired: boolean) {
  const value = isDimension(kind) && (valueRequired || 'value' in body) ? v.take('value', () => parseLength(body['value'], unit)) : undefined;
  const tolerance = 'tolerance' in body && isDimension(kind) ? v.take('tolerance', () => parseTolerance(body['tolerance'], unit)) : undefined;
  return { value, tolerance };
}

export async function addConstraint(member: MemberRow, sketchId: string, input: unknown) {
  const body = objectBody(input);
  return changeSketch(member, sketchId, body['base_revision'], async ({ db, sketch, v }) => {
    const kind = KINDS.find((k) => k === body['kind']);
    const refs = Array.isArray(body['refs']) && body['refs'].every((r) => typeof r === 'string') ? (body['refs'] as string[]) : [];
    if (!kind) v.fail('kind', FIELD_MESSAGES.option);
    else if (!refsFit(kind, refs, sketch.entities)) v.fail('refs', FIELD_MESSAGES.refs(CONSTRAINT_WORDS[kind]));
    const { value, tolerance } = parseDimension(v, kind ?? 'coincident', body, member.units, true);
    if ('tolerance' in body && kind && !isDimension(kind) && body['tolerance'] !== null && body['tolerance'] !== '') {
      v.fail('tolerance', FIELD_MESSAGES.tolerance);
    }
    v.done();
    const resolved = kind as ConstraintKind;
    const label = `${CONSTRAINT_WORDS[resolved]} ${(sketch.row.constraintCounters[resolved] ?? 0) + 1}`;
    const candidate = { ...anchored({ id: randomUUID(), kind: resolved, refs, value }, sketch.entities), label, ...(tolerance ? { tolerance } : {}) };
    const solved = solveWith(sketch.entities, [...sketch.constraints, candidate], candidate.id);
    if (!solved) {
      const existing = conflictingConstraint(sketch.constraints, candidate);
      throw existing ? overConstrained(label, { id: existing.id, label: existing.label }) : unsolvable();
    }
    await writeGeometry(db, sketch.entities, solved);
    await db.query(
      'INSERT INTO constraints (id, sketch_id, label, kind, refs, value_mm, tolerance, anchor, sign) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        candidate.id,
        sketchId,
        label,
        resolved,
        JSON.stringify(refs),
        value ?? null,
        tolerance ? JSON.stringify(tolerance) : null,
        candidate.anchor ? JSON.stringify(candidate.anchor) : null,
        candidate.sign ?? 1,
      ],
    );
    await db.query('UPDATE sketches SET constraint_counters = constraint_counters || $2::jsonb WHERE id = $1', [
      sketchId,
      JSON.stringify({ [resolved]: (sketch.row.constraintCounters[resolved] ?? 0) + 1 }),
    ]);
    const analysis = analyzeSketch(solved, [...sketch.constraints, candidate]);
    return { extra: { constraint: constraintJson(candidate, analysis) }, analysis };
  });
}

export async function updateConstraint(member: MemberRow, sketchId: string, constraintId: string, input: unknown) {
  const body = objectBody(input);
  return changeSketch(member, sketchId, body['base_revision'], async ({ db, sketch, v }) => {
    const current = sketch.constraints.find((c) => c.id === constraintId);
    if (!current) throw notFound();
    const { value, tolerance } = parseDimension(v, current.kind, body, member.units, false);
    v.done();
    const next: StoredConstraint = {
      ...current,
      ...('value' in body && isDimension(current.kind) ? { value } : {}),
      ...('tolerance' in body && isDimension(current.kind) ? { tolerance: tolerance ?? undefined } : {}),
    };
    if (next.tolerance === undefined) delete next.tolerance;
    const constraints = sketch.constraints.map((c) => (c.id === constraintId ? next : c));
    const solved = solveWith(sketch.entities, constraints, constraintId);
    if (!solved) throw unsolvable();
    await writeGeometry(db, sketch.entities, solved);
    await db.query('UPDATE constraints SET value_mm = $2, tolerance = $3 WHERE id = $1', [
      constraintId,
      next.value ?? null,
      next.tolerance ? JSON.stringify(next.tolerance) : null,
    ]);
    const analysis = analyzeSketch(solved, constraints);
    return { extra: { constraint: constraintJson(next, analysis) }, analysis };
  });
}

export async function deleteConstraint(member: MemberRow, sketchId: string, constraintId: string, base: unknown) {
  return changeSketch(member, sketchId, base, async ({ db, sketch, v }) => {
    if (!sketch.constraints.some((c) => c.id === constraintId)) throw notFound();
    v.done();
    const constraints = sketch.constraints.filter((c) => c.id !== constraintId);
    await mustStayFullyHeld(db, sketch, sketch.entities, constraints);
    await db.query('DELETE FROM constraints WHERE id = $1', [constraintId]);
    return { extra: {} };
  });
}
