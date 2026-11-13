import {
  FINISHES,
  MODELS,
  isFinishId,
  isModelId,
  type FinishId,
  type HubId,
  type ModelId,
} from '../../shared/catalogue.js';
import type { Caller } from '../auth.js';
import { addIstDays, appNow, iso, isCalendarDate, istDate, labelDay } from '../clock.js';
import { transact } from '../db.js';
import { fail } from '../errors.js';
import type { Reply, RequestContext } from '../http.js';
import { writeOnHand } from '../ledger.js';
import {
  bumpSeq,
  hubStatus,
  startStockCount,
  stockRows,
} from '../domain/hubstate.js';
import {
  confirmLock,
  lockForHub,
  markDelivered,
  refuseLock,
  withdrawLock,
} from '../domain/locks.js';
import { markRide, rideForHub } from '../domain/rides.js';
import { daySheetRows, heldUnitRows } from '../domain/views.js';

function hubOf(caller: Caller): HubId {
  const hub = caller.user.hub;
  if (!hub) fail('forbidden');
  return hub;
}

export async function daySheet(ctx: RequestContext, caller: Caller): Promise<Reply> {
  const hub = hubOf(caller);
  const now = appNow();
  const raw = ctx.queryOf('date');
  if (raw !== null && !isCalendarDate(raw)) fail('invalid_body');
  const date = raw ?? istDate(now);
  const today = istDate(now);
  const dates: { date: string; dayLabel: string }[] = [];
  for (let offset = -7; offset <= 30; offset += 1) {
    const value = addIstDays(today, offset);
    dates.push({ date: value, dayLabel: labelDay(value, now) });
  }
  return {
    status: 200,
    json: {
      hub,
      date,
      dayLabel: labelDay(date, now),
      dates,
      rows: await daySheetRows(hub, date, now),
    },
  };
}

export async function markRideOutcome(ctx: RequestContext, caller: Caller): Promise<Reply> {
  const hub = hubOf(caller);
  const id = ctx.params.id as string;
  const row = await rideForHub(hub, id);
  if (!row) fail('not_found');
  const body = ctx.body();
  const outcome = body.outcome;
  if (outcome !== 'ridden' && outcome !== 'no_show') {
    if (row.state !== 'booked') fail('illegal_state');
    fail('invalid_body');
  }
  const ride = await markRide(hub, id, outcome);
  return { status: 200, json: { ride } };
}

export async function markDelivery(ctx: RequestContext, caller: Caller): Promise<Reply> {
  const hub = hubOf(caller);
  const id = ctx.params.id as string;
  if (!(await lockForHub(hub, id))) fail('not_found');
  const lock = await markDelivered(hub, id);
  return { status: 200, json: { lock } };
}

export async function heldUnits(_ctx: RequestContext, caller: Caller): Promise<Reply> {
  const hub = hubOf(caller);
  return { status: 200, json: { rows: await heldUnitRows(hub, appNow()) } };
}

export async function confirmUnit(ctx: RequestContext, caller: Caller): Promise<Reply> {
  const hub = hubOf(caller);
  const id = ctx.params.id as string;
  if (!(await lockForHub(hub, id))) fail('not_found');
  return { status: 200, json: { lock: await confirmLock(hub, id) } };
}

export async function refuseUnit(ctx: RequestContext, caller: Caller): Promise<Reply> {
  const hub = hubOf(caller);
  const id = ctx.params.id as string;
  if (!(await lockForHub(hub, id))) fail('not_found');
  return { status: 200, json: { lock: await refuseLock(hub, id) } };
}

export async function withdrawUnit(ctx: RequestContext, caller: Caller): Promise<Reply> {
  const hub = hubOf(caller);
  const id = ctx.params.id as string;
  if (!(await lockForHub(hub, id))) fail('not_found');
  return { status: 200, json: { lock: await withdrawLock(hub, id) } };
}

async function stockReply(hub: HubId): Promise<Reply> {
  const status = await hubStatus(hub);
  return {
    status: 200,
    json: {
      hub,
      counting: status.counting,
      stockAsOf: iso(status.stockAsOf),
      stockAsOfLabel: status.stockAsOfLabel,
      units: await stockRows(hub),
    },
  };
}

export async function readStock(_ctx: RequestContext, caller: Caller): Promise<Reply> {
  return stockReply(hubOf(caller));
}

export async function startCount(_ctx: RequestContext, caller: Caller): Promise<Reply> {
  const hub = hubOf(caller);
  if (!(await startStockCount(hub))) fail('illegal_state');
  return stockReply(hub);
}

export async function finishCount(ctx: RequestContext, caller: Caller): Promise<Reply> {
  const hub = hubOf(caller);
  const status = await hubStatus(hub);
  if (!status.counting) fail('illegal_state');
  const body = ctx.body();
  const units = body.units;
  if (!Array.isArray(units) || units.length !== MODELS.length * FINISHES.length) {
    fail('invalid_body');
  }
  const seen = new Set<string>();
  const counts: { model: ModelId; finish: FinishId; onHand: number }[] = [];
  for (const entry of units) {
    if (entry === null || typeof entry !== 'object') fail('invalid_body');
    const row = entry as Record<string, unknown>;
    if (!isModelId(row.model) || !isFinishId(row.finish)) fail('invalid_body');
    const onHand = row.onHand;
    if (typeof onHand !== 'number' || !Number.isInteger(onHand) || onHand < 0) {
      fail('invalid_body');
    }
    const key = `${row.model}:${row.finish}`;
    if (seen.has(key)) fail('invalid_body');
    seen.add(key);
    counts.push({ model: row.model as ModelId, finish: row.finish as FinishId, onHand });
  }
  const now = appNow();
  await transact(async (tx) => {
    for (const count of counts) {
      await tx.query(
        'update stock set on_hand = $4 where hub = $1 and model = $2 and finish = $3',
        [hub, count.model, count.finish, count.onHand],
      );
      await writeOnHand(hub, count.model, count.finish, count.onHand);
    }
    await tx.query(
      'update hub_state set counting = false, count_started_at = null, stock_as_of = $2 where hub = $1',
      [hub, now],
    );
    await bumpSeq(hub, tx);
  });
  return stockReply(hub);
}
