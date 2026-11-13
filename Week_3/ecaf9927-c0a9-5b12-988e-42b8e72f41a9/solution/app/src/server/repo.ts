import type {
  BodyStatus,
  Confirmed,
  Constraint,
  ConstraintKind,
  Entity,
  Feature,
  Material,
  Member,
  Part,
  Plane,
  Sketch,
  SketchPoint,
  SketchSummary,
  Tolerance,
} from '../shared/api';
import { SketchVariables, pointRefs, type Analysis } from './geometry/solver';
import { analyzeSketch, type StoredConstraint } from './geometry/constraints';
import { notFound } from './errors';
import type { Queryable } from './db';

export interface MemberRow extends Member {
  passwordHash: string;
}

export interface PartRow {
  id: string;
  name: string;
  revision: number;
  savedBy: string;
  materialId: string;
  nextSketch: number;
  nextFeature: number;
  buildCounter: number;
  bodyStatus: BodyStatus;
  confirmed: Confirmed | null;
}

interface SketchRow {
  id: string;
  partId: string;
  name: string;
  plane: Plane;
  offsetMm: number;
  revision: number;
  savedBy: string;
  entityCounters: Record<string, number>;
  constraintCounters: Record<string, number>;
}

export interface LoadedSketch {
  row: SketchRow;
  entities: Entity[];
  constraints: StoredConstraint[];
}

interface MemberDb { id: string; name: string; email: string; role: Member['role']; units: Member['units']; precision: number; password_hash: string }
interface MaterialDb { id: string; name: string; density_g_cm3: number }
interface PartDb {
  id: string; name: string; revision: number; saved_by: string; material_id: string; next_sketch: number;
  next_feature: number; build_counter: number; body_status: BodyStatus; confirmed: Confirmed | null;
}
interface SketchDb {
  id: string; part_id: string; name: string; plane: Plane; offset_mm: number; revision: number; saved_by: string;
  entity_counters: Record<string, number>; constraint_counters: Record<string, number>;
}
interface EntityDb { id: string; label: string; geometry: object }
interface ConstraintDb {
  id: string; label: string; kind: ConstraintKind; refs: string[]; value_mm: number | null; tolerance: Tolerance | null;
  anchor: { x: number; y: number } | null; sign: 1 | -1;
}
interface FeatureDb { id: string; name: string; sketch_id: string; operation: Feature['operation']; depth_mm: number; direction: Feature['direction'] }
interface IdDb { id: string }
interface NameDb { id: string; name: string }

const first = <T>(rows: T[]): T | undefined => rows[0];

export async function memberById(q: Queryable, id: string): Promise<MemberRow | undefined> {
  const { rows } = await q.query<MemberDb>('SELECT * FROM members WHERE id = $1', [id]);
  const r = first(rows);
  return r && { id: r.id, name: r.name, email: r.email, role: r.role, units: r.units, precision: r.precision, passwordHash: r.password_hash };
}

export const memberJson = ({ passwordHash: _hash, ...member }: MemberRow): Member => member;

export async function materials(q: Queryable): Promise<Material[]> {
  const { rows } = await q.query<MaterialDb>('SELECT id, name, density_g_cm3 FROM materials ORDER BY name');
  return rows.map((r) => ({ id: r.id, name: r.name, density_g_cm3: r.density_g_cm3 }));
}

const partFromRow = (r: PartDb): PartRow => ({
  id: r.id,
  name: r.name,
  revision: r.revision,
  savedBy: r.saved_by,
  materialId: r.material_id,
  nextSketch: r.next_sketch,
  nextFeature: r.next_feature,
  buildCounter: r.build_counter,
  bodyStatus: r.body_status,
  confirmed: r.confirmed,
});

export async function partRow(q: Queryable, id: string, lock = false): Promise<PartRow> {
  const { rows } = await q.query<PartDb>(`SELECT * FROM parts WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  const r = first(rows);
  if (!r) throw notFound();
  return partFromRow(r);
}

const sketchFromRow = (r: SketchDb): SketchRow => ({
  id: r.id,
  partId: r.part_id,
  name: r.name,
  plane: r.plane,
  offsetMm: r.offset_mm,
  revision: r.revision,
  savedBy: r.saved_by,
  entityCounters: r.entity_counters,
  constraintCounters: r.constraint_counters,
});

export async function sketchRow(q: Queryable, id: string, lock = false): Promise<SketchRow> {
  const { rows } = await q.query<SketchDb>(`SELECT * FROM sketches WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  const r = first(rows);
  if (!r) throw notFound();
  return sketchFromRow(r);
}

function entityFromRow(r: EntityDb): Entity {
  return { id: r.id, label: r.label, ...r.geometry } as Entity;
}

function constraintFromRow(r: ConstraintDb): StoredConstraint {
  return {
    id: r.id,
    label: r.label,
    kind: r.kind,
    refs: r.refs,
    ...(r.value_mm === null ? {} : { value: r.value_mm }),
    ...(r.tolerance ? { tolerance: r.tolerance } : {}),
    ...(r.anchor ? { anchor: r.anchor } : {}),
    sign: r.sign,
  };
}

export async function loadSketch(q: Queryable, id: string, lock = false): Promise<LoadedSketch> {
  const row = await sketchRow(q, id, lock);
  const entities = await q.query<EntityDb>('SELECT * FROM entities WHERE sketch_id = $1 ORDER BY seq', [id]);
  const constraints = await q.query<ConstraintDb>('SELECT * FROM constraints WHERE sketch_id = $1 ORDER BY seq', [id]);
  return { row, entities: entities.rows.map(entityFromRow), constraints: constraints.rows.map(constraintFromRow) };
}

const memo = new Map<string, Analysis>();

function remember(key: string, analysis: Analysis): void {
  memo.set(key, analysis);
  if (memo.size > 2000) memo.delete(memo.keys().next().value as string);
}

/** A change that already analysed the sketch it produced hands the result over so the read after it need not repeat the work. */
export function rememberAnalysis(sketchId: string, revision: number, analysis: Analysis): void {
  remember(`${sketchId}@${revision}`, analysis);
}

/** Slack, redundancy and point freedom are derived from geometry and constraints, so they are computed on read (once per revision). */
export function analysisOf(sketch: LoadedSketch): Analysis {
  const key = `${sketch.row.id}@${sketch.row.revision}`;
  let analysis = memo.get(key);
  if (!analysis) {
    analysis = analyzeSketch(sketch.entities, sketch.constraints);
    remember(key, analysis);
  }
  return analysis;
}

const POINT_WORDS = { start: 'start', end: 'end', center: 'centre' } as const;

function pointName(entity: Entity, ref: string): string {
  const part = ref.split('.')[1] as keyof typeof POINT_WORDS | undefined;
  return part ? `${entity.label} ${POINT_WORDS[part]}` : entity.label;
}

function sketchSummary(sketch: LoadedSketch): SketchSummary {
  const { slack } = analysisOf(sketch);
  return {
    id: sketch.row.id,
    name: sketch.row.name,
    plane: sketch.row.plane,
    offset_mm: sketch.row.offsetMm,
    revision: sketch.row.revision,
    slack,
    fully_held: slack === 0,
  };
}

export function constraintJson(c: StoredConstraint, analysis: Analysis): Constraint {
  return {
    id: c.id,
    label: c.label,
    kind: c.kind,
    refs: c.refs,
    ...(c.value === undefined ? {} : { value_mm: c.value }),
    ...(c.tolerance ? { tolerance: c.tolerance } : {}),
    redundant: analysis.redundant.has(c.id),
  };
}

function sketchJson(sketch: LoadedSketch, drives: string[]): Sketch {
  const analysis = analysisOf(sketch);
  const vars = new SketchVariables(sketch.entities);
  const points: SketchPoint[] = sketch.entities.flatMap((entity) =>
    pointRefs(entity).flatMap((ref) => {
      const p = vars.point(ref, vars.values);
      return p ? [{ ref, name: pointName(entity, ref), x: p.x, y: p.y, freedom: analysis.freedom.get(ref) ?? 2 }] : [];
    }),
  );
  return {
    id: sketch.row.id,
    part_id: sketch.row.partId,
    name: sketch.row.name,
    plane: sketch.row.plane,
    offset_mm: sketch.row.offsetMm,
    revision: sketch.row.revision,
    slack: analysis.slack,
    fully_held: analysis.slack === 0,
    drives,
    entities: sketch.entities,
    constraints: sketch.constraints.map((c) => constraintJson(c, analysis)),
    points,
  };
}

export async function featuresOf(q: Queryable, partId: string): Promise<Feature[]> {
  const { rows } = await q.query<FeatureDb>('SELECT * FROM features WHERE part_id = $1 ORDER BY seq', [partId]);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sketch_id: r.sketch_id,
    operation: r.operation,
    depth_mm: r.depth_mm,
    direction: r.direction,
  }));
}

async function sketchesOfPart(q: Queryable, partId: string): Promise<LoadedSketch[]> {
  const { rows } = await q.query<IdDb>('SELECT id FROM sketches WHERE part_id = $1 ORDER BY seq', [partId]);
  const sketches: LoadedSketch[] = [];
  for (const r of rows) sketches.push(await loadSketch(q, r.id));
  return sketches;
}

export async function materialById(q: Queryable, id: string): Promise<Material | undefined> {
  const { rows } = await q.query<MaterialDb>('SELECT id, name, density_g_cm3 FROM materials WHERE id = $1', [id]);
  const r = first(rows);
  return r && { id: r.id, name: r.name, density_g_cm3: r.density_g_cm3 };
}

export async function partJson(q: Queryable, id: string): Promise<Part> {
  const row = await partRow(q, id);
  const sketches = await sketchesOfPart(q, id);
  const features = await featuresOf(q, id);
  const material = await materialById(q, row.materialId);
  return {
    id: row.id,
    name: row.name,
    revision: row.revision,
    material: material as Material,
    sketches: sketches.map(sketchSummary),
    features,
    body: { status: row.bodyStatus, build: row.buildCounter === 0 ? null : row.buildCounter },
    confirmed: row.confirmed,
  };
}

export async function allPartIds(q: Queryable): Promise<string[]> {
  const { rows } = await q.query<IdDb>('SELECT id FROM parts ORDER BY lower(name)');
  return rows.map((r) => r.id);
}

/** The ids of the features a sketch drives. */
export async function drivenBy(q: Queryable, sketchId: string): Promise<{ id: string; name: string }[]> {
  const { rows } = await q.query<NameDb>('SELECT id, name FROM features WHERE sketch_id = $1 ORDER BY seq', [sketchId]);
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

export async function sketchViewJson(q: Queryable, id: string): Promise<Sketch> {
  const loaded = await loadSketch(q, id);
  return sketchJson(loaded, (await drivenBy(q, id)).map((f) => f.id));
}

export async function memberName(q: Queryable, id: string): Promise<{ id: string; name: string }> {
  const { rows } = await q.query<NameDb>('SELECT id, name FROM members WHERE id = $1', [id]);
  const r = first(rows) as NameDb;
  return { id: r.id, name: r.name };
}
