/** Bookings: search, CSV export, check-in, check-out with hold-over, cancellation, no-show, fee refund. */

import { addDays, isValidKitchenDate } from "../../../shared/kitchen-time.js";
import { centsToDollars } from "../../../shared/money.js";
import type { BookingStatus } from "../../../shared/api-types.js";
import { uuid, writeLedgerMovement } from "../../db.js";
import {
  billedHoldoverMinutes,
  cancellationOutcome,
  holdoverAmountCents,
  type BookingRow
} from "../../domain/bookings.js";
import { UnitOfWorkRunner } from "../../domain/unit-of-work.js";
import { holdoverNoticeEmail } from "../../email.js";
import { err, notFound, validation } from "../errors.js";
import type { App, RouteContext } from "../server.js";
import { int, json, readJson, requireRole, requireUser } from "./helpers.js";
import { bookingJson, dollars } from "./booking-json.js";
import type { UserRow } from "./helpers.js";

const SEARCH_ROW_CAP = 200;
const BOOKING_STATUSES: BookingStatus[] = [
  "confirmed",
  "checked_in",
  "completed",
  "cancelled",
  "no_show"
];

/** A booking with its tenant and station names, plus the policy version it was confirmed under. */
interface BookingFullRow extends BookingRow {
  tenant_name: string;
  contact_email: string;
  station_name: string;
  station_rate_cents: number;
  policy_free_window_hours: number | null;
  policy_late_fee_percent: number | null;
}

async function searchBookings(
  rc: RouteContext,
  user: UserRow,
  params: URLSearchParams
): Promise<{ rows: BookingFullRow[]; from: string; to: string }> {
  const db = rc.db;
  const clock = db.clock;
  const today = clock.today();
  const from = params.get("from") ?? addDays(today, -30);
  const to = params.get("to") ?? addDays(today, 365);
  if (!isValidKitchenDate(from) || !isValidKitchenDate(to)) {
    throw validation({ from: "Give inclusive kitchen dates." });
  }
  const q = (params.get("q") ?? "").trim().toLowerCase();
  const status = params.get("status");
  const stationId = params.get("station_id");

  const stationIds = new Set(
    (await db.query<{ id: string }>("SELECT id FROM stations")).map((s) => s.id)
  );
  const detail: Record<string, string> = {};
  if (status !== null && !BOOKING_STATUSES.includes(status as BookingStatus)) {
    detail["status"] = "Give a booking status other than held.";
  }
  if (stationId !== null && !stationIds.has(stationId)) {
    detail["station_id"] = "Give a station.";
  }
  if (Object.keys(detail).length > 0) {
    throw validation(detail);
  }

  const args: unknown[] = [from, to];
  let where = `b.date >= $1::date AND b.date <= $2::date AND b.status <> 'held'`;
  if (user.tenant_id !== null) {
    args.push(user.tenant_id);
    where += ` AND b.tenant_id = $${args.length}`;
  }
  if (status !== null) {
    args.push(status);
    where += ` AND b.status = $${args.length}`;
  }
  if (stationId !== null) {
    args.push(stationId);
    where += ` AND b.station_id = $${args.length}`;
  }
  if (q !== "") {
    args.push(`%${q}%`);
    const like = `$${args.length}`;
    if (user.role === "operator") {
      where += ` AND (lower(b.ref) LIKE ${like} OR lower(coalesce(b.notes,'')) LIKE ${like} OR lower(t.business_name) LIKE ${like})`;
    } else {
      where += ` AND (lower(b.ref) LIKE ${like} OR lower(coalesce(b.notes,'')) LIKE ${like})`;
    }
  }
  const rows = await db.query<BookingFullRow>(
    `SELECT b.id, b.ref, b.hold_ref, b.tenant_id, b.station_id, b.date::text AS date,
            b.start_local, b.end_local, b.start, b."end", b.elapsed_minutes, b.status, b.pay_with,
            b.amount_cents, b.policy_version, b.notes, b.checked_in_at, b.checked_out_at,
            b.holdover_reported_minutes, b.holdover_billed_minutes, b.holdover_cents,
            b.cancelled_at, b.cancelled_late, b.fee_cents, b.fee_minutes, b.fee_refunded, b.created_at,
            t.business_name AS tenant_name, t.owner_email AS contact_email, s.name AS station_name,
            pv.free_window_hours AS policy_free_window_hours, pv.late_fee_percent AS policy_late_fee_percent
     FROM bookings b
     JOIN tenants t ON t.id = b.tenant_id
     JOIN stations s ON s.id = b.station_id
     LEFT JOIN policy_versions pv ON pv.version = b.policy_version
     WHERE ${where}
     ORDER BY b.start`,
    args
  );
  return { rows, from, to };
}

function rowToBooking(row: BookingFullRow, clock: import("../../../shared/kitchen-time.js").KitchenClock, operatorView: boolean): import("../../../shared/api-types.js").Booking {
  return bookingJson(
    {
      ...row,
      free_window_hours: row.policy_free_window_hours ?? 0,
      late_fee_percent: row.policy_late_fee_percent ?? 0
    },
    clock,
    operatorView,
    row.tenant_name
  );
}

export function registerBookingRoutes(app: App, uow: UnitOfWorkRunner): void {
  app.route("GET", "/api/bookings", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    const { rows } = await searchBookings(rc, user, rc.ctx.url.searchParams);
    const clock = rc.db.clock;
    return json(200, {
      bookings: rows.slice(0, SEARCH_ROW_CAP).map((row) => rowToBooking(row, clock, user.role === "operator"))
    });
  });

  app.route("GET", "/api/bookings/export", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    const { rows, from, to } = await searchBookings(rc, user, rc.ctx.url.searchParams);
    const operator = user.role === "operator";
    const header = operator
      ? ["tenant", "ref", "station", "date", "start", "end", "status", "payment", "amount", "notes", "contact_email"]
      : ["ref", "station", "date", "start", "end", "status", "payment", "amount", "notes"];
    const lines = [header.join(",")];
    for (const row of rows) {
      const amount = row.pay_with === "account" && row.amount_cents !== null ? centsToDollars(row.amount_cents) : "";
      const base = [
        row.ref,
        row.station_name,
        row.date,
        row.start_local,
        row.end_local,
        row.status,
        row.pay_with ?? "",
        amount,
        row.notes ?? ""
      ];
      const fields = operator ? [row.tenant_name, ...base, row.contact_email] : base;
      lines.push(fields.map(csvField).join(","));
    }
    const csv = lines.join("\r\n") + "\r\n";
    return {
      status: 200,
      body: Buffer.from(csv, "utf8"),
      contentType: "text/csv; charset=utf-8",
      disposition: `attachment; filename="bookings-${from}-to-${to}.csv"`
    };
  });

  app.route("GET", "/api/bookings/:id", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    const rows = await loadBookingFull(rc, user, rc.ctx.params["id"] ?? "");
    return json(200, rowToBooking(rows, rc.db.clock, user.role === "operator"));
  });

  app.route("POST", "/api/bookings/:id/check-in", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    const id = rc.ctx.params["id"] ?? "";
    const booking = await loadBookingFull(rc, user, id);
    if (booking.status !== "confirmed") {
      throw err(409, "invalid_transition", "That can't be done in this record's current state.");
    }
    const now = Date.now();
    const windowStart = booking.start.getTime() - 15 * 60_000;
    if (now < windowStart || now >= booking.end.getTime()) {
      throw err(409, "outside_check_in_window", "Check-in isn't open for this booking yet, or it has ended.");
    }
    const tenantRows = await rc.db.query<{ status: string }>("SELECT status FROM tenants WHERE id = $1", [
      booking.tenant_id
    ]);
    if (tenantRows[0].status !== "active") {
      throw err(409, "tenant_not_active", "Check-in is blocked: a required document has expired.");
    }
    await rc.db.query("UPDATE bookings SET status = 'checked_in', checked_in_at = now() WHERE id = $1", [id]);
    await rc.db.audit(user.id, "check_in", "booking", id, {});
    return json(200, rowToBooking(await loadBookingFull(rc, user, id), rc.db.clock, user.role === "operator"));
  });

  app.route("POST", "/api/bookings/:id/check-out", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    const id = rc.ctx.params["id"] ?? "";
    const booking = await loadBookingFull(rc, user, id);
    if (booking.status !== "checked_in") {
      throw err(409, "invalid_transition", "That can't be done in this record's current state.");
    }
    const body = await readJson(rc.ctx);
    const reported = int(body["holdover_minutes"]);
    if (reported === undefined || reported < 0 || reported > 240) {
      throw validation({ holdover_minutes: "Enter whole minutes from 0 to 240." });
    }
    const billed = billedHoldoverMinutes(reported);
    const amount = holdoverAmountCents(billed, booking.station_rate_cents);
    const clock = rc.db.clock;
    if (billed > 0) {
      await uow.run({
        write: async (client) => {
          await client.query(
            `UPDATE bookings SET status = 'completed', checked_out_at = now(),
                   holdover_reported_minutes = $1, holdover_billed_minutes = $2, holdover_cents = $3
             WHERE id = $4`,
            [reported, billed, amount, id]
          );
        },
        killBill: [
          {
            tenantId: booking.tenant_id,
            businessName: booking.tenant_name,
            kind: "charge",
            charge: {
              kind: "charge",
              description: `Hold-over ${booking.ref}`,
              amountCents: amount
            }
          }
        ],
        syncEmail: holdoverNoticeEmail(
          booking.contact_email,
          booking.ref,
          reported,
          billed,
          dollars(amount)
        )
      });
    } else {
      await rc.db.query(
        `UPDATE bookings SET status = 'completed', checked_out_at = now(),
               holdover_reported_minutes = $1, holdover_billed_minutes = 0, holdover_cents = 0
         WHERE id = $2`,
        [reported, id]
      );
    }
    await rc.db.audit(user.id, "check_out", "booking", id, { reported, billed });
    return json(200, rowToBooking(await loadBookingFull(rc, user, id), clock, user.role === "operator"));
  });

  app.route("POST", "/api/bookings/:id/cancel", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    requireRole(user, ["operator", "owner"]);
    const id = rc.ctx.params["id"] ?? "";
    const booking = await loadBookingFull(rc, user, id);
    return json(200, await cancelBooking(rc, uow, user, booking));
  });

  app.route("POST", "/api/bookings/:id/no-show", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    requireRole(user, ["operator"]);
    const id = rc.ctx.params["id"] ?? "";
    const booking = await loadBookingFull(rc, user, id);
    if (booking.status !== "confirmed") {
      throw err(409, "invalid_transition", "That can't be done in this record's current state.");
    }
    if (Date.now() < booking.start.getTime()) {
      throw err(409, "not_started", "This booking hasn't started yet.");
    }
    await rc.db.query("UPDATE bookings SET status = 'no_show' WHERE id = $1", [id]);
    await rc.db.audit(user.id, "mark_no_show", "booking", id, {});
    return json(200, rowToBooking(await loadBookingFull(rc, user, id), rc.db.clock, user.role === "operator"));
  });

  app.route("POST", "/api/bookings/:id/refund-fee", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    requireRole(user, ["operator"]);
    const id = rc.ctx.params["id"] ?? "";
    const booking = await loadBookingFull(rc, user, id);
    if (booking.status !== "cancelled" || booking.cancelled_late !== true) {
      throw err(409, "invalid_transition", "That fee is already refunded or invoiced.");
    }
    if (booking.fee_refunded) {
      throw err(409, "invalid_transition", "That fee is already refunded or invoiced.");
    }
    const feeTotal = booking.pay_with === "account" ? booking.fee_cents : booking.fee_minutes;
    if (feeTotal <= 0) {
      throw err(409, "invalid_transition", "That fee is already refunded or invoiced.");
    }
    const invoiced = await rc.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM invoice_lines WHERE booking_id = $1 AND kind = 'late_fee'",
      [id]
    );
    if (Number(invoiced[0].count) > 0) {
      throw err(409, "fee_invoiced", "That fee is already refunded or invoiced.");
    }
    if (booking.pay_with === "account") {
      await uow.run({
        write: async (client) => {
          await client.query("UPDATE bookings SET fee_refunded = TRUE WHERE id = $1", [id]);
        },
        killBill: [
          {
            tenantId: booking.tenant_id,
            businessName: booking.tenant_name,
            kind: "credit",
            charge: {
              kind: "credit",
              description: `Fee refund ${booking.ref}`,
              amountCents: booking.fee_cents
            }
          }
        ]
      });
    } else {
      await rc.db.withTransaction(async (client) => {
        await client.query("UPDATE bookings SET fee_refunded = TRUE WHERE id = $1", [id]);
        await writeLedgerMovement(client, uuid(), booking.tenant_id, booking.fee_minutes, "fee_refund", id);
      });
    }
    await rc.db.audit(user.id, "refund_fee", "booking", id, {});
    return json(200, rowToBooking(await loadBookingFull(rc, user, id), rc.db.clock, user.role === "operator"));
  });
}

/** Cancelling uses the booking's own policy version, and records the matching credit, fee or hour return. */
async function cancelBooking(
  rc: RouteContext,
  uow: UnitOfWorkRunner,
  user: UserRow,
  booking: BookingFullRow
): Promise<import("../../../shared/api-types.js").Booking> {
  if (booking.status !== "confirmed") {
    throw err(409, "invalid_transition", "That can't be done in this record's current state.");
  }
  if (Date.now() >= booking.start.getTime()) {
    throw err(409, "already_started", "This booking has started and can't be cancelled.");
  }
  const policy = {
    free_window_hours: booking.policy_free_window_hours ?? 0,
    late_fee_percent: booking.policy_late_fee_percent ?? 0
  };
  const outcome = cancellationOutcome(booking, policy, Date.now());

  if (booking.pay_with === "account") {
    await uow.run({
      write: async (client) => {
        await client.query(
          `UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancelled_late = $1,
                 fee_cents = $2, fee_minutes = 0 WHERE id = $3`,
          [outcome.late, outcome.feeCents, booking.id]
        );
      },
      killBill: [
        {
          tenantId: booking.tenant_id,
          businessName: booking.tenant_name,
          kind: "credit",
          charge: {
            kind: "credit",
            description: `Cancellation credit ${booking.ref}`,
            amountCents: booking.amount_cents ?? 0
          }
        },
        ...(outcome.feeCents > 0
          ? [
              {
                tenantId: booking.tenant_id,
                businessName: booking.tenant_name,
                kind: "charge" as const,
                charge: {
                  kind: "charge" as const,
                  description: `Late cancellation fee ${booking.ref}`,
                  amountCents: outcome.feeCents
                }
              }
            ]
          : [])
      ]
    });
  } else {
    // Hour-pack bookings: free returns all debited minutes; late keeps the fee minutes.
    await rc.db.withTransaction(async (client) => {
      await client.query(
        `UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancelled_late = $1,
               fee_cents = 0, fee_minutes = $2 WHERE id = $3`,
        [outcome.late, outcome.feeMinutes, booking.id]
      );
      await writeLedgerMovement(client, uuid(), booking.tenant_id, booking.elapsed_minutes - outcome.feeMinutes, "cancellation_return", booking.id);
    });
  }
  await rc.db.audit(user.id, "cancel_booking", "booking", booking.id, { late: outcome.late });
  return rowToBooking(await loadBookingFull(rc, user, booking.id), rc.db.clock, user.role === "operator");
}

async function loadBookingFull(rc: RouteContext, user: UserRow, id: string): Promise<BookingFullRow> {
  const rows = await rc.db.query<BookingFullRow>(
    `SELECT b.id, b.ref, b.hold_ref, b.tenant_id, b.station_id, b.date::text AS date,
            b.start_local, b.end_local, b.start, b."end", b.elapsed_minutes, b.status, b.pay_with,
            b.amount_cents, b.policy_version, b.notes, b.checked_in_at, b.checked_out_at,
            b.holdover_reported_minutes, b.holdover_billed_minutes, b.holdover_cents,
            b.cancelled_at, b.cancelled_late, b.fee_cents, b.fee_minutes, b.fee_refunded, b.created_at,
            t.business_name AS tenant_name, t.owner_email AS contact_email, s.name AS station_name,
            s.hourly_rate_cents AS station_rate_cents,
            pv.free_window_hours AS policy_free_window_hours, pv.late_fee_percent AS policy_late_fee_percent
     FROM bookings b
     JOIN tenants t ON t.id = b.tenant_id
     JOIN stations s ON s.id = b.station_id
     LEFT JOIN policy_versions pv ON pv.version = b.policy_version
     WHERE b.id = $1`,
    [id]
  );
  if (rows.length === 0) {
    throw notFound();
  }
  if (user.tenant_id !== null && rows[0].tenant_id !== user.tenant_id) {
    throw notFound();
  }
  return rows[0];
}

const csvField = (value: string): string => {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
};
