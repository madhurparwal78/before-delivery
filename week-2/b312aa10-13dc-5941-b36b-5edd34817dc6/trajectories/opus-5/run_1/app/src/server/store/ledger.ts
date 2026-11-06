/**
 * The hour ledger and its Kill Bill pairs. Every ledger entry is written with
 * its matching Kill Bill item, in the kitchen-local month of the block it
 * concerns, inside the caller's transaction.
 */
import { randomUUID } from 'node:crypto';
import { monthLabel } from '../../shared/calendar.js';
import { blockLabelOf } from '../../shared/format.js';
import type { Queryable } from '../db/pool.js';
import type { BillingItem, BillingLineKind, BookingRow } from '../domain/types.js';

export async function balanceQuarters(
  client: Queryable,
  memberId: string,
  month: string,
  allowanceQuarters: number,
): Promise<number> {
  const result = await client.query<{ used: string | null }>(
    `select sum(quarters)::text as used from hour_ledger where member_id = $1 and month = $2`,
    [memberId, month],
  );
  const used = Number.parseInt(result.rows[0]?.used ?? '0', 10) || 0;
  return allowanceQuarters - used;
}

export async function usedQuarters(
  client: Queryable,
  memberId: string,
  month: string,
): Promise<number> {
  const result = await client.query<{ used: string | null }>(
    `select sum(quarters)::text as used from hour_ledger where member_id = $1 and month = $2`,
    [memberId, month],
  );
  return Number.parseInt(result.rows[0]?.used ?? '0', 10) || 0;
}

async function insertLedger(
  client: Queryable,
  booking: BookingRow,
  month: string,
  quarters: number,
  reason: string,
): Promise<void> {
  await client.query(
    `insert into hour_ledger (kitchen_id, member_id, month, quarters, booking_id, reason)
     values ($1,$2,$3,$4,$5,$6)`,
    [booking.kitchenId, booking.memberId, month, quarters, booking.id, reason],
  );
}

async function insertItem(
  client: Queryable,
  booking: BookingRow,
  month: string,
  lineKind: BillingLineKind,
  itemKind: string,
  description: string,
  amountCents: number,
  filedDate: string,
): Promise<void> {
  await client.query(
    `insert into billing_items (id, kitchen_id, member_id, month, booking_id, line_kind,
                                item_kind, description, amount_cents, filed_date)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      `bil_${randomUUID()}`,
      booking.kitchenId,
      booking.memberId,
      month,
      booking.id,
      lineKind,
      itemKind,
      description,
      amountCents,
      filedDate,
    ],
  );
}

function bookingDescription(booking: BookingRow, stationName: string): string {
  const label = blockLabelOf({ ...booking, stationName });
  return `Booking ${booking.id} ${label}`;
}

/** Confirm: the block's hours plus a Booking charge, both in the block's month. */
export async function recordConfirm(
  client: Queryable,
  booking: BookingRow,
  stationName: string,
  filedDate: string,
): Promise<void> {
  await insertLedger(client, booking, booking.month, booking.quarterHours, 'confirm');
  await insertItem(
    client,
    booking,
    booking.month,
    'booking',
    'Booking',
    bookingDescription(booking, stationName),
    booking.chargeCents,
    filedDate,
  );
}

/** Move: the old month's hours and charge back, then the new month's hours and charge. */
export async function recordMoveOut(
  client: Queryable,
  booking: BookingRow,
  filedDate: string,
): Promise<void> {
  await insertLedger(client, booking, booking.month, -booking.quarterHours, 'move-out');
  await insertItem(
    client,
    booking,
    booking.month,
    'credit',
    'Moved',
    `Moved ${booking.id}`,
    -booking.chargeCents,
    filedDate,
  );
}

export async function recordMoveIn(
  client: Queryable,
  booking: BookingRow,
  stationName: string,
  filedDate: string,
): Promise<void> {
  await insertLedger(client, booking, booking.month, booking.quarterHours, 'move-in');
  await insertItem(
    client,
    booking,
    booking.month,
    'booking',
    'Booking',
    bookingDescription(booking, stationName),
    booking.chargeCents,
    filedDate,
  );
}

/** A late fee, written just before that booking's Cancelled credit. */
export async function recordPenalty(
  client: Queryable,
  booking: BookingRow,
  penaltyCents: number,
  filedDate: string,
): Promise<void> {
  await insertItem(
    client,
    booking,
    booking.month,
    'penalty',
    'Late cancellation',
    `Late cancellation ${booking.id}`,
    penaltyCents,
    filedDate,
  );
}

export async function recordCancellation(
  client: Queryable,
  booking: BookingRow,
  filedDate: string,
): Promise<void> {
  await insertLedger(client, booking, booking.month, -booking.quarterHours, 'cancel');
  await insertItem(
    client,
    booking,
    booking.month,
    'credit',
    'Cancelled',
    `Cancelled ${booking.id}`,
    -booking.chargeCents,
    filedDate,
  );
}

/** A waiver credit carries no hours and writes no ledger entry. */
export async function recordWaiver(
  client: Queryable,
  booking: BookingRow,
  creditMonth: string,
  filedDate: string,
): Promise<void> {
  const closedMonth = creditMonth !== booking.month;
  await insertItem(
    client,
    booking,
    creditMonth,
    'credit',
    closedMonth ? 'Adjustment' : 'Waived late cancellation',
    closedMonth
      ? `Adjustment: waived late cancellation ${booking.id} (${monthLabel(booking.month)})`
      : `Waived late cancellation ${booking.id}`,
    -booking.penaltyCents,
    filedDate,
  );
}

type ItemRow = {
  id: string;
  seq: string;
  kitchen_id: string;
  member_id: string;
  month: string;
  booking_id: string;
  line_kind: BillingLineKind;
  item_kind: string;
  description: string;
  amount_cents: number;
  filed_date: string;
  recorded_at: Date | null;
};

function toItem(row: ItemRow): BillingItem {
  return {
    id: row.id,
    seq: String(row.seq),
    kitchenId: row.kitchen_id,
    memberId: row.member_id,
    month: row.month,
    bookingId: row.booking_id,
    lineKind: row.line_kind,
    itemKind: row.item_kind,
    description: row.description,
    amountCents: row.amount_cents,
    filedDate: row.filed_date,
    recorded: row.recorded_at !== null,
  };
}

const itemColumns = `id, seq, kitchen_id, member_id, month, booking_id, line_kind, item_kind,
                     description, amount_cents, filed_date, recorded_at`;

export async function itemsFor(
  client: Queryable,
  memberId: string,
  month: string,
): Promise<BillingItem[]> {
  const result = await client.query<ItemRow>(
    `select ${itemColumns} from billing_items where member_id = $1 and month = $2 order by seq`,
    [memberId, month],
  );
  return result.rows.map(toItem);
}

export async function itemsForBooking(
  client: Queryable,
  bookingId: string,
): Promise<BillingItem[]> {
  const result = await client.query<ItemRow>(
    `select ${itemColumns} from billing_items where booking_id = $1 order by seq`,
    [bookingId],
  );
  return result.rows.map(toItem);
}

export async function itemsForKitchenMonth(
  client: Queryable,
  kitchenId: string,
  month: string,
): Promise<BillingItem[]> {
  const result = await client.query<ItemRow>(
    `select ${itemColumns} from billing_items where kitchen_id = $1 and month = $2 order by seq`,
    [kitchenId, month],
  );
  return result.rows.map(toItem);
}

export async function pendingItemCount(
  client: Queryable,
  kitchenId: string,
): Promise<number> {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count from billing_items
      where kitchen_id = $1 and recorded_at is null`,
    [kitchenId],
  );
  return Number.parseInt(result.rows[0]?.count ?? '0', 10);
}

export async function monthHasPendingItems(
  client: Queryable,
  kitchenId: string,
  month: string,
): Promise<boolean> {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count from billing_items
      where kitchen_id = $1 and month = $2 and recorded_at is null`,
    [kitchenId, month],
  );
  return Number.parseInt(result.rows[0]?.count ?? '0', 10) > 0;
}
