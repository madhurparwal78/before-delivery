import type { PoolClient } from "pg";
import type { SketchEntity } from "../shared/types.js";
import { buildBody, extrudeRange, meshBodyOf, profileOf, shapeOf, type BuildRefusal, type ExtrudeShape } from "../shared/geometry.js";
import { BodyStore, objectKey } from "./storage.js";
import type { MeshBody, Operation } from "../shared/types.js";

/**
 * The single place where the part body state transitions are decided.
 *
 *   none      --first extrude accepted-->       saving
 *   none      --any other save-->               none
 *   stored    --any part save-->                saving
 *   not_stored --any part save-->               saving
 *   saving    --storage confirms the write-->   stored (confirmed replaced)
 *   saving    --storage refuses or times out--> not_stored (confirmed untouched)
 */

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
  seeded: boolean;
}

export interface FeatureRow {
  id: string;
  sketch_id: string;
  operation: "new" | "join" | "cut" | "intersect";
  depth_mm: number;
  direction: "normal" | "reverse" | "symmetric";
}

export interface SketchRow {
  id: string;
  plane: "top" | "front" | "right";
  offset_mm: number;
}

/** Build the extrude shapes of a part in order; null shapes are skipped. */
export function shapesOfPart(
  features: FeatureRow[],
  sketches: SketchRow[],
  entitiesBySketch: Map<string, SketchEntity[]>
): ExtrudeShape[] {
  const shapes: ExtrudeShape[] = [];
  for (const feature of features) {
    const sketch = sketches.find((s) => s.id === feature.sketch_id);
    const entities = entitiesBySketch.get(feature.sketch_id) ?? [];
    const profile = profileOf(entities);
    if ("error" in profile) continue;
    const [t0, t1] = extrudeRange(feature.direction, feature.depth_mm);
    shapes.push(
      shapeOf(sketch!.plane, sketch!.offset_mm, feature.direction, feature.depth_mm, profile.profile.rings, feature.operation)
    );
    void t0;
    void t1;
  }
  return shapes;
}

export interface BuildOutcome {
  ok: boolean;
  refusal: BuildRefusal | null;
  refusedOperation: Operation | null;
  mesh: MeshBody | null;
  volume: number;
  area: number;
  centroid: { x: number; y: number; z: number };
}

/** The pure geometry pass: build the body, or report the refusal. */
export function buildPartBody(partId: string, shapes: ExtrudeShape[], nextBuild: number): BuildOutcome {
  const result = buildBody(shapes);
  if (!result.ok) {
    return { ok: false, refusal: result.refusal, refusedOperation: result.refusedOperation, mesh: null, volume: 0, area: 0, centroid: { x: 0, y: 0, z: 0 } };
  }
  return {
    ok: true,
    refusal: null,
    refusedOperation: null,
    mesh: meshBodyOf(partId, nextBuild, result.mesh),
    volume: result.volume,
    area: result.area,
    centroid: { x: result.centroid[0], y: result.centroid[1], z: result.centroid[2] }
  };
}

/**
 * One part save: take the next build number, write the body object, and
 * settle the status. Must run inside the part's save transaction, after the
 * caller has verified the build succeeds.
 */
export async function attemptBodyWrite(
  client: PoolClient,
  store: BodyStore,
  partId: string,
  build: BuildOutcome,
  massG: number
): Promise<PartRow> {
  const part = (
    await client.query<PartRow>(
      `SELECT id, name, material_id, revision, body_status, body_build, confirmed_build,
              confirmed_object_key, confirmed_volume_mm3, confirmed_area_mm2,
              confirmed_centroid_x, confirmed_centroid_y, confirmed_centroid_z, confirmed_mass_g, seeded
       FROM parts WHERE id = $1 FOR UPDATE`,
      [partId]
    )
  ).rows[0]!;
  const featureCount = (
    await client.query<{ count: string }>("SELECT count(*)::text AS count FROM features WHERE part_id = $1", [partId])
  ).rows[0]!;

  if (Number(featureCount.count) === 0) {
    if (part.body_status === "none") {
      // Nothing to build: the part keeps its status and figures.
      return part;
    }
  }

  const nextBuild = (part.body_build ?? 0) + 1;
  const key = objectKey(partId, nextBuild);
  const stored = await store.putBody(key, JSON.stringify(build.mesh));
  const status = stored ? "stored" : "not_stored";
  const newer =
    stored && (part.confirmed_build === null || nextBuild > part.confirmed_build);
  await client.query(
    `UPDATE parts SET body_status = $1, body_build = $2,
       confirmed_build = CASE WHEN $3 THEN $2 ELSE confirmed_build END,
       confirmed_object_key = CASE WHEN $3 THEN $4 ELSE confirmed_object_key END,
       confirmed_volume_mm3 = CASE WHEN $3 THEN $5 ELSE confirmed_volume_mm3 END,
       confirmed_area_mm2 = CASE WHEN $3 THEN $6 ELSE confirmed_area_mm2 END,
       confirmed_centroid_x = CASE WHEN $3 THEN $7 ELSE confirmed_centroid_x END,
       confirmed_centroid_y = CASE WHEN $3 THEN $8 ELSE confirmed_centroid_y END,
       confirmed_centroid_z = CASE WHEN $3 THEN $9 ELSE confirmed_centroid_z END,
       confirmed_mass_g = CASE WHEN $3 THEN $10 ELSE confirmed_mass_g END
     WHERE id = $11`,
    stored && newer
      ? [
          status,
          nextBuild,
          true,
          key,
          build.volume,
          build.area,
          build.centroid.x,
          build.centroid.y,
          build.centroid.z,
          massG,
          partId
        ]
      : [status, nextBuild, false, null, null, null, null, null, null, null, partId]
  );
  const updated = (
    await client.query<PartRow>(
      `SELECT id, name, material_id, revision, body_status, body_build, confirmed_build,
              confirmed_object_key, confirmed_volume_mm3, confirmed_area_mm2,
              confirmed_centroid_x, confirmed_centroid_y, confirmed_centroid_z, confirmed_mass_g, seeded
       FROM parts WHERE id = $1`,
      [partId]
    )
  ).rows[0]!;
  return updated;
}
