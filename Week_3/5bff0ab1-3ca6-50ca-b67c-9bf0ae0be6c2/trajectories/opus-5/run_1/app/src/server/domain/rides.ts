import type { HubId, ModelId } from '../../shared/catalogue.js';
import type { Ride } from '../../shared/types.js';
import { appNow, isCalendarDate, istDate, istSlotKey, parseIsoInstant } from '../clock.js';
import { newId, query, transact, type Tx } from '../db.js';
import { fail } from '../errors.js';
import { claimSlot, releaseSlot } from '../ledger.js';
import { isBookableStart, slotCutOff } from './calendar.js';
import { bumpRiderRev, bumpSeq, hubStatus } from './hubstate.js';
import { cancelRideNotices, retimeRideReminder, scheduleRideReminder } from './notices.js';
import { rideView, type RideRow } from './views.js';

export interface RideBody {
  startsAt: unknown;
  licenceNumber: unknown;
  licenceValidUntil: unknown;
  hasMcwg: unknown;
}

export function normaliseLicence(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

function licenceLooksRight(value: unknown): boolean {
  return typeof value === 'string' && /^[A-Z]{2}\d{13}$/.test(normaliseLicence(value));
}

/** Every licence rule for a ride, in one place. */
function checkLicence(body: RideBody, rideDate: string): void {
  if (typeof body.licenceNumber !== 'string' || body.licenceNumber.trim() === '') {
    fail('invalid_body');
  }
  if (typeof body.licenceValidUntil !== 'string' || !isCalendarDate(body.licenceValidUntil)) {
    fail('invalid_body');
  }
  if (typeof body.hasMcwg !== 'boolean') fail('invalid_body');
  if (!licenceLooksRight(body.licenceNumber)) fail('licence_invalid');
  if (body.hasMcwg !== true) fail('mcwg_required');
  if ((body.licenceValidUntil as string) < rideDate) fail('licence_expired');
}

export async function ridesOfRider(riderId: string): Promise<RideRow[]> {
  return query<RideRow>(
    'select * from rides where rider_id = $1 order by starts_at asc',
    [riderId],
  );
}

export async function rideForRider(riderId: string, id: string): Promise<RideRow | null> {
  const rows = await query<RideRow>('select * from rides where id = $1 and rider_id = $2', [
    id,
    riderId,
  ]);
  return rows[0] ?? null;
}

export async function rideForHub(hub: HubId, id: string): Promise<RideRow | null> {
  const rows = await query<RideRow>('select * from rides where id = $1 and hub = $2', [id, hub]);
  return rows[0] ?? null;
}

export async function bookRide(
  riderId: string,
  hub: HubId,
  model: ModelId,
  body: RideBody,
): Promise<{ status: 200 | 201; ride: Ride }> {
  const now = appNow();
  const startsAt = parseIsoInstant(body.startsAt);
  const id = newId();
  let gatedSlot: string | null = null;
  try {
    return await transact(async (tx) => {
      await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`${riderId}:ride:${model}`]);
      const booked = await tx.one<RideRow>(
        `select * from rides where rider_id = $1 and model = $2 and state = 'booked'`,
        [riderId, model],
      );
      if (booked) {
        if (
          startsAt &&
          booked.hub === hub &&
          booked.starts_at.getTime() === startsAt.getTime()
        ) {
          return { status: 200 as const, ride: rideView(booked, now) };
        }
        fail('ride_exists');
      }
      const inPattern = startsAt !== null && isBookableStart(hub, startsAt, now);
      if (inPattern && startsAt) {
        if (now.getTime() >= slotCutOff(startsAt).getTime()) fail('ride_cut_off');
        const taken = await tx.one<{ id: string }>(
          `select id from rides where hub = $1 and starts_at = $2 and state = 'booked'`,
          [hub, startsAt],
        );
        if (taken) fail('slot_taken');
      }
      if (!startsAt) fail('invalid_body');
      if (!inPattern) fail('invalid_slot');
      checkLicence(body, istDate(startsAt));

      const status = await hubStatus(hub);
      if (status.stale) fail('hub_unreachable');

      const slot = istSlotKey(startsAt);
      const won = await claimSlot(hub, slot, id);
      if (!won) fail('slot_taken');
      gatedSlot = slot;
      await tx.query(
        `insert into rides (id, rider_id, hub, model, state, starts_at, booked_at)
         values ($1,$2,$3,$4,'booked',$5,$6)`,
        [id, riderId, hub, model, startsAt, now],
      );
      await tx.query(
        `update users set licence_number = $2, licence_valid_until = $3 where id = $1`,
        [riderId, normaliseLicence(body.licenceNumber as string), body.licenceValidUntil],
      );
      await scheduleRideReminder(tx, id, riderId, startsAt, now);
      await bumpSeq(hub, tx);
      await bumpRiderRev(riderId, tx);
      const row = await tx.one<RideRow>('select * from rides where id = $1', [id]);
      gatedSlot = null;
      return { status: 201 as const, ride: rideView(row as RideRow, now) };
    });
  } catch (error) {
    if (gatedSlot) await releaseSlot(hub, gatedSlot, id).catch(() => undefined);
    throw error;
  }
}

export async function moveRide(riderId: string, id: string, startsAtRaw: unknown): Promise<Ride> {
  const now = appNow();
  const startsAt = parseIsoInstant(startsAtRaw);
  let gated: { hub: HubId; slot: string } | null = null;
  const noteGate = (hub: HubId, slot: string): void => {
    gated = { hub, slot };
  };
  try {
    return await transact(async (tx) => {
      const row = await tx.one<RideRow>(
        'select * from rides where id = $1 and rider_id = $2 for update',
        [id, riderId],
      );
      if (!row) fail('not_found');
      const hub = row.hub as HubId;
      if (row.state !== 'booked') fail('illegal_state');
      if (now.getTime() >= slotCutOff(row.starts_at).getTime()) fail('ride_cut_off');
      if (startsAt && startsAt.getTime() === row.starts_at.getTime()) fail('illegal_state');
      const inPattern = startsAt !== null && isBookableStart(hub, startsAt, now);
      if (inPattern && startsAt) {
        if (now.getTime() >= slotCutOff(startsAt).getTime()) fail('ride_cut_off');
        const taken = await tx.one<{ id: string }>(
          `select id from rides where hub = $1 and starts_at = $2 and state = 'booked'`,
          [hub, startsAt],
        );
        if (taken) fail('slot_taken');
      }
      if (!startsAt) fail('invalid_body');
      if (!inPattern) fail('invalid_slot');
      const rider = await tx.one<{ licence_valid_until: string | null }>(
        'select licence_valid_until from users where id = $1',
        [riderId],
      );
      if (rider?.licence_valid_until && rider.licence_valid_until < istDate(startsAt)) {
        fail('licence_expired');
      }

      const status = await hubStatus(hub);
      if (status.stale) fail('hub_unreachable');

      const slot = istSlotKey(startsAt);
      const won = await claimSlot(hub, slot, row.id);
      if (!won) fail('slot_taken');
      noteGate(hub, slot);
      const changed = await tx.query(
        `update rides set starts_at = $2, moved_from = $3 where id = $1 and state = 'booked' returning id`,
        [id, startsAt, row.starts_at],
      );
      if (changed.length === 0) fail('illegal_state');
      await releaseSlot(hub, istSlotKey(row.starts_at), row.id);
      await retimeRideReminder(tx, id, startsAt);
      await bumpSeq(hub, tx);
      await bumpRiderRev(riderId, tx);
      const after = await tx.one<RideRow>('select * from rides where id = $1', [id]);
      gated = null;
      return rideView(after as RideRow, now);
    });
  } catch (error) {
    const pending = gated as { hub: HubId; slot: string } | null;
    if (pending) await releaseSlot(pending.hub, pending.slot, id).catch(() => undefined);
    throw error;
  }
}

export async function cancelRide(riderId: string, id: string): Promise<Ride> {
  const now = appNow();
  return transact(async (tx) => {
    const row = await tx.one<RideRow>(
      'select * from rides where id = $1 and rider_id = $2 for update',
      [id, riderId],
    );
    if (!row) fail('not_found');
    const hub = row.hub as HubId;
    if (row.state !== 'booked') fail('illegal_state');
    if (now.getTime() >= slotCutOff(row.starts_at).getTime()) fail('ride_cut_off');
    const status = await hubStatus(hub);
    if (status.stale) fail('hub_unreachable');
    const changed = await tx.query(
      `update rides set state = 'cancelled' where id = $1 and state = 'booked' returning id`,
      [id],
    );
    if (changed.length === 0) fail('illegal_state');
    await releaseSlot(hub, istSlotKey(row.starts_at), row.id);
    await cancelRideNotices(tx, id);
    await bumpSeq(hub, tx);
    await bumpRiderRev(riderId, tx);
    const after = await tx.one<RideRow>('select * from rides where id = $1', [id]);
    return rideView(after as RideRow, now);
  });
}

/** Marks touch Postgres only, so the day runs through a ledger outage. */
export async function markRide(
  hub: HubId,
  id: string,
  outcome: 'ridden' | 'no_show',
): Promise<Ride> {
  const now = appNow();
  return transact(async (tx: Tx) => {
    const row = await tx.one<RideRow>(
      'select * from rides where id = $1 and hub = $2 for update',
      [id, hub],
    );
    if (!row) fail('not_found');
    if (row.state !== 'booked') fail('illegal_state');
    if (now.getTime() < row.starts_at.getTime()) fail('too_early');
    const changed = await tx.query(
      `update rides set state = $2, marked_at = $3 where id = $1 and state = 'booked' returning id`,
      [id, outcome, now],
    );
    if (changed.length === 0) fail('illegal_state');
    await cancelRideNotices(tx, id);
    await bumpSeq(hub, tx);
    await bumpRiderRev(row.rider_id, tx);
    const after = await tx.one<RideRow>('select * from rides where id = $1', [id]);
    return rideView(after as RideRow, now);
  });
}
