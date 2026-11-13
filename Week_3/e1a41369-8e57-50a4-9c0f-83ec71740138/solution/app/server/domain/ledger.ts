import type { LedgerKind } from "../../shared/api.js";
import { one, type Db } from "../db.js";

export async function addEntry(db: Db, userId: string, kind: LedgerKind, cents: number, taskId: string | null = null): Promise<void> {
  await db.query("INSERT INTO ledger (user_id, kind, amount_cents, task_id) VALUES ($1, $2, $3, $4)", [userId, kind, cents, taskId]);
}

/** The balance is always the sum of the entries. */
export async function balanceCents(db: Db, userId: string): Promise<number> {
  const row = await one<{ total: number }>(db, "SELECT COALESCE(SUM(amount_cents), 0) AS total FROM ledger WHERE user_id = $1", [userId]);
  return row!.total;
}
