import { Queryable } from '../db.js';
import { accountBalance, memberAccount } from './ledger.js';

export interface Balances {
  balanceUfern: bigint;
  heldUfern: bigint;
  availableUfern: bigint;
}

/** Holds are not ledger entries; they are the amounts pending writes reserve. */
export async function heldFor(
  tx: Queryable,
  workspaceId: string,
  personId: string,
): Promise<bigint> {
  const { rows } = await tx.query<{ total: string | null }>(
    `SELECT sum(held_ufern)::text AS total FROM transactions
     WHERE workspace_id = $1 AND sender_id = $2 AND status = 'pending'`,
    [workspaceId, personId],
  );
  return BigInt(rows[0]?.total ?? '0');
}

export async function balancesFor(
  tx: Queryable,
  workspaceId: string,
  personId: string,
): Promise<Balances> {
  const balanceUfern = await accountBalance(tx, workspaceId, memberAccount(personId));
  const heldUfern = await heldFor(tx, workspaceId, personId);
  return { balanceUfern, heldUfern, availableUfern: balanceUfern - heldUfern };
}

/** Takes a write lock on the person so simultaneous spends are ordered. */
export async function lockPerson(tx: Queryable, personId: string): Promise<void> {
  await tx.query('SELECT id FROM people WHERE id = $1 FOR UPDATE', [personId]);
}
