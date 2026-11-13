import { config } from '../config.js';
import { now } from '../clock.js';
import { db } from '../db.js';
import { errors } from '../errors.js';
import { isoZoned } from '../domain/time.js';
import { checkLimit, recordAttempt } from '../limits.js';
import { keys } from '../valkey.js';
import { flushRows } from '../outbox.js';
import {
  arrivalTime,
  loadBooking,
  loadRide,
  serialiseBooking,
  serialiseRide,
  type BookingRecord,
  type RideRecord,
} from '../model.js';
import {
  cancelBooking,
  confirmBooking,
  createBooking,
  decideRequest,
  releaseBooking,
  withdrawRequest,
} from '../actions/bookings.js';
import type { Ctx, Reply, Router } from '../http.js';

async function rideVisibleTo(ctx: Ctx, ride: RideRecord): Promise<boolean> {
  if (ride.state === 'published' || ride.state === 'changed') return true;
  const member = ctx.member;
  if (!member) return false;
  if (member.roles.includes('founder') || member.id === ride.driver_id) return true;
  const { rows } = await db.query<{ count: number }>(
    'select count(*)::int as count from bookings where ride_id = $1 and passenger_id = $2',
    [ride.id, member.id],
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

async function book(ctx: Ctx): Promise<Reply> {
  const member = ctx.requireMember();
  const ride = await loadRide(db, ctx.param('id'));
  if (!ride || !(await rideVisibleTo(ctx, ride))) throw errors.notFound();
  if (ride.driver_id === member.id) throw errors.forbidden();

  const replay = await ctx.idempotency('POST /api/rides/:id/bookings');
  if (replay) return replay;

  const at = now();
  const decision = await checkLimit(
    keys.rateRequests(member.id),
    config.limits.requestRatePerHour,
    3_600_000,
    at,
  );
  if (!decision.allowed) {
    throw errors.rateLimitedBookings(
      config.limits.requestRatePerHour,
      decision.retryAfterSeconds,
    );
  }
  await recordAttempt(keys.rateRequests(member.id), at);
  ctx.assertNoIdempotencyConflict();

  const body = ctx.json();
  const booking = await createBooking({
    rideId: ride.id,
    passengerId: member.id,
    boarding: body.boarding,
    alighting: body.alighting,
    seats: body.seats,
    rideVersion: body.ride_version,
    missingIdempotencyKey: ctx.header('idempotency-key') === null,
  });
  const reply: Reply = { status: 201, body: booking };
  await ctx.storeIdempotent(reply.status, reply.body);
  return reply;
}

async function loadOwn(ctx: Ctx): Promise<{ booking: BookingRecord; ride: RideRecord }> {
  const member = ctx.requireMember();
  const booking = await loadBooking(db, ctx.param('id'));
  if (!booking) throw errors.notFound();
  const ride = await loadRide(db, booking.ride_id);
  if (!ride) throw errors.notFound();
  const maySee =
    booking.passenger_id === member.id ||
    ride.driver_id === member.id ||
    member.roles.includes('founder');
  if (!maySee) throw errors.notFound();
  return { booking, ride };
}

async function confirm(ctx: Ctx): Promise<Reply> {
  const member = ctx.requireMember();
  await loadOwn(ctx);
  const replay = await ctx.idempotency('POST /api/bookings/:id/confirm');
  if (replay) return replay;
  ctx.assertNoIdempotencyConflict();
  ctx.requireIdempotencyKey();
  const result = await confirmBooking(ctx.param('id'), member.id);
  await flushRows(result.emailIds);
  const reply: Reply = { status: 200, body: result.booking };
  await ctx.storeIdempotent(reply.status, reply.body);
  return reply;
}

async function release(ctx: Ctx): Promise<Reply> {
  const member = ctx.requireMember();
  await loadOwn(ctx);
  return { status: 200, body: await releaseBooking(ctx.param('id'), member.id) };
}

async function withdraw(ctx: Ctx): Promise<Reply> {
  const member = ctx.requireMember();
  await loadOwn(ctx);
  return { status: 200, body: await withdrawRequest(ctx.param('id'), member.id) };
}

function decide(decision: 'accept' | 'decline') {
  return async (ctx: Ctx): Promise<Reply> => {
    const member = ctx.requireMember();
    await loadOwn(ctx);
    const result = await decideRequest(ctx.param('id'), member.id, decision);
    await flushRows(result.emailIds);
    return { status: 200, body: result.booking };
  };
}

async function cancel(ctx: Ctx): Promise<Reply> {
  const member = ctx.requireMember();
  await loadOwn(ctx);
  const replay = await ctx.idempotency('POST /api/bookings/:id/cancel');
  if (replay) return replay;
  ctx.assertNoIdempotencyConflict();
  ctx.requireIdempotencyKey();
  const result = await cancelBooking(ctx.param('id'), member.id);
  const reply: Reply = { status: 200, body: result };
  await ctx.storeIdempotent(reply.status, reply.body);
  return reply;
}

async function getBooking(ctx: Ctx): Promise<Reply> {
  const member = ctx.requireMember();
  const { booking, ride } = await loadOwn(ctx);
  return { status: 200, body: await serialiseBooking(db, booking, ride, member.id, now()) };
}

async function getLedger(ctx: Ctx): Promise<Reply> {
  const { booking } = await loadOwn(ctx);
  const { rows } = await db.query<{
    id: string;
    kind: string;
    at: Date;
    lines: Array<{ account: string; amount_cents: number }>;
  }>(
    `select e.id, e.kind, e.at,
            json_agg(json_build_object('account', l.account, 'amount_cents', l.amount_cents)
                     order by l.seq) as lines
       from ledger_entries e join ledger_lines l on l.entry_id = e.id
      where e.booking_id = $1
      group by e.id, e.kind, e.at, e.seq
      order by e.seq`,
    [booking.id],
  );
  return {
    status: 200,
    body: {
      entries: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        at: isoZoned(row.at),
        lines: row.lines,
      })),
    },
  };
}

async function myBookings(ctx: Ctx): Promise<Reply> {
  const member = ctx.requireMember();
  const at = now();
  const tab = ctx.query('tab') === 'past' ? 'past' : 'upcoming';

  const { rows: bookingRows } = await db.query<{ id: string }>(
    'select id from bookings where passenger_id = $1 order by created_at desc',
    [member.id],
  );
  const bookings = [];
  for (const row of bookingRows) {
    const booking = await loadBooking(db, row.id);
    if (!booking) continue;
    const ride = await loadRide(db, booking.ride_id);
    if (!ride) continue;
    const ended =
      booking.state === 'expired' ||
      booking.state === 'declined' ||
      booking.state === 'withdrawn' ||
      booking.state === 'cancelled_by_passenger' ||
      booking.state === 'cancelled_by_driver';
    const arrived = at.getTime() >= arrivalTime(ride).getTime() || ride.state === 'arrived';
    const isPast = ended || arrived;
    if ((tab === 'past') !== isPast) continue;
    bookings.push(await serialiseBooking(db, booking, ride, member.id, at));
  }

  const { rows: rideRows } = await db.query<{ id: string }>(
    'select id from rides where driver_id = $1 order by departure desc',
    [member.id],
  );
  const rides = [];
  for (const row of rideRows) {
    const ride = await loadRide(db, row.id);
    if (!ride) continue;
    const isPast =
      ride.state === 'cancelled' ||
      ride.state === 'arrived' ||
      at.getTime() >= arrivalTime(ride).getTime();
    if ((tab === 'past') !== isPast) continue;
    rides.push(await serialiseRide(db, ride, at));
  }

  return { status: 200, body: { bookings, rides } };
}

export function registerBookingRoutes(router: Router): void {
  router.add({
    method: 'POST',
    pattern: '/api/rides/:id/bookings',
    kind: 'json',
    auth: 'member',
    handler: book,
  });
  router.add({
    method: 'POST',
    pattern: '/api/bookings/:id/confirm',
    kind: 'plain',
    auth: 'member',
    handler: confirm,
  });
  router.add({
    method: 'POST',
    pattern: '/api/bookings/:id/release',
    kind: 'plain',
    auth: 'member',
    handler: release,
  });
  router.add({
    method: 'POST',
    pattern: '/api/bookings/:id/withdraw',
    kind: 'plain',
    auth: 'member',
    handler: withdraw,
  });
  router.add({
    method: 'POST',
    pattern: '/api/bookings/:id/accept',
    kind: 'plain',
    auth: 'member',
    handler: decide('accept'),
  });
  router.add({
    method: 'POST',
    pattern: '/api/bookings/:id/decline',
    kind: 'plain',
    auth: 'member',
    handler: decide('decline'),
  });
  router.add({
    method: 'POST',
    pattern: '/api/bookings/:id/cancel',
    kind: 'plain',
    auth: 'member',
    handler: cancel,
  });
  router.add({
    method: 'GET',
    pattern: '/api/me/bookings',
    kind: 'plain',
    auth: 'member',
    handler: myBookings,
  });
  router.add({
    method: 'GET',
    pattern: '/api/bookings/:id',
    kind: 'plain',
    auth: 'member',
    handler: getBooking,
  });
  router.add({
    method: 'GET',
    pattern: '/api/bookings/:id/ledger',
    kind: 'plain',
    auth: 'member',
    handler: getLedger,
  });
}
