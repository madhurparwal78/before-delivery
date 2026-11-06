import { errors } from '../http/errors.js';
import type { RequestContext } from '../http/context.js';
import { route } from '../http/router.js';
import { confirmHold, liveHold, placeHold, releaseHold, requireHold } from '../services/holds.js';
import { toKitchenIso } from '../domain/time.js';
import type { BookingRecord, HoldRecord } from '../domain/types.js';
import { bookingContext, bookingJson } from './serialize.js';
import { integerField, optionalString, stringField } from './params.js';

async function holdJson(
  ctx: RequestContext,
  hold: HoldRecord,
  bookings: BookingRecord[],
): Promise<Record<string, unknown>> {
  const context = await bookingContext();
  return {
    ref: hold.ref,
    tenant_id: hold.tenantId,
    station_id: hold.stationId,
    weeks: hold.weeks,
    expires_at: toKitchenIso(hold.expiresAt),
    bookings: bookings.map((booking) => bookingJson(booking, context, ctx.actor)),
  };
}

function resolveTenantId(ctx: RequestContext, body: Record<string, unknown>): string {
  const given = optionalString(body, 'tenant_id');
  const actor = ctx.actor;
  if (actor.role === 'operator') {
    if (given === null) throw errors.validation({ tenant_id: 'Choose a tenant.' });
    return given;
  }
  if (given !== null && given !== actor.tenantId) throw errors.notFound();
  if (given !== null) throw errors.validation({ tenant_id: 'Leave the tenant out.' });
  return actor.tenantId!;
}

route('POST', '/api/holds', { bodyKind: 'json' }, async (ctx) => {
  const body = ctx.jsonBody();
  const tenantId = resolveTenantId(ctx, body);
  const { hold, bookings } = await placeHold(ctx.actor, {
    stationId: stringField(body, 'station_id'),
    date: stringField(body, 'date'),
    startLocal: stringField(body, 'start_local'),
    endLocal: stringField(body, 'end_local'),
    weeks: integerField(body, 'weeks', 1),
    notes: stringField(body, 'notes', ''),
    tenantId,
  });
  return { status: 201, json: await holdJson(ctx, hold, bookings) };
});

route('GET', '/api/holds/:ref', {}, async (ctx) => {
  const { hold, bookings } = await liveHold(ctx.params['ref']!, ctx.scopeTenantId);
  return { status: 200, json: await holdJson(ctx, hold, bookings) };
});

route('DELETE', '/api/holds/:ref', {}, async (ctx) => {
  await releaseHold(ctx.params['ref']!, ctx.scopeTenantId, ctx.actor.id);
  return { status: 204, json: null };
});

route('POST', '/api/holds/:ref/confirm', { bodyKind: 'json' }, async (ctx) => {
  const hold = await requireHold(ctx.params['ref']!, ctx.actor);
  if (ctx.idempotencyKey === null) throw errors.idempotencyKeyRequired();
  const body = ctx.jsonBody();
  const payWith = stringField(body, 'pay_with');
  if (payWith !== 'account' && payWith !== 'hour_pack') {
    throw errors.validation({ pay_with: 'Choose how to pay.' });
  }
  const result = await confirmHold(ctx.actor, hold, payWith);
  const context = await bookingContext();
  return {
    status: 200,
    json: {
      ref: result.ref,
      bookings: result.bookings.map((booking) => bookingJson(booking, context, ctx.actor)),
    },
  };
});
