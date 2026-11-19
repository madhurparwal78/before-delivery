import { q, one } from '../db.js';
import { settings } from '../settings.js';
import { clockNow } from '../clock.js';
import { t, type ApiError } from '../errors.js';
import { clinicDateOf, clinicDateToUtcMidnight } from '../tz.js';
import * as bus from '../live.js';

// The one place that decides batch usability and first-expiry-first-out.
export function batchUsable(expiresOn: string, now: Date = clockNow()): boolean {
  // Usable through the end of expiresOn; expired from 00:00 the next clinic day.
  const midnightNext = clinicDateToUtcMidnight(nextDay(expiresOn));
  return now.getTime() < midnightNext.getTime();
}

export function nextDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export type BatchRow = { id: string; batch: string; expiresOn: string; receivedOrder: number };

// Draws quantity from usable batches FEFO. Returns per-batch draws in draw order.
// Ties on expiry are broken by the order batches were first received.
export function planDraw(
  batches: { id: string; batch: string; expiresOn: string; remaining: number; receivedOrder: number }[],
  quantity: number
): { batchId: string; batch: string; qty: number }[] | null {
  const usable = batches
    .filter((b) => batchUsable(b.expiresOn) && b.remaining > 0)
    .sort((a, b) => (a.expiresOn < b.expiresOn ? -1 : a.expiresOn > b.expiresOn ? 1 : a.receivedOrder - b.receivedOrder));
  const total = usable.reduce((s, b) => s + b.remaining, 0);
  if (total < quantity) return null;
  const draws: { batchId: string; batch: string; qty: number }[] = [];
  let left = quantity;
  for (const b of usable) {
    if (left <= 0) break;
    const take = Math.min(left, b.remaining);
    draws.push({ batchId: b.id, batch: b.batch, qty: take });
    left -= take;
  }
  return draws;
}

export async function usableQuantity(itemId: string, at: Date = clockNow()): Promise<number> {
  const r = await q(
    `select coalesce(sum(m.delta),0) as remaining from stock_batches b
     join stock_movements m on m.batch_id = b.id
     where b.item_id = $1`,
    [itemId]
  );
  const rows = await q(
    `select b.expires_on, coalesce(sum(m.delta),0) as remaining from stock_batches b
     join stock_movements m on m.batch_id = b.id
     where b.item_id = $1 group by b.id, b.expires_on`,
    [itemId]
  );
  let usable = 0;
  for (const row of rows.rows) {
    if (batchUsable(fmtDate(row.expires_on), at) && row.remaining > 0) usable += row.remaining;
  }
  return usable;
}

export function fmtDate(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return clinicDateOf(d);
}
