import type pg from "pg";
import { audit } from "../audit.js";
import { requireActor } from "../auth.js";
import { all, pool, tx } from "../db.js";
import { ApiError, field, invalid, json, route, type ApiRequest, type JsonObject, type Reply } from "../http.js";
import { idempotent } from "../idempotency.js";
import { purchase, refund } from "../killbill.js";
import { lockRenter, move } from "../ledger.js";
import { overrunCents } from "../../shared/pricing.js";
import { authorizeBooking, bookingTransition, type BookingAction, type BookingStatus } from "../rules.js";
import { bookingInScope, siteById, siteInScope } from "../scope.js";
import { datesTouched, isLocalDate } from "../time.js";
import { BOOKING_VIEW, bookingJson, bookingView, invoiceJson, isPaid, type BookingViewRow } from "../views.js";
import { overrideReason } from "./holds.js";

const STATUSES: BookingStatus[] = ["confirmed", "checked_in", "overrun_billed", "checked_out", "settled", "cancelled_refunded", "cancelled_forfeit", "unpaid_cancelled"];

route("GET", "/api/bookings", async (request) => {
  const actor = await requireActor(request);
  const siteId = request.query.get("site_id");
  const date = request.query.get("date");
  const status = request.query.get("status");
  if (siteId) await siteInScope(pool, actor, siteId);
  const fields: Record<string, string> = {};
  if (date !== null && !isLocalDate(date)) fields.date = "Use a date in the form YYYY-MM-DD.";
  if (status !== null && !STATUSES.includes(status as BookingStatus)) fields.status = "Unknown booking status.";
  if (Object.keys(fields).length > 0) throw invalid(fields);
  const scope = actor.role === "renter" ? ["b.renter_id = $1", actor.renterId] : actor.role === "front_desk" ? ["b.site_id = $1", actor.siteId] : ["s.operator_id = $1", actor.operatorId];
  const rows = await all<BookingViewRow>(pool,
    `${BOOKING_VIEW} WHERE ${scope[0]} AND ($2::text IS NULL OR b.site_id = $2) AND ($3::text IS NULL OR b.status = $3) ORDER BY b.start_at, b.id`,
    [scope[1], siteId, status]);
  const now = new Date();
  return json(200, {
    bookings: rows.filter((row) => !date || datesTouched(row.time_zone, row.start_at, row.end_at).includes(date)).map((row) => bookingJson(row, now)),
  });
});

route("GET", "/api/bookings/:id", async (request) => {
  const actor = await requireActor(request);
  const booking = await bookingInScope(pool, actor, request.params.id ?? "");
  return json(200, { booking: bookingJson(await bookingView(pool, booking.id), new Date()) });
});

route("GET", "/api/bookings/:id/invoice", async (request) => {
  const actor = await requireActor(request);
  const booking = await bookingInScope(pool, actor, request.params.id ?? "");
  return json(200, invoiceJson(await bookingView(pool, booking.id)));
});

route("GET", "/api/bookings/:id/audit", async (request) => {
  const actor = await requireActor(request);
  const booking = await bookingInScope(pool, actor, request.params.id ?? "");
  const events = await all<{ at: Date; actor_name: string; actor_role: string; action: string; from_status: string | null; to_status: string | null; reason: string | null }>(
    pool, "SELECT * FROM audit_events WHERE booking_id = $1 ORDER BY at, id", [booking.id]);
  return json(200, {
    events: events.map((event) => ({
      at: event.at.toISOString(), actor_name: event.actor_name, actor_role: event.actor_role, action: event.action,
      from: event.from_status, to: event.to_status, reason: event.reason,
    })),
  });
});

interface Step {
  client: pg.PoolClient;
  booking: BookingViewRow;
  to: BookingStatus;
  now: Date;
}

/**
 * Runs one booking action: 404 scope, 403 role, then (inside the row lock) the transition table's
 * verdict, then the action's own work. Every action that changes status writes its audit event here.
 */
type Refund = { tier: "full" | "none"; pack_minutes_returned: number; card_refund_cents: number; deposit_refund_cents: number };

interface Outcome { status?: number; reason?: string; refund?: Refund }

async function act(request: ApiRequest, action: BookingAction, keyed: boolean, work: (step: Step) => Promise<Outcome>): Promise<Reply> {
  const actor = await requireActor(request);
  const id = request.params.id ?? "";
  await bookingInScope(pool, actor, id);
  authorizeBooking(action, actor.role);
  const run = (): Promise<Reply> => tx(async (client) => {
    await bookingInScope(client, actor, id, true);
    const booking = await bookingView(client, id);
    const now = new Date();
    const to = bookingTransition(action, { status: booking.status, startAt: booking.start_at, noticeHours: booking.notice_hours, paid: isPaid(booking) }, now);
    const outcome = await work({ client, booking, to, now });
    await audit(client, { bookingId: id, actor, action, from: booking.status, to, at: now, reason: outcome.reason ?? null });
    const body: JsonObject = { booking: bookingJson(await bookingView(client, id), now) };
    if (outcome.refund) body.refund = outcome.refund;
    return json(outcome.status ?? 200, body);
  });
  return keyed ? idempotent(request, actor, run) : run();
}

/** Full refund: time payment and deposit back through Kill Bill, pack minutes released. */
async function refundInFull(step: Step): Promise<Refund> {
  const { client, booking, now } = step;
  const card = booking.time_payment_id ? booking.card_cents : 0;
  const deposit = booking.deposit_payment_id ? booking.deposit_cents : 0;
  if (booking.time_payment_id) await refund(booking.time_payment_id, booking.card_cents);
  if (booking.deposit_payment_id) await refund(booking.deposit_payment_id, booking.deposit_cents);
  await lockRenter(client, booking.renter_id);
  if (booking.pack_minutes > 0) await move(client, { renterId: booking.renter_id, reason: "release", minutes: booking.pack_minutes, at: now, bookingId: booking.id });
  await client.query(
    `UPDATE bookings SET status = $2, cancelled_at = $3, card_refund_cents = $4, deposit_refund_cents = $5, pack_returned_minutes = $6 WHERE id = $1`,
    [booking.id, step.to, now, card, deposit, booking.pack_minutes]);
  return { tier: "full", pack_minutes_returned: booking.pack_minutes, card_refund_cents: card, deposit_refund_cents: deposit };
}

route("POST", "/api/bookings/:id/pay", (request) => act(request, "pay", true, async ({ client, booking }) => {
  const paymentId = await purchase(booking.renter_id, `hs-booking-${booking.id}`, booking.card_cents);
  await client.query("UPDATE bookings SET time_payment_id = $2 WHERE id = $1", [booking.id, paymentId]);
  return {};
}));

route("POST", "/api/bookings/:id/cancel", (request) => act(request, "cancel", true, async (step) => {
  if (step.to === "cancelled_refunded") return { refund: await refundInFull(step) };
  const { client, booking, now } = step;
  await lockRenter(client, booking.renter_id);
  if (booking.pack_minutes > 0) await move(client, { renterId: booking.renter_id, reason: "forfeit", minutes: booking.pack_minutes, at: now, bookingId: booking.id });
  await client.query("UPDATE bookings SET status = 'cancelled_forfeit', cancelled_at = $2 WHERE id = $1", [booking.id, now]);
  return { refund: { tier: "none", pack_minutes_returned: 0, card_refund_cents: 0, deposit_refund_cents: 0 } };
}));

route("POST", "/api/bookings/:id/override", (request) => act(request, "override_cancel", false, async (step) => {
  const reason = overrideReason(request.body, "cancel_refunded");
  return { reason, refund: await refundInFull(step) };
}));

route("POST", "/api/bookings/:id/check-in", (request) => act(request, "check_in", false, async ({ client, booking, now }) => {
  const opens = booking.start_at.getTime() - 30 * 60000;
  if (now.getTime() < opens || now.getTime() >= booking.end_at.getTime()) throw new ApiError(409, "outside_check_in_window");
  await client.query("UPDATE bookings SET status = 'checked_in', checked_in_at = $2 WHERE id = $1", [booking.id, now]);
  return {};
}));

route("POST", "/api/bookings/:id/overrun", (request) => act(request, "overrun", true, async ({ client, booking }) => {
  const minutes = field(request.body, "minutes");
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > 240) throw invalid({ minutes: "Overrun is 1 to 240 whole minutes." });
  const cents = overrunCents(minutes, booking.rate_cents);
  const paymentId = await purchase(booking.renter_id, `hs-overrun-${booking.id}`, cents);
  await client.query("UPDATE bookings SET status = 'overrun_billed', overrun_minutes = $2, overrun_cents = $3, overrun_payment_id = $4 WHERE id = $1",
    [booking.id, minutes, cents, paymentId]);
  return { status: 201 };
}));

route("POST", "/api/bookings/:id/check-out", (request) => act(request, "check_out", false, async ({ client, booking, now }) => {
  await lockRenter(client, booking.renter_id);
  if (booking.pack_minutes > 0) await move(client, { renterId: booking.renter_id, reason: "use", minutes: booking.pack_minutes, at: now, bookingId: booking.id });
  await client.query("UPDATE bookings SET status = 'checked_out', checked_out_at = $2 WHERE id = $1", [booking.id, now]);
  return {};
}));

route("POST", "/api/bookings/:id/cleaning-fee", (request) => act(request, "cleaning_fee", true, async ({ client, booking }) => {
  if (booking.cleaning_fee_cents !== null) throw new ApiError(409, "cleaning_fee_already_charged");
  const site = await siteById(client, booking.site_id);
  const paymentId = await purchase(booking.renter_id, `hs-cleaning-${booking.id}`, site.cleaning_fee_cents);
  await client.query("UPDATE bookings SET cleaning_fee_cents = $2, cleaning_payment_id = $3 WHERE id = $1", [booking.id, site.cleaning_fee_cents, paymentId]);
  return { status: 201 };
}));

route("POST", "/api/bookings/:id/settle", (request) => act(request, "settle", false, async ({ client, booking }) => {
  if (booking.deposit_payment_id) await refund(booking.deposit_payment_id, booking.deposit_cents);
  await client.query("UPDATE bookings SET status = 'settled', deposit_refund_cents = $2 WHERE id = $1",
    [booking.id, booking.deposit_payment_id ? booking.deposit_cents : 0]);
  return {};
}));

