import type { PoolClient } from 'pg';
import { one } from '../db/pool.js';
import { fail } from '../errors.js';
import { etagOf } from '../http/conditional.js';
import { seatCount } from '../../shared/domain.js';
import type { TableState } from '../../shared/types.js';
import type { TableRow } from './games.js';

/** The table lifecycle, in one place. */

export const loadTable = (id: string): Promise<TableRow | null> =>
  one<TableRow>('SELECT * FROM game_tables WHERE id = $1', [id]);

export const tableEtag = (table: TableRow): string => etagOf('table', table.id, table.revision);

/** Takes the table's row lock so that seats, moves and the cascade serialise. */
export async function lockTable(client: PoolClient, id: string): Promise<TableRow> {
  const rows = await client.query<TableRow>(
    'SELECT * FROM game_tables WHERE id = $1 FOR UPDATE',
    [id],
  );
  const row = rows.rows[0];
  if (row === undefined) throw fail('not_found');
  return row;
}

async function takenSeats(client: PoolClient, tableId: string): Promise<number[]> {
  const rows = await client.query<{ seat: number }>(
    'SELECT seat FROM seats WHERE table_id = $1 ORDER BY seat',
    [tableId],
  );
  return rows.rows.map((row) => row.seat);
}

/** A seat request gets the lowest free seat. */
export function lowestFreeSeat(game: TableRow['game'], taken: readonly number[]): number | null {
  for (let seat = 1; seat <= seatCount(game); seat += 1) {
    if (!taken.includes(seat)) return seat;
  }
  return null;
}

/** The published refusal for Start game in each state it is not allowed in. */
export function checkCanStart(state: TableState): void {
  if (state === 'open') throw fail('table_not_full');
  if (state === 'in_play') throw fail('game_in_play');
  if (state === 'finished') throw fail('not_settled');
  if (state === 'settled') throw fail('rematch_required');
}

export function checkCanMove(state: TableState): void {
  if (state !== 'in_play') throw fail('game_not_in_play');
}

export function checkCanStandUp(state: TableState): void {
  if (state === 'in_play') throw fail('game_in_play');
  if (state === 'finished') throw fail('not_settled');
}

export function checkCanRematch(state: TableState): void {
  if (state !== 'settled') throw fail('not_settled');
}

/** Moves the table back to its seat-count state after someone stands up. */
export async function restateAfterSeatChange(
  client: PoolClient,
  table: TableRow,
): Promise<TableState> {
  const taken = await takenSeats(client, table.id);
  const next: TableState = taken.length === seatCount(table.game) ? 'seated' : 'open';
  await client.query(
    'UPDATE game_tables SET state = $2, game_id = NULL, revision = revision + 1 WHERE id = $1',
    [table.id, next],
  );
  await client.query('DELETE FROM rematch_offers WHERE table_id = $1', [table.id]);
  return next;
}

export async function markSeated(client: PoolClient, table: TableRow): Promise<TableState> {
  const taken = await takenSeats(client, table.id);
  const next: TableState = taken.length === seatCount(table.game) ? 'seated' : 'open';
  await client.query('UPDATE game_tables SET state = $2, revision = revision + 1 WHERE id = $1', [
    table.id,
    next,
  ]);
  return next;
}

