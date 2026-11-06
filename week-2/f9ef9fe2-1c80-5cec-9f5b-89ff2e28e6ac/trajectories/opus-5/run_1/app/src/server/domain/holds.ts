import type { Cell, Hold, HoldState, Quote } from '../../shared/types.js';
import { minutesToHHMM } from '../../shared/format.js';
import { query, queryOne, type Sql } from '../db/pool.js';
import { kitchenMinutes } from './time.js';
import type { CellRef } from './pricing.js';

export interface HoldRow {
  id: string;
  kitchen_id: string;
  member_id: string;
  date: string;
  state: 'held' | 'released' | 'confirmed';
  created_at: Date;
  expires_at: Date;
}

/**
 * The hold liveness edge: a hold is live while the server clock is strictly
 * before its expiry. At or after it, the hold reads as expired.
 */
export function holdState(row: HoldRow, now: Date): HoldState {
  if (row.state !== 'held') return row.state;
  return now.getTime() < row.expires_at.getTime() ? 'held' : 'expired';
}

/** The same edge, for queries that must only see live holds. */
export function liveHoldSql(alias: string, nowParam: string): string {
  return `${alias}.state = 'held' AND ${alias}.expires_at > ${nowParam}`;
}

export async function loadHold(client: Sql, holdId: string): Promise<HoldRow | null> {
  return queryOne<HoldRow>(
    client,
    `SELECT id, kitchen_id, member_id, date, state, created_at, expires_at
       FROM holds WHERE id = $1`,
    [holdId],
  );
}

export async function loadHoldForUpdate(client: Sql, holdId: string): Promise<HoldRow | null> {
  return queryOne<HoldRow>(
    client,
    `SELECT id, kitchen_id, member_id, date, state, created_at, expires_at
       FROM holds WHERE id = $1 FOR UPDATE`,
    [holdId],
  );
}

export async function loadHoldCells(client: Sql, holdId: string): Promise<CellRef[]> {
  return query<{ station_id: string; start_minute: number }>(
    client,
    'SELECT station_id, start_minute FROM hold_cells WHERE hold_id = $1 ORDER BY start_minute, station_id',
    [holdId],
  );
}

export function holdView(
  row: HoldRow,
  cells: readonly CellRef[],
  quote: Quote,
  timezone: string,
  now: Date,
): Hold {
  const cellViews: Cell[] = cells.map((cell) => ({
    station_id: cell.station_id,
    start: minutesToHHMM(cell.start_minute),
  }));
  return {
    id: row.id,
    member_id: row.member_id,
    date: row.date,
    state: holdState(row, now),
    cells: cellViews,
    expires_at: row.expires_at.toISOString(),
    expires_local: minutesToHHMM(kitchenMinutes(timezone, row.expires_at)),
    server_now: now.toISOString(),
    quote,
  };
}
