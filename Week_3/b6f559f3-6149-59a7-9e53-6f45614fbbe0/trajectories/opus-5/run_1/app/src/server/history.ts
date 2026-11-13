import { query, queryOne } from './db';
import { config } from './config';
import type { Change } from './ops';
import type { JsonValue } from '../shared/types';

export interface HistoryRow {
  id: string;
  scene_id: string;
  inverse: JsonValue;
  forward: JsonValue;
}

export async function nextSeq(projectId: string): Promise<number> {
  const row = await queryOne<{ seq: number | null }>(
    `SELECT MAX(seq) AS seq FROM op_history WHERE project_id = $1`,
    [projectId],
  );
  return (row?.seq ?? 0) + 1;
}

export async function recordOp(
  projectId: string,
  personId: string,
  opId: string,
  sceneId: string,
  seq: number,
  forward: Change[],
  inverse: Change[],
  now: Date,
): Promise<void> {
  await query(`DELETE FROM op_history WHERE project_id = $1 AND person_id = $2 AND undone = true`, [
    projectId,
    personId,
  ]);
  await query(
    `INSERT INTO op_history (project_id, person_id, op_id, scene_id, seq, inverse, forward, undone, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8)`,
    [
      projectId,
      personId,
      opId,
      sceneId,
      seq,
      JSON.stringify(inverse),
      JSON.stringify(forward),
      now.toISOString(),
    ],
  );
  await query(
    `DELETE FROM op_history WHERE id IN (
       SELECT id FROM op_history WHERE project_id = $1 AND person_id = $2 AND undone = false
       ORDER BY id DESC OFFSET $3
     )`,
    [projectId, personId, config.undoLimit],
  );
}

export async function depths(
  projectId: string,
  personId: string,
): Promise<{ undoDepth: number; redoDepth: number }> {
  const rows = await query<{ undone: boolean; count: string }>(
    `SELECT undone, COUNT(*)::text AS count FROM op_history
     WHERE project_id = $1 AND person_id = $2 GROUP BY undone`,
    [projectId, personId],
  );
  const countFor = (undone: boolean): number =>
    Number(rows.find((row) => row.undone === undone)?.count ?? '0');
  return { undoDepth: countFor(false), redoDepth: countFor(true) };
}

export async function nextUndo(projectId: string, personId: string): Promise<HistoryRow | null> {
  return queryOne<HistoryRow>(
    `SELECT id::text AS id, scene_id, inverse, forward FROM op_history
     WHERE project_id = $1 AND person_id = $2 AND undone = false
     ORDER BY id DESC LIMIT 1`,
    [projectId, personId],
  );
}

export async function nextRedo(projectId: string, personId: string): Promise<HistoryRow | null> {
  return queryOne<HistoryRow>(
    `SELECT id::text AS id, scene_id, inverse, forward FROM op_history
     WHERE project_id = $1 AND person_id = $2 AND undone = true
     ORDER BY id ASC LIMIT 1`,
    [projectId, personId],
  );
}

export async function markUndone(
  id: string,
  undone: boolean,
  forward: Change[],
  inverse: Change[],
): Promise<void> {
  await query(`UPDATE op_history SET undone = $2, forward = $3, inverse = $4 WHERE id = $1`, [
    id,
    undone,
    JSON.stringify(forward),
    JSON.stringify(inverse),
  ]);
}
