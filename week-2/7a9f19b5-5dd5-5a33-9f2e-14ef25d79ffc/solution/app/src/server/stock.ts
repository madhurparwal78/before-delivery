// Clearance stock. Stock on hand is always the sum of the movements; nothing else stores it.
import type pg from "pg";
import { apiError } from "./errors.js";

interface Demand {
  variantCode: string;
  quantity: number;
}

/**
 * Reserves clearance units for an order in the caller's transaction, before any Kill Bill call. Variant rows are
 * locked in code order, so competing buyers for the last units succeed in commit order and the rest get 409.
 */
export async function reserve(client: pg.PoolClient, orderKey: string, demands: Demand[]): Promise<void> {
  const sorted = [...demands].sort((a, b) => a.variantCode.localeCompare(b.variantCode));
  for (const { variantCode, quantity } of sorted) {
    const locked = await client.query<{ clearance: boolean }>(
      "SELECT clearance_price_cents IS NOT NULL AS clearance FROM variants WHERE code = $1 FOR UPDATE",
      [variantCode],
    );
    if (!locked.rows[0]?.clearance) continue;
    const available = await onHand(client, variantCode);
    if (available < quantity) throw apiError(409, "insufficient_stock", { available });
    await client.query(
      "INSERT INTO stock_movements (variant_code, delta, reason, order_key) VALUES ($1, $2, 'sale', $3)",
      [variantCode, -quantity, orderKey],
    );
  }
}

/** Gives back what an order reserved, after a decline or a Kill Bill outage. */
export async function release(client: pg.PoolClient, orderKey: string): Promise<void> {
  await client.query(
    `INSERT INTO stock_movements (variant_code, delta, reason, order_key)
     SELECT variant_code, -sum(delta), 'release', $1 FROM stock_movements
     WHERE order_key = $1 GROUP BY variant_code HAVING sum(delta) <> 0`,
    [orderKey],
  );
}

export async function onHand(client: pg.PoolClient | pg.Pool, variantCode: string): Promise<number> {
  const result = await client.query<{ total: number }>(
    "SELECT coalesce(sum(delta), 0) AS total FROM stock_movements WHERE variant_code = $1",
    [variantCode],
  );
  return result.rows[0]!.total;
}
