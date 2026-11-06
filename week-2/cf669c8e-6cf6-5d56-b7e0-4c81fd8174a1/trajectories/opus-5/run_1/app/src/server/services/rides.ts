/**
 * Test rides: slots, holds, confirmation, cancellation and the fitter's day.
 *
 * Holds expire on the server's clock, whatever the device clock says. Of any
 * number of simultaneous claims on a slot, on any instance, exactly one holds
 * it, because a partial unique index on the slot carries the race; a second
 * live hold by one rider is refused the same way.
 *
 * Every cutoff is judged in Amsterdam business time with the true offset on
 * the slot's date.
 */

import { randomUUID } from 'node:crypto';

import { bikeById } from '../../shared/seed.js';
import type { DeskRide, Ride, RideState, Slot } from '../../shared/types.js';
import {
  HOLD_SECONDS,
  amsterdamDate,
  instantAtAmsterdamWallTime,
  isIsoDate,
  parseIsoDate,
  realNow,
  shopNow,
} from '../domain/clock.js';
import { poolQueryable, query, transact, type Queryable } from '../db/pool.js';
import { claimMail, flushMail, testRideConfirmationMail } from '../providers/mail.js';
import { conflict, notFound, ValidationError } from '../http/errors.js';

/** Same-day booking closes at 12:00 Amsterdam time on the slot's date. */
const SAME_DAY_CUTOFF_HOUR = 12;
/** Free cancellation closes at 18:00 Amsterdam time the day before the ride. */
const CANCELLATION_CUTOFF_HOUR = 18;

interface RideRow {
  id: string;
  user_id: string;
  bike_id: string;
  slot_id: string;
  state: RideState;
  expires_at: Date | null;
}

interface SlotRow {
  id: string;
  bike_id: string;
  starts_at: Date;
  local_date: string;
  local_time: string;
}

/** The instant a slot's free-cancellation window closes. */
function cancellationCutoff(localDate: string): Date {
  const { year, month, day } = parseIsoDate(localDate);
  const dayBefore = new Date(Date.UTC(year, month - 1, day - 1));
  const instant = instantAtAmsterdamWallTime(
    dayBefore.getUTCFullYear(),
    dayBefore.getUTCMonth() + 1,
    dayBefore.getUTCDate(),
    CANCELLATION_CUTOFF_HOUR,
    0,
  );
  if (!instant) throw new Error(`${CANCELLATION_CUTOFF_HOUR}:00 does not exist before ${localDate}`);
  return instant;
}

/** The instant same-day booking closes on a slot's date. */
function sameDayCutoff(localDate: string): Date {
  const { year, month, day } = parseIsoDate(localDate);
  const instant = instantAtAmsterdamWallTime(year, month, day, SAME_DAY_CUTOFF_HOUR, 0);
  if (!instant) throw new Error(`${SAME_DAY_CUTOFF_HOUR}:00 does not exist on ${localDate}`);
  return instant;
}

function toRide(row: RideRow, slot: SlotRow): Ride {
  const now = realNow();
  const localDate = slot.local_date;
  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
  const remaining =
    row.state === 'held' && expiresAt
      ? Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000))
      : null;
  return {
    id: row.id,
    bikeId: row.bike_id,
    slotId: row.slot_id,
    startsAt: new Date(slot.starts_at).toISOString(),
    localDate,
    localTime: slot.local_time,
    state: row.state,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    remainingSeconds: remaining,
    serverNow: shopNow().toISOString(),
    freeCancellation: shopNow().getTime() < cancellationCutoff(localDate).getTime(),
  };
}

/**
 * A hold whose time is up is treated as expired for every read and write. The
 * expiry worker marks it within a second, and this keeps reads honest in
 * between.
 */
function effectiveState(row: RideRow): RideState {
  if (row.state !== 'held') return row.state;
  if (!row.expires_at) return row.state;
  return new Date(row.expires_at).getTime() <= realNow().getTime() ? 'expired' : 'held';
}

async function slotFor(client: Queryable, slotId: string): Promise<SlotRow> {
  const found = await client.query<SlotRow>('SELECT * FROM bike_slots WHERE id = $1', [slotId]);
  const slot = found.rows[0];
  if (!slot) throw notFound();
  return slot;
}

export async function listSlots(bikeId: string): Promise<Slot[]> {
  const slots = await query<SlotRow>(
    'SELECT * FROM bike_slots WHERE bike_id = $1 ORDER BY starts_at',
    [bikeId],
  );
  const rides = await query<RideRow>(
    `SELECT * FROM test_rides WHERE slot_id = ANY($1::uuid[])
       AND state IN ('held', 'confirmed', 'ridden', 'no-show')`,
    [slots.rows.map((slot) => slot.id)],
  );

  const live = new Map<string, RideRow>();
  for (const ride of rides.rows) {
    if (effectiveState(ride) === 'expired') continue;
    live.set(ride.slot_id, ride);
  }

  return slots.rows.map((slot) => {
    const ride = live.get(slot.id);
    const status: Slot['status'] = !ride ? 'free' : ride.state === 'held' ? 'held' : 'booked';
    return {
      id: slot.id,
      bikeId: slot.bike_id,
      startsAt: new Date(slot.starts_at).toISOString(),
      localDate: slot.local_date,
      localTime: slot.local_time,
      status,
    };
  });
}

/**
 * Claim a hold. The checks run in the published order: `hold_exists`,
 * `same_day_closed`, then `slot_gone`.
 */
export async function holdSlot(userId: string, slotId: unknown): Promise<Ride> {
  if (typeof slotId !== 'string' || slotId.length === 0) throw notFound();

  const result = await transact(async (client) => {
    const slot = await slotFor(client, slotId);

    const live = await client.query<RideRow>(
      `SELECT * FROM test_rides WHERE user_id = $1 AND state = 'held'`,
      [userId],
    );
    const existing = live.rows[0];
    if (existing && effectiveState(existing) === 'held') throw conflict('hold_exists');

    // At or after 12:00 on the slot's date, or for any past slot, booking is closed.
    const now = shopNow();
    const localDate = slot.local_date;
    if (
      new Date(slot.starts_at).getTime() <= now.getTime() ||
      now.getTime() >= sameDayCutoff(localDate).getTime()
    ) {
      throw conflict('same_day_closed');
    }

    // Expire this rider's own lapsed hold so the unique index lets the new one in.
    await client.query(
      `UPDATE test_rides SET state = 'expired'
       WHERE user_id = $1 AND state = 'held' AND expires_at <= now()`,
      [userId],
    );
    await client.query(
      `UPDATE test_rides SET state = 'expired'
       WHERE slot_id = $1 AND state = 'held' AND expires_at <= now()`,
      [slotId],
    );

    const rideId = randomUUID();
    const expiresAt = new Date(realNow().getTime() + HOLD_SECONDS * 1000);
    const inserted = await client.query<RideRow>(
      `INSERT INTO test_rides(id, user_id, bike_id, slot_id, state, expires_at)
       VALUES ($1, $2, $3, $4, 'held', $5)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [rideId, userId, slot.bike_id, slotId, expiresAt.toISOString()],
    );
    const row = inserted.rows[0];
    // The unique indexes decide the race: the slot is gone, or this rider
    // already holds one.
    if (!row) {
      const mine = await client.query(
        `SELECT 1 FROM test_rides WHERE user_id = $1 AND state = 'held'`,
        [userId],
      );
      throw mine.rowCount && mine.rowCount > 0 ? conflict('hold_exists') : conflict('slot_gone');
    }

    return toRide(row, slot);
  });

  return result;
}

export async function listRides(userId: string): Promise<Ride[]> {
  const rides = await query<RideRow>(
    'SELECT * FROM test_rides WHERE user_id = $1 ORDER BY created_at DESC',
    [userId],
  );
  const out: Ride[] = [];
  for (const row of rides.rows) {
    const slot = await slotFor(poolQueryable, row.slot_id);
    out.push(toRide({ ...row, state: effectiveState(row) }, slot));
  }
  return out;
}

export async function readRide(userId: string, rideId: string): Promise<Ride> {
  const found = await query<RideRow>('SELECT * FROM test_rides WHERE id = $1', [rideId]);
  const row = found.rows[0];
  // Another rider's ride behaves exactly like a missing one.
  if (!row || row.user_id !== userId) throw notFound();
  const slot = await slotFor(poolQueryable, row.slot_id);
  return toRide({ ...row, state: effectiveState(row) }, slot);
}

/** Confirming a live hold. Repeating on a confirmed ride sends no new mail. */
export async function confirmRide(userId: string, rideId: string): Promise<Ride> {
  const claimed = await transact(async (client) => {
    const found = await client.query<RideRow>('SELECT * FROM test_rides WHERE id = $1 FOR UPDATE', [rideId]);
    const row = found.rows[0];
    if (!row || row.user_id !== userId) throw notFound();

    const slot = await slotFor(client, row.slot_id);

    if (row.state === 'confirmed') return { ride: toRide(row, slot), mailClaimed: false };
    // A hold whose time is up answers `hold_expired`, whether the expiry worker
    // has marked it yet or the clock has merely passed it.
    if (row.state === 'expired' || effectiveState(row) === 'expired') throw conflict('hold_expired');
    if (row.state !== 'held') throw conflict('illegal_transition');

    const updated = await client.query<RideRow>(
      `UPDATE test_rides SET state = 'confirmed', expires_at = NULL WHERE id = $1 RETURNING *`,
      [rideId],
    );
    const confirmed = updated.rows[0];
    if (!confirmed) throw notFound();

    const details = await client.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId]);
    const email = details.rows[0]?.email;
    const bike = bikeById(row.bike_id);
    const mailClaimed =
      email && bike
        ? await claimMail(
            client,
            testRideConfirmationMail({
              recipient: email,
              rideId,
              bikeName: bike.name,
              localDate: slot.local_date,
              localTime: slot.local_time,
            }),
          )
        : false;

    return { ride: toRide(confirmed, slot), mailClaimed };
  });

  if (claimed.mailClaimed) void flushMail().catch(() => undefined);
  return claimed.ride;
}

export async function cancelRide(userId: string, rideId: string): Promise<Ride> {
  return transact(async (client) => {
    const found = await client.query<RideRow>('SELECT * FROM test_rides WHERE id = $1 FOR UPDATE', [rideId]);
    const row = found.rows[0];
    if (!row || row.user_id !== userId) throw notFound();

    const slot = await slotFor(client, row.slot_id);
    if (row.state !== 'confirmed') throw conflict('illegal_transition');

    if (shopNow().getTime() >= cancellationCutoff(slot.local_date).getTime()) {
      throw conflict('cancellation_closed');
    }

    const updated = await client.query<RideRow>(
      `UPDATE test_rides SET state = 'cancelled' WHERE id = $1 RETURNING *`,
      [rideId],
    );
    const cancelled = updated.rows[0];
    if (!cancelled) throw notFound();
    return toRide(cancelled, slot);
  });
}

export interface RideDayInput {
  bikeId: unknown;
  date: unknown;
  times: unknown;
}

/** The fitter opens slots for a bike on a date. */
export async function openRideDay(input: RideDayInput): Promise<Slot[]> {
  const errors: Record<string, string> = {};

  const bikeId = typeof input.bikeId === 'string' ? input.bikeId : '';
  if (!bikeById(bikeId)) errors.bikeId = 'Pick a bike from the catalogue.';

  const date = typeof input.date === 'string' ? input.date : '';
  if (!isIsoDate(date)) errors.date = 'Enter a date as YYYY-MM-DD.';
  else if (date < amsterdamDate()) errors.date = 'The date cannot be in the past.';

  const rawTimes = Array.isArray(input.times) ? input.times : [];
  const times: string[] = [];
  for (const raw of rawTimes) {
    if (typeof raw !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.trim())) {
      errors.times = 'Enter times as HH:MM, separated by commas.';
      break;
    }
    times.push(raw.trim());
  }
  if (!errors.times && times.length === 0) errors.times = 'Enter times as HH:MM, separated by commas.';

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const planned: { time: string; startsAt: Date }[] = [];
  for (const time of times) {
    const [hour, minute] = time.split(':').map(Number);
    const { year, month, day } = parseIsoDate(date);
    const startsAt = instantAtAmsterdamWallTime(year, month, day, hour as number, minute as number, 0);
    // A slot time that does not exist on the spring clock change is refused.
    if (!startsAt) throw new ValidationError({ times: 'That time does not exist on this date.' });
    planned.push({ time, startsAt });
  }

  return transact(async (client) => {
    const created: Slot[] = [];
    for (const slot of planned) {
      const inserted = await client.query<SlotRow>(
        `INSERT INTO bike_slots(id, bike_id, starts_at, local_date, local_time)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (bike_id, starts_at) DO NOTHING
         RETURNING *`,
        [randomUUID(), bikeId, slot.startsAt.toISOString(), date, slot.time],
      );
      const row = inserted.rows[0];
      if (row) {
        created.push({
          id: row.id,
          bikeId: row.bike_id,
          startsAt: new Date(row.starts_at).toISOString(),
          localDate: row.local_date,
          localTime: row.local_time,
          status: 'free',
        });
      }
    }
    if (created.length === 0) throw conflict('slot_exists');
    return created;
  });
}

export async function deskRidesOn(date: string): Promise<DeskRide[]> {
  const rows = await query<RideRow & { rider_name: string }>(
    `SELECT r.*, u.name AS rider_name
     FROM test_rides r
     JOIN users u ON u.id = r.user_id
     JOIN bike_slots s ON s.id = r.slot_id
     WHERE s.local_date = $1
     ORDER BY s.starts_at`,
    [date],
  );

  const out: DeskRide[] = [];
  for (const row of rows.rows) {
    const slot = await slotFor(poolQueryable, row.slot_id);
    out.push({
      ...toRide({ ...row, state: effectiveState(row) }, slot),
      riderName: row.rider_name,
      bikeName: bikeById(row.bike_id)?.name ?? row.bike_id,
    });
  }
  return out;
}

/** Outcomes may be marked from the ride's date onward. */
export async function markOutcome(rideId: string, outcome: unknown): Promise<Ride> {
  if (outcome !== 'ridden' && outcome !== 'no-show') throw conflict('illegal_transition');

  return transact(async (client) => {
    const found = await client.query<RideRow>('SELECT * FROM test_rides WHERE id = $1 FOR UPDATE', [rideId]);
    const row = found.rows[0];
    if (!row) throw notFound();

    const slot = await slotFor(client, row.slot_id);
    if (row.state !== 'confirmed') throw conflict('illegal_transition');

    if (amsterdamDate() < slot.local_date) throw conflict('ride_not_started');

    const updated = await client.query<RideRow>('UPDATE test_rides SET state = $2 WHERE id = $1 RETURNING *', [
      rideId,
      outcome,
    ]);
    const marked = updated.rows[0];
    if (!marked) throw notFound();
    return toRide(marked, slot);
  });
}

/**
 * Mark lapsed holds expired. Instances sharing a database leave one `expired`
 * state, because the UPDATE claims the rows.
 */
export async function expireLapsedHolds(): Promise<number> {
  const expired = await query(
    `UPDATE test_rides SET state = 'expired'
     WHERE state = 'held' AND expires_at <= now()
     RETURNING id`,
  );
  return expired.rowCount ?? 0;
}

export { cancellationCutoff, sameDayCutoff };
