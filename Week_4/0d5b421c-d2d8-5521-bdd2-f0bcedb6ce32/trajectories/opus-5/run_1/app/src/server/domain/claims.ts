import { query, type Db } from '../db';
import { claimKey } from '../services/valkey';
import { lisbonDate, lisbonTime } from '../time';
import type { Unit } from './floor';
import { coveredSlots, type TurnWindow } from './rules';

/** One Valkey key per table per quarter-hour slot the turn window covers. */
export function claimKeysFor(unit: Unit, window: TurnWindow): string[] {
  const keys: string[] = [];
  for (const instant of coveredSlots(window)) {
    const date = lisbonDate(instant);
    const time = lisbonTime(instant);
    for (const tableId of unit.tableIds) {
      keys.push(claimKey(tableId, date, time));
    }
  }
  return keys;
}

/** Records that a table has been freed, so the waitlist rule runs for it. */
export async function enqueueFreedTables(
  db: Db,
  date: string,
  tableIds: readonly string[],
): Promise<void> {
  for (const tableId of tableIds) {
    await query(db, 'insert into freed_tables(date, table_id) values ($1, $2)', [date, tableId]);
  }
}
