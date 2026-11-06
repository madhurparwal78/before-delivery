import type { Config } from '../config.js';
import { query, withClient } from '../db.js';
import { newId } from '../store.js';
import { amsterdamParts, amsterdamNoon, amsterdamDayBeforeAt18 } from '../clock.js';
import { BIKES } from './seed.js';
import { queueMail, recordMailFact } from '../mail.js';

// Test rides: holds on the server clock, one live hold per rider, one ride per
// slot, cutoffs in Amsterdam business time.

export class RideError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
  }
}

export interface RideRecord {
  id: string;
  bikeId: string;
  slotId: string;
  startsAt: string;
  localDate: string;
  localTime: string;
  state: 'held' | 'confirmed' | 'ridden' | 'no-show' | 'expired' | 'cancelled';
  expiresAt: string;
  remainingSeconds: number;
  serverNow: string;
  freeCancellation: boolean;
}

// A hold expires when its real-time deadline passes. Marks it within a second
// with no client involved; every read and write treats it as expired anyway.
export async function expireHolds(config: Config): Promise<void> {
  const r = await query(
    config,
    `update rides set state = 'expired' where state = 'held' and expires_at <= now()`,
  );
  void r;
}

export async function markExpiredHolds(config: Config): Promise<void> {
  await expireHolds(config);
}

async function rideJson(row: Record<string, unknown>): Promise<RideRecord> {
  const nowReal = Date.now();
  const expires = new Date(row['expires_at'] as string).getTime();
  const remaining = Math.max(0, Math.ceil((expires - nowReal) / 1000));
  const state = row['state'] as RideRecord['state'];
  const effective = state === 'held' && remaining <= 0 ? 'expired' : state;
  const freeCancellation = freeCancellationNow(row['local_date'] as string, nowReal);
  return {
    id: row['id'] as string,
    bikeId: row['bike_id'] as string,
    slotId: row['slot_id'] as string,
    startsAt: row['starts_at'] as string,
    localDate: row['local_date'] as string,
    localTime: row['local_time'] as string,
    state: effective,
    expiresAt: row['expires_at'] as string,
    remainingSeconds: state === 'held' ? remaining : 0,
    serverNow: new Date().toISOString(),
    freeCancellation,
  };
}

function freeCancellationNow(localDate: string, nowMs: number): boolean {
  // Free cancellation strictly before 18:00 Amsterdam the day before.
  return nowMs < amsterdamDayBeforeAt18(localDate);
}

export async function getRide(config: Config, rideId: string, userId: string | null): Promise<RideRecord | null> {
  await expireHolds(config);
  const r = await query<Record<string, unknown>>(
    config,
    `select id, user_id, bike_id, slot_id, starts_at, local_date, local_time, state, expires_at from rides where id = $1`,
    [rideId],
  );
  if (r.rows.length === 0) return null;
  if (userId !== null && r.rows[0]!['user_id'] !== userId) return null;
  return rideJson(r.rows[0]!);
}

export async function listRides(config: Config, userId: string): Promise<RideRecord[]> {
  await expireHolds(config);
  const r = await query<Record<string, unknown>>(
    config,
    `select id, user_id, bike_id, slot_id, starts_at, local_date, local_time, state, expires_at from rides where user_id = $1 order by starts_at`,
    [userId],
  );
  const result: RideRecord[] = [];
  for (const row of r.rows) result.push(await rideJson(row));
  return result;
}

export async function holdSlot(config: Config, userId: string, slotId: string, holdSeconds: number): Promise<RideRecord> {
  await expireHolds(config);
  const slot = await query<Record<string, unknown>>(
    config,
    `select id, bike_id, starts_at, local_date, local_time from slots where id = $1`,
    [slotId],
  );
  if (slot.rows.length === 0) throw new RideError('slot_gone', 409);

  // Same-day: at or after 12:00 Amsterdam on the slot's date, or any past slot.
  const nowMs = Date.now();
  const slotDate = slot.rows[0]!['local_date'] as string;
  if (nowMs >= amsterdamNoon(slotDate) || nowMs >= new Date(slot.rows[0]!['starts_at'] as string).getTime()) {
    throw new RideError('same_day_closed', 409);
  }

  // One live hold per rider; exactly one of simultaneous claims holds the slot.
  const rideId = newId('ride');
  try {
    await withClient(config, async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtext($1))', ['rides']);
      const liveHold = await client.query(`select 1 from rides where user_id = $1 and state = 'held' and expires_at > now()`, [userId]);
      if (liveHold.rows.length > 0) throw new RideError('hold_exists', 409);
      const taken = await client.query(`select 1 from rides where slot_id = $1 and state in ('held','confirmed') and (state = 'confirmed' or expires_at > now())`, [slotId]);
      if (taken.rows.length > 0) throw new RideError('slot_gone', 409);
      await client.query(
        `insert into rides (id, user_id, slot_id, bike_id, starts_at, local_date, local_time, state, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'held', now() + make_interval(secs => $8))`,
        [rideId, userId, slotId, slot.rows[0]!['bike_id'], slot.rows[0]!['starts_at'], slotDate, slot.rows[0]!['local_time'], holdSeconds],
      );
    });
  } catch (e) {
    if (e instanceof RideError) throw e;
    throw e;
  }
  const ride = await getRide(config, rideId, userId);
  return ride!;
}

export async function confirmRide(config: Config, rideId: string, userId: string): Promise<RideRecord> {
  await expireHolds(config);
  const ride = await getRide(config, rideId, userId);
  if (!ride) throw new RideError('not_found', 404);
  if (ride.state === 'confirmed') {
    // Repeating on a confirmed ride returns the same with no new mail.
    return ride;
  }
  if (ride.state === 'held' && ride.remainingSeconds <= 0) throw new RideError('hold_expired', 409);
  if (ride.state !== 'held') throw new RideError('illegal_transition', 409);
  await query(config, `update rides set state = 'confirmed' where id = $1`, [rideId]);

  // One confirmation mail, recorded as part of the fact.
  const factKey = `ride:${rideId}`;
  if (await recordMailFact(config, factKey)) {
    const user = await query<{ email: string }>(config, 'select email from users where id = $1', [userId]);
    const bikeName = BIKES.find((b) => b.id === ride.bikeId)?.name ?? ride.bikeId;
    await queueMail(config, {
      id: newId('mail'),
      toEmail: user.rows[0]!.email,
      subject: `Test ride confirmed: ${bikeName} on ${ride.localDate} at ${ride.localTime}`,
      body: [
        `Bike: ${bikeName}`,
        `Date: ${ride.localDate}`,
        `Time: ${ride.localTime}`,
        `Ride address: /rides/${rideId}`,
      ].join('\n'),
    });
  }
  const fresh = await getRide(config, rideId, userId);
  return fresh!;
}

export async function cancelRide(config: Config, rideId: string, userId: string): Promise<RideRecord> {
  await expireHolds(config);
  const ride = await getRide(config, rideId, userId);
  if (!ride) throw new RideError('not_found', 404);
  if (ride.state !== 'confirmed') throw new RideError('illegal_transition', 409);
  if (!ride.freeCancellation) throw new RideError('cancellation_closed', 409);
  await query(config, `update rides set state = 'cancelled' where id = $1`, [rideId]);
  const fresh = await getRide(config, rideId, userId);
  return fresh!;
}

export async function deskListRides(config: Config, date: string): Promise<(RideRecord & { riderName: string; bikeName: string })[]> {
  await expireHolds(config);
  const r = await query<Record<string, unknown>>(
    config,
    `select r.id, r.user_id, r.bike_id, r.slot_id, r.starts_at, r.local_date, r.local_time, r.state, r.expires_at, u.name as rider_name
     from rides r join users u on u.id = r.user_id where r.local_date = $1 order by r.starts_at`,
    [date],
  );
  const out: (RideRecord & { riderName: string; bikeName: string })[] = [];
  for (const row of r.rows) {
    const ride = await rideJson(row);
    out.push({ ...ride, riderName: row['rider_name'] as string, bikeName: BIKES.find((b) => b.id === row['bike_id'])?.name ?? (row['bike_id'] as string) });
  }
  return out;
}

export async function markOutcome(config: Config, rideId: string, outcome: 'ridden' | 'no-show'): Promise<RideRecord> {
  await expireHolds(config);
  const ride = await getRide(config, rideId, null);
  if (!ride) throw new RideError('not_found', 404);
  if (ride.state !== 'confirmed') throw new RideError('illegal_transition', 409);
  // Outcomes may be marked from the ride's date onward.
  const nowMs = Date.now();
  const today = amsterdamParts(nowMs).date;
  if (ride.localDate > today) throw new RideError('ride_not_started', 409);
  await query(config, `update rides set state = $2 where id = $1`, [rideId, outcome]);
  const fresh = await getRide(config, rideId, null);
  return fresh!;
}
