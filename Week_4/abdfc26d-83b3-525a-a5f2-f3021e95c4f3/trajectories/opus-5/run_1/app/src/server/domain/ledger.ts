import { ApiError } from '../errors.js';
import { LOCK_NAMESPACE, lockKey, type Queryable } from '../db/pool.js';

export type CreditEntryKind = 'grant' | 'pack' | 'reserve' | 'capture' | 'release';

export function availableAccount(userId: string): string {
  return `creator:${userId}:available`;
}

export function heldAccount(userId: string): string {
  return `creator:${userId}:held`;
}

export const PLATFORM_ISSUED = 'platform:issued';
export const PLATFORM_CONSUMED = 'platform:consumed';

/** Every movement is one entry with two rows of equal and opposite amounts. */
const MOVEMENTS: Readonly<Record<CreditEntryKind, (userId: string) => readonly [string, string]>> = {
  grant: (userId) => [PLATFORM_ISSUED, availableAccount(userId)],
  pack: (userId) => [PLATFORM_ISSUED, availableAccount(userId)],
  reserve: (userId) => [availableAccount(userId), heldAccount(userId)],
  capture: (userId) => [heldAccount(userId), PLATFORM_CONSUMED],
  release: (userId) => [heldAccount(userId), availableAccount(userId)],
};

interface BalanceRow {
  balance: number;
}

async function accountBalance(client: Queryable, account: string): Promise<number> {
  const result = await client.query<BalanceRow>(
    'SELECT COALESCE(SUM(amount), 0)::int AS balance FROM credit_rows WHERE account = $1',
    [account],
  );
  return result.rows[0]?.balance ?? 0;
}

export interface CreditBalances {
  readonly available: number;
  readonly held: number;
}

export async function creditBalances(client: Queryable, userId: string): Promise<CreditBalances> {
  return {
    available: await accountBalance(client, availableAccount(userId)),
    held: await accountBalance(client, heldAccount(userId)),
  };
}

async function writeEntry(
  client: Queryable,
  kind: CreditEntryKind,
  userId: string,
  credits: number,
  renderId: string | null,
): Promise<void> {
  const [from, to] = MOVEMENTS[kind](userId);
  const entry = await client.query<{ id: string }>(
    'INSERT INTO credit_entries (kind, user_id, render_id) VALUES ($1, $2, $3) RETURNING id',
    [kind, userId, renderId],
  );
  const entryId = entry.rows[0]?.id;
  if (!entryId) throw new Error('Credit entry insert returned no id');
  await client.query(
    'INSERT INTO credit_rows (entry_id, account, amount) VALUES ($1, $2, $3), ($1, $4, $5)',
    [entryId, from, -credits, to, credits],
  );
}

/** Grants credits from the platform's issued account into a creator's available balance. */
export async function grantCredits(
  client: Queryable,
  kind: 'grant' | 'pack',
  userId: string,
  credits: number,
): Promise<void> {
  await lockKey(client, LOCK_NAMESPACE.credits, userId);
  await writeEntry(client, kind, userId, credits, null);
}

/**
 * Moves a render's cost from available to held, or refuses with 402 when the
 * balance is short. The lock makes two concurrent accepts safe.
 */
export async function reserveCredits(
  client: Queryable,
  userId: string,
  credits: number,
  renderId: string | null,
): Promise<void> {
  await lockKey(client, LOCK_NAMESPACE.credits, userId);
  const available = await accountBalance(client, availableAccount(userId));
  if (available < credits) {
    throw ApiError.insufficientCredits(credits, available);
  }
  await writeEntry(client, 'reserve', userId, credits, renderId);
}

export async function captureCredits(
  client: Queryable,
  userId: string,
  credits: number,
  renderId: string,
): Promise<void> {
  await lockKey(client, LOCK_NAMESPACE.credits, userId);
  await writeEntry(client, 'capture', userId, credits, renderId);
}

export async function releaseCredits(
  client: Queryable,
  userId: string,
  credits: number,
  renderId: string,
): Promise<void> {
  await lockKey(client, LOCK_NAMESPACE.credits, userId);
  await writeEntry(client, 'release', userId, credits, renderId);
}
