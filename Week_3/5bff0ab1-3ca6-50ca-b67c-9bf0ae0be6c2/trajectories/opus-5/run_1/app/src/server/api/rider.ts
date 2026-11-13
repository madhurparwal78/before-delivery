import { isFinishId, isHubId, isModelId, type FinishId, type HubId, type ModelId } from '../../shared/catalogue.js';
import { appNow } from '../clock.js';
import type { Caller } from '../auth.js';
import { one, query, transact, type Row } from '../db.js';
import { fail } from '../errors.js';
import type { Reply, RequestContext } from '../http.js';
import {
  leaveWaitLine,
  joinWaitLine,
  setDeliveryDay,
} from '../domain/delivery.js';
import {
  claimLock,
  lockForRider,
  locksOfRider,
  releaseLock,
} from '../domain/locks.js';
import { bumpRiderRev } from '../domain/hubstate.js';
import {
  bookRide,
  cancelRide,
  moveRide,
  rideForRider,
  ridesOfRider,
} from '../domain/rides.js';
import {
  deliveryDaysFor,
  effectiveState,
  lockView,
  noticeView,
  rideView,
  type LockRow,
} from '../domain/views.js';
import { renderPdf, SheetFailed } from '../services/gotenberg.js';
import { NOTICE_COPY, NoticeFailed, publishNotice, topicOf } from '../services/ntfy.js';
import { priceSheetHtml } from '../render/sheet.js';

function riderId(caller: Caller): string {
  return caller.user.id;
}

export async function listLocks(_ctx: RequestContext, caller: Caller): Promise<Reply> {
  const now = appNow();
  const rows = await locksOfRider(riderId(caller));
  return { status: 200, json: { locks: rows.map((row) => lockView(row, now)) } };
}

export async function readLock(ctx: RequestContext, caller: Caller): Promise<Reply> {
  const row = await lockForRider(riderId(caller), ctx.params.id as string);
  if (!row) fail('not_found');
  return { status: 200, json: { lock: lockView(row, appNow()) } };
}

export async function postLock(ctx: RequestContext, caller: Caller): Promise<Reply> {
  const raw = ctx.bodyUnchecked();
  const body: Record<string, unknown> =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const hub = body.hub;
  const model = body.model;
  const finish = body.finish;
  if (!isHubId(hub) || !isModelId(model) || !isFinishId(finish)) fail('invalid_body');
  const result = await claimLock(
    riderId(caller),
    hub as HubId,
    model as ModelId,
    finish as FinishId,
    body.stepEffectiveFrom,
  );
  return { status: result.status, json: { lock: result.lock } };
}

export async function postRelease(ctx: RequestContext, caller: Caller): Promise<Reply> {
  const id = ctx.params.id as string;
  const row = await lockForRider(riderId(caller), id);
  if (!row) fail('not_found');
  const lock = await releaseLock(riderId(caller), id);
  return { status: 200, json: { lock } };
}

export async function postSheet(ctx: RequestContext, caller: Caller): Promise<Reply> {
  const id = ctx.params.id as string;
  const row = await lockForRider(riderId(caller), id);
  if (!row) fail('not_found');
  const now = appNow();
  const state = effectiveState(row, now);
  if (state === 'expired') fail('lock_expired');
  if (state !== 'locked' && state !== 'delivery_set') fail('illegal_state');
  const made = await transact(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`sheet:${id}`]);
    const existing = await tx.one<Row>('select lock_id from lock_sheets where lock_id = $1', [id]);
    if (existing) return false;
    const fresh = await tx.one<LockRow>('select * from locks where id = $1', [id]);
    if (!fresh) fail('not_found');
    const pdf = await renderPdf(priceSheetHtml(fresh, caller.user.name));
    await tx.query('insert into lock_sheets (lock_id, pdf, made_at) values ($1,$2,$3)', [
      id,
      pdf,
      now,
    ]);
    await bumpRiderRev(riderId(caller), tx);
    return true;
  }).catch((error: unknown) => {
    if (error instanceof SheetFailed) fail('sheet_unreachable');
    throw error;
  });
  const after = await lockForRider(riderId(caller), id);
  return { status: made ? 201 : 200, json: { lock: lockView(after as LockRow, now) } };
}

export async function getSheet(ctx: RequestContext, caller: Caller): Promise<Reply> {
  const id = ctx.params.id as string;
  const row = await lockForRider(riderId(caller), id);
  if (!row) fail('not_found');
  const sheet = await one<{ pdf: Buffer }>('select pdf from lock_sheets where lock_id = $1', [id]);
  if (!sheet) fail('not_found');
  return {
    status: 200,
    bytes: sheet.pdf,
    contentType: 'application/pdf',
    headers: {
      'Content-Disposition': `attachment; filename="malhar-price-sheet-${id}.pdf"`,
    },
  };
}

export async function getDeliveryDays(ctx: RequestContext, caller: Caller): Promise<Reply> {
  const row = await lockForRider(riderId(caller), ctx.params.id as string);
  if (!row) fail('not_found');
  return { status: 200, json: { days: await deliveryDaysFor(row, appNow()) } };
}

export async function postDelivery(ctx: RequestContext, caller: Caller): Promise<Reply> {
  const id = ctx.params.id as string;
  const row = await lockForRider(riderId(caller), id);
  if (!row) fail('not_found');
  const raw = ctx.bodyUnchecked();
  const date =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).date
      : undefined;
  const lock = await setDeliveryDay(riderId(caller), id, date);
  return { status: 200, json: { lock } };
}

export async function postWait(ctx: RequestContext, caller: Caller): Promise<Reply> {
  const id = ctx.params.id as string;
  const row = await lockForRider(riderId(caller), id);
  if (!row) fail('not_found');
  const raw = ctx.bodyUnchecked();
  const date =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).date
      : undefined;
  const result = await joinWaitLine(riderId(caller), id, date);
  return { status: result.status, json: { lock: result.lock } };
}

export async function postLeaveLine(ctx: RequestContext, caller: Caller): Promise<Reply> {
  const id = ctx.params.id as string;
  const row = await lockForRider(riderId(caller), id);
  if (!row) fail('not_found');
  const lock = await leaveWaitLine(riderId(caller), id);
  return { status: 200, json: { lock } };
}

export async function listRides(_ctx: RequestContext, caller: Caller): Promise<Reply> {
  const now = appNow();
  const rows = await ridesOfRider(riderId(caller));
  return { status: 200, json: { rides: rows.map((row) => rideView(row, now)) } };
}

export async function readRide(ctx: RequestContext, caller: Caller): Promise<Reply> {
  const row = await rideForRider(riderId(caller), ctx.params.id as string);
  if (!row) fail('not_found');
  return { status: 200, json: { ride: rideView(row, appNow()) } };
}

export async function postRide(ctx: RequestContext, caller: Caller): Promise<Reply> {
  const raw = ctx.bodyUnchecked();
  const body: Record<string, unknown> =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  if (!isHubId(body.hub) || !isModelId(body.model)) fail('invalid_body');
  const result = await bookRide(riderId(caller), body.hub as HubId, body.model as ModelId, {
    startsAt: body.startsAt,
    licenceNumber: body.licenceNumber,
    licenceValidUntil: body.licenceValidUntil,
    hasMcwg: body.hasMcwg,
  });
  return { status: result.status, json: { ride: result.ride } };
}

export async function postRideMove(ctx: RequestContext, caller: Caller): Promise<Reply> {
  const id = ctx.params.id as string;
  const row = await rideForRider(riderId(caller), id);
  if (!row) fail('not_found');
  const raw = ctx.bodyUnchecked();
  const startsAt =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).startsAt
      : undefined;
  const ride = await moveRide(riderId(caller), id, startsAt);
  return { status: 200, json: { ride } };
}

export async function postRideCancel(ctx: RequestContext, caller: Caller): Promise<Reply> {
  const id = ctx.params.id as string;
  const row = await rideForRider(riderId(caller), id);
  if (!row) fail('not_found');
  const ride = await cancelRide(riderId(caller), id);
  return { status: 200, json: { ride } };
}

/** Reminders go on only once ntfy has accepted the confirmation notice. */
export async function postReminders(_ctx: RequestContext, caller: Caller): Promise<Reply> {
  const id = riderId(caller);
  try {
    await transact(async (tx) => {
      await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`reminders:${id}`]);
      const row = await tx.one<{ reminders_on: boolean }>(
        'select reminders_on from users where id = $1',
        [id],
      );
      if (row?.reminders_on) return;
      const copy = NOTICE_COPY.optIn();
      await publishNotice(id, copy.title, copy.message);
      await tx.query('update users set reminders_on = true where id = $1', [id]);
      await bumpRiderRev(id, tx);
    });
  } catch (error) {
    if (error instanceof NoticeFailed) fail('notice_unreachable');
    throw error;
  }
  return { status: 200, json: { remindersOn: true, topic: topicOf(id) } };
}

export async function listNotices(_ctx: RequestContext, caller: Caller): Promise<Reply> {
  const rows = await query<Row>(
    'select * from notices where rider_id = $1 order by due_at asc',
    [riderId(caller)],
  );
  return { status: 200, json: { notices: rows.map(noticeView) } };
}

export async function readNotice(ctx: RequestContext, caller: Caller): Promise<Reply> {
  const row = await one<Row>('select * from notices where id = $1 and rider_id = $2', [
    ctx.params.id as string,
    riderId(caller),
  ]);
  if (!row) fail('not_found');
  return { status: 200, json: { notice: noticeView(row) } };
}
