// Bookings: search, export, read, and the confirmed-booking transitions (brief: Bookings, Booking states,
// Hold-over, Cancellation charges).
import type { BookingStatus, PayWith } from "../../shared/kitchen";
import { BOOK_AHEAD_DAYS, DIAL_PAST_DAYS, HOLDOVER_MAX_MINUTES } from "../../shared/kitchen";
import { addDays, dollars, hhmm, isKitchenDate } from "../../shared/time";
import { audit, pool, rows, type Db } from "../db";
import { holdoverNotice } from "../emails";
import { ApiError, FieldErrors, tenantNotActive, validation } from "../errors";
import { disposition, route, type Ctx, type Reply } from "../http";
import { accountFor } from "../killbill";
import { recordMovement } from "../ledger";
import { sendEmail } from "../mail";
import { BOOKING_SELECT, bookingView, kitchenToday, loadBooking, tenantRows, tenantStanding, type BookingRow } from "../records";
import { cancellationCharge } from "../../shared/charges";
import { assertFeeRefundable, billedHoldoverMinutes, bookingTransition, checkInWindowOpen, stationTimeCents } from "../rules";
import { unitOfWork, type Effects } from "../unitOfWork";

const SEARCH_CAP = 200;
const SEARCHABLE_STATUSES: readonly BookingStatus[] = ["confirmed", "checked_in", "completed", "cancelled", "no_show"];

interface Search {
  from: string;
  to: string;
  rows: BookingRow[];
}

async function searchBookings(ctx: Ctx<undefined>, cap: number | null): Promise<Search> {
  const today = kitchenToday(ctx.nowMs);
  const q = ctx.query.get("q") ?? "";
  const from = ctx.query.get("from") || addDays(today, -DIAL_PAST_DAYS);
  const to = ctx.query.get("to") || addDays(today, BOOK_AHEAD_DAYS);
  const status = ctx.query.get("status") || null;
  const stationId = ctx.query.get("station_id") || null;
  const errors = new FieldErrors();
  if (!isKitchenDate(from)) errors.add("from", "Give the date as YYYY-MM-DD.");
  if (!isKitchenDate(to)) errors.add("to", "Give the date as YYYY-MM-DD.");
  if (status !== null && !SEARCHABLE_STATUSES.includes(status as BookingStatus)) errors.add("status", "Choose a booking status.");
  if (stationId !== null && (await rows(pool, "SELECT 1 FROM stations WHERE id = $1", [stationId])).length === 0) errors.add("station_id", "Choose a station.");
  errors.throwIfAny();
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const operator = ctx.user.role === "operator";
  const found = await rows<BookingRow>(
    pool,
    `${BOOKING_SELECT}
      WHERE b.status <> 'held' AND b.date BETWEEN $1 AND $2
        AND ($3::text IS NULL OR b.tenant_id = $3)
        AND (b.ref ILIKE $4 OR b.notes ILIKE $4 OR ($5 AND t.business_name ILIKE $4))
        AND ($6::text IS NULL OR b.status = $6)
        AND ($7::text IS NULL OR b.station_id = $7)
      ORDER BY b.start_at, b.ref
      ${cap === null ? "" : `LIMIT ${cap}`}`,
    [from, to, operator ? null : ctx.user.tenant_id, pattern, operator, status, stationId],
  );
  return { from, to, rows: found };
}

/** RFC 4180 cell with spreadsheet formulas neutralised (adapted from kit/modules/csv_safe). */
function csvCell(value: string | null): string {
  if (value === null) return "";
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function csvExport(search: Search, operator: boolean): Reply {
  const header = operator
    ? ["tenant", "ref", "station", "date", "start", "end", "status", "payment", "amount", "notes", "contact_email"]
    : ["ref", "station", "date", "start", "end", "status", "payment", "amount", "notes"];
  const lines = search.rows.map((b) => {
    const cells = [
      b.ref,
      b.station_name,
      b.date,
      hhmm(b.start_minute),
      hhmm(b.end_minute),
      b.status,
      b.pay_with,
      b.pay_with === "account" && b.amount_cents !== null ? dollars(b.amount_cents).slice(1) : null,
      b.notes,
    ];
    return operator ? [b.tenant_name, ...cells, b.owner_email] : cells;
  });
  const text = [header, ...lines].map((cells) => cells.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return {
    status: 200,
    file: {
      body: Buffer.from(text, "utf8"),
      contentType: "text/csv; charset=utf-8",
      disposition: disposition("attachment", `bookings-${search.from}-to-${search.to}.csv`),
    },
  };
}

const loadOwnBooking = (ctx: Ctx<undefined>): Promise<BookingRow> => loadBooking(pool, ctx.user, ctx.params.id);

/** Locks the booking, runs a change, and answers with the booking as it now stands. */
async function changeBooking(ctx: Ctx<BookingRow>, change: (db: Db, booking: BookingRow, effects: Effects) => Promise<void>): Promise<Reply> {
  const updated = await unitOfWork(async (db, effects) => {
    const booking = await loadBooking(db, ctx.user, ctx.loaded.id, true);
    await change(db, booking, effects);
    return loadBooking(db, ctx.user, booking.id);
  });
  return { status: 200, json: bookingView(updated, ctx.user) };
}

async function billingAccount(db: Db, booking: BookingRow): Promise<{ tenantId: string; accountId: string }> {
  const [tenant] = await tenantRows(db, booking.tenant_id);
  return { tenantId: tenant.id, accountId: await accountFor(tenant) };
}

export const bookingRoutes = [
  route({
    method: "GET",
    path: "/api/bookings",
    roles: ["operator", "owner", "cook"],
    async handle(ctx) {
      const search = await searchBookings(ctx, SEARCH_CAP);
      return { status: 200, json: { bookings: search.rows.map((b) => bookingView(b, ctx.user)) } };
    },
  }),
  route({
    method: "GET",
    path: "/api/bookings/export",
    roles: ["operator", "owner", "cook"],
    async handle(ctx) {
      return csvExport(await searchBookings(ctx, null), ctx.user.role === "operator");
    },
  }),
  route<BookingRow>({
    method: "GET",
    path: "/api/bookings/:id",
    roles: ["operator", "owner", "cook"],
    load: loadOwnBooking,
    async handle(ctx) {
      return { status: 200, json: bookingView(ctx.loaded, ctx.user) };
    },
  }),
  route<BookingRow>({
    method: "POST",
    path: "/api/bookings/:id/check-in",
    roles: ["operator", "owner", "cook"],
    body: "json",
    load: loadOwnBooking,
    handle: (ctx) =>
      changeBooking(ctx, async (db, booking) => {
        const status = bookingTransition(booking.status, "check_in");
        if (!checkInWindowOpen(booking.start_at.getTime(), booking.end_at.getTime(), ctx.nowMs)) {
          throw new ApiError(409, "outside_check_in_window", "Check-in isn't open for this booking yet, or it has ended.");
        }
        const [tenant] = await tenantRows(db, booking.tenant_id);
        if ((await tenantStanding(db, tenant, ctx.nowMs)).status !== "active") {
          throw tenantNotActive();
        }
        await db.query("UPDATE bookings SET status = $2, checked_in_at = $3 WHERE id = $1", [booking.id, status, new Date(ctx.nowMs)]);
        await audit(db, ctx.user.id, "booking", booking.ref, "checked_in");
      }),
  }),
  route<BookingRow>({
    method: "POST",
    path: "/api/bookings/:id/check-out",
    roles: ["operator", "owner", "cook"],
    body: "json",
    load: loadOwnBooking,
    async handle(ctx) {
      const reported = ctx.json.holdover_minutes;
      if (!Number.isInteger(reported) || (reported as number) < 0 || (reported as number) > HOLDOVER_MAX_MINUTES) {
        throw validation({ holdover_minutes: `Enter whole minutes from 0 to ${HOLDOVER_MAX_MINUTES}.` });
      }
      return changeBooking(ctx, async (db, booking, effects) => {
        const status = bookingTransition(booking.status, "check_out");
        const billed = billedHoldoverMinutes(reported as number);
        const amount = stationTimeCents(billed, booking.hourly_rate_cents);
        await db.query(
          `UPDATE bookings SET status = $2, checked_out_at = $3, holdover_reported_minutes = $4, holdover_billed_minutes = $5, holdover_amount_cents = $6
            WHERE id = $1`,
          [booking.id, status, new Date(ctx.nowMs), reported, billed, amount],
        );
        await audit(db, ctx.user.id, "booking", booking.ref, "checked_out", { reported_minutes: reported, billed_minutes: billed });
        if (billed > 0) {
          await effects.bill(await billingAccount(db, booking), "charge", amount, `Hold-over ${booking.ref}`);
          const [tenant] = await tenantRows(db, booking.tenant_id);
          await sendEmail(holdoverNotice(tenant, booking.ref, reported as number, billed, amount));
        }
      });
    },
  }),
  route<BookingRow>({
    method: "POST",
    path: "/api/bookings/:id/cancel",
    roles: ["operator", "owner"],
    body: "json",
    load: loadOwnBooking,
    handle: (ctx) =>
      changeBooking(ctx, async (db, booking, effects) => {
        const status = bookingTransition(booking.status, "cancel");
        if (ctx.nowMs >= booking.start_at.getTime()) throw new ApiError(409, "already_started", "This booking has started and can't be cancelled.");
        // A confirmed booking always carries its payment choice, amount (account) and policy version.
        const charge = cancellationCharge(
          { startMs: booking.start_at.getTime(), payWith: booking.pay_with as PayWith, amountCents: booking.amount_cents as number, elapsedMinutes: booking.elapsed_minutes },
          { free_window_hours: booking.free_window_hours as number, late_fee_percent: booking.late_fee_percent as number },
          ctx.nowMs,
        );
        const at = new Date(ctx.nowMs);
        await db.query(
          `UPDATE bookings SET status = $2, cancelled_at = $3, cancelled_on = $4, cancel_late = $5, fee_cents = $6, fee_minutes = $7, fee_refunded = false
            WHERE id = $1`,
          [booking.id, status, at, kitchenToday(ctx.nowMs), charge.late, charge.feeCents, charge.feeMinutes],
        );
        await audit(db, ctx.user.id, "booking", booking.ref, "cancelled", { late: charge.late, fee_cents: charge.feeCents, fee_minutes: charge.feeMinutes });
        if (booking.pay_with === "hour_pack") {
          if (charge.returnMinutes > 0) await recordMovement(db, booking.tenant_id, charge.returnMinutes, "cancellation_return", booking.id, at);
          return;
        }
        const account = await billingAccount(db, booking);
        await effects.bill(account, "credit", charge.creditCents, `Cancellation credit ${booking.ref}`);
        if (charge.feeCents > 0) await effects.bill(account, "charge", charge.feeCents, `Late cancellation fee ${booking.ref}`);
      }),
  }),
  route<BookingRow>({
    method: "POST",
    path: "/api/bookings/:id/no-show",
    roles: ["operator"],
    body: "json",
    load: loadOwnBooking,
    handle: (ctx) =>
      changeBooking(ctx, async (db, booking) => {
        const status = bookingTransition(booking.status, "no_show");
        if (ctx.nowMs < booking.start_at.getTime()) throw new ApiError(409, "not_started", "This booking hasn't started yet.");
        await db.query("UPDATE bookings SET status = $2 WHERE id = $1", [booking.id, status]);
        await audit(db, ctx.user.id, "booking", booking.ref, "no_show");
      }),
  }),
  route<BookingRow>({
    method: "POST",
    path: "/api/bookings/:id/refund-fee",
    roles: ["operator"],
    body: "json",
    load: loadOwnBooking,
    handle: (ctx) =>
      changeBooking(ctx, async (db, booking, effects) => {
        assertFeeRefundable(booking);
        await db.query("UPDATE bookings SET fee_refunded = true WHERE id = $1", [booking.id]);
        await audit(db, ctx.user.id, "booking", booking.ref, "fee_refunded");
        if (booking.pay_with === "hour_pack") {
          await recordMovement(db, booking.tenant_id, booking.fee_minutes as number, "fee_refund", booking.id, new Date(ctx.nowMs));
          return;
        }
        await effects.bill(await billingAccount(db, booking), "credit", booking.fee_cents as number, `Fee refund ${booking.ref}`);
      }),
  }),
];
