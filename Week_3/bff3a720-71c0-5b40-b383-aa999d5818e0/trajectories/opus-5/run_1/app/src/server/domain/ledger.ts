import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db.js';

export type EntryKind =
  | 'top_up'
  | 'payment'
  | 'request_released'
  | 'passenger_cancellation'
  | 'driver_cancellation'
  | 'completion';

interface LineInput {
  account: string;
  amountCents: number;
  walletMemberId?: string;
  earningsMemberId?: string;
  label?: string;
}

export const account = {
  wallet: (memberId: string) => `wallet:${memberId}`,
  held: (bookingId: string) => `held:${bookingId}`,
  earnings: (driverId: string) => `earnings:${driverId}`,
  topUps: 'network:topups',
};

/** Every money movement is one entry whose lines sum to zero. */
async function writeEntry(
  tx: Queryable,
  kind: EntryKind,
  at: Date,
  bookingId: string | null,
  lines: readonly LineInput[],
): Promise<string> {
  const total = lines.reduce((sum, line) => sum + line.amountCents, 0);
  if (total !== 0) throw new Error(`Ledger entry ${kind} does not balance`);
  const entryId = randomUUID();
  await tx.query(
    'insert into ledger_entries (id, kind, at, booking_id) values ($1, $2, $3, $4)',
    [entryId, kind, at, bookingId],
  );
  let seq = 0;
  for (const line of lines) {
    await tx.query(
      `insert into ledger_lines (id, entry_id, account, amount_cents, wallet_member_id, earnings_member_id, label, seq)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        randomUUID(),
        entryId,
        line.account,
        line.amountCents,
        line.walletMemberId ?? null,
        line.earningsMemberId ?? null,
        line.label ?? null,
        seq,
      ],
    );
    seq += 1;
  }
  return entryId;
}

export function topUp(tx: Queryable, at: Date, memberId: string, amountCents: number) {
  return writeEntry(tx, 'top_up', at, null, [
    { account: account.topUps, amountCents: -amountCents },
    {
      account: account.wallet(memberId),
      amountCents,
      walletMemberId: memberId,
      label: 'Added to wallet',
    },
  ]);
}

export function payment(
  tx: Queryable,
  at: Date,
  bookingId: string,
  memberId: string,
  amountCents: number,
  label: string,
) {
  return writeEntry(tx, 'payment', at, bookingId, [
    {
      account: account.wallet(memberId),
      amountCents: -amountCents,
      walletMemberId: memberId,
      label,
    },
    { account: account.held(bookingId), amountCents },
  ]);
}

export function requestReleased(
  tx: Queryable,
  at: Date,
  bookingId: string,
  memberId: string,
  amountCents: number,
  label: string,
) {
  return writeEntry(tx, 'request_released', at, bookingId, [
    { account: account.held(bookingId), amountCents: -amountCents },
    {
      account: account.wallet(memberId),
      amountCents,
      walletMemberId: memberId,
      label,
    },
  ]);
}

export function passengerCancellation(
  tx: Queryable,
  at: Date,
  bookingId: string,
  passengerId: string,
  driverId: string,
  paidCents: number,
  refundCents: number,
  keptCents: number,
  label: string,
) {
  return writeEntry(tx, 'passenger_cancellation', at, bookingId, [
    { account: account.held(bookingId), amountCents: -paidCents },
    {
      account: account.wallet(passengerId),
      amountCents: refundCents,
      walletMemberId: passengerId,
      label,
    },
    {
      account: account.earnings(driverId),
      amountCents: keptCents,
      earningsMemberId: driverId,
    },
  ]);
}

export function driverCancellation(
  tx: Queryable,
  at: Date,
  bookingId: string,
  passengerId: string,
  driverId: string,
  paidCents: number,
  label: string,
) {
  return writeEntry(tx, 'driver_cancellation', at, bookingId, [
    { account: account.held(bookingId), amountCents: -paidCents },
    {
      account: account.wallet(passengerId),
      amountCents: paidCents,
      walletMemberId: passengerId,
      label,
    },
    { account: account.earnings(driverId), amountCents: 0, earningsMemberId: driverId },
  ]);
}

export function completion(
  tx: Queryable,
  at: Date,
  bookingId: string,
  driverId: string,
  paidCents: number,
) {
  return writeEntry(tx, 'completion', at, bookingId, [
    { account: account.held(bookingId), amountCents: -paidCents },
    {
      account: account.earnings(driverId),
      amountCents: paidCents,
      earningsMemberId: driverId,
    },
  ]);
}

export async function walletBalance(tx: Queryable, memberId: string): Promise<number> {
  const { rows } = await tx.query<{ total: number | null }>(
    'select coalesce(sum(amount_cents), 0)::int as total from ledger_lines where wallet_member_id = $1',
    [memberId],
  );
  return rows[0]?.total ?? 0;
}
