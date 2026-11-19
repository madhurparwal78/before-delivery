import type { Booking, BookingSource, BookingStatus, DepositState } from '../../shared/types';
import { query, type Db } from '../db';
import { isoWithLisbonOffset } from '../time';
import type { Layout } from './floor';
import { newBookingReference, refundCutoff } from './rules';

export interface BookingRow {
  id: string;
  reference: string;
  status: BookingStatus;
  source: BookingSource;
  date: string;
  time: string;
  starts_at: Date;
  window_start: Date;
  window_end: Date;
  party_size: number;
  unit_id: string;
  pair_id: string | null;
  room_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  deposit_cents: number;
  deposit_state: DepositState;
  manage_token: string | null;
  killbill_payment_id: string | null;
  killbill_transaction_id: string | null;
  killbill_refund_id: string | null;
}

export const BOOKING_COLUMNS = `
  b.id, b.reference, b.status, b.source, to_char(b.date, 'YYYY-MM-DD') as date, b.time,
  b.starts_at, b.window_start, b.window_end, b.party_size, b.unit_id, b.pair_id, b.room_id,
  b.name, b.email, b.phone, b.deposit_cents, b.deposit_state, b.manage_token,
  b.killbill_payment_id, b.killbill_transaction_id, b.killbill_refund_id
`;

export function toBooking(row: BookingRow, layout: Layout): Booking {
  const room = layout.roomById.get(row.room_id);
  return {
    reference: row.reference,
    status: row.status,
    source: row.source,
    date: row.date,
    time: row.time,
    starts_at: isoWithLisbonOffset(new Date(row.starts_at)),
    party_size: row.party_size,
    table_id: row.unit_id,
    room: room ? room.name : row.room_id,
    name: row.name,
    deposit: { amount_cents: row.deposit_cents, state: row.deposit_state },
    refund_cutoff:
      row.source === 'walk_in' ? null : isoWithLisbonOffset(refundCutoff(new Date(row.starts_at))),
  };
}

export async function findBookingByReference(
  db: Db,
  reference: string,
): Promise<BookingRow | null> {
  const result = await query<BookingRow>(
    db,
    `select ${BOOKING_COLUMNS} from bookings b where b.reference = $1`,
    [reference],
  );
  return result.rows[0] ?? null;
}

export async function findBookingByManageToken(db: Db, token: string): Promise<BookingRow | null> {
  const result = await query<BookingRow>(
    db,
    `select ${BOOKING_COLUMNS} from bookings b where b.manage_token = $1`,
    [token],
  );
  return result.rows[0] ?? null;
}

export async function reserveReference(db: Db): Promise<string> {
  for (;;) {
    const candidate = newBookingReference();
    const taken = await query<{ exists: boolean }>(
      db,
      `select exists(
         select 1 from bookings where reference = $1
         union all select 1 from holds where reserved_reference = $1
         union all select 1 from offers where reserved_reference = $1
       ) as exists`,
      [candidate],
    );
    if (!taken.rows[0]?.exists) return candidate;
  }
}

export interface InsertBookingInput {
  reference: string;
  status: BookingStatus;
  source: BookingSource;
  date: string;
  time: string;
  startsAt: Date;
  windowStart: Date;
  windowEnd: Date;
  partySize: number;
  unitId: string;
  pairId: string | null;
  roomId: string;
  tableIds: string[];
  name: string;
  email: string | null;
  phone: string | null;
  depositCents: number;
  depositState: DepositState;
  manageToken: string | null;
  killbillPaymentId: string | null;
  killbillTransactionId: string | null;
}

export async function insertBooking(db: Db, input: InsertBookingInput): Promise<BookingRow> {
  const inserted = await query<{ id: string }>(
    db,
    `insert into bookings(reference, status, source, date, time, starts_at, window_start,
       window_end, party_size, unit_id, pair_id, room_id, name, email, phone, deposit_cents,
       deposit_state, manage_token, killbill_payment_id, killbill_transaction_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
       $19, $20, now())
     returning id`,
    [
      input.reference,
      input.status,
      input.source,
      input.date,
      input.time,
      input.startsAt,
      input.windowStart,
      input.windowEnd,
      input.partySize,
      input.unitId,
      input.pairId,
      input.roomId,
      input.name,
      input.email,
      input.phone,
      input.depositCents,
      input.depositState,
      input.manageToken,
      input.killbillPaymentId,
      input.killbillTransactionId,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error('Booking insert returned no id');
  for (const tableId of input.tableIds) {
    await query(
      db,
      `insert into booking_tables(booking_id, table_id, during)
       values ($1, $2, tstzrange($3, $4, '[)'))`,
      [id, tableId, input.windowStart, input.windowEnd],
    );
  }
  const row = await query<BookingRow>(
    db,
    `select ${BOOKING_COLUMNS} from bookings b where b.id = $1`,
    [id],
  );
  const booking = row.rows[0];
  if (!booking) throw new Error('Booking disappeared after insert');
  return booking;
}

export function isTableConflict(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === '23P01' || code === '23505';
}

export async function releaseBookingTables(db: Db, bookingId: string): Promise<void> {
  await query(db, 'update booking_tables set active = false where booking_id = $1', [bookingId]);
}

/** Clearing a seated table ends its window at the moment of clearing. */
export async function endBookingWindowNow(db: Db, bookingId: string, now: Date): Promise<void> {
  await query(
    db,
    `update booking_tables
     set during = tstzrange(lower(during), greatest(lower(during), $2), '[)'),
         active = (greatest(lower(during), $2) > lower(during))
     where booking_id = $1`,
    [bookingId, now],
  );
}
