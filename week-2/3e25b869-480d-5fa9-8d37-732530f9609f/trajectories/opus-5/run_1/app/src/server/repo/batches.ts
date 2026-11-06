import { BAR_PRICE_CENTS, money } from '../../shared/money.js';
import { addDays, torontoLocalStamp } from '../../shared/toronto.js';
import type { BarStatus, Batch, BatchState, StaffBatch } from '../../shared/types.js';
import { effectiveState } from '../domain/batches.js';
import { readStock, type StockCounts, type StockMovement } from '../domain/stock.js';
import type { Queryable } from '../db/pool.js';

export type BatchRow = {
  code: string;
  scent: string;
  state: BatchState;
  poured_on: string;
  cure_days: number;
  bars_cut: number | null;
  drop_at: Date | null;
};

export type ActiveHoldRow = {
  id: string;
  cart_id: string;
  batch_code: string;
  bar: number;
  expires_at: Date;
};

export type LoadedBatch = {
  row: BatchRow;
  state: BatchState;
  cureDate: string;
  counts: StockCounts;
  bars: { number: number; status: BarStatus }[];
  holds: ActiveHoldRow[];
};

const BATCH_COLUMNS = 'code, scent, state, poured_on, cure_days, bars_cut, drop_at';

export function cureDateOf(row: BatchRow): string {
  return addDays(row.poured_on, row.cure_days);
}

export async function loadBatches(
  client: Queryable,
  now: Date,
  codes: readonly string[] | null,
): Promise<LoadedBatch[]> {
  const batches = await client.query<BatchRow>(
    codes
      ? `SELECT ${BATCH_COLUMNS} FROM batches WHERE code = ANY($1) ORDER BY code`
      : `SELECT ${BATCH_COLUMNS} FROM batches ORDER BY code`,
    codes ? [codes] : [],
  );
  if (batches.rows.length === 0) return [];
  const wanted = batches.rows.map((row) => row.code);
  const movements = await client.query<{
    batch_code: string;
    kind: StockMovement['kind'];
    bars: number[];
  }>(`SELECT batch_code, kind, bars FROM stock_movements WHERE batch_code = ANY($1) ORDER BY id`, [
    wanted,
  ]);
  const holds = await client.query<ActiveHoldRow>(
    `SELECT id, cart_id, batch_code, bar, expires_at FROM holds
      WHERE batch_code = ANY($1) AND status = 'active' AND expires_at > $2
      ORDER BY bar`,
    [wanted, now],
  );
  return batches.rows.map((row) => {
    const batchMovements = movements.rows.filter((movement) => movement.batch_code === row.code);
    const batchHolds = holds.rows.filter((hold) => hold.batch_code === row.code);
    const stock = readStock(
      row.bars_cut ?? 0,
      batchMovements,
      new Set(batchHolds.map((hold) => hold.bar)),
    );
    const soldOut = row.bars_cut !== null && row.bars_cut > 0 && stock.counts.sold === row.bars_cut;
    return {
      row,
      state: effectiveState(row.state, row.drop_at, soldOut, now),
      cureDate: cureDateOf(row),
      counts: stock.counts,
      bars: stock.bars,
      holds: batchHolds,
    };
  });
}

export async function loadBatch(
  client: Queryable,
  now: Date,
  code: string,
): Promise<LoadedBatch | null> {
  const [batch] = await loadBatches(client, now, [code]);
  return batch ?? null;
}

export function publicBatch(batch: LoadedBatch): Batch {
  return {
    code: batch.row.code,
    scent: batch.row.scent,
    state: batch.state,
    bars_cut: batch.counts.cut,
    available: batch.counts.available,
    held: batch.counts.held,
    sold: batch.counts.sold,
    bars: batch.bars,
    unit_price: money(BAR_PRICE_CENTS),
    cure_date: batch.cureDate,
    drop_at: batch.row.drop_at === null ? null : batch.row.drop_at.toISOString(),
    drop_at_local: batch.row.drop_at === null ? null : torontoLocalStamp(batch.row.drop_at),
  };
}

export function staffBatch(batch: LoadedBatch): StaffBatch {
  return {
    ...publicBatch(batch),
    poured_on: batch.row.poured_on,
    cure_days: batch.row.cure_days,
    holds: batch.holds.map((hold) => ({
      bar: hold.bar,
      expires_at: hold.expires_at.toISOString(),
    })),
  };
}

export function byDropThenCode(left: LoadedBatch, right: LoadedBatch): number {
  const leftDrop = left.row.drop_at?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightDrop = right.row.drop_at?.getTime() ?? Number.POSITIVE_INFINITY;
  if (leftDrop !== rightDrop) return leftDrop - rightDrop;
  return left.row.code < right.row.code ? -1 : left.row.code > right.row.code ? 1 : 0;
}
