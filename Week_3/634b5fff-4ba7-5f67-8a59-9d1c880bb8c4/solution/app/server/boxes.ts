import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { BoxState } from "../shared/domain.js";
import type { Queryable } from "./db.js";
import { fail } from "./http.js";
import { alertLowStock } from "./alerts.js";
import { enqueue } from "./jobs.js";
import { canMoveBox } from "./transitions.js";

/** Every box transition goes through moveBox: legality, order bookkeeping, stock alerts and search sync. */

/** Boxes in `available` or held: a hold lives in Valkey, so Postgres counts every box still on sale. */
export const availableCount = async (q: Queryable): Promise<number> =>
  (await q.query("SELECT count(*)::int AS available FROM boxes WHERE state = 'available'")).rows[0].available as number;

const evaluateStock = async (tx: PoolClient): Promise<void> => {
  const thresholds = await tx.query("SELECT threshold, armed FROM stock_alerts ORDER BY threshold FOR UPDATE");
  const remaining = await availableCount(tx);
  for (const row of thresholds.rows as { threshold: number; armed: boolean }[]) {
    if (remaining <= row.threshold && row.armed) {
      await tx.query("UPDATE stock_alerts SET armed = false WHERE threshold = $1", [row.threshold]);
      await alertLowStock(tx, `low-stock-${row.threshold}-${randomUUID()}`, remaining);
    } else if (remaining > row.threshold && !row.armed) {
      await tx.query("UPDATE stock_alerts SET armed = true WHERE threshold = $1", [row.threshold]);
    }
  }
};

export const moveBox = async (tx: PoolClient, number: number, to: BoxState, reference: string | null = null): Promise<BoxState> => {
  const row = await tx.query("SELECT state FROM boxes WHERE number = $1 FOR UPDATE", [number]);
  const from = row.rows[0]?.state as BoxState | undefined;
  if (!from || !canMoveBox(from, to)) return fail("illegal_transition");
  await tx.query("UPDATE boxes SET state = $2 WHERE number = $1", [number, to]);
  if (from === "available" && reference) await tx.query("UPDATE orders SET live = true, box_state = $2 WHERE reference = $1", [reference, to]);
  else if (to === "available") await tx.query("UPDATE orders SET live = false, box_state = 'available' WHERE box_number = $1 AND live", [number]);
  else await tx.query("UPDATE orders SET box_state = $2 WHERE box_number = $1 AND live", [number, to]);
  if (from === "available" || to === "available") await evaluateStock(tx);
  await enqueue(tx, "search", `search-${number}-${randomUUID()}`, { numbers: [number] });
  return from;
};

/** The packer's `Back on the shelf`: only a fully refunded box returns to sale. */
export const putBackOnShelf = async (tx: PoolClient, number: number): Promise<void> => {
  const row = await tx.query("SELECT state FROM boxes WHERE number = $1 FOR UPDATE", [number]);
  if (row.rows[0]?.state !== "returned") fail("illegal_transition");
  await moveBox(tx, number, "available");
};
