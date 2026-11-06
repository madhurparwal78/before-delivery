/** Test rides: slots, server-timed holds, confirmation, cancellation and the fitter's outcomes. */
import pg from 'pg';
import type { Ride, RideState, Slot, User } from '../shared/types.js';
import { BIKES } from './catalogue.js';
import { addDays, amsterdamIso, amsterdamToday, isRealDate, localInstants, shopNow, shopNowMs } from './clock.js';
import { config } from './config.js';
import { one, query, sql, theRow, transaction, type Db } from './db.js';
import { fail, invalid, notFound } from './errors.js';
import { isUuid } from './http.js';
import { queueMail } from './mail.js';
import { rideMail } from './mailtext.js';

interface RideRow {
  id: string; user_id: string; slot_id: string; bike_id: string; state: RideState; expires_at: Date | null;
  starts_at: Date; local_date: string; local_time: string; remaining: number; over: boolean; rider_name?: string;
}

const SELECT_RIDE = `SELECT r.id, r.user_id, r.slot_id, r.bike_id, r.state, r.expires_at, s.starts_at, s.local_date, s.local_time,
  GREATEST(0, CEIL(EXTRACT(EPOCH FROM (r.expires_at - now()))))::int AS remaining, (r.expires_at IS NOT NULL AND r.expires_at <= now()) AS over
  FROM rides r JOIN slots s ON s.id = r.slot_id`;

/** The first instant at or after which a day's same-day booking closes: 12:00 on the slot's own date. */
function noonOf(date: string): number {
  return localInstants(date, '12:00')[0];
}

/** Free cancellation ends at 18:00 on the day before the ride. */
function cancellationCutoff(date: string): number {
  return localInstants(addDays(date, -1), '18:00')[0];
}

function rideBody(row: RideRow): Ride {
  const bike = BIKES.filter((b) => b.id === row.bike_id)[0];
  return {
    id: row.id, bikeId: row.bike_id, slotId: row.slot_id, startsAt: amsterdamIso(row.starts_at.getTime()), localDate: row.local_date,
    localTime: row.local_time, state: row.state, expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    remainingSeconds: row.state === 'held' ? row.remaining : 0, serverNow: shopNow().toISOString(),
    freeCancellation: shopNowMs() < cancellationCutoff(row.local_date), bikeName: bike.name,
    ...(row.rider_name ? { riderName: row.rider_name } : {}),
  };
}

/** A hold whose time is up is expired for every read and write. */
export async function expireHolds(db: Db = sql): Promise<void> {
  await query(db, "UPDATE rides SET state = 'expired' WHERE state = 'held' AND expires_at <= now()");
}

export async function slotsOf(bikeId: string): Promise<Slot[]> {
  if (!BIKES.some((b) => b.id === bikeId)) throw notFound();
  await expireHolds();
  const rows = await query<{ id: string; starts_at: Date; local_date: string; local_time: string; state: RideState | null }>(
    sql,
    `SELECT s.id, s.starts_at, s.local_date, s.local_time,
       (SELECT r.state FROM rides r WHERE r.slot_id = s.id AND r.state IN ('held', 'confirmed', 'ridden', 'no-show') LIMIT 1) AS state
     FROM slots s WHERE s.bike_id = $1 ORDER BY s.starts_at`,
    [bikeId],
  );
  return rows.map((r) => ({
    id: r.id, bikeId, startsAt: amsterdamIso(r.starts_at.getTime()), localDate: r.local_date, localTime: r.local_time,
    status: r.state === null ? 'free' : r.state === 'held' ? 'held' : 'booked',
  }));
}

export async function holdSlot(user: User, slotId: unknown): Promise<Ride> {
  if (!isUuid(slotId)) throw notFound();
  const slot = await one<{ id: string; bike_id: string; starts_at: Date; local_date: string }>(sql, 'SELECT id, bike_id, starts_at, local_date FROM slots WHERE id = $1', [slotId]);
  if (!slot) throw notFound();
  await expireHolds();
  if (await one(sql, "SELECT 1 FROM rides WHERE user_id = $1 AND state = 'held'", [user.id])) throw fail(409, 'hold_exists');
  if (shopNowMs() >= noonOf(slot.local_date) || slot.starts_at.getTime() <= shopNowMs()) throw fail(409, 'same_day_closed');
  if (await one(sql, "SELECT 1 FROM rides WHERE slot_id = $1 AND state IN ('held', 'confirmed', 'ridden', 'no-show')", [slot.id])) throw fail(409, 'slot_gone');
  try {
    const created = await theRow<{ id: string }>(
      sql, "INSERT INTO rides (user_id, slot_id, bike_id, state, expires_at) VALUES ($1,$2,$3,'held', now() + make_interval(secs => $4)) RETURNING id",
      [user.id, slot.id, slot.bike_id, config.holdSeconds],
    );
    return rideBody(await theRow<RideRow>(sql, `${SELECT_RIDE} WHERE r.id = $1`, [created.id]));
  } catch (error) {
    if (error instanceof pg.DatabaseError && error.code === '23505') throw fail(409, error.constraint === 'rides_one_hold' ? 'hold_exists' : 'slot_gone');
    throw error;
  }
}

async function ownRide(db: Db, user: User, id: string, lock = false): Promise<RideRow> {
  if (!isUuid(id)) throw notFound();
  const row = await one<RideRow>(db, `${SELECT_RIDE} WHERE r.id = $1${lock ? ' FOR UPDATE OF r' : ''}`, [id]);
  if (!row || row.user_id !== user.id) throw notFound();
  return row;
}

export async function listRides(user: User): Promise<Ride[]> {
  await expireHolds();
  const rows = await query<RideRow>(sql, `${SELECT_RIDE} WHERE r.user_id = $1 ORDER BY r.created_at DESC`, [user.id]);
  return rows.map(rideBody);
}

export async function getRide(user: User, id: string): Promise<Ride> {
  await expireHolds();
  return rideBody(await ownRide(sql, user, id));
}

export async function confirmRide(user: User, id: string): Promise<Ride> {
  await expireHolds();
  return transaction(async (client) => {
    const ride = await ownRide(client, user, id, true);
    if (ride.state === 'confirmed') return rideBody(ride);
    if (ride.state === 'expired' || (ride.state === 'held' && ride.over)) throw fail(409, 'hold_expired');
    if (ride.state !== 'held') throw fail(409, 'illegal_transition');
    await query(client, "UPDATE rides SET state = 'confirmed', expires_at = NULL WHERE id = $1", [id]);
    const bike = BIKES.filter((b) => b.id === ride.bike_id)[0];
    const mail = rideMail(bike.name, ride.local_date, ride.local_time, id);
    await queueMail(client, `ride:${id}`, user.email, mail.subject, mail.body);
    return rideBody(await ownRide(client, user, id));
  });
}

export async function cancelRide(user: User, id: string): Promise<Ride> {
  return transaction(async (client) => {
    const ride = await ownRide(client, user, id, true);
    if (ride.state !== 'confirmed') throw fail(409, 'illegal_transition');
    if (shopNowMs() >= cancellationCutoff(ride.local_date)) throw fail(409, 'cancellation_closed');
    await query(client, "UPDATE rides SET state = 'cancelled' WHERE id = $1", [id]);
    return rideBody(await ownRide(client, user, id));
  });
}

// ---- the fitter's desk ------------------------------------------------------------------------------------------------------------

export async function openSlots(input: Record<string, unknown>): Promise<Slot[]> {
  const bike = BIKES.find((b) => b.id === input['bikeId']);
  if (!bike) throw notFound();
  const date = typeof input['date'] === 'string' ? input['date'] : '';
  const errors: Record<string, string> = {};
  if (!isRealDate(date)) errors['date'] = 'Enter a date as YYYY-MM-DD.';
  else if (date < amsterdamToday()) errors['date'] = 'Choose today or a later date.';
  const times: string[] = Array.isArray(input['times']) ? input['times'] : [];
  if (times.length === 0 || !times.every((t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) {
    errors['times'] = 'Enter times like 10:00, 13:00.';
  } else if (!errors['date'] && times.some((t) => localInstants(date, t).length === 0)) {
    errors['times'] = 'That time does not exist on this date.';
  }
  if (Object.keys(errors).length) throw invalid(errors);
  const created: Slot[] = [];
  for (const time of [...new Set(times)]) {
    const instant = localInstants(date, time)[0];
    const row = await one<{ id: string }>(sql, 'INSERT INTO slots (bike_id, starts_at, local_date, local_time) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id', [bike.id, new Date(instant).toISOString(), date, time]);
    if (row) created.push({ id: row.id, bikeId: bike.id, startsAt: amsterdamIso(instant), localDate: date, localTime: time, status: 'free' });
  }
  if (!created.length) throw fail(409, 'slot_exists');
  return created;
}

export async function ridesOn(date: string | null): Promise<Ride[]> {
  if (date === null || !isRealDate(date)) throw invalid({ date: 'Enter a date as YYYY-MM-DD.' });
  await expireHolds();
  const rows = await query<RideRow>(
    sql,
    `SELECT r.id, r.user_id, r.slot_id, r.bike_id, r.state, r.expires_at, s.starts_at, s.local_date, s.local_time, 0 AS remaining, false AS over, u.name AS rider_name
     FROM rides r JOIN slots s ON s.id = r.slot_id JOIN users u ON u.id = r.user_id
     WHERE s.local_date = $1 AND r.state IN ('confirmed', 'ridden', 'no-show') ORDER BY s.starts_at`,
    [date],
  );
  return rows.map(rideBody);
}

export async function markOutcome(id: string, outcome: unknown): Promise<Ride> {
  if (!isUuid(id)) throw notFound();
  return transaction(async (client) => {
    const ride = await one<RideRow>(client, `${SELECT_RIDE} WHERE r.id = $1 FOR UPDATE OF r`, [id]);
    if (!ride) throw notFound();
    if (ride.state !== 'confirmed') throw fail(409, 'illegal_transition');
    if (outcome !== 'ridden' && outcome !== 'no-show') throw invalid({ outcome: 'Choose ridden or no-show.' });
    if (amsterdamToday() < ride.local_date) throw fail(409, 'ride_not_started');
    await query(client, 'UPDATE rides SET state = $2 WHERE id = $1', [id, outcome]);
    return rideBody(await theRow<RideRow>(client, `${SELECT_RIDE} WHERE r.id = $1`, [id]));
  });
}
