import { isoBrussels } from "../../shared/time";
import { randomUUID } from "node:crypto";
import { now } from "../clock";
import { isDue } from "../domain/deadlines";
import { apiErrors } from "../http/errors";
import { route, type Route } from "../http/pipeline";
import { acceptRequest, assertFunds, cancelByPassenger, confirmHold, declineRequest, expireHold, expireRequest, withdrawRequest } from "../services/bookings";
import { advanceRide } from "../services/lifecycle";
import { bookingEntries } from "../services/ledger";
import { listMessages, presenceView, storeMessage, takeMessageSlot, MESSAGE_MAX } from "../services/messages";
import { raterIds, ratingConflicts, ratingView, submitRating } from "../services/ratings";
import { bookingView, deadlineOf, loadBooking, loadRide, rideView, type BookingRow, type RideRecord } from "../services/views";
import { holdEnd } from "../domain/deadlines";
import { bodyOf, bookingContext, memberOf, onlySide, participantContext, type BookingContext } from "./support";
import { isInt } from "../http/guards";

export const bookingRoutes: Route[] = [
  route<BookingContext>({
    method: "POST",
    pattern: "/api/bookings/:id/confirm",
    idempotent: true,
    load: (ctx) => bookingContext(ctx, true),
    role: (_ctx, found) => onlySide(found, "passenger"),
    conflicts: async (ctx, { ride, booking }) => {
      if (booking.state !== "held") throw apiErrors.invalidTransition();
      if (isDue(holdEnd(booking.created_at), now())) {
        await expireHold(ctx.db, ride, booking);
        throw apiErrors.holdExpired();
      }
    },
    validate: async (ctx, { booking }) => assertFunds(ctx.db, booking.passenger_id, booking.price_cents),
    run: async (ctx, found) => {
      await confirmHold(ctx.db, found.ride, found.booking);
      return { status: 200, body: await bookingView(ctx.db, found.booking, found.ride, memberOf(ctx).id) };
    },
  }),

  route<BookingContext>({
    method: "POST",
    pattern: "/api/bookings/:id/release",
    load: (ctx) => bookingContext(ctx, true),
    role: (_ctx, found) => onlySide(found, "passenger"),
    conflicts: async (_ctx, { booking }) => {
      if (booking.state !== "held") throw apiErrors.invalidTransition();
    },
    run: async (ctx, found) => {
      await expireHold(ctx.db, found.ride, found.booking);
      return { status: 200, body: await bookingView(ctx.db, found.booking, found.ride, memberOf(ctx).id) };
    },
  }),

  route<BookingContext>({
    method: "POST",
    pattern: "/api/bookings/:id/withdraw",
    load: (ctx) => bookingContext(ctx, true),
    role: (_ctx, found) => onlySide(found, "passenger"),
    conflicts: async (ctx, { ride, booking }) => {
      if (booking.state === "expired") throw apiErrors.requestExpired();
      if (booking.state !== "requested") throw apiErrors.invalidTransition();
      if (isDue(deadlineOf(ride, booking), now())) {
        await expireRequest(ctx.db, ride, booking);
        throw apiErrors.requestExpired(true);
      }
    },
    run: async (ctx, found) => {
      await withdrawRequest(ctx.db, found.ride, found.booking);
      return { status: 200, body: await bookingView(ctx.db, found.booking, found.ride, memberOf(ctx).id) };
    },
  }),

  ...(["accept", "decline"] as const).map((decision) =>
    route<BookingContext>({
      method: "POST",
      pattern: `/api/bookings/:id/${decision}`,
      load: (ctx) => bookingContext(ctx, true),
      role: (_ctx, found) => onlySide(found, "driver"),
      conflicts: async (ctx, { ride, booking }) => {
        if (booking.state === "expired") throw apiErrors.requestExpired();
        if (booking.state === "requested") {
          if (isDue(deadlineOf(ride, booking), now())) {
            await expireRequest(ctx.db, ride, booking);
            throw apiErrors.requestExpired(true);
          }
          return;
        }
        if (["accepted", "confirmed", "declined", "withdrawn"].includes(booking.state)) throw apiErrors.alreadyDecided();
        throw apiErrors.invalidTransition();
      },
      run: async (ctx, found) => {
        if (decision === "accept") await acceptRequest(ctx.db, found.ride, found.booking, memberOf(ctx).display_name);
        else await declineRequest(ctx.db, found.ride, found.booking);
        return { status: 200, body: await bookingView(ctx.db, found.booking, found.ride, memberOf(ctx).id) };
      },
    }),
  ),

  route<BookingContext>({
    method: "POST",
    pattern: "/api/bookings/:id/cancel",
    idempotent: true,
    load: (ctx) => bookingContext(ctx, true),
    role: (_ctx, found) => onlySide(found, "passenger"),
    conflicts: async (_ctx, { booking }) => {
      if (booking.state !== "confirmed") throw apiErrors.invalidTransition();
    },
    run: async (ctx, found) => {
      const { refundCents, keptCents } = await cancelByPassenger(ctx.db, found.ride, found.booking);
      return { status: 200, body: { booking: await bookingView(ctx.db, found.booking, found.ride, memberOf(ctx).id), refund_cents: refundCents, kept_cents: keptCents } };
    },
  }),

  route<BookingContext>({
    method: "GET",
    pattern: "/api/bookings/:id",
    load: (ctx) => bookingContext(ctx, false),
    run: async (ctx, found) => ({ status: 200, body: await bookingView(ctx.db, found.booking, found.ride, memberOf(ctx).id) }),
  }),

  route<BookingContext>({
    method: "GET",
    pattern: "/api/bookings/:id/ledger",
    load: (ctx) => bookingContext(ctx, false),
    run: async (ctx, found) => {
      const entries = await bookingEntries(ctx.db, found.booking.id);
      return { status: 200, body: { entries: entries.map((entry) => ({ id: entry.id, kind: entry.kind, at: isoBrussels(entry.at), lines: entry.lines })) } };
    },
  }),

  route<BookingContext>({
    method: "GET",
    pattern: "/api/bookings/:id/messages",
    load: async (ctx) => threadContext(ctx, false),
    run: async (ctx, found) => {
      const other = memberOf(ctx).id === found.booking.passenger_id ? found.ride.row.driver_id : found.booking.passenger_id;
      return { status: 200, body: { messages: await listMessages(ctx.db, found.booking.id), presence: await presenceView(found.booking.id, other) } };
    },
  }),

  route<BookingContext>({
    method: "POST",
    pattern: "/api/bookings/:id/messages",
    load: (ctx) => threadContext(ctx, false),
    limit: async (ctx) => takeMessageSlot(memberOf(ctx).id),
    validate: async (ctx) => {
      const body = bodyOf(ctx).body;
      const text = typeof body === "string" ? body.trim() : "";
      if (text.length < 1 || text.length > MESSAGE_MAX) throw apiErrors.validation({ body: `Write a message of 1 to ${MESSAGE_MAX} characters.` });
    },
    run: async (ctx, found) => {
      const message = await storeMessage(ctx.db, found.booking.id, memberOf(ctx).id, (bodyOf(ctx).body as string).trim());
      return { status: 201, body: message };
    },
  }),

  route<BookingContext>({
    method: "GET",
    pattern: "/api/bookings/:id/rating",
    transactional: true,
    load: (ctx) => ratingContext(ctx),
    run: async (ctx, found) => ({ status: 200, body: await ratingView(ctx.db, found.ride, found.booking, memberOf(ctx).id) }),
  }),

  route<BookingContext>({
    method: "POST",
    pattern: "/api/bookings/:id/rating",
    load: (ctx) => ratingContext(ctx),
    conflicts: async (ctx, { ride, booking }) => ratingConflicts(ride, booking, await raterIds(ctx.db, booking.id), memberOf(ctx).id),
    validate: async (ctx) => {
      const { stars, comment } = bodyOf(ctx);
      const problems: Record<string, string> = {};
      if (!isInt(stars) || stars < 1 || stars > 5) problems.stars = "Choose from 1 to 5 stars.";
      if (comment !== undefined && (typeof comment !== "string" || comment.length > 280)) problems.comment = "Keep the comment to 280 characters.";
      if (Object.keys(problems).length) throw apiErrors.validation(problems);
    },
    run: async (ctx, found) => {
      const { stars, comment } = bodyOf(ctx) as { stars: number; comment?: string };
      const ratingId = randomUUID();
      await submitRating(ctx.db, found.ride, found.booking, memberOf(ctx).id, stars, comment ?? "", ratingId);
      return { status: 201, body: { id: ratingId, stars, comment: comment ?? "" } };
    },
  }),

  route({
    method: "GET",
    pattern: "/api/me/bookings",
    validate: async (ctx) => {
      const tab = ctx.url.searchParams.get("tab");
      if (tab !== "upcoming" && tab !== "past") throw apiErrors.validation({ tab: "Choose upcoming or past." });
    },
    run: async (ctx) => {
      const member = memberOf(ctx);
      const upcoming = ctx.url.searchParams.get("tab") === "upcoming";
      const mine = await ctx.db.query<{ id: string }>("SELECT id FROM bookings WHERE passenger_id = $1 ORDER BY created_at, id", [member.id]);
      const bookings: Awaited<ReturnType<typeof bookingView>>[] = [];
      for (const { id } of mine.rows) {
        const booking = (await loadBooking(ctx.db, id)) as BookingRow;
        const ride = (await loadRide(ctx.db, booking.ride_id)) as RideRecord;
        const live = ["held", "requested", "accepted", "confirmed"].includes(booking.state) && ride.row.state !== "arrived" && ride.row.state !== "cancelled";
        if (live === upcoming) bookings.push(await bookingView(ctx.db, booking, ride, member.id));
      }
      bookings.sort((a, b) => (a.boarding_time < b.boarding_time ? -1 : 1) * (upcoming ? 1 : -1));
      const driven = await ctx.db.query<{ id: string }>("SELECT id FROM rides WHERE driver_id = $1 ORDER BY departure, id", [member.id]);
      const rides = [];
      for (const { id } of driven.rows) {
        const ride = (await loadRide(ctx.db, id)) as RideRecord;
        const live = ride.row.state !== "arrived" && ride.row.state !== "cancelled";
        if (live === upcoming) rides.push(await rideView(ctx.db, ride));
      }
      if (!upcoming) rides.reverse();
      return { status: 200, body: { bookings, rides } };
    },
  }),
];

/** Threads exist from `requested` onwards and belong to the passenger and the driver only. */
async function threadContext(ctx: Parameters<typeof bookingContext>[0], lock: boolean): Promise<BookingContext> {
  const found = await participantContext(ctx, lock);
  if (found.booking.state === "held") throw apiErrors.notFound();
  return found;
}

/** A rating request first brings the ride's departure and arrival up to date. */
async function ratingContext(ctx: Parameters<typeof bookingContext>[0]): Promise<BookingContext> {
  const peek = await participantContext(ctx, false);
  await advanceRide(ctx.db, peek.ride.row.id);
  return participantContext(ctx, true);
}

