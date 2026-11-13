import { randomBytes, randomUUID } from "node:crypto";
import { addDays, brusselsDate, brusselsInstant, wallClock, weekdayIndex } from "../../shared/brussels";
import type { Appointment, SlotWeek } from "../../shared/api";
import { SHOP_ADDRESS } from "../../shared/catalog";
import { formatDateTime, formatInstant } from "../../shared/format";
import { config } from "../config";
import { lockKey, pool, transaction, type Db } from "../db";
import { conflict, mailUnavailable, notFound, rateLimited, validationFailed } from "../errors";
import { MailDown, sendMail } from "../mail";
import { reply, tokenHash, type Context, type Reply } from "../pipeline";
import { EMAIL_MESSAGE, FieldProblems, isDate, isEmail, isText, NAME_MESSAGE } from "../validate";
import { MAIL_DOWN_COPY } from "./holds";

const SLOT_MS = 20 * 60_000;
const RANGE_DAYS = 224;
const BOOKINGS_PER_WINDOW = 3;
const LIMIT_COPY = "This email address has booked 3 slots in a short while. Try again later.";
const DAY_STARTS: readonly [number, number][] = Array.from({ length: 24 }, (_, index) => [10 + Math.floor(index / 3), (index % 3) * 20]);
const OPEN_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];

function rangeOf(now: Date): { first: string; end: string } {
  const first = addDays(brusselsDate(now), 1);
  return { first, end: addDays(first, RANGE_DAYS) };
}

const mondayOf = (date: string): string => addDays(date, -weekdayIndex(date));

/** The bookable slot instants of one Monday-to-Sunday week, keeping their wall-clock times across clock changes. */
function slotsOfWeek(monday: string, range: { first: string; end: string }): Date[] {
  return OPEN_WEEKDAYS.flatMap((offset) => {
    const date = addDays(monday, offset);
    if (date < range.first || date >= range.end) return [];
    return DAY_STARTS.map(([hour, minute]) => brusselsInstant(date, hour, minute));
  });
}

function isBookable(instant: Date, range: { first: string; end: string }): boolean {
  const date = brusselsDate(instant);
  if (date < range.first || date >= range.end || !OPEN_WEEKDAYS.includes(weekdayIndex(date))) return false;
  const { hour, minute, second } = wallClock(instant);
  return second === 0 && DAY_STARTS.some(([slotHour, slotMinute]) => slotHour === hour && slotMinute === minute);
}

async function bookedBetween(db: Db, from: Date, to: Date): Promise<Set<number>> {
  const { rows } = await db.query<{ starts_at: Date }>("SELECT starts_at FROM appointments WHERE cancelled_at IS NULL AND starts_at >= $1 AND starts_at < $2", [from, to]);
  return new Set(rows.map((row) => row.starts_at.getTime()));
}

export async function slotsWeek({ query, now }: Context): Promise<Reply> {
  const range = rangeOf(now);
  const firstWeek = mondayOf(range.first);
  const lastWeek = mondayOf(addDays(range.end, -1));
  const week = query.get("week") || firstWeek;
  if (!isDate(week) || weekdayIndex(week) !== 0 || week < firstWeek || week > lastWeek) throw validationFailed({ week: "Choose a Monday inside the bookable range." });
  const slots = slotsOfWeek(week, range);
  const booked = await bookedBetween(pool, brusselsInstant(week), brusselsInstant(addDays(week, 7)));
  const view: SlotWeek = {
    weekStart: week,
    previousWeek: week > firstWeek ? addDays(week, -7) : null,
    nextWeek: week < lastWeek ? addDays(week, 7) : null,
    slots: slots.map((start) => ({ startsAt: formatInstant(start), endsAt: formatInstant(new Date(start.getTime() + SLOT_MS)), free: !booked.has(start.getTime()) })),
  };
  return reply(200, view);
}

async function checkBookingLimit(db: Db, email: string, now: Date): Promise<void> {
  const windowMs = config.appointmentRateWindowSeconds * 1000;
  const { rows } = await db.query<{ created_at: Date }>("SELECT created_at FROM appointments WHERE lower(email) = lower($1) AND created_at > $2 ORDER BY created_at", [email, new Date(now.getTime() - windowMs)]);
  if (rows.length >= BOOKINGS_PER_WINDOW) throw rateLimited(LIMIT_COPY, Math.max(1, Math.ceil((rows[0].created_at.getTime() + windowMs - now.getTime()) / 1000)));
}

export async function bookingLimit(body: Record<string, unknown>, now: Date): Promise<void> {
  if (isEmail(body.email)) await checkBookingLimit(pool, body.email, now);
}

async function nextFreeSlot(db: Db, after: Date, now: Date): Promise<Date | undefined> {
  const range = rangeOf(now);
  const booked = await bookedBetween(db, after, brusselsInstant(range.end));
  for (let week = mondayOf(brusselsDate(after)); week < range.end; week = addDays(week, 7)) {
    const free = slotsOfWeek(week, range).find((slot) => slot > after && !booked.has(slot.getTime()));
    if (free) return free;
  }
  return undefined;
}

export async function bookAppointment({ body, now }: Context): Promise<Reply> {
  const { startsAt, name, email } = body;
  const instant = typeof startsAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(startsAt) ? new Date(startsAt) : null;
  const problems = new FieldProblems();
  if (!instant || Number.isNaN(instant.getTime()) || !isBookable(instant, rangeOf(now))) problems.add("startsAt", "Choose a free slot from this page.");
  if (!isText(name, 80)) problems.add("name", NAME_MESSAGE);
  if (!isEmail(email)) problems.add("email", EMAIL_MESSAGE);
  problems.check();
  const slot = new Date(String(startsAt));
  const address = String(email);
  const token = randomBytes(32).toString("base64url");
  const endsAt = new Date(slot.getTime() + SLOT_MS);
  const row = await transaction(async (db) => {
    // Bookings from one address arriving together are counted one after another.
    await lockKey(db, `booking:${address.toLowerCase()}`);
    await checkBookingLimit(db, address, now);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO appointments (id, starts_at, ends_at, name, email, token_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (starts_at) WHERE cancelled_at IS NULL DO NOTHING RETURNING id`,
      [randomUUID(), slot, endsAt, name, address, tokenHash(token), now],
    );
    if (!rows[0]) {
      const next = await nextFreeSlot(db, slot, now);
      throw conflict("slot_taken", next ? `That slot was just taken. The next free slot is ${formatDateTime(next)}.` : "That slot was just taken. There is no free slot in the next 32 weeks.");
    }
    try {
      await sendMail({
        to: address,
        subject: `Your intake appointment on ${formatDateTime(slot)}`,
        text: [`Your intake appointment: ${formatDateTime(slot)}`, `Atelier Ourlet, ${SHOP_ADDRESS}`, "", `To cancel it: ${config.publicUrl}/appointments/cancel/${token}`].join("\n"),
      });
    } catch (error) {
      if (error instanceof MailDown) throw mailUnavailable(MAIL_DOWN_COPY);
      throw error;
    }
    return rows[0];
  });
  return reply(201, { appointment: { id: row.id, startsAt: formatInstant(slot), endsAt: formatInstant(endsAt) } });
}

interface AppointmentRow {
  id: string;
  starts_at: Date;
  ends_at: Date;
  name: string;
  email: string;
  cancelled_at: Date | null;
}

export async function listAppointments({ now }: Context): Promise<Reply> {
  const { rows } = await pool.query<AppointmentRow>("SELECT * FROM appointments WHERE cancelled_at IS NULL AND starts_at >= $1 ORDER BY starts_at", [now]);
  const appointments: Appointment[] = rows.map((row) => ({ id: row.id, startsAt: formatInstant(row.starts_at), endsAt: formatInstant(row.ends_at), name: row.name, email: row.email }));
  return reply(200, { appointments });
}

const appointmentsByToken = (token: string) => pool.query<AppointmentRow>("SELECT * FROM appointments WHERE token_hash = $1", [tokenHash(token)]);

export async function appointmentTokenExists({ params }: Context): Promise<void> {
  if (!(await appointmentsByToken(params.token)).rows.length) throw notFound();
}

const tokenView = (row: AppointmentRow) => ({ startsAt: formatInstant(row.starts_at), endsAt: formatInstant(row.ends_at), status: row.cancelled_at ? "cancelled" : "booked" });

export async function appointmentPage({ params }: Context): Promise<Reply> {
  const { rows: [row] } = await appointmentsByToken(params.token);
  return reply(200, { appointment: tokenView(row) });
}

export async function cancelAppointment({ params, now }: Context): Promise<Reply> {
  return transaction(async (db) => {
    const { rows } = await db.query<AppointmentRow>("UPDATE appointments SET cancelled_at = $2 WHERE token_hash = $1 AND cancelled_at IS NULL RETURNING *", [tokenHash(params.token), now]);
    const row = rows[0];
    if (!row) throw conflict("already_cancelled", "This appointment was already cancelled.");
    return reply(200, { appointment: tokenView(row) });
  });
}
