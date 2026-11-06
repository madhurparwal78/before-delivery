import { BAR_PRICE_CENTS, dropOrderPrice, money } from '../../shared/money.js';
import type { Cart, Hold, HoldStatus, ProvinceCode } from '../../shared/types.js';
import type { Queryable } from '../db/pool.js';
import { loadBatches } from './batches.js';

export type HoldRow = {
  id: string;
  cart_id: string;
  batch_code: string;
  bar: number;
  status: HoldStatus;
  created_at: Date;
  expires_at: Date;
};

export const HOLD_COLUMNS = 'id, cart_id, batch_code, bar, status, created_at, expires_at';

/** A hold is active while the server's time is strictly before its expiry edge. */
export function effectiveHoldStatus(row: HoldRow, now: Date): HoldStatus {
  if (row.status !== 'active') return row.status;
  return now.getTime() < row.expires_at.getTime() ? 'active' : 'expired';
}

export function serializeHold(row: HoldRow, now: Date): Hold {
  return {
    id: row.id,
    batch: row.batch_code,
    bar: row.bar,
    status: effectiveHoldStatus(row, now),
    created_at: row.created_at.toISOString(),
    expires_at: row.expires_at.toISOString(),
    amount: money(BAR_PRICE_CENTS),
  };
}

export async function activeHoldsOfCart(
  client: Queryable,
  cartId: string,
  now: Date,
): Promise<HoldRow[]> {
  const result = await client.query<HoldRow>(
    `SELECT ${HOLD_COLUMNS} FROM holds
      WHERE cart_id = $1 AND status = 'active' AND expires_at > $2
      ORDER BY created_at, batch_code, bar`,
    [cartId, now],
  );
  return result.rows;
}

export async function buildCart(
  client: Queryable,
  cartId: string | null,
  province: ProvinceCode,
  now: Date,
): Promise<Cart> {
  const holds = cartId === null ? [] : await activeHoldsOfCart(client, cartId, now);
  const codes = [...new Set(holds.map((hold) => hold.batch_code))].sort();
  const batches = codes.length === 0 ? [] : await loadBatches(client, now, codes);
  const price = dropOrderPrice(holds.length, province);
  return {
    server_now: now.toISOString(),
    holds: holds.map((hold) => serializeHold(hold, now)),
    batches: batches.map((batch) => ({
      code: batch.row.code,
      available: batch.counts.available,
      held: batch.counts.held,
      sold: batch.counts.sold,
    })),
    province,
    subtotal: price.subtotal,
    shipping_fee: price.shipping_fee,
    taxes: holds.length === 0 ? [] : price.taxes,
    total: holds.length === 0 ? money(0) : price.total,
  };
}
