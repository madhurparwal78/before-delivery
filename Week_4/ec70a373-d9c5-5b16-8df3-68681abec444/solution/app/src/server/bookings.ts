// Holds, confirmations, cancellations, weekly series, check-in and no-show.
import { randomInt, randomUUID } from "node:crypto";
import { one, pool, rows, theRow, tx, type Db } from "./db.ts";
import { ApiError } from "./http.ts";
import { now } from "./clock.ts";
import { json, type AuthedCtx, type Reply } from "./router.ts";
import { Fields, idempotencyKey } from "./validate.ts";
import { bookingFor, ownMemberId, siteFor, stationFor, type StationRow } from "./scope.ts";
import { availableQuarters, balances, drawLots, expireLots, liveHoldCount, lockMember, membersWithExpiredHolds, returnLots, writeMovement, type ActorRef } from "./ledger.ts";
import { BOOKING_SELECT, bookingRow, bookingView, projectBooking, type BookingRow } from "./projections.ts";
import { claimKey, completeKey, withKey } from "./idempotency.ts";
import { cancelAction, cancelFields, transition } from "./transitions.ts";
import { uncoveredDates, insuranceValidNow, validThrough } from "./coverage.ts";
import { enqueueMail } from "./outbox.ts";
import { bookingCancelledMail, bookingConfirmedMail, seriesBookedMail, type BookingMailFacts } from "./emails.ts";
import {
  BOOKING_HORIZON_DAYS,
  CHECK_IN_BEFORE_MINUTES,
  NO_SHOW_AFTER_MINUTES,
  HOLD_LIMIT,
  cancellationSplit,
  isClosedForBooking,
  occupiedUntil,
  occupiesStation,
  quartersToHours,
  spansOverlap,
  type Quarters,
} from "../shared/rules.ts";
import { addDays, elapsedQuarters, formatWall, localToUtc, wallClock, weekdayOf, type IsoDate, type WallMinutes } from "../shared/time.ts";
import { config } from "./config.ts";
import type { SessionUser } from "./auth.ts";
import type { BookingStatus } from "../shared/api.ts";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const REFERENCE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function actorOf(user: SessionUser): ActorRef {
  return { userId: user.id, name: user.name, role: user.role === "kitchen_manager" ? "kitchen_manager" : "member" };
}

/** Commits hold and lot expiry for the member before a request is judged, so a refusal never undoes it. */
export async function settle(memberId: string, at: number = now()): Promise<number> {
  await tx((db) => lockMember(db, memberId, at));
  return at;
}

/**
 * Commits every hold past its expiry on a station or at a site, before a response that depends on those holds
 * is made. A claim also runs this after it commits, for a hold that reached its instant while the claim was judged.
 */
export async function settleExpiredHolds(where: { stationId: string } | { siteId: string }, at: number = now()): Promise<number> {
  for (const memberId of await membersWithExpiredHolds(pool, where, at)) await settle(memberId, at);
  return at;
}

/** The second settle of a claim runs after its commit, so its failure must not turn the committed claim into a refusal. */
function settleAfterCommit(stationId: string): Promise<unknown> {
  return settleExpiredHolds({ stationId }).catch((error: unknown) => console.error("expired holds not settled yet:", error));
}

async function newReference(db: Db, tenantId: string): Promise<string> {
  for (;;) {
    const reference = `PL-${Array.from({ length: 6 }, () => REFERENCE_CHARS[randomInt(REFERENCE_CHARS.length)]).join("")}`;
    const taken = await one(db, "SELECT 1 FROM bookings WHERE tenant_id = $1 AND reference = $2", [tenantId, reference]);
    if (!taken) return reference;
  }
}

interface Window {
  date: IsoDate;
  start: WallMinutes;
  end: WallMinutes;
  startAt: number;
  endAt: number;
  occupiedUntil: number;
  quarters: Quarters;
}

/** A window's instants on the station's wall clock, and its occupied span with the sanitation buffer. */
function windowOn(station: StationRow, date: IsoDate, start: WallMinutes, end: WallMinutes): Window {
  const startAt = localToUtc(date, start, station.time_zone);
  const endAt = localToUtc(date, end, station.time_zone);
  return {
    date,
    start,
    end,
    startAt,
    endAt,
    occupiedUntil: occupiedUntil(endAt, station.kind),
    quarters: elapsedQuarters(date, start, end, station.time_zone),
  };
}

/** Whether a new occupied span overlaps any occupied span on the station. */
async function overlaps(db: Db, stationId: string, w: Window, at: number): Promise<boolean> {
  const nearby = await rows<{ status: BookingStatus; hold_expires_at: Date | null; start_at: Date; occupied_until: Date }>(
    db,
    "SELECT status, hold_expires_at, start_at, occupied_until FROM bookings WHERE station_id = $1 AND start_at BETWEEN $2 AND $3",
    [stationId, new Date(w.startAt - 2 * DAY_MS), new Date(w.occupiedUntil)],
  );
  return nearby.some(
    (b) =>
      occupiesStation(b.status, b.hold_expires_at?.getTime() ?? null, at) &&
      spansOverlap(w.startAt, w.occupiedUntil, b.start_at.getTime(), b.occupied_until.getTime()),
  );
}

async function insertBooking(
  db: Db,
  user: SessionUser,
  station: StationRow,
  w: Window,
  status: "held" | "confirmed",
  at: number,
  seriesId: string | null,
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO bookings (id, tenant_id, reference, site_id, station_id, member_id, date, start_minutes, end_minutes,
       start_at, end_at, occupied_until, quarters, status, hold_expires_at, series_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [
      id,
      user.tenantId,
      await newReference(db, user.tenantId),
      station.site_id,
      station.id,
      ownMemberId(user),
      w.date,
      w.start,
      w.end,
      new Date(w.startAt),
      new Date(w.endAt),
      new Date(w.occupiedUntil),
      w.quarters,
      status,
      status === "held" ? new Date(at + config.holdTtlSeconds * 1000) : null,
      seriesId,
      new Date(at),
    ],
  );
  await writeMovement(db, {
    memberId: ownMemberId(user),
    kind: "booking_debit",
    quarters: w.quarters,
    actor: actorOf(user),
    at,
    bookingId: id,
    lots: await drawLots(db, ownMemberId(user), w.quarters),
  });
  return id;
}

async function memberEmail(db: Db, memberId: string): Promise<string> {
  return (await theRow<{ email: string }>(db, "SELECT u.email FROM members m JOIN users u ON u.id = m.user_id WHERE m.id = $1", [memberId])).email;
}

async function mailFacts(db: Db, b: BookingRow): Promise<BookingMailFacts> {
  const site = await theRow<{ name: string }>(db, "SELECT name FROM sites WHERE id = $1", [b.site_id]);
  return {
    to: await memberEmail(db, b.member_id),
    station: b.station_name,
    site: site.name,
    reference: b.reference,
    date: b.date,
    start: b.start_minutes,
    end: b.end_minutes,
    quarters: b.quarters,
  };
}

function siteToday(timeZone: string, at: number): { date: IsoDate; minutes: WallMinutes } {
  return wallClock(at, timeZone);
}

/** Reads a window's date and times, judging the 90-day horizon on the station's site date. */
function readWindow(fields: Fields, station: StationRow | null, dateField: string): { date?: IsoDate; start?: WallMinutes; end?: WallMinutes } {
  const date = fields.date(dateField);
  const start = fields.wall("start");
  const end = fields.wall("end");
  if (start !== undefined && end !== undefined && (start >= end || start === 1440)) fields.fail("end", "End must be after start within one day.");
  if (date !== undefined && station && date > addDays(siteToday(station.time_zone, now()).date, BOOKING_HORIZON_DAYS)) {
    fields.fail(dateField, `Book at most ${BOOKING_HORIZON_DAYS} days ahead.`);
  }
  return { date, start, end };
}

// POST /api/bookings
export async function placeHold(ctx: AuthedCtx): Promise<Reply> {
  const user = ctx.user;
  const fields = new Fields(ctx.body, ["station_id", "date", "start", "end"]);
  const key = idempotencyKey(ctx.req.headers["idempotency-key"], fields);
  const stationId = fields.id("station_id");
  const station = stationId === undefined ? null : await stationFor(pool, user, stationId);
  if (key === undefined) return fields.reject();
  const binding = JSON.stringify(["POST /api/bookings", ...["station_id", "date", "start", "end"].map((f) => fields.raw(f) ?? null)]);
  const claim = await claimKey(user.id, key, binding);
  return withKey(claim, async (claimed) => {
    const { date, start, end } = readWindow(fields, station, "date");
    if (!station || date === undefined || start === undefined || end === undefined) return fields.reject();
    fields.raise();
    const w = windowOn(station, date, start, end);
    if (w.quarters <= 0) throw new ApiError("validation", { fields: { end: "That window does not exist on the site clock." } });
    const memberId = ownMemberId(user);
    const at = await settle(memberId);
    await settleExpiredHolds({ stationId: station.id }, at);
    const reply = await tx(async (db) => {
      await lockMember(db, memberId, at);
      await db.query("SELECT 1 FROM stations WHERE id = $1 FOR UPDATE", [station.id]);
      const today = siteToday(station.time_zone, at);
      const coverage = await validThrough(db, memberId);
      if (uncoveredDates(coverage.certificate_of_insurance, today.date, [date]).length > 0) throw new ApiError("certificate_expired");
      if (isClosedForBooking(date, today.date, today.minutes)) throw new ApiError("cutoff");
      if ((await liveHoldCount(db, memberId, at)) >= HOLD_LIMIT) throw new ApiError("hold_limit");
      if (w.quarters > (await availableQuarters(db, memberId))) throw new ApiError("insufficient_hours");
      if (await overlaps(db, station.id, w, at)) throw new ApiError("slot_taken");
      const id = await insertBooking(db, user, station, w, "held", at, null);
      return completeKey(db, claimed, 201, { booking: await bookingView(db, id), balances: await balances(db, memberId, at) });
    });
    await settleAfterCommit(station.id);
    return reply;
  });
}

// POST /api/bookings/{id}/confirm
export async function confirmHold(ctx: AuthedCtx): Promise<Reply> {
  const found = await bookingFor(pool, ctx.user, ctx.params.id);
  const fields = new Fields(ctx.body, []);
  const at = await settle(found.member_id);
  return tx(async (db) => {
    await lockMember(db, found.member_id, at);
    const b = await bookingRow(db, found.id);
    const next = transition("confirm", b.status);
    fields.raise();
    const tz = await siteZone(db, b.site_id);
    const coverage = await validThrough(db, b.member_id);
    if (uncoveredDates(coverage.certificate_of_insurance, siteToday(tz, at).date, [b.date]).length > 0) throw new ApiError("certificate_expired");
    await db.query("UPDATE bookings SET status = $2 WHERE id = $1", [b.id, next]);
    const after = await balances(db, b.member_id, at);
    await enqueueMail(db, bookingConfirmedMail(await mailFacts(db, b), await availableQuarters(db, b.member_id)));
    return json(200, { booking: await bookingView(db, b.id), balances: after });
  });
}

async function siteZone(db: Db, siteId: string): Promise<string> {
  return (await theRow<{ time_zone: string }>(db, "SELECT time_zone FROM sites WHERE id = $1", [siteId])).time_zone;
}

// POST /api/bookings/{id}/cancel
export async function cancelBooking(ctx: AuthedCtx): Promise<Reply> {
  const user = ctx.user;
  const found = await bookingFor(pool, user, ctx.params.id);
  const fields = new Fields(ctx.body, cancelFields(user.role));
  const at = await settle(found.member_id);
  return tx(async (db) => {
    await lockMember(db, found.member_id, at);
    const b = await bookingRow(db, found.id);
    const action = cancelAction(user.role, b.status);
    const reason = user.role === "kitchen_manager" ? fields.string("reason", "Give a reason the member can act on.", 3, 300) : null;
    fields.raise();
    const split = cancellationSplit(b.status, b.quarters, b.start_at.getTime() - at);
    const actor = actorOf(user);
    if (split.refunded > 0) {
      await writeMovement(db, {
        memberId: b.member_id,
        kind: action === "release" ? "hold_release" : "cancel_refund",
        quarters: split.refunded,
        actor,
        at,
        bookingId: b.id,
        lots: await returnLots(db, b.id, split.refunded),
      });
      await expireLots(db, b.member_id, at);
    }
    if (split.forfeited > 0) {
      await writeMovement(db, { memberId: b.member_id, kind: "forfeit", quarters: split.forfeited, actor, at, bookingId: b.id, lots: [] });
    }
    await db.query(
      `UPDATE bookings SET status = $2, refunded_quarters = $3, forfeited_quarters = $4,
         cancelled_by_id = $5, cancelled_by_name = $6, cancellation_reason = $7 WHERE id = $1`,
      [b.id, transition(action, b.status), split.refunded, split.forfeited, user.id, user.name, reason ?? null],
    );
    if (action === "cancel") {
      await enqueueMail(db, bookingCancelledMail(await mailFacts(db, b), split.refunded, split.forfeited, reason ? { reason } : null));
    }
    const result = {
      booking: await bookingView(db, b.id),
      refunded_hours: quartersToHours(split.refunded),
      forfeited_hours: quartersToHours(split.forfeited),
    };
    return json(200, user.role === "member" ? { ...result, balances: await balances(db, b.member_id, at) } : result);
  });
}

// POST /api/recurring-series
export async function bookSeries(ctx: AuthedCtx): Promise<Reply> {
  const user = ctx.user;
  const memberId = ownMemberId(user);
  const fields = new Fields(ctx.body, ["station_id", "first_date", "start", "end", "weeks"]);
  const stationId = fields.id("station_id");
  const station = stationId === undefined ? null : await stationFor(pool, user, stationId);
  const { date: firstDate, start, end } = readWindow(fields, station, "first_date");
  const weeks = fields.integer("weeks", 2, 12, "Choose 2 to 12 weeks.");
  if (station && firstDate !== undefined && weeks !== undefined && fields.errors.first_date === undefined) {
    const horizon = addDays(siteToday(station.time_zone, now()).date, BOOKING_HORIZON_DAYS);
    if (addDays(firstDate, 7 * (weeks - 1)) > horizon) fields.fail("weeks", `Every week must be at most ${BOOKING_HORIZON_DAYS} days ahead.`);
  }
  if (!station || firstDate === undefined || start === undefined || end === undefined || weeks === undefined) return fields.reject();
  fields.raise();
  const windows = Array.from({ length: weeks }, (_, k) => windowOn(station, addDays(firstDate, 7 * k), start, end));
  if (windows.some((w) => w.quarters <= 0)) throw new ApiError("validation", { fields: { end: "That window does not exist on the site clock." } });
  const at = await settle(memberId);
  await settleExpiredHolds({ stationId: station.id }, at);
  const reply = await tx(async (db) => {
    await lockMember(db, memberId, at);
    await db.query("SELECT 1 FROM stations WHERE id = $1 FOR UPDATE", [station.id]);
    const today = siteToday(station.time_zone, at);
    const coverage = await validThrough(db, memberId);
    const uncovered = uncoveredDates(
      coverage.certificate_of_insurance,
      today.date,
      windows.map((w) => w.date),
    );
    if (uncovered.length > 0) throw new ApiError("certificate_expired", { dates: uncovered });
    if (isClosedForBooking(firstDate, today.date, today.minutes)) throw new ApiError("cutoff");
    const total = windows.reduce((sum, w) => sum + w.quarters, 0);
    if (total > (await availableQuarters(db, memberId))) throw new ApiError("insufficient_hours");
    const conflicts: IsoDate[] = [];
    for (const w of windows) if (await overlaps(db, station.id, w, at)) conflicts.push(w.date);
    if (conflicts.length > 0) throw new ApiError("series_conflict", { dates: conflicts });
    const seriesId = randomUUID();
    const weekday = weekdayOf(firstDate);
    await db.query(
      `INSERT INTO series (id, member_id, station_id, weekday, start_minutes, end_minutes, weeks, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [seriesId, memberId, station.id, weekday, start, end, weeks, new Date(at)],
    );
    const ids: string[] = [];
    for (const w of windows) ids.push(await insertBooking(db, user, station, w, "confirmed", at, seriesId));
    const site = await theRow<{ name: string }>(db, "SELECT name FROM sites WHERE id = $1", [station.site_id]);
    await enqueueMail(
      db,
      seriesBookedMail(user.email, {
        station: station.name,
        site: site.name,
        weekday,
        start,
        end,
        dates: windows.map((w) => w.date),
        totalQuarters: total,
      }),
    );
    const list = await rows<BookingRow>(db, `${BOOKING_SELECT} WHERE b.series_id = $1 ORDER BY b.date`, [seriesId]);
    return json(201, {
      series: { id: seriesId, station_id: station.id, weekday, start: formatWall(start), end: formatWall(end), weeks },
      bookings: list.map(projectBooking),
      balances: await balances(db, memberId, at),
    });
  });
  await settleAfterCommit(station.id);
  return reply;
}

// POST /api/bookings/{id}/check-in
export async function checkIn(ctx: AuthedCtx): Promise<Reply> {
  const user = ctx.user;
  const found = await bookingFor(pool, user, ctx.params.id);
  const fields = new Fields(ctx.body, []);
  const at = await settle(found.member_id);
  return tx(async (db) => {
    await lockMember(db, found.member_id, at);
    const b = await bookingRow(db, found.id);
    const next = transition("check_in", b.status);
    if (at < b.start_at.getTime() - CHECK_IN_BEFORE_MINUTES * MINUTE_MS) throw new ApiError("too_early");
    if (at >= b.end_at.getTime()) throw new ApiError("too_late");
    fields.raise();
    const coverage = await validThrough(db, b.member_id);
    if (!insuranceValidNow(coverage.certificate_of_insurance, siteToday(await siteZone(db, b.site_id), at).date)) {
      throw new ApiError("certificate_expired");
    }
    await db.query("UPDATE bookings SET status = $2, checked_in_at = $3, checked_in_by_id = $4, checked_in_by_name = $5 WHERE id = $1", [
      b.id,
      next,
      new Date(at),
      user.id,
      user.name,
    ]);
    return json(200, { booking: await bookingView(db, b.id) });
  });
}

// POST /api/bookings/{id}/no-show
export async function markNoShow(ctx: AuthedCtx): Promise<Reply> {
  const user = ctx.user;
  const found = await bookingFor(pool, user, ctx.params.id);
  const fields = new Fields(ctx.body, []);
  const at = await settle(found.member_id);
  return tx(async (db) => {
    await lockMember(db, found.member_id, at);
    const b = await bookingRow(db, found.id);
    const next = transition("no_show", b.status);
    if (at < b.start_at.getTime() + NO_SHOW_AFTER_MINUTES * MINUTE_MS) throw new ApiError("too_early");
    fields.raise();
    await writeMovement(db, { memberId: b.member_id, kind: "forfeit", quarters: b.quarters, actor: actorOf(user), at, bookingId: b.id, lots: [] });
    await db.query("UPDATE bookings SET status = $2, no_show_by_id = $3, no_show_by_name = $4 WHERE id = $1", [b.id, next, user.id, user.name]);
    return json(200, { booking: await bookingView(db, b.id) });
  });
}

// GET /api/bookings
export async function listOwnBookings(ctx: AuthedCtx): Promise<Reply> {
  const memberId = ownMemberId(ctx.user);
  await settle(memberId);
  const list = await rows<BookingRow>(pool, `${BOOKING_SELECT} WHERE b.member_id = $1 ORDER BY b.created_at DESC, b.seq DESC`, [memberId]);
  return json(200, { bookings: list.map(projectBooking) });
}

// GET /api/bookings/{id}
export async function getBooking(ctx: AuthedCtx): Promise<Reply> {
  const found = await bookingFor(pool, ctx.user, ctx.params.id);
  await settle(found.member_id);
  return json(200, { booking: projectBooking(await bookingRow(pool, found.id)) });
}

// GET /api/sites/{site_id}/bookings?date=
export async function listSiteBookings(ctx: AuthedCtx): Promise<Reply> {
  const site = await siteFor(pool, ctx.user, ctx.params.site_id);
  const fields = new Fields({ date: ctx.query.get("date") }, ["date"]);
  const date = fields.date("date");
  fields.raise();
  await settleExpiredHolds({ siteId: site.id });
  const list = await rows<BookingRow>(pool, `${BOOKING_SELECT} WHERE b.site_id = $1 AND b.date = $2 ORDER BY b.start_at, b.reference`, [site.id, date]);
  return json(200, { bookings: list.map(projectBooking) });
}
