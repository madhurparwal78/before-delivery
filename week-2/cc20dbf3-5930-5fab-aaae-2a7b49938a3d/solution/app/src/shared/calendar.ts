// The library calendar: open days, closing instants and library-time formats.
// Dates are ISO `YYYY-MM-DD` strings in library time; instants are `Date`s. Every conversion between
// the two goes through the library's IANA time zone.

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface LibraryCalendar {
  timeZone: string;
  openDays: readonly Weekday[];
  closedDates: readonly string[];
  closingTime: string;
}

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function epochDay(day: string): number {
  const match = ISO_DATE.exec(day);
  if (!match) throw new RangeError(`not an ISO date: ${day}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS;
}

function fromEpochDay(value: number): string {
  return new Date(value * DAY_MS).toISOString().slice(0, 10);
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE.test(value) && fromEpochDay(epochDay(value)) === value;
}

export function addDays(day: string, days: number): string {
  return fromEpochDay(epochDay(day) + days);
}

export function daysBetween(from: string, to: string): number {
  return epochDay(to) - epochDay(from);
}

function weekdayOf(day: string): Weekday {
  return WEEKDAYS[new Date(epochDay(day) * DAY_MS).getUTCDay()] ?? "sun";
}

export function isOpenDay(calendar: LibraryCalendar, day: string): boolean {
  return calendar.openDays.includes(weekdayOf(day)) && !calendar.closedDates.includes(day);
}

/** The first open day strictly after `day` (a span's `back_on`). */
export function nextOpenDayAfter(calendar: LibraryCalendar, day: string): string {
  let next = addDays(day, 1);
  while (!isOpenDay(calendar, next)) next = addDays(next, 1);
  return next;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  let formatter = partFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partFormatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant at which the wall clock in `timeZone` reads `day` `hh:mm`, using that date's own offset. */
function zonedInstant(day: string, hhmm: string, timeZone: string): Date {
  const [hour = 0, minute = 0] = hhmm.split(":").map(Number);
  const wall = epochDay(day) * DAY_MS + (hour * 60 + minute) * 60_000;
  const first = wall - offsetMs(new Date(wall), timeZone);
  const second = wall - offsetMs(new Date(first), timeZone);
  return new Date(second);
}

/** The local date of an instant in library time. */
export function localDate(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** The due instant: the closing time of `day` in library time. */
export function closingInstant(calendar: LibraryCalendar, day: string): Date {
  return zonedInstant(day, calendar.closingTime, calendar.timeZone);
}

const longFormatters = new Map<string, Intl.DateTimeFormat>();

/** `<local time>`: `Sun 1 Nov 2026, 18:00 EST`. */
export function formatLocalTime(instant: Date, timeZone: string): string {
  let formatter = longFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
    longFormatters.set(timeZone, formatter);
  }
  const p = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} ${p.timeZoneName}`;
}

const dayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

/** A library date for lanes and rows: `Sat 31 Oct`. */
export function formatDay(day: string): string {
  const p = Object.fromEntries(dayFormatter.formatToParts(new Date(epochDay(day) * DAY_MS)).map((part) => [part.type, part.value]));
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** A `datetime-local` value (`YYYY-MM-DDTHH:MM`) showing `instant` in library time. */
export function localInputValue(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${localDate(instant, timeZone)}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** The instant a `datetime-local` value means when read as library time, or null when malformed. */
export function instantFromLocalInput(value: string, timeZone: string): Date | null {
  const [, day, time] = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value) ?? [];
  if (!isIsoDate(day) || time === undefined) return null;
  return zonedInstant(day, time, timeZone);
}
