import { segmentPriceCents } from '../../shared/pricing.js';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { advanceClock, now } from '../clock.js';
import { withTransaction } from '../db.js';
import { errors } from '../errors.js';
import { isCity, type City } from '../../shared/cities.js';
import { routeKm, routeStops } from '../domain/route.js';

import {
  holdDeadline,
  ratingWindowClose,
  requestDeadline,
  type BookingState,
  type HistoryState,
} from '../domain/booking-rules.js';
import { assignSeats, buildSeatMap, type SeatClaim } from '../../shared/seats.js';
import { isoZoned } from '../domain/time.js';
import { dateLabel } from '../../shared/zoned.js';
import * as ledger from '../domain/ledger.js';
import { smallPng } from '../png.js';
import { putObject } from '../storage.js';
import { arrivalTime, boardingTimeOf, loadRide, type RideRecord } from '../model.js';
import { insertRide } from '../actions/rides.js';
import { publishClock } from '../live.js';
import { runDueJobs } from '../jobs.js';
import { createSession } from './auth.js';
import type { Ctx, JsonValue, Reply, Router } from '../http.js';

function tokenOk(ctx: Ctx): boolean {
  return (
    config.gradingToken !== null && ctx.header('x-grading-token') === config.gradingToken
  );
}

interface Problems {
  fields: Record<string, string>;
}

function fail(fields: Record<string, string>): never {
  throw errors.validationFailed(fields);
}

function asArray(value: JsonValue | undefined): Array<Record<string, JsonValue>> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail({ body: 'Each section must be a list.' });
  return value as Array<Record<string, JsonValue>>;
}

function text(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function integer(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
}

const ID_STATES = ['none', 'pending', 'verified', 'rejected'];
const RIDE_STATES = ['published', 'changed', 'departed', 'arrived', 'cancelled'];
const SETUP_BOOKING_STATES: BookingState[] = [
  'held',
  'requested',
  'confirmed',
  'completed',
  'cancelled_by_passenger',
  'cancelled_by_driver',
];

async function setup(ctx: Ctx): Promise<Reply> {
  if (!tokenOk(ctx)) throw errors.notFound();
  const body = ctx.json();
  const problems: Problems = { fields: {} };
  const at = now();

  const memberInputs = asArray(body.members);
  const vehicleInputs = asArray(body.vehicles);
  const rideInputs = asArray(body.rides);
  const bookingInputs = asArray(body.bookings);
  const messageInputs = asArray(body.messages);
  const ratingInputs = asArray(body.ratings);

  const result = await withTransaction(async (tx) => {
    const memberIds = new Map<string, string>();
    const sessions = new Map<string, string>();
    const generatedFiles: Array<{ key: string; bytes: Buffer; contentType: string }> = [];

    for (const input of memberInputs) {
      const key = text(input.key);
      const email = text(input.email).toLowerCase();
      const displayName = text(input.display_name);
      const roles = Array.isArray(input.roles) ? (input.roles as JsonValue[]).map(text) : [];
      const idState = text(input.id_state) || 'none';
      if (!key) problems.fields.members = 'Each member needs a key.';
      if (!email || !displayName) problems.fields.members = 'Each member needs an email and a name.';
      const rolesOk =
        (roles.length === 1 && roles[0] === 'founder') ||
        (roles.length > 0 && roles.every((role) => role === 'driver' || role === 'passenger'));
      if (!rolesOk) problems.fields.members = 'Roles are driver and/or passenger, or founder alone.';
      if (!ID_STATES.includes(idState)) problems.fields.members = 'Unknown ID state.';
      if (Object.keys(problems.fields).length > 0) fail(problems.fields);

      const { rows } = await tx.query<{ id: string }>(
        'select id from members where email = $1',
        [email],
      );
      if (rows[0]) fail({ members: 'Emails must be new.' });

      const id = randomUUID();
      await tx.query(
        `insert into members (id, display_name, email, roles, id_state, created_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, displayName, email, roles, idState, at],
      );
      if (input.photo === true) {
        const photoFileId = randomUUID();
        const objectKey = `photos/${id}/${photoFileId}`;
        const bytes = smallPng(24, 24, 7);
        generatedFiles.push({ key: objectKey, bytes, contentType: 'image/png' });
        await tx.query(
          `insert into files (id, member_id, kind, object_key, content_type, size_bytes, created_at)
           values ($1, $2, 'photo', $3, 'image/png', $4, $5)`,
          [photoFileId, id, objectKey, bytes.byteLength, at],
        );
        await tx.query('update members set photo_file_id = $2 where id = $1', [id, photoFileId]);
      }
      if (idState === 'pending' || idState === 'rejected') {
        const fileId = randomUUID();
        const objectKey = `id-documents/${id}/${fileId}`;
        const bytes = smallPng(32, 20, 11);
        generatedFiles.push({ key: objectKey, bytes, contentType: 'image/png' });
        await tx.query(
          `insert into files (id, member_id, kind, object_key, content_type, size_bytes, created_at)
           values ($1, $2, 'id_document', $3, 'image/png', $4, $5)`,
          [fileId, id, objectKey, bytes.byteLength, at],
        );
        await tx.query(
          `insert into id_documents (id, member_id, file_id, uploaded_at, state, reason)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            randomUUID(),
            id,
            fileId,
            at,
            idState === 'pending' ? 'pending' : 'rejected',
            idState === 'rejected' ? 'The photograph was unreadable' : null,
          ],
        );
      }
      const walletCents = integer(input.wallet_cents, 0);
      if (walletCents > 0) await ledger.topUp(tx, at, id, walletCents);
      memberIds.set(key, id);
      sessions.set(key, await createSession(id, tx));
    }

    const vehicleIds = new Map<string, string>();
    for (const input of vehicleInputs) {
      const key = text(input.key);
      const ownerId = memberIds.get(text(input.owner));
      const seats = integer(input.seats, 0);
      if (!key || !ownerId || seats < 1 || seats > 4) {
        fail({ vehicles: 'Each car needs a key, a known owner and 1 to 4 seats.' });
      }
      const id = randomUUID();
      await tx.query(
        `insert into vehicles (id, owner_id, make_model, colour, seats, created_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, ownerId, text(input.make_model), text(input.colour), seats, at],
      );
      vehicleIds.set(key, id);
    }

    const rideIds = new Map<string, string>();
    for (const input of rideInputs) {
      const key = text(input.key);
      const driverId = memberIds.get(text(input.driver));
      const vehicleId = vehicleIds.get(text(input.vehicle));
      const stops = Array.isArray(input.stops) ? (input.stops as JsonValue[]).map(text) : [];
      const cities = stops.filter(isCity) as City[];
      const departure = new Date(text(input.departure));
      const seats = integer(input.seats, 0);
      const mode = text(input.booking_mode);
      const state = text(input.state) || 'published';
      if (
        !key ||
        !driverId ||
        !vehicleId ||
        cities.length !== stops.length ||
        cities.length < 2 ||
        new Set(cities).size !== cities.length ||
        Number.isNaN(departure.getTime()) ||
        seats < 1 ||
        seats > 4 ||
        (mode !== 'instant' && mode !== 'request') ||
        !RIDE_STATES.includes(state)
      ) {
        fail({ rides: 'Each ride needs a key, driver, car, towns, departure, seats and mode.' });
      }
      const km = routeKm(cities);
      const id = await insertRide(
        tx,
        {
          driverId: driverId as string,
          vehicleId: vehicleId as string,
          cities,
          departure,
          seats,
          priceCents: integer(input.price_cents, 0),
          bookingMode: mode as 'instant' | 'request',
          state: state as RideRecord['state'],
        },
        km,
        routeStops(cities),
      );
      rideIds.set(key, id);
    }

    const bookingIds = new Map<string, string>();
    const claims = new Map<string, SeatClaim[]>();
    for (const input of bookingInputs) {
      const key = text(input.key);
      const rideId = rideIds.get(text(input.ride));
      const passengerId = memberIds.get(text(input.passenger));
      const ride = rideId ? await loadRide(tx, rideId) : null;
      const state = text(input.state) as BookingState;
      if (!key || !ride || !passengerId || !SETUP_BOOKING_STATES.includes(state)) {
        fail({ bookings: 'Each booking needs a key, a known ride, a passenger and a state.' });
      }
      const live = ride as RideRecord;
      const boardingIdx = live.stops.findIndex((stop) => stop.city === text(input.boarding));
      const alightingIdx = live.stops.findIndex((stop) => stop.city === text(input.alighting));
      const seats = integer(input.seats, 1);
      if (boardingIdx < 0 || alightingIdx <= boardingIdx || seats < 1 || seats > 4) {
        fail({ bookings: 'Each booking needs a span on its ride.' });
      }
      const createdAt = input.created_at ? new Date(text(input.created_at)) : at;
      if (Number.isNaN(createdAt.getTime())) fail({ bookings: 'Unreadable created_at.' });

      const existing = claims.get(live.id) ?? [];
      const seatMap = buildSeatMap(live.seats, live.stops.length - 1, existing);
      const assigned = assignSeats(seatMap, boardingIdx, alightingIdx, seats);
      if (!assigned) fail({ bookings: 'Bookings must fit the seat rules.' });

      const segKm =
        (live.stops[alightingIdx]?.km ?? 0) - (live.stops[boardingIdx]?.km ?? 0);
      const priceCents = segmentPriceCents(live.price_cents, segKm, live.route_km) * seats;
      const id = randomUUID();
      const holdsSeat =
        state === 'held' || state === 'requested' || state === 'confirmed';
      if (holdsSeat) {
        claims.set(live.id, [
          ...existing,
          { seatNumbers: assigned as number[], boardingIdx, alightingIdx },
        ]);
      }
      const boardingTime = boardingTimeOf(live, boardingIdx);
      await tx.query(
        `insert into bookings (id, ride_id, passenger_id, boarding_idx, alighting_idx, seats,
           seat_numbers, segment_km, price_cents, state, created_at, hold_expires_at,
           request_deadline, rating_closes_at, ended_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          id,
          live.id,
          passengerId,
          boardingIdx,
          alightingIdx,
          seats,
          assigned,
          segKm,
          priceCents,
          state,
          createdAt,
          state === 'held' ? holdDeadline(createdAt) : null,
          state === 'requested' ? requestDeadline(createdAt, boardingTime) : null,
          state === 'completed' ? ratingWindowClose(arrivalTime(live)) : null,
          state === 'cancelled_by_passenger' || state === 'cancelled_by_driver' ? createdAt : null,
        ],
      );

      const history: HistoryState[] = [];
      const confirmedPath: HistoryState[] =
        live.booking_mode === 'instant'
          ? ['held', 'confirmed']
          : ['requested', 'accepted', 'confirmed'];
      if (state === 'held') history.push('held');
      else if (state === 'requested') history.push('requested');
      else history.push(...confirmedPath);
      if (state === 'completed') history.push('completed');
      if (state === 'cancelled_by_passenger') history.push('cancelled_by_passenger');
      if (state === 'cancelled_by_driver') history.push('cancelled_by_driver');
      for (const step of history) {
        await tx.query(
          'insert into booking_history (booking_id, state, at) values ($1, $2, $3)',
          [id, step, createdAt],
        );
      }

      const label =
        live.booking_mode === 'instant' ? 'Seat booked' : 'Seat requested';
      const spanText = `${live.stops[boardingIdx]?.city} to ${live.stops[alightingIdx]?.city}`;
      if (state !== 'held') {
        await ledger.payment(
          tx,
          createdAt,
          id,
          passengerId as string,
          priceCents,
          `${label}: ${spanText}, ${dateLabel(isoZoned(boardingTime))}`,
        );
      }
      if (state === 'completed') {
        await ledger.completion(tx, createdAt, id, live.driver_id, priceCents);
      }
      if (state === 'cancelled_by_passenger') {
        const percent = integer(input.refund_percent, 0);
        if (![0, 50, 100].includes(percent)) {
          fail({ bookings: 'refund_percent is 0, 50 or 100.' });
        }
        const refund = Math.floor((priceCents * percent) / 100);
        await ledger.passengerCancellation(
          tx,
          createdAt,
          id,
          passengerId as string,
          live.driver_id,
          priceCents,
          refund,
          priceCents - refund,
          `Refund ${percent}%: ${spanText}`,
        );
      }
      if (state === 'cancelled_by_driver') {
        await ledger.driverCancellation(
          tx,
          createdAt,
          id,
          passengerId as string,
          live.driver_id,
          priceCents,
          `Refund 100%: ${spanText}`,
        );
      }
      bookingIds.set(key, id);
    }

    for (const input of messageInputs) {
      const bookingId = bookingIds.get(text(input.booking));
      const authorId = memberIds.get(text(input.author));
      if (!bookingId || !authorId) fail({ messages: 'Each message needs a booking and an author.' });
      const sentAt = input.sent_at ? new Date(text(input.sent_at)) : at;
      await tx.query(
        'insert into messages (id, booking_id, author_id, body, sent_at) values ($1, $2, $3, $4, $5)',
        [randomUUID(), bookingId, authorId, text(input.body), sentAt],
      );
    }

    for (const input of ratingInputs) {
      const bookingId = bookingIds.get(text(input.booking));
      const raterId = memberIds.get(text(input.by));
      if (!bookingId || !raterId) fail({ ratings: 'Each rating needs a booking and a member.' });
      const { rows } = await tx.query<{ passenger_id: string; driver_id: string }>(
        `select b.passenger_id, r.driver_id from bookings b join rides r on r.id = b.ride_id
          where b.id = $1`,
        [bookingId],
      );
      const pair = rows[0];
      if (!pair) fail({ ratings: 'Unknown booking.' });
      const subjectId =
        (pair as { passenger_id: string }).passenger_id === raterId
          ? (pair as { driver_id: string }).driver_id
          : (pair as { passenger_id: string }).passenger_id;
      const stars = integer(input.stars, 0);
      if (stars < 1 || stars > 5) fail({ ratings: 'Stars run from 1 to 5.' });
      await tx.query(
        `insert into ratings (id, booking_id, rater_id, subject_id, stars, comment, submitted_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), bookingId, raterId, subjectId, stars, text(input.comment), at],
      );
    }

    return { memberIds, sessions, vehicleIds, rideIds, bookingIds, generatedFiles };
  });

  for (const file of result.generatedFiles) {
    await putObject(file.key, file.bytes, file.contentType).catch(() => undefined);
  }

  const members: Record<string, { id: string; session: string }> = {};
  for (const [key, id] of result.memberIds) {
    members[key] = { id, session: result.sessions.get(key) ?? '' };
  }
  return {
    status: 201,
    body: {
      now: isoZoned(at),
      members,
      vehicles: Object.fromEntries(result.vehicleIds),
      rides: Object.fromEntries(result.rideIds),
      bookings: Object.fromEntries(result.bookingIds),
    },
  };
}

async function clock(ctx: Ctx): Promise<Reply> {
  if (!tokenOk(ctx)) throw errors.notFound();
  const body = ctx.json();
  const seconds = typeof body.advance_seconds === 'number' ? body.advance_seconds : Number.NaN;
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 31_536_000) {
    throw errors.validationFailed({
      advance_seconds: 'Advance by 0 to 31,536,000 whole seconds.',
    });
  }
  const serverNow = await advanceClock(seconds);
  await runDueJobs();
  publishClock(serverNow);
  return { status: 200, body: { now: isoZoned(serverNow) } };
}

export function registerGradingRoutes(router: Router): void {
  router.add({
    method: 'POST',
    pattern: '/api/grading/setup',
    kind: 'json',
    auth: 'none',
    handler: setup,
  });
  router.add({
    method: 'POST',
    pattern: '/api/grading/clock',
    kind: 'json',
    auth: 'none',
    handler: clock,
  });
}
