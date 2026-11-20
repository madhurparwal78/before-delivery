import { isOpenRide } from "../domain/rideStates";
import { isoBrussels } from "../../shared/time";
import type { BookingMode, Notice, Ride } from "../../shared/api";
import { isCity, type City } from "../../shared/towns";
import { parseDateKey } from "../../shared/time";
import { now, nowMs } from "../clock";
import { config } from "../config";
import type { TxHandle } from "../db";
import { bookingClosesAt, bookingCutoffMinutes } from "../domain/deadlines";
import { priceInRange, priceRange } from "../domain/pricing";
import { shapeRoute } from "../domain/route";
import { apiErrors } from "../http/errors";
import { route, type Route } from "../http/pipeline";
import { claimSeats, createBooking, spanPriceCents, assertFunds, type SpanRequest } from "../services/bookings";
import { attemptRows, noticesFor, noticesOfRide, type NoticeRow } from "../services/outbox";
import { applyEdit, cancelRide, editProblems, insertRide, type EditPatch } from "../services/rides";
import { searchRides, type SortKey } from "../services/search";
import { bookingView, loadBooking, loadRide, rideView, type BookingRow, type RideRecord } from "../services/views";
import { requestRateKey, takeFromWindow } from "../valkey";
import { newId } from "../db";
import { bodyOf, hasRole, memberOf, requireRole, validCities, visibleRide } from "./support";
import { isInt } from "../http/guards";

const HOUR_MS = 3_600_000;
const SORTS: SortKey[] = ["earliest", "price", "shortest"];

function noticeView(row: NoticeRow): Notice {
  return { passenger_id: row.passenger_id, name: row.name, kind: row.kind, status: row.status, sent_at: row.sent_at ? isoBrussels(row.sent_at) : null };
}

interface PublishInput {
  vehicle: { id: string; owner_id: string; seats: number } | null;
}

/** Field problems of a ride to publish, in the brief's order; the stopover count is judged on its own. */
function publishProblems(body: Record<string, unknown>, vehicleSeats: number | null): Record<string, string> {
  const problems: Record<string, string> = {};
  if (typeof body.vehicle_id !== "string") problems.vehicle_id = "Choose a vehicle.";
  const stops = body.stops;
  if (!Array.isArray(stops) || stops.length < 2 || !validCities(stops) || new Set(stops).size !== stops.length) problems.stops = "Choose two or more different towns.";
  const departure = body.departure;
  if (typeof departure !== "string" || Number.isNaN(Date.parse(departure))) problems.departure = "Choose a date and time.";
  else if (Date.parse(departure) <= nowMs()) problems.departure = "Choose a time later than now.";
  if (!isInt(body.seats) || body.seats < 1 || body.seats > 4 || (vehicleSeats !== null && body.seats > vehicleSeats)) problems.seats = "Seats must be from 1 to 4 and no more than the car has.";
  if (!isInt(body.price_cents)) problems.price_cents = "Set a price per seat.";
  if (body.booking_mode !== "instant" && body.booking_mode !== "request") problems.booking_mode = "Choose how bookings are accepted.";
  return problems;
}

interface SpanInput {
  span?: SpanRequest;
  version?: number;
  problems: Record<string, string>;
}

/** The booking fields that are valid; a conflict check that needs a missing or malformed field is skipped. */
function readSpan(body: Record<string, unknown>, ride: RideRecord): SpanInput {
  const problems: Record<string, string> = {};
  const boardingIndex = ride.route.cities.indexOf(body.boarding as City);
  const alightingIndex = ride.route.cities.indexOf(body.alighting as City);
  if (typeof body.boarding !== "string" || boardingIndex < 0) problems.boarding = "Choose a stop on this ride to board at.";
  if (typeof body.alighting !== "string" || alightingIndex < 0) problems.alighting = "Choose a stop on this ride to get off at.";
  if (!problems.boarding && !problems.alighting && boardingIndex >= alightingIndex) problems.alighting = "Get off after the stop you board at.";
  const seats = body.seats;
  if (!isInt(seats) || seats < 1 || seats > 4) problems.seats = "Seats must be from 1 to 4.";
  const version = isInt(body.ride_version) ? body.ride_version : undefined;
  if (version === undefined) problems.ride_version = "Reload the ride before booking.";
  const span = Object.keys(problems).filter((field) => field !== "ride_version").length === 0 ? { boardingIndex, alightingIndex, seats: seats as number } : undefined;
  return { span, version, problems };
}

/** After commit: try the save's email rows once (up to 2 seconds) and report each row's status. */
async function respondWithNotices(db: TxHandle, rideId: string, outboxIds: string[]): Promise<{ ride: Ride; notices: Notice[] }> {
  await attemptRows(outboxIds, 2000);
  return { ride: await rideView(db, (await loadRide(db, rideId)) as RideRecord), notices: (await noticesFor(db, outboxIds)).map(noticeView) };
}

export const rideRoutes: Route[] = [
  route<PublishInput>({
    method: "POST",
    pattern: "/api/rides",
    load: async (ctx) => {
      const id = bodyOf(ctx).vehicle_id;
      if (typeof id !== "string") return { vehicle: null };
      const { rows } = await ctx.db.query<{ id: string; owner_id: string; seats: number }>("SELECT id, owner_id, seats FROM vehicles WHERE id = $1", [id]);
      const vehicle = rows[0];
      if (!vehicle || vehicle.owner_id !== memberOf(ctx).id) throw apiErrors.notFound();
      return { vehicle };
    },
    role: (ctx) => {
      const member = memberOf(ctx);
      requireRole(member, "driver");
      if (member.id_state !== "verified") throw apiErrors.unverifiedDriver();
    },
    validate: async (ctx, input) => {
      const body = bodyOf(ctx);
      const problems = publishProblems(body, input.vehicle?.seats ?? null);
      if (Object.keys(problems).length) throw apiErrors.validation(problems);
      const stops = body.stops as City[];
      if (stops.length > 2 + config.maxStopovers) throw apiErrors.tooManyStopovers();
      const shape = shapeRoute(stops, now());
      const range = priceRange(shape.routeKm);
      if (!priceInRange(body.price_cents as number, range)) throw apiErrors.priceOutOfRange(range.lowCents, range.highCents, shape.routeKm);
    },
    run: async (ctx, input) => {
      const body = bodyOf(ctx);
      const ride = await insertRide(ctx.db, {
        driverId: memberOf(ctx).id,
        vehicleId: (input.vehicle as { id: string }).id,
        cities: body.stops as City[],
        departure: new Date(Date.parse(body.departure as string)),
        seats: body.seats as number,
        priceCents: body.price_cents as number,
        bookingMode: body.booking_mode as BookingMode,
      });
      return { status: 201, body: await rideView(ctx.db, ride) };
    },
  }),

  route({
    method: "GET",
    pattern: "/api/rides/search",
    auth: "public",
    validate: async (ctx) => {
      const q = ctx.url.searchParams;
      const problems: Record<string, string> = {};
      if (!isCity(q.get("from"))) problems.from = "Choose where you leave from.";
      if (!isCity(q.get("to"))) problems.to = "Choose where you are going.";
      if (!parseDateKey(q.get("date") ?? "")) problems.date = "Choose a date.";
      const seats = Number(q.get("seats"));
      if (!Number.isInteger(seats) || seats < 1 || seats > 4) problems.seats = "Seats must be from 1 to 4.";
      const sort = q.get("sort");
      if (sort !== null && !SORTS.includes(sort as SortKey)) problems.sort = "Choose a sort order.";
      if (Object.keys(problems).length) throw apiErrors.validation(problems);
    },
    run: async (ctx) => {
      const q = ctx.url.searchParams;
      const rides = await searchRides(ctx.db, {
        from: q.get("from") as City,
        to: q.get("to") as City,
        date: q.get("date") as string,
        seats: Number(q.get("seats")),
        instantOnly: q.get("instant") === "1",
        verifiedOnly: q.get("verified") === "1",
        sort: (q.get("sort") as SortKey | null) ?? "earliest",
      });
      return { status: 200, body: { rides, server_now: isoBrussels(now()) } };
    },
  }),

  route<RideRecord>({
    method: "GET",
    pattern: "/api/rides/:id",
    auth: "public",
    load: (ctx) => visibleRide(ctx),
    run: async (ctx, ride) => ({ status: 200, body: await rideView(ctx.db, ride) }),
  }),

  route<RideRecord>({
    method: "PATCH",
    pattern: "/api/rides/:id",
    load: (ctx) => visibleRide(ctx, true),
    role: (ctx, ride) => {
      if (memberOf(ctx).id !== ride.row.driver_id) throw apiErrors.forbidden();
    },
    conflicts: async (ctx, ride) => {
      const header = ctx.req.headers["if-match"];
      const supplied = typeof header === "string" && /^"?\d+"?$/.test(header.trim()) ? Number(header.trim().replace(/"/g, "")) : undefined;
      if (supplied !== undefined && supplied !== ride.row.version) throw apiErrors.editConflict();
      if (!isOpenRide(ride.row.state)) throw apiErrors.invalidTransition();
    },
    validate: async (ctx, ride) => {
      const body = bodyOf(ctx);
      const problems: Record<string, string> = {};
      const header = ctx.req.headers["if-match"];
      if (typeof header !== "string" || !/^"?\d+"?$/.test(header.trim())) problems.if_match = "Send the ride version in If-Match.";
      const patch = readPatch(body, problems);
      if (patch.departure === undefined && patch.seats === undefined && !problems.departure && !problems.seats) problems.body = "Send a new departure or new seats.";
      if (Object.keys(problems).length) throw apiErrors.validation(problems);
      const { rows } = await ctx.db.query<{ seats: number }>("SELECT seats FROM vehicles WHERE id = $1", [ride.row.vehicle_id]);
      const edits = await editProblems(ctx.db, ride, rows[0]?.seats ?? 4, patch);
      if (Object.keys(edits).length) throw apiErrors.validation(edits);
    },
    run: async (ctx, ride) => {
      const patch = readPatch(bodyOf(ctx), {});
      const { outboxIds } = await applyEdit(ctx.db, ride, memberOf(ctx), patch);
      const db = ctx.db;
      return { status: 200, finalize: () => respondWithNotices(db, ride.row.id, outboxIds) };
    },
  }),

  route<RideRecord>({
    method: "POST",
    pattern: "/api/rides/:id/cancel",
    idempotent: true,
    load: (ctx) => visibleRide(ctx, true),
    role: (ctx, ride) => {
      if (memberOf(ctx).id !== ride.row.driver_id) throw apiErrors.forbidden();
    },
    conflicts: async (_ctx, ride) => {
      if (!isOpenRide(ride.row.state)) throw apiErrors.invalidTransition();
    },
    run: async (ctx, ride) => {
      const { outboxIds } = await cancelRide(ctx.db, ride, memberOf(ctx));
      const db = ctx.db;
      return { status: 200, finalize: () => respondWithNotices(db, ride.row.id, outboxIds) };
    },
  }),

  route<RideRecord>({
    method: "GET",
    pattern: "/api/rides/:id/bookings",
    load: (ctx) => visibleRide(ctx),
    role: (ctx, ride) => {
      if (memberOf(ctx).id !== ride.row.driver_id) throw apiErrors.forbidden();
    },
    run: async (ctx, ride) => {
      const { rows } = await ctx.db.query<{ id: string }>("SELECT id FROM bookings WHERE ride_id = $1 ORDER BY created_at, id", [ride.row.id]);
      const bookings = [];
      for (const row of rows) bookings.push(await bookingView(ctx.db, (await loadBooking(ctx.db, row.id)) as BookingRow, ride, memberOf(ctx).id));
      return { status: 200, body: { bookings } };
    },
  }),

  route<RideRecord>({
    method: "GET",
    pattern: "/api/rides/:id/notices",
    load: (ctx) => visibleRide(ctx),
    role: (ctx, ride) => {
      if (memberOf(ctx).id !== ride.row.driver_id) throw apiErrors.forbidden();
    },
    run: async (ctx, ride) => ({ status: 200, body: { notices: (await noticesOfRide(ctx.db, ride.row.id)).map(noticeView) } }),
  }),

  route<RideRecord>({
    method: "POST",
    pattern: "/api/rides/:id/bookings",
    idempotent: true,
    load: (ctx) => visibleRide(ctx, true),
    role: (ctx, ride) => {
      const member = memberOf(ctx);
      if (!hasRole(member, "passenger") || member.id === ride.row.driver_id) throw apiErrors.forbidden();
    },
    limit: async (ctx) => {
      const verdict = await takeFromWindow(requestRateKey(memberOf(ctx).id), nowMs(), HOUR_MS, config.requestRatePerHour, newId());
      if (!verdict.allowed) throw apiErrors.bookingRateLimited(verdict.retryAfterSeconds);
    },
    conflicts: async (ctx, ride) => {
      const { span, version } = readSpan(bodyOf(ctx), ride);
      if (version !== undefined && version !== ride.row.version) throw apiErrors.rideChanged(await rideView(ctx.db, ride));
      const bookable = isOpenRide(ride.row.state);
      const boardingTime = span ? (ride.route.times[span.boardingIndex] as Date) : ride.row.departure;
      if (!bookable || now().getTime() >= bookingClosesAt(ride.row.booking_mode, boardingTime).getTime()) {
        throw apiErrors.bookingClosed(bookingCutoffMinutes(ride.row.booking_mode));
      }
      if (span) await claimSeats(ctx.db, ride, span);
    },
    validate: async (ctx, ride) => {
      const { span, problems } = readSpan(bodyOf(ctx), ride);
      if (Object.keys(problems).length) throw apiErrors.validation(problems);
      await assertFunds(ctx.db, memberOf(ctx).id, spanPriceCents(ride, span as SpanRequest));
    },
    run: async (ctx, ride) => {
      const { span } = readSpan(bodyOf(ctx), ride);
      const booking = await createBooking(ctx.db, ride, memberOf(ctx), span as SpanRequest);
      return { status: 201, body: await bookingView(ctx.db, booking, ride, memberOf(ctx).id) };
    },
  }),
];

function readPatch(body: Record<string, unknown>, problems: Record<string, string>): EditPatch {
  const patch: EditPatch = {};
  if (body.departure !== undefined) {
    if (typeof body.departure === "string" && !Number.isNaN(Date.parse(body.departure))) patch.departure = new Date(Date.parse(body.departure));
    else problems.departure = "Choose a date and time.";
  }
  if (body.seats !== undefined) {
    if (isInt(body.seats) && body.seats >= 1 && body.seats <= 4) patch.seats = body.seats;
    else problems.seats = "Seats must be from 1 to 4.";
  }
  return patch;
}

