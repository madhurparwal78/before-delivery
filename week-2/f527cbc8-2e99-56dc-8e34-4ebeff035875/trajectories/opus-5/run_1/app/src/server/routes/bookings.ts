import type { PoolClient } from 'pg';
import { config } from '../config.js';
import { now, plusSecondsCeil } from '../clock.js';
import { query, queryOne, withClient, type Db } from '../db.js';
import { empty, json, route, type Ctx } from '../http.js';
import { newId } from '../util.js';
import {
  ValidationError,
  cardDeclined,
  conflict,
  fieldMessages,
  illegalTransition,
  notFound,
} from '../errors.js';
import { callerActor } from '../auth.js';
import { writeAudit } from '../audit.js';
import { readCardToken } from '../domain/cards.js';
import { depositForDate } from '../domain/prices.js';
import { practice } from '../domain/practice.js';
import { formatInstant, wallTimeAt } from '../domain/time.js';
import {
  announceBookingChange,
  blockedOwnerIds,
  nextBookingNumber,
  onBarnDay,
  prepareDay,
  voidHoldDeposit,
} from '../domain/dayengine.js';
import {
  dayStatusNow,
  loadBarnDay,
  slotsWithState,
  type BarnDayRow,
} from '../domain/barndays.js';
import {
  authorisePayment,
  captureDeposit,
  depositPaymentForBooking,
  refundPayment,
  setCardOnFile,
  forfeitDeposit,
} from '../domain/payments.js';
import { queueRequestEmail } from '../services/mail.js';
import { bookingConfirmedEmail, cancellationEmail } from '../services/emails.js';
import { visibleBarnDay } from './shared.js';

/**
 * Bookings: holds that lapse at their stored instant, confirmations that capture the
 * deposit, cancellations judged against the cutoff in the practice zone, and the
 * waitlist. Every change runs under the barn day's row lock.
 */
export type BookingStatus =
  | 'held'
  | 'confirmed'
  | 'cancelled_in_time'
  | 'cancelled_late'
  | 'worked'
  | 'no_show'
  | 'excused'
  | 'released'
  | 'lapsed'
  | 'removed';

const GONE_HOLD_STATUSES: readonly BookingStatus[] = ['released', 'lapsed', 'removed'];

export interface BookingRow {
  id: string;
  number: number;
  status: BookingStatus;
  barn_day_id: string;
  slot_id: string;
  slot_time: string;
  horse_id: string;
  horse_name: string;
  owner_id: string;
  is_offer: boolean;
  hold_expires_at: Date | null;
  deposit_cents: number;
  share_cents: number | null;
  counts_for_trip: boolean;
}

const BOOKING_COLUMNS = `bk.id, bk.number::int AS number, bk.status, bk.barn_day_id, bk.slot_id,
  s.slot_time, bk.horse_id, h.name AS horse_name, bk.owner_id, bk.is_offer, bk.hold_expires_at,
  bk.deposit_cents, bk.share_cents, bk.counts_for_trip`;

export async function loadBooking(db: Db, id: string, lock = false): Promise<BookingRow | null> {
  if (lock) {
    const locked = await queryOne<{ id: string }>(db, 'SELECT id FROM bookings WHERE id = $1 FOR UPDATE', [id]);
    if (locked === null) return null;
  }
  return await queryOne<BookingRow>(
    db,
    `SELECT ${BOOKING_COLUMNS} FROM bookings bk
     JOIN slots s ON s.id = bk.slot_id JOIN horses h ON h.id = bk.horse_id
     WHERE bk.id = $1`,
    [id],
  );
}

export async function bookingJson(db: Db, booking: BookingRow): Promise<Record<string, unknown>> {
  const { timeZone } = await practice(db);
  const payment = await depositPaymentForBooking(db, booking.id);
  return {
    id: booking.id,
    number: booking.number,
    status: booking.status,
    barn_day_id: booking.barn_day_id,
    slot_id: booking.slot_id,
    slot_time: booking.slot_time,
    horse: { id: booking.horse_id, name: booking.horse_name },
    hold_expires_at:
      booking.status === 'held' && booking.hold_expires_at !== null
        ? formatInstant(booking.hold_expires_at, timeZone)
        : null,
    trip_share_cents: booking.share_cents,
    offer: booking.is_offer,
    deposit_cents: booking.deposit_cents,
    payment_id: payment === null ? null : payment.id,
  };
}

/** A booking the caller owns; a gone hold answers 404 on every route but confirm. */
async function callerBooking(db: Db, ctx: Ctx, id: string, lock = false): Promise<BookingRow> {
  const booking = await loadBooking(db, id, lock);
  if (booking === null) throw notFound();
  if (ctx.caller.role === 'owner' && booking.owner_id !== ctx.caller.userId) throw notFound();
  if (ctx.caller.role === 'barn_manager') throw notFound();
  return booking;
}

async function ownerIdentity(db: Db, ownerId: string): Promise<{ email: string; name: string }> {
  const row = await queryOne<{ email: string; name: string }>(
    db,
    'SELECT email, name FROM users WHERE id = $1',
    [ownerId],
  );
  if (row === null) throw new Error('owner vanished');
  return row;
}

async function emailContext(
  db: Db,
  day: BarnDayRow,
  booking: BookingRow,
): Promise<{ horseName: string; barnName: string; businessDate: string; slotTime: string; cutoff: string }> {
  const { timeZone } = await practice(db);
  return {
    horseName: booking.horse_name,
    barnName: day.barn_name,
    businessDate: day.business_date,
    slotTime: booking.slot_time,
    cutoff: `${formatInstant(day.cancellation_cutoff_at, timeZone).slice(0, 10)} ${wallTimeAt(
      day.cancellation_cutoff_at,
      timeZone,
    )} (${timeZone})`,
  };
}

/**
 * Cancelling the day removes its holds, makes each confirmed booking cancelled in
 * time, and refunds every captured deposit, forfeited ones included.
 */
export async function cancelDayBookings(
  db: PoolClient,
  day: BarnDayRow,
  ctx: Ctx,
  at: Date,
): Promise<void> {
  const { timeZone } = await practice(db);
  const holds = await query<{ id: string }>(
    db,
    `UPDATE bookings SET status = 'removed' WHERE barn_day_id = $1 AND status = 'held' RETURNING id`,
    [day.id],
  );
  for (const hold of holds) {
    await writeAudit(db, {
      actor: callerActor(ctx.caller),
      action: 'remove_hold',
      entityType: 'booking',
      entityId: hold.id,
      from: 'held',
      to: 'removed',
      at,
      requestId: ctx.requestId,
    });
    await voidHoldDeposit(db, hold.id, callerActor(ctx.caller), ctx.requestId, at);
  }

  const confirmed = await query<{ id: string }>(
    db,
    `SELECT id FROM bookings WHERE barn_day_id = $1 AND status = 'confirmed' ORDER BY number`,
    [day.id],
  );
  for (const row of confirmed) {
    const booking = await loadBooking(db, row.id, true);
    if (booking === null) continue;
    await query(
      db,
      `UPDATE bookings SET status = 'cancelled_in_time', decided_at = $2 WHERE id = $1`,
      [booking.id, at],
    );
    await writeAudit(db, {
      actor: callerActor(ctx.caller),
      action: 'cancel',
      entityType: 'booking',
      entityId: booking.id,
      from: 'confirmed',
      to: 'cancelled_in_time',
      at,
      requestId: ctx.requestId,
    });
    const owner = await ownerIdentity(db, booking.owner_id);
    const deposit = await depositPaymentForBooking(db, booking.id);
    let refunded = 0;
    if (deposit !== null && deposit.captured_cents - deposit.refunded_cents - deposit.applied_cents > 0) {
      refunded = deposit.captured_cents - deposit.refunded_cents - deposit.applied_cents;
      await refundPayment(db, {
        payment: deposit,
        amountCents: refunded,
        reason: 'day_cancelled',
        owner,
        horseId: booking.horse_id,
        actor: callerActor(ctx.caller),
        requestId: ctx.requestId,
        at,
        timeZone,
      });
    }
    const context = await emailContext(db, day, booking);
    const message = cancellationEmail(context, false, refunded > 0 ? 'refund' : 'none', refunded);
    await queueRequestEmail(db, {
      to: owner.email,
      subject: message.subject,
      body: message.body,
      dedupeKey: `cancelled:${booking.id}`,
    });
    await announceBookingChange(db, day.id, booking.id, 'booking_moved', at);
  }
}

export function registerBookingRoutes(): void {
  route({
    method: 'POST',
    path: '/api/barn-days/:id/bookings',
    roles: ['owner'],
    bodyKind: 'json',
    rate: 'hold',
    handler: async (ctx: Ctx) => {
      const barnDayId = ctx.params.id as string;
      const context = {
        actor: callerActor(ctx.caller),
        requestId: ctx.requestId,
        queueKind: 'request' as const,
      };
      // The lapse record and the offer pass commit first; they belong to the lapse and
      // the offer, not to this claim.
      await prepareDay(barnDayId, context);

      const body = ctx.body<{ slot_id?: unknown; horse_id?: unknown; card_token?: unknown }>();
      type HoldOutcome =
        | { kind: 'declined'; declineCode: string }
        | { kind: 'held'; booking: Record<string, unknown> };
      const result = await onBarnDay<HoldOutcome>(barnDayId, context, async (db, day) => {
        const at = now();
        await visibleBarnDay(db, ctx.caller, barnDayId, at);

        const horseId = typeof body.horse_id === 'string' ? body.horse_id : '';
        const slotId = typeof body.slot_id === 'string' ? body.slot_id : '';
        const horse = await queryOne<{ id: string; barn_id: string; name: string }>(
          db,
          'SELECT id, barn_id, name FROM horses WHERE id = $1 AND owner_id = $2',
          [horseId, ctx.caller.userId],
        );
        if (horse === null) throw notFound();
        const slot = await queryOne<{ id: string }>(
          db,
          'SELECT id FROM slots WHERE id = $1 AND barn_day_id = $2',
          [slotId, day.id],
        );
        if (slot === null) throw notFound();

        const blocked = await blockedOwnerIds(db);
        if (blocked.has(ctx.caller.userId)) throw conflict('account_blocked');

        const sameHorse = await queryOne<{ id: string }>(
          db,
          `SELECT id FROM bookings WHERE barn_day_id = $1 AND horse_id = $2
             AND status IN ('held','confirmed','worked','no_show')`,
          [day.id, horse.id],
        );
        if (sameHorse !== null) throw conflict('horse_already_booked');

        if (day.status !== 'published' || at.getTime() >= day.starts_at.getTime()) {
          throw conflict('not_open_for_booking');
        }

        const slots = await slotsWithState(db, day.id, at);
        const openSlots = slots.filter((candidate) => candidate.booking_id === null);
        if (openSlots.length === 0) throw conflict('day_full');
        const wanted = slots.find((candidate) => candidate.id === slot.id);
        if (wanted === undefined || wanted.booking_id !== null) throw conflict('slot_taken');

        if (horse.barn_id !== day.barn_id) {
          throw new ValidationError({ horse_id: fieldMessages.required });
        }

        const depositCents = await depositForDate(db, day.business_date);
        const cardToken = depositCents > 0 ? readCardToken(body.card_token) : null;

        let paymentId: string | null = null;
        if (cardToken !== null) {
          await setCardOnFile(db, ctx.caller.userId, cardToken);
          const authorised = await authorisePayment(db, {
            kind: 'deposit',
            ownerId: ctx.caller.userId,
            amountCents: depositCents,
            cardToken,
            actor: callerActor(ctx.caller),
            requestId: ctx.requestId,
            at,
          });
          // A declined card leaves its one payment row and the card on file behind, so
          // this transaction commits and the 402 is raised after it.
          if (!authorised.approved) {
            return { kind: 'declined', declineCode: authorised.declineCode ?? 'do_not_honor' };
          }
          paymentId = authorised.payment.id;
        }

        const bookingId = newId();
        const number = await nextBookingNumber(db);
        const holdExpiresAt = plusSecondsCeil(at, config.bookingHoldSeconds);
        await query(
          db,
          `INSERT INTO bookings (id, number, barn_day_id, slot_id, horse_id, owner_id, status,
                                 hold_expires_at, deposit_cents, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,'held',$7,$8,$9)`,
          [bookingId, number, day.id, slot.id, horse.id, ctx.caller.userId, holdExpiresAt, depositCents, at],
        );
        if (paymentId !== null) {
          await query(db, 'UPDATE payments SET booking_id = $2 WHERE id = $1', [paymentId, bookingId]);
        }
        await writeAudit(db, {
          actor: callerActor(ctx.caller),
          action: 'hold',
          entityType: 'booking',
          entityId: bookingId,
          to: 'held',
          at,
          requestId: ctx.requestId,
        });
        const created = await loadBooking(db, bookingId);
        if (created === null) throw new Error('booking vanished');
        return { kind: 'held', booking: await bookingJson(db, created) };
      });
      if (result === null) throw notFound();
      if (result.kind === 'declined') throw cardDeclined(result.declineCode);
      return json(201, result.booking);
    },
  });

  route({
    method: 'POST',
    path: '/api/bookings/:id/confirm',
    roles: ['owner'],
    bodyKind: 'json',
    rate: 'hold',
    handler: async (ctx: Ctx) => {
      const bookingId = ctx.params.id as string;
      const located = await withClient((db) => loadBooking(db, bookingId));
      if (located === null) throw notFound();
      if (ctx.caller.role === 'owner' && located.owner_id !== ctx.caller.userId) throw notFound();

      const context = {
        actor: callerActor(ctx.caller),
        requestId: ctx.requestId,
        queueKind: 'request' as const,
      };
      const result = await onBarnDay(located.barn_day_id, context, async (db, day) => {
        const at = now();
        const booking = await loadBooking(db, bookingId, true);
        if (booking === null) throw notFound();
        // Confirming a hold that lapsed, or that a start or day cancel removed.
        if (GONE_HOLD_STATUSES.includes(booking.status)) throw conflict('hold_expired');
        if (booking.status === 'confirmed') return await bookingJson(db, booking);
        if (booking.status !== 'held') throw illegalTransition(booking.status, 'confirm');

        const { timeZone } = await practice(db);
        await query(db, `UPDATE bookings SET status = 'confirmed', hold_expires_at = NULL WHERE id = $1`, [
          booking.id,
        ]);
        await writeAudit(db, {
          actor: callerActor(ctx.caller),
          action: 'confirm',
          entityType: 'booking',
          entityId: booking.id,
          from: 'held',
          to: 'confirmed',
          at,
          requestId: ctx.requestId,
        });

        const deposit = await depositPaymentForBooking(db, booking.id);
        if (deposit !== null && deposit.status === 'authorized') {
          const owner = await ownerIdentity(db, booking.owner_id);
          await captureDeposit(db, {
            payment: deposit,
            owner,
            horseId: booking.horse_id,
            horseName: booking.horse_name,
            businessDate: day.business_date,
            disposition: 'held',
            actor: callerActor(ctx.caller),
            requestId: ctx.requestId,
            at,
            timeZone,
          });
        }

        const owner = await ownerIdentity(db, booking.owner_id);
        const message = bookingConfirmedEmail(await emailContext(db, day, booking));
        await queueRequestEmail(db, {
          to: owner.email,
          subject: message.subject,
          body: message.body,
          dedupeKey: `booking_confirmed:${booking.id}`,
        });

        await announceBookingChange(db, day.id, booking.id, 'booking_added', at);
        const confirmed = await loadBooking(db, booking.id);
        if (confirmed === null) throw new Error('booking vanished');
        return await bookingJson(db, confirmed);
      });
      if (result === null) throw notFound();
      return json(200, result);
    },
  });

  route({
    method: 'DELETE',
    path: '/api/bookings/:id',
    roles: ['owner'],
    handler: async (ctx: Ctx) => {
      const bookingId = ctx.params.id as string;
      const located = await withClient((db) => loadBooking(db, bookingId));
      if (located === null) throw notFound();
      if (located.owner_id !== ctx.caller.userId) throw notFound();
      if (GONE_HOLD_STATUSES.includes(located.status)) throw notFound();

      const context = {
        actor: callerActor(ctx.caller),
        requestId: ctx.requestId,
        queueKind: 'request' as const,
      };
      const done = await onBarnDay(located.barn_day_id, context, async (db) => {
        const at = now();
        const booking = await loadBooking(db, bookingId, true);
        if (booking === null) throw notFound();
        if (GONE_HOLD_STATUSES.includes(booking.status)) throw notFound();
        if (booking.status !== 'held') throw illegalTransition(booking.status, 'release');
        await query(db, `UPDATE bookings SET status = 'released' WHERE id = $1`, [booking.id]);
        await writeAudit(db, {
          actor: callerActor(ctx.caller),
          action: 'release',
          entityType: 'booking',
          entityId: booking.id,
          from: 'held',
          to: 'released',
          at,
          requestId: ctx.requestId,
        });
        await voidHoldDeposit(db, booking.id, callerActor(ctx.caller), ctx.requestId, at);
        return true;
      });
      if (done === null) throw notFound();
      return empty(204);
    },
  });

  route({
    method: 'GET',
    path: '/api/bookings/:id/cancellation-preview',
    roles: ['owner', 'farrier'],
    tokenAccess: 'read_only',
    handler: async (ctx: Ctx) => {
      const body = await withClient(async (db) => {
        const booking = await callerBooking(db, ctx, ctx.params.id as string);
        if (GONE_HOLD_STATUSES.includes(booking.status)) throw notFound();
        const day = await loadBarnDay(db, booking.barn_day_id);
        if (day === null) throw notFound();
        const { timeZone } = await practice(db);
        const at = now();
        const late = at.getTime() >= day.cancellation_cutoff_at.getTime();
        const deposit = await depositPaymentForBooking(db, booking.id);
        const captured =
          deposit === null || deposit.status === 'authorized' || deposit.status === 'voided'
            ? 0
            : deposit.captured_cents - deposit.refunded_cents - deposit.applied_cents;
        return {
          late,
          cutoff_at: formatInstant(day.cancellation_cutoff_at, timeZone),
          deposit_cents: captured,
          deposit_outcome: captured === 0 ? 'none' : late ? 'keep' : 'refund',
        };
      });
      return json(200, body);
    },
  });

  route({
    method: 'POST',
    path: '/api/bookings/:id/cancel',
    roles: ['owner', 'farrier'],
    bodyKind: 'json',
    handler: async (ctx: Ctx) => {
      const bookingId = ctx.params.id as string;
      const located = await withClient(async (db) => callerBooking(db, ctx, bookingId));
      const context = {
        actor: callerActor(ctx.caller),
        requestId: ctx.requestId,
        queueKind: 'request' as const,
      };
      const result = await onBarnDay(located.barn_day_id, context, async (db, day) => {
        // One stored decision instant settles the verdict, the deposit and the ledger.
        const decidedAt = now();
        const booking = await loadBooking(db, bookingId, true);
        if (booking === null) throw notFound();
        if (GONE_HOLD_STATUSES.includes(booking.status)) throw notFound();
        if (booking.status !== 'confirmed') throw illegalTransition(booking.status, 'cancel');
        if (day.status === 'in_progress' || day.status === 'closed' || day.status === 'cancelled') {
          throw conflict('day_started');
        }

        const { timeZone } = await practice(db);
        const late = decidedAt.getTime() >= day.cancellation_cutoff_at.getTime();
        const status = late ? 'cancelled_late' : 'cancelled_in_time';
        await query(db, 'UPDATE bookings SET status = $2, decided_at = $3 WHERE id = $1', [
          booking.id,
          status,
          decidedAt,
        ]);
        await writeAudit(db, {
          actor: callerActor(ctx.caller),
          action: 'cancel',
          entityType: 'booking',
          entityId: booking.id,
          from: 'confirmed',
          to: status,
          at: decidedAt,
          requestId: ctx.requestId,
        });

        const owner = await ownerIdentity(db, booking.owner_id);
        const deposit = await depositPaymentForBooking(db, booking.id);
        const capturedRemaining =
          deposit === null || deposit.status === 'authorized' || deposit.status === 'voided'
            ? 0
            : deposit.captured_cents - deposit.refunded_cents - deposit.applied_cents;
        let depositOutcome: 'refund' | 'keep' | 'none' = 'none';
        let refundedCents = 0;
        if (deposit !== null && capturedRemaining > 0) {
          if (late) {
            depositOutcome = 'keep';
            await forfeitDeposit(db, deposit, callerActor(ctx.caller), ctx.requestId, decidedAt);
          } else {
            depositOutcome = 'refund';
            refundedCents = capturedRemaining;
            await refundPayment(db, {
              payment: deposit,
              amountCents: refundedCents,
              reason: 'cancelled_in_time',
              owner,
              horseId: booking.horse_id,
              actor: callerActor(ctx.caller),
              requestId: ctx.requestId,
              at: decidedAt,
              timeZone,
            });
          }
        }

        const message = cancellationEmail(
          await emailContext(db, day, booking),
          late,
          depositOutcome,
          depositOutcome === 'refund' ? refundedCents : capturedRemaining,
        );
        await queueRequestEmail(db, {
          to: owner.email,
          subject: message.subject,
          body: message.body,
          dedupeKey: `cancelled:${booking.id}`,
        });

        await announceBookingChange(db, day.id, booking.id, 'booking_moved', decidedAt);
        const cancelled = await loadBooking(db, booking.id);
        if (cancelled === null) throw new Error('booking vanished');
        return {
          booking: await bookingJson(db, cancelled),
          trip_share_applies: late,
          decided_at: formatInstant(decidedAt, timeZone),
          deposit_outcome: depositOutcome,
          refunded_cents: refundedCents,
        };
      });
      if (result === null) throw notFound();
      return json(200, result);
    },
  });

  route({
    method: 'GET',
    path: '/api/my/bookings',
    roles: ['owner'],
    handler: async (ctx: Ctx) => {
      const rows = await withClient(async (db) => {
        const ids = await query<{ id: string }>(
          db,
          `SELECT bk.id FROM bookings bk
           WHERE bk.owner_id = $1 AND bk.status NOT IN ('released','lapsed','removed')
             AND NOT (bk.status = 'held' AND bk.hold_expires_at <= $2)
           ORDER BY bk.number`,
          [ctx.caller.userId, now()],
        );
        const bookings: Record<string, unknown>[] = [];
        for (const row of ids) {
          const booking = await loadBooking(db, row.id);
          if (booking !== null) bookings.push(await bookingJson(db, booking));
        }
        return bookings;
      });
      return json(200, rows);
    },
  });

  route({
    method: 'POST',
    path: '/api/barn-days/:id/waitlist',
    roles: ['owner'],
    bodyKind: 'json',
    handler: async (ctx: Ctx) => {
      const barnDayId = ctx.params.id as string;
      const context = {
        actor: callerActor(ctx.caller),
        requestId: ctx.requestId,
        queueKind: 'request' as const,
      };
      await prepareDay(barnDayId, context);
      const body = ctx.body<{ horse_id?: unknown; card_token?: unknown }>();
      const result = await onBarnDay(barnDayId, context, async (db, day) => {
        const at = now();
        await visibleBarnDay(db, ctx.caller, barnDayId, at);
        const horseId = typeof body.horse_id === 'string' ? body.horse_id : '';
        const horse = await queryOne<{ id: string; barn_id: string; name: string }>(
          db,
          'SELECT id, barn_id, name FROM horses WHERE id = $1 AND owner_id = $2',
          [horseId, ctx.caller.userId],
        );
        if (horse === null) throw notFound();

        const blocked = await blockedOwnerIds(db);
        if (blocked.has(ctx.caller.userId)) throw conflict('account_blocked');

        const sameHorse = await queryOne<{ id: string }>(
          db,
          `SELECT id FROM bookings WHERE barn_day_id = $1 AND horse_id = $2
             AND status IN ('held','confirmed','worked','no_show')`,
          [day.id, horse.id],
        );
        if (sameHorse !== null) throw conflict('horse_already_booked');

        const already = await queryOne<{ id: string }>(
          db,
          'SELECT id FROM waitlist_entries WHERE barn_day_id = $1 AND horse_id = $2',
          [day.id, horse.id],
        );
        if (already !== null) throw conflict('already_on_waitlist');

        const status = await dayStatusNow(db, day, at);
        if (status !== 'full') throw conflict('day_not_full');

        if (horse.barn_id !== day.barn_id) {
          throw new ValidationError({ horse_id: fieldMessages.required });
        }

        const depositCents = await depositForDate(db, day.business_date);
        if (depositCents > 0) {
          const token = readCardToken(body.card_token);
          await setCardOnFile(db, ctx.caller.userId, token);
        }

        const next = await queryOne<{ next: number }>(
          db,
          'SELECT COALESCE(MAX(position),0) + 1 AS next FROM waitlist_entries WHERE barn_day_id = $1',
          [day.id],
        );
        const entryId = newId();
        const position = next?.next ?? 1;
        await query(
          db,
          `INSERT INTO waitlist_entries (id, barn_day_id, horse_id, owner_id, position, joined_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [entryId, day.id, horse.id, ctx.caller.userId, position, at],
        );
        return { id: entryId, position, horse: { id: horse.id, name: horse.name } };
      });
      if (result === null) throw notFound();
      return json(201, result);
    },
  });

  route({
    method: 'PUT',
    path: '/api/my/card',
    roles: ['owner'],
    bodyKind: 'json',
    rate: 'payment',
    handler: async (ctx: Ctx) => {
      const token = readCardToken(ctx.body<{ card_token?: unknown }>().card_token);
      const last4 = await withClient((db) => setCardOnFile(db, ctx.caller.userId, token));
      return json(200, { last4 });
    },
  });
}

