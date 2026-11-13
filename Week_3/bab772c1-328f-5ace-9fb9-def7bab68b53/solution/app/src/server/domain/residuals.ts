/** Residuals: each sample's distance from the reference position interpolated at its UTC. */

import type { Queryable } from "../db/pool.js";
import type { Vector } from "../../shared/model.js";

type ResidualSample = {
  utc_ms: number;
  x_m: number;
  y_m: number;
  z_m: number;
};

/** The reference position at `utcMs`, interpolated linearly between bracketing vectors. */
function referencePositionAt(
  vectors: readonly Vector[],
  utcMs: number,
): { x: number; y: number; z: number } | null {
  if (vectors.length === 0) {
    return null;
  }
  if (utcMs < vectors[0].unix_ms || utcMs > vectors[vectors.length - 1].unix_ms) {
    return null;
  }
  let low = 0;
  let high = vectors.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (vectors[middle].unix_ms <= utcMs) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const before = vectors[low];
  const after = vectors[high];
  if (utcMs === before.unix_ms) {
    return { x: before.x_m, y: before.y_m, z: before.z_m };
  }
  if (utcMs === after.unix_ms) {
    return { x: after.x_m, y: after.y_m, z: after.z_m };
  }
  const span = after.unix_ms - before.unix_ms;
  const ratio = span === 0 ? 0 : (utcMs - before.unix_ms) / span;
  return {
    x: before.x_m + (after.x_m - before.x_m) * ratio,
    y: before.y_m + (after.y_m - before.y_m) * ratio,
    z: before.z_m + (after.z_m - before.z_m) * ratio,
  };
}

export function residualOf(
  vectors: readonly Vector[],
  sample: ResidualSample,
): number | null {
  const position = referencePositionAt(vectors, sample.utc_ms);
  if (!position) {
    return null;
  }
  return Math.hypot(position.x - sample.x_m, position.y - sample.y_m, position.z - sample.z_m);
}

export async function loadReferenceVectors(
  query: Queryable,
  missionId: string,
): Promise<Vector[]> {
  const result = await query.query<Vector>(
    `select unix_ms, x_m, y_m, z_m, vx_m_s, vy_m_s, vz_m_s from reference_vectors
     where mission_id = $1 order by unix_ms`,
    [missionId],
  );
  return result.rows;
}

/** Recomputes every residual of the mission from its stored vectors. */
export async function recomputeResiduals(
  tx: Queryable,
  missionId: string,
  ready: boolean,
): Promise<void> {
  if (!ready) {
    await tx.query("update samples set residual_m = null where mission_id = $1", [missionId]);
    return;
  }
  const vectors = await loadReferenceVectors(tx, missionId);
  const samples = await tx.query<{
    pass_id: string;
    line_no: number;
    utc_ms: number;
    x_m: number;
    y_m: number;
    z_m: number;
  }>(
    "select pass_id, line_no, utc_ms, x_m, y_m, z_m from samples where mission_id = $1",
    [missionId],
  );
  const passIds: string[] = [];
  const lineNumbers: number[] = [];
  const residuals: (number | null)[] = [];
  for (const sample of samples.rows) {
    passIds.push(sample.pass_id);
    lineNumbers.push(sample.line_no);
    residuals.push(residualOf(vectors, sample));
  }
  if (passIds.length === 0) {
    return;
  }
  await tx.query(
    `update samples set residual_m = source.residual
     from (select * from unnest($1::uuid[], $2::int[], $3::float8[])
           as t(pass_id, line_no, residual)) as source
     where samples.pass_id = source.pass_id and samples.line_no = source.line_no`,
    [passIds, lineNumbers, residuals],
  );
}
