import type { AuditEvent, BookingStatus, RefundOutcome, Role } from '../../shared/types.js';
import { pool, query, queryOne, transaction, type Db } from '../db/pool.js';
import { writeAudit } from '../domain/audit.js';
import { writeMovement } from '../domain/pack.js';
import { refundTier } from '../domain/policy.js';
import { bookingIsPaid, presentBooking, presentInvoice } from '../domain/present.js';
import { overrunCents } from '../domain/pricing.js';
import {
  BOOKING_SELECT,
  bookingInScope,
  siteInScope,
  type BookingRow,
} from '../domain/records.js';
import {
  addDays,
  isDateString,
  startOfLocalDay,
} from '../domain/zone.js';
import { json, type Ctx, type Reply } from '../http/context.js';
import { ApiError, billingUnavailable, invalidTransition, validation } from '../http/errors.js';
import { runIdempotent } from '../http/idempotency.js';
import type { Route } from '../http/router.js';
import type { Actor } from '../http/session.js';
import {
  BillingUnavailableError,
  recordPurchase,
  refundPurchase,
  type RenterAccountInput,
} from '../services/killbill.js';
import { allowsAction, statusAfter, statusAfterCancel, type BookingAction } from '../domain/transitions.js';

const CHECK_IN_LEAD_MS = 30 * 60 * 1000;

const BOOKING_STATUSES: readonly BookingStatus[] = [
  'confirmed',
  'checked_in',
  'overrun_billed',
  'checked_out',
  'settled',
  'cancelled_refunded',
  'cancelled_forfeit',
  'unpaid_cancelled',
];

function account(row: BookingRow): RenterAccountInput {
  return { renterId: row.renter_id, name: row.renter_name, email: row.renter_email };
}

function guard(row: BookingRow, action: BookingAction): void {
  if (!allowsAction(row.status, action)) throw invalidTransition(row.status, action);
}

async function reload(db: Db, bookingId: string): Promise<BookingRow> {
  const row = await queryOne<BookingRow>(db, `${BOOKING_SELECT} WHERE b.id = $1`, [bookingId]);
  if (row === null) throw new Error(`booking ${bookingId} vanished`);
  return row;
}

async function billed<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof BillingUnavailableError) throw billingUnavailable();
    throw error;
  }
}

async function listBookings(ctx: Ctx): Promise<Reply> {
  const actor = ctx.requireActor();
  const siteId = ctx.queryValue('site_id');
  const date = ctx.queryValue('date');
  const status = ctx.queryValue('status');
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (actor.role === 'renter') {
    values.push(actor.renter_id);
    conditions.push(`b.renter_id = $${values.length}`);
  } else {
    values.push(actor.site_ids);
    conditions.push(`b.site_id = ANY($${values.length}::text[])`);
  }
  if (siteId !== null) {
    const site = await siteInScope(actor, siteId);
    values.push(site.id);
    conditions.push(`b.site_id = $${values.length}`);
    if (date !== null) {
      if (!isDateString(date)) throw validation({ date: 'Give a date as YYYY-MM-DD.' });
      values.push(startOfLocalDay(site.time_zone, addDays(date, 1)));
      conditions.push(`b.start_at < $${values.length}`);
      values.push(startOfLocalDay(site.time_zone, date));
      conditions.push(`b.end_at > $${values.length}`);
    }
  } else if (date !== null) {
    if (!isDateString(date)) throw validation({ date: 'Give a date as YYYY-MM-DD.' });
    values.push(date);
    conditions.push(`(b.start_at AT TIME ZONE s.time_zone)::date = $${values.length}::date`);
  }
  if (status !== null) {
    if (!BOOKING_STATUSES.includes(status as BookingStatus)) {
      throw validation({ status: 'Unknown booking status.' });
    }
    values.push(status);
    conditions.push(`b.status = $${values.length}`);
  }
  const rows = await query<BookingRow>(
    pool,
    `${BOOKING_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY b.start_at`,
    values,
  );
  return json(200, { bookings: rows.map(presentBooking) });
}

async function payBalance(ctx: Ctx): Promise<Reply> {
  const actor = ctx.requireActor();
  const booking = await bookingInScope(actor, ctx.params.id as string);
  ctx.requireRole('renter');
  return runIdempotent(ctx, actor, async () => {
    guard(booking, 'pay');
    if (bookingIsPaid(booking)) throw invalidTransition(booking.status, 'pay');
    await billed(() => recordPurchase(account(booking), `hs-booking-${booking.id}`, booking.card_cents));
    const updated = await transaction(async (client) => {
      await client.query('UPDATE bookings SET time_paid = true WHERE id = $1', [booking.id]);
      await writeAudit(client, {
        bookingId: booking.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: 'pay',
        from: 'confirmed',
        to: 'confirmed',
      });
      return reload(client, booking.id);
    });
    return json(200, { booking: presentBooking(updated) });
  });
}

interface CancelResult {
  booking: BookingRow;
  refund: RefundOutcome;
}

async function applyCancel(
  actor: Actor,
  booking: BookingRow,
  tier: 'full' | 'none',
  reason: string | null,
  action: 'cancel' | 'override_cancel',
): Promise<CancelResult> {
  let cardRefund = 0;
  let depositRefund = 0;
  if (tier === 'full') {
    await billed(async () => {
      if (booking.time_paid && booking.card_cents > 0) {
        cardRefund = await refundPurchase(`hs-booking-${booking.id}`);
      }
      if (booking.deposit_cents > 0) {
        depositRefund = await refundPurchase(`hs-deposit-${booking.id}`);
      }
    });
  }
  const status = statusAfterCancel(tier);
  const booked = await transaction(async (client) => {
    await client.query(
      `UPDATE bookings SET status = $2, card_refund_cents = $3, deposit_refund_cents = $4 WHERE id = $1`,
      [booking.id, status, cardRefund, depositRefund],
    );
    if (booking.pack_minutes > 0) {
      await writeMovement(client, {
        renterId: booking.renter_id,
        reason: tier === 'full' ? 'release' : 'forfeit',
        minutes: booking.pack_minutes,
        bookingId: booking.id,
      });
    }
    await writeAudit(client, {
      bookingId: booking.id,
      actorName: actor.name,
      actorRole: actor.role,
      action,
      from: booking.status,
      to: status,
      reason,
    });
    return reload(client, booking.id);
  });
  return {
    booking: booked,
    refund: {
      tier,
      pack_minutes_returned: tier === 'full' ? booking.pack_minutes : 0,
      card_refund_cents: cardRefund,
      deposit_refund_cents: depositRefund,
    },
  };
}

async function cancelBooking(ctx: Ctx): Promise<Reply> {
  const actor = ctx.requireActor();
  const booking = await bookingInScope(actor, ctx.params.id as string);
  ctx.requireRole('renter');
  return runIdempotent(ctx, actor, async () => {
    guard(booking, 'cancel');
    const tier = refundTier(new Date(), booking.start_at, booking.notice_hours);
    const result = await applyCancel(actor, booking, tier, null, 'cancel');
    return json(200, { booking: presentBooking(result.booking), refund: result.refund });
  });
}

async function overrideBooking(ctx: Ctx): Promise<Reply> {
  const actor = ctx.requireActor();
  const booking = await bookingInScope(actor, ctx.params.id as string);
  ctx.requireRole('manager');
  const body = ctx.body();
  if (body.action !== 'cancel_refunded') {
    throw validation({ action: 'The only booking override is cancel_refunded.' });
  }
  guard(booking, 'override_cancel');
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 500) {
    throw validation({ reason: 'Give a reason of at least 5 characters.' });
  }
  const result = await applyCancel(actor, booking, 'full', reason, 'override_cancel');
  return json(200, { booking: presentBooking(result.booking), refund: result.refund });
}

async function checkIn(ctx: Ctx): Promise<Reply> {
  const actor = ctx.requireActor();
  const booking = await bookingInScope(actor, ctx.params.id as string);
  ctx.requireRole('front_desk', 'manager');
  guard(booking, 'check_in');
  const now = Date.now();
  if (now < booking.start_at.getTime() - CHECK_IN_LEAD_MS || now >= booking.end_at.getTime()) {
    throw new ApiError(
      409,
      'outside_check_in_window',
      'Check-in opens 30 minutes before start.',
      {},
    );
  }
  const updated = await transaction(async (client) => {
    await client.query(
      `UPDATE bookings SET status = $2, checked_in_at = now() WHERE id = $1`,
      [booking.id, statusAfter('check_in')],
    );
    await writeAudit(client, {
      bookingId: booking.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'check_in',
      from: booking.status,
      to: statusAfter('check_in'),
    });
    return reload(client, booking.id);
  });
  return json(200, { booking: presentBooking(updated) });
}

async function chargeOverrun(ctx: Ctx): Promise<Reply> {
  const actor = ctx.requireActor();
  const booking = await bookingInScope(actor, ctx.params.id as string);
  ctx.requireRole('front_desk', 'manager');
  return runIdempotent(ctx, actor, async () => {
    guard(booking, 'overrun');
    const body = ctx.body();
    const minutes = body.minutes;
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
      throw validation({ minutes: 'Charge between 1 and 240 minutes.' });
    }
    const amount = overrunCents(minutes, booking.rate_cents);
    await billed(() => recordPurchase(account(booking), `hs-overrun-${booking.id}`, amount));
    const updated = await transaction(async (client) => {
      await client.query(
        `UPDATE bookings SET status = $2, overrun_minutes = $3, overrun_cents = $4 WHERE id = $1`,
        [booking.id, statusAfter('overrun'), minutes, amount],
      );
      await writeAudit(client, {
        bookingId: booking.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: 'overrun',
        from: booking.status,
        to: statusAfter('overrun'),
      });
      return reload(client, booking.id);
    });
    return json(201, { booking: presentBooking(updated) });
  });
}

async function checkOut(ctx: Ctx): Promise<Reply> {
  const actor = ctx.requireActor();
  const booking = await bookingInScope(actor, ctx.params.id as string);
  ctx.requireRole('front_desk', 'manager');
  guard(booking, 'check_out');
  const updated = await transaction(async (client) => {
    await client.query(
      `UPDATE bookings SET status = $2, checked_out_at = now() WHERE id = $1`,
      [booking.id, statusAfter('check_out')],
    );
    if (booking.pack_minutes > 0) {
      await writeMovement(client, {
        renterId: booking.renter_id,
        reason: 'use',
        minutes: booking.pack_minutes,
        bookingId: booking.id,
      });
    }
    await writeAudit(client, {
      bookingId: booking.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'check_out',
      from: booking.status,
      to: statusAfter('check_out'),
    });
    return reload(client, booking.id);
  });
  return json(200, { booking: presentBooking(updated) });
}

async function cleaningFee(ctx: Ctx): Promise<Reply> {
  const actor = ctx.requireActor();
  const booking = await bookingInScope(actor, ctx.params.id as string);
  ctx.requireRole('front_desk', 'manager');
  return runIdempotent(ctx, actor, async () => {
    guard(booking, 'cleaning_fee');
    if (booking.cleaning_fee_cents > 0) {
      throw new ApiError(
        409,
        'cleaning_fee_already_charged',
        'This booking already carries a cleaning fee.',
        {},
      );
    }
    const amount = booking.site_cleaning_fee_cents;
    await billed(() => recordPurchase(account(booking), `hs-cleaning-${booking.id}`, amount));
    const updated = await transaction(async (client) => {
      await client.query('UPDATE bookings SET cleaning_fee_cents = $2 WHERE id = $1', [
        booking.id,
        amount,
      ]);
      await writeAudit(client, {
        bookingId: booking.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: 'cleaning_fee',
        from: booking.status,
        to: booking.status,
      });
      return reload(client, booking.id);
    });
    return json(201, { booking: presentBooking(updated) });
  });
}

async function settle(ctx: Ctx): Promise<Reply> {
  const actor = ctx.requireActor();
  const booking = await bookingInScope(actor, ctx.params.id as string);
  ctx.requireRole('front_desk', 'manager');
  guard(booking, 'settle');
  let depositRefund = 0;
  if (booking.deposit_cents > 0) {
    depositRefund = await billed(() => refundPurchase(`hs-deposit-${booking.id}`));
  }
  const updated = await transaction(async (client) => {
    await client.query(
      `UPDATE bookings SET status = $2, deposit_refund_cents = $3 WHERE id = $1`,
      [booking.id, statusAfter('settle'), depositRefund],
    );
    await writeAudit(client, {
      bookingId: booking.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'settle',
      from: booking.status,
      to: statusAfter('settle'),
    });
    return reload(client, booking.id);
  });
  return json(200, { booking: presentBooking(updated) });
}

export const bookingRoutes: Route[] = [
  { method: 'GET', pattern: '/api/bookings', handle: listBookings },
  {
    method: 'GET',
    pattern: '/api/bookings/:id',
    handle: async (ctx): Promise<Reply> => {
      const actor = ctx.requireActor();
      const booking = await bookingInScope(actor, ctx.params.id as string);
      return json(200, { booking: presentBooking(booking) });
    },
  },
  {
    method: 'GET',
    pattern: '/api/bookings/:id/invoice',
    handle: async (ctx): Promise<Reply> => {
      const actor = ctx.requireActor();
      const booking = await bookingInScope(actor, ctx.params.id as string);
      return json(200, presentInvoice(booking));
    },
  },
  {
    method: 'GET',
    pattern: '/api/bookings/:id/audit',
    handle: async (ctx): Promise<Reply> => {
      const actor = ctx.requireActor();
      const booking = await bookingInScope(actor, ctx.params.id as string);
      const rows = await query<{
        at: Date;
        actor_name: string;
        actor_role: Role | 'system';
        action: string;
        from_status: string;
        to_status: string;
        reason: string | null;
      }>(
        pool,
        `SELECT at, actor_name, actor_role, action, from_status, to_status, reason
           FROM audit_events WHERE booking_id = $1 ORDER BY id`,
        [booking.id],
      );
      const events: AuditEvent[] = rows.map((row) => ({
        at: row.at.toISOString(),
        actor_name: row.actor_name,
        actor_role: row.actor_role,
        action: row.action,
        from: row.from_status,
        to: row.to_status,
        reason: row.reason,
      }));
      return json(200, { events });
    },
  },
  { method: 'POST', pattern: '/api/bookings/:id/pay', handle: payBalance },
  { method: 'POST', pattern: '/api/bookings/:id/cancel', handle: cancelBooking },
  { method: 'POST', pattern: '/api/bookings/:id/check-in', handle: checkIn },
  { method: 'POST', pattern: '/api/bookings/:id/overrun', handle: chargeOverrun },
  { method: 'POST', pattern: '/api/bookings/:id/check-out', handle: checkOut },
  { method: 'POST', pattern: '/api/bookings/:id/cleaning-fee', handle: cleaningFee },
  { method: 'POST', pattern: '/api/bookings/:id/settle', handle: settle },
  { method: 'POST', pattern: '/api/bookings/:id/override', handle: overrideBooking },
];
