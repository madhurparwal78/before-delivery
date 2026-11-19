// Opening-hours plans, the plan in effect on a date, day plans and collection slots.
// The plan-in-effect rule, the slot conversion and the offer window each live here only.
import { isRecord } from "./json.js";
import type { DayHours } from "./seedData.js";
import {
  addDays, clockOf, firstLocalInstant, formatOffset, isoInstant, localInstant, localMoment, minutesOf, weekdayOf,
} from "./time.js";

const SLOT_MINUTES = 30;
const MIN_LEAD_SECONDS = 7200;
const MAX_LEAD_SECONDS = 604_800;
export const SLOT_CAPACITY = 2;
export const PUBLISH_HORIZON_DAYS = 60;

interface PlanFields {
  timezone: string;
  hours: DayHours[];
  upcoming_from: string | null;
  upcoming_hours: DayHours[] | null;
}

/** The plan in effect on `date`: the upcoming plan from its effective date on, the current plan before. */
export function planDaysFor(shop: PlanFields, date: string, localToday: string): DayHours[] {
  const from = shop.upcoming_from;
  if (shop.upcoming_hours && from && (date >= from || localToday >= from)) return shop.upcoming_hours;
  return shop.hours;
}

/** True while an upcoming plan exists that has not yet begun on the shop's local today. */
export function hasUpcoming(shop: PlanFields, today: string): boolean {
  return shop.upcoming_hours !== null && shop.upcoming_from !== null && shop.upcoming_from > today;
}

/** True once an upcoming plan's effective date has begun, so it should replace the current plan. */
export function upcomingDue(shop: PlanFields, today: string): boolean {
  return shop.upcoming_hours !== null && shop.upcoming_from !== null && shop.upcoming_from <= today;
}

export function dayOn(shop: PlanFields, date: string, localToday: string): DayHours | undefined {
  return planDaysFor(shop, date, localToday).find((day) => day.weekday === weekdayOf(date));
}

interface PlannedSlot {
  startLocal: string;
  startUtcMs: number;
  offset: number;
}

/** Every slot of a local date under that day's hours. Times that do not exist that day are skipped; a repeated time appears once. */
export function slotsOn(zone: string, date: string, day: DayHours | undefined): PlannedSlot[] {
  if (!day || !day.open || day.opens === null || day.closes === null) return [];
  const closes = minutesOf(day.closes);
  const slots: PlannedSlot[] = [];
  for (let at = minutesOf(day.opens); at + SLOT_MINUTES <= closes; at += SLOT_MINUTES) {
    const instant = localInstant(zone, date, at);
    if (instant) slots.push({ startLocal: clockOf(at), startUtcMs: instant.utcMs, offset: instant.offset });
  }
  return slots;
}

export function localToday(zone: string, now: Date): string {
  return localMoment(zone, now.getTime()).date;
}

interface DayPlanShape {
  open: boolean;
  opens_local: string | null;
  closes_local: string | null;
  opens_utc: string | null;
  closes_utc: string | null;
}

export function dayPlanTimes(zone: string, date: string, day: DayHours | undefined): DayPlanShape {
  if (!day || !day.open || day.opens === null || day.closes === null) {
    return { open: false, opens_local: null, closes_local: null, opens_utc: null, closes_utc: null };
  }
  return {
    open: true, opens_local: day.opens, closes_local: day.closes,
    opens_utc: isoInstant(firstLocalInstant(zone, date, minutesOf(day.opens)).utcMs),
    closes_utc: isoInstant(firstLocalInstant(zone, date, minutesOf(day.closes)).utcMs),
  };
}

export function slotObject(slot: PlannedSlot, remaining: number): Record<string, string | number> {
  return { start_local: slot.startLocal, start_utc: isoInstant(slot.startUtcMs), utc_offset: formatOffset(slot.offset), remaining };
}

/** The local dates whose slots can fall inside the shopper offer window. */
export function offerDates(zone: string, now: Date): string[] {
  const first = localMoment(zone, now.getTime() + MIN_LEAD_SECONDS * 1000).date;
  const last = localMoment(zone, now.getTime() + MAX_LEAD_SECONDS * 1000).date;
  const dates: string[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) dates.push(date);
  return dates;
}

export function inOfferWindow(slot: PlannedSlot, now: Date): boolean {
  const lead = (slot.startUtcMs - now.getTime()) / 1000;
  return lead >= MIN_LEAD_SECONDS && lead <= MAX_LEAD_SECONDS;
}

// ---- publishing -------------------------------------------------------------------------

const CLOCK = /^([01]\d|2[0-3]):(00|30)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: unknown): value is string {
  return typeof value === "string" && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

interface ParsedHours {
  days: DayHours[];
  errors: Record<string, string>;
}

/** Reads the seven day entries of a publish request; weekdays must be 1 to 7 with none missing. */
export function parseDays(input: unknown): ParsedHours {
  const errors: Record<string, string> = {};
  const days: DayHours[] = [];
  if (!Array.isArray(input)) return { days, errors: { days: "Give the seven weekdays." } };
  const seen = new Set<number>();
  input.forEach((entry: unknown, index) => {
    const item = isRecord(entry) ? entry : {};
    const weekday = item.weekday;
    if (typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 1 || weekday > 7 || seen.has(weekday)) {
      errors[`days.${index}.weekday`] = "Use each weekday from 1 to 7 once.";
      return;
    }
    seen.add(weekday);
    if (item.open !== true) {
      days.push({ weekday, open: false, opens: null, closes: null });
      return;
    }
    const { opens, closes } = item;
    const opensOk = typeof opens === "string" && CLOCK.test(opens);
    const closesOk = typeof closes === "string" && CLOCK.test(closes);
    if (!opensOk) errors[`days.${index}.opens`] = "Use a time on the hour or half hour.";
    if (!closesOk) errors[`days.${index}.closes`] = "Use a time on the hour or half hour.";
    if (opensOk && closesOk && minutesOf(closes) <= minutesOf(opens)) errors[`days.${index}.closes`] = "Closing time must be after opening time.";
    if (opensOk && closesOk) days.push({ weekday, open: true, opens, closes });
  });
  if (input.length !== 7 || seen.size !== 7) errors.days = errors.days ?? "Give the seven weekdays.";
  days.sort((a, b) => a.weekday - b.weekday);
  return { days, errors };
}
