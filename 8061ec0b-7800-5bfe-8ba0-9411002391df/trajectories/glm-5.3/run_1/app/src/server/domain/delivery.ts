// Delivery days and their cutoffs (DP-03, DP-32).
// The cutoff for delivery day D is 5:00 PM store wall-clock time on the day
// before D, converted with the UTC offset in force that evening.
import type { PoolClient } from "pg";
import { addDaysToDateString, dateAtStoreTime, weekdayOfDate } from "../tz.js";

export interface SchoolRow {
  id: string;
  name: string;
  delivery_weekday: string;
}

export interface DeliveryDay {
  date: string;
  cutoff_at: Date;
}

export async function schoolById(client: PoolClient, id: string): Promise<SchoolRow | null> {
  const rows = await client.query<Record<string, unknown>>("SELECT * FROM schools WHERE id = $1", [id]);
  return rows.rows.length > 0
    ? { id: rows.rows[0].id as string, name: rows.rows[0].name as string, delivery_weekday: rows.rows[0].delivery_weekday as string }
    : null;
}

export async function allSchools(client: PoolClient): Promise<SchoolRow[]> {
  const rows = await client.query<Record<string, unknown>>("SELECT * FROM schools ORDER BY created_order");
  return rows.rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    delivery_weekday: r.delivery_weekday as string,
  }));
}

function cutoffForDeliveryDay(deliveryDate: string): Date {
  const dayBefore = addDaysToDateString(deliveryDate, -1);
  return dateAtStoreTime(dayBefore, 17, 0);
}

function nextDateOnWeekday(fromDate: string, weekday: string): string {
  let date = fromDate;
  for (let i = 0; i < 8; i++) {
    if (weekdayOfDate(date) === weekday) return date;
    date = addDaysToDateString(date, 1);
  }
  throw new Error(`No ${weekday} found within a week of ${fromDate}`);
}

// The earliest delivery day D on the school's weekday whose cutoff is strictly
// later than the server clock at the moment of the call.
export function nextDeliveryDay(school: SchoolRow, now: Date): DeliveryDay {
  let candidate = nextDateOnWeekday(storeToday(now), school.delivery_weekday);
  for (let i = 0; i < 8; i++) {
    const cutoff = cutoffForDeliveryDay(candidate);
    if (cutoff.getTime() > now.getTime()) return { date: candidate, cutoff_at: cutoff };
    candidate = addDaysToDateString(candidate, 7);
  }
  throw new Error("No upcoming delivery day found");
}

export function upcomingDeliveryDays(school: SchoolRow, now: Date, count = 4): DeliveryDay[] {
  const first = nextDeliveryDay(school, now);
  const days: DeliveryDay[] = [first];
  let date = first.date;
  for (let i = 1; i < count; i++) {
    date = addDaysToDateString(date, 7);
    days.push({ date, cutoff_at: cutoffForDeliveryDay(date) });
  }
  return days;
}

function storeToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
