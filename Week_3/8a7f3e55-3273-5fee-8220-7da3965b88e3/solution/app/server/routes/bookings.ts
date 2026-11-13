import type { AuditEntry, Booking, Role, Setting } from "../../shared/api.js";
import { addDays, daysBetween, parseLocalDate } from "../../shared/calendar.js";
import { isBeforeCheckIn, isChargedCancellation } from "../../shared/status.js";
import { TEXT_LIMITS, textWithin } from "../../shared/text.js";
import { addMinutes, isoAt, localDateAt, resolveStart } from "../agency.js";
import { createInvoiceLine } from "../billing.js";
import {
  type BookingData,
  canView,
  holdsSeat,
  isOffered,
  loadBooking,
  loadBookings,
  openCallStatusOf,
  presentBooking,
  statusOf,
} from "../bookings.js";
import { quoteCancellation } from "../cancellation.js";
import { config } from "../config.js";
import { loadContract } from "../contracts.js";
import { one, rows } from "../db.js";
import { cancellationEmails } from "../emails.js";
import { apiErrors } from "../errors.js";
import { type AuthedCtx, type Reply, created, ok, route } from "../http.js";
import { FIELD_MESSAGES } from "../messages.js";
import { isQualified } from "../rules/qualification.js";
import { openCallClosesAt, openCallStatus } from "../rules/openCall.js";
import { completionBasisMinutes } from "../rules/pricing.js";
import { seatCountFor } from "../rules/status.js";
import { busyInterpreterIds, enqueueEmail, fillSeat, findInterpreter, lockInterpreter, recordAudit } from "../seatOps.js";
import { kickWorkers } from "../workers.js";

const SETTINGS: readonly Setting[] = ["medical", "educational", "legal", "workplace"];
const SOONEST_START_MINUTES = 15;

export function requireRole(ctx: AuthedCtx, ...roles: Role[]): void {
  if (!roles.includes(ctx.user.role)) throw apiErrors.forbidden();
}

export function parseId(text: string): number {
  if (!/^\d{1,9}$/.test(text)) throw apiErrors.notFound();
  return Number(text);
}

/**
 * The booking; invisible bookings answer as not found. `lock` true locks it for the caller's transaction. `"after-writers"`
 * waits for a write already holding the booking, so a read never answers with a state older than a write in flight.
 */
export async function visibleBooking(ctx: AuthedCtx, idText: string, lock: boolean | "after-writers" = false): Promise<BookingData> {
  const id = parseId(idText);
  if (lock === true) await ctx.db.query("SELECT id FROM bookings WHERE id = $1 FOR UPDATE", [id]);
  if (lock === "after-writers") await ctx.db.query("SELECT id FROM bookings WHERE id = $1 FOR SHARE", [id]);
  const data = await loadBooking(ctx.db, id);
  if (data === null || !canView(data, ctx.user)) throw apiErrors.notFound();
  return data;
}

/** The body when it parses, an empty object when it does not: the caller's role and ids are checked before validation. */
function peekJson(ctx: AuthedCtx): Record<string, unknown> {
  try {
    return ctx.json();
  } catch {
    return {};
  }
}

function requireStatus(data: BookingData, allowed: (status: ReturnType<typeof statusOf>) => boolean): void {
  const status = statusOf(data);
  if (!allowed(status)) throw apiErrors.invalidTransition(status);
}

const respond = async (ctx: AuthedCtx, id: number): Promise<Booking> => {
  const data = await loadBooking(ctx.db, id);
  if (data === null) throw apiErrors.notFound();
  return presentBooking(data, ctx.user, ctx.nowMs);
};

const PHONE_CHARACTERS = /^[0-9 +\-()]+$/;

/** Whole minutes from 30 to 480 in 15-minute steps. */
const isDurationMinutes = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 30 && value <= 480 && value % 15 === 0;

interface NewBooking {
  orgId: string;
  requesterId: string;
  setting: Setting;
  title: string;
  location: string;
  onsiteContactName: string;
  onsiteContactPhone: string;
  consumerName: string;
  requesterNotes: string;
  startMs: number;
  durationMinutes: number;
}

async function validateNewBooking(ctx: AuthedCtx): Promise<NewBooking> {
  const body = ctx.json();
  const fields: Record<string, string> = {};
  let orgId = ctx.user.org_id ?? "";
  let requesterId = ctx.user.id;
  if (ctx.user.role === "coordinator") {
    const org = typeof body["org_id"] === "string" ? await one<{ id: string }>(ctx.db, "SELECT id FROM organisations WHERE id = $1", [body["org_id"]]) : null;
    if (org === null) fields["org_id"] = FIELD_MESSAGES.org_id;
    else {
      orgId = org.id;
      requesterId = (await one<{ id: string }>(ctx.db, "SELECT id FROM users WHERE role = 'requester' AND org_id = $1 ORDER BY id LIMIT 1", [org.id]))?.id ?? "";
    }
  }
  const setting = SETTINGS.find((candidate) => candidate === body["setting"]);
  if (setting === undefined) fields["setting"] = FIELD_MESSAGES.setting;
  const text = (name: "title" | "location" | "onsite_contact_name" | "consumer_name"): string => {
    const value = body[name];
    if (!textWithin(value, 1, TEXT_LIMITS[name])) {
      fields[name] = FIELD_MESSAGES[name];
      return "";
    }
    return value;
  };
  const title = text("title");
  const location = text("location");
  const onsiteContactName = text("onsite_contact_name");
  const consumerName = text("consumer_name");
  const phoneValue = body["onsite_contact_phone"];
  const phone = textWithin(phoneValue, 7, 25) && PHONE_CHARACTERS.test(phoneValue) ? phoneValue : "";
  if (phone === "") fields["onsite_contact_phone"] = FIELD_MESSAGES.onsite_contact_phone;
  const durationValue = body["duration_minutes"];
  const duration = isDurationMinutes(durationValue) ? durationValue : 0;
  if (duration === 0) fields["duration_minutes"] = FIELD_MESSAGES.duration_minutes;
  const notesValue = body["requester_notes"] ?? "";
  const notes = textWithin(notesValue, 0, TEXT_LIMITS.requester_notes) ? notesValue : "";
  if (notes !== notesValue) fields["requester_notes"] = FIELD_MESSAGES.requester_notes;

  const start = resolveStart(body["start"]);
  let startMs = 0;
  if (start.kind === "format") fields["start"] = FIELD_MESSAGES.startFormat;
  else if (start.kind === "skipped") fields["start"] = FIELD_MESSAGES.startSkipped;
  else if (start.instant < addMinutes(ctx.nowMs, SOONEST_START_MINUTES)) fields["start"] = FIELD_MESSAGES.startSoon;
  else startMs = start.instant;

  if (setting === undefined || Object.keys(fields).length > 0) throw apiErrors.validation(fields);
  return {
    orgId,
    requesterId,
    setting,
    title,
    location,
    onsiteContactName,
    onsiteContactPhone: phone,
    consumerName,
    requesterNotes: notes,
    startMs,
    durationMinutes: duration,
  };
}

function listRange(ctx: AuthedCtx): { from: string; to: string } {
  const today = localDateAt(ctx.nowMs);
  const fromText = ctx.query.get("from");
  const toText = ctx.query.get("to");
  const fields: Record<string, string> = {};
  if (fromText !== null && parseLocalDate(fromText) === null) fields["from"] = FIELD_MESSAGES.range;
  if (toText !== null && parseLocalDate(toText) === null) fields["to"] = FIELD_MESSAGES.range;
  const from = fromText ?? today;
  const to = toText ?? addDays(from, 13);
  if (Object.keys(fields).length === 0 && (daysBetween(from, to) > 31 || daysBetween(from, to) < 0)) fields["to"] = FIELD_MESSAGES.range;
  if (Object.keys(fields).length > 0) throw apiErrors.validation(fields);
  return { from, to };
}

async function listBookings(ctx: AuthedCtx): Promise<Booking[]> {
  const { from, to } = listRange(ctx);
  const scope =
    ctx.user.role === "requester"
      ? "AND org_id = $3"
      : ctx.user.role === "interpreter"
        ? "AND id IN (SELECT booking_id FROM seats WHERE interpreter_id = $3)"
        : "AND $3::text IS NULL";
  const scopeValue = ctx.user.role === "requester" ? ctx.user.org_id : ctx.user.role === "interpreter" ? ctx.user.id : null;
  const ids = await rows<{ id: number }>(ctx.db, `SELECT id FROM bookings WHERE start_date BETWEEN $1 AND $2 ${scope} ORDER BY start_at, id`, [from, to, scopeValue]);
  const found = await loadBookings(ctx.db, ids.map((row) => row.id));
  return found.map((data) => presentBooking(data, ctx.user, ctx.nowMs));
}

async function openCalls(ctx: AuthedCtx): Promise<Booking[]> {
  const ids = await rows<{ id: number }>(
    ctx.db,
    `SELECT b.id FROM bookings b
      WHERE b.phase = 'active' AND b.open_call_closes_at > $1
        AND EXISTS (SELECT 1 FROM seats s WHERE s.booking_id = b.id AND s.interpreter_id IS NULL)
        AND NOT EXISTS (SELECT 1 FROM seats s WHERE s.booking_id = b.id AND s.interpreter_id = $2)
      ORDER BY b.start_at, b.id`,
    [new Date(ctx.nowMs), ctx.user.id],
  );
  const found = await loadBookings(ctx.db, ids.map((row) => row.id));
  return found.filter((data) => isOffered(data, ctx.user)).map((data) => presentBooking(data, ctx.user, ctx.nowMs));
}

function lowestVacantSeat(data: BookingData): number | null {
  return data.seats.find((seat) => seat.interpreter_id === null)?.seat ?? null;
}

async function claim(ctx: AuthedCtx): Promise<Reply> {
  const data = await visibleBooking(ctx, ctx.params["id"] ?? "", true);
  requireRole(ctx, "interpreter");
  requireStatus(data, isBeforeCheckIn);
  if (holdsSeat(data, ctx.user.id)) throw apiErrors.alreadyHolding();
  const seat = lowestVacantSeat(data);
  if (seat === null) throw apiErrors.seatFilled();
  if (openCallStatusOf(data.row, ctx.nowMs) !== "open") throw apiErrors.openCallClosed();
  await lockInterpreter(ctx.db, ctx.user.id);
  if ((await busyInterpreterIds(ctx.db, data)).has(ctx.user.id)) throw apiErrors.scheduleConflict();
  const interpreter = await findInterpreter(ctx.db, ctx.user.id);
  if (interpreter === null) throw apiErrors.notFound();
  const after = await fillSeat(ctx.db, data, seat, interpreter, ctx.user.name);
  ctx.afterCommit(kickWorkers);
  return ok(presentBooking(after, ctx.user, ctx.nowMs));
}

async function assign(ctx: AuthedCtx): Promise<Reply> {
  const data = await visibleBooking(ctx, ctx.params["id"] ?? "", true);
  const interpreterId = peekJson(ctx)["interpreter_id"];
  const interpreter = typeof interpreterId === "string" && interpreterId !== "" ? await findInterpreter(ctx.db, interpreterId) : null;
  if (typeof interpreterId === "string" && interpreterId !== "" && interpreter === null) throw apiErrors.notFound();
  requireRole(ctx, "coordinator");
  const body = ctx.json();
  const fields: Record<string, string> = {};
  if (interpreter === null) fields["interpreter_id"] = FIELD_MESSAGES.interpreter_id;
  const seat = body["seat"];
  if (typeof seat !== "number" || !Number.isInteger(seat) || seat < 1 || seat > data.row.seat_count) fields["seat"] = FIELD_MESSAGES.seat;
  if (interpreter === null || typeof seat !== "number" || Object.keys(fields).length > 0) throw apiErrors.validation(fields);
  requireStatus(data, isBeforeCheckIn);
  if (data.seats.some((candidate) => candidate.interpreter_id === interpreter.user_id)) throw apiErrors.alreadyHolding();
  if (data.seats.find((candidate) => candidate.seat === seat)?.interpreter_id) throw apiErrors.seatFilled();
  const credentials = await rows<{ code: string; expires_on: string }>(ctx.db, "SELECT code, expires_on FROM credentials WHERE interpreter_id = $1", [interpreter.user_id]);
  if (!isQualified(credentials, data.row.setting, data.row.start_date)) throw apiErrors.notQualified();
  await lockInterpreter(ctx.db, interpreter.user_id);
  if ((await busyInterpreterIds(ctx.db, data)).has(interpreter.user_id)) throw apiErrors.scheduleConflict();
  const after = await fillSeat(ctx.db, data, seat, interpreter, ctx.user.name);
  ctx.afterCommit(kickWorkers);
  return ok(presentBooking(after, ctx.user, ctx.nowMs));
}

async function release(ctx: AuthedCtx): Promise<Reply> {
  const data = await visibleBooking(ctx, ctx.params["id"] ?? "", true);
  const seatText = ctx.params["seat"] ?? "";
  const seatNumber = /^\d{1,3}$/.test(seatText) ? Number(seatText) : 0;
  const seat = data.seats.find((candidate) => candidate.seat === seatNumber);
  if (seat === undefined) throw apiErrors.notFound();
  const holderReleasing = ctx.user.role === "interpreter" && seat.interpreter_id === ctx.user.id;
  if (ctx.user.role !== "coordinator" && !holderReleasing) throw apiErrors.forbidden();
  const before = statusOf(data);
  if ((before !== "partially_covered" && before !== "covered") || seat.interpreter_id === null) throw apiErrors.invalidTransition(before);
  await ctx.db.query("UPDATE seats SET interpreter_id = NULL WHERE booking_id = $1 AND seat = $2", [data.row.id, seatNumber]);
  const after = await loadBooking(ctx.db, data.row.id);
  if (after === null) throw apiErrors.notFound();
  await recordAudit(ctx.db, data.row.id, ctx.user.name, "seat_released", before, statusOf(after), seatNumber, seat.name);
  return ok(presentBooking(after, ctx.user, ctx.nowMs));
}

async function cancelBooking(ctx: AuthedCtx): Promise<Reply> {
  const data = await visibleBooking(ctx, ctx.params["id"] ?? "", true);
  requireRole(ctx, "requester", "coordinator");
  const quoted = ctx.json()["quoted_charge_cents"];
  if (typeof quoted !== "number" || !Number.isInteger(quoted) || quoted < 0) {
    throw apiErrors.validation({ quoted_charge_cents: FIELD_MESSAGES.quoted_charge_cents });
  }
  requireStatus(data, isBeforeCheckIn);
  const contract = await loadContract(ctx.db, data.row.org_id);
  const quote = quoteCancellation(data, contract, ctx.nowMs);
  if (quote.charge_cents !== quoted) throw apiErrors.quoteChanged(quote);
  const before = statusOf(data);
  const charged = isChargedCancellation(quote);
  if (charged) await createInvoiceLine(ctx.db, data, contract, "late_cancellation", data.row.duration_minutes, 0, ctx.nowMs);
  await ctx.db.query("UPDATE bookings SET phase = $2 WHERE id = $1", [data.row.id, charged ? "cancelled_late" : "cancelled"]);
  const after = await loadBooking(ctx.db, data.row.id);
  if (after === null) throw apiErrors.notFound();
  await recordAudit(ctx.db, data.row.id, ctx.user.name, "cancelled", before, statusOf(after));
  for (const message of cancellationEmails(after, charged ? quote.charge_cents : null)) await enqueueEmail(ctx.db, message);
  ctx.afterCommit(kickWorkers);
  return ok(presentBooking(after, ctx.user, ctx.nowMs));
}

async function checkIn(ctx: AuthedCtx): Promise<Reply> {
  const data = await visibleBooking(ctx, ctx.params["id"] ?? "", true);
  requireRole(ctx, "coordinator");
  requireStatus(data, (status) => status === "covered");
  await ctx.db.query("UPDATE bookings SET phase = 'in_progress' WHERE id = $1", [data.row.id]);
  await recordAudit(ctx.db, data.row.id, ctx.user.name, "checked_in", "covered", "in_progress");
  return ok(await respond(ctx, data.row.id));
}

async function complete(ctx: AuthedCtx): Promise<Reply> {
  const data = await visibleBooking(ctx, ctx.params["id"] ?? "", true);
  requireRole(ctx, "coordinator");
  const body = ctx.json();
  const fields: Record<string, string> = {};
  const worked = body["worked_minutes"];
  const miles = body["mileage_miles"];
  if (typeof worked !== "number" || !Number.isInteger(worked) || worked < 1 || worked > 720) fields["worked_minutes"] = FIELD_MESSAGES.worked_minutes;
  if (typeof miles !== "number" || !Number.isInteger(miles) || miles < 0 || miles > 500) fields["mileage_miles"] = FIELD_MESSAGES.mileage_miles;
  if (typeof worked !== "number" || typeof miles !== "number" || Object.keys(fields).length > 0) throw apiErrors.validation(fields);
  requireStatus(data, (status) => status === "in_progress");
  const contract = await loadContract(ctx.db, data.row.org_id);
  await createInvoiceLine(ctx.db, data, contract, "completed", completionBasisMinutes(data.row.duration_minutes, worked), miles, ctx.nowMs);
  await ctx.db.query("UPDATE bookings SET phase = 'completed', completed_at = $2 WHERE id = $1", [data.row.id, new Date(ctx.nowMs)]);
  await recordAudit(ctx.db, data.row.id, ctx.user.name, "completed", "in_progress", "completed");
  ctx.afterCommit(kickWorkers);
  return ok(await respond(ctx, data.row.id));
}

export function registerBookingRoutes(): void {
  route("GET", "/api/bookings", async (ctx) => ok({ bookings: await listBookings(ctx) }));

  route("POST", "/api/bookings", async (ctx) => {
    requireRole(ctx, "requester", "coordinator");
    const input = await validateNewBooking(ctx);
    const inserted = await rows<{ id: number }>(
      ctx.db,
      `INSERT INTO bookings (ref, org_id, requester_id, setting, title, location, onsite_contact_name, onsite_contact_phone,
          consumer_name, requester_notes, start_at, end_at, start_date, duration_minutes, seat_count)
       VALUES ('BK-' || nextval('booking_ref_seq'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id`,
      [
        input.orgId,
        input.requesterId,
        input.setting,
        input.title,
        input.location,
        input.onsiteContactName,
        input.onsiteContactPhone,
        input.consumerName,
        input.requesterNotes,
        new Date(input.startMs),
        new Date(addMinutes(input.startMs, input.durationMinutes)),
        localDateAt(input.startMs),
        input.durationMinutes,
        seatCountFor(input.durationMinutes, input.setting),
      ],
    );
    const id = inserted[0]?.id ?? 0;
    await ctx.db.query(
      "INSERT INTO seats (booking_id, seat) SELECT $1, generate_series(1, seat_count) FROM bookings WHERE id = $1",
      [id],
    );
    await recordAudit(ctx.db, id, ctx.user.name, "submitted", null, "submitted");
    return created(await respond(ctx, id));
  });

  route("GET", "/api/open-calls", async (ctx) => {
    requireRole(ctx, "interpreter");
    return ok({ bookings: await openCalls(ctx) });
  });

  route("GET", "/api/bookings/:id", async (ctx) => ok(presentBooking(await visibleBooking(ctx, ctx.params["id"] ?? "", "after-writers"), ctx.user, ctx.nowMs)));

  route("POST", "/api/bookings/:id/team", async (ctx) => {
    const data = await visibleBooking(ctx, ctx.params["id"] ?? "", true);
    requireRole(ctx, "coordinator");
    requireStatus(data, isBeforeCheckIn);
    if (data.row.seat_count === 2) throw apiErrors.alreadyTeam();
    const before = statusOf(data);
    await ctx.db.query("UPDATE bookings SET seat_count = 2 WHERE id = $1", [data.row.id]);
    await ctx.db.query("INSERT INTO seats (booking_id, seat) VALUES ($1, 2)", [data.row.id]);
    const after = await loadBooking(ctx.db, data.row.id);
    if (after === null) throw apiErrors.notFound();
    await recordAudit(ctx.db, data.row.id, ctx.user.name, "made_team", before, statusOf(after));
    return ok(presentBooking(after, ctx.user, ctx.nowMs));
  });

  route("POST", "/api/bookings/:id/open-call", async (ctx) => {
    const data = await visibleBooking(ctx, ctx.params["id"] ?? "", true);
    requireRole(ctx, "coordinator");
    requireStatus(data, (status) => status === "submitted");
    const closesAt = openCallClosesAt(data.row.start_at.getTime(), config.openCallLeadMinutes);
    if (openCallStatus(closesAt, ctx.nowMs) === "closed") throw apiErrors.openCallClosed();
    await ctx.db.query("UPDATE bookings SET open_call_posted_at = $2, open_call_closes_at = $3 WHERE id = $1", [
      data.row.id,
      new Date(ctx.nowMs),
      new Date(closesAt),
    ]);
    await recordAudit(ctx.db, data.row.id, ctx.user.name, "open_call_published", "submitted", "open");
    return ok(await respond(ctx, data.row.id));
  });

  route("POST", "/api/bookings/:id/claim", claim);
  route("POST", "/api/bookings/:id/assign", assign);
  route("POST", "/api/bookings/:id/seats/:seat/release", release);

  route("GET", "/api/bookings/:id/cancellation-quote", async (ctx) => {
    const data = await visibleBooking(ctx, ctx.params["id"] ?? "");
    requireRole(ctx, "requester", "coordinator");
    requireStatus(data, isBeforeCheckIn);
    return ok(quoteCancellation(data, await loadContract(ctx.db, data.row.org_id), ctx.nowMs));
  });

  route("POST", "/api/bookings/:id/cancel", cancelBooking);
  route("POST", "/api/bookings/:id/check-in", checkIn);
  route("POST", "/api/bookings/:id/complete", complete);

  route("GET", "/api/bookings/:id/audit", async (ctx) => {
    const data = await visibleBooking(ctx, ctx.params["id"] ?? "");
    requireRole(ctx, "coordinator", "billing_manager");
    const entries = await rows<Omit<AuditEntry, "at"> & { at: Date }>(
      ctx.db,
      "SELECT at, actor_name, action, from_status, to_status, seat, interpreter_name FROM audit_entries WHERE booking_id = $1 ORDER BY id",
      [data.row.id],
    );
    return ok({ entries: entries.map((entry) => ({ ...entry, at: isoAt(entry.at.getTime()) })) });
  });
}
