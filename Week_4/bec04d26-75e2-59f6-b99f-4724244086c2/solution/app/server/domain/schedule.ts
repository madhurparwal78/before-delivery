import { addDays, daysInMonth, formatDate, MONTHS, weekday } from "../../shared/calendar";
import type { Carry, Edition, Frequency } from "../../shared/types";
import { zonedInstant } from "./zone";

const MONTHLY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const QUARTERLY = /^(\d{4})-Q([1-4])$/;
const YEARLY = /^(\d{4})$/;
const PERIODS: Record<Frequency, { pattern: RegExp; count: number }> = {
  monthly: { pattern: MONTHLY, count: 12 },
  quarterly: { pattern: QUARTERLY, count: 4 },
  yearly: { pattern: YEARLY, count: 1 },
};

export const FREQUENCIES = Object.keys(PERIODS) as Frequency[];

export function periodMatches(frequency: Frequency, period: string): boolean {
  return PERIODS[frequency].pattern.test(period);
}

/** The first periods of a registration: 12 monthly, 4 quarterly or 1 yearly. */
export function periodsFrom(frequency: Frequency, first: string): string[] {
  const year = Number(first.slice(0, 4));
  const step = frequency === "monthly" ? Number(first.slice(5, 7)) - 1
    : frequency === "quarterly" ? Number(first.slice(-1)) - 1 : 0;
  const perYear = frequency === "monthly" ? 12 : frequency === "quarterly" ? 4 : 1;
  return Array.from({ length: PERIODS[frequency].count }, (_, i) => {
    const index = year * perYear + step + i;
    const y = String(Math.floor(index / perYear)).padStart(4, "0");
    const n = index % perYear;
    return frequency === "monthly" ? `${y}-${String(n + 1).padStart(2, "0")}`
      : frequency === "quarterly" ? `${y}-Q${n + 1}` : y;
  });
}

export function periodLabel(frequency: Frequency, period: string): string {
  if (frequency === "monthly") return `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
  return frequency === "quarterly" ? `Q${period.slice(-1)} ${period.slice(0, 4)}` : period;
}

/** First calendar day of the period, in the state's own calendar. */
export function periodStart(frequency: Frequency, period: string): string {
  const month = frequency === "monthly" ? Number(period.slice(5, 7))
    : frequency === "quarterly" ? (Number(period.slice(-1)) - 1) * 3 + 1 : 1;
  return formatDate(Number(period.slice(0, 4)), month, 1);
}

/** The edition in effect at the period's first day: the latest one not after it. */
export function editionFor(editions: Edition[], start: string): Edition {
  const ordered = [...editions].sort((a, b) => a.effective_date.localeCompare(b.effective_date));
  return ordered.filter((e) => e.effective_date <= start).pop() ?? ordered[0];
}

/** The edition's due day in the month after the period, clamped to that month's end. */
export function baseDueDate(frequency: Frequency, period: string, dueDay: number): string {
  const year = Number(period.slice(0, 4));
  const monthAfter = frequency === "monthly" ? Number(period.slice(5, 7)) + 1
    : frequency === "quarterly" ? Number(period.slice(-1)) * 3 + 1 : 13;
  const y = monthAfter > 12 ? year + 1 : year;
  const m = monthAfter > 12 ? monthAfter - 12 : monthAfter;
  return formatDate(y, m, Math.min(dueDay, daysInMonth(y, m)));
}

function carryForward(date: string, carry: Carry, holidays: string[]): string {
  let day = date;
  while (carry === "next_business" && (weekday(day) === 0 || weekday(day) === 6 || holidays.includes(day))) {
    day = addDays(day, 1);
  }
  return day;
}

interface Schedule {
  nominalDate: string;
  dueDate: string;
  dueAt: number;
}

/** Extended nominal date, carry-forward, and the last millisecond of the carried date in the state's zone. */
export function schedule(baseDate: string, extensionDays: number | null, carry: Carry, holidays: string[],
  zone: string): Schedule {
  const nominalDate = addDays(baseDate, extensionDays ?? 0);
  const dueDate = carryForward(nominalDate, carry, holidays);
  return {
    nominalDate, dueDate, dueAt: zonedInstant(dueDate, 23, 59, 59, 999, zone),
  };
}
