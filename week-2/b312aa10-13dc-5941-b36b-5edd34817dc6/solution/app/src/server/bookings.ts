// Holds, confirmations, cancellations, moves, line operations and out-of-service windows.
//
// Every booking action follows the brief's precedence: unknown resource (404), role (403), an
// idempotent replay, request-only validation (422), then the state checks in their fixed order
// inside one transaction. Locks are always taken in the same order: the months touched (shared,
// against a close), the stations touched, the member's months whose hours change, then the rows.

import { randomBytes } from "node:crypto";
import type pg from "pg";
import { lockKey, lockMonths, pool, tx, type Db } from "./db.js";
import { ApiError, variantError, forbidden, invalid, notFound, refuseInvalid, route, type Ctx, type Reply } from "./http.js";
import { BODIES, bodyObject, keyErrors, refuseAnyKey } from "./bodies.js";
import { boundedText } from "./text.js";
import type { Session } from "./auth.js";
import { config } from "./config.js";
import { applyDueLapses, cancelHoldsUnder, graceInstant, transition } from "./states.js";
import { hourBank, hoursShortfall, postItem, type ItemSubject } from "./ledger.js";
import { queueMail } from "./mail.js";
import { deliverBilling } from "./billing.js";
import { idempotent } from "./idempotency.js";
import { checkInDocumentProblem, documentProblem } from "./documents.js";
import { kitchenRules, monthParam, rateVersions, stationById, todayOf, type StationRow } from "./kitchen.js";
import { ACTION_ROLES, OCCUPYING, offeredActions, endMinutes, lateFeeCents, priceHourly, priceShelf, rateFor, type HourlyRate, type ManualAction, type ShelfRate, type Status, type TransitionState } from "../shared/rules.js";
import { blockLabel, hoursText, money } from "../shared/format.js";
import {
  addDays, addMonths, isEndTime, isLocalDate, isLocalTime, isoWithOffset, localDateOf, minutesOf, monthName, monthOf, startOfDay, zonedEndInstant, zonedInstant,
  type LocalDate, type Month,
} from "../shared/time.js";

const DAY_MS = 86_400_000;
const BOOK_AHEAD_DAYS = 180;

export interface BookingRow {
  id: string; kitchen_id: string; member_id: string; station_id: string; series_id: string | null;
  local_date: LocalDate; local_start: string | null; local_end: string | null; days: number | null;
  start_at: Date; end_at: Date; status: Status; quarters: number; peak_quarters: number; charge_cents: number;
  penalty_cents: number; penalty_waived: boolean; conflict: boolean; notes: string;
  hold_expires_at: Date | null; confirmed_at: Date | null; version: number;
  business_name: string; email: string; station_name: string; kind: "hourly" | "shelf"; pending: boolean;
}

export const BOOKING_SQL = `
  SELECT b.*, m.business_name, m.email, s.name AS station_name, s.kind,
    EXISTS (SELECT 1 FROM billing_items i WHERE i.booking_id = b.id AND i.recorded_at IS NULL) AS pending
  FROM bookings b JOIN members m ON m.id = b.member_id JOIN stations s ON s.id = b.station_id`;

/**
 * Which bookings a booking list shows: every booking that ever reached `confirmed`, plus holds
 * until they lapse (lapses already applied). A released hold is never listed.
 */
const LISTED_SQL = "(b.confirmed_at IS NOT NULL OR b.status = 'held')";

const labelOf = (b: BookingRow): string =>
  blockLabel({ stationName: b.station_name, localDate: b.local_date, localStart: b.local_start, localEnd: b.local_end, days: b.days });

const monthOfBooking = (b: Pick<BookingRow, "local_date">): Month => monthOf(b.local_date);

/** not_billed for held and expired bookings; then billed once Kill Bill has recorded every item for the booking. */
export const billingStatusOf = (b: Pick<BookingRow, "confirmed_at" | "pending">): string =>
  b.confirmed_at === null ? "not_billed" : b.pending ? "pending_billing" : "billed";

/** Who reads a booking and at which instant: the caller's session, the response instant and the closed months. */
interface View { s: Session; nowMs: number; closed: ReadonlySet<Month> }

/** The caller's view at an instant (taken before any lapse is applied, so lapses due by then are already applied). */
async function viewFor(db: Db, s: Session, nowMs = Date.now()): Promise<View> {
  const { rows } = await db.query("SELECT month FROM closed_months WHERE kitchen_id = $1", [s.kitchen.id]);
  return { s, nowMs, closed: new Set(rows.map((r) => r.month as Month)) };
}

function bookingJson(b: BookingRow, v: View): Record<string, unknown> {
  const zone = v.s.kitchen.timeZone;
  const owner = v.s.person.memberId !== null && v.s.person.memberId === b.member_id;
  const actions = offeredActions(stateOf(b), v.s.person.role, owner, v.nowMs, v.closed.has(monthOfBooking(b)));
  return {
    id: b.id, memberId: b.member_id, businessName: b.business_name, stationId: b.station_id, stationName: b.station_name,
    kind: b.kind, localDate: b.local_date, localStart: b.local_start, localEnd: b.local_end, days: b.days,
    start: isoWithOffset(b.start_at.getTime(), zone), end: isoWithOffset(b.end_at.getTime(), zone),
    status: b.status, billingStatus: billingStatusOf(b),
    hours: b.quarters / 4, peakHours: b.peak_quarters / 4, chargeCents: b.charge_cents, penaltyCents: b.penalty_cents,
    penaltyWaived: b.penalty_waived, conflict: b.conflict, seriesId: b.series_id, notes: b.notes,
    holdExpiresAt: b.hold_expires_at ? isoWithOffset(b.hold_expires_at.getTime(), zone) : null,
    confirmedAt: b.confirmed_at ? isoWithOffset(b.confirmed_at.getTime(), zone) : null, actions, version: b.version,
  };
}

/** Another member's block as a member sees it on the board. */
function bookedJson(b: BookingRow, zone: string): Record<string, unknown> {
  return {
    id: b.id, stationId: b.station_id, localDate: b.local_date, localStart: b.local_start, localEnd: b.local_end, days: b.days,
    start: isoWithOffset(b.start_at.getTime(), zone), end: isoWithOffset(b.end_at.getTime(), zone), status: "booked",
  };
}

async function loadBookings(db: Db, where: string, args: unknown[], order = "b.start_at, b.id"): Promise<BookingRow[]> {
  const { rows } = await db.query(`${BOOKING_SQL} WHERE ${where} ORDER BY ${order}`, args);
  return rows as BookingRow[];
}

async function loadOne(db: Db, id: string): Promise<BookingRow> {
  return (await loadBookings(db, "b.id = $1", [id]))[0]!;
}

/** A booking this session may reach: its kitchen, and for members only their own. */
async function reachable(db: Db, s: Session, id: string): Promise<BookingRow> {
  const [b] = await loadBookings(db, "b.id = $1 AND b.kitchen_id = $2", [id, s.kitchen.id]);
  if (!b || (s.person.role === "member" && b.member_id !== s.person.memberId)) throw notFound();
  return b;
}

function requireRole(s: Session, action: ManualAction): void {
  if (!ACTION_ROLES[action].includes(s.person.role)) throw forbidden();
}

const stateOf = (b: BookingRow): TransitionState => ({
  status: b.status, startMs: b.start_at.getTime(), conflict: b.conflict, penaltyWaived: b.penalty_waived,
  graceMs: graceInstant(b.start_at.getTime(), b.confirmed_at?.getTime() ?? null),
});

const subjectOf = (b: BookingRow): ItemSubject => ({ kitchenId: b.kitchen_id, memberId: b.member_id, bookingId: b.id });

async function assertOpen(db: Db, kitchenId: string, months: Month[], current?: Record<string, unknown>): Promise<void> {
  const { rows } = await db.query("SELECT month FROM closed_months WHERE kitchen_id = $1 AND month = ANY($2) ORDER BY month", [kitchenId, months]);
  if (rows[0]) throw variantError(409, "month_closed", [monthName(rows[0].month)], current ? { current } : {});
}

/** Locks the booking rows (after the month, station and hour keys) and applies any lapse already due. */
async function lockRows(client: pg.PoolClient, ids: string[]): Promise<void> {
  await client.query("SELECT 1 FROM bookings WHERE id = ANY($1) ORDER BY id FOR UPDATE", [ids]);
  await applyDueLapses(client, null, ids);
}

const hourKey = (memberId: string, month: Month): string => `hours:${memberId}:${month}`;

async function lockHours(client: pg.PoolClient, memberId: string, months: Iterable<Month>): Promise<void> {
  for (const month of [...new Set(months)].sort()) await lockKey(client, hourKey(memberId, month));
}

// ---------------------------------------------------------------- blocks

interface Block {
  localDate: LocalDate; localStart: string | null; localEnd: string | null; days: number | null;
  startMs: number; endMs: number; quarters: number;
}

const blockMonth = (b: Block): Month => monthOf(b.localDate);
const blockOf = (b: BookingRow): Block => ({
  localDate: b.local_date, localStart: b.local_start, localEnd: b.local_end, days: b.days,
  startMs: b.start_at.getTime(), endMs: b.end_at.getTime(), quarters: b.quarters,
});
const lastDay = (b: Block): LocalDate => (b.days === null ? b.localDate : addDays(b.localDate, b.days - 1));

/**
 * Turns a request into the blocks it asks for (one per week), applying every hold rule that reads
 * only the request and the clock. Field errors are added to `errors`.
 */
function planBlocks(s: Session, station: StationRow, body: Record<string, unknown>, weeks: number, errors: Record<string, string>): Block[] {
  const zone = s.kitchen.timeZone;
  const now = Date.now();
  if (!errors.date && !isLocalDate(body.date)) errors.date = "Use a date in the form YYYY-MM-DD.";
  const first = ((): Omit<Block, "startMs" | "endMs" | "localDate"> | null => {
    if (station.kind === "shelf") {
      const days = body.days;
      if (errors.days) return null;
      if (!Number.isInteger(days) || (days as number) < 1 || (days as number) > 31) {
        errors.days = "Shelf bookings run 1 to 31 days.";
        return null;
      }
      return { localStart: null, localEnd: null, days: days as number, quarters: 0 };
    }
    const { start, end } = body;
    if (errors.start || errors.end) return null;
    const onQuarter = (t: unknown): t is string => isLocalTime(t) && minutesOf(t) % 15 === 0;
    const onQuarterEnd = (t: unknown): t is string => isEndTime(t) && endMinutes(t) % 15 === 0;
    if (!onQuarter(start)) errors.start = "Times must fall on the quarter hour.";
    if (!onQuarterEnd(end)) errors.end = "Times must fall on the quarter hour.";
    if (!onQuarter(start) || !onQuarterEnd(end)) return null;
    // The whole-block rows: on one key, the row listed first in the brief gives the message.
    const length = endMinutes(end) - minutesOf(start);
    if (length <= 0) errors.end = "End must be after start on the same day.";
    else if (length < 60) errors.end = "A block must be at least 1 hour.";
    else if (length > 720) errors.end = "A block can be at most 12 hours.";
    return { localStart: start, localEnd: end, days: null, quarters: Math.max(0, length) / 15 };
  })();
  if (!first || errors.date) return [];
  // Already ended goes under `end` for hourly blocks and `date` for shelves; 180 days ahead under `date`.
  const endedKey = first.days === null ? "end" : "date";
  const blocks: Block[] = [];
  for (let w = 0; w < weeks; w++) {
    const localDate = addDays(body.date as LocalDate, 7 * w);
    let startMs: number;
    let endMs: number;
    if (first.days !== null) {
      startMs = startOfDay(localDate, zone);
      endMs = startOfDay(addDays(localDate, first.days), zone);
    } else {
      const startAt = zonedInstant(localDate, first.localStart!, zone);
      const endAt = zonedEndInstant(localDate, first.localEnd!, zone);
      const gap = (t: string) => `${t} does not exist on ${localDate} in ${zone} (clocks go forward).`;
      if (startAt === null) errors.start ??= gap(first.localStart!);
      if (endAt === null) errors.end ??= gap(first.localEnd!);
      if (startAt === null || endAt === null) continue;
      startMs = startAt;
      endMs = endAt;
    }
    if (endMs <= now) errors[endedKey] ??= "This block has already ended.";
    else if (startMs > now + BOOK_AHEAD_DAYS * DAY_MS) errors.date ??= "Bookings open 180 days ahead.";
    blocks.push({ ...first, localDate, startMs, endMs });
  }
  return blocks;
}

function hourNeeds(blocks: Block[]): Map<Month, number> {
  const needs = new Map<Month, number>();
  for (const b of blocks) if (b.quarters > 0) needs.set(blockMonth(b), (needs.get(blockMonth(b)) ?? 0) + b.quarters);
  return needs;
}

/** The charge for a block at the rate version and peak windows in force for it now. */
async function quote(db: Db, s: Session, station: StationRow, block: Block): Promise<{ chargeCents: number; peakQuarters: number }> {
  const rate = rateFor(await rateVersions(db, station, s.kitchen.timeZone), block.startMs)!;
  if (block.days !== null) return { chargeCents: priceShelf(block.days, rate as ShelfRate), peakQuarters: 0 };
  const { peakWindows } = await kitchenRules(db, s.kitchen.id);
  const price = priceHourly(block.localDate, block.localStart!, block.localEnd!, rate as HourlyRate, peakWindows);
  return { chargeCents: price.chargeCents, peakQuarters: price.peakQuarters };
}

interface TakenEntry { stationId: string; stationName: string; date: LocalDate; start: string | null; end: string | null }

/**
 * The occupancy rule, as the `taken` list: an hourly claim is taken in each requested week that an
 * occupying booking overlaps in real time; a shelf claim on each of its days whose slots are all
 * occupied, the moving booking's own days not counted.
 */
async function takenBlocks(db: Db, station: StationRow, blocks: Block[], except: string | null): Promise<TakenEntry[]> {
  const entry = (date: LocalDate, start: string | null, end: string | null): TakenEntry =>
    ({ stationId: station.id, stationName: station.name, date, start, end });
  if (station.kind === "shelf") {
    const block = blocks[0]!;
    const { rows } = await db.query<{ date: LocalDate }>(
      `SELECT to_char(d, 'YYYY-MM-DD') AS date FROM generate_series($2::date, $2::date + ($3::int - 1), interval '1 day') AS d
       WHERE (SELECT count(*) FROM bookings b WHERE b.station_id = $1 AND b.status = ANY($4) AND b.id IS DISTINCT FROM $5
                AND b.local_date <= d::date AND d::date < b.local_date + b.days) >= $6
       ORDER BY d`,
      [station.id, block.localDate, block.days, OCCUPYING, except, station.capacity]);
    return rows.map((r) => entry(r.date, null, null));
  }
  const taken: TakenEntry[] = [];
  for (const block of blocks) {
    const { rows } = await db.query(
      `SELECT 1 FROM bookings WHERE station_id = $1 AND status = ANY($2) AND tstzrange(start_at, end_at) && tstzrange($3, $4)
         AND id IS DISTINCT FROM $5 LIMIT 1`,
      [station.id, OCCUPYING, new Date(block.startMs), new Date(block.endMs), except]);
    if (rows[0]) taken.push(entry(block.localDate, block.localStart, block.localEnd));
  }
  return taken;
}

function blockTaken(taken: TakenEntry[], current?: Record<string, unknown>): ApiError {
  const first = taken[0]!;
  const extra = { taken, ...(current ? { current } : {}) };
  return first.start === null
    ? variantError(409, "block_taken_shelf", [first.stationName, first.date], extra)
    : variantError(409, "block_taken_hourly", [first.stationName, first.start], extra);
}

async function overlapsOutOfService(db: Db, stationId: string, blocks: Block[]): Promise<boolean> {
  for (const block of blocks) {
    const { rows } = await db.query(
      "SELECT 1 FROM out_of_service WHERE station_id = $1 AND tstzrange(start_at, end_at) && tstzrange($2, $3) LIMIT 1",
      [stationId, new Date(block.startMs), new Date(block.endMs)],
    );
    if (rows.length) return true;
  }
  return false;
}

const newId = (prefix: string): string => `${prefix}_${randomBytes(8).toString("hex")}`;

const NOTES_MESSAGE = "Notes can be at most 500 characters.";

// ---------------------------------------------------------------- holds

route("POST", "/api/bookings", async (ctx) => {
  const s = ctx.session!;
  const body = bodyObject(ctx.body);
  const station = typeof body.stationId === "string" ? await stationById(pool, s, body.stationId) : null;
  if (s.person.role !== "member") throw forbidden();
  return idempotent(ctx, async () => {
    const errors = keyErrors(Object.keys(body), station?.kind === "shelf" ? BODIES.shelfHold : BODIES.hourlyHold);
    if (!station && !errors.stationId) errors.stationId = "This field is required.";
    const repeat = body.repeatWeeks ?? 1;
    const weeks = Number.isInteger(repeat) && (repeat as number) >= 1 && (repeat as number) <= 12 ? (repeat as number) : 1;
    if (!errors.repeatWeeks && weeks !== repeat) errors.repeatWeeks = "Repeat for 1 to 12 weeks.";
    const notes = boundedText(body.notes ?? "", 0, 500);
    if (!errors.notes && notes === null) errors.notes = NOTES_MESSAGE;
    const blocks = station ? planBlocks(s, station, body, weeks, errors) : [];
    refuseInvalid(errors);
    const memberId = s.person.memberId!;
    const seriesId = weeks > 1 ? newId("ser") : null;
    const ids = await tx(async (client) => {
      await lockMonths(client, s.kitchen.id, blocks.map(blockMonth), "shared");
      await lockKey(client, `station:${station!.id}`);
      await applyDueLapses(client, s.kitchen.id);
      await assertOpen(client, s.kitchen.id, blocks.map(blockMonth));
      const taken = await takenBlocks(client, station!, blocks, null);
      if (taken.length) throw blockTaken(taken);
      const stateErrors: Record<string, string> = {};
      if (await overlapsOutOfService(client, station!.id, blocks)) stateErrors.stationId = `${station!.name} is out of service then.`;
      const { requiredDocuments } = await kitchenRules(client, s.kitchen.id);
      const docs = await documentProblem(client, memberId, requiredDocuments, lastDay(blocks[blocks.length - 1]!));
      if (docs) stateErrors.documents = docs;
      const short = await hoursShortfall(client, memberId, hourNeeds(blocks));
      if (short) stateErrors.hours = short;
      refuseInvalid(stateErrors);
      const created: string[] = [];
      for (const block of blocks) {
        const id = newId("bkg");
        const price = await quote(client, s, station!, block);
        await client.query(
          `INSERT INTO bookings (id, kitchen_id, member_id, station_id, series_id, local_date, local_start, local_end, days,
             start_at, end_at, status, quarters, peak_quarters, charge_cents, notes, hold_expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'held', $12, $13, $14, $15, clock_timestamp() + make_interval(secs => $16))`,
          [id, s.kitchen.id, memberId, station!.id, seriesId, block.localDate, block.localStart, block.localEnd, block.days,
            new Date(block.startMs), new Date(block.endMs), block.quarters, price.peakQuarters, price.chargeCents, notes, config.holdTtlSeconds],
        );
        created.push(id);
      }
      return created;
    });
    const view = await viewFor(pool, s);
    const bookings = await loadBookings(pool, "b.id = ANY($1)", [ids]);
    return { status: 201, body: { bookings: bookings.map((b) => bookingJson(b, view)), seriesId } };
  });
}, { idempotent: true });

// ---------------------------------------------------------------- confirm

async function confirmMail(client: pg.PoolClient, b: BookingRow): Promise<void> {
  const month = monthOfBooking(b);
  const lines = [b.business_name, labelOf(b), `Booking ${b.id}`, `Charge: ${money(b.charge_cents)} for your ${monthName(month)} statement`];
  if (b.kind === "hourly") lines.push(`${hoursText((await hourBank(client, b.member_id, month)).balanceHours * 4)} hours left in ${monthName(month)}`);
  await queueMail(client, b.email, `Booking confirmed: ${labelOf(b)}`, lines);
}

const BILLING_WAIT_MS = 5000;

async function waitForBilling(): Promise<void> {
  await Promise.race([deliverBilling(), new Promise((resolve) => setTimeout(resolve, BILLING_WAIT_MS))]);
}


route("POST", "/api/bookings/:id/confirm", async (ctx) => {
  const s = ctx.session!;
  const target = await reachable(pool, s, ctx.params.id!);
  requireRole(s, "confirm");
  return idempotent(ctx, async () => {
    refuseAnyKey(ctx.body);
    const snapshot = target.series_id ? await loadBookings(pool, "b.series_id = $1", [target.series_id]) : [target];
    const ids = await tx(async (client) => {
      await lockMonths(client, s.kitchen.id, snapshot.map(monthOfBooking), "shared");
      await lockHours(client, target.member_id, snapshot.map(monthOfBooking));
      await lockRows(client, snapshot.map((b) => b.id));
      const fresh = await loadOne(client, target.id);
      await assertOpen(client, s.kitchen.id, [monthOfBooking(fresh)]);
      if (fresh.status === "expired") {
        const taken = await takenBlocks(client, await stationById(client, s, fresh.station_id), [blockOf(fresh)], fresh.id);
        if (taken.length) throw blockTaken(taken);
        throw variantError(409, "hold_expired", [labelOf(fresh)]);
      }
      const now = Date.now();
      transition("confirm", stateOf(fresh), now, bookingJson(fresh, await viewFor(client, s, now)));
      const weeks = fresh.series_id ? await loadBookings(client, "b.series_id = $1 AND b.status = 'held'", [fresh.series_id]) : [fresh];
      await assertOpen(client, s.kitchen.id, weeks.map(monthOfBooking));
      const blocks = weeks.map(blockOf);
      const errors: Record<string, string> = {};
      const { requiredDocuments } = await kitchenRules(client, s.kitchen.id);
      const docs = await documentProblem(client, fresh.member_id, requiredDocuments, lastDay(blocks[blocks.length - 1]!));
      if (docs) errors.documents = docs;
      const short = await hoursShortfall(client, fresh.member_id, hourNeeds(blocks));
      if (short) errors.hours = short;
      refuseInvalid(errors);
      const station = await stationById(client, s, fresh.station_id);
      for (const w of weeks) {
        const price = await quote(client, s, station, blockOf(w));
        await client.query(
          `UPDATE bookings SET status = 'confirmed', charge_cents = $2, peak_quarters = $3, confirmed_at = clock_timestamp(),
             hold_expires_at = NULL, version = version + 1 WHERE id = $1`,
          [w.id, price.chargeCents, price.peakQuarters],
        );
        await postItem(client, subjectOf(w), "Booking", monthOfBooking(w), price.chargeCents, w.quarters, labelOf(w));
      }
      for (const w of weeks) await confirmMail(client, await loadOne(client, w.id));
      return weeks.map((w) => w.id);
    });
    await waitForBilling();
    const view = await viewFor(pool, s);
    const bookings = await loadBookings(pool, "b.id = ANY($1)", [ids]);
    return {
      status: bookings.some((b) => b.pending) ? 202 : 200,
      body: { bookings: bookings.map((b) => bookingJson(b, view)), hourBank: await hourBank(pool, target.member_id, monthOfBooking(target)) },
    };
  });
}, { idempotent: true });

// ---------------------------------------------------------------- cancel, release, waive, line actions

async function cancellationMail(client: pg.PoolClient, b: BookingRow, feeCents: number): Promise<void> {
  await queueMail(client, b.email, `Booking cancelled: ${labelOf(b)}`, [
    b.business_name, labelOf(b), `Booking ${b.id}`, feeCents > 0 ? `Late cancellation fee: ${money(feeCents)}` : "No cancellation fee",
  ]);
}

/**
 * Runs one action on a booking: settled one at a time per booking, after any due lapse, refused by
 * month_closed then invalid_transition, both carrying the current booking.
 */
async function act(
  ctx: Ctx, target: BookingRow, action: ManualAction,
  apply: (client: pg.PoolClient, b: BookingRow, next: Status, s: Session) => Promise<void>,
  withBank: boolean,
): Promise<Reply> {
  const s = ctx.session!;
  refuseAnyKey(ctx.body);
  await tx(async (client) => {
    await lockMonths(client, s.kitchen.id, [monthOfBooking(target)], "shared");
    await lockRows(client, [target.id]);
    const b = await loadOne(client, target.id);
    const now = Date.now();
    const current = bookingJson(b, await viewFor(client, s, now));
    await assertOpen(client, s.kitchen.id, [monthOfBooking(b)], current);
    await apply(client, b, transition(action, stateOf(b), now, current), s);
  });
  void deliverBilling();
  const view = await viewFor(pool, s);
  const b = await loadOne(pool, target.id);
  const body: Record<string, unknown> = { booking: bookingJson(b, view) };
  if (withBank) body.hourBank = await hourBank(pool, b.member_id, monthOfBooking(b));
  return { status: 200, body };
}

/** Looks the booking up (404), checks the role (403), then runs the action, through the retry record when the brief requires one. */
function actionRoute(path: string, action: ManualAction, withBank: boolean, retrySafe: boolean,
  apply: (client: pg.PoolClient, b: BookingRow, next: Status, s: Session) => Promise<void>): void {
  route("POST", `/api/bookings/:id/${path}`, async (ctx) => {
    const s = ctx.session!;
    const target = await reachable(pool, s, ctx.params.id!);
    requireRole(s, action);
    const run = () => act(ctx, target, action, apply, withBank);
    return retrySafe ? idempotent(ctx, run) : run();
  }, { idempotent: retrySafe });
}

actionRoute("cancel", "cancel", true, true, async (client, b, next) => {
  if (b.status === "held") {
    await client.query("UPDATE bookings SET status = $2, hold_expires_at = NULL, version = version + 1 WHERE id = $1", [b.id, next]);
    return;
  }
  const fee = next === "cancelled_late" ? lateFeeCents(b.charge_cents) : 0;
  if (fee > 0) await postItem(client, subjectOf(b), "Late cancellation", monthOfBooking(b), fee, 0);
  await postItem(client, subjectOf(b), "Cancelled", monthOfBooking(b), b.charge_cents, b.quarters);
  await client.query("UPDATE bookings SET status = $2, penalty_cents = $3, version = version + 1 WHERE id = $1", [b.id, next, fee]);
  await cancellationMail(client, b, fee);
});

actionRoute("release", "release", true, false, async (client, b, next) => {
  await postItem(client, subjectOf(b), "Cancelled", monthOfBooking(b), b.charge_cents, b.quarters);
  await client.query("UPDATE bookings SET status = $2, conflict = false, version = version + 1 WHERE id = $1", [b.id, next]);
  await cancellationMail(client, b, 0);
});

/**
 * The adjustment month for a waiver of a fee in a closed month: the earliest open kitchen-local
 * month at or after the current month. Each month's key is taken shared first, so a close of that
 * month in progress finishes before it is judged.
 */
async function adjustmentMonth(client: pg.PoolClient, s: Session): Promise<Month> {
  for (let month = monthOf(todayOf(s)); ; month = addMonths(month, 1)) {
    await lockMonths(client, s.kitchen.id, [month], "shared");
    const { rows } = await client.query("SELECT 1 FROM closed_months WHERE kitchen_id = $1 AND month = $2", [s.kitchen.id, month]);
    if (!rows[0]) return month;
  }
}

/**
 * Waiving a late fee: a credit in the fee's month while it is open, otherwise an adjustment credit
 * in the adjustment month; a waiver never answers month_closed.
 */
route("POST", "/api/bookings/:id/waive-penalty", async (ctx) => {
  const s = ctx.session!;
  const target = await reachable(pool, s, ctx.params.id!);
  requireRole(s, "waive_penalty");
  return idempotent(ctx, async () => {
    refuseAnyKey(ctx.body);
    const creditMonth = await tx(async (client) => {
      const feeMonth = monthOfBooking(target);
      await lockMonths(client, s.kitchen.id, [feeMonth], "shared");
      await lockRows(client, [target.id]);
      const b = await loadOne(client, target.id);
      const now = Date.now();
      transition("waive_penalty", stateOf(b), now, bookingJson(b, await viewFor(client, s, now)));
      const { rows } = await client.query("SELECT 1 FROM closed_months WHERE kitchen_id = $1 AND month = $2", [s.kitchen.id, feeMonth]);
      const month = rows[0] ? await adjustmentMonth(client, s) : feeMonth;
      if (month === feeMonth) await postItem(client, subjectOf(b), "Waived late cancellation", month, b.penalty_cents, 0);
      else await postItem(client, subjectOf(b), "Adjustment", month, b.penalty_cents, 0, monthName(feeMonth));
      await client.query("UPDATE bookings SET penalty_waived = true, version = version + 1 WHERE id = $1", [b.id]);
      await queueMail(client, b.email, `Late cancellation fee waived: ${labelOf(b)}`, [
        b.business_name, labelOf(b), `Booking ${b.id}`, `Credit ${money(b.penalty_cents)} on your ${monthName(month)} statement`,
      ]);
      return month;
    });
    void deliverBilling();
    const view = await viewFor(pool, s);
    const b = await loadOne(pool, target.id);
    return { status: 200, body: { booking: bookingJson(b, view), creditMonth } };
  });
}, { idempotent: true });

for (const [path, action] of [["check-in", "check_in"], ["check-out", "check_out"], ["no-show", "no_show"]] as const) {
  actionRoute(path, action, false, false, async (client, b, next, s) => {
    if (action === "check_in") {
      const { requiredDocuments } = await kitchenRules(client, s.kitchen.id);
      const docs = await checkInDocumentProblem(client, b.member_id, requiredDocuments, todayOf(s));
      if (docs) refuseInvalid({ documents: docs });
    }
    await client.query("UPDATE bookings SET status = $2, version = version + 1 WHERE id = $1", [b.id, next]);
  });
}

// ---------------------------------------------------------------- move

route("POST", "/api/bookings/:id/move", async (ctx) => {
  const s = ctx.session!;
  const body = bodyObject(ctx.body);
  const target = await reachable(pool, s, ctx.params.id!);
  const station = typeof body.stationId === "string" ? await stationById(pool, s, body.stationId) : null;
  requireRole(s, "move");
  // A different kind of station is refused on its own, whatever else the body holds.
  if (station && station.kind !== target.kind) refuseInvalid({ stationId: "Move a block to a station of the same kind." });
  const kind = station?.kind ?? target.kind;
  const errors = keyErrors(Object.keys(body), kind === "shelf" ? BODIES.shelfMove : BODIES.hourlyMove);
  if (!station && !errors.stationId) errors.stationId = "This field is required.";
  if (!errors.version && !Number.isInteger(body.version)) errors.version = "Reload and try again.";
  const block = station ? planBlocks(s, station, body, 1, errors)[0] : undefined;
  refuseInvalid(errors);
  const newMonth = blockMonth(block!);
  await tx(async (client) => {
    await lockMonths(client, s.kitchen.id, [monthOfBooking(target), newMonth], "shared");
    for (const id of [...new Set([station!.id, target.station_id])].sort()) await lockKey(client, `station:${id}`);
    await lockHours(client, target.member_id, [monthOfBooking(target), newMonth]);
    await lockRows(client, [target.id]);
    const b = await loadOne(client, target.id);
    const now = Date.now();
    const current = bookingJson(b, await viewFor(client, s, now));
    if (body.version !== b.version) throw variantError(412, "stale_version_move", [], { current });
    await assertOpen(client, s.kitchen.id, [monthOfBooking(b), newMonth], current);
    transition("move", stateOf(b), now, current);
    const taken = await takenBlocks(client, station!, [block!], b.id);
    if (taken.length) throw blockTaken(taken, current);
    const stateErrors: Record<string, string> = {};
    if (await overlapsOutOfService(client, station!.id, [block!])) stateErrors.stationId = `${station!.name} is out of service then.`;
    const short = await hoursShortfall(client, b.member_id, hourNeeds([block!]), { month: monthOfBooking(b), quarters: b.quarters });
    if (short) stateErrors.hours = short;
    refuseInvalid(stateErrors);
    const price = await quote(client, s, station!, block!);
    await postItem(client, subjectOf(b), "Moved", monthOfBooking(b), b.charge_cents, b.quarters);
    await client.query(
      `UPDATE bookings SET station_id = $2, local_date = $3, local_start = $4, local_end = $5, days = $6, start_at = $7, end_at = $8,
         quarters = $9, peak_quarters = $10, charge_cents = $11, conflict = false, version = version + 1 WHERE id = $1`,
      [b.id, station!.id, block!.localDate, block!.localStart, block!.localEnd, block!.days, new Date(block!.startMs), new Date(block!.endMs),
        block!.quarters, price.peakQuarters, price.chargeCents],
    );
    const moved = await loadOne(client, b.id);
    await postItem(client, subjectOf(moved), "Booking", monthOfBooking(moved), price.chargeCents, moved.quarters, labelOf(moved));
    await queueMail(client, moved.email, `Booking moved: ${labelOf(moved)}`, [
      moved.business_name, `From: ${labelOf(b)}`, `To: ${labelOf(moved)}`, `Booking ${moved.id}`, `New charge: ${money(price.chargeCents)}`,
    ]);
  });
  void deliverBilling();
  const view = await viewFor(pool, s);
  const moved = await loadOne(pool, target.id);
  return { status: 200, body: { booking: bookingJson(moved, view), hourBank: await hourBank(pool, moved.member_id, monthOfBooking(moved)) } };
});

// ---------------------------------------------------------------- reads

route("GET", "/api/bookings", async (ctx) => {
  const s = ctx.session!;
  const month = monthParam(ctx);
  const view = await viewFor(pool, s);
  await applyDueLapses(pool, s.kitchen.id);
  const memberId = s.person.role === "member" ? s.person.memberId : ctx.query.get("memberId");
  const rows = await loadBookings(pool,
    `b.kitchen_id = $1 AND to_char(b.local_date, 'YYYY-MM') = $2 AND ($3::text IS NULL OR b.member_id = $3) AND ${LISTED_SQL}`,
    [s.kitchen.id, month, memberId]);
  return { status: 200, body: { month, bookings: rows.map((b) => bookingJson(b, view)) } };
});

route("GET", "/api/bookings/:id", async (ctx) => {
  const s = ctx.session!;
  const view = await viewFor(pool, s);
  await applyDueLapses(pool, s.kitchen.id, [ctx.params.id!]);
  return { status: 200, body: { booking: bookingJson(await reachable(pool, s, ctx.params.id!), view) } };
});

function windowJson(w: Record<string, unknown>, zone: string): Record<string, unknown> {
  return {
    id: w.id, stationId: w.station_id, start: isoWithOffset((w.start_at as Date).getTime(), zone), end: isoWithOffset((w.end_at as Date).getTime(), zone),
    localDate: w.local_date, localStart: w.local_start, localEnd: w.local_end, reason: w.reason,
  };
}

/**
 * Board contents: bookings on the board date (hourly blocks starting that day, shelf bookings
 * whose days include it) in an occupying status, plus a member's own expired tickets. Staff see the
 * full shape; a member sees their own in full and every other member's reduced to `booked`.
 */
route("GET", "/api/board", async (ctx) => {
  const s = ctx.session!;
  const zone = s.kitchen.timeZone;
  const raw = ctx.query.get("date");
  if (raw !== null && !isLocalDate(raw)) throw invalid({ date: "Use a date in the form YYYY-MM-DD." });
  // One response instant: `now`, `today` and every booking's actions are judged at it.
  const view = await viewFor(pool, s);
  const today = localDateOf(view.nowMs, zone);
  const date = raw ?? today;
  await applyDueLapses(pool, s.kitchen.id);
  const { rows: stations } = await pool.query("SELECT id, name, kind, capacity FROM stations WHERE kitchen_id = $1 ORDER BY position", [s.kitchen.id]);
  const me = s.person.memberId;
  const rows = await loadBookings(pool,
    `b.kitchen_id = $1 AND (b.status = ANY($3) OR (b.status = 'expired' AND b.member_id = $4))
     AND ((s.kind = 'hourly' AND b.local_date = $2) OR (s.kind = 'shelf' AND b.local_date <= $2 AND $2::date < b.local_date + b.days))`,
    [s.kitchen.id, date, OCCUPYING, me], "s.position, b.start_at, COALESCE(b.confirmed_at, b.created_at), b.id");
  const blocks = rows.map((b) => (me && b.member_id !== me ? bookedJson(b, zone) : bookingJson(b, view)));
  const dayStart = new Date(startOfDay(date, zone));
  const dayEnd = new Date(startOfDay(addDays(date, 1), zone));
  const { rows: windows } = await pool.query(
    `SELECT o.* FROM out_of_service o JOIN stations s ON s.id = o.station_id
     WHERE o.kitchen_id = $1 AND o.start_at < $3 AND o.end_at > $2 ORDER BY s.position, o.start_at`,
    [s.kitchen.id, dayStart, dayEnd]);
  const { peakWindows } = await kitchenRules(pool, s.kitchen.id);
  return {
    status: 200,
    body: {
      date, today, now: isoWithOffset(view.nowMs, zone), timeZone: zone, stations, peakWindows, blocks,
      outOfService: windows.map((w) => windowJson(w, zone)),
      hourBank: me ? await hourBank(pool, me, monthOf(date)) : null,
    },
  };
});

// ---------------------------------------------------------------- out of service

const CONFLICT_STATUSES = ["confirmed", "checked_in"];

route("POST", "/api/out-of-service", async (ctx) => {
  const s = ctx.session!;
  const body = bodyObject(ctx.body);
  const station = typeof body.stationId === "string" ? await stationById(pool, s, body.stationId) : null;
  if (s.person.role === "member") throw forbidden();
  const zone = s.kitchen.timeZone;
  const errors = keyErrors(Object.keys(body), BODIES.outOfService);
  const onQuarter = (t: unknown): t is string => isLocalTime(t) && minutesOf(t) % 15 === 0;
  if (!station && !errors.stationId) errors.stationId = "This field is required.";
  if (!errors.date && !isLocalDate(body.date)) errors.date = "Use a date in the form YYYY-MM-DD.";
  if (!errors.start && !onQuarter(body.start)) errors.start = "Times must fall on the quarter hour.";
  if (!errors.end && !(isEndTime(body.end) && endMinutes(body.end) % 15 === 0)) errors.end = "Times must fall on the quarter hour.";
  else if (!errors.end && !errors.start && endMinutes(body.end as string) <= minutesOf(body.start as string)) errors.end = "End must be after start on the same day.";
  const reason = boundedText(body.reason, 1, 120);
  if (!errors.reason && reason === null) errors.reason = "Give a reason in 1 to 120 characters.";
  const startAt = !errors.date && !errors.start ? zonedInstant(body.date as string, body.start as string, zone) : null;
  const endAt = !errors.date && !errors.end ? zonedEndInstant(body.date as string, body.end as string, zone) : null;
  if (!errors.start && !errors.date && startAt === null) errors.start = `${body.start} does not exist on ${body.date} in ${zone} (clocks go forward).`;
  if (!errors.end && !errors.date && endAt === null) errors.end = `${body.end} does not exist on ${body.date} in ${zone} (clocks go forward).`;
  refuseInvalid(errors);
  const id = newId("oos");
  const conflicts = await tx(async (client) => {
    await lockKey(client, `station:${station!.id}`);
    await applyDueLapses(client, s.kitchen.id);
    await client.query(
      `INSERT INTO out_of_service (id, kitchen_id, station_id, local_date, local_start, local_end, start_at, end_at, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, s.kitchen.id, station!.id, body.date, body.start, body.end, new Date(startAt!), new Date(endAt!), reason],
    );
    await cancelHoldsUnder(client, station!.id, startAt!, endAt!);
    const flagged = await client.query(
      `UPDATE bookings SET conflict = true, version = version + CASE WHEN conflict THEN 0 ELSE 1 END
       WHERE station_id = $1 AND tstzrange(start_at, end_at) && tstzrange($2, $3) AND status = ANY($4) RETURNING id`,
      [station!.id, new Date(startAt!), new Date(endAt!), CONFLICT_STATUSES]);
    return flagged.rows.map((r) => r.id as string);
  });
  const { rows } = await pool.query("SELECT * FROM out_of_service WHERE id = $1", [id]);
  return { status: 201, body: { window: windowJson(rows[0], zone), conflicts } };
});

route("DELETE", "/api/out-of-service/:id", async (ctx) => {
  const s = ctx.session!;
  const { rows } = await pool.query("SELECT * FROM out_of_service WHERE id = $1 AND kitchen_id = $2", [ctx.params.id, s.kitchen.id]);
  const w = rows[0];
  if (!w) throw notFound();
  if (s.person.role === "member") throw forbidden();
  const still = await tx(async (client) => {
    await lockKey(client, `station:${w.station_id}`);
    await client.query("DELETE FROM out_of_service WHERE id = $1", [w.id]);
    await client.query(
      `UPDATE bookings b SET conflict = false, version = b.version + 1
       WHERE b.station_id = $1 AND b.conflict AND NOT EXISTS (SELECT 1 FROM out_of_service o WHERE o.station_id = b.station_id
         AND tstzrange(o.start_at, o.end_at) && tstzrange(b.start_at, b.end_at))`,
      [w.station_id]);
    const { rows: left } = await client.query("SELECT id FROM bookings WHERE station_id = $1 AND conflict ORDER BY start_at, id", [w.station_id]);
    return left.map((r) => r.id as string);
  });
  return { status: 200, body: { conflicts: still } };
});

