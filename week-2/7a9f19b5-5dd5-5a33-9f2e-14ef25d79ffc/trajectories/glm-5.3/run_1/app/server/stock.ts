/**
 * Stock movements for clearance variants. Stock on hand always equals the
 * sum of movements and never goes below zero.
 */
import type { DbClient } from './db.js'

export class InsufficientStock extends Error {
  constructor(public available: number) {
    super('insufficient_stock')
  }
}

export class StockBelowZero extends Error {
  constructor() {
    super('stock_below_zero')
  }
}

/**
 * Reserve units inside the caller's transaction. Throws InsufficientStock when
 * fewer units are on hand than requested.
 */
export async function reserve_units(
  client: DbClient,
  variant_id: number,
  quantity: number,
  order_key: string,
): Promise<void> {
  const updated = await client.query<{ stock_on_hand: number }>(
    `UPDATE variants SET stock_on_hand = stock_on_hand - $1
     WHERE id=$2 AND stock_on_hand >= $1 RETURNING stock_on_hand`,
    [quantity, variant_id],
  )
  if (updated.rowCount === 0) {
    const current = await client.query<{ stock_on_hand: number }>('SELECT stock_on_hand FROM variants WHERE id=$1', [variant_id])
    throw new InsufficientStock(current.rows[0]?.stock_on_hand ?? 0)
  }
  await client.query(
    `INSERT INTO stock_movements (variant_id, delta, reason, order_key) VALUES ($1,$2,'sale',$3)`,
    [variant_id, -quantity, order_key],
  )
}

/** Release reserved units back (decline or payment-provider outage). */
export async function release_units(
  client: DbClient,
  variant_id: number,
  quantity: number,
  order_key: string,
): Promise<void> {
  await client.query('UPDATE variants SET stock_on_hand = stock_on_hand + $1 WHERE id=$2', [quantity, variant_id])
  await client.query(
    `INSERT INTO stock_movements (variant_id, delta, reason, order_key) VALUES ($1,$2,'release',$3)`,
    [variant_id, quantity, order_key],
  )
}

/** Admin adjustment; refuses to let stock go below zero. */
export async function adjust_units(
  client: DbClient,
  variant_id: number,
  delta: number,
  note: string | null,
): Promise<number> {
  const updated = await client.query<{ stock_on_hand: number }>(
    `UPDATE variants SET stock_on_hand = stock_on_hand + $1
     WHERE id=$2 AND stock_on_hand + $1 >= 0 RETURNING stock_on_hand`,
    [delta, variant_id],
  )
  if (updated.rowCount === 0) throw new StockBelowZero()
  await client.query(
    `INSERT INTO stock_movements (variant_id, delta, reason, note) VALUES ($1,$2,'adjust',$3)`,
    [variant_id, delta, note],
  )
  return updated.rows[0]!.stock_on_hand
}
