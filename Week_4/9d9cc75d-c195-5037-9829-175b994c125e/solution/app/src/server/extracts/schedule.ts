import type { Schedule } from '../../shared/model.ts';
import type { App } from '../http/app.ts';
import { invalid } from '../http/errors.ts';
import { getFields } from '../sources/repo.ts';
import type { ExtractRow } from './state.ts';
import { getExtractRow, nextRunAt, publishExtract } from './state.ts';

const EVERY_MESSAGE = 'Every minutes must be a whole number from 1 to 10080.';
const KEY_MESSAGE = 'Incremental refresh needs a number or date key.';
const MAX_EVERY = 10080;

/** The schedule as the API shows it (the key by its field's current name), or null. */
export async function scheduleOf(app: App, row: ExtractRow): Promise<Schedule | null> {
  if (row.schedule_every === null || row.schedule_kind === null) return null;
  const key = row.schedule_key && (await getFields(app.db, row.source_id)).find((f) => f.id === row.schedule_key);
  return {
    every_minutes: row.schedule_every,
    kind: row.schedule_kind,
    key: key ? key.name : null,
    next_run_at: nextRunAt(row)?.toISOString() ?? null,
  };
}

/** Saves a schedule; saving starts its clock. An incremental schedule needs a number or date key field. */
export async function saveSchedule(app: App, sourceId: string, body: Record<string, unknown>): Promise<Schedule | null> {
  const errors: Record<string, string> = {};
  const every = body.every_minutes;
  const everyOk = typeof every === 'number' && Number.isInteger(every) && every >= 1 && every <= MAX_EVERY;
  if (!everyOk) errors.every_minutes = EVERY_MESSAGE;
  const kind = body.kind === 'full' || body.kind === 'incremental' ? body.kind : null;
  let keyId: string | null = null;
  if (kind === 'incremental') {
    const key = (await getFields(app.db, sourceId)).find((f) => !f.dropped && f.name === body.key);
    if (!key || key.column === null || (key.type !== 'number' && key.type !== 'date')) errors.key = KEY_MESSAGE;
    else keyId = key.id;
  }
  if (!everyOk || kind === null || errors.key !== undefined) throw invalid(errors);
  await app.db.exec(
    `UPDATE extracts SET schedule_every = $2, schedule_kind = $3, schedule_key = $4, schedule_saved_at = $5
      WHERE source_id = $1`,
    [sourceId, every, kind, keyId, app.clock.now()],
  );
  await publishExtract(app, sourceId);
  const row = await getExtractRow(app, sourceId);
  return row && scheduleOf(app, row);
}

export async function deleteSchedule(app: App, sourceId: string): Promise<void> {
  await app.db.exec(
    `UPDATE extracts SET schedule_every = NULL, schedule_kind = NULL, schedule_key = NULL, schedule_saved_at = NULL
      WHERE source_id = $1`,
    [sourceId],
  );
  await publishExtract(app, sourceId);
}

/** The next `times` refreshes of the source fail (grading). */
export async function forceFailures(app: App, sourceId: string, times: number): Promise<void> {
  await app.db.exec(`UPDATE extracts SET forced_failures = $2 WHERE source_id = $1`, [sourceId, times]);
}
