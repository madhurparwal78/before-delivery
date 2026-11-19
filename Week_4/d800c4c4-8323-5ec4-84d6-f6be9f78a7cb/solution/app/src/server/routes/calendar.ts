import type pg from "pg";
import { one, pool, rows, transaction } from "../db.js";
import { isOpenDay, loadCalendar, loadSettings, nextOpenDayAfter, nextOpenDays, today, type Calendar } from "../domain/calendar.js";
import { isDate, isTimeZone, WEEK_ORDER, weekdayOf, type Weekday } from "../domain/time.js";
import { conflict, COORDINATOR, notFound, route, STAFF, type Fields, type Reply } from "../http/pipeline.js";
import { text, wholeIn } from "../http/values.js";

const QUARTER_HOUR = /^([01]\d|2[0-3]):(00|15|30|45)$/;
const QUARTER_COPY = "Use a 24-hour time on the quarter hour, like 18:15.";

/** Every out loan whose due date is no longer an open day moves to the next open day after it. */
async function moveDueDates(client: pg.PoolClient, calendar: Calendar): Promise<number> {
  const out = await rows<{ id: number; due_date: string }>(client, `SELECT id, due_date FROM loans WHERE status = 'out' FOR UPDATE`);
  let moved = 0;
  for (const loan of out) {
    if (isOpenDay(calendar, loan.due_date)) continue;
    await client.query(`UPDATE loans SET due_date = $2 WHERE id = $1`, [loan.id, nextOpenDayAfter(calendar, loan.due_date)]);
    moved += 1;
  }
  return moved;
}

function hoursList(calendar: Calendar) {
  return WEEK_ORDER.filter((w) => calendar.hours.has(w)).map((weekday) => ({ weekday, ...calendar.hours.get(weekday)! }));
}

interface HoursEntry {
  weekday: Weekday;
  opens: unknown;
  closes: unknown;
}

function hoursProblems(body: Record<string, unknown>): Fields {
  const list: unknown[] | null = Array.isArray(body.hours) ? (body.hours as unknown[]) : null;
  const structural = { hours: "List each open weekday once, Monday to Sunday, with at least one open." };
  if (list === null || list.length === 0) return structural;
  const byDay = new Map<Weekday, HoursEntry>();
  for (const entry of list) {
    if (entry === null || typeof entry !== "object") return structural;
    const { weekday, opens, closes } = entry as Record<string, unknown>;
    const day = WEEK_ORDER.find((w) => w === weekday);
    if (day === undefined || byDay.has(day)) return structural;
    byDay.set(day, { weekday: day, opens, closes });
  }
  const fields: Fields = {};
  for (const weekday of WEEK_ORDER) {
    const entry = byDay.get(weekday);
    if (!entry) continue;
    const opensOk = typeof entry.opens === "string" && QUARTER_HOUR.test(entry.opens);
    const closesOk = typeof entry.closes === "string" && QUARTER_HOUR.test(entry.closes);
    if (!opensOk) fields[`hours.${weekday}.opens`] = QUARTER_COPY;
    if (!closesOk) fields[`hours.${weekday}.closes`] = QUARTER_COPY;
    else if (opensOk && (entry.closes as string) <= (entry.opens as string)) {
      fields[`hours.${weekday}.closes`] = "Closing time must be later than opening time.";
    }
  }
  return fields;
}

export const calendarRoutes = [
  route({
    method: "GET",
    path: "/api/settings",
    access: "signed-in",
    roles: STAFF,
    body: "none",
    handle: async (): Promise<Reply> => ({ status: 200, body: await loadSettings(pool) }),
  }),
  route({
    method: "PUT",
    path: "/api/settings",
    access: "signed-in",
    roles: COORDINATOR,
    body: "json",
    validate: (ctx) => {
      const body = ctx.json ?? {};
      const fields: Fields = {};
      if (typeof body.time_zone !== "string" || !isTimeZone(body.time_zone)) fields.time_zone = "Choose an IANA time zone, like America/Chicago.";
      if (!wholeIn(body.late_fee_cents, 0, 10_000)) fields.late_fee_cents = "Enter a late fee from $0.00 to $100.00.";
      if (!wholeIn(body.damage_fee_cents, 0, 100_000)) fields.damage_fee_cents = "Enter a damage fee from $0.00 to $1,000.00.";
      if (!wholeIn(body.loan_period_days, 1, 28)) fields.loan_period_days = "Enter a loan period of 1 to 28 days.";
      return fields;
    },
    handle: async (ctx): Promise<Reply> => {
      const b = ctx.json!;
      await pool.query(
        `UPDATE settings SET time_zone = $1, late_fee_cents = $2, damage_fee_cents = $3, loan_period_days = $4 WHERE id = 1`,
        [b.time_zone, b.late_fee_cents, b.damage_fee_cents, b.loan_period_days],
      );
      return { status: 200, body: await loadSettings(pool) };
    },
  }),
  route({
    method: "GET",
    path: "/api/calendar",
    access: "anyone",
    body: "none",
    handle: async (ctx): Promise<Reply> => {
      const calendar = await loadCalendar(pool);
      const closures = await rows<{ date: string; reason: string }>(pool, `SELECT date, reason FROM closures ORDER BY date`);
      return {
        status: 200,
        body: {
          time_zone: calendar.zone,
          hours: hoursList(calendar),
          closures,
          next_open_days: nextOpenDays(calendar, today(calendar, ctx.now), 10),
        },
      };
    },
  }),
  route({
    method: "PUT",
    path: "/api/calendar/hours",
    access: "signed-in",
    roles: COORDINATOR,
    body: "json",
    validate: (ctx) => hoursProblems(ctx.json ?? {}),
    handle: async (ctx): Promise<Reply> => {
      const entries = ctx.json!.hours as Array<{ weekday: Weekday; opens: string; closes: string }>;
      const { calendar, moved } = await transaction(async (client) => {
        await client.query(`SELECT pg_advisory_xact_lock(4)`);
        await client.query(`DELETE FROM opening_hours`);
        for (const e of entries) {
          await client.query(`INSERT INTO opening_hours (weekday, opens, closes) VALUES ($1, $2, $3)`, [e.weekday, e.opens, e.closes]);
        }
        const calendar = await loadCalendar(client);
        return { calendar, moved: await moveDueDates(client, calendar) };
      });
      return { status: 200, body: { hours: hoursList(calendar), moved_loans: moved } };
    },
  }),
  route({
    method: "POST",
    path: "/api/closures",
    access: "signed-in",
    roles: COORDINATOR,
    body: "json",
    validate: async (ctx) => {
      const body = ctx.json ?? {};
      const fields: Fields = {};
      const calendar = await loadCalendar(pool);
      if (!isDate(body.date)) fields.date = "Enter a date as YYYY-MM-DD.";
      else if (body.date < today(calendar, ctx.now)) fields.date = "Closures can only be declared for today or later.";
      else if (!calendar.hours.has(weekdayOf(body.date))) fields.date = "The library is not open on that weekday.";
      const reason = text(body.reason)?.trim() ?? "";
      if (reason.length < 1 || reason.length > 120) fields.reason = "Give a reason of up to 120 characters.";
      return fields;
    },
    handle: async (ctx): Promise<Reply> => {
      const date = ctx.json!.date as string;
      const reason = (ctx.json!.reason as string).trim();
      const { moved, calendar } = await transaction(async (client) => {
        await client.query(`SELECT pg_advisory_xact_lock(4)`);
        const added = await client.query(`INSERT INTO closures (date, reason) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [date, reason]);
        if (!added.rowCount) throw conflict("That day is already closed.");
        const calendar = await loadCalendar(client);
        return { calendar, moved: await moveDueDates(client, calendar) };
      });
      return { status: 201, body: { closure: { date, reason }, moved_loans: moved, new_due_date: nextOpenDayAfter(calendar, date) } };
    },
  }),
  route({
    method: "DELETE",
    path: "/api/closures/:date",
    access: "signed-in",
    roles: COORDINATOR,
    body: "none",
    find: async (ctx) => {
      const date = ctx.params.date!;
      if (!isDate(date) || !(await one(pool, `SELECT 1 FROM closures WHERE date = $1`, [date]))) throw notFound();
      return date;
    },
    handle: async (ctx, date): Promise<Reply> => {
      const calendar = await loadCalendar(pool);
      if (date < today(calendar, ctx.now)) throw conflict("Past closures cannot be removed.");
      await pool.query(`DELETE FROM closures WHERE date = $1`, [date]);
      return { status: 204 };
    },
  }),
];
