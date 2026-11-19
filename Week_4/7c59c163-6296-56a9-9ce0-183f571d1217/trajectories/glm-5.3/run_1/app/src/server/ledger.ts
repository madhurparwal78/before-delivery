import type { Pool } from './db.js';

export type JournalKind =
  | 'deposit'
  | 'refund'
  | 'hold'
  | 'hold_release'
  | 'fill'
  | 'fee'
  | 'netting'
  | 'payout'
  | 'margin_reduced'
  | 'liquidation'
  | 'insurance'
  | 'lending';

export interface Leg {
  account: string;
  amountCents: number;
}

export interface JournalEntryInput {
  kind: JournalKind;
  referenceId?: string;
  legs: Leg[];
}

export function memberAccount(memberId: string, bucket: 'available' | 'held' | 'collateral'): string {
  return `member:${memberId}:${bucket}`;
}

export function venueAccount(name: 'card_clearing' | 'fees' | 'insurance'): string {
  return `venue:${name}`;
}

export function escrowAccount(marketId: string): string {
  return `venue:escrow:${marketId}`;
}

export function marginLendingAccount(marketId: string): string {
  return `venue:margin_lending:${marketId}`;
}

export async function postJournalEntry(
  client: PoolClientLike,
  venueId: string,
  entry: JournalEntryInput
): Promise<string> {
  const id = crypto.randomUUID();
  const sum = entry.legs.reduce((acc, leg) => acc + leg.amountCents, 0);
  if (sum !== 0) throw new Error(`Unbalanced journal entry ${entry.kind}: legs sum to ${sum}`);
  await client.query(
    `INSERT INTO journal_entries (id, venue_id, kind, reference_id) VALUES ($1,$2,$3,$4)`,
    [id, venueId, entry.kind, entry.referenceId ?? null]
  );
  for (const leg of entry.legs) {
    await client.query(
      `INSERT INTO journal_legs (id, entry_id, venue_id, account, amount_cents) VALUES ($1,$2,$3,$4,$5)`,
      [crypto.randomUUID(), id, venueId, leg.account, leg.amountCents]
    );
  }
  return id;
}

export interface BalanceSums {
  available: number;
  held: number;
  collateral: number;
}

export async function memberBalances(pool: Pool, venueId: string, memberId: string): Promise<BalanceSums> {
  const res = await pool.query(
    `SELECT
       COALESCE(SUM(amount_cents) FILTER (WHERE account = $3), 0) AS available,
       COALESCE(SUM(amount_cents) FILTER (WHERE account = $4), 0) AS held,
       COALESCE(SUM(amount_cents) FILTER (WHERE account = $5), 0) AS collateral
     FROM journal_legs WHERE venue_id = $1 AND account LIKE $2`,
    [venueId, `member:${memberId}:%`, `member:${memberId}:available`, `member:${memberId}:held`, `member:${memberId}:collateral`]
  );
  const row = res.rows[0] ?? { available: 0, held: 0, collateral: 0 };
  return {
    available: Number(row.available),
    held: Number(row.held),
    collateral: Number(row.collateral),
  };
}

export async function memberBalancesWithClient(client: PoolClientLike, venueId: string, memberId: string): Promise<BalanceSums> {
  const res = await client.query(
    `SELECT
       COALESCE(SUM(amount_cents) FILTER (WHERE account = $3), 0) AS available,
       COALESCE(SUM(amount_cents) FILTER (WHERE account = $4), 0) AS held,
       COALESCE(SUM(amount_cents) FILTER (WHERE account = $5), 0) AS collateral
     FROM journal_legs WHERE venue_id = $1 AND account LIKE $2`,
    [venueId, `member:${memberId}:%`, `member:${memberId}:available`, `member:${memberId}:held`, `member:${memberId}:collateral`]
  );
  const row = res.rows[0] ?? { available: 0, held: 0, collateral: 0 };
  return {
    available: Number(row.available),
    held: Number(row.held),
    collateral: Number(row.collateral),
  };
}

export interface PoolClientLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
