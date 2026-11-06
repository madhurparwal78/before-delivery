import { addDays, codePointLength, parseDate, weekdayOf } from "./text.ts";
import { clockChange, localMidnightInstant, partsFor, validZone } from "./tz.ts";

export interface Holiday {
  date: string;
  name: string;
}

export interface CalendarSpec {
  time_zone: string;
  working_weekdays: number[];
  holidays: Holiday[];
  cycle_anchor: string;
}

export interface CalendarState extends CalendarSpec {
  effective_from: string; // local date the save applies from
}

export interface DayInfo {
  date: string;
  counted: boolean;
  reason: string | null;
  clock_change: "forward" | "back" | null;
}

/** The calendar in effect on a date: the latest state whose effective_from is on or before it. */
export function calendarEffectiveOn(states: CalendarState[], date: string): CalendarState {
  let best: CalendarState | null = null;
  for (const s of states) {
    if (s.effective_from <= date) {
      if (!best || s.effective_from > best.effective_from) best = s;
    }
  }
  if (best) return best;
  // The seed calendar: the earliest state, applied before any save's effective date.
  const earliest = states.reduce<CalendarState | null>((a, b) => (!a || b.effective_from < a.effective_from ? b : a), null);
  return earliest!;
}

export function isCounted(calendar: CalendarSpec, date: string): boolean {
  if (!calendar.working_weekdays.includes(weekdayOf(date))) return false;
  return !calendar.holidays.some((h) => h.date === date);
}

export function dayInfo(calendar: CalendarSpec, date: string): DayInfo {
  const holiday = calendar.holidays.find((h) => h.date === date);
  const wd = weekdayOf(date);
  let counted = true;
  let reason: string | null = null;
  if (holiday) {
    counted = false;
    reason = holiday.name;
  } else if (!calendar.working_weekdays.includes(wd)) {
    counted = false;
    reason = wd === 6 || wd === 7 ? "Weekend" : "Non-working day";
  }
  return { date, counted, reason, clock_change: clockChange(calendar.time_zone, date) };
}

/** The next counted day strictly after the given date. */
export function nextCountedDay(calendar: CalendarSpec, date: string): string {
  let d = addDays(date, 1);
  // A generous guard; calendars with no counted day for years are not reachable in practice.
  for (let i = 0; i < 4000; i++) {
    if (isCounted(calendar, d)) return d;
    d = addDays(d, 1);
  }
  return d;
}

export function nextCountedOnOrAfter(calendar: CalendarSpec, date: string): string {
  if (isCounted(calendar, date)) return date;
  return nextCountedDay(calendar, date);
}

export interface CycleSpan {
  number: number;
  firstCountedDate: string;
  lastCountedDate: string;
  nextFirstCountedDate: string;
  startsAtMs: number;
  endsAtMs: number;
}

/**
 * The counted days of a cycle starting at `firstCounted`, given the calendar in effect on
 * each day. Returns the 10 counted days plus the instant of the next cycle's start.
 */
export function cycleSpan(
  states: CalendarState[],
  firstCounted: string
): { countedDates: string[]; nextFirst: string } {
  const countedDates: string[] = [];
  let d = firstCounted;
  for (let i = 0; i < 10; i++) {
    const cal = calendarEffectiveOn(states, d);
    if (!isCounted(cal, d)) d = nextCountedDay(cal, d);
    countedDates.push(d);
    if (i < 9) d = addDays(d, 1);
  }
  const calAfter = calendarEffectiveOn(states, addDays(countedDates[9], 1));
  const nextFirst = nextCountedDay(calAfter, countedDates[9]);
  return { countedDates, nextFirst };
}

/** Today's local date in the workspace zone, from the server clock. */
export function todayInZone(states: CalendarState[], nowMs: number): string {
  // The zone in effect now is from the calendar effective today; the seed zone applies first.
  const cal = calendarEffectiveOn(states, partsFor(seedZone(states), nowMs).date);
  return partsFor(cal.time_zone, nowMs).date;
}

function seedZone(states: CalendarState[]): string {
  return states[0].time_zone;
}

/**
 * Every cycle from 1 to `currentNumber` (inclusive), plus the current cycle's number and
 * the boundary instants. Cycles are computed walking forward from the anchor, using the
 * calendar in effect on each day. This matches the finished-cycle snapshots only up to
 * differences created by calendar changes; those snapshots override these results.
 */
export function computeCycles(
  states: CalendarState[],
  nowMs: number,
  upTo: number
): { cycles: CycleSpan[]; current: number } {
  const anchor = states[0].cycle_anchor;
  const seed = states[0];
  let first = nextCountedOnOrAfter(seed, anchor);
  const cycles: CycleSpan[] = [];
  for (let n = 1; n <= upTo; n++) {
    const { countedDates, nextFirst } = cycleSpan(states, first);
    const startsAtMs = localMidnightInstant(calendarEffectiveOn(states, countedDates[0]).time_zone, countedDates[0]);
    const endsAtMs = localMidnightInstant(calendarEffectiveOn(states, nextFirst).time_zone, nextFirst);
    cycles.push({
      number: n,
      firstCountedDate: countedDates[0],
      lastCountedDate: countedDates[9],
      nextFirstCountedDate: nextFirst,
      startsAtMs,
      endsAtMs,
    });
    first = nextFirst;
  }
  // Current cycle: the one whose span contains now, or cycle 1 before the anchor.
  const nowDate = partsFor(seedZone(states), nowMs).date;
  let current = 1;
  if (nowDate >= cycles[0].firstCountedDate) {
    for (const c of cycles) {
      if (c.startsAtMs <= nowMs && nowMs < c.endsAtMs) {
        current = c.number;
        break;
      }
      if (c.startsAtMs > nowMs) {
        current = c.number;
        break;
      }
    }
    if (cycles[cycles.length - 1].endsAtMs <= nowMs) current = cycles.length + 1;
  }
  return { cycles, current };
}

/** How many cycles exist up to now (the current cycle's number). */
export function currentCycleNumber(states: CalendarState[], nowMs: number): number {
  const seed = states[0];
  const nowDate = partsFor(seed.time_zone, nowMs).date;
  if (nowDate < seed.cycle_anchor) return 1;
  // Walk forward, counting cycles, until we find the one containing now.
  let first = nextCountedOnOrAfter(seed, seed.cycle_anchor);
  for (let n = 1; n <= 1000; n++) {
    const { countedDates, nextFirst } = cycleSpan(states, first);
    const startsAtMs = localMidnightInstant(calendarEffectiveOn(states, countedDates[0]).time_zone, countedDates[0]);
    const endsAtMs = localMidnightInstant(calendarEffectiveOn(states, nextFirst).time_zone, nextFirst);
    if (nowMs < startsAtMs) return n;
    if (nowMs >= startsAtMs && nowMs < endsAtMs) return n;
    first = nextFirst;
  }
  return 1000;
}

export function validateCalendarSpec(
  spec: unknown,
  anchorHistory: boolean,
  storedAnchor: string
): { spec: CalendarSpec | null; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  if (typeof spec !== "object" || spec === null) {
    return { spec: null, fields: { time_zone: "Choose a time zone from the list." } };
  }
  const body = spec as Record<string, unknown>;
  const zone = body.time_zone;
  if (typeof zone !== "string" || !validZone(zone)) {
    fields.time_zone = "Choose a time zone from the list.";
  }
  const weekdaysRaw = body.working_weekdays;
  const weekdays: number[] = [];
  if (Array.isArray(weekdaysRaw)) {
    for (const w of weekdaysRaw) {
      if (typeof w === "number" && Number.isInteger(w) && w >= 1 && w <= 7 && !weekdays.includes(w)) weekdays.push(w);
    }
  }
  if (weekdays.length === 0) fields.working_weekdays = "Pick at least one working day.";

  const holidays: Holiday[] = [];
  const holidaysRaw = body.holidays;
  if (Array.isArray(holidaysRaw)) {
    const seenDates = new Set<string>();
    for (const h of holidaysRaw) {
      if (typeof h !== "object" || h === null) continue;
      const { date, name } = h as Record<string, unknown>;
      const parsed = parseDate(date);
      if (!parsed) {
        fields.holidays = "Enter a date as YYYY-MM-DD.";
        continue;
      }
      if (seenDates.has(parsed)) {
        fields.holidays = "That date is already a holiday.";
        continue;
      }
      seenDates.add(parsed);
      if (typeof name !== "string" || name.trim().length === 0) {
        fields.holidays = "Give the holiday a name.";
        continue;
      }
      if (codePointLength(name) > 60) {
        fields.holidays = "Holiday names can be up to 60 characters.";
        continue;
      }
      holidays.push({ date: parsed, name });
    }
  }

  const anchorRaw = body.cycle_anchor;
  const anchor = parseDate(anchorRaw);
  const candidate: CalendarSpec = {
    time_zone: typeof zone === "string" ? zone : "",
    working_weekdays: weekdays,
    holidays,
    cycle_anchor: anchor ?? "",
  };
  if (!anchor) {
    fields.cycle_anchor = "Enter a date as YYYY-MM-DD.";
  } else {
    const anchorChanged = anchor !== storedAnchor;
    if (anchorChanged) {
      if (anchorHistory) {
        fields.cycle_anchor = "The first cycle start can't change after cycle 1 has begun.";
      } else {
        // It may change while today is before the stored anchor; it must be a working day.
        const wd = weekdays.length > 0 ? weekdays : [1, 2, 3, 4, 5];
        const cal = { ...candidate, working_weekdays: wd };
        if (!isCounted(cal, anchor)) {
          fields.cycle_anchor = "The first cycle must start on a working day.";
        }
      }
    }
  }
  if (Object.keys(fields).length > 0) return { spec: null, fields };
  return { spec: candidate, fields: {} };
}
