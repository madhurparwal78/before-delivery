import type { PoolClient } from 'pg';
import { plateFor } from '../shared/copy.js';
import type { BoxState } from '../shared/types.js';
import { query } from './db.js';
import { boxTransitionAllowed, publicBoxState } from './domain.js';
import { fail } from './errors.js';
import { alertMaker } from './services/alerts.js';
import * as search from './services/search.js';
import { liveHoldNumbers, valkeyUp } from './services/valkey.js';
import { publishBoxState } from './sse.js';

interface BoxRow {
  number: number;
  state: BoxState;
}

export async function storedBoxStates(): Promise<Map<number, BoxState>> {
  const rows = await query<BoxRow>('SELECT number, state FROM boxes ORDER BY number');
  return new Map(rows.map((row) => [row.number, row.state]));
}

/**
 * Box states as the shelf shows them: Postgres, with `held` confirmed live
 * against Valkey so a lapsed hold reads as available at once.
 */
export async function liveBoxStates(): Promise<Map<number, BoxState>> {
  const stored = await storedBoxStates();
  if (!valkeyUp()) return stored;
  const live = await liveHoldNumbers().catch(() => null);
  if (live === null) return stored;
  for (const [number, state] of stored) {
    if (state === 'held' && !live.has(number)) stored.set(number, 'available');
  }
  return stored;
}

export async function storedBoxState(number: number): Promise<BoxState | null> {
  const rows = await query<BoxRow>('SELECT number, state FROM boxes WHERE number = $1', [number]);
  return rows[0]?.state ?? null;
}

type Executor = Pick<PoolClient, 'query'>;

/** The one place a box changes state. */
export async function moveBox(
  executor: Executor,
  number: number,
  from: BoxState,
  to: BoxState,
): Promise<void> {
  if (!boxTransitionAllowed(from, to)) throw fail(409, 'illegal_transition');
  const result = await executor.query(
    'UPDATE boxes SET state = $2, updated_at = now() WHERE number = $1 AND state = $3',
    [number, to, from],
  );
  if (result.rowCount === 0) throw fail(409, 'illegal_transition');
}

export function announceBox(number: number, state: BoxState): void {
  publishBoxState(number, publicBoxState(state));
}

export async function remainingStock(): Promise<number> {
  const rows = await query<{ count: string }>(
    "SELECT count(*)::text AS count FROM boxes WHERE state IN ('available','held')",
  );
  return Number(rows[0]?.count ?? '0');
}

/** One alert per downward crossing; the threshold rearms when stock rises. */
export async function checkStockThresholds(): Promise<void> {
  const remaining = await remainingStock();
  const rows = await query<{ threshold: number; armed: boolean }>(
    'SELECT threshold, armed FROM stock_thresholds ORDER BY threshold DESC',
  );
  for (const row of rows) {
    if (remaining <= row.threshold && row.armed) {
      await query('UPDATE stock_thresholds SET armed = false WHERE threshold = $1', [row.threshold]);
      await alertMaker('Low stock', `${remaining} boxes remain.`);
    } else if (remaining > row.threshold && !row.armed) {
      await query('UPDATE stock_thresholds SET armed = true WHERE threshold = $1', [row.threshold]);
    }
  }
}

interface SearchRow {
  number: number;
  state: BoxState;
  recipient_name: string | null;
  reference: string | null;
}

async function searchRows(numbers: number[]): Promise<SearchRow[]> {
  return query<SearchRow>(
    `SELECT b.number,
            b.state,
            CASE WHEN o.reference IS NULL THEN NULL
                 WHEN o.is_gift THEN o.recipient_name ELSE o.buyer_name END AS recipient_name,
            o.reference
       FROM boxes b
       LEFT JOIN orders o ON o.box_number = b.number AND o.live_claim
      WHERE b.number = ANY($1::int[])`,
    [numbers],
  );
}

/** Keeps both indexes in step; missed changes wait in the backlog. */
export async function syncSearch(numbers: number[]): Promise<void> {
  if (numbers.length === 0) return;
  const rows = await searchRows(numbers);
  const onShelf = rows.filter((row) => row.state === 'available' || row.state === 'held');
  const offShelf = rows.filter((row) => row.state !== 'available' && row.state !== 'held');
  try {
    if (onShelf.length > 0) {
      await search.putPublicBoxes(
        onShelf.map((row) => ({
          id: `box-${row.number}`,
          kind: 'box' as const,
          number: row.number,
          plate: plateFor(row.number),
        })),
      );
    }
    if (offShelf.length > 0) {
      await search.removePublicBoxes(offShelf.map((row) => row.number));
    }
    await search.putStaffBoxes(
      rows.map((row) => ({
        id: `box-${row.number}`,
        number: row.number,
        plate: plateFor(row.number),
        state: row.state,
        recipientName: row.recipient_name,
        reference: row.reference,
      })),
    );
    await query('DELETE FROM search_backlog WHERE box_number = ANY($1::int[])', [numbers]);
  } catch {
    for (const number of numbers) {
      await query(
        'INSERT INTO search_backlog (box_number) VALUES ($1) ON CONFLICT (box_number) DO NOTHING',
        [number],
      );
    }
  }
}

export async function drainSearchBacklog(): Promise<void> {
  const rows = await query<{ box_number: number }>('SELECT box_number FROM search_backlog LIMIT 240');
  if (rows.length === 0) return;
  await syncSearch(rows.map((row) => row.box_number));
}
