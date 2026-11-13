import type { FinishId, HubId, ModelId } from '../../shared/catalogue.js';
import type { Lock } from '../../shared/types.js';
import { appNow, isCalendarDate, istInstant } from '../clock.js';
import { newId, newRef, query, transact, type Tx } from '../db.js';
import { fail } from '../errors.js';
import { claimHold, removeHold, setHoldScore, swapPlace, writeOnHand } from '../ledger.js';
import { lockExpiry } from './calendar.js';
import { bumpRiderRev, bumpSeq, hubStatus } from './hubstate.js';
import { cancelLockNotices, scheduleDeliveryPlace, scheduleLockEnding } from './notices.js';
import { quoteFor } from './pricing.js';
import { ensureHoldKeys } from './rebuild.js';
import { effectiveState, LOCK_SELECT, lockView, type LockRow } from './views.js';

export interface ClaimResult {
  status: 200 | 201 | 202;
  lock: Lock;
}

async function loadRow(tx: Tx, id: string): Promise<LockRow | null> {
  return tx.one<LockRow>(`${LOCK_SELECT} where l.id = $1`, [id]);
}

export async function lockForRider(riderId: string, id: string): Promise<LockRow | null> {
  const rows = await query<LockRow>(`${LOCK_SELECT} where l.id = $1 and l.rider_id = $2`, [
    id,
    riderId,
  ]);
  return rows[0] ?? null;
}

export async function lockForHub(hub: HubId, id: string): Promise<LockRow | null> {
  const rows = await query<LockRow>(`${LOCK_SELECT} where l.id = $1 and l.hub = $2`, [id, hub]);
  return rows[0] ?? null;
}

export async function locksOfRider(riderId: string): Promise<LockRow[]> {
  return query<LockRow>(`${LOCK_SELECT} where l.rider_id = $1 order by l.issued_at desc`, [riderId]);
}

export async function activeLockOf(
  riderId: string,
  hub: HubId,
  model: ModelId,
): Promise<LockRow | null> {
  const rows = await query<LockRow>(
    `${LOCK_SELECT} where l.rider_id = $1 and l.hub = $2 and l.model = $3
       and l.state in ('requested','locked','delivery_set')`,
    [riderId, hub, model],
  );
  return rows[0] ?? null;
}

async function heldCount(
  tx: Tx,
  hub: HubId,
  model: ModelId,
  finish: FinishId,
): Promise<number> {
  const row = await tx.one<{ n: number }>(
    `select count(*) as n from locks
      where hub = $1 and model = $2 and finish = $3 and hold_active`,
    [hub, model, finish],
  );
  return Number(row?.n ?? 0);
}

async function onHandOf(
  tx: Tx,
  hub: HubId,
  model: ModelId,
  finish: FinishId,
): Promise<number> {
  const row = await tx.one<{ on_hand: number }>(
    'select on_hand from stock where hub = $1 and model = $2 and finish = $3 for update',
    [hub, model, finish],
  );
  return row?.on_hand ?? 0;
}

/**
 * The claim: a replay first, then state refusals in their published order,
 * then the ledger gate, then the Postgres commit that decides the outcome.
 */
export async function claimLock(
  riderId: string,
  hub: HubId,
  model: ModelId,
  finish: FinishId,
  stepEffectiveFrom: unknown,
): Promise<ClaimResult> {
  const now = appNow();
  let gatedRef: string | null = null;
  try {
    return await transact(async (tx) => {
      await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`${riderId}:${model}`]);
      const existing = await tx.one<LockRow>(
        `${LOCK_SELECT} where l.rider_id = $1 and l.model = $2
           and l.state in ('requested','locked','delivery_set')`,
        [riderId, model],
      );
      if (existing && effectiveState(existing, now) !== 'expired') {
        if (existing.hub === hub && existing.finish === finish) {
          const state = effectiveState(existing, now);
          return { status: state === 'requested' ? 202 : 200, lock: lockView(existing, now) };
        }
        fail('lock_exists_other_finish');
      }

      const onHand = await onHandOf(tx, hub, model, finish);
      const held = await heldCount(tx, hub, model, finish);
      if (onHand - held <= 0) fail('none_left');

      const quote = quoteFor(model, hub, now);
      if (isCalendarDate(stepEffectiveFrom)) {
        if (stepEffectiveFrom !== quote.stepEffectiveFrom) fail('price_moved');
      } else {
        fail('invalid_body');
      }

      const status = await hubStatus(hub);
      if (status.stale) fail('hub_unreachable');

      const ref = newRef();
      const expiresAt = lockExpiry(hub, now);
      await ensureHoldKeys(hub, model, finish);
      let claim = await claimHold(hub, model, finish, ref, expiresAt.getTime());
      if (claim.outcome === 'missing') {
        await ensureHoldKeys(hub, model, finish);
        claim = await claimHold(hub, model, finish, ref, expiresAt.getTime());
      }
      if (claim.outcome !== 'held') fail('none_left');
      gatedRef = ref;

      const id = newId();
      const state = onHand - held - 1 === 0 ? 'requested' : 'locked';
      await tx.query(
        `insert into locks (id, ref, rider_id, hub, model, finish, state, issued_at, expires_at,
           hold_active, step_effective_from, ex_factory_paise, gst_percent, gst_paise,
           ex_showroom_paise, road_tax_percent, road_tax_paise, insurance_paise, on_road_paise)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          id,
          ref,
          riderId,
          hub,
          model,
          finish,
          state,
          now,
          expiresAt,
          quote.stepEffectiveFrom,
          quote.exFactoryPaise,
          quote.gstPercent,
          quote.gstPaise,
          quote.exShowroomPaise,
          quote.roadTaxPercent,
          quote.roadTaxPaise,
          quote.insurancePaise,
          quote.onRoadPaise,
        ],
      );
      if (state === 'locked') await scheduleLockEnding(tx, id, riderId, expiresAt);
      await bumpSeq(hub, tx);
      await bumpRiderRev(riderId, tx);
      const row = await loadRow(tx, id);
      gatedRef = null;
      return {
        status: state === 'requested' ? 202 : 201,
        lock: lockView(row as LockRow, now),
      };
    });
  } catch (error) {
    if (gatedRef) await removeHold(hub, model, finish, gatedRef).catch(() => undefined);
    throw error;
  }
}

async function endHold(
  tx: Tx,
  row: LockRow,
  options: { lowerOnHand: boolean },
): Promise<void> {
  const hub = row.hub as HubId;
  const model = row.model as ModelId;
  const finish = row.finish as FinishId;
  if (options.lowerOnHand) {
    const updated = await tx.one<{ on_hand: number }>(
      `update stock set on_hand = greatest(on_hand - 1, 0)
        where hub = $1 and model = $2 and finish = $3 returning on_hand`,
      [hub, model, finish],
    );
    await writeOnHand(hub, model, finish, updated?.on_hand ?? 0);
  }
  await removeHold(hub, model, finish, row.ref);
  await tx.query('update locks set hold_active = false where id = $1', [row.id]);
}

export async function releaseLock(riderId: string, id: string): Promise<Lock> {
  const now = appNow();
  return transact(async (tx) => {
    const row = await tx.one<LockRow>(
      `${LOCK_SELECT} where l.id = $1 and l.rider_id = $2 for update of l`,
      [id, riderId],
    );
    if (!row) fail('not_found');
    const state = effectiveState(row, now);
    if (state === 'expired') fail('lock_expired');
    if (state !== 'locked') fail('illegal_state');
    const changed = await tx.query(
      `update locks set state = 'released', ended_at = $2, waiting_for = null, waiting_since = null
        where id = $1 and state = 'locked' returning id`,
      [id, now],
    );
    if (changed.length === 0) fail('illegal_state');
    await endHold(tx, row, { lowerOnHand: false });
    await cancelLockNotices(tx, id);
    await bumpSeq(row.hub as HubId, tx);
    await bumpRiderRev(riderId, tx);
    const after = await loadRow(tx, id);
    return lockView(after as LockRow, now);
  });
}

export async function confirmLock(hub: HubId, id: string): Promise<Lock> {
  const now = appNow();
  return transact(async (tx) => {
    const row = await tx.one<LockRow>(
      `${LOCK_SELECT} where l.id = $1 and l.hub = $2 for update of l`,
      [id, hub],
    );
    if (!row) fail('not_found');
    const state = effectiveState(row, now);
    if (state === 'expired') fail('lock_expired');
    if (state !== 'requested') fail('illegal_state');
    const changed = await tx.query(
      `update locks set state = 'locked' where id = $1 and state = 'requested' returning id`,
      [id],
    );
    if (changed.length === 0) fail('illegal_state');
    if (row.expires_at) await scheduleLockEnding(tx, id, row.rider_id, row.expires_at);
    await bumpSeq(hub, tx);
    await bumpRiderRev(row.rider_id, tx);
    const after = await loadRow(tx, id);
    return lockView(after as LockRow, now);
  });
}

export async function refuseLock(hub: HubId, id: string): Promise<Lock> {
  const now = appNow();
  return transact(async (tx) => {
    const row = await tx.one<LockRow>(
      `${LOCK_SELECT} where l.id = $1 and l.hub = $2 for update of l`,
      [id, hub],
    );
    if (!row) fail('not_found');
    const state = effectiveState(row, now);
    if (state === 'expired') fail('lock_expired');
    if (state !== 'requested') fail('illegal_state');
    const changed = await tx.query(
      `update locks set state = 'refused', ended_at = $2 where id = $1 and state = 'requested' returning id`,
      [id, now],
    );
    if (changed.length === 0) fail('illegal_state');
    await endHold(tx, row, { lowerOnHand: true });
    await cancelLockNotices(tx, id);
    await bumpSeq(hub, tx);
    await bumpRiderRev(row.rider_id, tx);
    const after = await loadRow(tx, id);
    return lockView(after as LockRow, now);
  });
}

/** One transition does the lot: hold, on-hand, delivery place, line, day sheet and notice. */
export async function withdrawLock(hub: HubId, id: string): Promise<Lock> {
  const now = appNow();
  return transact(async (tx) => {
    const row = await tx.one<LockRow>(
      `${LOCK_SELECT} where l.id = $1 and l.hub = $2 for update of l`,
      [id, hub],
    );
    if (!row) fail('not_found');
    const state = effectiveState(row, now);
    if (state === 'expired') fail('lock_expired');
    if (state !== 'locked' && state !== 'delivery_set') fail('illegal_state');
    const changed = await tx.query(
      `update locks set state = 'withdrawn', ended_at = $2, waiting_for = null, waiting_since = null
        where id = $1 and state = $3 returning id`,
      [id, now, state],
    );
    if (changed.length === 0) fail('illegal_state');
    await endHold(tx, row, { lowerOnHand: true });
    await cancelLockNotices(tx, id);
    if (state === 'delivery_set' && row.delivery_date) {
      await promoteFromLine(tx, hub, row.delivery_date, row.ref, now);
    }
    await bumpSeq(hub, tx);
    await bumpRiderRev(row.rider_id, tx);
    const after = await loadRow(tx, id);
    return lockView(after as LockRow, now);
  });
}

export async function markDelivered(hub: HubId, id: string): Promise<Lock> {
  const now = appNow();
  return transact(async (tx) => {
    const row = await tx.one<LockRow>(
      `${LOCK_SELECT} where l.id = $1 and l.hub = $2 for update of l`,
      [id, hub],
    );
    if (!row) fail('not_found');
    const state = effectiveState(row, now);
    if (state === 'expired') fail('lock_expired');
    if (state !== 'delivery_set' || !row.delivery_date) fail('illegal_state');
    if (now.getTime() < istInstant(row.delivery_date, 0).getTime()) fail('too_early');
    const changed = await tx.query(
      `update locks set state = 'delivered', ended_at = $2 where id = $1 and state = 'delivery_set' returning id`,
      [id, now],
    );
    if (changed.length === 0) fail('illegal_state');
    await endHold(tx, row, { lowerOnHand: true });
    await bumpSeq(hub, tx);
    await bumpRiderRev(row.rider_id, tx);
    const after = await loadRow(tx, id);
    return lockView(after as LockRow, now);
  });
}

/** The freed place passes to the earliest waiter in one ledger step, so it is never open. */
export async function promoteFromLine(
  tx: Tx,
  hub: HubId,
  date: string,
  leavingRef: string,
  now: Date,
): Promise<string | null> {
  const waiter = await tx.one<LockRow>(
    `${LOCK_SELECT} where l.hub = $1 and l.waiting_for = $2 and l.state = 'locked'
      order by l.waiting_since asc limit 1 for update of l`,
    [hub, date],
  );
  const waiterIsLive = waiter !== null && effectiveState(waiter, now) === 'locked';
  const arrivingRef = waiterIsLive ? (waiter as LockRow).ref : null;
  await swapPlace(hub, date, leavingRef, arrivingRef);
  if (!waiterIsLive || !waiter) return null;
  await tx.query(
    `update locks set state = 'delivery_set', delivery_date = $2, expires_at = null,
        waiting_for = null, waiting_since = null
      where id = $1`,
    [waiter.id, date],
  );
  await setHoldScore(hub, waiter.model as ModelId, waiter.finish as FinishId, waiter.ref, 'inf');
  await cancelLockNotices(tx, waiter.id);
  await scheduleDeliveryPlace(tx, waiter.id, waiter.rider_id, now);
  await bumpRiderRev(waiter.rider_id, tx);
  return waiter.rider_id;
}

/** Locks that have reached their expiry end on the app clock, wherever the browser thinks it is. */
export async function expireDueLocks(now: Date): Promise<HubId[]> {
  const due = await query<LockRow>(
    `${LOCK_SELECT} where l.state in ('requested','locked') and l.expires_at <= $1`,
    [now],
  );
  const hubs = new Set<HubId>();
  for (const row of due) {
    await transact(async (tx) => {
      const changed = await tx.query(
        `update locks set state = 'expired', ended_at = $2, waiting_for = null, waiting_since = null
          where id = $1 and state in ('requested','locked') returning id`,
        [row.id, row.expires_at],
      );
      if (changed.length === 0) return;
      await cancelLockNotices(tx, row.id);
      await bumpSeq(row.hub as HubId, tx);
      await bumpRiderRev(row.rider_id, tx);
      hubs.add(row.hub as HubId);
    });
  }
  if (due.length > 0) await returnEndedHolds();
  return [...hubs];
}

/** An ended lock's unit comes back only once the ledger confirms the member has gone. */
export async function returnEndedHolds(): Promise<void> {
  const rows = await query<LockRow>(
    `select * from locks where hold_active
      and state in ('expired','released','refused','withdrawn','delivered')`,
  );
  for (const row of rows) {
    try {
      await removeHold(row.hub as HubId, row.model as ModelId, row.finish as FinishId, row.ref);
    } catch {
      continue;
    }
    await query('update locks set hold_active = false where id = $1', [row.id]);
    await bumpSeq(row.hub as HubId);
  }
}
