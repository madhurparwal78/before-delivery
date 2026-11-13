import type { FinishId, HubId, ModelId } from '../../shared/catalogue.js';
import type { Lock } from '../../shared/types.js';
import { appNow, isCalendarDate } from '../clock.js';
import { query, transact, type Tx } from '../db.js';
import { fail } from '../errors.js';
import { claimPlace, removePlace, setHoldScore } from '../ledger.js';
import {
  deliveryCapacity,
  deliveryClosingInstant,
  isDeliveryDateClosed,
  isDeliveryDateOffered,
} from './calendar.js';
import { bumpRiderRev, bumpSeq, hubStatus } from './hubstate.js';
import { cancelLockNotices } from './notices.js';
import { ensurePlacesKey } from './rebuild.js';
import { effectiveState, LOCK_SELECT, lockView, placesTaken, type LockRow } from './views.js';

export async function setDeliveryDay(
  riderId: string,
  id: string,
  date: unknown,
): Promise<Lock> {
  const now = appNow();
  let gatedRef: string | null = null;
  let gatedHub: HubId | null = null;
  let gatedDate: string | null = null;
  try {
    return await transact(async (tx) => {
      const row = await tx.one<LockRow>(
        `${LOCK_SELECT} where l.id = $1 and l.rider_id = $2 for update of l`,
        [id, riderId],
      );
      if (!row) fail('not_found');
      const hub = row.hub as HubId;
      const state = effectiveState(row, now);
      if (typeof date === 'string' && isCalendarDate(date) && row.delivery_date === date) {
        return lockView(row, now);
      }
      if (state === 'expired') fail('lock_expired');
      if (state !== 'locked') fail('illegal_state');
      if (!isCalendarDate(date)) fail('invalid_body');
      if (!isDeliveryDateOffered(hub, row.issued_at, date)) fail('delivery_day_closed');
      if (isDeliveryDateClosed(hub, row.issued_at, date, now)) fail('delivery_day_closed');

      const capacity = deliveryCapacity(date);
      const taken = (await placesTaken(hub, [date])).get(date) ?? 0;
      if (taken >= capacity) fail('delivery_day_full');
      const waiting = await tx.one<{ n: number }>(
        `select count(*) as n from locks
          where hub = $1 and waiting_for = $2 and state = 'locked' and id <> $3`,
        [hub, date, id],
      );
      if (Number(waiting?.n ?? 0) > 0 && row.waiting_for !== date) fail('delivery_day_full');

      const status = await hubStatus(hub);
      if (status.stale) fail('hub_unreachable');

      await ensurePlacesKey(hub, date);
      const claim = await claimPlace(hub, date, row.ref, capacity);
      if (claim.outcome === 'full') fail('delivery_day_full');
      gatedRef = row.ref;
      gatedHub = hub;
      gatedDate = date;

      const changed = await tx.query(
        `update locks set state = 'delivery_set', delivery_date = $2, expires_at = null,
            waiting_for = null, waiting_since = null
          where id = $1 and state = 'locked' returning id`,
        [id, date],
      );
      if (changed.length === 0) fail('illegal_state');
      await setHoldScore(hub, row.model as ModelId, row.finish as FinishId, row.ref, 'inf');
      await cancelLockNotices(tx, id);
      await bumpSeq(hub, tx);
      await bumpRiderRev(riderId, tx);
      const after = await tx.one<LockRow>(`${LOCK_SELECT} where l.id = $1`, [id]);
      gatedRef = null;
      return lockView(after as LockRow, now);
    });
  } catch (error) {
    if (gatedRef && gatedHub && gatedDate) {
      await removePlace(gatedHub, gatedDate, gatedRef).catch(() => undefined);
    }
    throw error;
  }
}

/** Joining and leaving a line touch Postgres only, so they work through a ledger outage. */
export async function joinWaitLine(riderId: string, id: string, date: unknown): Promise<{
  status: 200 | 201;
  lock: Lock;
}> {
  const now = appNow();
  return transact(async (tx) => {
    const row = await tx.one<LockRow>(
      `${LOCK_SELECT} where l.id = $1 and l.rider_id = $2 for update of l`,
      [id, riderId],
    );
    if (!row) fail('not_found');
    const hub = row.hub as HubId;
    const state = effectiveState(row, now);
    if (typeof date === 'string' && isCalendarDate(date) && row.waiting_for === date) {
      return { status: 200 as const, lock: lockView(row, now) };
    }
    if (state === 'expired') fail('lock_expired');
    if (state !== 'locked') fail('illegal_state');
    if (!isCalendarDate(date)) fail('invalid_body');
    if (isDeliveryDateClosed(hub, row.issued_at, date, now)) fail('delivery_day_closed');
    const capacity = deliveryCapacity(date);
    const taken = (await placesTaken(hub, [date])).get(date) ?? 0;
    if (taken < capacity) fail('delivery_day_has_places');
    await tx.query('update locks set waiting_for = $2, waiting_since = $3 where id = $1', [
      id,
      date,
      now,
    ]);
    await bumpSeq(hub, tx);
    await bumpRiderRev(riderId, tx);
    const after = await tx.one<LockRow>(`${LOCK_SELECT} where l.id = $1`, [id]);
    return { status: 201 as const, lock: lockView(after as LockRow, now) };
  });
}

export async function leaveWaitLine(riderId: string, id: string): Promise<Lock> {
  const now = appNow();
  return transact(async (tx) => {
    const row = await tx.one<LockRow>(
      `${LOCK_SELECT} where l.id = $1 and l.rider_id = $2 for update of l`,
      [id, riderId],
    );
    if (!row) fail('not_found');
    if (!row.waiting_for) fail('illegal_state');
    await tx.query(
      'update locks set waiting_for = null, waiting_since = null where id = $1',
      [id],
    );
    await bumpSeq(row.hub as HubId, tx);
    await bumpRiderRev(riderId, tx);
    const after = await tx.one<LockRow>(`${LOCK_SELECT} where l.id = $1`, [id]);
    return lockView(after as LockRow, now);
  });
}

/** At a day's closing instant its line ends and the locks stay locked. */
export async function endClosedWaitLines(now: Date): Promise<HubId[]> {
  const rows = await query<{ id: string; hub: string; waiting_for: string; rider_id: string }>(
    `select id, hub, waiting_for, rider_id from locks where waiting_for is not null`,
  );
  const hubs = new Set<HubId>();
  for (const row of rows) {
    if (now.getTime() < deliveryClosingInstant(row.waiting_for).getTime()) continue;
    await transact(async (tx: Tx) => {
      const changed = await tx.query(
        'update locks set waiting_for = null, waiting_since = null where id = $1 and waiting_for = $2 returning id',
        [row.id, row.waiting_for],
      );
      if (changed.length === 0) return;
      await bumpSeq(row.hub as HubId, tx);
      await bumpRiderRev(row.rider_id, tx);
      hubs.add(row.hub as HubId);
    });
  }
  return [...hubs];
}
