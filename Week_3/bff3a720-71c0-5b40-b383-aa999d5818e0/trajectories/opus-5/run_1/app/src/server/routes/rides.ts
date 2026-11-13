import { segmentPriceCents } from '../../shared/pricing.js';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { now } from '../clock.js';
import { db, withTransaction } from '../db.js';
import { errors } from '../errors.js';
import { isCity, type City } from '../../shared/cities.js';
import {priceIsAllowed, priceRange} from '../domain/pricing.js';
import { routeKm, routeStops, stopTime } from '../domain/route.js';
import { bookingClosed } from '../domain/booking-rules.js';
import { isoZoned, parseDateOnly, zonedDate } from '../domain/time.js';
import { buildSeatMap, freeSeatsForSpan } from '../../shared/seats.js';
import {
  activeClaims,
  boardingTimeOf,
  legCountOf,
  loadMember,
  loadRide,
  rideBookings,
  serialiseBooking,
  serialiseMember,
  serialiseRide,
  type RideRecord,
} from '../model.js';
import { cancelRide, insertRide, patchRide, rideNotices } from '../actions/rides.js';
import type { Ctx, Reply, Router } from '../http.js';

function isFounder(roles: readonly string[]): boolean {
  return roles.includes('founder');
}

async function listVehicles(ctx: Ctx): Promise<Reply> {
  const member = ctx.requireMember();
  const { rows } = await db.query(
    'select id, make_model, colour, seats from vehicles where owner_id = $1 order by created_at',
    [member.id],
  );
  return { status: 200, body: { vehicles: rows } };
}

async function createVehicle(ctx: Ctx): Promise<Reply> {
  const member = ctx.requireMember();
  if (!member.roles.includes('driver')) throw errors.forbidden();
  const body = ctx.json();
  const fields: Record<string, string> = {};
  const makeModel = typeof body.make_model === 'string' ? body.make_model.trim() : '';
  const colour = typeof body.colour === 'string' ? body.colour.trim() : '';
  const seats = typeof body.seats === 'number' ? body.seats : Number.NaN;
  if (makeModel.length < 1 || makeModel.length > 60) {
    fields.make_model = 'Write the make and model.';
  }
  if (colour.length < 1 || colour.length > 30) fields.colour = 'Write the colour.';
  if (!Number.isInteger(seats) || seats < 1 || seats > 4) {
    fields.seats = 'Choose 1 to 4 seats.';
  }
  if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

  const id = randomUUID();
  await db.query(
    `insert into vehicles (id, owner_id, make_model, colour, seats, created_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, member.id, makeModel, colour, seats, now()],
  );
  return { status: 201, body: { id, make_model: makeModel, colour, seats } };
}

async function createRide(ctx: Ctx): Promise<Reply> {
  const member = ctx.requireMember();
  if (member.id_state !== 'verified') throw errors.forbiddenUnverifiedDriver();
  if (!member.roles.includes('driver')) throw errors.forbidden();

  const body = ctx.json();
  const fields: Record<string, string> = {};
  const stops = Array.isArray(body.stops) ? body.stops : [];
  const cities = stops.filter(isCity) as City[];
  const stopsSound =
    cities.length === stops.length && cities.length >= 2 && new Set(cities).size === cities.length;
  if (!stopsSound) fields.stops = 'Choose different towns, origin first and destination last.';

  const vehicleId = typeof body.vehicle_id === 'string' ? body.vehicle_id : '';
  const { rows: vehicleRows } = await db.query<{ id: string; seats: number }>(
    'select id, seats from vehicles where id = $1 and owner_id = $2',
    [/^[0-9a-f-]{36}$/i.test(vehicleId) ? vehicleId : randomUUID(), member.id],
  );
  const vehicle = vehicleRows[0];
  if (!vehicle) fields.vehicle_id = 'Choose one of your cars.';

  const departureRaw = typeof body.departure === 'string' ? new Date(body.departure) : null;
  const departure =
    departureRaw && !Number.isNaN(departureRaw.getTime()) ? departureRaw : null;
  if (!departure) fields.departure = 'Choose a date and a departure time.';
  else if (departure.getTime() <= now().getTime()) {
    fields.departure = 'Choose a time later than now.';
  }

  const seats = typeof body.seats === 'number' ? body.seats : Number.NaN;
  if (!Number.isInteger(seats) || seats < 1 || seats > 4) {
    fields.seats = 'Choose 1 to 4 seats.';
  } else if (vehicle && seats > vehicle.seats) {
    fields.seats = 'Seats cannot be more than the car has.';
  }

  const bookingMode: 'instant' | 'request' =
    body.booking_mode === 'request' ? 'request' : 'instant';
  if (body.booking_mode !== 'instant' && body.booking_mode !== 'request') {
    fields.booking_mode = 'Choose instant booking or review each request.';
  }

  const priceCents = typeof body.price_cents === 'number' ? body.price_cents : Number.NaN;
  if (!Number.isInteger(priceCents)) fields.price_cents = 'Set a price per seat.';

  if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);
  if (cities.length > 2 + config.limits.maxStopovers) {
    throw errors.tooManyStopovers(config.limits.maxStopovers);
  }

  const km = routeKm(cities);
  if (!priceIsAllowed(priceCents, km)) {
    const range = priceRange(km);
    throw errors.priceOutOfRange(range.lowCents, range.highCents, km);
  }

  const rideId = await withTransaction(async (tx) =>
    insertRide(
      tx,
      {
        driverId: member.id,
        vehicleId: vehicle?.id ?? '',
        cities,
        departure: departure as Date,
        seats,
        priceCents,
        bookingMode,
      },
      km,
      routeStops(cities),
    ),
  );
  const ride = (await loadRide(db, rideId)) as RideRecord;
  return { status: 201, body: await serialiseRide(db, ride, now()) };
}

interface SearchResult {
  id: string;
  driver: unknown;
  from: City;
  to: City;
  boarding_time: string;
  alighting_time: string;
  segment_km: number;
  segment_price_cents: number;
  seats_left: number;
  booking_mode: string;
  version: number;
  boardingAt: Date;
  alightingAt: Date;
}

async function search(ctx: Ctx): Promise<Reply> {
  const fields: Record<string, string> = {};
  const from = ctx.query('from') ?? '';
  const to = ctx.query('to') ?? '';
  const dateRaw = ctx.query('date') ?? '';
  const seatsRaw = ctx.query('seats') ?? '1';
  if (!isCity(from)) fields.from = 'Choose a town to leave from.';
  if (!isCity(to)) fields.to = 'Choose a town to go to.';
  if (isCity(from) && from === to) fields.to = 'Choose a different town.';
  const date = parseDateOnly(dateRaw);
  if (!date) fields.date = 'Choose a date.';
  const seats = Number.parseInt(seatsRaw, 10);
  if (!Number.isInteger(seats) || seats < 1 || seats > 4) fields.seats = 'Choose 1 to 4 seats.';
  const sort = ctx.query('sort') ?? 'earliest';
  if (!['earliest', 'price', 'shortest'].includes(sort)) fields.sort = 'Choose a sort order.';
  if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

  const instantOnly = ctx.query('instant') === '1';
  const verifiedOnly = ctx.query('verified') === '1';
  const at = now();
  const { rows } = await db.query<{ id: string }>(
    `select id from rides where state in ('published', 'changed') order by created_at`,
  );

  const results: SearchResult[] = [];
  for (const row of rows) {
    const ride = await loadRide(db, row.id);
    if (!ride) continue;
    if (instantOnly && ride.booking_mode !== 'instant') continue;
    const boardingIdx = ride.stops.findIndex((stop) => stop.city === from);
    const alightingIdx = ride.stops.findIndex((stop) => stop.city === to);
    if (boardingIdx < 0 || alightingIdx < 0 || boardingIdx >= alightingIdx) continue;
    const boardingAt = boardingTimeOf(ride, boardingIdx);
    if (zonedDate(boardingAt) !== dateRaw) continue;
    if (bookingClosed(ride.booking_mode, boardingAt, at)) continue;
    const driver = await loadMember(db, ride.driver_id);
    if (!driver) continue;
    if (verifiedOnly && driver.id_state !== 'verified') continue;
    const bookings = await rideBookings(db, ride.id);
    const seatMap = buildSeatMap(ride.seats, legCountOf(ride), activeClaims(bookings, at));
    const seatsLeft = freeSeatsForSpan(seatMap, boardingIdx, alightingIdx).length;
    if (seatsLeft < seats) continue;
    const segKm = (ride.stops[alightingIdx]?.km ?? 0) - (ride.stops[boardingIdx]?.km ?? 0);
    const alightingAt = stopTime(ride.departure, ride.stops[alightingIdx]?.km ?? 0);
    results.push({
      id: ride.id,
      driver: await serialiseMember(db, driver),
      from: from as City,
      to: to as City,
      boarding_time: isoZoned(boardingAt),
      alighting_time: isoZoned(alightingAt),
      segment_km: segKm,
      segment_price_cents: segmentPriceCents(ride.price_cents, segKm, ride.route_km),
      seats_left: seatsLeft,
      booking_mode: ride.booking_mode,
      version: ride.version,
      boardingAt,
      alightingAt,
    });
  }

  results.sort((a, b) => {
    if (sort === 'price' && a.segment_price_cents !== b.segment_price_cents) {
      return a.segment_price_cents - b.segment_price_cents;
    }
    if (sort === 'shortest') {
      const spanA = a.alightingAt.getTime() - a.boardingAt.getTime();
      const spanB = b.alightingAt.getTime() - b.boardingAt.getTime();
      if (spanA !== spanB) return spanA - spanB;
    }
    const timeDiff = a.boardingAt.getTime() - b.boardingAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id.localeCompare(b.id);
  });

  return {
    status: 200,
    body: {
      rides: results.map(({ boardingAt, alightingAt, ...rest }) => {
        void boardingAt;
        void alightingAt;
        return rest;
      }),
      server_now: isoZoned(at),
    },
  };
}

async function canSeeRide(ctx: Ctx, ride: RideRecord): Promise<boolean> {
  if (ride.state === 'published' || ride.state === 'changed') return true;
  const member = ctx.member;
  if (!member) return false;
  if (isFounder(member.roles)) return true;
  if (member.id === ride.driver_id) return true;
  const { rows } = await db.query<{ count: number }>(
    'select count(*)::int as count from bookings where ride_id = $1 and passenger_id = $2',
    [ride.id, member.id],
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

async function getRide(ctx: Ctx): Promise<Reply> {
  const ride = await loadRide(db, ctx.param('id'));
  if (!ride) throw errors.notFound();
  if (!(await canSeeRide(ctx, ride))) throw errors.notFound();
  return { status: 200, body: await serialiseRide(db, ride, now()) };
}

async function patch(ctx: Ctx): Promise<Reply> {
  const member = ctx.requireMember();
  const body = ctx.json();
  const result = await patchRide({
    rideId: ctx.param('id'),
    driverId: member.id,
    ifMatch: ctx.header('if-match'),
    departure: body.departure,
    seats: body.seats,
  });
  return { status: 200, body: { ride: result.ride, notices: result.notices } };
}

async function cancel(ctx: Ctx): Promise<Reply> {
  const member = ctx.requireMember();
  const replay = await ctx.idempotency('POST /api/rides/:id/cancel');
  if (replay) return replay;
  ctx.assertNoIdempotencyConflict();
  ctx.requireIdempotencyKey();
  const result = await cancelRide(ctx.param('id'), member.id);
  const reply: Reply = {
    status: 200,
    body: { ride: result.ride, notices: result.notices },
  };
  await ctx.storeIdempotent(reply.status, reply.body);
  return reply;
}

async function listRideBookings(ctx: Ctx): Promise<Reply> {
  const member = ctx.requireMember();
  const ride = await loadRide(db, ctx.param('id'));
  if (!ride || ride.driver_id !== member.id) throw errors.notFound();
  const bookings = await rideBookings(db, ride.id);
  const shapes = [];
  for (const booking of bookings) {
    shapes.push(await serialiseBooking(db, booking, ride, member.id, now()));
  }
  return { status: 200, body: { bookings: shapes } };
}

async function listNotices(ctx: Ctx): Promise<Reply> {
  const member = ctx.requireMember();
  const ride = await loadRide(db, ctx.param('id'));
  if (!ride || ride.driver_id !== member.id) throw errors.notFound();
  return { status: 200, body: { notices: await rideNotices(ride.id) } };
}

export function registerRideRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/vehicles',
    kind: 'plain',
    auth: 'member',
    handler: listVehicles,
  });
  router.add({
    method: 'POST',
    pattern: '/api/vehicles',
    kind: 'json',
    auth: 'member',
    handler: createVehicle,
  });
  router.add({
    method: 'POST',
    pattern: '/api/rides',
    kind: 'json',
    auth: 'member',
    handler: createRide,
  });
  router.add({
    method: 'GET',
    pattern: '/api/rides/search',
    kind: 'plain',
    auth: 'none',
    handler: search,
  });
  router.add({
    method: 'GET',
    pattern: '/api/rides/:id',
    kind: 'plain',
    auth: 'none',
    handler: getRide,
  });
  router.add({
    method: 'PATCH',
    pattern: '/api/rides/:id',
    kind: 'json',
    auth: 'member',
    handler: patch,
  });
  router.add({
    method: 'POST',
    pattern: '/api/rides/:id/cancel',
    kind: 'plain',
    auth: 'member',
    handler: cancel,
  });
  router.add({
    method: 'GET',
    pattern: '/api/rides/:id/bookings',
    kind: 'plain',
    auth: 'member',
    handler: listRideBookings,
  });
  router.add({
    method: 'GET',
    pattern: '/api/rides/:id/notices',
    kind: 'plain',
    auth: 'member',
    handler: listNotices,
  });
}
