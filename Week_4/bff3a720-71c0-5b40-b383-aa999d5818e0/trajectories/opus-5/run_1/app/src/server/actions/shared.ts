import { now } from '../clock.js';
import { db, type Queryable } from '../db.js';
import { isoZoned } from '../domain/time.js';
import { holdDeadline, type HistoryState } from '../domain/booking-rules.js';
import { walletBalance } from '../domain/ledger.js';
import {
  boardingTimeOf,
  legCountOf,
  loadRide,
  seatMapOf,
  serialiseBooking,
  serialiseRide,
  type BookingRecord,
  type RideRecord,
} from '../model.js';
import { keys, valkey } from '../valkey.js';
import { publishToMembers, publishToRide } from '../live.js';
import { dateLabel } from '../../shared/zoned.js';

export async function recordState(
  tx: Queryable,
  bookingId: string,
  state: HistoryState,
  at: Date,
  extra: { holdExpiresAt?: Date | null; requestDeadline?: Date | null; endedAt?: Date | null } = {},
): Promise<void> {
  const sets = ['state = $2'];
  const values: unknown[] = [bookingId, state];
  if ('holdExpiresAt' in extra) {
    values.push(extra.holdExpiresAt ?? null);
    sets.push(`hold_expires_at = $${values.length}`);
  }
  if ('requestDeadline' in extra) {
    values.push(extra.requestDeadline ?? null);
    sets.push(`request_deadline = $${values.length}`);
  }
  if ('endedAt' in extra) {
    values.push(extra.endedAt ?? null);
    sets.push(`ended_at = $${values.length}`);
  }
  await tx.query(`update bookings set ${sets.join(', ')} where id = $1`, values);
  await tx.query('insert into booking_history (booking_id, state, at) values ($1, $2, $3)', [
    bookingId,
    state,
    at,
  ]);
}

/** `<From> to <To>, <date>` — the span part of every wallet label and email subject. */
export function spanLabel(ride: RideRecord, booking: BookingRecord): string {
  const from = ride.stops[booking.boarding_idx]?.city ?? '';
  const to = ride.stops[booking.alighting_idx]?.city ?? '';
  return `${from} to ${to}, ${dateLabel(isoZoned(boardingTimeOf(ride, booking.boarding_idx)))}`;
}

export async function writeHoldKeys(booking: BookingRecord, createdAt: Date): Promise<void> {
  const ttl = Math.max(1, Math.ceil((holdDeadline(createdAt).getTime() - now().getTime()) / 1000));
  const pipeline = valkey.pipeline();
  for (let leg = booking.boarding_idx; leg < booking.alighting_idx; leg += 1) {
    for (const seat of booking.seat_numbers) {
      pipeline.set(keys.hold(booking.ride_id, leg, seat), booking.id, 'EX', ttl);
    }
  }
  await pipeline.exec().catch(() => undefined);
}

export async function dropHoldKeys(booking: BookingRecord): Promise<void> {
  const pipeline = valkey.pipeline();
  for (let leg = booking.boarding_idx; leg < booking.alighting_idx; leg += 1) {
    for (const seat of booking.seat_numbers) {
      pipeline.del(keys.hold(booking.ride_id, leg, seat));
    }
  }
  await pipeline.exec().catch(() => undefined);
}

export async function trackRequestDeadline(bookingId: string, deadline: Date): Promise<void> {
  await valkey.zadd(keys.requestDeadlines, deadline.getTime(), bookingId).catch(() => undefined);
}

export async function untrackRequestDeadline(bookingId: string): Promise<void> {
  await valkey.zrem(keys.requestDeadlines, bookingId).catch(() => undefined);
}

export async function publishSeatMap(ride: RideRecord): Promise<void> {
  const seatMap = await seatMapOf(db, ride, now());
  publishToRide(ride.id, 'seat', { ride_id: ride.id, seat_map: seatMap });
  publishToMembers([ride.driver_id], 'seat', { ride_id: ride.id, seat_map: seatMap });
}

export async function publishRide(rideId: string): Promise<void> {
  const ride = await loadRide(db, rideId);
  if (!ride) return;
  const shape = await serialiseRide(db, ride, now());
  publishToRide(rideId, 'ride', { ride: shape });
  const { rows } = await db.query<{ passenger_id: string }>(
    'select distinct passenger_id from bookings where ride_id = $1',
    [rideId],
  );
  publishToMembers([ride.driver_id, ...rows.map((row) => row.passenger_id)], 'ride', {
    ride: shape,
  });
}

/** Push a booking to both parties, each seeing only what belongs to them. */
export async function publishBooking(bookingId: string): Promise<void> {
  const { rows } = await db.query<BookingRecord>(
    `select id, ride_id, passenger_id, boarding_idx, alighting_idx, seats, seat_numbers,
            segment_km, price_cents, state, created_at, hold_expires_at, request_deadline,
            ended_at, rating_closes_at, revealed_at
       from bookings where id = $1`,
    [bookingId],
  );
  const booking = rows[0];
  if (!booking) return;
  const ride = await loadRide(db, booking.ride_id);
  if (!ride) return;
  const passengerView = await serialiseBooking(db, booking, ride, booking.passenger_id, now());
  publishToMembers([booking.passenger_id], 'booking', { booking: passengerView });
  const driverView = await serialiseBooking(db, booking, ride, ride.driver_id, now());
  publishToMembers([ride.driver_id], 'booking', { booking: driverView });
  publishToRide(ride.id, 'booking', { booking: driverView });
}

export async function publishWallet(memberId: string): Promise<void> {
  const balance = await walletBalance(db, memberId);
  publishToMembers([memberId], 'wallet', { balance_cents: balance });
}

export function seatsFreeForSpan(
  ride: RideRecord,
  seatMap: ReadonlyArray<{ seat: number; legs: string[] }>,
  boardingIdx: number,
  alightingIdx: number,
): number {
  let free = 0;
  for (const entry of seatMap) {
    let open = true;
    for (let leg = boardingIdx; leg < alightingIdx && leg < legCountOf(ride); leg += 1) {
      if (entry.legs[leg] === 'taken') {
        open = false;
        break;
      }
    }
    if (open) free += 1;
  }
  return free;
}
