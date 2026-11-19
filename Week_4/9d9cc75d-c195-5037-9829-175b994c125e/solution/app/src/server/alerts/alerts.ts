// Alerts: a subscriber's threshold on one measure of a sheet. Each successful refresh of the sheet's source evaluates
// the measure on the subscriber's own rows.
import { formatNumber } from '../../shared/display.ts';
import type { MeasurePill, SheetShape } from '../../shared/model.ts';
import { newId } from '../db/ids.ts';
import type { App, AuthUser } from '../http/app.ts';
import { HttpError, invalid } from '../http/errors.ts';
import type { JsonObject } from '../http/validate.ts';
import { nonBlank } from '../http/validate.ts';
import { NAME_REQUIRED } from '../projects/routes.ts';
import { runQuery } from '../engine/index.ts';
import { mapShape } from '../sheets/refs.ts';
import type { RefMap } from '../sheets/refs.ts';
import { queryInput } from '../sheets/query.ts';
import { sheetScope } from '../sheets/scope.ts';
import { isMeasurePill, Malformed, measurePill } from '../sheets/shape.ts';
import { openSheet } from '../sheets/store.ts';
import type { SheetAccess } from '../sheets/store.ts';
import { addInboxItem } from './inbox.ts';

export const alertSchema = [
  `CREATE TABLE IF NOT EXISTS alerts (
     id text PRIMARY KEY,
     user_id text NOT NULL REFERENCES users(id),
     sheet_id text NOT NULL REFERENCES sheets(id),
     source_id text NOT NULL,
     name text NOT NULL,
     measure jsonb NOT NULL,
     above double precision NOT NULL,
     armed boolean NOT NULL DEFAULT true,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS alerts_source ON alerts (source_id)`,
];

const THRESHOLD_MESSAGE = 'Above must be a number.';
const MEASURE_MESSAGE = 'Measure is required.';

interface AlertBody {
  name: string;
  measure: MeasurePill;
  above: number;
}

interface Subscription {
  id: string;
  name: string;
  above: number;
  armed: true;
}

/** The fields of an alert request; every problem is reported together. */
export function alertBody(body: JsonObject): AlertBody {
  const errors: Record<string, string> = {};
  const name = nonBlank(body.name);
  if (name === null) errors.name = NAME_REQUIRED;
  const above = typeof body.above === 'number' && Number.isFinite(body.above) ? body.above : null;
  if (above === null) errors.above = THRESHOLD_MESSAGE;
  let measure: MeasurePill | null = null;
  try {
    measure = measurePill(body.measure, 'measure', MEASURE_MESSAGE);
  } catch (error) {
    if (!(error instanceof Malformed)) throw error;
    errors.measure = error.text;
  }
  if (name === null || above === null || measure === null) throw invalid(errors);
  return { name: name.trim(), measure, above };
}

/** The sheet shape that asks for one measure over the whole table, with the sheet's own filters. */
function wholeTable(sheet: SheetShape, measure: MeasurePill): SheetShape {
  return {
    ...sheet, rows: [], columns: [], color: null, size: null, label: [measure], detail: [], totals: false,
    reference_lines: [], trend: false, sort: {},
  };
}

/** The measure with its field names turned into ids (`stored`) or back into current names (`display`). */
function renamed(measure: MeasurePill, sheet: SheetShape, map: RefMap): MeasurePill {
  const [pill] = mapShape(wholeTable(sheet, measure), map).label;
  if (pill === undefined || !isMeasurePill(pill)) throw new Error('the measure pill did not survive renaming');
  return pill;
}

/** Subscribes `user` to a measure of a sheet they can open. The measure is stored by field ids so a rename carries. */
export async function subscribe(app: App, user: AuthUser, access: SheetAccess, body: AlertBody): Promise<Subscription> {
  const loaded = await sheetScope(app, access.workbook, access.sheet);
  const stored = renamed(body.measure, loaded.shape, loaded.maps.stored);
  const id = newId();
  await app.db.exec(
    `INSERT INTO alerts (id, user_id, sheet_id, source_id, name, measure, above, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, user.id, access.sheet.id, access.workbook.source_id, body.name, JSON.stringify(stored), body.above, app.clock.iso()],
  );
  return { id, name: body.name, above: body.above, armed: true };
}

interface AlertRow {
  id: string;
  user_id: string;
  username: string;
  sheet_id: string;
  name: string;
  measure: MeasurePill;
  above: number;
  armed: boolean;
}

/** The measure's value on the subscriber's rows, or null when the view is refused or holds no value. */
async function valueOf(app: App, row: AlertRow): Promise<number | null> {
  const user = { id: row.user_id, username: row.username };
  const access = await openSheet(app, user, row.sheet_id);
  const loaded = await sheetScope(app, access.workbook, access.sheet);
  const shape = wholeTable(loaded.shape, renamed(row.measure, loaded.shape, loaded.maps.display));
  const outcome = await runQuery(queryInput(app, user, loaded, shape, { filters: [], parameters: {}, sets: {} }));
  if (!outcome.ok) return null;
  const at = outcome.result.columns.findIndex((column) => column.role === 'measure');
  const value = outcome.result.rows[0]?.[at];
  return typeof value === 'number' ? value : null;
}

/** An alert above its threshold that is armed makes one inbox item and disarms; one at or below it rearms. */
async function evaluate(app: App, row: AlertRow): Promise<void> {
  const value = await valueOf(app, row);
  if (value === null) return;
  if (value <= row.above) {
    if (!row.armed) await app.db.exec(`UPDATE alerts SET armed = true WHERE id = $1`, [row.id]);
    return;
  }
  const disarmed = await app.db.exec(`UPDATE alerts SET armed = false WHERE id = $1 AND armed`, [row.id]);
  if (disarmed === 1) await addInboxItem(app, row.user_id, `${row.name} crossed ${formatNumber(row.above)}: now ${formatNumber(value)}.`);
}

/** Runs after every successful refresh of `sourceId`. An alert whose sheet its subscriber can no longer open is skipped. */
export async function evaluateAlerts(app: App, sourceId: string): Promise<void> {
  const rows = await app.db.rows<AlertRow>(
    `SELECT a.id, a.user_id, u.username, a.sheet_id, a.name, a.measure, a.above, a.armed
       FROM alerts a JOIN users u ON u.id = a.user_id WHERE a.source_id = $1 ORDER BY a.created_at, a.id`,
    [sourceId],
  );
  for (const row of rows) {
    try {
      await evaluate(app, row);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
    }
  }
}
