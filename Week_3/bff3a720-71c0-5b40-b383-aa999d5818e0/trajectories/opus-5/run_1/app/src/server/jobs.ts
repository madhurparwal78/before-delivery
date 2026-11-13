import { now } from './clock.js';
import { db, withTransaction } from './db.js';
import { keys, valkey } from './valkey.js';
import {
  holdDeadline,
  ratingWindowClose,
  requestDeadline,
} from './domain/booking-rules.js';
import * as ledger from './domain/ledger.js';
import { drainOutbox } from './outbox.js';
import {
  arrivalTime,
  boardingTimeOf,
  loadBookingForUpdate,
  loadRide,
  loadRideForUpdate,
  rideBookings,
  type BookingRecord,
} from './model.js';
import {
  dropHoldKeys,
  publishBooking,
  publishRide,
  publishSeatMap,
  publishWallet,
  recordState,
  trackRequestDeadline,
  untrackRequestDeadline,
  writeHoldKeys,
} from './actions/shared.js';
import { expireRequestWithin } from './actions/bookings.js';
import { publishRating, revealRatings } from './actions/ratings.js';

const REBUILT_KEY = 'longseat:rebuilt';

async function expireHolds(at: Date): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `select id from bookings where state = 'held' and hold_expires_at <= $1`,
    [at],
  );
  for (const row of rows) {
    const done = await withTransaction(async (tx) => {
      const booking = await loadBookingForUpdate(tx, row.id);
      if (!booking || booking.state !== 'held') return null;
      await recordState(tx, booking.id, 'expired', at, { holdExpiresAt: null, endedAt: at });
      return booking;
    });
    if (!done) continue;
    await dropHoldKeys(done);
    const ride = await loadRide(db, done.ride_id);
    if (ride) await publishSeatMap(ride);
    await publishBooking(done.id);
  }
}

async function expireRequests(at: Date): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `select id from bookings where state = 'requested' and request_deadline <= $1`,
    [at],
  );
  for (const row of rows) {
    const done = await withTransaction(async (tx) => {
      const booking = await loadBookingForUpdate(tx, row.id);
      if (!booking || booking.state !== 'requested') return null;
      const ride = await loadRideForUpdate(tx, booking.ride_id);
      if (!ride) return null;
      await expireRequestWithin(tx, booking, ride, at);
      return { booking, ride };
    });
    if (!done) continue;
    await untrackRequestDeadline(done.booking.id);
    await publishSeatMap(done.ride);
    await publishBooking(done.booking.id);
    await publishWallet(done.booking.passenger_id);
  }
}

async function departRides(at: Date): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `select id from rides where state in ('published', 'changed') and departure <= $1`,
    [at],
  );
  for (const row of rows) {
    const changed = await withTransaction(async (tx) => {
      const ride = await loadRideForUpdate(tx, row.id);
      if (!ride || (ride.state !== 'published' && ride.state !== 'changed')) return false;
      await tx.query(`update rides set state = 'departed' where id = $1`, [ride.id]);
      return true;
    });
    if (changed) await publishRide(row.id);
  }
}

/** At arrival, every confirmed booking completes and the driver keeps everything. */
async function arriveRides(at: Date): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `select id from rides where state = 'departed'`,
  );
  for (const row of rows) {
    const result = await withTransaction(async (tx) => {
      const ride = await loadRideForUpdate(tx, row.id);
      if (!ride || ride.state !== 'departed') return null;
      const arrival = arrivalTime(ride);
      if (arrival.getTime() > at.getTime()) return null;
      await tx.query(`update rides set state = 'arrived' where id = $1`, [ride.id]);
      const completed: BookingRecord[] = [];
      for (const booking of await rideBookings(tx, ride.id)) {
        if (booking.state === 'held') {
          await recordState(tx, booking.id, 'expired', at, {
            holdExpiresAt: null,
            endedAt: at,
          });
          continue;
        }
        if (booking.state !== 'confirmed') continue;
        await recordState(tx, booking.id, 'completed', at);
        await tx.query('update bookings set rating_closes_at = $2 where id = $1', [
          booking.id,
          ratingWindowClose(arrival),
        ]);
        await ledger.completion(tx, at, booking.id, ride.driver_id, booking.price_cents);
        completed.push(booking);
      }
      return { ride, completed };
    });
    if (!result) continue;
    await publishRide(result.ride.id);
    for (const booking of result.completed) {
      await publishBooking(booking.id);
      publishRating(booking, result.ride.driver_id, 'open');
    }
  }
}

/**
 * When the window closes, one rating still reveals for both sides; no rating closes the
 * window with no email.
 */
async function closeRatingWindows(at: Date): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `select id from bookings
      where state = 'completed' and revealed_at is null and rating_closes_at <= $1`,
    [at],
  );
  for (const row of rows) {
    const result = await withTransaction(async (tx) => {
      const booking = await loadBookingForUpdate(tx, row.id);
      if (!booking || booking.state !== 'completed' || booking.revealed_at) return null;
      const ride = await loadRideForUpdate(tx, booking.ride_id);
      if (!ride) return null;
      const { rows: ratingRows } = await tx.query<{ count: number }>(
        'select count(*)::int as count from ratings where booking_id = $1',
        [booking.id],
      );
      const submitted = Number(ratingRows[0]?.count ?? 0);
      if (submitted > 0) {
        await revealRatings(tx, booking, ride, at);
        return { booking, ride, revealed: true };
      }
      await tx.query('update bookings set revealed_at = $2 where id = $1', [booking.id, at]);
      return { booking, ride, revealed: false };
    });
    if (!result) continue;
    publishRating(result.booking, result.ride.driver_id, result.revealed ? 'revealed' : 'closed');
    if (result.revealed) await publishBooking(result.booking.id);
  }
}

/** Valkey holds fast state only; when it is lost it is rebuilt from PostgreSQL. */
export async function rebuildVolatileState(at: Date): Promise<void> {
  const present = await valkey.exists(REBUILT_KEY).catch(() => 1);
  if (present === 1) return;

  const { rows: held } = await db.query<BookingRecord>(
    `select id, ride_id, passenger_id, boarding_idx, alighting_idx, seats, seat_numbers,
            segment_km, price_cents, state, created_at, hold_expires_at, request_deadline,
            ended_at, rating_closes_at, revealed_at
       from bookings where state = 'held'`,
  );
  for (const booking of held) {
    if (holdDeadline(booking.created_at).getTime() <= at.getTime()) continue;
    await writeHoldKeys(booking, booking.created_at);
  }

  const { rows: requested } = await db.query<{
    id: string;
    ride_id: string;
    created_at: Date;
    boarding_idx: number;
  }>(
    `select id, ride_id, created_at, boarding_idx from bookings where state = 'requested'`,
  );
  for (const booking of requested) {
    const ride = await loadRide(db, booking.ride_id);
    if (!ride) continue;
    await trackRequestDeadline(
      booking.id,
      requestDeadline(booking.created_at, boardingTimeOf(ride, booking.boarding_idx)),
    );
  }

  const { rows: recentMessages } = await db.query<{ author_id: string; sent_at: Date }>(
    'select author_id, sent_at from messages where sent_at > $1',
    [new Date(at.getTime() - 60_000)],
  );
  for (const message of recentMessages) {
    await valkey
      .zadd(keys.rateMessages(message.author_id), message.sent_at.getTime(), `${message.sent_at.getTime()}`)
      .catch(() => undefined);
  }

  const { rows: recentCodes } = await db.query<{ email: string; issued_at: Date }>(
    'select email, issued_at from sign_in_codes where issued_at > $1',
    [new Date(at.getTime() - 3_600_000)],
  );
  for (const code of recentCodes) {
    await valkey
      .zadd(keys.rateCodes(code.email), code.issued_at.getTime(), `${code.issued_at.getTime()}`)
      .catch(() => undefined);
  }

  await valkey.set(REBUILT_KEY, '1').catch(() => undefined);
}

let running = false;

/** Every due job, in the order the clock route promises. */
export async function runDueJobs(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const at = now();
    await rebuildVolatileState(at);
    await expireHolds(at);
    await expireRequests(at);
    await departRides(at);
    await arriveRides(at);
    await closeRatingWindows(at);
    await drainOutbox();
  } finally {
    running = false;
  }
}

export function startJobLoop(): void {
  const tick = () => {
    void runDueJobs().catch(() => undefined);
  };
  setInterval(tick, 5000).unref();
  tick();
}


