import type { AuthedRequest } from '../api-core.js';
import { callerOf, forbidden } from '../api-core.js';
import { ApiError, monthName } from '../errors.js';
import { withContentionRetry } from '../db.js';
import { parseJsonBody, type Handler, type RouteContext } from '../pipeline.js';
import { requireIdempotencyKey, bodyFingerprint, checkIdempotency, storeIdempotentResponse } from '../idempotency.js';
import { addDays, formatHours, monthOf, todayInZone } from '../time.js';
import { bookingObject, hourBankObject, monthClosed } from '../serialize.js';
import {
  applyLapses,
  getBooking,
  graceInstant,
  checkInOpensAt,
  invalidTransition,
  shelfDaysFull,
  timeIsFree,
  type BookingRow,
} from '../booking.js';
import { currentDocument, documentTypeName, type DocumentType } from '../documents.js';
import { recordLedgerPair } from '../ledgerpair.js';
import { blockLabel, cancelEmailBody } from '../copy.js';
import { newId, roundCents } from '../util.js';
import { getPersonEmail } from './helpers.js';
import {
  blockEndInstant,
  blockStartInstant,
  isQuarterTime,
  isEndTime,
  resolveOrError,
  loadStation,
  stationNameOf,
  lockMonths,
  deliverKbItems,
  type Caller,
} from './bookings.js';
import type { PoolClient } from 'pg';
import type { Response } from 'express';

const nowDate = (): Date => new Date();

interface CallerCtx {
  caller: Caller;
  person: { id: string; role: string; member_id: string | null };
  kitchen: Caller['kitchen'];
}

async function getBookingScoped(client: PoolClient, caller: Caller, bookingId: string): Promise<BookingRow> {
  const booking = await getBooking(client, bookingId);
  if (!booking || booking.kitchen_id !== caller.kitchen.id) throw new ApiError('not_found');
  if (caller.person.role === 'member' && booking.member_id !== caller.person.member_id) throw new ApiError('not_found');
  return booking;
}

function monthClosedError(month: string): ApiError {
  return new ApiError('month_closed', {}, (n) => (n === 'monthName' ? monthName(month) : ''));
}

async function queueMail(client: PoolClient, to: string, subject: string, body: string): Promise<void> {
  await client.query(`INSERT INTO outbox (id, kind, payload) VALUES ($1,'mail',$2::jsonb)`, [
    newId('out'),
    JSON.stringify({ kind: 'mail', to, subject, body }),
  ]);
}

async function labelOf(client: PoolClient, booking: BookingRow): Promise<string> {
  const stationName = await stationNameOf(client, booking.station_id);
  return blockLabel({ stationName, kind: booking.kind, localDate: booking.local_date, localStart: booking.local_start, localEnd: booking.local_end, days: booking.days });
}

/** Deliver kb items now when billing is up, else queue them; returns whether they are pending. */
async function deliverOrQueue(client: PoolClient, ctx: RouteContext, itemIds: string[]): Promise<boolean> {
  if (itemIds.length === 0) return false;
  if (await ctx.killbill.reachable()) {
    try {
      await deliverKbItems(client, ctx, itemIds, new Map());
      return false;
    } catch {
      // fall through to queue
    }
  }
  await client.query(`INSERT INTO outbox (id, kind, payload) VALUES ($1,'kb_record',$2::jsonb)`, [
    newId('out'),
    JSON.stringify({ itemIds }),
  ]);
  return true;
}

// ---------------------------------------------------------------------------
// POST /api/bookings/{id}/cancel — also Discard on a held ticket
// ---------------------------------------------------------------------------
export const cancelBooking: Handler = async (req, res, ctx) => {
  const caller = callerOf(req);
  if (caller.person.role === 'shift_lead') throw forbidden();
  const key = requireIdempotencyKey(req.headers['idempotency-key'] as string | undefined);
  const bookingId = String(String(req.params.id));
  const path = `/api/bookings/${bookingId}/cancel`;
  const fingerprint = bodyFingerprint(parseJsonBody(req.rawBody));
  await withContentionRetry(async (client) => {
    const booking = await getBookingScoped(client, { person: caller.person, kitchen: caller.kitchen }, bookingId);
    const replay = await checkIdempotency(client, caller.person.id, key, 'POST', path, fingerprint);
    if (replay) {
      res.status(replay.status).json(JSON.parse(replay.body));
      return;
    }
    const instant = nowDate();
    await lockMonths(client, caller.kitchen.id, [booking.member_id], [monthOf(booking.local_date)]);
    await applyLapses(client, bookingId, instant, ctx.config.noShowGraceSeconds);
    const fresh = (await getBooking(client, bookingId))!;
    const personArg = caller.person;
    const kitchenArg = caller.kitchen;
    const finish = async (row: BookingRow): Promise<void> => {
      const bank = await hourBankObject(client, row.member_id, monthOf(row.local_date));
      const body = { booking: await bookingObject(client, row, personArg, kitchenArg, instant, ctx.config.noShowGraceSeconds), hourBank: bank };
      const responseBody = JSON.stringify(body);
      await storeIdempotentResponse(client, caller.person.id, key, 200, responseBody);
      res.status(200).json(JSON.parse(responseBody));
    };
    if (fresh.status === 'held') {
      if (caller.person.role !== 'member' || caller.person.member_id !== fresh.member_id) throw forbidden();
      await client.query(`UPDATE bookings SET status='cancelled_free', version=version+1 WHERE id=$1`, [bookingId]);
      await finish((await getBooking(client, bookingId))!);
      return;
    }
    if (fresh.status !== 'confirmed') throw invalidTransition(fresh, 'cancel');
    if (await monthClosed(client, caller.kitchen.id, monthOf(fresh.local_date))) throw monthClosedError(monthOf(fresh.local_date));

    // The 48-hour cutoff runs against the current block's start in kitchen time.
    const cutoff = fresh.start_at.getTime() - 48 * 3600 * 1000;
    const late = nowDate().getTime() > cutoff;
    const feeCents = late ? roundCents(fresh.charge_cents / 2) : 0;
    const kbItemIds: string[] = [];
    if (late) {
      kbItemIds.push(
        ...(await recordLedgerPair(client, fresh, {
          hours: 0,
          ledgerKind: 'cancel',
          kbItems: [{ kind: 'late_fee', bookingId: fresh.id, description: `Late cancellation ${fresh.id}`, amountCents: feeCents }],
        })),
      );
    }
    kbItemIds.push(
      ...(await recordLedgerPair(client, fresh, {
        hours: fresh.kind === 'hourly' ? -Number(fresh.hours) : 0,
        ledgerKind: 'cancel',
        kbItems: [{ kind: 'cancelled_credit', bookingId: fresh.id, description: `Cancelled ${fresh.id}`, amountCents: -fresh.charge_cents }],
      })),
    );
    await client.query(`UPDATE bookings SET status=$2, penalty_cents=$3, version=version+1 WHERE id=$1`, [
      bookingId,
      late ? 'cancelled_late' : 'cancelled_free',
      feeCents,
    ]);
    await queueMail(client, await getPersonEmail(client, fresh.member_id), `Booking cancelled: ${await labelOf(client, fresh)}`, cancelEmailBody(late ? feeCents : null));
    await deliverOrQueue(client, ctx, kbItemIds);
    await finish((await getBooking(client, bookingId))!);
  });
};

// ---------------------------------------------------------------------------
// POST /api/bookings/{id}/check-in, /check-out, /no-show
// ---------------------------------------------------------------------------
export const checkIn: Handler = async (req, res, ctx) => stateAction(req, res, ctx, 'check_in');
export const checkOut: Handler = async (req, res, ctx) => stateAction(req, res, ctx, 'check_out');
export const markNoShow: Handler = async (req, res, ctx) => stateAction(req, res, ctx, 'no_show');

async function stateAction(req: AuthedRequest, res: Response, ctx: RouteContext, action: 'check_in' | 'check_out' | 'no_show'): Promise<void> {
  const caller = callerOf(req);
  if (caller.person.role === 'member') throw forbidden();
  const bookingId = String(String(req.params.id));
  await withContentionRetry(async (client) => {
    const instant = nowDate();
    const booking = await getBooking(client, bookingId);
    if (!booking || booking.kitchen_id !== caller.kitchen.id) throw new ApiError('not_found');
    await lockMonths(client, caller.kitchen.id, [booking.member_id], [monthOf(booking.local_date)]);
    await applyLapses(client, bookingId, instant, ctx.config.noShowGraceSeconds);
    const fresh = (await getBooking(client, bookingId))!;
    if (await monthClosed(client, caller.kitchen.id, monthOf(fresh.local_date))) throw monthClosedError(monthOf(fresh.local_date));
    if (action === 'check_in') {
      if (fresh.status !== 'confirmed') throw invalidTransition(fresh, 'check_in');
      const grace = graceInstant(fresh, ctx.config.noShowGraceSeconds);
      if (instant.getTime() < checkInOpensAt(fresh).getTime() || instant.getTime() >= grace.getTime()) {
        throw invalidTransition(fresh, 'check_in');
      }
      const today = todayInZone(instant, caller.kitchen.time_zone);
      const errors: Record<string, string> = {};
      for (const type of caller.kitchen.required_documents) {
        const doc = await currentDocument(client, fresh.member_id, type as DocumentType, today);
        if (!doc) {
          errors.documents = `No approved ${documentTypeName(type as DocumentType)} on file; check-in is refused.`;
          break;
        }
        if (doc.daysRemaining < 0) {
          errors.documents = `The ${documentTypeName(type as DocumentType)} expired on ${doc.row.expiry_date}; check-in is refused.`;
          break;
        }
      }
      if (Object.keys(errors).length > 0) throw new ApiError('validation_failed', { errors });
      await client.query(`UPDATE bookings SET status='checked_in', version=version+1 WHERE id=$1`, [bookingId]);
    } else if (action === 'check_out') {
      if (fresh.status !== 'checked_in') throw invalidTransition(fresh, 'check_out');
      await client.query(`UPDATE bookings SET status='completed', version=version+1 WHERE id=$1`, [bookingId]);
    } else {
      if (fresh.status !== 'confirmed') throw invalidTransition(fresh, 'no_show');
      if (instant.getTime() < fresh.start_at.getTime() || instant.getTime() >= graceInstant(fresh, ctx.config.noShowGraceSeconds).getTime()) {
        throw invalidTransition(fresh, 'no_show');
      }
      await client.query(`UPDATE bookings SET status='no_show', version=version+1 WHERE id=$1`, [bookingId]);
    }
    const row = (await getBooking(client, bookingId))!;
    res.status(200).json({ booking: await bookingObject(client, row, caller.person, caller.kitchen, instant, ctx.config.noShowGraceSeconds) });
  });
}

// ---------------------------------------------------------------------------
// POST /api/bookings/{id}/move
// ---------------------------------------------------------------------------
export const moveBooking: Handler = async (req, res, ctx) => {
  const caller = callerOf(req);
  if (caller.person.role === 'member') throw forbidden();
  const bookingId = String(String(req.params.id));
  const body = parseJsonBody(req.rawBody) as Record<string, unknown>;
  await withContentionRetry(async (client) => {
    const instant = nowDate();
    const booking = await getBooking(client, bookingId);
    if (!booking || booking.kitchen_id !== caller.kitchen.id) throw new ApiError('not_found');
    const fresh = (await getBooking(client, bookingId))!;

    // A move to a station of another kind is refused as the only error.
    const stationId = typeof body.stationId === 'string' ? body.stationId : '';
    const target = stationId ? await loadStation(client, caller.kitchen.id, stationId).catch(() => null) : null;
    if (target && target.kind !== fresh.kind) {
      throw new ApiError('validation_failed', { errors: { stationId: 'Move a block to a station of the same kind.' } });
    }
    const errors: Record<string, string> = {};
    const version = Number(body.version);
    if (!Number.isInteger(version)) errors.version = 'Reload and try again.';
    const tz = caller.kitchen.time_zone;
    const newDate = typeof body.date === 'string' ? body.date : '';
    let newStart: string | null = null;
    let newEnd: string | null = null;
    let newDays: number | null = null;
    if (fresh.kind === 'hourly') {
      newStart = typeof body.start === 'string' ? body.start : null;
      newEnd = typeof body.end === 'string' ? body.end : null;
      if (newStart === null || !isQuarterTime(newStart)) errors.start = 'Times must fall on the quarter hour.';
      if (newEnd === null || !isEndTime(newEnd)) errors.end = 'Times must fall on the quarter hour.';
      if (!errors.start && !errors.end) {
        const hours = (newEnd === '24:00' ? 24 : Number(newEnd!.slice(0, 2)) + Number(newEnd!.slice(3)) / 60) - (Number(newStart!.slice(0, 2)) + Number(newStart!.slice(3)) / 60);
        if (hours <= 0) errors.end = 'End must be after start on the same day.';
        else if (hours < 1) errors.end = 'A block must be at least 1 hour.';
        else if (hours > 12) errors.end = 'A block can be at most 12 hours.';
      }
    } else {
      newDays = typeof body.days === 'number' ? body.days : null;
      if (newDays === null || !Number.isInteger(newDays) || newDays < 1 || newDays > 31) errors.days = 'Shelf bookings run 1 to 31 days.';
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || Number.isNaN(Date.parse(`${newDate}T00:00:00Z`))) errors.date = 'Use a date in the form YYYY-MM-DD.';
    const allowedKeys = fresh.kind === 'hourly' ? ['stationId', 'date', 'start', 'end', 'version'] : ['stationId', 'date', 'days', 'version'];
    for (const key of Object.keys(body)) {
      if (!allowedKeys.includes(key)) errors[key] = 'This field cannot be set.';
    }
    if (Object.keys(errors).length > 0) throw new ApiError('validation_failed', { errors });

    const newStartInstRaw = fresh.kind === 'hourly' ? resolveOrError(newDate, newStart!, tz, 'start', errors) : blockStartInstant(newDate, null, tz);
    const newEndInstRaw = blockEndInstant(newDate, fresh.kind === 'hourly' ? newEnd : null, newDays, fresh.kind, tz);
    if (Object.keys(errors).length > 0 || !newStartInstRaw || !newEndInstRaw) throw new ApiError('validation_failed', { errors });
    const newStartInst: Date = newStartInstRaw;
    const newEndInst: Date = newEndInstRaw;
    if (newEndInst.getTime() <= instant.getTime()) {
      throw new ApiError('validation_failed', { errors: { [fresh.kind === 'hourly' ? 'end' : 'date']: 'This block has already ended.' } });
    }

    if (fresh.status !== 'confirmed') throw invalidTransition(fresh, 'move');
    if (version !== fresh.version) {
      throw new ApiError(
        'stale_version',
        { current: await bookingObject(client, fresh, caller.person, caller.kitchen, instant, ctx.config.noShowGraceSeconds) },
        (n) => (n === 'action' ? 'move' : ''),
      );
    }
    const oldMonth = monthOf(fresh.local_date);
    const newMonth = monthOf(newDate);
    if (await monthClosed(client, caller.kitchen.id, oldMonth)) throw monthClosedError(oldMonth);
    if (await monthClosed(client, caller.kitchen.id, newMonth)) throw monthClosedError(newMonth);
    await lockMonths(client, caller.kitchen.id, [fresh.member_id], [oldMonth, newMonth]);

    const fullDays: string[] = [];
    if (target!.kind === 'hourly') {
      if (!(await timeIsFree(client, target!.id, newStartInst, newEndInst, fresh.id))) {
        throw new ApiError(
          'block_taken',
          { taken: [{ stationId: target!.id, stationName: target!.name, date: newDate, start: newStart, end: newEnd }] },
          (n) => (n === 'station' ? target!.name : n === 'start' ? (newStart ?? '') : ''),
        );
      }
    } else {
      const days: string[] = [];
      for (let d = 0; d < (newDays ?? 1); d++) days.push(addDays(newDate, d));
      const full = await shelfDaysFull(client, target!.id, target!.capacity ?? 1, days, fresh.id);
      if (full.length > 0) {
        const first = full[0];
        throw new ApiError(
          'block_taken',
          { taken: full.map((day) => ({ stationId: target!.id, stationName: target!.name, date: day, start: null, end: null })) },
          (n) => (n === 'station' ? target!.name : n === 'start' ? first : ''),
          `${target!.name} ${first} was taken.`,
        );
      }
    }
    const lateErrors: Record<string, string> = {};
    const oos = await client.query<{ id: string }>(
      `SELECT id FROM out_of_service_windows WHERE station_id=$1 AND start_at < $3 AND end_at > $2`,
      [target!.id, newStartInst, newEndInst],
    );
    if (oos.rows.length > 0) lateErrors.stationId = `${target!.name} is out of service then.`;
    if (fresh.kind === 'hourly') {
      // The target month is checked as if the old block's hours had been returned.
      const hours = Number(fresh.hours);
      const member = await client.query<{ allowance_hours: number }>(`SELECT allowance_hours FROM members WHERE id=$1`, [fresh.member_id]);
      const used = Number(
        (await client.query<{ sum: string | null }>(`SELECT COALESCE(sum(hours),0)::text AS sum FROM hour_ledger WHERE member_id=$1 AND month=$2`, [fresh.member_id, newMonth])).rows[0].sum ?? 0,
      );
      const returned = oldMonth === newMonth ? hours : 0;
      const balance = Math.max(0, member.rows[0].allowance_hours - (used - returned));
      const needed = hours - returned;
      if (needed > balance) {
        lateErrors.hours = `That needs ${formatHours(needed)} hours; you have ${formatHours(balance)} left for ${monthName(newMonth)}.`;
      }
    }
    if (Object.keys(lateErrors).length > 0) throw new ApiError('validation_failed', { errors: lateErrors });

    const oldLabel = await labelOf(client, fresh);
    const oldCharge = fresh.charge_cents;
    const price = await priceMove(client, target!, caller.kitchen.peak_windows, fresh.kind, newDate, newStart, newEnd, newDays, newStartInst);
    const updated = await client.query<BookingRow>(
      `UPDATE bookings SET station_id=$2, local_date=$3, local_start=$4, local_end=$5, days=$6, start_at=$7, end_at=$8,
        charge_cents=$9, hours=$10, peak_hours=$11, conflict=false, version=version+1
       WHERE id=$1 RETURNING *`,
      [bookingId, target!.id, newDate, newStart, newEnd, newDays, newStartInst, newEndInst, price.chargeCents, price.hours, price.peakHours],
    );
    const row = updated.rows[0];
    const kbItemIds: string[] = [];
    kbItemIds.push(
      ...(await recordLedgerPair(client, fresh, {
        hours: fresh.kind === 'hourly' ? -Number(fresh.hours) : 0,
        ledgerKind: 'move_out',
        kbItems: [{ kind: 'moved_credit', bookingId: fresh.id, description: `Moved ${fresh.id}`, amountCents: -oldCharge }],
      })),
    );
    const newLabel = blockLabel({ stationName: target!.name, kind: row.kind, localDate: row.local_date, localStart: row.local_start, localEnd: row.local_end, days: row.days });
    kbItemIds.push(
      ...(await recordLedgerPair(client, row, {
        hours: row.kind === 'hourly' ? Number(row.hours) : 0,
        ledgerKind: 'move_in',
        kbItems: [{ kind: 'booking', bookingId: row.id, description: `Booking ${row.id} ${newLabel}`, amountCents: row.charge_cents }],
      })),
    );
    const email = await getPersonEmail(client, row.member_id);
    const business = (await client.query<{ business_name: string }>(`SELECT business_name FROM members WHERE id=$1`, [row.member_id])).rows[0].business_name;
    await queueMail(
      client,
      email,
      `Booking moved: ${newLabel}`,
      `${business}\r\nFrom ${oldLabel}\r\nTo ${newLabel}\r\nNew charge $${(row.charge_cents / 100).toFixed(2)}`,
    );
    await deliverOrQueue(client, ctx, kbItemIds);
    const bank = await hourBankObject(client, row.member_id, newMonth);
    res.status(200).json({ booking: await bookingObject(client, row, caller.person, caller.kitchen, instant, ctx.config.noShowGraceSeconds), hourBank: bank });
  });
};

async function priceMove(
  client: PoolClient,
  station: { id: string },
  windows: Caller['kitchen']['peak_windows'],
  kind: 'hourly' | 'shelf',
  localDate: string,
  localStart: string | null,
  localEnd: string | null,
  days: number | null,
  startInstant: Date,
): Promise<{ chargeCents: number; hours: number; peakHours: number }> {
  const { priceBlock, rateForBlock } = await import('../pricing.js');
  const versions = (await client.query<{ id: string; effective_at: Date; off_peak_cents: number | null; peak_cents: number | null; shelf_day_cents: number | null }>(`SELECT * FROM rate_versions WHERE station_id=$1`, [station.id])).rows;
  const version = rateForBlock(versions as never, startInstant);
  return priceBlock({ kind, days, localDate, localStart, localEnd, version, windows } as never);
}

// ---------------------------------------------------------------------------
// POST /api/bookings/{id}/release
// ---------------------------------------------------------------------------
export const releaseBooking: Handler = async (req, res, ctx) => {
  const caller = callerOf(req);
  if (caller.person.role === 'member') throw forbidden();
  const bookingId = String(String(req.params.id));
  await withContentionRetry(async (client) => {
    const instant = nowDate();
    const booking = await getBooking(client, bookingId);
    if (!booking || booking.kitchen_id !== caller.kitchen.id) throw new ApiError('not_found');
    await lockMonths(client, caller.kitchen.id, [booking.member_id], [monthOf(booking.local_date)]);
    await applyLapses(client, bookingId, instant, ctx.config.noShowGraceSeconds);
    const fresh = (await getBooking(client, bookingId))!;
    if (await monthClosed(client, caller.kitchen.id, monthOf(fresh.local_date))) throw monthClosedError(monthOf(fresh.local_date));
    if (fresh.status !== 'confirmed' || !fresh.conflict) throw invalidTransition(fresh, 'release');
    const kbItemIds = await recordLedgerPair(client, fresh, {
      hours: fresh.kind === 'hourly' ? -Number(fresh.hours) : 0,
      ledgerKind: 'cancel',
      kbItems: [{ kind: 'cancelled_credit', bookingId: fresh.id, description: `Cancelled ${fresh.id}`, amountCents: -fresh.charge_cents }],
    });
    await client.query(`UPDATE bookings SET status='cancelled_free', conflict=false, version=version+1 WHERE id=$1`, [bookingId]);
    await queueMail(client, await getPersonEmail(client, fresh.member_id), `Booking cancelled: ${await labelOf(client, fresh)}`, cancelEmailBody(null));
    await deliverOrQueue(client, ctx, kbItemIds);
    const row = (await getBooking(client, bookingId))!;
    const bank = await hourBankObject(client, row.member_id, monthOf(row.local_date));
    res.status(200).json({ booking: await bookingObject(client, row, caller.person, caller.kitchen, instant, ctx.config.noShowGraceSeconds), hourBank: bank });
  });
};

// ---------------------------------------------------------------------------
// POST /api/bookings/{id}/waive-penalty
// ---------------------------------------------------------------------------
export const waivePenalty: Handler = async (req, res, ctx) => {
  const caller = callerOf(req);
  if (caller.person.role !== 'operator') throw forbidden();
  const key = requireIdempotencyKey(req.headers['idempotency-key'] as string | undefined);
  const bookingId = String(String(req.params.id));
  const path = `/api/bookings/${bookingId}/waive-penalty`;
  const fingerprint = bodyFingerprint(parseJsonBody(req.rawBody));
  await withContentionRetry(async (client) => {
    const booking = await getBooking(client, bookingId);
    if (!booking || booking.kitchen_id !== caller.kitchen.id) throw new ApiError('not_found');
    const replay = await checkIdempotency(client, caller.person.id, key, 'POST', path, fingerprint);
    if (replay) {
      res.status(replay.status).json(JSON.parse(replay.body));
      return;
    }
    const instant = nowDate();
    const fresh = (await getBooking(client, bookingId))!;
    if (fresh.status !== 'cancelled_late' || fresh.penalty_waived) throw invalidTransition(fresh, 'waive_penalty');
    const feeMonth = monthOf(fresh.local_date);
    const closed = await monthClosed(client, caller.kitchen.id, feeMonth);
    await client.query(`UPDATE bookings SET penalty_waived=true, version=version+1 WHERE id=$1`, [bookingId]);
    let creditMonth = feeMonth;
    const kbItemIds: string[] = [];
    if (!closed) {
      kbItemIds.push(
        ...(await recordLedgerPair(client, fresh, {
          hours: 0,
          ledgerKind: 'cancel',
          kbItems: [{ kind: 'waiver_credit', bookingId: fresh.id, description: `Waived late cancellation ${fresh.id}`, amountCents: -fresh.penalty_cents }],
        })),
      );
    } else {
      // The earliest open kitchen-local month at or after the current month.
      const today = todayInZone(instant, caller.kitchen.time_zone);
      let candidate = today.slice(0, 7);
      for (let i = 0; i < 24; i++) {
        if (!(await monthClosed(client, caller.kitchen.id, candidate))) break;
        candidate = nextMonth(candidate);
      }
      creditMonth = candidate;
      const id = newId('kbi');
      await client.query(
        `INSERT INTO kb_items (id, kitchen_id, member_id, month, kind, booking_id, description, amount_cents)
         VALUES ($1,$2,$3,$4,'adjustment_credit',$5,$6,$7)`,
        [id, caller.kitchen.id, fresh.member_id, candidate, fresh.id, `Adjustment: waived late cancellation ${fresh.id} (${monthName(feeMonth)})`, -fresh.penalty_cents],
      );
      kbItemIds.push(id);
    }
    const email = await getPersonEmail(client, fresh.member_id);
    await queueMail(
      client,
      email,
      `Late cancellation fee waived: ${await labelOf(client, fresh)}`,
      `Credit $${(fresh.penalty_cents / 100).toFixed(2)} on your ${monthName(creditMonth)} statement`,
    );
    await deliverOrQueue(client, ctx, kbItemIds);
    const row = (await getBooking(client, bookingId))!;
    const body = { booking: await bookingObject(client, row, caller.person, caller.kitchen, instant, ctx.config.noShowGraceSeconds), creditMonth };
    const responseBody = JSON.stringify(body);
    await storeIdempotentResponse(client, caller.person.id, key, 200, responseBody);
    res.status(200).json(JSON.parse(responseBody));
  });
};

function nextMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
