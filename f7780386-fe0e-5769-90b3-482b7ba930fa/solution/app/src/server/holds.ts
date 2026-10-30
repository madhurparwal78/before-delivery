// Holds on the line board: placement rules, one winner per station cell, resize, release, expiry,
// and the board's segments as each role may see them.

import { randomUUID } from "node:crypto";
import type { Board, BookingStatus, Hold, HoldStatus, Payment, Segment } from "../shared/api.js";
import { BOARD_CLOSES, BOARD_OPENS, BOOKING_DAYS_AHEAD, clock, costSplit, formatMoney, onGrid, parseClock, spanCells } from "../shared/rules.js";
import { daysBetween, isCalendarDate, wallInstant } from "../shared/zone.js";
import { billingState } from "./billing.js";
import { now, nowSecond } from "./clock.js";
import { isUniqueViolation, tx, type Db } from "./db.js";
import { coveringDocument } from "./documents.js";
import { conflict, FieldErrors, forbidden, invalid, notFound } from "./errors.js";
import { empty, json, type Reply, type Request } from "./http.js";
import { iso, station, stationOf, stations, timeZone, today, type StationRecord } from "./kitchen.js";
import { balance } from "./ledger.js";
import type { SessionUser } from "./sessions.js";

interface HoldRow {
  id: string;
  member_id: string;
  station_id: string;
  date: string;
  start_minute: number;
  end_minute: number;
  tail_end_minute: number;
  status: HoldStatus;
  created_at: Date;
  expires_at: Date;
}

/** Marks every live hold whose expiry instant has come as expired and frees its cells. */
export async function expireHolds(db: Db): Promise<void> {
  await db.query(
    `WITH gone AS (UPDATE holds SET status = 'expired' WHERE status = 'live' AND expires_at <= $1 RETURNING id)
     DELETE FROM station_cells WHERE hold_id IN (SELECT id FROM gone)`,
    [new Date(now())],
  );
}

/** Claims station cells for a hold. The primary key on (station, date, cell) lets exactly one claim win. */
async function claimCells(db: Db, stationId: string, date: string, cells: number[], holdId: string): Promise<void> {
  if (cells.length === 0) return;
  try {
    await db.query(
      `INSERT INTO station_cells (station_id, date, cell_minute, hold_id)
       SELECT $1, $2, cell, $4 FROM unnest($3::int[]) AS cell ORDER BY cell`,
      [stationId, date, cells, holdId],
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("slot_taken");
    throw error;
  }
}

export async function releaseCells(db: Db, holdId: string, fromMinute = 0): Promise<void> {
  await db.query("DELETE FROM station_cells WHERE hold_id = $1 AND cell_minute >= $2", [holdId, fromMinute]);
}

function holdJson(row: HoldRow, balanceMinutes: number, s: StationRecord): Hold {
  const split = costSplit(row.end_minute - row.start_minute, balanceMinutes, s.rateCents);
  return {
    id: row.id,
    member_id: row.member_id,
    station_id: row.station_id,
    date: row.date,
    start: clock(row.start_minute),
    end: clock(row.end_minute),
    tail_end: clock(row.tail_end_minute),
    status: row.status,
    created_at: iso(row.created_at),
    expires_at: iso(row.expires_at),
    preview: {
      booked_minutes: split.bookedMinutes,
      prepaid_minutes: split.prepaidMinutes,
      overage_minutes: split.overageMinutes,
      overage_amount: formatMoney(split.overageCents),
    },
  };
}

/** The end rules shared by placement and resize: on the grid, after the start, tail inside board hours. */
function checkEnd(errors: FieldErrors, rawEnd: unknown, start: number | null, s: StationRecord | undefined): number | null {
  const end = parseClock(rawEnd, true);
  if (end === null || !onGrid(end)) {
    errors.add("end", "not_on_grid");
    return null;
  }
  if (start === null) return end;
  if (end <= start) errors.add("end", "end_before_start");
  else if (s && end + s.cleaningMinutes > BOARD_CLOSES) errors.add("end", "outside_board_hours");
  return end;
}

function requireMember(user: SessionUser): string {
  if (user.role !== "member" || !user.memberId) throw forbidden();
  return user.memberId;
}

export async function placeHold(req: Request, user: SessionUser, holdSeconds: number): Promise<Reply> {
  const memberId = requireMember(user);
  const body = req.json;
  const errors = new FieldErrors();
  const s = station(body.station_id);
  if (!s) errors.add("station_id", "unknown");
  const date = isCalendarDate(body.date) ? body.date : null;
  if (!date) errors.add("date", "invalid");
  let start = parseClock(body.start, false);
  if (start === null || !onGrid(start)) {
    errors.add("start", "not_on_grid");
    start = null;
  } else if (start < BOARD_OPENS) {
    errors.add("start", "outside_board_hours");
  }
  const end = checkEnd(errors, body.end, start, s);
  if (date && start !== null && wallInstant(date, start, timeZone()) < now()) errors.add("start", "in_the_past");
  if (date && daysBetween(today(), date) > BOOKING_DAYS_AHEAD) errors.add("date", "too_far_ahead");
  if (!s || !date || start === null || end === null || errors.any()) throw errors.error();
  const tailEnd = end + s.cleaningMinutes;
  const created = nowSecond();
  const row = await tx(async (db) => {
    await expireHolds(db);
    if (!(await coveringDocument(db, memberId, "liability_insurance", null, date))) {
      throw conflict("documents_not_current", { missing: ["liability_insurance"] });
    }
    const id = `hold_${randomUUID().replaceAll("-", "")}`;
    const inserted = await db.query<HoldRow>(
      `INSERT INTO holds (id, member_id, station_id, date, start_minute, end_minute, tail_end_minute, status, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'live', $8, $9) RETURNING *`,
      [id, memberId, s.id, date, start, end, tailEnd, new Date(created), new Date(created + holdSeconds * 1000)],
    );
    await claimCells(db, s.id, date, spanCells(start, tailEnd), id);
    return holdJson(inserted.rows[0], await balance(db, memberId), s);
  });
  return json(201, { hold: row });
}

/** Loads the caller's own hold under a row lock after expiring due holds. */
export async function ownHold(db: Db, holdId: string, user: SessionUser): Promise<HoldRow> {
  const found = await db.query<HoldRow>("SELECT * FROM holds WHERE id = $1 FOR UPDATE", [holdId]);
  const row: HoldRow | undefined = found.rows[0];
  if (!row || (user.role !== "operator" && row.member_id !== user.memberId)) throw notFound();
  if (user.role !== "member") throw forbidden();
  return row;
}

/** Live strictly before the expiry instant: after expireHolds the stored status says which. */
export async function liveState(db: Db, row: HoldRow): Promise<HoldStatus> {
  await expireHolds(db);
  const found = await db.query<{ status: HoldStatus }>("SELECT status FROM holds WHERE id = $1", [row.id]);
  return found.rows[0].status;
}

export function refuseUnlessLive(status: HoldStatus): void {
  if (status === "confirmed" || status === "released") throw conflict("invalid_transition");
  if (status === "expired") throw conflict("hold_expired");
}

export async function resizeHold(req: Request, user: SessionUser): Promise<Reply> {
  const hold = await tx(async (db) => {
    const row = await ownHold(db, req.params.id, user);
    const s = stationOf(row.station_id);
    const errors = new FieldErrors();
    const end = checkEnd(errors, req.json.end, row.start_minute, s);
    if (end === null || errors.any()) throw errors.error();
    refuseUnlessLive(await liveState(db, row));
    const tailEnd = end + s.cleaningMinutes;
    if (tailEnd > row.tail_end_minute) {
      await claimCells(db, s.id, row.date, spanCells(row.tail_end_minute, tailEnd), row.id);
    } else {
      await releaseCells(db, row.id, tailEnd);
    }
    const updated = await db.query<HoldRow>("UPDATE holds SET end_minute = $2, tail_end_minute = $3 WHERE id = $1 RETURNING *", [row.id, end, tailEnd]);
    return holdJson(updated.rows[0], await balance(db, row.member_id), s);
  });
  return json(200, { hold });
}

export async function releaseHold(req: Request, user: SessionUser): Promise<Reply> {
  await tx(async (db) => {
    const row = await ownHold(db, req.params.id, user);
    refuseUnlessLive(await liveState(db, row));
    await db.query("UPDATE holds SET status = 'released' WHERE id = $1", [row.id]);
    await releaseCells(db, row.id);
  });
  return empty(204);
}

interface SpanTimes {
  id: string;
  member_id: string;
  business_name: string;
  station_id: string;
  start_minute: number;
  end_minute: number;
  tail_end_minute: number;
}

interface HoldSpan extends SpanTimes {
  status: HoldStatus;
  expires_at: Date;
}

interface BookingSpan extends SpanTimes {
  status: BookingStatus;
  payment: Payment;
}

function spanTimes(span: SpanTimes): { id: string; start: string; end: string; tail_end: string } {
  return { id: span.id, start: clock(span.start_minute), end: clock(span.end_minute), tail_end: clock(span.tail_end_minute) };
}

function occupied(span: SpanTimes): Segment {
  return { kind: "occupied", start: clock(span.start_minute), end: clock(span.tail_end_minute) };
}

function operatorExtra(span: SpanTimes, user: SessionUser): { member_id?: string; business_name?: string } {
  return user.role === "operator" ? { member_id: span.member_id, business_name: span.business_name } : {};
}

/** Members see their own holds; crew cooks see only their member's bookings; others are anonymous spans. */
function holdSegment(span: HoldSpan, user: SessionUser): Segment {
  const visible = user.role === "operator" || (user.role === "member" && span.member_id === user.memberId);
  if (!visible) return occupied(span);
  return { kind: "hold", ...spanTimes(span), status: span.status, expires_at: iso(span.expires_at), ...operatorExtra(span, user) };
}

function bookingSegment(span: BookingSpan, user: SessionUser): Segment {
  const visible = user.role === "operator" || span.member_id === user.memberId;
  if (!visible) return occupied(span);
  return { kind: "booking", ...spanTimes(span), status: span.status, payment: span.payment, ...operatorExtra(span, user) };
}

export async function board(req: Request, user: SessionUser): Promise<Reply> {
  const date = req.query.get("date") ?? today();
  if (!isCalendarDate(date)) throw invalid({ date: "invalid" });
  const { holds, bookings } = await tx(async (db) => {
    await expireHolds(db);
    const liveHolds = await db.query<HoldSpan>(
      `SELECT h.id, h.member_id, m.business_name, h.station_id, h.start_minute, h.end_minute, h.tail_end_minute, h.status, h.expires_at
         FROM holds h JOIN members m ON m.id = h.member_id WHERE h.date = $1 AND h.status = 'live'`,
      [date],
    );
    const activeBookings = await db.query<BookingSpan>(
      `SELECT b.id, b.member_id, m.business_name, b.station_id, b.start_minute, b.end_minute, b.tail_end_minute, b.status, b.payment
         FROM bookings b JOIN members m ON m.id = b.member_id
        WHERE b.date = $1 AND b.status NOT IN ('cancelled_free', 'cancelled_with_fee')`,
      [date],
    );
    return { holds: liveHolds.rows, bookings: activeBookings.rows };
  });
  const body: Board = {
    date,
    today: today(),
    now: iso(now()),
    time_zone: timeZone(),
    billing: billingState(),
    stations: stations().map((s) => ({
      id: s.id,
      name: s.name,
      segments: [
        ...holds.filter((span) => span.station_id === s.id).map((span) => ({ at: span.start_minute, segment: holdSegment(span, user) })),
        ...bookings.filter((span) => span.station_id === s.id).map((span) => ({ at: span.start_minute, segment: bookingSegment(span, user) })),
      ]
        .sort((a, b) => a.at - b.at)
        .map((entry) => entry.segment),
    })),
  };
  return json(200, body);
}
