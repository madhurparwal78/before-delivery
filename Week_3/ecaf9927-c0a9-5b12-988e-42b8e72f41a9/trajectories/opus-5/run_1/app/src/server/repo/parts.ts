import {
  CONSTRAINT_LABEL_WORD,
  ENTITY_LABEL_WORD,
  type BodyStatus,
  type ConfirmedFigures,
  type Constraint,
  type ConstraintKind,
  type Direction,
  type Entity,
  type EntityGeometry,
  type EntityType,
  type Feature,
  type Operation,
  type Part,
  type Plane,
  type Sketch,
  type SketchSummary,
} from '../../shared/api.js';
import type { Tolerance } from '../../shared/units.js';
import type { Db } from '../db.js';
import { pool } from '../db.js';
import {
  pointRefOf,
  pointSlots,
  solveSketch,
  type SolvedSketch,
  type SolverConstraint,
  type SolverEntity,
} from '../solver/sketch.js';
import { findMaterial } from './workspace.js';
import { WORKSPACE_ID } from './workspace.js';

export type PartRecord = {
  id: string;
  name: string;
  material_id: string;
  revision: number;
  saved_by: string;
  body_status: BodyStatus;
  body_build: number | null;
  next_build: number;
  next_sketch_seq: number;
  next_feature_seq: number;
  confirmed: ConfirmedFigures | null;
};

export type SketchRecord = {
  id: string;
  part_id: string;
  name: string;
  plane: Plane;
  offset_mm: number;
  revision: number;
  saved_by: string;
};

export type EntityRecord = { id: string; label: string; geometry: EntityGeometry };

export type ConstraintRecord = {
  id: string;
  label: string;
  kind: ConstraintKind;
  refs: string[];
  value_mm: number | null;
  tolerance: Tolerance | null;
  fix_at: { x: number; y: number } | null;
};

export type FeatureRecord = {
  id: string;
  part_id: string;
  name: string;
  sketch_id: string;
  operation: Operation;
  depth_mm: number;
  direction: Direction;
};

const PART_COLUMNS = `id, name, material_id, revision, saved_by, body_status, body_build,
  next_build, next_sketch_seq, next_feature_seq, confirmed`;

export async function listPartRecords(db: Db = pool): Promise<PartRecord[]> {
  const { rows } = await db.query<PartRecord>(
    `select ${PART_COLUMNS} from parts where workspace_id = $1 order by name`,
    [WORKSPACE_ID],
  );
  return rows;
}

export async function findPartRecord(db: Db, id: string): Promise<PartRecord | null> {
  const { rows } = await db.query<PartRecord>(
    `select ${PART_COLUMNS} from parts where workspace_id = $1 and id = $2`,
    [WORKSPACE_ID, id],
  );
  return rows[0] ?? null;
}

export async function lockPartRecord(db: Db, id: string): Promise<PartRecord | null> {
  const { rows } = await db.query<PartRecord>(
    `select ${PART_COLUMNS} from parts where workspace_id = $1 and id = $2 for update`,
    [WORKSPACE_ID, id],
  );
  return rows[0] ?? null;
}

export async function findSketchRecord(db: Db, id: string): Promise<SketchRecord | null> {
  const { rows } = await db.query<SketchRecord>(
    `select s.id, s.part_id, s.name, s.plane, s.offset_mm, s.revision, s.saved_by
       from sketches s join parts p on p.id = s.part_id
      where p.workspace_id = $1 and s.id = $2`,
    [WORKSPACE_ID, id],
  );
  return rows[0] ?? null;
}

export async function lockSketchRecord(db: Db, id: string): Promise<SketchRecord | null> {
  const { rows } = await db.query<SketchRecord>(
    `select s.id, s.part_id, s.name, s.plane, s.offset_mm, s.revision, s.saved_by
       from sketches s join parts p on p.id = s.part_id
      where p.workspace_id = $1 and s.id = $2
      for update of s`,
    [WORKSPACE_ID, id],
  );
  return rows[0] ?? null;
}

export async function listSketchRecords(db: Db, partId: string): Promise<SketchRecord[]> {
  const { rows } = await db.query<SketchRecord>(
    `select id, part_id, name, plane, offset_mm, revision, saved_by
       from sketches where part_id = $1 order by ord`,
    [partId],
  );
  return rows;
}

export async function listEntityRecords(db: Db, sketchId: string): Promise<EntityRecord[]> {
  const { rows } = await db.query<EntityRecord>(
    'select id, label, geometry from sketch_entities where sketch_id = $1 order by ord',
    [sketchId],
  );
  return rows;
}

export async function listConstraintRecords(db: Db, sketchId: string): Promise<ConstraintRecord[]> {
  const { rows } = await db.query<ConstraintRecord>(
    `select id, label, kind, refs, value_mm, tolerance, fix_at
       from sketch_constraints where sketch_id = $1 order by ord`,
    [sketchId],
  );
  return rows;
}

export async function listFeatureRecords(db: Db, partId: string): Promise<FeatureRecord[]> {
  const { rows } = await db.query<FeatureRecord>(
    `select id, part_id, name, sketch_id, operation, depth_mm, direction
       from features where part_id = $1 order by ord`,
    [partId],
  );
  return rows;
}

export async function listFeaturesUsingSketch(db: Db, sketchId: string): Promise<FeatureRecord[]> {
  const { rows } = await db.query<FeatureRecord>(
    `select id, part_id, name, sketch_id, operation, depth_mm, direction
       from features where sketch_id = $1 order by ord`,
    [sketchId],
  );
  return rows;
}

export function toSolverEntities(records: EntityRecord[]): SolverEntity[] {
  return records.map((record) => ({
    id: record.id,
    type: record.geometry.type,
    geometry: record.geometry,
  }));
}

export function toSolverConstraints(records: ConstraintRecord[]): SolverConstraint[] {
  return records.map((record) => ({
    id: record.id,
    kind: record.kind,
    refs: record.refs,
    valueMm: record.value_mm,
    fixAt: record.fix_at,
  }));
}

/** Stored sketches are always solvable, because nothing unsolvable is ever written. */
export function solveStored(
  entities: EntityRecord[],
  constraints: ConstraintRecord[],
): SolvedSketch {
  return solveSketch(toSolverEntities(entities), toSolverConstraints(constraints)) as SolvedSketch;
}

export function pointNameOf(entities: EntityRecord[], ref: string): string {
  const dot = ref.lastIndexOf('.');
  const entityId = dot < 0 ? ref : ref.slice(0, dot);
  const part = dot < 0 ? 'self' : ref.slice(dot + 1);
  const entity = entities.find((candidate) => candidate.id === entityId);
  const label = entity ? entity.label : ref;
  if (part === 'self') return label;
  if (part === 'center') return `${label} centre`;
  return `${label} ${part}`;
}

export function toEntityResource(record: EntityRecord, geometry: EntityGeometry): Entity {
  return { id: record.id, label: record.label, ...geometry };
}

function toConstraintResource(record: ConstraintRecord, redundant: boolean): Constraint {
  const constraint: Constraint = {
    id: record.id,
    label: record.label,
    kind: record.kind,
    refs: record.refs,
    redundant,
  };
  if (record.value_mm !== null) constraint.value_mm = record.value_mm;
  if (record.tolerance !== null) constraint.tolerance = record.tolerance;
  return constraint;
}

export async function toSketchResource(db: Db, record: SketchRecord): Promise<Sketch> {
  const entities = await listEntityRecords(db, record.id);
  const constraints = await listConstraintRecords(db, record.id);
  const solved = solveStored(entities, constraints);
  const drives = (await listFeaturesUsingSketch(db, record.id)).map((feature) => feature.id);
  return {
    id: record.id,
    part_id: record.part_id,
    name: record.name,
    plane: record.plane,
    offset_mm: record.offset_mm,
    revision: record.revision,
    slack: solved.slack,
    fully_held: solved.slack === 0,
    drives,
    entities: entities.map((entity) =>
      toEntityResource(entity, solved.geometry.get(entity.id) as EntityGeometry),
    ),
    constraints: constraints.map((constraint) =>
      toConstraintResource(constraint, solved.redundant.has(constraint.id)),
    ),
    points: pointSlots(toSolverEntities(entities)).map((slot) => {
      const ref = pointRefOf(slot);
      const geometry = solved.geometry.get(slot.entityId) as EntityGeometry;
      return {
        ref,
        name: pointNameOf(entities, ref),
        ...pointPosition(geometry, slot.part),
        freedom: solved.freedoms.get(ref) ?? 0,
      };
    }),
  };
}

function pointPosition(
  geometry: EntityGeometry,
  part: 'self' | 'start' | 'end' | 'center',
): { x: number; y: number } {
  if (geometry.type === 'point') return { x: geometry.x, y: geometry.y };
  if (geometry.type === 'line') {
    return part === 'start' ? geometry.start : geometry.end;
  }
  if (geometry.type === 'circle') return geometry.center;
  if (part === 'center') return geometry.center;
  const angle =
    ((part === 'start' ? geometry.start_angle_deg : geometry.end_angle_deg) * Math.PI) / 180;
  return {
    x: geometry.center.x + geometry.radius * Math.cos(angle),
    y: geometry.center.y + geometry.radius * Math.sin(angle),
  };
}

export async function toSketchSummary(db: Db, record: SketchRecord): Promise<SketchSummary> {
  const entities = await listEntityRecords(db, record.id);
  const constraints = await listConstraintRecords(db, record.id);
  const solved = solveStored(entities, constraints);
  return {
    id: record.id,
    name: record.name,
    plane: record.plane,
    offset_mm: record.offset_mm,
    revision: record.revision,
    slack: solved.slack,
    fully_held: solved.slack === 0,
  };
}

function toFeatureResource(record: FeatureRecord): Feature {
  return {
    id: record.id,
    name: record.name,
    sketch_id: record.sketch_id,
    operation: record.operation,
    depth_mm: record.depth_mm,
    direction: record.direction,
  };
}

export async function toPartResource(db: Db, record: PartRecord): Promise<Part> {
  const material = await findMaterial(db, record.material_id);
  const sketchRecords = await listSketchRecords(db, record.id);
  const sketches: SketchSummary[] = [];
  for (const sketch of sketchRecords) sketches.push(await toSketchSummary(db, sketch));
  const features = await listFeatureRecords(db, record.id);
  return {
    id: record.id,
    name: record.name,
    revision: record.revision,
    material: material as NonNullable<typeof material>,
    sketches,
    features: features.map(toFeatureResource),
    body: { status: record.body_status, build: record.body_build },
    confirmed: record.confirmed,
  };
}

export { toFeatureResource };

/** Label numbers are per sketch and per kind, and are never reused after a delete. */
export async function nextLabelNumber(
  db: Db,
  sketchId: string,
  kind: EntityType | ConstraintKind,
): Promise<number> {
  const { rows } = await db.query<{ value: number }>(
    `insert into label_counters (sketch_id, kind, next) values ($1, $2, 2)
     on conflict (sketch_id, kind) do update set next = label_counters.next + 1
     returning next - 1 as value`,
    [sketchId, kind],
  );
  return (rows[0] as { value: number }).value;
}

export async function peekLabelNumber(
  db: Db,
  sketchId: string,
  kind: EntityType | ConstraintKind,
): Promise<number> {
  const { rows } = await db.query<{ next: number }>(
    'select next from label_counters where sketch_id = $1 and kind = $2',
    [sketchId, kind],
  );
  return rows[0]?.next ?? 1;
}

export function entityLabel(type: EntityType, number: number): string {
  return `${ENTITY_LABEL_WORD[type]} ${number}`;
}

export function constraintLabel(kind: ConstraintKind, number: number): string {
  return `${CONSTRAINT_LABEL_WORD[kind]} ${number}`;
}
