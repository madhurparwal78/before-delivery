// Bookings: holds (single and weekly series), expiry, confirm, release, cancel, check-in and
// check-out with overage, and the usage sheet.

import { randomUUID } from "node:crypto";
import type { BookingStatus, BookingView, BookingsResponse, CancelResponse, UsageRowView, UsageSheetResponse } from "../../shared/api.js";
import { cancellationOutcome } from "../../shared/cancellation.js";
import { formatCents, formatHours } from "../../shared/hours.js";
import {
  KITCHEN_TIME_ZONE,
  MINUTES_PER_DAY,
  SLOT_MINUTES,
  addDays,
  clockTimeOf,
  daysBetween,
  existingWallClockInstant,
  formatHHMM,
  isIsoDate,
  parseHHMM,
  wallClockInstant,
  zoneAbbreviation,
} from "../../shared/kitchenTime.js";
import { canTransition, isHoldLive, statusAt } from "../../shared/bookingStatus.js";
import { type EndCandidate, MAX_BOOKING_MINUTES, type OccupiedRange, firstCollision, latestLegalEnd } from "../../shared/occupancy.js";
import { priceBetween, seriesDates } from "../../shared/pricing.js";
import { config } from "../config.js";
import { iso, kitchenToday, now } from "../clock.js";
import { type Db, type Tx, isExclusionViolation, only, pool, rows, transaction } from "../db.js";
import type { JsonObject } from "../http/body.js";
import { FieldErrors, fail, invalid } from "../http/errors.js";
import { type Caller, isStaff } from "../http/session.js";
import { BillingUnavailable, KILLBILL_TIMEOUT_MS, deadlineIn, externalCharge } from "../services/killbill.js";
import { billingAccountFor } from "./billing.js";
import { bookingRefusal } from "./compliance.js";
import { documentsOf } from "./documents.js";
import { balancesOf, lockRenterHours, recordMovement } from "./ledger.js";
import { queueNotice } from "./outbox.js";
import { type RenterRow, renterRow } from "./renters.js";
import { settingsInForce } from "./stations.js";

const MINUTE_MS = 60_000;
const MAX_DAYS_AHEAD = 366;
const MAX_WEEKS = 12;
const CUTOFF_DAYS = 2;

interface BookingRow {
  id: string;
  series_id: string;
  week_index: number;
  station_id: string;
  station_name: string;
  renter_id: string;
  status: BookingStatus;
  date: string;
  start_minute: number;
  end_minute: number;
  starts_at: Date;
  ends_at: Date;
  buffer_minutes: number;
  hour_weight: number;
  off_peak_percent: number;
  overage_cents_per_hour: number;
  minutes_debited: number;
  hold_expires_at: Date;
  cancellation_cutoff_at: Date;
  actual_start: number | null;
  actual_end: number | null;
  overage_units: number | null;
  overage_cents: number | null;
  created_at: Date;
}

const BOOKING_SQL = "SELECT b.*, s.name AS station_name FROM bookings b JOIN stations s ON s.id = b.station_id";

/** The status a read reports at `at` (an expired hold reads expired before its expiry is recorded). */
export function effectiveStatus(row: Pick<BookingRow, "status" | "hold_expires_at">, at: number = now()): BookingStatus {
  return statusAt(row.status, row.hold_expires_at.getTime(), at);
}

/** A transition the state machine does not allow answers 409 invalid_transition. */
function assertTransition(row: BookingRow, to: BookingStatus, at: number): void {
  const from = effectiveStatus(row, at);
  if (!canTransition(from, to)) throw fail(409, "invalid_transition", { from, to });
}

function bufferEnd(row: BookingRow): number {
  return row.ends_at.getTime() + row.buffer_minutes * MINUTE_MS;
}

function bookingView(row: BookingRow, at: number = now()): BookingView {
  return {
    id: row.id,
    series_id: row.series_id,
    station_id: row.station_id,
    station_name: row.station_name,
    renter_id: row.renter_id,
    status: effectiveStatus(row, at),
    date: row.date,
    start: formatHHMM(row.start_minute),
    end: formatHHMM(row.end_minute),
    starts_at: iso(row.starts_at),
    ends_at: iso(row.ends_at),
    buffer_minutes: row.buffer_minutes,
    buffer_ends_at: iso(bufferEnd(row)),
    hour_weight: row.hour_weight,
    off_peak_percent: row.off_peak_percent,
    overage_usd_per_hour: formatCents(row.overage_cents_per_hour),
    minutes_debited: row.minutes_debited,
    hold_expires_at: iso(row.hold_expires_at),
    cancellation_cutoff_at: iso(row.cancellation_cutoff_at),
    actual_start: row.actual_start === null ? null : formatHHMM(row.actual_start),
    actual_end: row.actual_end === null ? null : formatHHMM(row.actual_end),
    overage_units: row.overage_units,
    overage_usd: row.overage_cents === null ? null : formatCents(row.overage_cents),
    created_at: iso(row.created_at),
  };
}

/** The same kitchen wall-clock time two calendar days before the booking's date. */
function cancellationCutoff(date: string, startMinute: number): number {
  return existingWallClockInstant(addDays(date, -CUTOFF_DAYS), startMinute);
}

function nonexistent(date: string): string {
  return `That time does not exist on ${date} in the kitchen's time zone.`;
}

interface Week {
  date: string;
  startsAt: number;
  endsAt: number;
}

interface BookingRequest {
  stationId: string;
  start: number;
  end: number;
  weeks: Week[];
}

async function parseBookingRequest(body: JsonObject): Promise<BookingRequest> {
  const errors = new FieldErrors();
  const stationId = typeof body.station_id === "string" ? body.station_id : "";
  const known = stationId ? await rows(pool, "SELECT 1 FROM stations WHERE id = $1", [stationId]) : [];
  if (!known.length) errors.add("station_id", "Choose one of the kitchen's stations.");
  const date = typeof body.date === "string" ? body.date : "";
  const today = kitchenToday();
  if (!isIsoDate(date)) errors.add("date", "Use a date like 2026-11-07.");
  else if (daysBetween(today, date) > MAX_DAYS_AHEAD) errors.add("date", "Book no more than 366 days ahead.");
  const start = typeof body.start === "string" ? parseHHMM(body.start) : null;
  const end = typeof body.end === "string" ? parseHHMM(body.end) : null;
  if (start === null || start >= MINUTES_PER_DAY) errors.add("start", "Use a start time on a 15-minute mark, 00:00 to 23:45.");
  if (end === null || end === 0) errors.add("end", "Use an end time on a 15-minute mark, 00:15 to 24:00.");
  else if (start !== null && end <= start) errors.add("end", "The end must be after the start.");
  else if (start !== null && end - start > MAX_BOOKING_MINUTES) errors.add("end", "Six hours is the longest booking.");
  const repeat = body.repeat_weeks ?? 1;
  if (typeof repeat !== "number" || !Number.isInteger(repeat) || repeat < 1 || repeat > MAX_WEEKS) {
    errors.add("repeat_weeks", "Repeat for 1 to 12 weeks.");
  }
  if (!errors.empty || start === null || end === null || typeof repeat !== "number") throw errors.error();

  const weeks: Week[] = [];
  for (const day of seriesDates(date, repeat)) {
    const startsAt = wallClockInstant(day, start);
    const endsAt = wallClockInstant(day, end);
    if (startsAt === null) errors.add("start", nonexistent(day));
    if (endsAt === null) errors.add("end", nonexistent(day));
    if (daysBetween(today, day) > MAX_DAYS_AHEAD) errors.add("repeat_weeks", "Every week must fall within 366 days.");
    if (startsAt !== null && endsAt !== null) weeks.push({ date: day, startsAt, endsAt });
  }
  if (weeks[0] && weeks[0].startsAt <= now()) errors.add("start", "Pick a start after the current time.");
  errors.throwIfAny();
  return { stationId, start, end, weeks };
}

interface OccupancyRow {
  kind: "booking" | "maintenance";
  starts_at: Date;
  ends_at: Date;
  occupied_end: Date;
}

/** The station's occupied ranges overlapping [from, to). */
export async function occupiedRanges(db: Db, stationId: string, from: number, to: number): Promise<OccupiedRange[]> {
  const found = await rows<OccupancyRow>(
    db,
    `SELECT CASE WHEN o.booking_id IS NULL THEN 'maintenance' ELSE 'booking' END AS kind,
            COALESCE(b.starts_at, m.starts_at) AS starts_at, COALESCE(b.ends_at, m.ends_at) AS ends_at,
            upper(o.occupied) AS occupied_end
       FROM station_occupancy o
       LEFT JOIN bookings b ON b.id = o.booking_id
       LEFT JOIN maintenance_blocks m ON m.id = o.maintenance_block_id
      WHERE o.station_id = $1 AND o.occupied && tstzrange($2, $3)`,
    [stationId, iso(from), iso(to)],
  );
  return found.map((row) => ({
    kind: row.kind,
    start: row.starts_at.getTime(),
    end: row.ends_at.getTime(),
    occupiedEnd: row.occupied_end.getTime(),
  }));
}

/** The 15-minute ends after `start` up to `end` on `date`, with where each one's occupied span stops. */
function endCandidates(date: string, start: number, end: number, bufferMinutes: number): EndCandidate<number>[] {
  const candidates: EndCandidate<number>[] = [];
  for (let minute = start + SLOT_MINUTES; minute <= end; minute += SLOT_MINUTES) {
    const at = wallClockInstant(date, minute);
    if (at !== null) candidates.push({ end: minute, occupiedEnd: at + bufferMinutes * MINUTE_MS });
  }
  return candidates;
}

async function bookingRows(db: Db, where: string, params: unknown[]): Promise<BookingRow[]> {
  return rows<BookingRow>(db, `${BOOKING_SQL} WHERE ${where} ORDER BY b.starts_at, b.week_index`, params);
}

async function seriesRows(tx: Tx, seriesId: string): Promise<BookingRow[]> {
  return rows<BookingRow>(tx, `${BOOKING_SQL} WHERE b.series_id = $1 ORDER BY b.week_index FOR UPDATE OF b`, [seriesId]);
}

/** Frees a booking's occupied time. */
export async function freeOccupancy(tx: Tx, bookingId: string): Promise<void> {
  await tx.query("DELETE FROM station_occupancy WHERE booking_id = $1", [bookingId]);
}

export function timesLine(row: BookingRow): string {
  return `${row.date} ${formatHHMM(row.start_minute)}–${formatHHMM(row.end_minute)} ${zoneAbbreviation(row.starts_at.getTime())}`;
}

/** Records the expiry of a series whose hold instant has passed: hours back, one hold-expired email. */
async function expireSeries(tx: Tx, seriesId: string): Promise<void> {
  const series = (await seriesRows(tx, seriesId)).filter((row) => row.status === "hold" && effectiveStatus(row) === "expired");
  const [first] = series;
  if (!first) return;
  await lockRenterHours(tx, first.renter_id);
  for (const row of series) {
    await tx.query("UPDATE bookings SET status = 'expired' WHERE id = $1", [row.id]);
    await freeOccupancy(tx, row.id);
    await recordMovement(tx, row.renter_id, "hold_release", row.minutes_debited, { bookingId: row.id });
  }
  const renter = await renterRow(tx, first.renter_id);
  const minutes = series.reduce((sum, row) => sum + row.minutes_debited, 0);
  await queueNotice(tx, {
    kind: "hold_expired",
    to: renter.email,
    subject: `Your hold on ${first.station_name} has expired`,
    body: [
      `Your hold on ${first.station_name} ran out before it was confirmed, and the time was released.`,
      "",
      ...series.map(timesLine),
      "",
      `${formatHours(minutes)} hours returned to your balance.`,
    ].join("\n"),
    dedupeKey: `hold_expired:${seriesId}`,
  });
}

/** Records every due expiry, optionally only on one station. Runs each second and before a new claim. */
export async function expireDueHolds(stationId?: string): Promise<void> {
  const holds = await rows<Pick<BookingRow, "series_id" | "status" | "hold_expires_at">>(
    pool,
    `SELECT series_id, status, hold_expires_at FROM bookings WHERE status = 'hold' ${stationId ? "AND station_id = $1" : ""}`,
    stationId ? [stationId] : [],
  );
  const at = now();
  const due = new Set(holds.filter((hold) => effectiveStatus(hold, at) === "expired").map((hold) => hold.series_id));
  for (const seriesId of due) await transaction((tx) => expireSeries(tx, seriesId));
}

export async function createBookings(caller: Caller & { renterId: string }, body: JsonObject): Promise<BookingsResponse> {
  const renter = await renterRow(pool, caller.renterId);
  const refusal = bookingRefusal(renter.status, await documentsOf(pool, renter.id), kitchenToday());
  if (refusal) throw fail(409, refusal);
  const request = await parseBookingRequest(body);
  await expireDueHolds(request.stationId);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await transaction((tx) => placeHold(tx, renter, request));
    } catch (error) {
      if (!isExclusionViolation(error) || attempt >= 3) throw error;
    }
  }
}

/** Places the hold for every week, or nothing. The occupancy constraint decides concurrent claims. */
async function placeHold(tx: Tx, renter: RenterRow, request: BookingRequest): Promise<BookingsResponse> {
  await lockRenterHours(tx, renter.id);
  const at = now();
  const settings = await settingsInForce(tx, request.stationId, kitchenToday(at));
  const buffer = settings.buffer_minutes * MINUTE_MS;
  const span = request.weeks.reduce((range, week) => ({ from: Math.min(range.from, week.startsAt), to: Math.max(range.to, week.endsAt + buffer) }), {
    from: Number.POSITIVE_INFINITY,
    to: Number.NEGATIVE_INFINITY,
  });
  const ranges = await occupiedRanges(tx, request.stationId, span.from, span.to);
  for (const week of request.weeks) {
    const collision = firstCollision(ranges, week.startsAt, week.endsAt + buffer);
    if (!collision) continue;
    const legal = latestLegalEnd(ranges, week.startsAt, endCandidates(week.date, request.start, request.end, settings.buffer_minutes));
    throw fail(409, "slot_conflict", {
      date: week.date,
      legal_end: legal === null ? null : formatHHMM(legal),
      blocked_by: collision.blockedBy,
      blocked_at: clockTimeOf(collision.range.start),
    });
  }
  const priced = request.weeks.map((week) => ({ ...week, price: priceBetween(week.startsAt, week.endsAt, settings) }));
  const needed = priced.reduce((sum, week) => sum + week.price, 0);
  const { balance_minutes } = await balancesOf(tx, renter.id);
  if (needed > balance_minutes) throw fail(409, "insufficient_hours", { balance_minutes, needed_minutes: needed });

  const seriesId = randomUUID();
  const holdExpiresAt = iso(at + config.holdTtlSeconds * 1000);
  for (const [index, week] of priced.entries()) {
    const id = randomUUID();
    const price = week.price;
    await tx.query(
      `INSERT INTO bookings (id, series_id, week_index, station_id, renter_id, status, date, start_minute, end_minute,
         starts_at, ends_at, buffer_minutes, hour_weight, off_peak_percent, overage_cents_per_hour, minutes_debited,
         hold_expires_at, cancellation_cutoff_at, created_at)
       VALUES ($1, $2, $3, $4, $5, 'hold', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        id, seriesId, index, request.stationId, renter.id, week.date, request.start, request.end,
        iso(week.startsAt), iso(week.endsAt), settings.buffer_minutes, settings.hour_weight, settings.off_peak_percent,
        settings.overage_cents_per_hour, price, holdExpiresAt, iso(cancellationCutoff(week.date, request.start)), iso(at),
      ],
    );
    await tx.query("INSERT INTO station_occupancy (station_id, occupied, booking_id) VALUES ($1, tstzrange($2, $3), $4)", [
      request.stationId,
      iso(week.startsAt),
      iso(week.endsAt + buffer),
      id,
    ]);
    await recordMovement(tx, renter.id, "booking_hold", price, { bookingId: id });
  }
  return { server_now: iso(at), bookings: (await seriesRows(tx, seriesId)).map((row) => bookingView(row, at)) };
}

const STATUS_FILTERS: readonly BookingStatus[] = ["hold", "confirmed", "checked_in", "completed", "expired", "cancelled", "displaced"];

export async function listBookings(caller: Caller, query: URLSearchParams): Promise<BookingsResponse> {
  const errors = new FieldErrors();
  const date = query.get("date");
  const status = query.get("status");
  if (date !== null && !isIsoDate(date)) errors.add("date", "Use a date like 2026-11-07.");
  if (status !== null && !STATUS_FILTERS.some((s) => s === status)) errors.add("status", "Unknown booking status.");
  errors.throwIfAny();
  const at = now();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (!isStaff(caller)) {
    params.push(caller.renterId);
    conditions.push(`b.renter_id = $${params.length}`);
  }
  if (date !== null) {
    params.push(date);
    conditions.push(`b.date = $${params.length}`);
  }
  const found = await bookingRows(pool, conditions.length ? conditions.join(" AND ") : "true", params);
  const views = found.map((row) => bookingView(row, at)).filter((view) => status === null || view.status === status);
  return { server_now: iso(at), bookings: views };
}

export async function getBooking(bookingId: string): Promise<{ server_now: string; booking: BookingView }> {
  const at = now();
  const row = await only<BookingRow>(pool, `${BOOKING_SQL} WHERE b.id = $1`, [bookingId]);
  return { server_now: iso(at), booking: bookingView(row, at) };
}

/** The target of confirm or release: a hold whose instant has passed answers hold_expired, recorded or not. */
function assertLiveHold(row: BookingRow, to: BookingStatus, at: number): void {
  if ((row.status === "hold" || row.status === "expired") && !isHoldLive(row.hold_expires_at.getTime(), at)) throw fail(409, "hold_expired");
  assertTransition(row, to, at);
}

async function lockedBooking(tx: Tx, bookingId: string): Promise<BookingRow> {
  return only<BookingRow>(tx, `${BOOKING_SQL} WHERE b.id = $1 FOR UPDATE OF b`, [bookingId]);
}

async function targetSeries(tx: Tx, bookingId: string): Promise<{ target: BookingRow; series: BookingRow[] }> {
  const target = await lockedBooking(tx, bookingId);
  return { target, series: await seriesRows(tx, target.series_id) };
}

export async function confirmHold(bookingId: string): Promise<BookingsResponse> {
  return transaction(async (tx) => {
    const at = now();
    const { target, series } = await targetSeries(tx, bookingId);
    assertLiveHold(target, "confirmed", at);
    const held = series.filter((row) => row.status === "hold");
    await tx.query("UPDATE bookings SET status = 'confirmed' WHERE series_id = $1 AND status = 'hold'", [target.series_id]);
    const renter = await renterRow(tx, target.renter_id);
    const first = held.reduce((earliest, row) => (row.week_index < earliest.week_index ? row : earliest), target);
    const last = held.reduce((latest, row) => (row.week_index > latest.week_index ? row : latest), target);
    await queueNotice(tx, {
      kind: "booking_confirmed",
      to: renter.email,
      subject: `Booking confirmed: ${target.station_name} on ${first.date}`,
      body: [
        `Your booking at Brigade & Bench Commissary is confirmed.`,
        "",
        `Station: ${target.station_name}`,
        ...held.map(timesLine),
        `Sanitation buffer: ${target.buffer_minutes} minutes, until ${clockTimeOf(bufferEnd(last))}`,
        "",
        `${formatHours(held.reduce((sum, row) => sum + row.minutes_debited, 0))} hours debited from your balance.`,
      ].join("\n"),
    });
    return { server_now: iso(at), bookings: (await seriesRows(tx, target.series_id)).map((row) => bookingView(row, at)) };
  });
}

export async function releaseHold(bookingId: string): Promise<BookingsResponse> {
  return transaction(async (tx) => {
    const at = now();
    const { target, series } = await targetSeries(tx, bookingId);
    assertLiveHold(target, "expired", at);
    await lockRenterHours(tx, target.renter_id);
    for (const row of series.filter((r) => r.status === "hold")) {
      await tx.query("UPDATE bookings SET status = 'expired' WHERE id = $1", [row.id]);
      await freeOccupancy(tx, row.id);
      await recordMovement(tx, row.renter_id, "hold_release", row.minutes_debited, { bookingId: row.id });
    }
    return { server_now: iso(at), bookings: (await seriesRows(tx, target.series_id)).map((row) => bookingView(row, at)) };
  });
}

export async function cancelBooking(bookingId: string): Promise<CancelResponse> {
  return transaction(async (tx) => {
    const at = now();
    const row = await lockedBooking(tx, bookingId);
    assertTransition(row, "cancelled", at);
    const outcome = cancellationOutcome(row.cancellation_cutoff_at.getTime(), at);
    await lockRenterHours(tx, row.renter_id);
    await tx.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [row.id]);
    await freeOccupancy(tx, row.id);
    await recordMovement(tx, row.renter_id, outcome === "credited" ? "cancellation_credit" : "cancellation_forfeit", row.minutes_debited, {
      bookingId: row.id,
    });
    return { booking: bookingView(await lockedBooking(tx, row.id), at), outcome, minutes: row.minutes_debited };
  });
}

function clockField(body: JsonObject, field: string, latest: number): number {
  const value = typeof body[field] === "string" ? parseHHMM(body[field]) : null;
  if (value === null || value > latest) throw invalid({ [field]: "Use a time on a 15-minute mark, like 14:00." });
  return value;
}

export async function checkIn(bookingId: string, body: JsonObject): Promise<{ booking: BookingView }> {
  return transaction(async (tx) => {
    const row = await lockedBooking(tx, bookingId);
    assertTransition(row, "checked_in", now());
    const actualStart = clockField(body, "actual_start", MINUTES_PER_DAY - SLOT_MINUTES);
    await tx.query("UPDATE bookings SET status = 'checked_in', actual_start = $2 WHERE id = $1", [row.id, actualStart]);
    return { booking: bookingView(await lockedBooking(tx, row.id)) };
  });
}

interface Overage {
  units: number;
  cents: number;
}

/** Overage from elapsed time past the booked end, in whole 15-minute units at the booking's own rate. */
function overageOf(row: BookingRow, actualEnd: number): Overage {
  const endedAt = existingWallClockInstant(row.date, actualEnd);
  const over = (endedAt - row.ends_at.getTime()) / MINUTE_MS;
  const units = over > 0 ? Math.ceil(over / SLOT_MINUTES) : 0;
  return { units, cents: Math.floor((units * row.overage_cents_per_hour + 2) / 4) };
}

export async function checkOut(bookingId: string, body: JsonObject): Promise<{ booking: BookingView }> {
  return transaction(async (tx) => {
    const row = await lockedBooking(tx, bookingId);
    assertTransition(row, "completed", now());
    const actualEnd = clockField(body, "actual_end", MINUTES_PER_DAY);
    if (row.actual_start !== null && actualEnd <= row.actual_start) throw invalid({ actual_end: "The end must be after the recorded start." });
    const overage = overageOf(row, actualEnd);
    if (overage.units > 0) {
      const renter = await renterRow(tx, row.renter_id);
      const deadline = deadlineIn(KILLBILL_TIMEOUT_MS);
      try {
        const accountId = await billingAccountFor(tx, renter, deadline);
        await externalCharge(accountId, formatCents(overage.cents), `Overage: ${row.station_name} ${row.date}, ${overage.units} × 15 min`, deadline);
      } catch (error) {
        if (error instanceof BillingUnavailable) throw fail(503, "billing_unavailable");
        throw error;
      }
    }
    await tx.query("UPDATE bookings SET status = 'completed', actual_end = $2, overage_units = $3, overage_cents = $4 WHERE id = $1", [
      row.id,
      actualEnd,
      overage.units,
      overage.cents,
    ]);
    await lockRenterHours(tx, row.renter_id);
    await recordMovement(tx, row.renter_id, "checkout", row.minutes_debited, { bookingId: row.id });
    return { booking: bookingView(await lockedBooking(tx, row.id)) };
  });
}

/** The usage sheet lists confirmed, checked-in and completed bookings of the day. */
const USAGE_SHEET_STATUSES = ["confirmed", "checked_in", "completed"] as const;

interface UsageRow extends Omit<BookingRow, "status"> {
  status: (typeof USAGE_SHEET_STATUSES)[number];
  business_name: string;
}

export async function usageSheet(requested: string | null): Promise<UsageSheetResponse> {
  if (requested !== null && !isIsoDate(requested)) throw invalid({ date: "Use a date like 2026-11-07." });
  const at = now();
  const date = requested ?? kitchenToday(at);
  const found = await rows<UsageRow>(
    pool,
    `SELECT b.*, s.name AS station_name, r.business_name FROM bookings b
       JOIN stations s ON s.id = b.station_id JOIN renters r ON r.id = b.renter_id
      WHERE b.date = $1 AND b.status = ANY($2)
      ORDER BY b.start_minute, s.name`,
    [date, USAGE_SHEET_STATUSES],
  );
  return {
    date,
    time_zone: KITCHEN_TIME_ZONE,
    server_now: iso(at),
    rows: found.map(
      (row): UsageRowView => ({
        booking_id: row.id,
        station_name: row.station_name,
        renter_business_name: row.business_name,
        start: formatHHMM(row.start_minute),
        end: formatHHMM(row.end_minute),
        actual_start: row.actual_start === null ? null : formatHHMM(row.actual_start),
        actual_end: row.actual_end === null ? null : formatHHMM(row.actual_end),
        status: row.status,
        overage_units: row.overage_units,
        overage_usd: row.overage_cents === null ? null : formatCents(row.overage_cents),
      }),
    ),
  };
}

/** Bookings occupying the station's [from, to): the candidates a maintenance block displaces or refuses. */
export async function bookingsOverlapping(tx: Tx, stationId: string, from: number, to: number): Promise<BookingRow[]> {
  return rows<BookingRow>(
    tx,
    `SELECT b.*, s.name AS station_name FROM station_occupancy o
       JOIN bookings b ON b.id = o.booking_id JOIN stations s ON s.id = b.station_id
      WHERE o.station_id = $1 AND o.occupied && tstzrange($2, $3)
      ORDER BY b.renter_id, b.starts_at FOR UPDATE OF b`,
    [stationId, iso(from), iso(to)],
  );
}

