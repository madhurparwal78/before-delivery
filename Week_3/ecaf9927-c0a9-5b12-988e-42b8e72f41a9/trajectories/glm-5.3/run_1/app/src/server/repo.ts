import type { Pool, PoolClient } from "pg";
import type {
  Bom,
  Constraint,
  Material,
  Part,
  PurchasedPart,
  Sketch,
  SketchEntity,
  SketchPoint,
  Tolerance
} from "../shared/types.js";
import { analyzeSketch, sketchPoints, type StoredConstraint } from "./sketchService.js";

/** Loading records and shaping them into the API's resource shapes. */

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: "founder" | "engineer";
  units: "mm" | "in";
  precision: number;
}

export interface MaterialRow {
  id: string;
  name: string;
  density_g_cm3: number;
}

export interface PartRow {
  id: string;
  name: string;
  material_id: string;
  revision: number;
  body_status: "none" | "saving" | "stored" | "not_stored";
  body_build: number | null;
  confirmed_build: number | null;
  confirmed_object_key: string | null;
  confirmed_volume_mm3: number | null;
  confirmed_area_mm2: number | null;
  confirmed_centroid_x: number | null;
  confirmed_centroid_y: number | null;
  confirmed_centroid_z: number | null;
  confirmed_mass_g: number | null;
  next_sketch_number: number;
  next_feature_number: number;
  seeded: boolean;
  last_saved_by: string | null;
}

export interface SketchRow {
  id: string;
  part_id: string;
  name: string;
  plane: "top" | "front" | "right";
  offset_mm: number;
  revision: number;
  slack: number;
  entity_counters: Record<string, number>;
  constraint_counters: Record<string, number>;
  last_saved_by: string | null;
}

export interface EntityRow {
  id: string;
  sketch_id: string;
  type: "point" | "line" | "circle" | "arc";
  label: string;
  number: number;
  geometry: Record<string, unknown>;
}

export interface ConstraintRow {
  id: string;
  sketch_id: string;
  kind: Constraint["kind"];
  label: string;
  number: number;
  refs: string[];
  value_mm: number | null;
  tolerance: Tolerance | null;
  redundant: boolean;
  created_at: Date;
}

export interface FeatureRow {
  id: string;
  part_id: string;
  sketch_id: string;
  name: string;
  operation: "new" | "join" | "cut" | "intersect";
  depth_mm: number;
  direction: "normal" | "reverse" | "symmetric";
  number: number;
}

export async function materialOf(client: Pool | PoolClient, id: string): Promise<Material | null> {
  const result = await client.query<MaterialRow>("SELECT id, name, density_g_cm3 FROM materials WHERE id = $1", [id]);
  const row = result.rows[0];
  return row ? { id: row.id, name: row.name, density_g_cm3: row.density_g_cm3 } : null;
}

export function entityFromRow(row: EntityRow): SketchEntity {
  const g = row.geometry;
  switch (row.type) {
    case "point":
      return { id: row.id, label: row.label, type: "point", x: g.x as number, y: g.y as number };
    case "line":
      return {
        id: row.id,
        label: row.label,
        type: "line",
        start: { x: (g.start as { x: number }).x, y: (g.start as { y: number }).y },
        end: { x: (g.end as { x: number }).x, y: (g.end as { y: number }).y }
      };
    case "circle":
      return {
        id: row.id,
        label: row.label,
        type: "circle",
        center: { x: (g.center as { x: number }).x, y: (g.center as { y: number }).y },
        radius: g.radius as number
      };
    case "arc":
      return {
        id: row.id,
        label: row.label,
        type: "arc",
        center: { x: (g.center as { x: number }).x, y: (g.center as { y: number }).y },
        radius: g.radius as number,
        start_angle_deg: g.start_angle_deg as number,
        end_angle_deg: g.end_angle_deg as number
      };
  }
}

export function storedConstraintOf(row: ConstraintRow, entities: SketchEntity[]): StoredConstraint {
  const fixTargets = new Map<string, { x: number; y: number }>();
  if (row.kind === "fix") {
    for (const ref of row.refs) {
      const entity = entities.find((e) => e.id === ref);
      if (entity?.type === "point") fixTargets.set(ref, { x: entity.x, y: entity.y });
      if (entity?.type === "line") fixTargets.set(ref, { x: entity.start.x, y: entity.start.y });
      if (entity?.type === "circle" || entity?.type === "arc") fixTargets.set(ref, { x: entity.center.x, y: entity.center.y });
    }
  }
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    refs: row.refs,
    value_mm: row.value_mm ?? undefined,
    tolerance: row.tolerance,
    redundant: row.redundant,
    fixTargets,
    createdAt: row.created_at
  };
}

export async function sketchEntities(client: Pool | PoolClient, sketchId: string): Promise<SketchEntity[]> {
  const rows = await client.query<EntityRow>(
    "SELECT id, sketch_id, type, label, number, geometry FROM entities WHERE sketch_id = $1 ORDER BY created_at, id",
    [sketchId]
  );
  return rows.rows.map(entityFromRow);
}

export async function sketchConstraints(client: Pool | PoolClient, sketchId: string, entities: SketchEntity[]): Promise<StoredConstraint[]> {
  const rows = await client.query<ConstraintRow>(
    `SELECT id, sketch_id, kind, label, number, refs, value_mm, tolerance, redundant, created_at
     FROM constraints WHERE sketch_id = $1 ORDER BY created_at, id`,
    [sketchId]
  );
  return rows.rows.map((r) => storedConstraintOf({ ...r, refs: r.refs as unknown as string[] }, entities));
}

export function constraintToJson(c: StoredConstraint): Constraint {
  return {
    id: c.id,
    label: c.label,
    kind: c.kind,
    refs: c.refs,
    value_mm: c.value_mm,
    tolerance: c.tolerance ?? null,
    redundant: c.redundant
  };
}

export function sketchToJson(
  row: SketchRow,
  entities: SketchEntity[],
  stored: StoredConstraint[],
  drives: string[]
): Sketch {
  const analysis = analyzeSketch(entities, stored);
  const points: SketchPoint[] = sketchPoints(entities, analysis);
  for (const c of stored) {
    c.redundant = analysis.redundant.get(c.id) ?? false;
  }
  return {
    id: row.id,
    part_id: row.part_id,
    name: row.name,
    plane: row.plane,
    offset_mm: row.offset_mm,
    revision: row.revision,
    slack: analysis.slack,
    fully_held: analysis.fullyHeld,
    drives,
    entities,
    constraints: stored.map(constraintToJson),
    points
  };
}

export function partToJson(
  row: PartRow,
  material: Material,
  sketches: SketchRow[],
  features: FeatureRow[],
  slackBySketch: Map<string, { slack: number; fully_held: boolean }>
): Part {
  return {
    id: row.id,
    name: row.name,
    revision: row.revision,
    material,
    sketches: sketches.map((s) => ({
      id: s.id,
      name: s.name,
      plane: s.plane,
      offset_mm: s.offset_mm,
      revision: s.revision,
      slack: slackBySketch.get(s.id)?.slack ?? s.slack,
      fully_held: slackBySketch.get(s.id)?.fully_held ?? s.slack === 0
    })),
    features: features.map((f) => ({
      id: f.id,
      name: f.name,
      sketch_id: f.sketch_id,
      operation: f.operation,
      depth_mm: f.depth_mm,
      direction: f.direction
    })),
    body: { status: row.body_status, build: row.body_build },
    confirmed: row.confirmed_build === null ? null : {
      build: row.confirmed_build,
      object_key: row.confirmed_object_key ?? "",
      volume_mm3: row.confirmed_volume_mm3 ?? 0,
      area_mm2: row.confirmed_area_mm2 ?? 0,
      centroid_mm: {
        x: row.confirmed_centroid_x ?? 0,
        y: row.confirmed_centroid_y ?? 0,
        z: row.confirmed_centroid_z ?? 0
      },
      mass_g: row.confirmed_mass_g ?? 0
    }
  };
}

export async function loadPart(client: Pool | PoolClient, partId: string): Promise<{
  part: PartRow;
  sketches: SketchRow[];
  features: FeatureRow[];
  material: Material;
} | null> {
  const partResult = await client.query<PartRow>(
    `SELECT id, name, material_id, revision, body_status, body_build, confirmed_build,
            confirmed_object_key, confirmed_volume_mm3, confirmed_area_mm2,
            confirmed_centroid_x, confirmed_centroid_y, confirmed_centroid_z, confirmed_mass_g,
            next_sketch_number, next_feature_number, seeded, last_saved_by
     FROM parts WHERE id = $1`,
    [partId]
  );
  const part = partResult.rows[0];
  if (!part) return null;
  const material = await materialOf(client, part.material_id);
  if (!material) return null;
  const sketches = (
    await client.query<SketchRow>(
      `SELECT id, part_id, name, plane, offset_mm, revision, slack, entity_counters, constraint_counters, last_saved_by
       FROM sketches WHERE part_id = $1 ORDER BY created_at, id`,
      [partId]
    )
  ).rows.map((s) => ({ ...s, entity_counters: s.entity_counters ?? {}, constraint_counters: s.constraint_counters ?? {} }));
  const features = (
    await client.query<FeatureRow>(
      `SELECT id, part_id, sketch_id, name, operation, depth_mm, direction, number
       FROM features WHERE part_id = $1 ORDER BY number`,
      [partId]
    )
  ).rows;
  return { part, sketches, features, material };
}

export async function loadSketch(client: Pool | PoolClient, sketchId: string): Promise<{
  sketch: SketchRow;
  entities: SketchEntity[];
  constraints: StoredConstraint[];
  part: PartRow;
} | null> {
  const sketchResult = await client.query<SketchRow>(
    `SELECT id, part_id, name, plane, offset_mm, revision, slack, entity_counters, constraint_counters, last_saved_by
     FROM sketches WHERE id = $1`,
    [sketchId]
  );
  const sketch = sketchResult.rows[0];
  if (!sketch) return null;
  const partResult = await client.query<PartRow>(
    `SELECT id, name, material_id, revision, body_status, body_build, confirmed_build,
            confirmed_object_key, confirmed_volume_mm3, confirmed_area_mm2,
            confirmed_centroid_x, confirmed_centroid_y, confirmed_centroid_z, confirmed_mass_g,
            next_sketch_number, next_feature_number, seeded, last_saved_by
     FROM parts WHERE id = $1`,
    [sketch.part_id]
  );
  const part = partResult.rows[0];
  if (!part) return null;
  const entities = await sketchEntities(client, sketchId);
  const constraints = await sketchConstraints(client, sketchId, entities);
  return { sketch, entities, constraints, part };
}

export function purchasedToJson(row: { id: string; name: string; declared_mass_g: number; revision: number }): PurchasedPart {
  return { id: row.id, name: row.name, declared_mass_g: row.declared_mass_g, revision: row.revision };
}

export function bomToJson(bom: Bom): Bom {
  return bom;
}
