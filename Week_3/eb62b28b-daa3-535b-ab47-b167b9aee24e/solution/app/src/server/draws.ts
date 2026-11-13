// Slots, booking and the draw's state changes: wall-clock slots, the one-booking rule, the member cutoff.

import { randomBytes, randomUUID } from "node:crypto";
import type { DrawState, DrawView, Slot, VisitPageView } from "../shared/api";
import { dateTimeIn, formatDate } from "../shared/format";
import { addDays, cityOf, instantOf, isIsoDate, localDate, weekdayOf, wholeSeconds, type TimeZone } from "../shared/time";
import { stateName } from "./catalog";
import { config } from "./config";
import { inTransaction, isUniqueViolation, one, pool, rows, type Db } from "./db";
import { notBooked, requireBooked, visitPageHasEnded } from "./drawStates";
import { type ApiError, conflict, invalid, notFound, refuseWhileClosing } from "./errors";
import { list, text, type JsonBody } from "./fields";
import { kitCodeRefusal, normalizeKitCode } from "./kitCodes";
import { enqueueMail } from "./mail";
import type { LiveMember } from "./members";

const SLOT_TIMES = Array.from({ length: 12 }, (_, index) => {
  const minutes = 6 * 60 + index * 20;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});
const SUNDAY = 0;
const STAFF_WINDOW_DAYS = 400;
const MEMBER_WINDOW_DAYS = 28;

export interface DrawRow {
  id: string;
  member_id: string;
  member_name: string;
  phlebotomist_id: string;
  phlebotomist_name: string;
  phlebotomist_email: string;
  state: DrawState;
  starts_at: Date;
  local_date: string;
  local_time: string;
  time_zone: TimeZone;
  collected_at: Date | null;
  kit_codes: string[];
  has_results: boolean;
  has_report: boolean;
  visit_ends_at: Date | null;
  visit_ended_at: Date | null;
}

const SELECT_DRAW = `
  SELECT d.*, p.name AS member_name, ph.name AS phlebotomist_name, ph.email AS phlebotomist_email, m.time_zone,
    EXISTS (SELECT 1 FROM results r WHERE r.draw_id = d.id) AS has_results,
    EXISTS (SELECT 1 FROM reports r WHERE r.draw_id = d.id) AS has_report,
    v.ends_at AS visit_ends_at, v.ended_at AS visit_ended_at
  FROM draws d
  JOIN members m ON m.id = d.member_id
  JOIN people p ON p.id = d.member_id
  JOIN phlebotomists ph ON ph.id = d.phlebotomist_id
  LEFT JOIN LATERAL (SELECT ends_at, ended_at FROM visit_pages WHERE draw_id = d.id ORDER BY sent_at DESC LIMIT 1) v ON true`;

export async function drawRow(db: Db, id: string): Promise<DrawRow | undefined> {
  return one<DrawRow>(db, `${SELECT_DRAW} WHERE d.id = $1`, [id]);
}

export async function drawRows(where: string, params: unknown[], order: string): Promise<DrawRow[]> {
  return rows<DrawRow>(pool, `${SELECT_DRAW} WHERE ${where} ORDER BY ${order}`, params);
}

function changesCloseAt(date: string, zone: TimeZone): Date {
  return instantOf(addDays(date, -1), "18:00", zone);
}

function visitPageView(row: DrawRow, now: Date): VisitPageView {
  if (!row.visit_ends_at) return { state: "none", endsAt: null };
  return {
    state: visitPageHasEnded(row.visit_ended_at, row.visit_ends_at, now) ? "ended" : "live",
    endsAt: wholeSeconds(row.visit_ended_at ?? row.visit_ends_at),
  };
}

export function drawView(row: DrawRow, now: Date, audience: "staff" | "member"): DrawView {
  return {
    id: row.id,
    memberId: row.member_id,
    ...(audience === "staff" ? { memberName: row.member_name } : {}),
    phlebotomistId: row.phlebotomist_id,
    phlebotomistName: row.phlebotomist_name,
    state: row.state,
    startsAt: wholeSeconds(row.starts_at),
    localDate: row.local_date,
    localTime: row.local_time,
    timeZone: row.time_zone,
    collectedAt: row.collected_at ? wholeSeconds(row.collected_at) : null,
    kitCodes: row.kit_codes,
    hasResults: row.has_results,
    changesCloseAt: wholeSeconds(changesCloseAt(row.local_date, row.time_zone)),
    visitPage: visitPageView(row, now),
  };
}

interface PhlebotomistRow {
  id: string;
  name: string;
  email: string;
  states: string[];
}

export async function phlebotomists(): Promise<PhlebotomistRow[]> {
  return rows<PhlebotomistRow>(pool, "SELECT id, name, email, states FROM phlebotomists ORDER BY position");
}

async function phlebotomist(db: Db, id: string): Promise<PhlebotomistRow | undefined> {
  return one<PhlebotomistRow>(db, "SELECT id, name, email, states FROM phlebotomists WHERE id = $1", [id]);
}

export async function phlebotomistExists(id: string): Promise<boolean> {
  return (await phlebotomist(pool, id)) !== undefined;
}

// A staff booking today may use any of the 12 times on any day; every other date keeps Monday to Saturday.
function slotTimesOn(date: string, today: string, audience: "staff" | "member"): readonly string[] {
  if (audience === "staff" && date === today) return SLOT_TIMES;
  return weekdayOf(date) === SUNDAY ? [] : SLOT_TIMES;
}

export function requireDate(value: string | null, field: string): string {
  if (value === null || !isIsoDate(value)) throw invalid({ [field]: "Enter the date as YYYY-MM-DD." });
  return value;
}

export async function slotsOn(member: LiveMember, date: string, now: Date, audience: "staff" | "member"): Promise<Slot[]> {
  const serving = (await phlebotomists()).filter((entry) => entry.states.includes(member.state));
  const times = slotTimesOn(date, localDate(now, member.time_zone), audience).map((time) => ({ time, startsAt: instantOf(date, time, member.time_zone) }));
  const taken = await rows<{ phlebotomist_id: string; starts_at: Date }>(
    pool,
    "SELECT phlebotomist_id, starts_at FROM draws WHERE state <> 'cancelled' AND phlebotomist_id = ANY($1) AND starts_at = ANY($2)",
    [serving.map((entry) => entry.id), times.map((entry) => entry.startsAt)],
  );
  const isTaken = new Set(taken.map((row) => `${row.phlebotomist_id}|${row.starts_at.getTime()}`));
  return serving.flatMap((entry) =>
    times.map(({ time, startsAt }) => ({
      phlebotomistId: entry.id,
      phlebotomistName: entry.name,
      localTime: time,
      startsAt: wholeSeconds(startsAt),
      free: !isTaken.has(`${entry.id}|${startsAt.getTime()}`),
    })),
  );
}

interface NextFree {
  date: string;
  time: string;
}

// The same phlebotomist's first free slot after the taken one, on the member's Monday-to-Saturday grid.
async function nextFreeSlot(phlebotomistId: string, zone: TimeZone, after: Date): Promise<NextFree | null> {
  const taken = await rows<{ starts_at: Date }>(
    pool,
    "SELECT starts_at FROM draws WHERE phlebotomist_id = $1 AND state <> 'cancelled' AND starts_at > $2",
    [phlebotomistId, after],
  );
  const isTaken = new Set(taken.map((row) => row.starts_at.getTime()));
  let date = localDate(after, zone);
  for (let day = 0; day <= STAFF_WINDOW_DAYS; day += 1) {
    if (weekdayOf(date) !== SUNDAY) {
      for (const time of SLOT_TIMES) {
        const start = instantOf(date, time, zone);
        if (start > after && !isTaken.has(start.getTime())) return { date, time };
      }
    }
    date = addDays(date, 1);
  }
  return null;
}

async function slotTaken(phlebotomistId: string, start: Date, zone: TimeZone, audience: "staff" | "member"): Promise<ApiError> {
  const winner = await one<{ booked_by: string | null }>(
    pool,
    "SELECT booked_by FROM draws WHERE phlebotomist_id = $1 AND starts_at = $2 AND state <> 'cancelled'",
    [phlebotomistId, start],
  );
  const next = await nextFreeSlot(phlebotomistId, zone, start);
  const taken = audience === "staff" ? `That slot was just taken by ${winner?.booked_by ?? "a member"}.` : "That slot was just taken.";
  const following = next ? ` The next free slot is ${formatDate(next.date)}, ${next.time} ${cityOf(zone)} time.` : "";
  return conflict("slot_taken", `${taken}${following}`);
}

interface Booking {
  phlebotomist: PhlebotomistRow;
  date: string;
  time: string;
  start: Date;
  collectedAt: Date | null;
  kitCodes: string[];
  past: boolean;
}

function requirePlus(member: LiveMember, start: Date, past: boolean, today: string): void {
  const refused = conflict("plus_required", "Draws are part of Plus.");
  const inForceOn = (phoenixDate: string): boolean => {
    if (member.membership_state === "active") return true;
    return member.membership_state === "cancelled" && member.plus_until !== null && member.plus_until >= phoenixDate;
  };
  const checkedDate = past ? today : localDate(start, "phoenix");
  if (!inForceOn(checkedDate)) throw refused;
}

function readKitCodes(value: unknown, fields: Record<string, string>): string[] {
  return list(value).flatMap((entry, index) => {
    const raw = typeof entry === "string" ? entry : "";
    const refusal = kitCodeRefusal(raw);
    if (refusal) {
      fields[`kitCodes.${index}`] = refusal;
      return [];
    }
    return [normalizeKitCode(raw)];
  });
}

// Field rules shared by booking and moving a draw, rung 10.
async function readBooking(
  member: LiveMember,
  body: JsonBody,
  phlebotomistId: string,
  now: Date,
  audience: "staff" | "member",
): Promise<Booking> {
  const fields: Record<string, string> = {};
  const zone = member.time_zone;
  const today = localDate(now, zone);
  const date = text(body, "date");
  const time = text(body, "time");
  const windowCopy = audience === "staff" ? "Choose a date within 400 days of today." : "Choose a date from tomorrow up to 28 days ahead.";
  const earliest = audience === "staff" ? addDays(today, -STAFF_WINDOW_DAYS) : addDays(today, 1);
  const latest = addDays(today, audience === "staff" ? STAFF_WINDOW_DAYS : MEMBER_WINDOW_DAYS);
  const validDate = isIsoDate(date);
  if (!validDate) fields["date"] = "Enter the date as YYYY-MM-DD.";
  else if (date < earliest || date > latest) fields["date"] = windowCopy;
  if (validDate && !slotTimesOn(date, today, audience).includes(time)) fields["time"] = "Choose a slot from the published times.";
  if (!validDate && !SLOT_TIMES.includes(time)) fields["time"] = "Choose a slot from the published times.";

  const found = await phlebotomist(pool, phlebotomistId);
  if (found && !found.states.includes(member.state)) {
    fields["phlebotomistId"] = `This phlebotomist doesn't serve ${stateName(member.state)}.`;
  }

  const past = validDate && date < today;
  let collectedAt: Date | null = null;
  const kitCodes = past ? readKitCodes(body["kitCodes"], fields) : [];
  if (past) {
    const given = new Date(text(body, "collectedAt"));
    if (Number.isNaN(given.getTime()) || localDate(given, zone) !== date) {
      fields["collectedAt"] = "Give the collected time for a past draw.";
    } else {
      collectedAt = given;
    }
  }
  if (Object.keys(fields).length > 0 || !found) throw invalid(fields);
  return { phlebotomist: found, date, time, start: instantOf(date, time, zone), collectedAt, kitCodes, past };
}

function requireAddress(member: LiveMember): void {
  if (!member.address_line1) throw conflict("address_required", "Add your home address before booking a draw.");
}

// A new private address ends the previous one at once and is mailed to the phlebotomist.
async function sendVisitPage(
  db: Db,
  draw: { id: string; member_id: string; member_name: string; local_date: string; local_time: string; time_zone: TimeZone },
  phlebotomistEmail: string,
  now: Date,
): Promise<Date> {
  await endLivePages(db, draw.id, now);
  const token = randomBytes(24).toString("base64url");
  const midnight = instantOf(addDays(draw.local_date, 1), "00:00", draw.time_zone);
  const limit = config.drawPageSeconds === null ? midnight : new Date(now.getTime() + config.drawPageSeconds * 1000);
  const endsAt = limit < midnight ? limit : midnight;
  await db.query("INSERT INTO visit_pages (token, draw_id, sent_at, ends_at) VALUES ($1, $2, $3, $4)", [token, draw.id, now, endsAt]);
  const body = [
    `You have a visit with ${visitName(draw.member_name)}.`,
    `Draw time: ${formatDate(draw.local_date)}, ${draw.local_time} ${cityOf(draw.time_zone)} time.`,
    "",
    `Open your private visit page: ${config.publicUrl}/visit/${token}`,
  ].join("\n");
  await enqueueMail(db, draw.member_id, phlebotomistEmail, `Visit page for ${formatDate(draw.local_date)}`, body);
  return endsAt;
}

// First name and the last name's initial with a full stop.
export function visitName(fullName: string): string {
  const words = fullName.trim().split(/\s+/);
  const first = words[0] ?? "";
  const last = words.length > 1 ? words.at(-1) ?? "" : "";
  return last ? `${first} ${[...last][0] ?? ""}.` : first;
}

export async function loadDraw(db: Db, id: string): Promise<DrawRow> {
  const row = await drawRow(db, id);
  if (!row) throw notFound();
  return row;
}

export async function bookDraw(
  member: LiveMember,
  body: JsonBody,
  phlebotomistId: string,
  bookedBy: string,
  audience: "staff" | "member",
): Promise<DrawRow> {
  const now = new Date();
  const booking = await readBooking(member, body, phlebotomistId, now, audience);
  refuseWhileClosing(member.account_state);
  requirePlus(member, booking.start, booking.past, localDate(now, "phoenix"));
  requireAddress(member);
  const id = randomUUID();
  try {
    return await inTransaction(async (db) => {
      await db.query(
        `INSERT INTO draws (id, member_id, phlebotomist_id, state, starts_at, local_date, local_time, collected_at, kit_codes, booked_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id, member.id, booking.phlebotomist.id, booking.past ? "collected" : "booked", booking.start, booking.date, booking.time,
          booking.collectedAt, [...new Set(booking.kitCodes)], bookedBy,
        ],
      );
      if (!booking.past) {
        await sendVisitPage(db, { id, member_id: member.id, member_name: member.name, local_date: booking.date, local_time: booking.time, time_zone: member.time_zone }, booking.phlebotomist.email, now);
      }
      return loadDraw(db, id);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw await slotTaken(booking.phlebotomist.id, booking.start, member.time_zone, audience);
    throw error;
  }
}

function requireBeforeCutoff(row: DrawRow, now: Date): void {
  const closes = changesCloseAt(row.local_date, row.time_zone);
  if (now >= closes) {
    throw conflict("changes_closed", `Changes closed at ${dateTimeIn(wholeSeconds(closes), row.time_zone)}. Message your care team to change this draw.`);
  }
}

async function endLivePages(db: Db, drawId: string, now: Date): Promise<void> {
  await db.query("UPDATE visit_pages SET ended_at = $2 WHERE draw_id = $1 AND ended_at IS NULL", [drawId, now]);
}

export async function moveDraw(member: LiveMember, row: DrawRow, body: JsonBody, audience: "staff" | "member"): Promise<DrawRow> {
  const now = new Date();
  const booking = await readBooking(member, body, row.phlebotomist_id, now, audience);
  refuseWhileClosing(member.account_state);
  requireBooked(row);
  if (audience === "member") requireBeforeCutoff(row, now);
  requirePlus(member, booking.start, booking.past, localDate(now, "phoenix"));
  requireAddress(member);
  try {
    return await inTransaction(async (db) => {
      const moved = await one(
        db,
        `UPDATE draws SET starts_at = $2, local_date = $3, local_time = $4, state = $5, collected_at = $6,
         kit_codes = CASE WHEN $7 THEN $8::text[] ELSE kit_codes END WHERE id = $1 AND state = 'booked' RETURNING id`,
        [row.id, booking.start, booking.date, booking.time, booking.past ? "collected" : "booked", booking.collectedAt, booking.past, booking.kitCodes],
      );
      if (!moved) throw notBooked();
      await endLivePages(db, row.id, now);
      if (!booking.past) {
        await sendVisitPage(db, { id: row.id, member_id: row.member_id, member_name: row.member_name, local_date: booking.date, local_time: booking.time, time_zone: row.time_zone }, row.phlebotomist_email, now);
      }
      return loadDraw(db, row.id);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw await slotTaken(row.phlebotomist_id, booking.start, row.time_zone, audience);
    throw error;
  }
}

export async function cancelDraw(row: DrawRow, audience: "staff" | "member"): Promise<DrawRow> {
  const now = new Date();
  requireBooked(row);
  if (audience === "member") requireBeforeCutoff(row, now);
  return inTransaction(async (db) => {
    const cancelled = await one(db, "UPDATE draws SET state = 'cancelled' WHERE id = $1 AND state = 'booked' RETURNING id", [row.id]);
    if (!cancelled) throw notBooked();
    await endLivePages(db, row.id, now);
    return loadDraw(db, row.id);
  });
}

export async function newVisitPage(row: DrawRow): Promise<VisitPageView> {
  const now = new Date();
  requireBooked(row);
  if (row.local_date < localDate(now, row.time_zone)) throw conflict("not_upcoming", "This draw has no visit page to send.");
  const endsAt = await inTransaction((db) => sendVisitPage(db, row, row.phlebotomist_email, now));
  return { state: "live", endsAt: wholeSeconds(endsAt) };
}

export async function endVisitPage(row: DrawRow): Promise<VisitPageView> {
  const now = new Date();
  await endLivePages(pool, row.id, now);
  return { state: "ended", endsAt: wholeSeconds(now) };
}

