import type { PoolClient } from 'pg';

import type { Booking, BookingStatus, CheckIn, PaymentStatus } from '../../shared/api.js';
import {
  checkInWindow,
  computeCost,
  freeCancelUntil,
  isInsideCheckInWindow,
  lateCancellationFeeCents,
} from '../../shared/domain.js';
import { formatMoney } from '../../shared/format.js';
import { formatClock, formatInstant, instantAtKitchen } from '../../shared/time.js';
import { newId } from '../db/seed.js';
import type { AppContext } from '../http/context.js';
import { conflict } from '../http/errors.js';
import { BillingUnavailable } from '../services/killbill.js';
import {
  accountIdFor,
  chargeAndPay,
  dropQueuedJob,
  enqueueBillingJob,
  feeChargeKey,
  overageChargeKey,
} from './billing.js';
import { foodHandlerCardFor, insuranceCoversDate } from './documents.js';
import {
  bookingConfirmationEmail,
  cancellationReceiptEmail,
  enqueueEmail,
  invoiceNoticeEmail,
} from './emails.js';
import { assertHoldLive, findHold, releaseCells } from './holds.js';
import { findStation, type Queryable } from './kitchen.js';
import { balanceMinutes, recordTransaction } from './ledger.js';

export interface BookingRow {
  id: string;
  hold_id: string;
  member_id: string;
  business_name: string;
  contact_email: string;
  station_id: string;
  station_name: string;
  kitchen_date: string;
  start_minutes: number;
  end_minutes: number;
  tail_end_minutes: number;
  starts_at: Date;
  ends_at: Date;
  status: BookingStatus;
  payment: PaymentStatus;
  booked_minutes: number;
  prepaid_minutes: number;
  overage_minutes: number;
  overage_cents: number;
  list_cents: number;
  free_cancel_until: Date;
  fee_cents: number | null;
  fee_status: 'pending' | 'charged' | 'waived' | null;
  confirmed_at: Date;
  cancelled_at: Date | null;
}

export const BOOKING_SELECT = `
  SELECT b.id, b.hold_id, b.member_id, m.business_name, m.contact_email, b.station_id,
         s.name AS station_name, b.kitchen_date, b.start_minutes, b.end_minutes,
         b.tail_end_minutes, b.starts_at, b.ends_at, b.status, b.payment, b.booked_minutes,
         b.prepaid_minutes, b.overage_minutes, b.overage_cents, b.list_cents,
         b.free_cancel_until, b.fee_cents, b.fee_status, b.confirmed_at, b.cancelled_at
    FROM bookings b
    JOIN members m ON m.id = b.member_id
    JOIN stations s ON s.id = b.station_id`;

export const ACTIVE_BOOKING_STATUSES = ['confirmed', 'checked_in', 'completed'] as const;

/** `checked_in` becomes `completed` once now is at or after the booking's end. */
export function bookingStatusAt(row: BookingRow, now: Date): BookingStatus {
  if (row.status === 'checked_in' && now.getTime() >= row.ends_at.getTime()) return 'completed';
  return row.status;
}

export async function findBooking(db: Queryable, id: string): Promise<BookingRow | null> {
  const result = await db.query<BookingRow>(`${BOOKING_SELECT} WHERE b.id = $1`, [id]);
  return result.rows[0] ?? null;
}

async function loadCheckIns(
  db: Queryable,
  bookingIds: readonly string[],
  timeZone: string,
): Promise<Map<string, CheckIn[]>> {
  const byBooking = new Map<string, CheckIn[]>();
  if (bookingIds.length === 0) return byBooking;
  const result = await db.query<{
    id: string;
    booking_id: string;
    crew_cook_id: string;
    crew_cook_name: string;
    at: Date;
    card_document_id: string;
  }>(
    `SELECT c.id, c.booking_id, c.crew_cook_id, u.name AS crew_cook_name, c.at, c.card_document_id
       FROM check_ins c JOIN users u ON u.id = c.crew_cook_id
      WHERE c.booking_id = ANY($1::text[])
      ORDER BY c.at, c.id`,
    [bookingIds as string[]],
  );
  for (const row of result.rows) {
    const list = byBooking.get(row.booking_id) ?? [];
    list.push({
      id: row.id,
      crew_cook_id: row.crew_cook_id,
      crew_cook_name: row.crew_cook_name,
      at: formatInstant(row.at, timeZone),
      card_document_id: row.card_document_id,
    });
    byBooking.set(row.booking_id, list);
  }
  return byBooking;
}

export function bookingView(row: BookingRow, checkIns: CheckIn[], now: Date, timeZone: string): Booking {
  return {
    id: row.id,
    hold_id: row.hold_id,
    member_id: row.member_id,
    business_name: row.business_name,
    station_id: row.station_id,
    station_name: row.station_name,
    date: row.kitchen_date,
    start: formatClock(row.start_minutes),
    end: formatClock(row.end_minutes),
    tail_end: formatClock(row.tail_end_minutes),
    status: bookingStatusAt(row, now),
    payment: row.payment,
    booked_minutes: row.booked_minutes,
    prepaid_minutes: row.prepaid_minutes,
    overage_minutes: row.overage_minutes,
    overage_amount: formatMoney(row.overage_cents),
    list_amount: formatMoney(row.list_cents),
    free_cancel_until: formatInstant(row.free_cancel_until, timeZone),
    fee:
      row.fee_cents === null || row.fee_status === null
        ? null
        : { amount: formatMoney(row.fee_cents), status: row.fee_status },
    check_ins: checkIns,
    confirmed_at: formatInstant(row.confirmed_at, timeZone),
    cancelled_at: row.cancelled_at === null ? null : formatInstant(row.cancelled_at, timeZone),
  };
}

export async function bookingViews(
  db: Queryable,
  rows: readonly BookingRow[],
  now: Date,
  timeZone: string,
): Promise<Booking[]> {
  const checkIns = await loadCheckIns(db, rows.map((row) => row.id), timeZone);
  return rows.map((row) => bookingView(row, checkIns.get(row.id) ?? [], now, timeZone));
}

export async function bookingViewOf(
  db: Queryable,
  row: BookingRow,
  now: Date,
  timeZone: string,
): Promise<Booking> {
  return (await bookingViews(db, [row], now, timeZone))[0] as Booking;
}

/**
 * Confirmation commits as one step or not at all: the hold must be live, the
 * member's insurance must cover the date, and the cost must be covered.
 */
export async function confirmHold(
  app: AppContext,
  holdId: string,
  now: Date,
  timeZone: string,
): Promise<BookingRow> {
  return app.db.transaction(async (client: PoolClient) => {
    const locked = await client.query<{ id: string }>(
      'SELECT id FROM holds WHERE id = $1 FOR UPDATE',
      [holdId],
    );
    if (locked.rows.length === 0) throw conflict('invalid_transition');

    const hold = await findHold(client, holdId);
    if (hold === null) throw conflict('invalid_transition');
    assertHoldLive(hold, now);

    const station = await findStation(client, hold.station_id);
    if (station === null) throw conflict('invalid_transition');

    if (!(await insuranceCoversDate(client, hold.member_id, hold.kitchen_date))) {
      throw conflict('documents_not_current', { missing: ['liability_insurance'] });
    }

    const balance = await balanceMinutes(client, hold.member_id);
    const cost = computeCost(
      hold.end_minutes - hold.start_minutes,
      balance,
      station.hourly_rate_cents,
    );

    const bookingId = newId('bkg');
    if (cost.prepaid_minutes > 0) {
      await recordTransaction(client, {
        memberId: hold.member_id,
        kind: 'booking_debit',
        minutes: -cost.prepaid_minutes,
        createdAt: now,
        bookingId,
      });
    }

    const startsAt = instantAtKitchen(hold.kitchen_date, hold.start_minutes, timeZone);
    const endsAt = instantAtKitchen(hold.kitchen_date, hold.end_minutes, timeZone);
    const cancelCutoff = freeCancelUntil(hold.kitchen_date, hold.start_minutes, timeZone);

    await client.query(
      `INSERT INTO bookings (id, hold_id, member_id, station_id, kitchen_date, start_minutes,
          end_minutes, tail_end_minutes, starts_at, ends_at, status, payment, booked_minutes,
          prepaid_minutes, overage_minutes, overage_cents, list_cents, free_cancel_until,
          confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'confirmed', $11, $12, $13, $14, $15,
               $16, $17, $18)`,
      [
        bookingId,
        hold.id,
        hold.member_id,
        hold.station_id,
        hold.kitchen_date,
        hold.start_minutes,
        hold.end_minutes,
        hold.tail_end_minutes,
        startsAt,
        endsAt,
        cost.overage_cents > 0 ? 'payment_pending' : 'paid',
        cost.booked_minutes,
        cost.prepaid_minutes,
        cost.overage_minutes,
        cost.overage_cents,
        cost.list_cents,
        cancelCutoff,
        now,
      ],
    );

    const description =
      `Overage ${bookingId}: ${station.name} ${hold.kitchen_date} ` +
      `${formatClock(hold.start_minutes)}–${formatClock(hold.end_minutes)}`;

    let paymentPending = false;
    if (cost.overage_cents > 0) {
      const settled = await recordOverage(
        client,
        app,
        hold.member_id,
        bookingId,
        description,
        cost.overage_cents,
        now,
      );
      paymentPending = !settled;
      if (settled) {
        await client.query(`UPDATE bookings SET payment = 'paid' WHERE id = $1`, [bookingId]);
      }
    }

    await client.query(
      `UPDATE cell_locks SET owner_kind = 'booking', owner_id = $2, expires_at = NULL
        WHERE owner_id = $1`,
      [hold.id, bookingId],
    );
    await client.query(`UPDATE holds SET status = 'confirmed' WHERE id = $1`, [hold.id]);

    const member = await client.query<{ contact_email: string }>(
      'SELECT contact_email FROM members WHERE id = $1',
      [hold.member_id],
    );
    const mail = bookingConfirmationEmail({
      bookingId,
      stationName: station.name,
      date: hold.kitchen_date,
      startMinutes: hold.start_minutes,
      endMinutes: hold.end_minutes,
      tailEndMinutes: hold.tail_end_minutes,
      prepaidMinutes: cost.prepaid_minutes,
      overageCents: cost.overage_cents,
      paymentPending,
    });
    await enqueueEmail(
      client,
      mail.dedupeKey,
      member.rows[0]?.contact_email ?? '',
      mail.subject,
      mail.body,
      now,
    );

    const booking = await findBooking(client, bookingId);
    if (booking === null) throw new Error('booking vanished after insert');
    return booking;
  });
}

/** Records the overage now, or queues it when Kill Bill is unreachable. */
async function recordOverage(
  client: Queryable,
  app: AppContext,
  memberId: string,
  bookingId: string,
  description: string,
  amountCents: number,
  now: Date,
): Promise<boolean> {
  const queue = async (): Promise<void> => {
    await enqueueBillingJob(
      client,
      {
        dedupeKey: overageChargeKey(bookingId),
        kind: 'overage',
        memberId,
        bookingId,
        payload: { description, amount_cents: amountCents },
      },
      now,
    );
  };

  if (app.billing.state === 'down') {
    await queue();
    return false;
  }
  try {
    await chargeAndPay(client, app, memberId, description, amountCents);
    app.billing.markUp();
    const notice = invoiceNoticeEmail({
      chargeKey: overageChargeKey(bookingId),
      description,
      amountCents,
    });
    const member = await client.query<{ contact_email: string }>(
      'SELECT contact_email FROM members WHERE id = $1',
      [memberId],
    );
    await enqueueEmail(
      client,
      notice.dedupeKey,
      member.rows[0]?.contact_email ?? '',
      notice.subject,
      notice.body,
      now,
    );
    return true;
  } catch (error) {
    if (!(error instanceof BillingUnavailable)) throw error;
    app.billing.markDown();
    await queue();
    return false;
  }
}

export async function cancelBooking(
  app: AppContext,
  bookingId: string,
  now: Date,
): Promise<BookingRow> {
  return app.db.transaction(async (client: PoolClient) => {
    const locked = await client.query<{ id: string }>(
      'SELECT id FROM bookings WHERE id = $1 FOR UPDATE',
      [bookingId],
    );
    if (locked.rows.length === 0) throw conflict('invalid_transition');

    const booking = await findBooking(client, bookingId);
    if (booking === null) throw conflict('invalid_transition');
    if (booking.status !== 'confirmed') throw conflict('invalid_transition');
    if (now.getTime() >= booking.starts_at.getTime()) throw conflict('booking_started');

    const free = now.getTime() <= booking.free_cancel_until.getTime();
    const status: BookingStatus = free ? 'cancelled_free' : 'cancelled_with_fee';

    if (booking.prepaid_minutes > 0) {
      await recordTransaction(client, {
        memberId: booking.member_id,
        kind: 'cancellation_refund',
        minutes: booking.prepaid_minutes,
        createdAt: now,
        bookingId: booking.id,
      });
    }
    await releaseCells(client, booking.id);

    let payment: PaymentStatus = booking.payment;
    if (booking.payment === 'payment_pending') {
      // The queued charge never reaches Kill Bill, so nothing is owed.
      await dropQueuedJob(client, overageChargeKey(booking.id), now);
      payment = 'voided';
    } else if (booking.payment === 'paid' && booking.overage_cents > 0) {
      await creditBack(
        client,
        app,
        booking.member_id,
        booking.id,
        'overage_refund',
        `Refund overage ${booking.id}`,
        booking.overage_cents,
        now,
      );
    }

    let feeCents: number | null = null;
    let feeStatus: 'pending' | 'charged' | null = null;
    if (!free) {
      feeCents = lateCancellationFeeCents(booking.list_cents);
      feeStatus = await chargeFee(client, app, booking, feeCents, now);
    }

    await client.query(
      `UPDATE bookings SET status = $2, payment = $3, fee_cents = $4, fee_status = $5,
              cancelled_at = $6
        WHERE id = $1`,
      [booking.id, status, payment, feeCents, feeStatus, now],
    );

    const mail = cancellationReceiptEmail({
      bookingId: booking.id,
      stationName: booking.station_name,
      date: booking.kitchen_date,
      refundedMinutes: booking.prepaid_minutes,
      feeCents,
    });
    await enqueueEmail(client, mail.dedupeKey, booking.contact_email, mail.subject, mail.body, now);

    const updated = await findBooking(client, booking.id);
    if (updated === null) throw new Error('booking vanished after cancel');
    return updated;
  });
}

async function chargeFee(
  client: Queryable,
  app: AppContext,
  booking: BookingRow,
  feeCents: number,
  now: Date,
): Promise<'pending' | 'charged'> {
  const description = `Late cancellation ${booking.id}`;
  const queue = async (): Promise<void> => {
    await enqueueBillingJob(
      client,
      {
        dedupeKey: feeChargeKey(booking.id),
        kind: 'fee_charge',
        memberId: booking.member_id,
        bookingId: booking.id,
        payload: { description, amount_cents: feeCents },
      },
      now,
    );
  };
  if (app.billing.state === 'down') {
    await queue();
    return 'pending';
  }
  try {
    const accountId = await accountIdFor(client, app, booking.member_id);
    await app.killBill.addExternalCharge(accountId, description, feeCents);
    app.billing.markUp();
    const notice = invoiceNoticeEmail({
      chargeKey: feeChargeKey(booking.id),
      description,
      amountCents: feeCents,
    });
    await enqueueEmail(
      client,
      notice.dedupeKey,
      booking.contact_email,
      notice.subject,
      notice.body,
      now,
    );
    return 'charged';
  } catch (error) {
    if (!(error instanceof BillingUnavailable)) throw error;
    app.billing.markDown();
    await queue();
    return 'pending';
  }
}

async function creditBack(
  client: Queryable,
  app: AppContext,
  memberId: string,
  bookingId: string,
  kind: 'fee_credit' | 'overage_refund',
  description: string,
  amountCents: number,
  now: Date,
): Promise<void> {
  const queue = async (): Promise<void> => {
    await enqueueBillingJob(
      client,
      {
        dedupeKey: `${kind}:${bookingId}`,
        kind,
        memberId,
        bookingId,
        payload: { description, amount_cents: amountCents },
      },
      now,
    );
  };
  if (app.billing.state === 'down') {
    await queue();
    return;
  }
  try {
    const accountId = await accountIdFor(client, app, memberId);
    await app.killBill.addCredit(accountId, description, amountCents);
    app.billing.markUp();
  } catch (error) {
    if (!(error instanceof BillingUnavailable)) throw error;
    app.billing.markDown();
    await queue();
  }
}

/** Waiving is allowed once, on a cancelled booking whose fee is still owed. */
export async function waiveFee(
  app: AppContext,
  bookingId: string,
  now: Date,
): Promise<BookingRow> {
  return app.db.transaction(async (client: PoolClient) => {
    await client.query('SELECT id FROM bookings WHERE id = $1 FOR UPDATE', [bookingId]);
    const booking = await findBooking(client, bookingId);
    if (booking === null) throw conflict('invalid_transition');
    if (
      booking.status !== 'cancelled_with_fee' ||
      booking.fee_cents === null ||
      (booking.fee_status !== 'pending' && booking.fee_status !== 'charged')
    ) {
      throw conflict('invalid_transition');
    }

    if (booking.fee_status === 'charged') {
      await creditBack(
        client,
        app,
        booking.member_id,
        booking.id,
        'fee_credit',
        `Waived late cancellation ${booking.id}`,
        booking.fee_cents,
        now,
      );
    } else {
      await dropQueuedJob(client, feeChargeKey(booking.id), now);
    }

    await client.query(`UPDATE bookings SET fee_status = 'waived' WHERE id = $1`, [booking.id]);
    const updated = await findBooking(client, booking.id);
    if (updated === null) throw new Error('booking vanished after waive');
    return updated;
  });
}

export interface CheckInResult {
  created: boolean;
  checkIn: CheckIn;
  booking: BookingRow;
}

export async function checkIn(
  app: AppContext,
  bookingId: string,
  crewCookId: string,
  now: Date,
  timeZone: string,
): Promise<CheckInResult> {
  return app.db.transaction(async (client: PoolClient) => {
    await client.query('SELECT id FROM bookings WHERE id = $1 FOR UPDATE', [bookingId]);
    const booking = await findBooking(client, bookingId);
    if (booking === null) throw conflict('invalid_transition');

    const existing = await client.query<{
      id: string;
      at: Date;
      card_document_id: string;
      crew_cook_name: string;
    }>(
      `SELECT c.id, c.at, c.card_document_id, u.name AS crew_cook_name
         FROM check_ins c JOIN users u ON u.id = c.crew_cook_id
        WHERE c.booking_id = $1 AND c.crew_cook_id = $2`,
      [bookingId, crewCookId],
    );
    const already = existing.rows[0];
    if (already !== undefined) {
      return {
        created: false,
        checkIn: {
          id: already.id,
          crew_cook_id: crewCookId,
          crew_cook_name: already.crew_cook_name,
          at: formatInstant(already.at, timeZone),
          card_document_id: already.card_document_id,
        },
        booking,
      };
    }

    const status = bookingStatusAt(booking, now);
    if (status !== 'confirmed' && status !== 'checked_in') throw conflict('invalid_transition');

    const window = checkInWindow(
      booking.kitchen_date,
      booking.start_minutes,
      booking.end_minutes,
      timeZone,
    );
    if (!isInsideCheckInWindow(window, now)) throw conflict('outside_check_in_window');

    const cardId = await foodHandlerCardFor(client, crewCookId, booking.kitchen_date);
    if (cardId === null) throw conflict('food_handler_card_not_current');

    const id = newId('chk');
    await client.query(
      `INSERT INTO check_ins (id, booking_id, crew_cook_id, at, card_document_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, bookingId, crewCookId, now, cardId],
    );
    await client.query(`UPDATE bookings SET status = 'checked_in' WHERE id = $1`, [bookingId]);

    const cook = await client.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [
      crewCookId,
    ]);
    const updated = await findBooking(client, bookingId);
    if (updated === null) throw new Error('booking vanished after check-in');
    return {
      created: true,
      checkIn: {
        id,
        crew_cook_id: crewCookId,
        crew_cook_name: cook.rows[0]?.name ?? '',
        at: formatInstant(now, timeZone),
        card_document_id: cardId,
      },
      booking: updated,
    };
  });
}

export async function completeDueBookings(db: Queryable, now: Date): Promise<void> {
  await db.query(
    `UPDATE bookings SET status = 'completed' WHERE status = 'checked_in' AND ends_at <= $1`,
    [now],
  );
}
