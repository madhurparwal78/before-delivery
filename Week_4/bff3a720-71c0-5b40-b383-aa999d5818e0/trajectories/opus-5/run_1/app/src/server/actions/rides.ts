import { randomUUID } from 'node:crypto';
import { now } from '../clock.js';
import { db, withTransaction, type Queryable } from '../db.js';
import { errors } from '../errors.js';
import { money } from '../../shared/format.js';
import { dateLabel, timeLabel } from '../../shared/zoned.js';
import { fromZoned, isoZoned, parseHhMm, zonedParts } from '../domain/time.js';
import { freeCancelWindow, requestDeadline } from '../domain/booking-rules.js';
import { maxSeatsUsedOnAnyLeg } from '../../shared/seats.js';
import * as ledger from '../domain/ledger.js';
import { flushRows, mailCopy, queueEmail } from '../outbox.js';
import {
  activeClaims,
  boardingTimeOf,
  legCountOf,
  loadMember,
  loadRide,
  loadRideForUpdate,
  rideBookings,
  serialiseRide,
  type BookingRecord,
  type RideRecord,
} from '../model.js';
import {
  publishBooking,
  publishRide,
  publishSeatMap,
  publishWallet,
  recordState,
  spanLabel,
  trackRequestDeadline,
  untrackRequestDeadline,
} from './shared.js';

export interface Notice {
  passenger_id: string;
  name: string;
  kind: 'time_change' | 'cancellation';
  status: 'queued' | 'sent';
  sent_at?: string | null;
}

/** Passengers a change or a cancellation affects: a confirmed seat or a pending request. */
function affected(bookings: readonly BookingRecord[]): BookingRecord[] {
  return bookings.filter(
    (booking) => booking.state === 'confirmed' || booking.state === 'requested',
  );
}

async function noticeStatuses(rideId: string, emailIds: readonly string[]): Promise<Notice[]> {
  if (emailIds.length === 0) return [];
  const { rows } = await db.query<{
    passenger_id: string;
    kind: 'time_change' | 'cancellation';
    status: 'queued' | 'sent';
    sent_at: Date | null;
    display_name: string;
  }>(
    `select o.passenger_id, o.kind, o.status, o.sent_at, m.display_name
       from outbox o join members m on m.id = o.passenger_id
      where o.ride_id = $1 and o.id = any($2::uuid[]) order by o.seq`,
    [rideId, emailIds],
  );
  return rows.map((row) => ({
    passenger_id: row.passenger_id,
    name: row.display_name,
    kind: row.kind,
    status: row.status,
    sent_at: row.sent_at ? isoZoned(row.sent_at) : null,
  }));
}

export async function rideNotices(rideId: string): Promise<Notice[]> {
  const { rows } = await db.query<{
    passenger_id: string;
    kind: 'time_change' | 'cancellation';
    status: 'queued' | 'sent';
    sent_at: Date | null;
    display_name: string;
  }>(
    `select o.passenger_id, o.kind, o.status, o.sent_at, m.display_name
       from outbox o join members m on m.id = o.passenger_id
      where o.ride_id = $1 and o.kind in ('time_change', 'cancellation') order by o.seq`,
    [rideId],
  );
  return rows.map((row) => ({
    passenger_id: row.passenger_id,
    name: row.display_name,
    kind: row.kind,
    status: row.status,
    sent_at: row.sent_at ? isoZoned(row.sent_at) : null,
  }));
}

/** Read a new departure given either a full ISO time or `HH:MM` on the ride's own date. */
function readDeparture(value: unknown, current: Date): Date | null {
  if (typeof value !== 'string') return null;
  const asTime = parseHhMm(value);
  if (asTime) {
    const parts = zonedParts(current);
    return fromZoned(parts.year, parts.month, parts.day, asTime.hour, asTime.minute);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export interface PatchRideInput {
  rideId: string;
  driverId: string;
  ifMatch: string | null;
  departure?: unknown;
  seats?: unknown;
}

export async function patchRide(input: PatchRideInput): Promise<{
  ride: Record<string, unknown>;
  notices: Notice[];
  queued: boolean;
  timeChanged: boolean;
}> {
  const result = await withTransaction(async (tx) => {
    const at = now();
    const ride = await loadRideForUpdate(tx, input.rideId);
    if (!ride) throw errors.notFound();
    if (ride.driver_id !== input.driverId) throw errors.notFound();
    if (ride.state !== 'published' && ride.state !== 'changed') throw errors.invalidTransition();

    const version = input.ifMatch === null ? null : Number.parseInt(input.ifMatch, 10);
    if (version !== null && Number.isFinite(version) && version !== ride.version) {
      throw errors.editConflict();
    }
    if (version === null || !Number.isFinite(version)) {
      throw errors.validationFailed({ if_match: 'Send the ride version in If-Match.' });
    }

    const fields: Record<string, string> = {};
    const wantsDeparture = input.departure !== undefined && input.departure !== null;
    const wantsSeats = input.seats !== undefined && input.seats !== null;
    const bookings = await rideBookings(tx, ride.id);

    let newDeparture: Date | null = null;
    if (wantsDeparture) {
      newDeparture = readDeparture(input.departure, ride.departure);
      if (!newDeparture) fields.departure = 'Write the time as HH:MM.';
      else if (newDeparture.getTime() <= at.getTime()) {
        fields.departure = 'Choose a time later than now.';
      }
    }

    let newSeats: number | null = null;
    if (wantsSeats) {
      const asNumber = typeof input.seats === 'number' ? input.seats : Number.NaN;
      const { rows } = await tx.query<{ seats: number }>(
        'select seats from vehicles where id = $1',
        [ride.vehicle_id],
      );
      const carSeats = rows[0]?.seats ?? 4;
      const used = maxSeatsUsedOnAnyLeg(legCountOf(ride), activeClaims(bookings, at));
      if (!Number.isInteger(asNumber) || asNumber < 1 || asNumber > 4) {
        fields.seats = 'Choose 1 to 4 seats.';
      } else if (asNumber < used) {
        fields.seats = `Seats cannot go below the ${used} already taken on one leg.`;
      } else if (asNumber > carSeats) {
        fields.seats = 'Seats cannot be more than the car has.';
      } else {
        newSeats = asNumber;
      }
    }

    if (!wantsDeparture && !wantsSeats) {
      fields.departure = 'Send a new departure time or a new seat count.';
    }
    if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

    const previousDeparture = ride.departure;
    const departure = newDeparture ?? ride.departure;
    const timeChanged = departure.getTime() !== previousDeparture.getTime();
    const freeUntil = timeChanged
      ? freeCancelWindow(previousDeparture, departure)
      : ride.free_cancel_until;

    await tx.query(
      `update rides set departure = $2, seats = $3, state = 'changed', version = version + 1,
         previous_departure = $4, free_cancel_until = $5 where id = $1`,
      [
        ride.id,
        departure,
        newSeats ?? ride.seats,
        timeChanged ? previousDeparture : ride.previous_departure,
        timeChanged ? (freeUntil ?? ride.free_cancel_until) : ride.free_cancel_until,
      ],
    );

    const emailIds: string[] = [];
    const updated = (await loadRideForUpdate(tx, ride.id)) as RideRecord;
    if (timeChanged) {
      for (const booking of affected(bookings)) {
        if (booking.state === 'requested') {
          const deadline = requestDeadline(
            booking.created_at,
            boardingTimeOf(updated, booking.boarding_idx),
          );
          await tx.query('update bookings set request_deadline = $2 where id = $1', [
            booking.id,
            deadline,
          ]);
        }
        const passenger = await loadMember(tx, booking.passenger_id);
        const driver = await loadMember(tx, ride.driver_id);
        const windowFor =
          booking.state === 'confirmed' && updated.free_cancel_until
            ? {
                time: timeLabel(isoZoned(updated.free_cancel_until)),
                date: dateLabel(isoZoned(updated.free_cancel_until)),
              }
            : null;
        const copy = mailCopy.timeChange(
          dateLabel(isoZoned(departure)),
          timeLabel(isoZoned(departure)),
          driver?.display_name ?? '',
          timeLabel(isoZoned(previousDeparture)),
          windowFor,
        );
        emailIds.push(
          await queueEmail(tx, {
            kind: 'time_change',
            to: passenger?.email ?? '',
            subject: copy.subject,
            body: copy.body,
            rideId: ride.id,
            passengerId: booking.passenger_id,
            bookingId: booking.id,
          }),
        );
      }
    }
    return { rideId: ride.id, emailIds, timeChanged, bookings };
  });

  await flushRows(result.emailIds);
  for (const booking of affected(result.bookings)) {
    if (result.timeChanged && booking.state === 'requested') {
      const fresh = await loadRide(db, result.rideId);
      if (fresh) {
        await trackRequestDeadline(
          booking.id,
          requestDeadline(booking.created_at, boardingTimeOf(fresh, booking.boarding_idx)),
        );
      }
    }
    await publishBooking(booking.id);
  }
  await publishRide(result.rideId);

  const notices = await noticeStatuses(result.rideId, result.emailIds);
  const ride = (await loadRide(db, result.rideId)) as RideRecord;
  return {
    ride: await serialiseRide(db, ride, now()),
    notices,
    queued: notices.some((notice) => notice.status === 'queued'),
    timeChanged: result.timeChanged,
  };
}

/** A driver cancellation refunds every confirmed booking and every pending request. */
export async function cancelRide(
  rideId: string,
  driverId: string,
): Promise<{ ride: Record<string, unknown>; notices: Notice[]; queued: boolean }> {
  const result = await withTransaction(async (tx) => {
    const at = now();
    const ride = await loadRideForUpdate(tx, rideId);
    if (!ride) throw errors.notFound();
    if (ride.driver_id !== driverId) throw errors.notFound();
    if (ride.state !== 'published' && ride.state !== 'changed') throw errors.invalidTransition();

    const bookings = await rideBookings(tx, ride.id);
    const emailIds: string[] = [];
    for (const booking of bookings) {
      if (booking.state === 'held') {
        await recordState(tx, booking.id, 'expired', at, {
          holdExpiresAt: null,
          endedAt: at,
        });
        continue;
      }
      if (booking.state === 'confirmed') {
        await recordState(tx, booking.id, 'cancelled_by_driver', at, { endedAt: at });
        await ledger.driverCancellation(
          tx,
          at,
          booking.id,
          booking.passenger_id,
          driverId,
          booking.price_cents,
          `Refund 100%: ${spanLabel(ride, booking)}`,
        );
      } else if (booking.state === 'requested') {
        await recordState(tx, booking.id, 'withdrawn', at, {
          requestDeadline: null,
          endedAt: at,
        });
        await ledger.requestReleased(
          tx,
          at,
          booking.id,
          booking.passenger_id,
          booking.price_cents,
          `Request withdrawn: ${spanLabel(ride, booking)}`,
        );
      } else {
        continue;
      }
      const passenger = await loadMember(tx, booking.passenger_id);
      const copy = mailCopy.rideCancelled(
        dateLabel(isoZoned(boardingTimeOf(ride, booking.boarding_idx))),
        money(booking.price_cents),
      );
      emailIds.push(
        await queueEmail(tx, {
          kind: 'cancellation',
          to: passenger?.email ?? '',
          subject: copy.subject,
          body: copy.body,
          rideId: ride.id,
          passengerId: booking.passenger_id,
          bookingId: booking.id,
        }),
      );
    }
    await tx.query(
      `update rides set state = 'cancelled', version = version + 1 where id = $1`,
      [ride.id],
    );
    return { rideId: ride.id, emailIds, bookings };
  });

  await flushRows(result.emailIds);
  for (const booking of result.bookings) {
    await untrackRequestDeadline(booking.id);
    await publishBooking(booking.id);
    await publishWallet(booking.passenger_id);
  }
  const ride = (await loadRide(db, result.rideId)) as RideRecord;
  await publishSeatMap(ride);
  await publishRide(result.rideId);
  const notices = await noticeStatuses(result.rideId, result.emailIds);
  return {
    ride: await serialiseRide(db, ride, now()),
    notices,
    queued: notices.some((notice) => notice.status === 'queued'),
  };
}

export interface PublishRideInput {
  driverId: string;
  vehicleId: string;
  cities: string[];
  departure: Date;
  seats: number;
  priceCents: number;
  bookingMode: 'instant' | 'request';
  state?: 'published' | 'changed' | 'departed' | 'arrived' | 'cancelled';
}

/** Store a published ride with its stops, legs and numbered seats. */
export async function insertRide(
  tx: Queryable,
  input: PublishRideInput,
  routeKmTotal: number,
  stops: ReadonlyArray<{ city: string; km: number }>,
): Promise<string> {
  const rideId = randomUUID();
  await tx.query(
    `insert into rides (id, driver_id, vehicle_id, booking_mode, seats, price_cents, route_km,
       departure, state, version, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10)`,
    [
      rideId,
      input.driverId,
      input.vehicleId,
      input.bookingMode,
      input.seats,
      input.priceCents,
      routeKmTotal,
      input.departure,
      input.state ?? 'published',
      now(),
    ],
  );
  let index = 0;
  for (const stop of stops) {
    await tx.query(
      'insert into ride_stops (ride_id, idx, city, km) values ($1, $2, $3, $4)',
      [rideId, index, stop.city, stop.km],
    );
    index += 1;
  }
  return rideId;
}
