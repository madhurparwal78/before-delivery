// Bookings: the booking shape, live holds, claims (single or paired with a walk-in shelf),
// confirmation, cancellation, the door edges with their door log, and the daily usage report.
// The no-overlap rule itself lives in Postgres (the occupancies_no_overlap exclusion constraint).

import type { Booking, BookingEmail, BookingStatus, DailyReport, DoorAction, DoorEntry, DoorList, DoorLogEntry, Floor, Interval, Role, Station, StationKind } from "../shared/api.js";
import { addDays, cancellationCutoff, clockText, dateLabel, localDate, localMinute, MINUTE_MS, zonedInstant } from "../shared/clock.js";
import { bookingMinutes, duration } from "../shared/format.js";
import { coolerFreeRows, stationMetrics, type Occupancy } from "../shared/metrics.js";
import type { Caller, TenantCaller } from "./auth.js";
import { config } from "./config.js";
import { db } from "./db.js";
import { ApiError, conflict, type FieldErrors } from "./errors.js";
import { CHECK_IN_LEAD_MINUTES, CLEANUP_MINUTES, iso, kitchenTime, spanStatus, zone, type KitchenTime } from "./kitchen.js";
import { writeMovement } from "./ledger.js";
import { queueEmail } from "./mail.js";
import { bookingShape, type BookingShape } from "./shape.js";
import { asOnboarding, clearance, lapse, tenantStatus, type CurrentCover, type Onboarding } from "./onboarding.js";
import { col, only, PgError, type Json, type Queryable, type Row } from "./postgres.js";
import { findTenant } from "./tenants.js";

const BOOKING_SELECT = `
  SELECT b.*, s.name AS station_name, sh.name AS shelf_name, t.business_name, t.contact_name, t.onboarding, u.email AS tenant_email,
         (SELECT c.expires_on::text FROM current_documents c WHERE c.tenant_id = t.id AND c.kind = 'insurance_certificate') AS insurance_expires_on,
         (SELECT c.expires_on::text FROM current_documents c WHERE c.tenant_id = t.id AND c.kind = 'food_handler_card') AS food_handler_expires_on,
         (SELECT COALESCE(json_agg(json_build_object('action', d.action, 'at', (extract(epoch FROM d.at) * 1000)::float8, 'by', d.by_name) ORDER BY d.seq), '[]'::json)
            FROM door_log d WHERE d.booking_id = b.id) AS door_log,
         (SELECT COALESCE(json_agg(json_build_object('kind', m.action, 'deliveredAt', (extract(epoch FROM m.delivered_at) * 1000)::float8) ORDER BY m.queued_at), '[]'::json)
            FROM mail_queue m WHERE m.record_id = b.id::text AND m.action IN ('booking_confirmed', 'booking_moved')) AS emails
    FROM bookings_now b
    JOIN stations s ON s.id = b.station_id
    LEFT JOIN stations sh ON sh.id = b.shelf_id
    JOIN tenants t ON t.id = b.tenant_id
    JOIN users u ON u.tenant_id = t.id`;

const CLAIM_LIMIT = 10;
const STATUSES: readonly BookingStatus[] = ["held", "confirmed", "checked_in", "completed", "cancelled", "no_show"];
const DOOR_ACTIONS: readonly DoorAction[] = ["check_in", "check_out", "no_show"];

interface BookingRecord {
  id: string;
  tenantId: string;
  tenantName: string;
  contactName: string;
  tenantEmail: string;
  onboarding: Onboarding;
  cover: CurrentCover;
  stationId: string;
  stationName: string;
  shelfId: string | null;
  shelfName: string | null;
  start: Date;
  end: Date;
  bufferEnd: Date;
  minutes: number;
  status: BookingStatus;
  holdExpiresAt: Date;
  packId: string;
  debitedMinutes: number | null;
  refundedMinutes: number | null;
  cancelReason: "tenant" | "hold_expired" | null;
  cleanupNote: string | null;
  doorLog: DoorLogEntry[];
  moveCount: number;
  emails: BookingEmail[];
  createdAt: Date;
}

function field(value: Json, key: string): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value[key] : undefined;
}

function doorLogOf(value: Json | undefined): DoorLogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const action = DOOR_ACTIONS.find((a) => a === field(entry, "action")) ?? "check_in";
    const at = field(entry, "at");
    const by = field(entry, "by");
    return { action, at: iso(typeof at === "number" ? at : 0), by: typeof by === "string" ? by : "" };
  });
}

function emailsOf(value: Json | Date | undefined): BookingEmail[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry): BookingEmail => {
    const kind = field(entry, "kind") === "booking_moved" ? "booking_moved" : "booking_confirmed";
    const at = field(entry, "deliveredAt");
    return typeof at === "number" ? { kind, status: "sent", sentAt: iso(at) } : { kind, status: "queued", sentAt: null };
  });
}

function bookingRecord(row: Row): BookingRecord {
  const status = col.text(row, "status");
  const reason = col.textOrNull(row, "cancel_reason");
  const log = row.door_log;
  return {
    id: col.text(row, "id"),
    tenantId: col.text(row, "tenant_id"),
    tenantName: col.text(row, "business_name"),
    contactName: col.text(row, "contact_name"),
    tenantEmail: col.text(row, "tenant_email"),
    onboarding: asOnboarding(col.text(row, "onboarding")),
    cover: { insuranceExpiresOn: col.textOrNull(row, "insurance_expires_on"), foodHandlerExpiresOn: col.textOrNull(row, "food_handler_expires_on") },
    stationId: col.text(row, "station_id"),
    stationName: col.text(row, "station_name"),
    shelfId: col.textOrNull(row, "shelf_id"),
    shelfName: col.textOrNull(row, "shelf_name"),
    start: col.time(row, "start_at"),
    end: col.time(row, "end_at"),
    bufferEnd: col.time(row, "buffer_end"),
    minutes: col.int(row, "minutes"),
    status: STATUSES.find((s) => s === status) ?? "cancelled",
    holdExpiresAt: col.time(row, "hold_expires_at"),
    packId: col.text(row, "pack_id"),
    debitedMinutes: col.intOrNull(row, "debited_minutes"),
    refundedMinutes: col.intOrNull(row, "refunded_minutes"),
    cancelReason: reason === "tenant" || reason === "hold_expired" ? reason : null,
    cleanupNote: col.textOrNull(row, "cleanup_note"),
    doorLog: log instanceof Date ? [] : doorLogOf(log),
    moveCount: col.int(row, "move_count"),
    emails: emailsOf(row.emails instanceof Date ? undefined : row.emails),
    createdAt: col.time(row, "created_at"),
  };
}

/** The stations a booking occupies: its station, plus its shelf when it has one. */
function occupied(b: BookingRecord): string[] {
  return b.shelfId ? [b.stationId, b.shelfId] : [b.stationId];
}

/** The cutoff rule: what cancelling would credit back, judged at the transaction's start. Null unless confirmed. */
function cancelCreditMinutes(b: BookingRecord, time: KitchenTime): number | null {
  if (b.status !== "confirmed") return null;
  return time.now <= cancellationCutoff(b.start.getTime(), zone) ? b.debitedMinutes ?? 0 : 0;
}

/** Why a move would be refused by its first three checks; null when none refuses, which is what `movable` means. */
function moveRefusal(b: BookingRecord, time: KitchenTime): "invalid_transition" | "past_cutoff" | "move_limit_reached" | null {
  if (b.status !== "confirmed") return "invalid_transition";
  if (time.now > cancellationCutoff(b.start.getTime(), zone)) return "past_cutoff";
  return b.moveCount >= 1 ? "move_limit_reached" : null;
}

/** The booking for the caller's role: staff also see whose it is and its door log. */
function bookingView(b: BookingRecord, role: Role, time: KitchenTime): Booking {
  const view: Booking = {
    id: b.id, stationId: b.stationId, stationName: b.stationName, shelfId: b.shelfId, shelfName: b.shelfName,
    start: iso(b.start), end: iso(b.end), bufferEnd: iso(b.bufferEnd), status: b.status,
    holdExpiresAt: iso(b.holdExpiresAt),
    packId: b.packId, debitedMinutes: b.debitedMinutes, refundedMinutes: b.refundedMinutes,
    cancelReason: b.cancelReason, createdAt: iso(b.createdAt),
    cutoffAt: iso(cancellationCutoff(b.start.getTime(), zone)), cancelCreditMinutes: cancelCreditMinutes(b, time),
    moveCount: b.moveCount, movable: moveRefusal(b, time) === null, emails: b.emails,
  };
  return role === "tenant" ? view : { ...view, tenantId: b.tenantId, tenantName: b.tenantName, doorLog: b.doorLog, cleanupNote: b.cleanupNote };
}

const STORE_LAPSED_HOLD = "UPDATE bookings b SET status = 'cancelled', cancel_reason = 'hold_expired' FROM bookings_now n";

/** Stores every lapsed hold as cancelled; rows another transaction holds are left for the next sweep. */
export async function settleExpiredHolds(q: Queryable): Promise<void> {
  await q.query(
    `${STORE_LAPSED_HOLD} WHERE n.id = b.id AND b.status = 'held' AND n.status = 'cancelled'
       AND b.id IN (SELECT id FROM bookings WHERE status = 'held' FOR UPDATE SKIP LOCKED)`,
  );
}

/** Stores the lapsed holds overlapping a claim on one station, inside the claim's own transaction. */
async function releaseOverlappingHolds(tx: Queryable, stationId: string, start: Date, bufferEnd: Date): Promise<void> {
  await tx.query(
    `${STORE_LAPSED_HOLD}, booking_occupancies o
      WHERE n.id = b.id AND b.status = 'held' AND n.status = 'cancelled' AND o.booking_id = b.id
        AND o.station_id = $1 AND tstzrange(o.start_at, o.buffer_end) && tstzrange($2, $3)`,
    [stationId, start, bufferEnd],
  );
}

async function lockBooking(tx: Queryable, id: string): Promise<BookingRecord> {
  await tx.query("SELECT 1 FROM bookings WHERE id = $1 FOR UPDATE", [id]);
  return readBooking(tx, id);
}

async function readBooking(q: Queryable, id: string): Promise<BookingRecord> {
  const [row] = await q.query(`${BOOKING_SELECT} WHERE b.id = $1`, [id]);
  if (!row) throw new Error(`booking ${id} vanished`);
  return bookingRecord(row);
}

/** Owning tenant of a booking id, for the pipeline's 404 check. */
export async function bookingOwner(id: string): Promise<string | null> {
  const [row] = await db.query("SELECT tenant_id FROM bookings WHERE id = $1", [id]);
  return row ? col.text(row, "tenant_id") : null;
}

function dayBounds(date: string): [Date, Date] {
  return [new Date(zonedInstant(date, 0, zone)), new Date(zonedInstant(addDays(date, 1), 0, zone))];
}

async function bookingsOn(q: Queryable, date: string, extra = ""): Promise<BookingRecord[]> {
  const [from, to] = dayBounds(date);
  const rows = await q.query(`${BOOKING_SELECT} WHERE b.start_at >= $1 AND b.start_at < $2 ${extra} ORDER BY b.start_at, s.seed_order, b.created_at`, [from, to]);
  return rows.map(bookingRecord);
}

// ---- Stations and the floor -------------------------------------------------------------

interface StationRecord {
  id: string;
  name: string;
  kind: StationKind;
  col: number;
  row: number;
  cleanupMinutes: number;
}

const KINDS: readonly StationKind[] = ["range", "prep_table", "mixer", "cooler_shelf"];

async function stations(q: Queryable): Promise<StationRecord[]> {
  const rows = await q.query('SELECT id, name, kind, col, "row", cleanup_minutes FROM stations ORDER BY seed_order');
  return rows.map((row) => ({
    id: col.text(row, "id"),
    name: col.text(row, "name"),
    kind: KINDS.find((k) => k === col.text(row, "kind")) ?? "range",
    col: col.int(row, "col"),
    row: col.int(row, "row"),
    cleanupMinutes: col.int(row, "cleanup_minutes"),
  }));
}

function intervalView(b: BookingRecord, caller: Caller): Interval {
  const times = { start: iso(b.start), end: iso(b.end), bufferEnd: iso(b.bufferEnd) };
  return caller.role === "tenant"
    ? { ...times, mine: b.tenantId === caller.tenantId }
    : { ...times, bookingId: b.id, status: b.status, tenantId: b.tenantId, tenantName: b.tenantName };
}

export interface Span {
  from: number;
  to: number;
}

export async function floor(caller: Caller, date: string, span: Span | null): Promise<Floor> {
  return db.transaction(async (tx) => {
    const time = await kitchenTime(tx);
    return floorAt(caller, date, span, time, await stations(tx), await bookingsOn(tx, date, "AND b.status <> 'cancelled'"));
  });
}

function floorAt(caller: Caller, date: string, span: Span | null, time: KitchenTime, all: readonly StationRecord[], live: readonly BookingRecord[]): Floor {
  const window = span ? [zonedInstant(date, span.from, zone), zonedInstant(date, span.to, zone)] as const : null;
  const occupancy = (b: BookingRecord): Occupancy => ({ start: b.start.getTime(), end: b.end.getTime(), bufferEnd: b.bufferEnd.getTime() });
  const list: Station[] = all.map((s) => {
    const here = live.filter((b) => occupied(b).includes(s.id));
    const base: Station = { id: s.id, name: s.name, kind: s.kind, cleanupMinutes: s.cleanupMinutes, col: s.col, row: s.row, intervals: here.map((b) => intervalView(b, caller)) };
    return window ? { ...base, ...stationMetrics(here.map(occupancy), window[0], window[1]) } : base;
  });
  const shelves = all.filter((s) => s.kind === "cooler_shelf").map((s) => live.filter((b) => occupied(b).includes(s.id)).map(occupancy));
  return {
    date, from: span ? clockText(span.from) : null, to: span ? clockText(span.to) : null, now: iso(time.now),
    spanStatus: window ? spanStatus(window[0], time) : null,
    coolerFree: coolerFreeRows(shelves, date, zone),
    stations: list,
  };
}

// ---- Listing ----------------------------------------------------------------------------

export async function listBookings(caller: Caller, date: string | null): Promise<Booking[]> {
  return db.transaction(async (tx) => {
    const time = await kitchenTime(tx);
    if (caller.role === "tenant") {
      const from = date ? dayBounds(date)[0] : null;
      const rows = await tx.query(
        `${BOOKING_SELECT} WHERE b.tenant_id = $1 ${from ? "AND b.start_at >= $2" : ""} ORDER BY b.start_at, b.created_at DESC`,
        from ? [caller.tenantId, from] : [caller.tenantId],
      );
      return rows.map((row) => bookingView(bookingRecord(row), caller.role, time));
    }
    return (await bookingsOn(tx, date ?? "")).map((b) => bookingView(b, caller.role, time));
  });
}

export async function getBooking(caller: Caller, id: string): Promise<Booking> {
  return db.transaction(async (tx) => {
    const time = await kitchenTime(tx);
    return bookingView(await readBooking(tx, id), caller.role, time);
  });
}

/** Why check-in would fail now, in the order the rule lists its checks; null when it would succeed. */
function checkInRefusal(b: BookingRecord, time: KitchenTime): "invalid_transition" | "outside_check_in_window" | "not_cleared" | null {
  if (b.status !== "confirmed") return "invalid_transition";
  if (time.now < checkInOpens(b) || time.now >= b.end.getTime()) return "outside_check_in_window";
  return clearance(b.onboarding, b.cover, time.today).cleared ? null : "not_cleared";
}

function checkInOpens(b: BookingRecord): number {
  return b.start.getTime() - CHECK_IN_LEAD_MINUTES * MINUTE_MS;
}

function noShowRefusal(b: BookingRecord, time: KitchenTime): "invalid_transition" | "too_early" | null {
  if (b.status !== "confirmed") return "invalid_transition";
  return time.now < b.start.getTime() ? "too_early" : null;
}

/** The door actions that would succeed now, judged by the same rules the door routes apply. */
function doorActions(b: BookingRecord, time: KitchenTime): DoorAction[] {
  const actions: DoorAction[] = [];
  if (checkInRefusal(b, time) === null) actions.push("check_in");
  if (b.status === "checked_in") actions.push("check_out");
  if (noShowRefusal(b, time) === null) actions.push("no_show");
  return actions;
}

export async function doorList(requested: string | null): Promise<DoorList> {
  return db.transaction(async (tx) => {
    const time = await kitchenTime(tx);
    const date = requested ?? time.today;
    const bookings = await bookingsOn(tx, date);
    const entries = bookings.map((b): DoorEntry => ({
      bookingId: b.id, tenantId: b.tenantId, tenantName: b.tenantName, stationId: b.stationId, stationName: b.stationName,
      shelfId: b.shelfId, shelfName: b.shelfName, start: iso(b.start), end: iso(b.end), status: b.status,
      ...clearance(b.onboarding, b.cover, date), checkInOpensAt: iso(checkInOpens(b)), actions: doorActions(b, time),
      doorLog: b.doorLog, cleanupNote: b.cleanupNote,
    }));
    return { date, now: iso(time.now), entries };
  });
}

// ---- Claims -----------------------------------------------------------------------------

/** The booking shape of a claim, or of a move when the booking being moved is named. */
export async function validateShape(json: Readonly<Record<string, unknown>>, errors: FieldErrors, moving: string | null = null): Promise<BookingShape> {
  const [all, time, current] = await Promise.all([stations(db), kitchenTime(db), moving ? readBooking(db, moving) : null]);
  return bookingShape(json, errors, all, time, current && { stationId: current.stationId, shelfId: current.shelfId, start: current.start.getTime(), end: current.end.getTime() });
}

/** Counts a claim in the tenant's rolling minute; the tenth already counted makes the next one a 429. */
export async function countClaim(caller: TenantCaller): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('claims:' || $1))", [caller.tenantId]);
    const counted = only(await tx.query(
      `SELECT count(*)::int AS claims,
              extract(epoch FROM min(at) + interval '60 seconds' - date_trunc('second', now()))::int AS retry
         FROM counted_claims WHERE tenant_id = $1 AND at > date_trunc('second', now()) - interval '60 seconds'`,
      [caller.tenantId],
    ));
    if (col.int(counted, "claims") >= CLAIM_LIMIT) {
      const retry = Math.min(60, Math.max(1, col.intOrNull(counted, "retry") ?? 60));
      throw new ApiError(429, "rate_limited", "Too many claims in the last minute. Try again shortly.", undefined, { "Retry-After": String(retry) });
    }
    await tx.query("INSERT INTO counted_claims (tenant_id, at) VALUES ($1, date_trunc('second', now()))", [caller.tenantId]);
  });
}

/** Any contention between overlapping claims ends the same way as the overlap itself. */
const CONTENTION = ["23P01", "40P01", "40001"];

export async function claim(caller: TenantCaller, input: BookingShape): Promise<Booking> {
  const occupying = (input.shelfId ? [input.stationId, input.shelfId] : [input.stationId]).sort();
  const start = new Date(input.start);
  const bufferEnd = new Date(input.end + CLEANUP_MINUTES * MINUTE_MS);
  const minutes = bookingMinutes(Math.round((input.end - input.start) / MINUTE_MS), occupying.length);
  try {
    return await db.transaction(async (tx) => {
      const tenant = await findTenant(tx, caller.tenantId, true);
      if (!tenant) throw new Error(`tenant ${caller.tenantId} vanished`);
      const time = await kitchenTime(tx);
      const standing = tenantStatus(tenant.onboarding, tenant.cover, time.today);
      if (standing.status !== "approved") throw conflict("tenant_not_approved", "This account can't book until it is approved.");
      if (lapse(tenant.cover, localDate(input.start, zone)) !== null) {
        throw conflict("documents_not_valid", "Your documents don't cover that date.");
      }
      const [pack] = await tx.query(
        `SELECT id FROM pack_figures WHERE tenant_id = $1 AND status = 'active' AND available_minutes >= $2
          ORDER BY purchased_at, id LIMIT 1`,
        [caller.tenantId, minutes],
      );
      if (!pack) throw conflict("insufficient_hours", "No single pack has enough hours available.");
      // Sorted per-station locks: overlapping claims queue up here instead of deadlocking in the constraint.
      for (const stationId of occupying) {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext('station:' || $1))", [stationId]);
        await releaseOverlappingHolds(tx, stationId, start, bufferEnd);
      }
      const id = col.text(only(await tx.query(
        `INSERT INTO bookings (tenant_id, station_id, shelf_id, start_at, end_at, buffer_end, minutes, status, hold_expires_at, pack_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'held', date_trunc('second', now() + make_interval(secs => $8)), $9) RETURNING id`,
        [caller.tenantId, input.stationId, input.shelfId, start, new Date(input.end), bufferEnd, minutes, config.holdSeconds, col.text(pack, "id")],
      )), "id");
      for (const stationId of occupying) {
        await tx.query("INSERT INTO booking_occupancies (booking_id, station_id, start_at, buffer_end) VALUES ($1, $2, $3, $4)",
          [id, stationId, start, bufferEnd]);
      }
      return bookingView(await readBooking(tx, id), caller.role, time);
    });
  } catch (error) {
    if (error instanceof PgError && CONTENTION.includes(error.code)) {
      throw conflict("slot_taken", "Someone else holds that station for an overlapping span.");
    }
    throw error;
  }
}

// ---- Transitions --------------------------------------------------------------------------

/** The edges each action may leave from; anything else is invalid_transition. */
const EDGES = {
  confirm: ["held"],
  cancel: ["held", "confirmed"],
  checkOut: ["checked_in"],
} as const satisfies Record<string, readonly BookingStatus[]>;

function requireEdge(b: BookingRecord, action: keyof typeof EDGES): void {
  const from: readonly BookingStatus[] = EDGES[action];
  if (!from.includes(b.status)) throw conflict("invalid_transition", `A ${b.status.replace("_", " ")} booking can't take that action.`);
}

/** The mail both the confirmation and the move queue: the booking's seven lines, and for a move the span it left. */
async function queueBookingEmail(tx: Queryable, action: "booking_confirmed" | "booking_moved", b: BookingRecord, minutes: number, was?: string): Promise<void> {
  const [figures] = await tx.query("SELECT balance_minutes FROM pack_figures WHERE id = $1", [b.packId]);
  const when = (t: Date): string => `${dateText(t)} ${clockAt(t)} ${zone}`;
  await queueEmail(tx, {
    action, recordId: b.id, toName: b.contactName, to: b.tenantEmail,
    subject: `${action === "booking_confirmed" ? "Booking confirmed" : "Booking moved"}: ${b.stationName} on ${dateText(b.start)}`,
    lines: [`Station: ${b.stationName}`, `Shelf: ${b.shelfName ?? "none"}`, `Starts: ${when(b.start)}`, `Ends: ${when(b.end)}`,
      `Hours debited: ${duration(minutes)}`, `Pack balance: ${duration(figures ? col.int(figures, "balance_minutes") : 0)}`, `Booking reference: ${b.id}`,
      ...(was ? [`Was: ${was}`] : [])],
  });
}

/** held → confirmed: debits the reserved pack as one paired movement and queues the email. */
export async function confirmHold(caller: Caller, id: string): Promise<Booking> {
  return db.transaction(async (tx) => {
    const time = await kitchenTime(tx);
    const b = await lockBooking(tx, id);
    if (b.status === "cancelled" && b.cancelReason === "hold_expired") throw conflict("hold_expired", "The hold ran out before it was confirmed.");
    if (b.status === "confirmed") return bookingView(b, caller.role, time);
    requireEdge(b, "confirm");
    if (lapse(b.cover, localDate(b.start.getTime(), zone)) !== null) throw conflict("documents_not_valid", "Your documents don't cover that date.");
    await writeMovement(tx, "booking_debit", b.packId, -b.minutes, b.id);
    await tx.query("UPDATE bookings SET status = 'confirmed', debited_minutes = $2 WHERE id = $1", [b.id, b.minutes]);
    await queueBookingEmail(tx, "booking_confirmed", b, b.minutes);
    return bookingView(await readBooking(tx, id), caller.role, time);
  });
}

/** held → cancelled (releases every station and the reservation) or confirmed → cancelled under the cutoff rule. */
export async function cancel(caller: Caller, id: string): Promise<Booking> {
  return db.transaction(async (tx) => {
    const time = await kitchenTime(tx);
    const b = await lockBooking(tx, id);
    requireEdge(b, "cancel");
    const refunded = cancelCreditMinutes(b, time);
    if (refunded !== null && refunded > 0) await writeMovement(tx, "cancellation_credit", b.packId, refunded, b.id);
    await tx.query("UPDATE bookings SET status = 'cancelled', cancel_reason = 'tenant', refunded_minutes = $2 WHERE id = $1", [b.id, refunded]);
    return bookingView(await readBooking(tx, id), caller.role, time);
  });
}

/**
 * confirmed → confirmed, once: replaces the occupancy, span, minutes and ledger in one step, so at no
 * moment is the old slot free for a rival. A refusal rolls everything back and the old slot stays.
 */
export async function move(caller: TenantCaller, id: string, input: BookingShape): Promise<Booking> {
  const occupying = (input.shelfId ? [input.stationId, input.shelfId] : [input.stationId]).sort();
  const start = new Date(input.start);
  const bufferEnd = new Date(input.end + CLEANUP_MINUTES * MINUTE_MS);
  const minutes = bookingMinutes(Math.round((input.end - input.start) / MINUTE_MS), occupying.length);
  try {
    return await db.transaction(async (tx) => {
      const time = await kitchenTime(tx);
      const b = await lockBooking(tx, id);
      const refusal = moveRefusal(b, time);
      if (refusal) throw conflict(refusal, MOVE_REFUSALS[refusal]);
      const tenant = await findTenant(tx, b.tenantId, true);
      if (!tenant) throw new Error(`tenant ${b.tenantId} vanished`);
      if (tenantStatus(tenant.onboarding, tenant.cover, time.today).status !== "approved") {
        throw conflict("tenant_not_approved", "This account can't book until it is approved.");
      }
      if (lapse(tenant.cover, localDate(input.start, zone)) !== null) throw conflict("documents_not_valid", "Your documents don't cover that date.");
      const current = b.debitedMinutes ?? b.minutes;
      const [pack] = await tx.query("SELECT available_minutes FROM pack_figures WHERE id = $1", [b.packId]);
      if (minutes > current && (!pack || col.int(pack, "available_minutes") < minutes - current)) {
        throw conflict("insufficient_hours", "This booking's pack doesn't have enough hours available for that span.");
      }
      const involved = [...new Set([...occupied(b), ...occupying])].sort();
      for (const stationId of involved) await tx.query("SELECT pg_advisory_xact_lock(hashtext('station:' || $1))", [stationId]);
      for (const stationId of occupying) await releaseOverlappingHolds(tx, stationId, start, bufferEnd);
      const was = `${dateText(b.start)} ${clockAt(b.start)}–${clockAt(b.end)} ${stationsText(b)}`;
      await tx.query("DELETE FROM booking_occupancies WHERE booking_id = $1", [id]);
      await tx.query(
        `UPDATE bookings SET station_id = $2, shelf_id = $3, start_at = $4, end_at = $5, buffer_end = $6, minutes = $7,
                debited_minutes = $7, move_count = 1 WHERE id = $1`,
        [id, input.stationId, input.shelfId, start, new Date(input.end), bufferEnd, minutes],
      );
      for (const stationId of occupying) {
        await tx.query("INSERT INTO booking_occupancies (booking_id, station_id, start_at, buffer_end) VALUES ($1, $2, $3, $4)", [id, stationId, start, bufferEnd]);
      }
      if (minutes !== current) await writeMovement(tx, "move_adjustment", b.packId, current - minutes, id);
      const moved = await readBooking(tx, id);
      await queueBookingEmail(tx, "booking_moved", moved, minutes, was);
      return bookingView(moved, caller.role, time);
    });
  } catch (error) {
    if (error instanceof PgError && CONTENTION.includes(error.code)) {
      throw conflict("slot_taken", "Someone else holds that station for an overlapping span.");
    }
    throw error;
  }
}

const MOVE_REFUSALS = {
  invalid_transition: "Only a confirmed booking can be moved.",
  past_cutoff: "This booking is past its cancellation cutoff, so it can no longer be moved.",
  move_limit_reached: "This booking has already been moved once.",
} as const;

const stationsText = (b: BookingRecord): string => (b.shelfName ? `${b.stationName} and ${b.shelfName}` : b.stationName);

/** Appends the door-log entry of a successful door action, in the same step as its transition. */
async function logDoor(tx: Queryable, caller: Caller, bookingId: string, action: DoorAction): Promise<void> {
  await tx.query("INSERT INTO door_log (booking_id, action, by_user_id, by_name) VALUES ($1, $2, $3, $4)",
    [bookingId, action, caller.userId, caller.displayName]);
}

const DOOR_REFUSALS = {
  invalid_transition: "This booking isn't in a state that allows that door action.",
  outside_check_in_window: "Check-in opens 30 minutes before the start and closes at the end.",
  not_cleared: "This tenant is not cleared for the floor today.",
  too_early: "The booking hasn't started yet.",
} as const;

/** confirmed → checked_in by staff, from 30 minutes before start until end, when cleared today. */
export async function checkIn(caller: Caller, id: string): Promise<Booking> {
  return db.transaction(async (tx) => {
    const time = await kitchenTime(tx);
    const b = await lockBooking(tx, id);
    const refusal = checkInRefusal(b, time);
    if (refusal) throw conflict(refusal, DOOR_REFUSALS[refusal]);
    await tx.query("UPDATE bookings SET status = 'checked_in' WHERE id = $1", [b.id]);
    await logDoor(tx, caller, b.id, "check_in");
    return bookingView(await readBooking(tx, id), caller.role, time);
  });
}

/** checked_in → completed with the cleanup note. */
export async function checkOut(caller: Caller, id: string, note: string | null): Promise<Booking> {
  return db.transaction(async (tx) => {
    const time = await kitchenTime(tx);
    const b = await lockBooking(tx, id);
    requireEdge(b, "checkOut");
    await tx.query("UPDATE bookings SET status = 'completed', cleanup_note = $2 WHERE id = $1", [b.id, note]);
    await logDoor(tx, caller, b.id, "check_out");
    return bookingView(await readBooking(tx, id), caller.role, time);
  });
}

/** confirmed → no_show by staff once the start has passed. */
export async function noShow(caller: Caller, id: string): Promise<Booking> {
  return db.transaction(async (tx) => {
    const time = await kitchenTime(tx);
    const b = await lockBooking(tx, id);
    const refusal = noShowRefusal(b, time);
    if (refusal) throw conflict(refusal, DOOR_REFUSALS[refusal]);
    await tx.query("UPDATE bookings SET status = 'no_show' WHERE id = $1", [b.id]);
    await logDoor(tx, caller, b.id, "no_show");
    return bookingView(await readBooking(tx, id), caller.role, time);
  });
}

// ---- Daily usage --------------------------------------------------------------------------

const USAGE_STATUSES: readonly BookingStatus[] = ["confirmed", "checked_in", "completed", "no_show"];

/**
 * Booked minutes for bookings starting on one kitchen date: each station counts the span (no buffer)
 * of every booking occupying it, so a paired booking counts on both; each tenant counts booking minutes.
 */
export async function dailyReport(date: string): Promise<DailyReport> {
  const [all, day] = await Promise.all([stations(db), bookingsOn(db, date)]);
  const counted = day.filter((b) => USAGE_STATUSES.includes(b.status));
  const span = (b: BookingRecord): number => Math.round((b.end.getTime() - b.start.getTime()) / MINUTE_MS);
  const perStation = all.map((s) => {
    const here = counted.filter((b) => occupied(b).includes(s.id));
    return { stationId: s.id, stationName: s.name, bookedMinutes: here.reduce((sum, b) => sum + span(b), 0), bookingCount: here.length };
  });
  const tenants = new Map<string, DailyReport["tenants"][number]>();
  for (const b of counted) {
    const row = tenants.get(b.tenantId) ?? { tenantId: b.tenantId, businessName: b.tenantName, bookedMinutes: 0, bookingCount: 0, noShowCount: 0 };
    row.bookedMinutes += b.minutes;
    row.bookingCount += 1;
    if (b.status === "no_show") row.noShowCount += 1;
    tenants.set(b.tenantId, row);
  }
  return {
    date, timeZone: zone,
    totalBookedMinutes: perStation.reduce((sum, s) => sum + s.bookedMinutes, 0),
    stations: perStation,
    tenants: [...tenants.values()].sort((a, b) => a.businessName.localeCompare(b.businessName)),
  };
}

function dateText(t: Date): string {
  return dateLabel(localDate(t.getTime(), zone));
}

function clockAt(t: Date): string {
  return clockText(localMinute(t.getTime(), zone));
}
