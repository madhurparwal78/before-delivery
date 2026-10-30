import { route } from '../http/router.js';
import {
  cancelBooking,
  checkIn,
  checkOut,
  exportCsv,
  markNoShow,
  refundFee,
  requireBooking,
  searchForActor,
  type SearchParams,
} from '../services/bookings.js';
import { bookingContext, bookingJson } from './serialize.js';
import { integerField, queryValue } from './params.js';
import type { RequestContext } from '../http/context.js';
import type { BookingRecord } from '../domain/types.js';

function searchParams(ctx: RequestContext): SearchParams {
  return {
    q: queryValue(ctx.query, 'q'),
    from: queryValue(ctx.query, 'from'),
    to: queryValue(ctx.query, 'to'),
    status: queryValue(ctx.query, 'status'),
    stationId: queryValue(ctx.query, 'station_id'),
  };
}

async function one(ctx: RequestContext, booking: BookingRecord) {
  const context = await bookingContext();
  return { status: 200, json: bookingJson(booking, context, ctx.actor) };
}

route('GET', '/api/bookings', {}, async (ctx) => {
  const bookings = await searchForActor(ctx.actor, searchParams(ctx));
  const context = await bookingContext();
  return {
    status: 200,
    json: { bookings: bookings.map((booking) => bookingJson(booking, context, ctx.actor)) },
  };
});

route('GET', '/api/bookings/export', {}, async (ctx) => {
  const { csv, from, to } = await exportCsv(ctx.actor, searchParams(ctx));
  return {
    status: 200,
    buffer: Buffer.from(csv, 'utf8'),
    contentType: 'text/csv; charset=utf-8',
    headers: {
      'content-disposition': `attachment; filename="bookings-${from}-to-${to}.csv"`,
    },
  };
});

route('GET', '/api/bookings/:id', {}, async (ctx) =>
  one(ctx, await requireBooking(ctx.params['id']!, ctx.actor)),
);

route('POST', '/api/bookings/:id/check-in', { bodyKind: 'json' }, async (ctx) => {
  const booking = await requireBooking(ctx.params['id']!, ctx.actor);
  ctx.jsonBody();
  return one(ctx, await checkIn(ctx.actor, booking));
});

route('POST', '/api/bookings/:id/check-out', { bodyKind: 'json' }, async (ctx) => {
  const booking = await requireBooking(ctx.params['id']!, ctx.actor);
  const body = ctx.jsonBody();
  const minutes = integerField(body, 'holdover_minutes');
  return one(ctx, await checkOut(ctx.actor, booking, minutes));
});

route('POST', '/api/bookings/:id/cancel', { bodyKind: 'json' }, async (ctx) => {
  const booking = await requireBooking(ctx.params['id']!, ctx.actor);
  ctx.requireRole('operator', 'owner');
  ctx.jsonBody();
  return one(ctx, await cancelBooking(ctx.actor, booking));
});

route('POST', '/api/bookings/:id/no-show', { bodyKind: 'json' }, async (ctx) => {
  const booking = await requireBooking(ctx.params['id']!, ctx.actor);
  ctx.requireRole('operator');
  ctx.jsonBody();
  return one(ctx, await markNoShow(ctx.actor, booking));
});

route('POST', '/api/bookings/:id/refund-fee', { bodyKind: 'json' }, async (ctx) => {
  const booking = await requireBooking(ctx.params['id']!, ctx.actor);
  ctx.requireRole('operator');
  ctx.jsonBody();
  return one(ctx, await refundFee(ctx.actor, booking));
});
