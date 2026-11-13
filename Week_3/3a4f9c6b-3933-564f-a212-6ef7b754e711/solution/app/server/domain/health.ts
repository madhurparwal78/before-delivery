// Health rows, the in-sync counter and the stage's current revision (brief: Agent reports, counters and phases).
import type { Counter, HealthRow, StageHealth } from "../../shared/api.js";
import type { Db, Tx } from "../db.js";

/** The in-sync counter: rows both Synced and Healthy, out of all rows of the promotion. */
export async function counters(db: Db, promotionIds: string[]): Promise<Map<string, Counter>> {
  const { rows } = await db.query<{ promotion_id: string } & Counter>(
    `SELECT promotion_id, count(*) FILTER (WHERE sync = 'Synced' AND health = 'Healthy')::int AS in_sync, count(*)::int AS total
       FROM health_rows WHERE promotion_id = ANY($1) GROUP BY promotion_id`, [promotionIds]);
  return new Map(rows.map((r) => [r.promotion_id, { in_sync: r.in_sync, total: r.total }]));
}

/** The current revision of each stage: its latest promotion to have entered applying. */
export async function currentRevisions(db: Db, stageIds: string[]): Promise<Map<string, string>> {
  const { rows } = await db.query<{ stage_id: string; id: string }>(
    `SELECT DISTINCT ON (stage_id) stage_id, id FROM promotions
      WHERE stage_id = ANY($1) AND entered_applying_at IS NOT NULL
      ORDER BY stage_id, entered_applying_at DESC, requested_at DESC`, [stageIds]);
  return new Map(rows.map((r) => [r.stage_id, r.id]));
}

/** One OutOfSync / Progressing row per bundle resource, created when a promotion enters applying. */
export async function createHealthRows(tx: Tx, promotionId: string, bundleId: string, at: Date): Promise<void> {
  await tx.query(
    `INSERT INTO health_rows (promotion_id, ref, kind, namespace, name, position, sync, health, updated_at)
     SELECT $1, r->>'ref', r->>'kind', r->>'namespace', r->>'name', (o - 1)::int, 'OutOfSync', 'Progressing', $3
       FROM bundles b, jsonb_array_elements(b.resources) WITH ORDINALITY AS t(r, o) WHERE b.id = $2`,
    [promotionId, bundleId, at]);
}

export async function stageHealth(db: Db, stageId: string): Promise<StageHealth> {
  const revision = (await currentRevisions(db, [stageId])).get(stageId) ?? null;
  if (!revision) return { revision: null, in_sync: 0, total: 0, resources: [] };
  const [{ rows }, counted] = await Promise.all([
    db.query<Omit<HealthRow, "updated_at"> & { updated_at: Date }>(
      "SELECT ref, kind, namespace, name, sync, health, updated_at FROM health_rows WHERE promotion_id = $1 ORDER BY position", [revision]),
    counters(db, [revision]),
  ]);
  return { revision, ...(counted.get(revision) as Counter), resources: rows.map((r) => ({ ...r, updated_at: r.updated_at.toISOString() })) };
}
