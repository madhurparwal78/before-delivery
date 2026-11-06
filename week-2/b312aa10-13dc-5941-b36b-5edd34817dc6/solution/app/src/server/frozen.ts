// Which figures a month's invoices, utilisation report and usage CSV show: live while the month is
// open, and from the moment of close the exact text stored by the close.

import type pg from "pg";
import type { Db } from "./db.js";
import type { Month } from "../shared/time.js";

type Surface = "invoice" | "report" | "csv";

/** The stored text of a closed month's surface, or the live text of an open month's. */
export async function surfaceText(db: Db, kitchenId: string, month: Month, surface: Surface, memberId: string, live: () => Promise<string>): Promise<string> {
  const { rows } = await db.query(
    "SELECT body FROM frozen_figures WHERE kitchen_id = $1 AND month = $2 AND surface = $3 AND member_id = $4",
    [kitchenId, month, surface, memberId]);
  return rows[0] ? (rows[0].body as string) : live();
}

/** Stores a surface's text in the close's transaction, after the month is marked closed. */
export async function freeze(client: pg.PoolClient, kitchenId: string, month: Month, surface: Surface, memberId: string, text: string): Promise<void> {
  await client.query(
    "INSERT INTO frozen_figures (kitchen_id, month, surface, member_id, body) VALUES ($1, $2, $3, $4, $5)",
    [kitchenId, month, surface, memberId, text]);
}
