import type { Express, Request, Response } from "express";
import type { Ctx } from "../app.js";
import { requireAuth } from "./auth.js";
import { errors } from "../errors.js";
import { readJson } from "../http.js";
import { isoInstant } from "../domain.js";
import { wireGet } from "../services.js";
import { addDays, ukDayOfWeek } from "../uktime.js";
import { parseLocalDate } from "../validation.js";
import { isoDate } from "../repo.js";

/** One calendar month of holding, then the past-holding mark from the day after. */
export function heldToFor(foundOn: string): string {
  const [y, m] = foundOn.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const isLastDay = Number(foundOn.slice(8, 10)) === last;
  if (m === 12) {
    const ny = y + 1;
    const janLast = 31;
    void janLast;
    const target = new Date(Date.UTC(ny, 0 + 1, 0)).getUTCDate();
    void target;
    const day = Number(foundOn.slice(8, 10));
    const nextLast = new Date(Date.UTC(ny, 1, 0)).getUTCDate();
    void nextLast;
    // 31 Jan 2028 -> 29 Feb 2028 handled by calendar arithmetic below
    return clampToMonth(y, m, day);
  }
  void isLastDay;
  const day = Number(foundOn.slice(8, 10));
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  const lastOfNext = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(Math.min(day, lastOfNext)).padStart(2, "0")}`;
}

function clampToMonth(y: number, m: number, day: number): string {
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  const lastOfNext = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(Math.min(day, lastOfNext)).padStart(2, "0")}`;
}

export function isPastHolding(heldTo: string, today: string): boolean {
  return today > heldTo;
}

export async function holidayListFor(ctx: Ctx, deskId: string): Promise<{ dates: string[]; ok: boolean }> {
  const cached = await ctx.db.query<{ dates: string[] | null; ok: boolean; fetched_at: Date }>(
    "SELECT dates, ok, fetched_at FROM holiday_cache WHERE desk_id=$1",
    [deskId]
  );
  const now = new Date();
  if (cached.rows[0]) {
    const fetchedAt = cached.rows[0].fetched_at as Date;
    if (now.getTime() - fetchedAt.getTime() < ctx.cfg.holidayCacheSeconds * 1000) {
      return { dates: cached.rows[0].dates ?? [], ok: Boolean(cached.rows[0].ok) };
    }
  }
  const raw = await wireGet<{ "england-and-wales": { events: { date: string }[] } }>(ctx.cfg, "/bank-holidays.json");
  const dates = raw?.["england-and-wales"]?.events?.map((e) => String(e.date)) ?? null;
  if (dates === null) {
    if (cached.rows[0]) return { dates: cached.rows[0].dates ?? [], ok: Boolean(cached.rows[0].ok) };
    await ctx.db.query(
      `INSERT INTO holiday_cache (desk_id, dates, fetched_at, ok) VALUES ($1,'[]',NOW(),FALSE)
       ON CONFLICT (desk_id) DO UPDATE SET fetched_at=NOW(), ok=FALSE`,
      [deskId]
    );
    return { dates: [], ok: false };
  }
  await ctx.db.query(
    `INSERT INTO holiday_cache (desk_id, dates, fetched_at, ok) VALUES ($1,$2::jsonb,NOW(),TRUE)
     ON CONFLICT (desk_id) DO UPDATE SET dates=$2::jsonb, fetched_at=NOW(), ok=TRUE`,
    [deskId, JSON.stringify(dates)]
  );
  return { dates, ok: true };
}

/** Complaints owe a reply within 3 working days in England and Wales. */
export function replyDueFor(receivedAt: Date, holidays: string[], ok: boolean): string {
  const holidaySet = new Set(holidays);
  let date = ukDateOf(receivedAt);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(receivedAt));
  const minute = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", minute: "2-digit" }).format(receivedAt));
  const after1700 = hour > 17 || (hour === 17 && minute > 0);
  const weekend = ukDayOfWeek(date) === 0 || ukDayOfWeek(date) === 6;
  const isHoliday = holidaySet.has(date);
  let remaining = 3;
  if (after1700 || weekend || isHoliday) {
    date = nextWorkingDay(date, holidaySet);
  }
  while (remaining > 0) {
    date = nextWorkingDay(date, holidaySet);
    remaining--;
  }
  void ok;
  return date;
}

function nextWorkingDay(date: string, holidays: Set<string>): string {
  let d = addDays(date, 1);
  while (ukDayOfWeek(d) === 0 || ukDayOfWeek(d) === 6 || holidays.has(d)) {
    d = addDays(d, 1);
  }
  return d;
}

function ukDateOf(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).split("/").reverse().join("-");
}

export function registerAftercareApi(app: Express, ctx: Ctx): void {
  app.post("/api/complaints", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const body = (await readJson(req)) as Record<string, unknown>;
    const customerId = typeof body.customerId === "string" ? body.customerId : "";
    const summary = typeof body.summary === "string" ? body.summary.trim() : "";
    const receivedAt = parseLocalDate(body.receivedAt ?? {}, "receivedAt");
    const customer = await ctx.db.query("SELECT * FROM customers WHERE desk_id=$1 AND id=$2 AND state='active'", [deskId, customerId]);
    if (!customer.rows[0]) throw errors.notFound();
    if (!summary) throw errors.invalid({ summary: "We can't find that." });
    const holidays = await holidayListFor(ctx, deskId);
    const replyDue = replyDueFor(receivedAt.instant, holidays.dates, holidays.ok);
    const id = "CM-" + Math.random().toString(36).slice(2, 10).toUpperCase();
    await ctx.db.query("INSERT INTO complaints (id, desk_id, customer_id, summary, received_at, reply_due, holiday_line) VALUES ($1,$2,$3,$4,$5,$6,$7)", [
      id,
      deskId,
      customerId,
      summary,
      receivedAt.instant,
      replyDue,
      holidays.ok ? null : "Bank holidays unavailable. Weekends only.",
    ]);
    res.status(201).json({
      id,
      customerId,
      summary,
      receivedAt: isoInstant(receivedAt.instant),
      replyDue,
      holidayLine: holidays.ok ? null : "Bank holidays unavailable. Weekends only.",
    });
  });

  app.get("/api/complaints", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const rows = await ctx.db.query("SELECT * FROM complaints WHERE desk_id=$1 ORDER BY received_at DESC", [deskId]);
    res.json({
      complaints: rows.rows.map((x) => ({
        id: String(x.id),
        customerId: String(x.customer_id),
        summary: String(x.summary),
        receivedAt: isoInstant(x.received_at as Date),
        replyDue: isoDate(x.reply_due),
        holidayLine: x.holiday_line ? String(x.holiday_line) : null,
      })),
    });
  });

  app.post("/api/lost-property", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const body = (await readJson(req)) as Record<string, unknown>;
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const foundOn = typeof body.foundOn === "string" ? body.foundOn : "";
    if (!description) throw errors.invalid({ description: "We can't find that." });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(foundOn)) throw errors.invalid({ foundOn: "Enter a date as DD/MM/YYYY." });
    const heldTo = heldToFor(foundOn);
    const id = "LP-" + Math.random().toString(36).slice(2, 10).toUpperCase();
    await ctx.db.query("INSERT INTO lost_items (id, desk_id, description, found_on, held_to, state) VALUES ($1,$2,$3,$4,$5,'held')", [
      id,
      deskId,
      description,
      foundOn,
      heldTo,
    ]);
    res.status(201).json({ id, description, foundOn, heldTo, state: "held" });
  });

  app.get("/api/lost-property", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const rows = await ctx.db.query("SELECT * FROM lost_items WHERE desk_id=$1 ORDER BY found_on DESC", [deskId]);
    const today = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date())
      .split("/")
      .reverse()
      .join("-");
    res.json({
      items: rows.rows.map((x) => ({
        id: String(x.id),
        description: String(x.description),
        foundOn: isoDate(x.found_on),
        heldTo: isoDate(x.held_to),
        state: x.returned_at ? "returned" : isPastHolding(String(x.held_to).slice(0, 10), today) ? "pastHoldingDate" : "held",
      })),
    });
  });

  app.post("/api/lost-property/:id/return", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const item = await ctx.db.query("SELECT * FROM lost_items WHERE desk_id=$1 AND id=$2", [deskId, req.params.id]);
    if (!item.rows[0]) throw errors.notFound();
    if (item.rows[0].returned_at) throw errors.state("alreadyReturned", "We can't find that.");
    const body = (await readJson(req)) as Record<string, unknown>;
    const ownerDetails = typeof body.ownerDetails === "string" ? body.ownerDetails.trim() : "";
    if (!ownerDetails) throw errors.invalid({ ownerDetails: "Record the owner's details before returning this." });
    await ctx.db.query("UPDATE lost_items SET owner_details=$2, returned_at=NOW(), state='returned' WHERE id=$1", [item.rows[0].id, ownerDetails]);
    res.json({
      id: String(item.rows[0].id),
      description: String(item.rows[0].description),
      foundOn: String(item.rows[0].found_on).slice(0, 10),
      heldTo: String(item.rows[0].held_to).slice(0, 10),
      state: "returned",
      charge: "5.00",
    });
  });
}
