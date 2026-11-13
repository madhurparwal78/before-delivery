import { randomUUID } from "node:crypto";
import { one, rows, type Db, type Queryable } from "./db";

// Gift card ledger: every movement is a group of two entries that sum to zero; the balance is the sum of the card's entries.

const GIFT_PREFIX = "RHGC-";

export function isGiftCode(code: string): boolean {
  return code.startsWith(GIFT_PREFIX);
}

export async function exists(db: Queryable, code: string): Promise<boolean> {
  return (await one(db, "SELECT 1 FROM gift_cards WHERE code = $1", [code])) !== null;
}

export async function balanceOf(db: Queryable, code: string): Promise<number> {
  const row = await one<{ balance: number }>(db, "SELECT coalesce(sum(amount), 0) AS balance FROM gift_ledger WHERE card_code = $1 AND account = 'card'", [code]);
  return row?.balance ?? 0;
}

/** Serialises spends on one card. */
export async function lockCard(db: Db, code: string): Promise<void> {
  await db.query("SELECT code FROM gift_cards WHERE code = $1 FOR UPDATE", [code]);
}

async function group(db: Db, code: string, debit: string, credit: string, amount: number, reason: string, ref: string, at: Date): Promise<void> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO gift_ledger (group_id, card_code, account, amount, reason, ref, at) VALUES ($1, $2, $3, $4, $5, $6, $7), ($1, $2, $8, $9, $5, $6, $7)`,
    [id, code, debit, -amount, reason, ref, at, credit, amount],
  );
}

export async function issue(db: Db, code: string, amount: number, at: Date): Promise<void> {
  await db.query("INSERT INTO gift_cards (code) VALUES ($1) ON CONFLICT DO NOTHING", [code]);
  await group(db, code, "issuance", "card", amount, "issuance", `card:${code}`, at);
}

export function spend(db: Db, code: string, amount: number, orderNumber: string, at: Date): Promise<void> {
  return group(db, code, "card", `order:${orderNumber}`, amount, "order_payment", `order:${orderNumber}`, at);
}

export function refund(db: Db, code: string, amount: number, orderNumber: string, at: Date): Promise<void> {
  return group(db, code, `order:${orderNumber}`, "card", amount, "order_refund", `order:${orderNumber}`, at);
}

export async function ledger(db: Queryable, code: string): Promise<{ group_id: string; account: string; amount: number; reason: string; ref: string; at: Date }[]> {
  return rows(db, "SELECT group_id, account, amount, reason, ref, at FROM gift_ledger WHERE card_code = $1 ORDER BY id", [code]);
}
