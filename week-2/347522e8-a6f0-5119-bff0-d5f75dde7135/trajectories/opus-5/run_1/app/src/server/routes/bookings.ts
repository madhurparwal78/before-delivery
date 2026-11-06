/**
 * Bookings: placing a hold, confirming, releasing, cancelling, the shift's
 * check-in and check-out, and the daily usage sheet.
 */

import { config } from '../config.js';
import { db, transaction, pgErrorCode, EXCLUSION_VIOLATION } from '../db.js';
import * as errors from '../http/errors.js';
import { json, type Route, type RouteResult, type SessionContext } from '../http/router.js';
import { requireResolved } from '../http/resolve.js';
import { Validator } from '../http/validate.js';
import { isoInstant, kitchenToday, nowMs } from '../domain/clock.js';
import { cancellationCutoffAt, cancellationOutcome } from '../domain/cancellation.js';
import { blockingDocumentsCurrent } from '../domain/compliance.js';
import {
  InsufficientHours,
  balanceMinutes,
  lockRenterHours,
  recordMovement,
} from '../domain/ledger.js';
import { describeConflict, occupiedEnd } from '../domain/occupancy.js';
import { computeOverage } from '../domain/overage.js';
import { settingsInForce, type SettingsRow } from '../domain/stationSettings.js';
import { canBookingMove } from '../domain/transitions.js';
import { renterBillingAccountId } from '../domain/billingAccount.js';
import { expireDueHolds } from '../jobs/holdExpiry.js';
import { bookingConfirmedMail, queueNotification } from '../services/notifications.js';
import { BillingUnavailable, addExternalCharge } from '../services/killbill.js';
import {
  KITCHEN_TIME_ZONE,
  MINUTE_MS,
  daysBetween,
  isDateString,
  isHhmm,
  kitchenInstant,
  resolveKitchenWallClock,
} from '../../shared/kitchenTime.js';
import {
  MAX_BOOKING_MINUTES,
  MAX_REPEAT_WEEKS,
  MIN_BOOKING_MINUTES,
  priceSeries,
} from '../../shared/pricing.js';
import { timeDoesNotExist } from '../../shared/copy.js';
import { stationOccupancy } from './stations.js';
import { presentBooking, renterDocumentFacts } from './present.js';
import { BOOKING_COLUMNS, type BookingRow, type RenterRow } from '../rows.js';
import type { BookingStatus } from '../../shared/types.js';

const ALL_ROLES = ['operator', 'shift_lead', 'renter'] as const;
const STAFF = ['operator', 'shift_lead'] as const;
const MAX_DAYS_AHEAD = 366;
const EFFECTIVE_STATUS = `CASE WHEN b.status = 'hold' AND b.hold_expires_at <= now()
                               THEN 'expired' ELSE b.status END`;

async function loadBooking(bookingId: string): Promise<BookingRow> {
  return db.one<BookingRow>(
    `SELECT ${BOOKING_COLUMNS} FROM bookings b JOIN stations s ON s.id = b.station_id
      WHERE b.id = $1`,
    [bookingId],
  );
}

async function loadSeries(seriesId: string): Promise<BookingRow[]> {
  return db.query<BookingRow>(
    `SELECT ${BOOKING_COLUMNS} FROM bookings b JOIN stations s ON s.id = b.station_id
      WHERE b.series_id = $1 ORDER BY b.starts_at`,
    [seriesId],
  );
}

/** Booking is gated on status first, then on compliance. */
async function assertMayBook(renter: RenterRow): Promise<void> {
  if (
    renter.status === 'applied' ||
    renter.status === 'documents_review' ||
    renter.status === 'offboarded'
  ) {
    throw errors.renterNotActive();
  }
  if (renter.status === 'suspended') throw errors.complianceLapsed();
  const documents = await renterDocumentFacts(db, renter.id);
  if (!blockingDocumentsCurrent(documents, kitchenToday())) throw errors.complianceLapsed();
}

interface PlannedWeek {
  date: string;
  startMs: number;
  endMs: number;
  minutes: number;
}

async function placeHold(context: SessionContext): Promise<RouteResult> {
  const renterId = context.principal.renterId;
  if (renterId === null) throw errors.forbidden();
  const renter = await db.one<RenterRow>(
    `SELECT id, user_id, business_name, contact_name, email, phone, status, killbill_account_id
       FROM renters WHERE id = $1`,
    [renterId],
  );
  await assertMayBook(renter);

  const today = kitchenToday();
  const validator = new Validator(context.body);

  const stationId = context.body['station_id'];
  const station =
    typeof stationId === 'string'
      ? await db.maybeOne<{ id: string; name: string }>(
          'SELECT id, name FROM stations WHERE id = $1',
          [stationId],
        )
      : null;
  if (!station) validator.fail('station_id', 'Choose a station.');

  const dateRaw = context.body['date'];
  if (!isDateString(dateRaw)) {
    validator.fail('date', 'Enter a date as YYYY-MM-DD.');
  } else if (daysBetween(today, dateRaw) > MAX_DAYS_AHEAD) {
    validator.fail('date', `Choose a date within ${MAX_DAYS_AHEAD} days.`);
  }
  const startRaw = context.body['start'];
  if (!isHhmm(startRaw)) validator.fail('start', 'Enter a time on a 15-minute mark.');
  const endRaw = context.body['end'];
  if (!isHhmm(endRaw, true)) validator.fail('end', 'Enter a time on a 15-minute mark.');
  const repeatWeeks = validator.optionalInteger('repeat_weeks', 1, MAX_REPEAT_WEEKS, 1);
  validator.done();

  const date = dateRaw as string;
  const start = startRaw as string;
  const end = endRaw as string;

  if (station === null) throw new Error('station validation did not stop the request');
  const settingsRows = await db.query<SettingsRow>(
    `SELECT station_id, effective_from, hour_weight, off_peak_percent,
            overage_usd_per_hour::text AS overage_usd_per_hour, buffer_minutes
       FROM station_settings WHERE station_id = $1`,
    [station.id],
  );
  const settings = settingsInForce(settingsRows, today);
  if (!settings) throw new Error(`station ${station.id} has no settings in force`);

  const series = priceSeries(date, start, end, repeatWeeks, {
    hourWeight: settings.hour_weight,
    offPeakPercent: settings.off_peak_percent,
  });
  if (series.kind === 'skipped') Validator.one(series.field, timeDoesNotExist(series.date));
  const weeks: PlannedWeek[] = series.weeks;
  const totalMinutes = series.totalMinutes;

  const elapsed = (weeks[0].endMs - weeks[0].startMs) / MINUTE_MS;
  if (elapsed < MIN_BOOKING_MINUTES) {
    Validator.one('end', 'Enter an end at least 15 minutes after the start.');
  }
  if (elapsed > MAX_BOOKING_MINUTES) {
    Validator.one('end', 'A booking can be at most six hours long.');
  }
  if (weeks[0].startMs <= nowMs()) {
    Validator.one('start', 'Choose a time in the future.');
  }

  const holdExpiresAt = new Date(nowMs() + config.holdTtlSeconds * 1_000);
  const stationId2 = station.id;

  try {
    return await transaction(async (tx) => {
      await expireDueHolds(tx);
      // The renter's hour lock is taken before any booking row is inserted.
      // Inserting one takes a key-share lock on the same renter row, so taking
      // the stronger lock afterwards would let two claims by one renter
      // deadlock against each other.
      await lockRenterHours(tx, renter.id);
      const seriesRow = await tx.one<{ series_id: string }>(
        'SELECT gen_random_uuid() AS series_id',
      );
      const created: string[] = [];

      // The exclusion constraint on station_occupancy is what decides the winner.
      for (const week of weeks) {
        const booking = await tx.one<{ id: string }>(
          `INSERT INTO bookings
             (series_id, station_id, renter_id, status, date, start_hhmm, end_hhmm, starts_at,
              ends_at, buffer_minutes, hour_weight, off_peak_percent, overage_usd_per_hour,
              minutes_debited, hold_expires_at, cancellation_cutoff_at)
           VALUES ($1, $2, $3, 'hold', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING id`,
          [
            seriesRow.series_id,
            stationId2,
            renter.id,
            week.date,
            start,
            end,
            new Date(week.startMs),
            new Date(week.endMs),
            settings.buffer_minutes,
            settings.hour_weight,
            settings.off_peak_percent,
            settings.overage_usd_per_hour,
            week.minutes,
            holdExpiresAt,
            new Date(cancellationCutoffAt(week.date, start)),
          ],
        );
        await tx.query(
          `INSERT INTO station_occupancy (station_id, kind, booking_id, occupied)
           VALUES ($1, 'booking', $2, tstzrange($3, $4, '[)'))`,
          [
            stationId2,
            booking.id,
            new Date(week.startMs),
            new Date(occupiedEnd(week.endMs, settings.buffer_minutes)),
          ],
        );
        created.push(booking.id);
      }

      // Checked after the occupancy inserts, so a colliding claim answers
      // `slot_conflict` before `insufficient_hours`.
      const balance = await balanceMinutes(tx, renter.id);
      if (balance < totalMinutes) throw errors.insufficientHours(balance, totalMinutes);
      for (let index = 0; index < created.length; index += 1) {
        await recordMovement(tx, {
          renterId: renter.id,
          kind: 'booking_hold',
          minutes: weeks[index].minutes,
          bookingId: created[index],
        });
      }

      const rows = await tx.query<BookingRow>(
        `SELECT ${BOOKING_COLUMNS} FROM bookings b JOIN stations s ON s.id = b.station_id
          WHERE b.series_id = $1 ORDER BY b.starts_at`,
        [seriesRow.series_id],
      );
      const now = nowMs();
      return json(201, {
        server_now: isoInstant(now),
        bookings: rows.map((row) => presentBooking(row, now)),
      });
    });
  } catch (error) {
    if (pgErrorCode(error) === EXCLUSION_VIOLATION) {
      const occupancy = await stationOccupancy(stationId2);
      for (const week of weeks) {
        const details = describeConflict(
          week.date,
          week.startMs,
          week.endMs,
          settings.buffer_minutes,
          occupancy,
        );
        if (details) throw errors.slotConflict(week.date, details);
      }
      throw errors.slotConflict(date, {
        blocked_by: 'booking',
        blocked_at: start,
        legal_end: null,
      });
    }
    if (error instanceof InsufficientHours) {
      throw errors.insufficientHours(error.balanceMinutes, totalMinutes);
    }
    throw error;
  }
}

/** Confirm and release share the expiry rule: past the instant, both answer `hold_expired`. */
function assertHoldLive(booking: BookingRow, to: BookingStatus): void {
  const expiresAt = booking.hold_expires_at?.getTime() ?? null;
  if (booking.status === 'expired' || (expiresAt !== null && expiresAt <= nowMs())) {
    throw errors.holdExpired();
  }
  if (!canBookingMove(booking.status, to)) {
    throw errors.invalidTransition(booking.status, to);
  }
}

async function confirm(context: SessionContext): Promise<RouteResult> {
  const booking = requireResolved(context.resolved, 'booking');
  assertHoldLive(booking, 'confirmed');

  await transaction(async (tx) => {
    const weeks = await tx.query<BookingRow>(
      `SELECT ${BOOKING_COLUMNS} FROM bookings b JOIN stations s ON s.id = b.station_id
        WHERE b.series_id = $1 AND b.status = 'hold' ORDER BY b.starts_at FOR UPDATE OF b`,
      [booking.series_id],
    );
    if (weeks.length === 0) throw errors.holdExpired();
    await tx.query(
      "UPDATE bookings SET status = 'confirmed' WHERE series_id = $1 AND status = 'hold'",
      [booking.series_id],
    );
    const renter = await tx.one<{ email: string }>('SELECT email FROM renters WHERE id = $1', [
      booking.renter_id,
    ]);
    await queueNotification(
      tx,
      bookingConfirmedMail(
        renter.email,
        booking.station_name,
        weeks.map((week) => ({
          date: week.date,
          start: week.start_hhmm,
          end: week.end_hhmm,
          startsAtMs: week.starts_at.getTime(),
          endsAtMs: week.ends_at.getTime(),
          bufferMinutes: week.buffer_minutes,
        })),
      ),
    );
  });

  const now = nowMs();
  return json(200, {
    server_now: isoInstant(now),
    bookings: (await loadSeries(booking.series_id)).map((row) => presentBooking(row, now)),
  });
}

async function release(context: SessionContext): Promise<RouteResult> {
  const booking = requireResolved(context.resolved, 'booking');
  assertHoldLive(booking, 'expired');

  await transaction(async (tx) => {
    const weeks = await tx.query<BookingRow>(
      `SELECT ${BOOKING_COLUMNS} FROM bookings b JOIN stations s ON s.id = b.station_id
        WHERE b.series_id = $1 AND b.status = 'hold' ORDER BY b.starts_at FOR UPDATE OF b`,
      [booking.series_id],
    );
    if (weeks.length === 0) throw errors.holdExpired();
    await lockRenterHours(tx, booking.renter_id);
    for (const week of weeks) {
      await tx.query("UPDATE bookings SET status = 'expired' WHERE id = $1", [week.id]);
      await tx.query('DELETE FROM station_occupancy WHERE booking_id = $1', [week.id]);
      await recordMovement(tx, {
        renterId: booking.renter_id,
        kind: 'hold_release',
        minutes: week.minutes_debited,
        bookingId: week.id,
        note: 'hold released',
      });
    }
  });

  const now = nowMs();
  return json(200, {
    server_now: isoInstant(now),
    bookings: (await loadSeries(booking.series_id)).map((row) => presentBooking(row, now)),
  });
}

async function cancel(context: SessionContext): Promise<RouteResult> {
  const booking = requireResolved(context.resolved, 'booking');
  if (!canBookingMove(booking.status, 'cancelled')) {
    throw errors.invalidTransition(booking.status, 'cancelled');
  }
  const outcome = cancellationOutcome(booking.cancellation_cutoff_at.getTime(), nowMs());

  await transaction(async (tx) => {
    const current = await tx.one<{ status: BookingStatus }>(
      'SELECT status FROM bookings WHERE id = $1 FOR UPDATE',
      [booking.id],
    );
    if (!canBookingMove(current.status, 'cancelled')) {
      throw errors.invalidTransition(current.status, 'cancelled');
    }
    await lockRenterHours(tx, booking.renter_id);
    await tx.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [booking.id]);
    await tx.query('DELETE FROM station_occupancy WHERE booking_id = $1', [booking.id]);
    await recordMovement(tx, {
      renterId: booking.renter_id,
      kind: outcome === 'credited' ? 'cancellation_credit' : 'cancellation_forfeit',
      minutes: booking.minutes_debited,
      bookingId: booking.id,
      note: outcome,
    });
  });

  return json(200, {
    booking: presentBooking(await loadBooking(booking.id), nowMs()),
    outcome,
    minutes: booking.minutes_debited,
  });
}

async function checkIn(context: SessionContext): Promise<RouteResult> {
  const booking = requireResolved(context.resolved, 'booking');
  if (!canBookingMove(booking.status, 'checked_in')) {
    throw errors.invalidTransition(booking.status, 'checked_in');
  }
  const actualStart = context.body['actual_start'];
  if (!isHhmm(actualStart)) {
    Validator.one('actual_start', 'Enter a time on a 15-minute mark.');
  }
  const resolved = resolveKitchenWallClock(booking.date, actualStart as string);
  if (resolved.kind === 'skipped') {
    Validator.one('actual_start', timeDoesNotExist(booking.date));
  }

  await db.query(
    `UPDATE bookings SET status = 'checked_in', actual_start = $2, actual_start_at = $3
      WHERE id = $1 AND status = 'confirmed'`,
    [booking.id, actualStart, new Date(resolved.instantMs)],
  );
  return json(200, { booking: presentBooking(await loadBooking(booking.id), nowMs()) });
}

async function checkOut(context: SessionContext): Promise<RouteResult> {
  const booking = requireResolved(context.resolved, 'booking');
  if (!canBookingMove(booking.status, 'completed')) {
    throw errors.invalidTransition(booking.status, 'completed');
  }
  const actualEnd = context.body['actual_end'];
  if (!isHhmm(actualEnd, true)) {
    Validator.one('actual_end', 'Enter a time on a 15-minute mark.');
  }
  const resolvedEnd = resolveKitchenWallClock(booking.date, actualEnd as string);
  if (resolvedEnd.kind === 'skipped') Validator.one('actual_end', timeDoesNotExist(booking.date));
  const actualEndMs = resolvedEnd.instantMs;
  const startedAt = booking.actual_start;
  if (startedAt === null) throw errors.invalidTransition(booking.status, 'completed');
  if (actualEndMs <= kitchenInstant(booking.date, startedAt)) {
    Validator.one('actual_end', 'Enter an end after the recorded start.');
  }

  const overage = computeOverage(
    booking.ends_at.getTime(),
    actualEndMs,
    booking.overage_usd_per_hour,
  );

  // An overage must be accepted by billing before the check-out is recorded.
  if (overage.units > 0) {
    const renter = await db.one<RenterRow>(
      `SELECT id, user_id, business_name, contact_name, email, phone, status, killbill_account_id
         FROM renters WHERE id = $1`,
      [booking.renter_id],
    );
    try {
      const accountId = await renterBillingAccountId(renter);
      await addExternalCharge(
        accountId,
        overage.usd,
        `Overage: ${booking.station_name} ${booking.date}, ${overage.units} \u00d7 15 min`,
      );
    } catch (error) {
      if (error instanceof BillingUnavailable) throw errors.billingUnavailable();
      throw error;
    }
  }

  await transaction(async (tx) => {
    // Booking row first, then the renter's hours, which is the order every
    // single-booking change uses.
    await tx.query('SELECT 1 FROM bookings WHERE id = $1 FOR UPDATE', [booking.id]);
    await lockRenterHours(tx, booking.renter_id);
    const updated = await tx.query<{ id: string }>(
      `UPDATE bookings
          SET status = 'completed', actual_end = $2, actual_end_at = $3,
              overage_units = $4, overage_usd = $5
        WHERE id = $1 AND status = 'checked_in' RETURNING id`,
      [booking.id, actualEnd, new Date(actualEndMs), overage.units, overage.usd],
    );
    if (updated.length === 0) throw errors.invalidTransition(booking.status, 'completed');
    await tx.query('DELETE FROM station_occupancy WHERE booking_id = $1', [booking.id]);
    await tx.query(
      `INSERT INTO station_occupancy (station_id, kind, booking_id, occupied)
       VALUES ($1, 'booking', $2, tstzrange($3, $4, '[)'))`,
      [
        booking.station_id,
        booking.id,
        booking.starts_at,
        new Date(occupiedEnd(booking.ends_at.getTime(), booking.buffer_minutes)),
      ],
    );
    await recordMovement(tx, {
      renterId: booking.renter_id,
      kind: 'checkout',
      minutes: booking.minutes_debited,
      bookingId: booking.id,
      note: 'checked out',
    });
  });

  return json(200, { booking: presentBooking(await loadBooking(booking.id), nowMs()) });
}

interface UsageRow {
  booking_id: string;
  station_name: string;
  renter_business_name: string;
  start_hhmm: string;
  end_hhmm: string;
  actual_start: string | null;
  actual_end: string | null;
  status: BookingStatus;
  overage_units: number | null;
  overage_usd: string | null;
}

export const bookingRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/bookings',
    auth: 'session',
    roles: ['renter'],
    body: 'json',
    handle: placeHold,
  },
  {
    method: 'GET',
    path: '/api/bookings',
    auth: 'session',
    roles: [...ALL_ROLES],
    async handle(context) {
      const date = context.query.get('date');
      if (date !== null && date !== '' && !isDateString(date)) {
        Validator.one('date', 'Enter a date as YYYY-MM-DD.');
      }
      const status = context.query.get('status');
      const renterId = context.principal.role === 'renter' ? context.principal.renterId : null;
      const rows = await db.query<BookingRow>(
        `SELECT ${BOOKING_COLUMNS} FROM bookings b JOIN stations s ON s.id = b.station_id
          WHERE ($1::uuid IS NULL OR b.renter_id = $1)
            AND ($2::date IS NULL OR b.date = $2)
            AND ($3::text IS NULL OR ${EFFECTIVE_STATUS} = $3)
          ORDER BY b.starts_at, s.name`,
        [renterId, date === '' ? null : date, status === '' ? null : status],
      );
      const now = nowMs();
      return json(200, {
        server_now: isoInstant(now),
        bookings: rows.map((row) => presentBooking(row, now)),
      });
    },
  },
  {
    method: 'GET',
    path: '/api/bookings/:booking_id',
    auth: 'session',
    roles: [...ALL_ROLES],
    resolve: ['booking'],
    async handle(context) {
      const now = nowMs();
      return json(200, {
        server_now: isoInstant(now),
        booking: presentBooking(requireResolved(context.resolved, 'booking'), now),
      });
    },
  },
  {
    method: 'POST',
    path: '/api/bookings/:booking_id/confirm',
    auth: 'session',
    roles: ['renter'],
    body: 'json',
    resolve: ['booking'],
    handle: confirm,
  },
  {
    method: 'POST',
    path: '/api/bookings/:booking_id/release',
    auth: 'session',
    roles: ['renter'],
    body: 'json',
    resolve: ['booking'],
    handle: release,
  },
  {
    method: 'POST',
    path: '/api/bookings/:booking_id/cancel',
    auth: 'session',
    roles: ['renter'],
    body: 'json',
    resolve: ['booking'],
    handle: cancel,
  },
  {
    method: 'POST',
    path: '/api/bookings/:booking_id/check-in',
    auth: 'session',
    roles: [...STAFF],
    body: 'json',
    resolve: ['booking'],
    handle: checkIn,
  },
  {
    method: 'POST',
    path: '/api/bookings/:booking_id/check-out',
    auth: 'session',
    roles: [...STAFF],
    body: 'json',
    resolve: ['booking'],
    handle: checkOut,
  },
  {
    method: 'GET',
    path: '/api/usage-sheet',
    auth: 'session',
    roles: [...STAFF],
    async handle(context) {
      const raw = context.query.get('date');
      if (raw !== null && raw !== '' && !isDateString(raw)) {
        Validator.one('date', 'Enter a date as YYYY-MM-DD.');
      }
      const date = raw === null || raw === '' ? kitchenToday() : raw;
      const rows = await db.query<UsageRow>(
        `SELECT b.id AS booking_id, s.name AS station_name, r.business_name AS renter_business_name,
                b.start_hhmm, b.end_hhmm, b.actual_start, b.actual_end, b.status,
                b.overage_units, b.overage_usd::text AS overage_usd
           FROM bookings b
           JOIN stations s ON s.id = b.station_id
           JOIN renters r ON r.id = b.renter_id
          WHERE b.date = $1 AND b.status IN ('confirmed','checked_in','completed')
          ORDER BY b.start_hhmm, s.name`,
        [date],
      );
      return json(200, {
        date,
        time_zone: KITCHEN_TIME_ZONE,
        server_now: isoInstant(nowMs()),
        rows: rows.map((row) => ({
          booking_id: row.booking_id,
          station_name: row.station_name,
          renter_business_name: row.renter_business_name,
          start: row.start_hhmm,
          end: row.end_hhmm,
          actual_start: row.actual_start,
          actual_end: row.actual_end,
          status: row.status,
          overage_units: row.overage_units,
          overage_usd: row.overage_usd,
        })),
      });
    },
  },
];

