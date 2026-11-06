import type { CycleKey } from "./model.js";
import { CYCLES, CYCLE_INDEX } from "./model.js";

export interface CycleSpan { key: CycleKey; startsAt: Date; endsAt: Date | null }
export interface CycleConfig {
  mode: "calendar" | "short";
  spans: CycleSpan[];
  openingNight: string;
  timeZone: string;
  firstMonday: string;
}

const DAY_MS = 86_400_000;

export function dateInZone(date: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(date);
}

export function calendarDaysBetween(fromDate: string, toDate: string): number {
  const a = Date.UTC(Number(fromDate.slice(0, 4)), Number(fromDate.slice(5, 7)) - 1, Number(fromDate.slice(8, 10)));
  const b = Date.UTC(Number(toDate.slice(0, 4)), Number(toDate.slice(5, 7)) - 1, Number(toDate.slice(8, 10)));
  return Math.round((b - a) / DAY_MS);
}

/**
 * The one place that decides cycle spans (DP-36).
 * firstMonday: YYYY-MM-DD of the Monday 00:00 in the theatre's time zone.
 */
export function buildCycleSpans(mode: "calendar" | "short", firstMonday: string, seconds: number, timeZone: string): CycleSpan[] {
  const start = mondayStartUtc(firstMonday, timeZone);
  const spans: CycleSpan[] = [];
  for (let i = 0; i < CYCLES.length; i++) {
    const key = CYCLES[i]!.key;
    const startsAt = mode === "calendar"
      ? new Date(start.getTime() + i * 7 * DAY_MS)
      : new Date(start.getTime() + i * seconds * 1000);
    const endsAt = i === CYCLES.length - 1 ? null : (
      mode === "calendar"
        ? new Date(startsAt.getTime() + 7 * DAY_MS)
        : new Date(startsAt.getTime() + seconds * 1000)
    );
    spans.push({ key, startsAt, endsAt });
  }
  return spans;
}

function mondayStartUtc(firstMonday: string, timeZone: string): Date {
  // The stored value is the calendar Monday; find the UTC instant of that local midnight.
  for (let off = -14 * 60; off <= 14 * 60; off += 30) {
    const cand = new Date(`${firstMonday}T00:00:00Z`);
    const utcGuess = new Date(cand.getTime() - off * 60_000);
    if (dateInZone(utcGuess, timeZone) === firstMonday && localHour(utcGuess, timeZone) === 0) {
      // Verify midnight exactly
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(utcGuess);
      if (parts === "00:00") return utcGuess;
    }
  }
  // Fallback: naive midnight UTC interpretation
  return new Date(`${firstMonday}T00:00:00Z`);
}

function localHour(d: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false }).format(d));
}

/** The one place that decides which cycle is current (DP-36). */
export function currentCycle(now: Date, spans: CycleSpan[]): CycleSpan {
  let cur = spans[0]!;
  for (const s of spans) {
    if (now.getTime() >= s.startsAt.getTime()) cur = s;
    else break;
  }
  return cur;
}

/** The Monday of the week (per the theatre's time zone) of a given instant. */
export function mondayOf(now: Date, timeZone: string): string {
  const d = dateInZone(now, timeZone);
  const utcMid = new Date(`${d}T00:00:00Z`);
  const weekday = utcMid.getUTCDay(); // 0 Sunday
  const back = weekday === 0 ? 6 : weekday - 1;
  const mon = new Date(utcMid.getTime() - back * DAY_MS);
  return mon.toISOString().slice(0, 10);
}

export function openingNightDate(firstMonday: string, override: string | undefined): string {
  if (override) return override;
  const mon = new Date(`${firstMonday}T00:00:00Z`);
  // 38 days after the calendar Monday = Thursday of the second Previews week
  return new Date(mon.getTime() + 38 * DAY_MS).toISOString().slice(0, 10);
}

export function cycleIndex(key: string): number { return CYCLE_INDEX[key as CycleKey] ?? 0 }
