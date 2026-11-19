import { randomUUID } from 'node:crypto';
import { Queryable } from '../db.js';

export interface LedgerPair {
  workspaceId: string;
  /** The account the tokens leave. */
  debit: string;
  /** The account the tokens arrive in. */
  credit: string;
  amountUfern: bigint;
  kind: string;
  label: string;
  height: number | null;
  at: Date;
}

/** Posts the two balancing entries of one movement under a single pair id. */
export async function postPair(tx: Queryable, pair: LedgerPair): Promise<string> {
  const pairId = randomUUID();
  await tx.query(
    `INSERT INTO ledger_entries
       (id, workspace_id, pair_id, account, counter_account, kind, label, amount_ufern, height, at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10),
            ($11, $2, $3, $5, $4, $6, $7, $12, $9, $10)`,
    [
      randomUUID(),
      pair.workspaceId,
      pairId,
      pair.credit,
      pair.debit,
      pair.kind,
      pair.label,
      pair.amountUfern,
      pair.height,
      pair.at,
      randomUUID(),
      -pair.amountUfern,
    ],
  );
  return pairId;
}

export function memberAccount(personId: string): string {
  return `member:${personId}`;
}

export function operatorAccount(validatorId: string): string {
  return `operator:${validatorId}`;
}

export function bondedAccount(validatorId: string): string {
  return `bonded:${validatorId}`;
}

export function depositsAccount(proposalNumber: number): string {
  return `deposits:${proposalNumber}`;
}

export const UNBONDING_ACCOUNT = 'unbonding';
export const REWARDS_ACCOUNT = 'rewards';
export const BURN_ACCOUNT = 'burn';
export const GENESIS_ACCOUNT = 'genesis';

export async function accountBalance(
  tx: Queryable,
  workspaceId: string,
  account: string,
): Promise<bigint> {
  const { rows } = await tx.query<{ total: string | null }>(
    `SELECT sum(amount_ufern)::text AS total FROM ledger_entries
     WHERE workspace_id = $1 AND account = $2`,
    [workspaceId, account],
  );
  return BigInt(rows[0]?.total ?? '0');
}
