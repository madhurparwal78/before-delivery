// Holds: taking the lowest-numbered available bar of a live batch, releasing,
// expiry, and the race rule where the last bar goes to exactly one shopper.
import { randomUUID } from "node:crypto";
import { type Pool, type PoolClient } from "pg";
import { ApiError } from "../core/http.js";
import { batchStock } from "./stock.js";
import { getBatch, isPublicState } from "./batches.js";

export interface HoldRecord {
  id: string;
  cart_id: string;
  batch_code: string;
  bar: number;
  status: string;
  amount_cents: number;
  created_at: Date;
  expires_at: Date;
}

export const HOLD_LIMIT_PER_BATCH = 2;

export async function createHold(
  pool: Pool,
  env: { holdTtlSeconds: number },
  cartId: string | undefined,
  batchCode: string
): Promise<{ hold: HoldRecord; cartId: string; batchState: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // One hold decision per batch at a time.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`batch:${batchCode}`]);
    const batch = await getBatch(client, batchCode);
    if (!batch || !isPublicState(batch.state)) {
      await client.query("ROLLBACK");
      throw new ApiError(404, "not_found");
    }
    if (batch.state === "scheduled") {
      await client.query("ROLLBACK");
      throw new ApiError(409, "not_live");
    }
    const now = new Date();
    const stock = await batchStock(client, batchCode, now);
    if (stock.counts.available === 0) {
      await client.query("ROLLBACK");
      throw new ApiError(409, stock.counts.held > 0 ? "all_held" : "sold_out");
    }
    const cart = cartId ?? randomUUID();
    const activeForCart = await client.query(
      `SELECT count(*)::int AS n FROM holds
       WHERE cart_id = $1 AND batch_code = $2 AND status = 'active' AND expires_at > now()`,
      [cart, batchCode]
    );
    if (activeForCart.rows[0].n >= HOLD_LIMIT_PER_BATCH) {
      await client.query("ROLLBACK");
      throw new ApiError(409, "hold_limit");
    }
    const bar = stock.bars.find((candidate) => candidate.status === "available")?.number;
    if (bar === undefined) {
      await client.query("ROLLBACK");
      throw new ApiError(409, stock.counts.held > 0 ? "all_held" : "sold_out");
    }
    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + env.holdTtlSeconds * 1000);
    const res = await client.query(
      `INSERT INTO holds (id, cart_id, batch_code, bar, status, amount_cents, created_at, expires_at)
       VALUES ($1, $2, $3, $4, 'active', 1100, $5, $6) RETURNING *`,
      [id, cart, batchCode, bar, now, expiresAt]
    );
    await client.query("COMMIT");
    const hold = res.rows[0] as HoldRecord;
    client.release();
    return { hold, cartId: cart, batchState: batch.state };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    throw err;
  }
}

export async function releaseHold(
  client: PoolClient,
  cartId: string,
  holdId: string
): Promise<HoldRecord> {
  const res = await client.query("SELECT * FROM holds WHERE id = $1", [holdId]);
  const hold = res.rows[0] as HoldRecord | undefined;
  if (!hold || hold.cart_id !== cartId) {
    throw new ApiError(404, "not_found");
  }
  if (hold.status !== "active" || hold.expires_at <= new Date()) {
    throw new ApiError(409, "hold_not_active");
  }
  const updated = await client.query(
    `UPDATE holds SET status = 'released' WHERE id = $1 AND status = 'active' RETURNING *`,
    [holdId]
  );
  return updated.rows[0] as HoldRecord;
}

/** Expire holds whose time has passed; called from the background loop. */
export async function expireHolds(pool: Pool): Promise<void> {
  await pool.query(
    `UPDATE holds SET status = 'expired'
     WHERE status = 'active' AND expires_at <= now()`
  );
}

export function holdView(hold: HoldRecord): {
  id: string;
  batch: string;
  bar: number;
  status: string;
  created_at: string;
  expires_at: string;
  amount: { cents: number; currency: "CAD" };
} {
  return {
    id: hold.id,
    batch: hold.batch_code,
    bar: hold.bar,
    status: hold.status,
    created_at: hold.created_at.toISOString(),
    expires_at: hold.expires_at.toISOString(),
    amount: { cents: hold.amount_cents, currency: "CAD" }
  };
}
