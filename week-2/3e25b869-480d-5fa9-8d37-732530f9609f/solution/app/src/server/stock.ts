// Stock on hand: derived once from the stock ledger and the active holds, the same on every surface.
import type pg from 'pg';
import { type BatchState } from '../shared/catalog.js';
import { BAR_CENTS, money, type Money } from '../shared/money.js';
import { addDays, localMinute } from '../shared/toronto.js';
import { type Db } from './db.js';

/** A hold is active while the server's time is strictly before its expires_at. `now` is the request's instant parameter. */
export const ACTIVE_HOLD = (alias: string, now: string) => `${alias}.status = 'active' AND ${alias}.expires_at > ${now}`;

/** The hold's state at `now`: an active hold at or past its edge reads as expired. */
export const HOLD_STATUS = (alias: string, now: string) =>
  `CASE WHEN ${alias}.status = 'active' AND NOT (${ACTIVE_HOLD(alias, now)}) THEN 'expired' ELSE ${alias}.status END`;

export type BarStatus = 'available' | 'held' | 'sold';

export interface BatchRow {
  code: string;
  scent: string;
  poured_on: string;
  cure_days: number;
  state: BatchState;
  drop_at: Date | null;
}

export interface Stock {
  bars_cut: number;
  available: number;
  held: number;
  sold: number;
  bars: { number: number; status: BarStatus }[];
  holds: { bar: number; expires_at: Date }[];
}

interface PublicBatch {
  code: string;
  scent: string;
  state: BatchState;
  bars_cut: number;
  available: number;
  held: number;
  sold: number;
  bars: { number: number; status: BarStatus }[];
  unit_price: Money;
  cure_date: string;
  drop_at: string | null;
  drop_at_local: string | null;
}

export const cureDate = (b: Pick<BatchRow, 'poured_on' | 'cure_days'>) => addDays(b.poured_on, b.cure_days);

/** Counts and per-bar status for each batch code. */
export async function stockOf(db: Db | pg.Pool, codes: string[], now: Date): Promise<Map<string, Stock>> {
  const movements = (await db.query<{ batch_code: string; kind: string; bars: number[] }>('SELECT batch_code, kind, bars FROM movements WHERE batch_code = ANY($1) ORDER BY id',
    [codes],
  )).rows;
  const holds = (await db.query<{ batch_code: string; bar: number; expires_at: Date }>(`SELECT h.batch_code, h.bar, h.expires_at FROM holds h WHERE h.batch_code = ANY($1) AND ${ACTIVE_HOLD('h', '$2')} ORDER BY h.bar`,
    [codes, now],
  )).rows;
  const out = new Map<string, Stock>();
  for (const code of codes) {
    let cut = 0;
    const latest = new Map<number, string>();
    for (const move of movements.filter((mv) => mv.batch_code === code)) {
      if (move.kind === 'cut') cut += move.bars.length;
      else for (const bar of move.bars) latest.set(bar, move.kind);
    }
    const batchHolds = holds.filter((h) => h.batch_code === code);
    const heldBars = new Set(batchHolds.map((h) => h.bar));
    const bars = Array.from({ length: cut }, (_, i) => {
      const number = i + 1;
      const status: BarStatus = latest.get(number) === 'sale' ? 'sold' : heldBars.has(number) ? 'held' : 'available';
      return { number, status };
    });
    const sold = bars.filter((b) => b.status === 'sold').length;
    const held = batchHolds.length;
    out.set(code, {
      bars_cut: cut,
      sold,
      held,
      available: cut - sold - held,
      bars,
      holds: batchHolds.map((h) => ({ bar: h.bar, expires_at: h.expires_at })),
    });
  }
  return out;
}

export function publicBatch(batch: BatchRow, stock: Stock): PublicBatch {
  return {
    code: batch.code,
    scent: batch.scent,
    state: batch.state,
    bars_cut: stock.bars_cut,
    available: stock.available,
    held: stock.held,
    sold: stock.sold,
    bars: stock.bars,
    unit_price: money(BAR_CENTS),
    cure_date: cureDate(batch),
    drop_at: batch.drop_at ? batch.drop_at.toISOString() : null,
    drop_at_local: batch.drop_at ? localMinute(batch.drop_at) : null,
  };
}
