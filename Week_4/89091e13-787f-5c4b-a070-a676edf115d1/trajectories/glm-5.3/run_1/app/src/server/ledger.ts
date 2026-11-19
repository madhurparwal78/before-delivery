// The paired ledger. Every token movement posts two balancing entries with one
// pairId; a credit is positive. Person-facing labels match the published copy.

import { randomBytes } from "node:crypto";
import type { DbLike } from "./db.js";

export type Account =
  | `member:${string}`
  | `operator:${string}`
  | `bonded:${string}`
  | "unbonding"
  | "rewards"
  | "burn"
  | `deposits:${number}`
  | "genesis";

export type LedgerKind =
  | "genesis"
  | "fee"
  | "fee-refund"
  | "delegation"
  | "unbonding-started"
  | "redelegation"
  | "rewards"
  | "unbonding-released"
  | "deposit"
  | "deposit-refund"
  | "deposit-burned";

export interface LedgerPair {
  id: string;
  workspaceId: string;
  credit: { account: Account; amount: bigint };
  debit: { account: Account; amount: bigint };
  kind: LedgerKind;
  label: string;
  at: Date;
  height?: number;
}

export function pairId(): string {
  return randomBytes(12).toString("hex");
}

export function entryId(): string {
  return randomBytes(12).toString("hex");
}

/** Posts one pair of balancing entries inside the caller's transaction. */
export async function postPair(db: DbLike, pair: LedgerPair): Promise<void> {
  const rows: { id: string; account: string; counter: string; amount: bigint }[] = [
    { id: entryId(), account: pair.credit.account, counter: pair.debit.account, amount: pair.credit.amount },
    { id: entryId(), account: pair.debit.account, counter: pair.credit.account, amount: -pair.credit.amount },
  ];
  for (const row of rows) {
    await db.query(
      `INSERT INTO ledger_entries (id, workspace_id, pair_id, account, counter_account, kind, label, amount_ufern, height, at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        row.id,
        pair.workspaceId,
        pair.id,
        row.account,
        row.counter,
        pair.kind,
        pair.label,
        row.amount.toString(),
        pair.height ?? null,
        pair.at,
      ],
    );
  }
}

export interface LedgerPairInput {
  workspaceId: string;
  credit: { account: Account; amount: bigint };
  debit: { account: Account; amount: bigint };
  kind: LedgerKind;
  label: string;
  at: Date;
  height?: number;
}

export function ledgerPair(input: LedgerPairInput): LedgerPair {
  return { id: pairId(), ...input };
}

/** Sum of every entry posted to an account. */
export async function accountBalance(db: DbLike, workspaceId: string, account: Account): Promise<bigint> {
  const row = await db.one<{ total: bigint | null }>(
    `SELECT COALESCE(SUM(amount_ufern), 0) AS total FROM ledger_entries WHERE workspace_id = $1 AND account = $2`,
    [workspaceId, account],
  );
  return row?.total ?? 0n;
}

/** Sum of the holds currently represented by pending transactions and unbondings. */
export async function heldUfern(db: DbLike, workspaceId: string, personId: string): Promise<bigint> {
  const rows = await db.many<{ total: bigint | null }>(
    `SELECT COALESCE(SUM(hold_ufern), 0) AS total FROM transactions
     WHERE workspace_id = $1 AND sender_id = $2 AND status = 'pending'`,
    [workspaceId, personId],
  );
  const pendingHolds = rows[0]?.total ?? 0n;
  const unbondingRow = await db.one<{ total: bigint | null }>(
    `SELECT COALESCE(SUM(amount_ufern), 0) AS total FROM unbondings
     WHERE workspace_id = $1 AND person_id = $2 AND released_at IS NULL`,
    [workspaceId, personId],
  );
  return pendingHolds + (unbondingRow?.total ?? 0n);
}

export function personAccount(personId: string): Account {
  return `member:${personId}`;
}

export function operatorAccount(validatorId: string): Account {
  return `operator:${validatorId}`;
}

export function bondedAccount(validatorId: string): Account {
  return `bonded:${validatorId}`;
}

export function depositsAccount(number: number): Account {
  return `deposits:${number}`;
}
