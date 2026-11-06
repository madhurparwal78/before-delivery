import type { LedgerTransaction, TransactionKind } from '../../shared/api.js';
import { formatInstant } from '../../shared/time.js';
import { newId } from '../db/seed.js';
import type { Queryable } from './kitchen.js';

/** The kitchen side of every paired entry. */
export type KitchenAccount = 'kitchen:issued' | 'kitchen:used';

const KITCHEN_ACCOUNT_BY_KIND: Record<TransactionKind, KitchenAccount> = {
  opening: 'kitchen:issued',
  pack_purchase: 'kitchen:issued',
  adjustment: 'kitchen:issued',
  reversal: 'kitchen:issued',
  booking_debit: 'kitchen:used',
  cancellation_refund: 'kitchen:used',
};

export function memberAccount(memberId: string): string {
  return `member:${memberId}`;
}

export async function balanceMinutes(db: Queryable, memberId: string): Promise<number> {
  const result = await db.query<{ balance: number }>(
    `SELECT COALESCE(SUM(minutes), 0)::int AS balance FROM ledger_entries WHERE account = $1`,
    [memberAccount(memberId)],
  );
  return result.rows[0]?.balance ?? 0;
}

export interface NewTransaction {
  memberId: string;
  kind: TransactionKind;
  minutes: number;
  createdAt: Date;
  bookingId?: string | null;
  reason?: string | null;
  reverses?: string | null;
  kitchenAccount?: KitchenAccount;
}

/**
 * Writes one transaction holding exactly two entries that sum to zero: one on
 * the member's account and one on a kitchen account.
 */
export async function recordTransaction(
  db: Queryable,
  transaction: NewTransaction,
): Promise<string> {
  const id = newId('txn');
  const kitchenAccount =
    transaction.kitchenAccount ?? KITCHEN_ACCOUNT_BY_KIND[transaction.kind];
  await db.query(
    `INSERT INTO ledger_transactions (id, member_id, kind, created_at, booking_id, reason, reverses)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      transaction.memberId,
      transaction.kind,
      transaction.createdAt,
      transaction.bookingId ?? null,
      transaction.reason ?? null,
      transaction.reverses ?? null,
    ],
  );
  await db.query(
    `INSERT INTO ledger_entries (transaction_id, account, minutes)
     VALUES ($1, $2, $3), ($1, $4, $5)`,
    [id, memberAccount(transaction.memberId), transaction.minutes, kitchenAccount, -transaction.minutes],
  );
  if (transaction.reverses != null) {
    await db.query('UPDATE ledger_transactions SET reversed_by = $2 WHERE id = $1', [
      transaction.reverses,
      id,
    ]);
  }
  return id;
}

interface TransactionRow {
  id: string;
  kind: TransactionKind;
  created_at: Date;
  booking_id: string | null;
  reason: string | null;
  reverses: string | null;
  reversed_by: string | null;
  member_minutes: number;
  entries: Array<{ account: string; minutes: number }>;
}

export async function loadTransaction(
  db: Queryable,
  id: string,
  timeZone: string,
): Promise<LedgerTransaction | null> {
  const rows = await selectTransactions(db, 't.id = $1', [id], timeZone);
  return rows[0] ?? null;
}

export async function listTransactions(
  db: Queryable,
  memberId: string,
  timeZone: string,
): Promise<LedgerTransaction[]> {
  return selectTransactions(db, 't.member_id = $1', [memberId], timeZone);
}

async function selectTransactions(
  db: Queryable,
  where: string,
  params: readonly unknown[],
  timeZone: string,
): Promise<LedgerTransaction[]> {
  const result = await db.query<TransactionRow>(
    `SELECT t.id, t.kind, t.created_at, t.booking_id, t.reason, t.reverses, t.reversed_by,
            COALESCE((SELECT SUM(e.minutes)::int FROM ledger_entries e
                       WHERE e.transaction_id = t.id AND e.account = 'member:' || t.member_id), 0)
              AS member_minutes,
            COALESCE((SELECT json_agg(json_build_object('account', e.account, 'minutes', e.minutes)
                                      ORDER BY e.id)
                        FROM ledger_entries e WHERE e.transaction_id = t.id), '[]'::json)
              AS entries
       FROM ledger_transactions t
      WHERE ${where}
      ORDER BY t.created_at, t.id`,
    params,
  );
  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    created_at: formatInstant(row.created_at, timeZone),
    member_minutes: row.member_minutes,
    booking_id: row.booking_id,
    reason: row.reason,
    reverses: row.reverses,
    reversed_by: row.reversed_by,
    entries: row.entries,
  }));
}
