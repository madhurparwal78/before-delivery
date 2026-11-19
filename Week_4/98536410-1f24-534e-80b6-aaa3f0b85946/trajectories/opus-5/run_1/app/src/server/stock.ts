import { asNumber } from './db.js';
import type { Queryable, Row } from './db.js';
import { stockConflict } from './http/errors.js';

export type ClaimLine = { sku: string; quantity: number };

/**
 * Locks the shop's stock rows in SKU order and checks that available units cover every
 * line. Taking the locks in SKU order is what keeps overlapping holds from deadlocking,
 * so a refused claim always answers `stock_conflict` rather than a server error.
 */
export async function lockStockInSkuOrder(
  tx: Queryable,
  storeId: string,
  skus: string[],
): Promise<Map<string, Row>> {
  const sorted = [...new Set(skus)].sort();
  const rows = (
    await tx.query(
      `SELECT store_id, sku, on_hand, held FROM stock
        WHERE store_id = $1 AND sku = ANY($2::text[]) ORDER BY sku FOR UPDATE`,
      [storeId, sorted],
    )
  ).rows;
  return new Map(rows.map((row) => [row['sku'] as string, row]));
}

export async function claimStock(
  tx: Queryable,
  storeId: string,
  lines: ClaimLine[],
): Promise<void> {
  const ordered = [...lines].sort((a, b) => (a.sku < b.sku ? -1 : 1));
  const locked = await lockStockInSkuOrder(
    tx,
    storeId,
    ordered.map((line) => line.sku),
  );
  for (const line of ordered) {
    const row = locked.get(line.sku);
    const available = row ? asNumber(row['on_hand']) - asNumber(row['held']) : 0;
    if (available < line.quantity) throw stockConflict(storeId, line.sku, available);
  }
  for (const line of ordered) {
    await tx.query(`UPDATE stock SET held = held + $3 WHERE store_id = $1 AND sku = $2`, [
      storeId,
      line.sku,
      line.quantity,
    ]);
  }
}

export async function releaseHeldUnits(
  tx: Queryable,
  storeId: string,
  lines: ClaimLine[],
): Promise<void> {
  const ordered = [...lines].sort((a, b) => (a.sku < b.sku ? -1 : 1));
  await lockStockInSkuOrder(
    tx,
    storeId,
    ordered.map((line) => line.sku),
  );
  for (const line of ordered) {
    await tx.query(`UPDATE stock SET held = held - $3 WHERE store_id = $1 AND sku = $2`, [
      storeId,
      line.sku,
      line.quantity,
    ]);
  }
}

export async function consumeHeldUnits(
  tx: Queryable,
  storeId: string,
  lines: ClaimLine[],
): Promise<void> {
  const ordered = [...lines].sort((a, b) => (a.sku < b.sku ? -1 : 1));
  await lockStockInSkuOrder(
    tx,
    storeId,
    ordered.map((line) => line.sku),
  );
  for (const line of ordered) {
    await tx.query(
      `UPDATE stock SET on_hand = on_hand - $3, held = held - $3 WHERE store_id = $1 AND sku = $2`,
      [storeId, line.sku, line.quantity],
    );
  }
}

export async function returnUnitsToShelf(
  tx: Queryable,
  storeId: string,
  lines: ClaimLine[],
): Promise<void> {
  const ordered = [...lines].sort((a, b) => (a.sku < b.sku ? -1 : 1));
  await lockStockInSkuOrder(
    tx,
    storeId,
    ordered.map((line) => line.sku),
  );
  for (const line of ordered) {
    await tx.query(`UPDATE stock SET on_hand = on_hand + $3 WHERE store_id = $1 AND sku = $2`, [
      storeId,
      line.sku,
      line.quantity,
    ]);
  }
}

export async function sellOverCounter(
  tx: Queryable,
  storeId: string,
  sku: string,
  quantity: number,
): Promise<Row> {
  const locked = await lockStockInSkuOrder(tx, storeId, [sku]);
  const row = locked.get(sku);
  const available = row ? asNumber(row['on_hand']) - asNumber(row['held']) : 0;
  if (available < quantity) throw stockConflict(storeId, sku, available);
  const updated = (
    await tx.query(
      `UPDATE stock SET on_hand = on_hand - $3 WHERE store_id = $1 AND sku = $2
        RETURNING store_id, sku, on_hand, held, (on_hand - held) AS available`,
      [storeId, sku, quantity],
    )
  ).rows;
  return updated[0] as Row;
}
