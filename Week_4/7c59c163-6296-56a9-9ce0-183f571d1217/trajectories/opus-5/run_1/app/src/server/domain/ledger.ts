import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

export type MemberBucket = 'available' | 'held' | 'collateral';

export const memberAccount = (memberId: string, bucket: MemberBucket): string =>
  `member:${memberId}:${bucket}`;
export const CARD_CLEARING = 'venue:card_clearing';
export const FEES = 'venue:fees';
export const INSURANCE = 'venue:insurance';
export const escrowAccount = (marketId: string): string => `venue:escrow:${marketId}`;
export const marginLendingAccount = (marketId: string): string => `venue:margin_lending:${marketId}`;

export interface Leg {
  account: string;
  amount_cents: number;
}

export type EntryKind =
  | 'deposit'
  | 'refund'
  | 'hold'
  | 'release'
  | 'fill'
  | 'netting'
  | 'payout'
  | 'margin_reduction'
  | 'liquidation';

const MEMBER_ACCOUNT = /^member:([0-9a-f-]{36}):(available|held|collateral)$/;

/**
 * Posts one journal entry. Legs must sum to exactly zero; member balances are moved by the
 * same legs, so a member's balances always equal the sum of their legs.
 */
export async function postEntry(
  client: PoolClient,
  venueId: string,
  kind: EntryKind,
  referenceId: string | null,
  legs: readonly Leg[],
): Promise<string> {
  const merged = new Map<string, number>();
  for (const leg of legs) {
    if (leg.amount_cents === 0) continue;
    merged.set(leg.account, (merged.get(leg.account) ?? 0) + leg.amount_cents);
  }
  const effective = [...merged].filter(([, amount]) => amount !== 0);
  if (effective.length === 0) return '';
  const total = effective.reduce((sum, [, amount]) => sum + amount, 0);
  if (total !== 0) throw new Error(`unbalanced journal entry ${kind}: legs sum to ${total}`);

  const entryId = randomUUID();
  await client.query('insert into journal_entries (id, venue_id, kind, reference_id) values ($1,$2,$3,$4)', [
    entryId,
    venueId,
    kind,
    referenceId,
  ]);
  for (const [account, amount] of effective) {
    await client.query(
      'insert into journal_legs (id, entry_id, venue_id, account, amount_cents) values ($1,$2,$3,$4,$5)',
      [randomUUID(), entryId, venueId, account, amount],
    );
    const member = MEMBER_ACCOUNT.exec(account);
    if (member) {
      const column = `${member[2]}_cents`;
      await client.query(
        `update member_balances set ${column} = ${column} + $2 where member_id = $1`,
        [member[1], amount],
      );
    }
  }
  return entryId;
}

