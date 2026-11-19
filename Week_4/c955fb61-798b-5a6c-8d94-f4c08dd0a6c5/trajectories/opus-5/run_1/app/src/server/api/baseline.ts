import { query } from '../db.js';
import type { Schedule } from '../domain/schedule.js';

/** Store every task's and milestone's shown dates and the project finish under a name. */
export async function saveBaselineRows(
  projectId: string,
  name: string,
  schedule: Schedule,
): Promise<void> {
  await query('DELETE FROM baseline_items WHERE project_id = $1', [projectId]);
  await query('DELETE FROM baselines WHERE project_id = $1', [projectId]);
  await query('INSERT INTO baselines (project_id, name, finish) VALUES ($1, $2, $3)', [
    projectId,
    name,
    schedule.finish,
  ]);
  for (const item of schedule.items) {
    if (item.kind === 'group' || item.start === null || item.end === null) continue;
    await query(
      'INSERT INTO baseline_items (project_id, item_id, start_date, end_date) VALUES ($1, $2, $3, $4)',
      [projectId, item.id, item.start, item.end],
    );
  }
}
