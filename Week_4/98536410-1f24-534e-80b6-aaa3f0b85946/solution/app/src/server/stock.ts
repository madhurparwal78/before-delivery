// Stock: on_hand and held per shop and item, claimed atomically so the last unit has one winner.
import { type Db, one, query } from "./db.js";
import { ApiError } from "./errors.js";
import { byCodePoint } from "./json.js";

interface StockRow {
  sku: string;
  name: string;
  on_hand: number;
  held: number;
}

/** A stock line is critical at this many units on hand or fewer. */
export const CRITICAL_ON_HAND = 2;

export function stockObject(row: StockRow) {
  return { sku: row.sku, name: row.name, on_hand: row.on_hand, held: row.held, available: row.on_hand - row.held, critical: row.on_hand <= CRITICAL_ON_HAND };
}

export const COUNT_LIMIT = 99_999;

export async function stockLines(db: Pick<Db, "query">, shopId: string): Promise<StockRow[]> {
  const rows = await query<StockRow>(db,
    "SELECT k.sku, p.name, k.on_hand, k.held FROM stock k JOIN products p ON p.sku = k.sku WHERE k.store_id = $1", [shopId]);
  return rows.sort((a, b) => byCodePoint(a.sku, b.sku));
}

export async function stockLine(db: Pick<Db, "query">, shopId: string, sku: string): Promise<StockRow | null> {
  return one<StockRow>(db,
    "SELECT k.sku, p.name, k.on_hand, k.held FROM stock k JOIN products p ON p.sku = k.sku WHERE k.store_id = $1 AND k.sku = $2", [shopId, sku]);
}

async function stockConflict(db: Db, shopId: string, sku: string): Promise<ApiError> {
  const line = await stockLine(db, shopId, sku);
  return new ApiError(409, "stock_conflict", { store_id: shopId, sku, remaining: line ? line.on_hand - line.held : 0 });
}

/** Holds `quantity` units, or throws the stock conflict naming what was left. The statement is the atomic claim. */
export async function claimForHold(db: Db, shopId: string, sku: string, quantity: number): Promise<void> {
  const claimed = await db.query("UPDATE stock SET held = held + $3 WHERE store_id = $1 AND sku = $2 AND on_hand - held >= $3", [shopId, sku, quantity]);
  if (claimed.rowCount !== 1) throw await stockConflict(db, shopId, sku);
}

/** Takes `quantity` units off the shelf for a till sale, under the same rule as a hold. */
export async function claimForSale(db: Db, shopId: string, sku: string, quantity: number): Promise<void> {
  const claimed = await db.query("UPDATE stock SET on_hand = on_hand - $3 WHERE store_id = $1 AND sku = $2 AND on_hand - held >= $3", [shopId, sku, quantity]);
  if (claimed.rowCount !== 1) throw await stockConflict(db, shopId, sku);
}

export async function releaseHeld(db: Db, shopId: string, lines: { sku: string; quantity: number }[]): Promise<void> {
  for (const line of [...lines].sort((a, b) => byCodePoint(a.sku, b.sku))) {
    await db.query("UPDATE stock SET held = held - $3 WHERE store_id = $1 AND sku = $2", [shopId, line.sku, line.quantity]);
  }
}

/** A converted hold leaves the shelf: on_hand and held both fall by the held quantities. */
export async function consumeHeld(db: Db, shopId: string, lines: { sku: string; quantity: number }[]): Promise<void> {
  for (const line of [...lines].sort((a, b) => byCodePoint(a.sku, b.sku))) {
    await db.query("UPDATE stock SET on_hand = on_hand - $3, held = held - $3 WHERE store_id = $1 AND sku = $2", [shopId, line.sku, line.quantity]);
  }
}

/** Cancelling an order and receiving a return put units back on the shelf. */
export async function restock(db: Db, shopId: string, lines: { sku: string; quantity: number }[]): Promise<void> {
  for (const line of [...lines].sort((a, b) => byCodePoint(a.sku, b.sku))) {
    await db.query("UPDATE stock SET on_hand = on_hand + $3 WHERE store_id = $1 AND sku = $2", [shopId, line.sku, line.quantity]);
  }
}

export async function countStock(db: Db, shopId: string, sku: string, onHand: number): Promise<StockRow> {
  const line = await one<StockRow>(db,
    "SELECT k.sku, p.name, k.on_hand, k.held FROM stock k JOIN products p ON p.sku = k.sku WHERE k.store_id = $1 AND k.sku = $2 FOR UPDATE OF k", [shopId, sku]);
  if (!line) throw new ApiError(404, "not_found");
  if (onHand < line.held) throw new ApiError(409, "below_held", { held: line.held });
  await db.query("UPDATE stock SET on_hand = $3 WHERE store_id = $1 AND sku = $2", [shopId, sku, onHand]);
  return { ...line, on_hand: onHand };
}
