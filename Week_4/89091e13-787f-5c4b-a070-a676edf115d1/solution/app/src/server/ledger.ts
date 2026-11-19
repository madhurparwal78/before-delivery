import { randomUUID } from "node:crypto";
import { maybeOne, run, type Db } from "./db.ts";

export const memberAccount = (userId: string) => `member:${userId}`;
export const operatorAccount = (validatorId: string) => `operator:${validatorId}`;
export const bondedAccount = (validatorId: string) => `bonded:${validatorId}`;
export const depositsAccount = (proposal: number) => `deposits:${proposal}`;
export const GENESIS = "genesis";
export const BURN = "burn";
export const REWARDS = "rewards";
export const UNBONDING = "unbonding";

interface Movement {
  workspaceId: string;
  from: string;
  to: string;
  amount: number;
  kind: string;
  label: string;
  height: number;
  at: Date;
}

/** Every token movement posts two balancing entries under one pair id; a credit is positive. */
export async function post(db: Db, movement: Movement): Promise<void> {
  const pairId = randomUUID();
  const insert = (account: string, counter: string, amount: number) =>
    run(
      db,
      `INSERT INTO ledger_entries (workspace_id, pair_id, account, counter_account, kind, label, amount_ufern, height, at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [movement.workspaceId, pairId, account, counter, movement.kind, movement.label, amount, movement.height, movement.at],
    );
  await insert(movement.from, movement.to, -movement.amount);
  await insert(movement.to, movement.from, movement.amount);
}

export async function balanceOf(db: Db, workspaceId: string, account: string): Promise<number> {
  const row = await maybeOne<{ total: number }>(
    db,
    "SELECT COALESCE(SUM(amount_ufern), 0)::bigint AS total FROM ledger_entries WHERE workspace_id = $1 AND account = $2",
    [workspaceId, account],
  );
  return row?.total ?? 0;
}

/** Fees and amounts held by a person's pending transactions (holds are not ledger entries). */
export async function heldOf(db: Db, workspaceId: string, userId: string): Promise<number> {
  const row = await maybeOne<{ held: number }>(
    db,
    `SELECT COALESCE(SUM(fee_ufern + held_ufern), 0)::bigint AS held FROM transactions
     WHERE workspace_id = $1 AND sender = $2 AND status = 'pending'`,
    [workspaceId, userId],
  );
  return row?.held ?? 0;
}

export async function availableOf(db: Db, workspaceId: string, userId: string): Promise<number> {
  return (await balanceOf(db, workspaceId, memberAccount(userId))) - (await heldOf(db, workspaceId, userId));
}
