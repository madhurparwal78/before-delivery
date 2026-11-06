import { query, type Db } from '../db.js';
import type { WorkCode } from './cards.js';

/**
 * The effective price lookup. The list in force on a date is the one with the latest
 * effective date on or before it; the date the booking was made never matters.
 */
export interface PriceList {
  id: string;
  effectiveFrom: string;
  depositCents: number;
  prices: Record<WorkCode, number>;
}

export const WORK_CODES: readonly WorkCode[] = [
  'trim',
  'front_reset',
  'full_reset',
  'front_new',
  'full_new',
];

export const SERVICE_NAMES: Record<WorkCode, string> = {
  trim: 'Trim',
  front_reset: 'Front shoes, reset',
  full_reset: 'Full set, reset',
  front_new: 'Front shoes, new',
  full_new: 'Full set, new',
};

export function isWorkCode(value: unknown): value is WorkCode {
  return typeof value === 'string' && (WORK_CODES as readonly string[]).includes(value);
}

interface PriceListRow {
  id: string;
  effective_from: string;
  deposit_cents: number;
  trim_cents: number;
  front_reset_cents: number;
  full_reset_cents: number;
  front_new_cents: number;
  full_new_cents: number;
}

function toPriceList(row: PriceListRow): PriceList {
  return {
    id: row.id,
    effectiveFrom: row.effective_from,
    depositCents: row.deposit_cents,
    prices: {
      trim: row.trim_cents,
      front_reset: row.front_reset_cents,
      full_reset: row.full_reset_cents,
      front_new: row.front_new_cents,
      full_new: row.full_new_cents,
    },
  };
}

const SELECT = `
  SELECT id, to_char(effective_from,'YYYY-MM-DD') AS effective_from, deposit_cents,
         trim_cents, front_reset_cents, full_reset_cents, front_new_cents, full_new_cents
  FROM price_lists`;

export async function priceListInForce(db: Db, businessDate: string): Promise<PriceList | null> {
  const rows = await query<PriceListRow>(
    db,
    `${SELECT} WHERE effective_from <= $1::date ORDER BY effective_from DESC LIMIT 1`,
    [businessDate],
  );
  const row = rows[0];
  return row === undefined ? null : toPriceList(row);
}

export async function allPriceLists(db: Db): Promise<PriceList[]> {
  const rows = await query<PriceListRow>(db, `${SELECT} ORDER BY effective_from DESC`);
  return rows.map(toPriceList);
}

/** The deposit in force on a barn day's business date, 0 when no list covers it. */
export async function depositForDate(db: Db, businessDate: string): Promise<number> {
  const list = await priceListInForce(db, businessDate);
  return list === null ? 0 : list.depositCents;
}
