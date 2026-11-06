import type { PoolClient } from 'pg';
import { newId } from './util.js';
import { monthOf } from './time.js';
import type { BookingRow } from './booking.js';

export type KbItemKind =
  | 'booking'
  | 'moved_credit'
  | 'late_fee'
  | 'cancelled_credit'
  | 'waiver_credit'
  | 'adjustment_credit';

export interface KbItemInput {
  kind: KbItemKind;
  bookingId: string | null;
  description: string;
  amountCents: number;
}

/**
 * Every hour-ledger entry is written together with its matching Kill Bill
 * charge or credit in the kitchen-local month of the block it concerns.
 * Both go to the same transaction; the Kill Bill item through the outbox.
 */
export async function recordLedgerPair(
  client: PoolClient,
  booking: BookingRow,
  options: { hours: number; ledgerKind: 'confirm' | 'move_out' | 'move_in' | 'cancel'; kbItems: KbItemInput[] },
): Promise<string[]> {
  const month = monthOf(booking.local_date);
  if (options.hours !== 0) {
    await client.query(
      `INSERT INTO hour_ledger (id, kitchen_id, member_id, month, hours, booking_id, kind)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [newId('led'), booking.kitchen_id, booking.member_id, month, options.hours, booking.id, options.ledgerKind],
    );
  }
  const itemIds: string[] = [];
  for (const item of options.kbItems) {
    const id = newId('kbi');
    itemIds.push(id);
    await client.query(
      `INSERT INTO kb_items (id, kitchen_id, member_id, month, kind, booking_id, description, amount_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, booking.kitchen_id, booking.member_id, month, item.kind, item.bookingId, item.description, item.amountCents],
    );
  }
  return itemIds;
}

/** Adjustment credits are filed in the adjustment month with no hours. */
export async function recordAdjustment(
  client: PoolClient,
  kitchenId: string,
  memberId: string,
  month: string,
  bookingId: string,
  description: string,
  amountCents: number,
): Promise<void> {
  await client.query(
    `INSERT INTO kb_items (id, kitchen_id, member_id, month, kind, booking_id, description, amount_cents)
     VALUES ($1,$2,$3,$4,'adjustment_credit',$5,$6,$7)`,
    [newId('kbi'), kitchenId, memberId, month, bookingId, description, amountCents],
  );
}
