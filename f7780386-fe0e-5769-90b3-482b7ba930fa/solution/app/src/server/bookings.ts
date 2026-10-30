// Bookings: all-or-none confirmation of a hold, cancellation with the kitchen-time cutoff and late fee,
// fee waivers, crew check-ins and completion.

import { randomUUID } from "node:crypto";
import type { Booking, BookingStatus, CheckIn, FeeStatus, Payment } from "../shared/api.js";
import { cancellationIsFree, clock, costSplit, formatMoney, freeCancelUntil, inCheckInWindow, lateFeeCents, priceCents } from "../shared/rules.js";
import { addDays, daysBetween, isCalendarDate, wallInstant } from "../shared/zone.js";
import { dropQueued, enqueueBilling, settleNow } from "./billing.js";
import { now, nowSecond } from "./clock.js";
import { tx, type Db } from "./db.js";
import { coveringDocument } from "./documents.js";
import { conflict, FieldErrors, forbidden, notFound } from "./errors.js";
import { releaseCells, liveState, ownHold, refuseUnlessLive } from "./holds.js";
import { json, type Reply, type Request } from "./http.js";
import { iso, isoOrNull, stationOf, timeZone, today } from "./kitchen.js";
import { lockBalance, post } from "./ledger.js";
import { enqueueMail, kickMail } from "./mail.js";
import type { SessionUser } from "./sessions.js";

const RANGE_DAYS = 62;
const DEFAULT_DAYS_AHEAD = 28;

interface BookingRow {
  id: string;
  hold_id: string;
  member_id: string;
  business_name: string;
  contact_email: string;
  station_id: string;
  date: string;
  start_minute: number;
  end_minute: number;
  tail_end_minute: number;
  starts_at: Date;
  ends_at: Date;
  status: BookingStatus;
  payment: Payment;
  booked_minutes: number;
  prepaid_minutes: number;
  overage_minutes: number;
  overage_cents: number;
  list_cents: number;
  free_cancel_until: Date;
  fee_cents: number | null;
  fee_status: FeeStatus | null;
  confirmed_at: Date;
  cancelled_at: Date | null;
  check_ins: { id: string; crew_cook_id: string; crew_cook_name: string; at: string; card_document_id: string }[] | null;
}

const BOOKING_SELECT = `
  SELECT b.*, m.business_name, m.contact_email,
         (SELECT json_agg(json_build_object('id', c.id, 'crew_cook_id', c.crew_cook_id, 'crew_cook_name', u.name,
                                            'at', c.at, 'card_document_id', c.card_document_id) ORDER BY c.at)
            FROM check_ins c JOIN users u ON u.id = c.crew_cook_id WHERE c.booking_id = b.id) AS check_ins
    FROM bookings b JOIN members m ON m.id = b.member_id`;

function checkInJson(c: NonNullable<BookingRow["check_ins"]>[number]): CheckIn {
  return { id: c.id, crew_cook_id: c.crew_cook_id, crew_cook_name: c.crew_cook_name, at: iso(new Date(c.at)), card_document_id: c.card_document_id };
}

function bookingJson(row: BookingRow): Booking {
  return {
    id: row.id,
    hold_id: row.hold_id,
    member_id: row.member_id,
    business_name: row.business_name,
    station_id: row.station_id,
    station_name: stationOf(row.station_id).name,
    date: row.date,
    start: clock(row.start_minute),
    end: clock(row.end_minute),
    tail_end: clock(row.tail_end_minute),
    status: row.status,
    payment: row.payment,
    booked_minutes: row.booked_minutes,
    prepaid_minutes: row.prepaid_minutes,
    overage_minutes: row.overage_minutes,
    overage_amount: formatMoney(row.overage_cents),
    list_amount: formatMoney(row.list_cents),
    free_cancel_until: iso(row.free_cancel_until),
    fee: row.fee_cents === null || row.fee_status === null ? null : { amount: formatMoney(row.fee_cents), status: row.fee_status },
    check_ins: (row.check_ins ?? []).map(checkInJson),
    confirmed_at: iso(row.confirmed_at),
    cancelled_at: isoOrNull(row.cancelled_at),
  };
}

/** checked_in → completed once now is at or after the booking's end. Run before reads and by the sweep. */
export async function completeFinished(db: Db): Promise<void> {
  await db.query("UPDATE bookings SET status = 'completed' WHERE status = 'checked_in' AND ends_at <= $1", [new Date(now())]);
}

function inScope(user: SessionUser, memberId: string): boolean {
  return user.role === "operator" || user.memberId === memberId;
}

async function bookingRow(db: Db, id: string, user: SessionUser, lock: boolean): Promise<BookingRow> {
  if (lock) await db.query("SELECT id FROM bookings WHERE id = $1 FOR UPDATE", [id]);
  const found = await db.query<BookingRow>(`${BOOKING_SELECT} WHERE b.id = $1`, [id]);
  const row: BookingRow | undefined = found.rows[0];
  if (!row || !inScope(user, row.member_id)) throw notFound();
  return row;
}

async function reread(db: Db, id: string): Promise<Booking> {
  const found = await db.query<BookingRow>(`${BOOKING_SELECT} WHERE b.id = $1`, [id]);
  return bookingJson(found.rows[0]);
}

export async function getBooking(req: Request, user: SessionUser): Promise<Reply> {
  const booking = await tx(async (db) => {
    await completeFinished(db);
    return bookingJson(await bookingRow(db, req.params.id, user, false));
  });
  return json(200, { booking });
}

export async function listBookings(req: Request, user: SessionUser): Promise<Reply> {
  const kitchenToday = today();
  const from = req.query.get("from") ?? kitchenToday;
  const to = req.query.get("to") ?? addDays(kitchenToday, DEFAULT_DAYS_AHEAD);
  const errors = new FieldErrors();
  if (!isCalendarDate(from)) errors.add("from", "invalid");
  if (!isCalendarDate(to)) errors.add("to", "invalid");
  else if (isCalendarDate(from) && daysBetween(from, to) < 0) errors.add("to", "invalid");
  else if (isCalendarDate(from) && daysBetween(from, to) + 1 > RANGE_DAYS) errors.add("to", "range_too_long");
  if (errors.any()) throw errors.error();
  const filter = req.query.get("member_id");
  const memberId = user.role === "operator" ? filter : user.memberId;
  if (user.role !== "operator" && filter !== null && filter !== user.memberId) throw notFound();
  const bookings = await tx(async (db) => {
    await completeFinished(db);
    const params: unknown[] = [from, to];
    let where = "b.date BETWEEN $1 AND $2";
    if (memberId) {
      params.push(memberId);
      where += " AND b.member_id = $3";
    }
    const found = await db.query<BookingRow>(`${BOOKING_SELECT} WHERE ${where} ORDER BY b.date, b.start_minute, b.station_id`, params);
    return found.rows.map(bookingJson);
  });
  return json(200, { bookings });
}

export async function confirmHold(req: Request, user: SessionUser): Promise<Reply> {
  const outcome = await tx(async (db) => {
    const hold = await ownHold(db, req.params.id, user);
    refuseUnlessLive(await liveState(db, hold));
    if (!(await coveringDocument(db, hold.member_id, "liability_insurance", null, hold.date))) {
      throw conflict("documents_not_current", { missing: ["liability_insurance"] });
    }
    const s = stationOf(hold.station_id);
    const split = costSplit(hold.end_minute - hold.start_minute, await lockBalance(db, hold.member_id), s.rateCents);
    const id = `bkg_${randomUUID().replaceAll("-", "")}`;
    const at = now();
    const zone = timeZone();
    await db.query(
      `INSERT INTO bookings (id, hold_id, member_id, station_id, date, start_minute, end_minute, tail_end_minute, starts_at, ends_at,
                             status, payment, booked_minutes, prepaid_minutes, overage_minutes, overage_cents, list_cents,
                             free_cancel_until, confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'confirmed', $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        id,
        hold.id,
        hold.member_id,
        hold.station_id,
        hold.date,
        hold.start_minute,
        hold.end_minute,
        hold.tail_end_minute,
        new Date(wallInstant(hold.date, hold.start_minute, zone)),
        new Date(wallInstant(hold.date, hold.end_minute, zone)),
        split.overageMinutes > 0 ? "payment_pending" : "paid",
        split.bookedMinutes,
        split.prepaidMinutes,
        split.overageMinutes,
        split.overageCents,
        priceCents(split.bookedMinutes, s.rateCents),
        new Date(freeCancelUntil(hold.date, hold.start_minute, zone)),
        new Date(at),
      ],
    );
    if (split.prepaidMinutes > 0) {
      await post(db, { memberId: hold.member_id, kind: "booking_debit", memberMinutes: -split.prepaidMinutes, bookingId: id }, split.prepaidMinutes);
    }
    const jobs: { id: string; bookingId: string }[] = [];
    if (split.overageMinutes > 0) {
      const description = `Overage ${id}: ${s.name} ${hold.date} ${clock(hold.start_minute)}–${clock(hold.end_minute)}`;
      jobs.push({ id: await enqueueBilling(db, "overage_charge", hold.member_id, id, split.overageCents, description), bookingId: id });
    }
    await db.query("UPDATE holds SET status = 'confirmed' WHERE id = $1", [hold.id]);
    const contact = await db.query<{ contact_email: string }>("SELECT contact_email FROM members WHERE id = $1", [hold.member_id]);
    await enqueueMail(db, "booking_confirmed", `booking-confirmed:${id}`, id, contact.rows[0].contact_email);
    return { id, jobs };
  });
  await settleNow(outcome.jobs);
  kickMail();
  const booking = await tx((db) => reread(db, outcome.id));
  return json(201, { booking });
}

function requireCanceller(user: SessionUser): void {
  if (user.role === "crew_cook") throw forbidden();
}

export async function cancelBooking(req: Request, user: SessionUser): Promise<Reply> {
  const outcome = await tx(async (db) => {
    const row = await bookingRow(db, req.params.id, user, true);
    requireCanceller(user);
    if (row.status !== "confirmed") throw conflict("invalid_transition");
    const at = now();
    if (at >= row.starts_at.getTime()) throw conflict("booking_started");
    const free = cancellationIsFree(at, row.free_cancel_until.getTime());
    const jobs: { id: string; bookingId: string }[] = [];
    if (row.prepaid_minutes > 0) {
      const current = await lockBalance(db, row.member_id);
      await post(db, { memberId: row.member_id, kind: "cancellation_refund", memberMinutes: row.prepaid_minutes, bookingId: row.id }, current);
    }
    let payment = row.payment;
    if (row.payment === "payment_pending") {
      const dropped = await dropQueued(db, row.id, "overage_charge");
      if (dropped?.killbill_invoice_id) {
        jobs.push({ id: await enqueueBilling(db, "overage_refund_credit", row.member_id, row.id, row.overage_cents, `Refund overage ${row.id}`), bookingId: row.id });
      }
      payment = "voided";
    } else if (row.overage_cents > 0) {
      jobs.push({ id: await enqueueBilling(db, "overage_refund_credit", row.member_id, row.id, row.overage_cents, `Refund overage ${row.id}`), bookingId: row.id });
    }
    let feeCents: number | null = null;
    if (!free) {
      feeCents = lateFeeCents(row.list_cents);
      jobs.push({ id: await enqueueBilling(db, "fee_charge", row.member_id, row.id, feeCents, `Late cancellation ${row.id}`), bookingId: row.id });
    }
    await db.query(
      `UPDATE bookings SET status = $2, payment = $3, fee_cents = $4, fee_status = $5, cancelled_at = $6 WHERE id = $1`,
      [row.id, free ? "cancelled_free" : "cancelled_with_fee", payment, feeCents, feeCents === null ? null : "pending", new Date(at)],
    );
    await releaseCells(db, row.hold_id);
    await enqueueMail(db, "booking_cancelled", `booking-cancelled:${row.id}`, row.id, row.contact_email);
    return { id: row.id, jobs };
  });
  await settleNow(outcome.jobs);
  kickMail();
  const booking = await tx((db) => reread(db, outcome.id));
  return json(200, { booking });
}

export async function waiveFee(req: Request, user: SessionUser): Promise<Reply> {
  const outcome = await tx(async (db) => {
    const row = await bookingRow(db, req.params.id, user, true);
    if (user.role !== "operator") throw forbidden();
    if (row.status !== "cancelled_with_fee" || row.fee_cents === null || (row.fee_status !== "pending" && row.fee_status !== "charged")) {
      throw conflict("invalid_transition");
    }
    const jobs: { id: string; bookingId: string }[] = [];
    if (row.fee_status === "pending") {
      await dropQueued(db, row.id, "fee_charge");
    } else {
      jobs.push({ id: await enqueueBilling(db, "fee_waiver_credit", row.member_id, row.id, row.fee_cents, `Waived late cancellation ${row.id}`), bookingId: row.id });
    }
    await db.query("UPDATE bookings SET fee_status = 'waived' WHERE id = $1", [row.id]);
    return { id: row.id, jobs };
  });
  await settleNow(outcome.jobs);
  const booking = await tx((db) => reread(db, outcome.id));
  return json(200, { booking });
}

export async function checkIn(req: Request, user: SessionUser): Promise<Reply> {
  const outcome = await tx(async (db) => {
    await completeFinished(db);
    const row = await bookingRow(db, req.params.id, user, true);
    if (user.role !== "crew_cook") throw forbidden();
    if (row.status !== "confirmed" && row.status !== "checked_in") throw conflict("invalid_transition");
    const existing = (row.check_ins ?? []).find((c) => c.crew_cook_id === user.id);
    if (existing) return { status: 200, checkIn: checkInJson(existing), booking: bookingJson(row) };
    if (!inCheckInWindow(now(), row.starts_at.getTime(), row.ends_at.getTime())) throw conflict("outside_check_in_window");
    const card = await coveringDocument(db, row.member_id, "food_handler_card", user.id, row.date);
    if (!card) throw conflict("food_handler_card_not_current");
    const id = `chk_${randomUUID().replaceAll("-", "")}`;
    await db.query("INSERT INTO check_ins (id, booking_id, crew_cook_id, at, card_document_id) VALUES ($1, $2, $3, $4, $5)", [
      id,
      row.id,
      user.id,
      new Date(nowSecond()),
      card.documentId,
    ]);
    await db.query("UPDATE bookings SET status = 'checked_in' WHERE id = $1 AND status = 'confirmed'", [row.id]);
    const booking = await reread(db, row.id);
    const made = booking.check_ins.find((c) => c.id === id);
    return { status: 201, checkIn: made, booking };
  });
  return json(outcome.status, { check_in: outcome.checkIn, booking: outcome.booking });
}
