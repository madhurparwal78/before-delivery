import {
  FINISHES,
  HUBS,
  MODELS,
  type FinishId,
  type HubId,
  type ModelId,
} from '../../shared/catalogue.js';
import { appNow, iso, istDate, istSlotKey } from '../clock.js';
import { query, transact, type Row } from '../db.js';
import {
  DamagedKey,
  deleteKey,
  heartbeat,
  keyType,
  keys,
  scanPrefix,
  setMembers,
  stringValue,
  trimHolds,
  writeHolds,
  writeOnHand,
  writePlaces,
  writeSlot,
  zsetMembers,
} from '../ledger.js';
import { NOTICE_COPY, NoticeFailed, publishNotice } from '../services/ntfy.js';
import {
  clearHubDamage,
  markHubDamaged,
  markStockAsOf,
  setLedgerOk,
} from './hubstate.js';
import { returnEndedHolds } from './locks.js';
import { holdMembersFromPostgres, placeMembersFromPostgres } from './rebuild.js';
import { effectiveState, type LockRow } from './views.js';

export const SWEEP_MS = 10_000;

/** Orphans are removed on the sweep after they are first seen, so a live claim keeps its member. */
const seenOrphans = new Set<string>();

export async function noteLedgerFailure(error: unknown): Promise<void> {
  if (error instanceof DamagedKey) {
    await markHubDamaged(error.hub, SWEEP_MS);
    return;
  }
  await setLedgerOk(false);
}

async function reconcileHolds(hub: HubId, model: ModelId, finish: FinishId): Promise<void> {
  const onHandKey = keys.onHand(hub, model, finish);
  const holdsKey = keys.holds(hub, model, finish);
  const expectedOnHand =
    (
      await query<{ on_hand: number }>(
        'select on_hand from stock where hub = $1 and model = $2 and finish = $3',
        [hub, model, finish],
      )
    )[0]?.on_hand ?? 0;
  const expectedHolds = await holdMembersFromPostgres(hub, model, finish);

  const onHandType = await keyType(onHandKey);
  if (onHandType !== 'string' && onHandType !== 'none') {
    await markHubDamaged(hub, SWEEP_MS);
    await deleteKey(onHandKey);
    await writeOnHand(hub, model, finish, expectedOnHand);
  } else {
    const raw = await stringValue(onHandKey);
    if (raw === null || !Number.isInteger(Number(raw))) {
      if (raw !== null) await markHubDamaged(hub, SWEEP_MS);
      await writeOnHand(hub, model, finish, expectedOnHand);
    } else if (Number(raw) !== expectedOnHand) {
      await writeOnHand(hub, model, finish, expectedOnHand);
    }
  }

  const holdsType = await keyType(holdsKey);
  if (holdsType !== 'zset' && holdsType !== 'none') {
    await markHubDamaged(hub, SWEEP_MS);
    await deleteKey(holdsKey);
    await writeHolds(hub, model, finish, expectedHolds);
    return;
  }
  const actual = await zsetMembers(holdsKey);
  const expectedRefs = new Set(expectedHolds.map((hold) => hold.ref));
  const orphans = actual.filter((ref) => !expectedRefs.has(ref));
  const confirmed: string[] = [];
  for (const ref of orphans) {
    const mark = `${holdsKey}|${ref}`;
    if (seenOrphans.has(mark)) {
      confirmed.push(ref);
      seenOrphans.delete(mark);
    } else {
      seenOrphans.add(mark);
    }
  }
  if (confirmed.length > 0) await trimHolds(hub, model, finish, confirmed);
  const missing = expectedHolds.filter((hold) => !actual.includes(hold.ref));
  if (missing.length > 0) {
    await writeHolds(hub, model, finish, expectedHolds);
  }
}

async function reconcileSlots(allKeys: readonly string[]): Promise<void> {
  const rides = await query<{ id: string; hub: string; starts_at: Date }>(
    `select id, hub, starts_at from rides where state = 'booked'`,
  );
  const expected = new Map<string, string>();
  for (const ride of rides) {
    expected.set(keys.slot(ride.hub as HubId, istSlotKey(ride.starts_at)), ride.id);
  }
  for (const [key, id] of expected) {
    const value = await stringValue(key);
    if (value !== id) await writeSlotFromKey(key, id);
  }
  for (const key of allKeys) {
    if (!key.includes(':slot:') || expected.has(key)) continue;
    if (seenOrphans.has(key)) {
      seenOrphans.delete(key);
      await deleteKey(key);
    } else {
      seenOrphans.add(key);
    }
  }
}

async function writeSlotFromKey(key: string, rideId: string): Promise<void> {
  const parts = key.split(':');
  const hub = parts[2] as HubId;
  const slot = parts.slice(3).join(':');
  await writeSlot(hub, slot, rideId);
}

async function reconcilePlaces(allKeys: readonly string[]): Promise<void> {
  const dates = new Set<string>();
  for (const row of await query<{ hub: string; delivery_date: string }>(
    `select distinct hub, delivery_date from locks where delivery_date is not null`,
  )) {
    dates.add(`${row.hub}|${row.delivery_date}`);
  }
  for (const row of await query<{ hub: string; delivery_date: string }>(
    'select hub, delivery_date from delivery_seed',
  )) {
    dates.add(`${row.hub}|${row.delivery_date}`);
  }
  for (const key of allKeys) {
    if (!key.includes(':places:')) continue;
    const parts = key.split(':');
    const hub = parts[2] as HubId;
    const date = parts[3] as string;
    dates.add(`${hub}|${date}`);
  }
  for (const entry of dates) {
    const [hub, date] = entry.split('|') as [HubId, string];
    const key = keys.places(hub, date);
    const expected = await placeMembersFromPostgres(hub, date);
    const type = await keyType(key);
    if (type !== 'set' && type !== 'none') {
      await markHubDamaged(hub, SWEEP_MS);
      await deleteKey(key);
      await writePlaces(hub, date, expected);
      continue;
    }
    const actual = type === 'none' ? [] : await setMembers(key);
    const same =
      actual.length === expected.length && expected.every((ref) => actual.includes(ref));
    if (!same) await writePlaces(hub, date, expected);
  }
}

export async function runSweep(): Promise<void> {
  const now = appNow();
  try {
    await heartbeat(iso(now));
  } catch {
    await setLedgerOk(false).catch(() => undefined);
    return;
  }
  try {
    const allKeys = await scanPrefix();
    for (const h of HUBS) {
      for (const m of MODELS) {
        for (const f of FINISHES) await reconcileHolds(h.id, m.id, f.id);
      }
    }
    await reconcileSlots(allKeys);
    await reconcilePlaces(allKeys);
    await returnEndedHolds();
    for (const h of HUBS) {
      await clearHubDamage(h.id);
      await markStockAsOf(h.id, now);
    }
    await setLedgerOk(true);
  } catch (error) {
    await noteLedgerFailure(error).catch(() => undefined);
  }
}

interface NoticeRow extends Row {
  id: string;
  rider_id: string;
  kind: 'lock_ending' | 'ride_reminder' | 'delivery_place';
  due_at: Date;
  lock_id: string | null;
  ride_id: string | null;
  reminders_on: boolean;
}

/** One send per lock or ride, from whichever copy gets there first. */
export async function sendDueNotices(): Promise<void> {
  const now = appNow();
  const due = await query<{ id: string }>(
    `select id from notices where state = 'pending' and due_at <= $1 order by due_at asc limit 20`,
    [now],
  );
  for (const entry of due) {
    try {
      await transact(async (tx) => {
        const row = await tx.one<NoticeRow>(
          `select n.id, n.rider_id, n.kind, n.due_at, n.lock_id, n.ride_id, u.reminders_on
             from notices n join users u on u.id = n.rider_id
            where n.id = $1 and n.state = 'pending' for update of n skip locked`,
          [entry.id],
        );
        if (!row) return;
        const payload = await noticePayload(tx, row, now);
        if (!payload || !row.reminders_on) {
          await tx.query(`update notices set state = 'cancelled' where id = $1`, [row.id]);
          return;
        }
        await publishNotice(row.rider_id, payload.title, payload.message);
        await tx.query(`update notices set state = 'sent', sent_at = $2 where id = $1`, [
          row.id,
          now,
        ]);
      });
    } catch (error) {
      if (error instanceof NoticeFailed) continue;
      throw error;
    }
  }
}

async function noticePayload(
  tx: { one<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> },
  row: NoticeRow,
  now: Date,
): Promise<{ title: string; message: string } | null> {
  if (row.kind === 'lock_ending' && row.lock_id) {
    const lock = await tx.one<LockRow>('select * from locks where id = $1', [row.lock_id]);
    if (!lock || effectiveState(lock, now) !== 'locked' || !lock.expires_at) return null;
    return NOTICE_COPY.lockEnding(lock.model as ModelId, lock.hub as HubId, lock.expires_at);
  }
  if (row.kind === 'delivery_place' && row.lock_id) {
    const lock = await tx.one<LockRow>('select * from locks where id = $1', [row.lock_id]);
    if (!lock || !lock.delivery_date) return null;
    const state = effectiveState(lock, now);
    if (state !== 'delivery_set' && state !== 'delivered') return null;
    return NOTICE_COPY.deliveryPlace(
      lock.model as ModelId,
      lock.hub as HubId,
      lock.delivery_date,
    );
  }
  if (row.kind === 'ride_reminder' && row.ride_id) {
    const ride = await tx.one<{
      state: string;
      model: string;
      hub: string;
      starts_at: Date;
    }>('select state, model, hub, starts_at from rides where id = $1', [row.ride_id]);
    if (!ride || ride.state !== 'booked') return null;
    if (istDate(ride.starts_at) < istDate(now)) return null;
    return NOTICE_COPY.rideReminder(
      ride.model as ModelId,
      ride.hub as HubId,
      ride.starts_at,
    );
  }
  return null;
}
