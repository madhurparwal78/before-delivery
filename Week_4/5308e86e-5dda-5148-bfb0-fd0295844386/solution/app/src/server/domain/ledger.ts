/** Balance changes and their feed rows: every credit and debit goes through here, under the account's row lock. */
import type { Tx } from "../db.js";
import { newId } from "../ids.js";
import type { TransactionMethod } from "../../shared/rules.js";
import { publishTransactions, type TransactionRow } from "./stream.js";

interface LedgerEntry {
  companyId: string;
  accountId: string;
  direction: "credit" | "debit";
  amountCents: number;
  method: TransactionMethod;
  counterparty: string;
  memo: string | null;
  transferId: string | null;
  createdAt: Date;
}

export function toTransactionRow(row: Record<string, any>): TransactionRow {
  return {
    id: row.id,
    account_id: row.account_id,
    direction: row.direction,
    amount_cents: row.amount_cents,
    method: row.method,
    counterparty: row.counterparty,
    memo: row.memo,
    status: "posted",
    transfer_id: row.transfer_id,
    created_at: (row.created_at as Date).toISOString(),
  };
}

/** Writes one feed row and moves the balance. The caller holds the account's row lock. */
export async function recordTransaction(tx: Tx, entry: LedgerEntry): Promise<TransactionRow> {
  const signed = entry.direction === "credit" ? entry.amountCents : -entry.amountCents;
  await tx.query("UPDATE accounts SET balance_cents = balance_cents + $2 WHERE id = $1", [entry.accountId, signed]);
  const inserted = await tx.query(
    `INSERT INTO transactions (id, company_id, account_id, direction, amount_cents, method, counterparty, memo, transfer_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [newId(), entry.companyId, entry.accountId, entry.direction, entry.amountCents, entry.method, entry.counterparty, entry.memo, entry.transferId, entry.createdAt],
  );
  const row = toTransactionRow(inserted.rows[0]);
  tx.afterCommit(() => publishTransactions(entry.companyId, [row]));
  return row;
}
