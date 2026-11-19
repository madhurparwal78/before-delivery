import type { Extract, ExtractStateName } from '../../shared/model.ts';
import type { App } from '../http/app.ts';
import { memberIds } from '../projects/access.ts';

export interface ExtractRow {
  source_id: string;
  state: ExtractStateName;
  last_success_at: Date | null;
  last_failure_at: Date | null;
  last_run_at: Date | null;
  snapshot_id: string;
  rows: number;
  schedule_every: number | null;
  schedule_kind: 'full' | 'incremental' | null;
  schedule_key: string | null;
  schedule_saved_at: Date | null;
  forced_failures: number;
}

export function getExtractRow(app: App, sourceId: string): Promise<ExtractRow | null> {
  return app.db.row<ExtractRow>(`SELECT * FROM extracts WHERE source_id = $1`, [sourceId]);
}

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

/**
 * A refresh is due `every` after the later of the last attempt's start and the schedule's save time
 * (so saving a schedule starts its clock). Null when there is no schedule.
 */
export function nextRunAt(row: ExtractRow): Date | null {
  if (row.schedule_every === null) return null;
  const anchor = Math.max(row.last_run_at?.getTime() ?? 0, row.schedule_saved_at?.getTime() ?? 0);
  return new Date(anchor + row.schedule_every * 60000);
}

export function isStale(row: ExtractRow, nowMs: number, staleMs: number): boolean {
  return row.last_success_at !== null && nowMs - row.last_success_at.getTime() >= staleMs;
}

export function extractOf(app: App, row: ExtractRow): Extract {
  return {
    state: row.state,
    stale: isStale(row, app.clock.nowMs(), app.config.staleMs),
    last_success_at: iso(row.last_success_at),
    last_failure_at: iso(row.last_failure_at),
    next_run_at: iso(nextRunAt(row)),
    rows: row.rows,
  };
}

/** What the stale ticker last told people, so it speaks only when staleness flips. */
export const staleSeen = new Map<string, boolean>();

export function extractEvent(app: App, row: ExtractRow): Record<string, unknown> {
  const { rows: _rows, ...fields } = extractOf(app, row);
  staleSeen.set(row.source_id, fields.stale);
  return { source: row.source_id, ...fields };
}

/** Pushes the source's extract state to every member of its project. */
export async function publishExtract(app: App, sourceId: string): Promise<void> {
  const row = await getExtractRow(app, sourceId);
  const owner = await app.db.row<{ project_id: string }>(`SELECT project_id FROM sources WHERE id = $1`, [sourceId]);
  if (!row || !owner) return;
  app.events.toUsers(await memberIds(app, owner.project_id), 'extract', extractEvent(app, row));
}
