// The prepaid hours ledger: every movement is one transaction of two entries summing to zero.

import { randomUUID } from "node:crypto";
import type { Ledger, LedgerTransaction, TransactionKind } from "../shared/api.js";
import { now } from "./clock.js";
import type { Db } from "./db.js";
import { conflict } from "./errors.js";
import { iso } from "./kitchen.js";

type KitchenAccount = "kitchen:issued" | "kitchen:used";

const KITCHEN_ACCOUNT: Record<Exclude<TransactionKind, "reversal">, KitchenAccount> = {
  opening: "kitchen:issued",
  pack_purchase: "kitchen:issued",
  adjustment: "kitchen:issued",
  booking_debit: "kitchen:used",
  cancellation_refund: "kitchen:used",
};

const memberAccount = (memberId: string): string => `member:${memberId}`;

/** Locks the member so concurrent ledger writes see one balance, and returns it. */
export async function lockBalance(db: Db, memberId: string): Promise<number> {
  await db.query("SELECT id FROM members WHERE id = $1 FOR UPDATE", [memberId]);
  return balance(db, memberId);
}

export async function balance(db: Db, memberId: string): Promise<number> {
  const result = await db.query<{ total: number }>("SELECT COALESCE(SUM(minutes), 0)::int AS total FROM ledger_entries WHERE account = $1", [memberAccount(memberId)]);
  return result.rows[0]?.total ?? 0;
}

interface Posting {
  memberId: string;
  kind: TransactionKind;
  memberMinutes: number;
  bookingId?: string;
  reason?: string;
  reverses?: { id: string; kitchenAccount: string };
}

/** Writes one transaction with its two entries; the caller holds the member lock. Never below zero. */
export async function post(db: Db, posting: Posting, currentBalance: number): Promise<string> {
  if (currentBalance + posting.memberMinutes < 0) throw conflict("insufficient_hours");
  const id = `txn_${randomUUID().replaceAll("-", "")}`;
  const kitchen = posting.reverses ? posting.reverses.kitchenAccount : KITCHEN_ACCOUNT[posting.kind as Exclude<TransactionKind, "reversal">];
  await db.query(
    `INSERT INTO ledger_transactions (id, member_id, kind, created_at, booking_id, reason, reverses) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, posting.memberId, posting.kind, new Date(now()), posting.bookingId ?? null, posting.reason ?? null, posting.reverses?.id ?? null],
  );
  await db.query("INSERT INTO ledger_entries (transaction_id, account, minutes) VALUES ($1, $2, $3), ($1, $4, $5)", [
    id,
    memberAccount(posting.memberId),
    posting.memberMinutes,
    kitchen,
    -posting.memberMinutes,
  ]);
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
  member_id: string;
  entries: { account: string; minutes: number }[];
}

const TRANSACTION_SELECT = `
  SELECT t.id, t.kind, t.created_at, t.booking_id, t.reason, t.reverses, t.member_id, r.id AS reversed_by,
         (SELECT json_agg(json_build_object('account', e.account, 'minutes', e.minutes) ORDER BY e.id)
            FROM ledger_entries e WHERE e.transaction_id = t.id) AS entries
    FROM ledger_transactions t LEFT JOIN ledger_transactions r ON r.reverses = t.id`;

function transactionJson(row: TransactionRow): LedgerTransaction {
  const own = row.entries.find((e) => e.account === memberAccount(row.member_id));
  return {
    id: row.id,
    kind: row.kind,
    created_at: iso(row.created_at),
    member_minutes: own?.minutes ?? 0,
    booking_id: row.booking_id,
    reason: row.reason,
    reverses: row.reverses,
    reversed_by: row.reversed_by,
    entries: row.entries,
  };
}

interface StoredTransaction {
  memberId: string;
  /** The kitchen account of the transaction's second entry. */
  kitchenAccount: string;
  json: LedgerTransaction;
}

export async function transaction(db: Db, id: string): Promise<StoredTransaction | null> {
  const found = await db.query<TransactionRow>(`${TRANSACTION_SELECT} WHERE t.id = $1`, [id]);
  const row: TransactionRow | undefined = found.rows[0];
  if (!row) return null;
  const kitchen = row.entries.filter((e) => e.account !== memberAccount(row.member_id))[0];
  return { memberId: row.member_id, kitchenAccount: kitchen.account, json: transactionJson(row) };
}

export async function memberLedger(db: Db, memberId: string): Promise<Ledger> {
  const found = await db.query<TransactionRow>(`${TRANSACTION_SELECT} WHERE t.member_id = $1 ORDER BY t.seq`, [memberId]);
  return { member_id: memberId, balance_minutes: await balance(db, memberId), transactions: found.rows.map(transactionJson) };
}
