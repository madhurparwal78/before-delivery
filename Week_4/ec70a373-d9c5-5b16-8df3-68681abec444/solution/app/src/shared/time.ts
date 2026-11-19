// Site-local wall time: every date and time the brief shows is read in a site's IANA zone.

export type IsoDate = string;
/** Minutes after local midnight, 0 to 1440 (1440 is 24:00). */
export type WallMinutes = number;

interface WallClock {
  date: IsoDate;
  minutes: WallMinutes;
  seconds: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, found);
  }
  return found;
}

function fields(utcMs: number, timeZone: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return out;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

export function wallClock(utcMs: number, timeZone: string): WallClock {
  const f = fields(utcMs, timeZone);
  const date = `${pad(f.year ?? 0, 4)}-${pad(f.month ?? 0)}-${pad(f.day ?? 0)}`;
  return { date, minutes: (f.hour ?? 0) * 60 + (f.minute ?? 0), seconds: f.second ?? 0 };
}

function offsetMs(utcMs: number, timeZone: string): number {
  const f = fields(utcMs, timeZone);
  const asUtc = Date.UTC(f.year ?? 0, (f.month ?? 1) - 1, f.day ?? 1, f.hour ?? 0, f.minute ?? 0, f.second ?? 0);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

function naiveMs(date: IsoDate, minutes: WallMinutes): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) + minutes * MINUTE_MS;
}

/**
 * The instant a site-local wall time names. A time the clocks skip moves forward by the jump;
 * a time that occurs twice means its first occurrence.
 */
export function localToUtc(date: IsoDate, minutes: WallMinutes, timeZone: string): number {
  const naive = naiveMs(date, minutes);
  const before = offsetMs(naive - DAY_MS / 2, timeZone);
  const after = offsetMs(naive + DAY_MS / 2, timeZone);
  const valid = [naive - before, naive - after].filter((c) => offsetMs(c, timeZone) === naive - c);
  if (valid.length === 0) return naive - before;
  return Math.min(...valid);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(naiveMs(date, 0) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((naiveMs(to, 0) - naiveMs(from, 0)) / DAY_MS);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
type Weekday = (typeof WEEKDAYS)[number];

export function weekdayOf(date: IsoDate): Weekday {
  return WEEKDAYS[new Date(naiveMs(date, 0)).getUTCDay()] ?? "Sunday";
}

export function formatWall(minutes: WallMinutes): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function parseWall(value: string): WallMinutes | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (m > 59 || h > 24 || (h === 24 && m !== 0)) return null;
  return h * 60 + m;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(naiveMs(value, 0)).toISOString().slice(0, 10) === value;
}

/** ISO-8601 UTC with exactly three fractional-second digits, ending in Z. */
export function isoInstant(utcMs: number): string {
  return new Date(utcMs).toISOString();
}

/** Local `YYYY-MM-DDTHH:MM:SS` wall time. */
export function localNow(utcMs: number, timeZone: string): string {
  const w = wallClock(utcMs, timeZone);
  return `${w.date}T${formatWall(w.minutes)}:${pad(w.seconds)}`;
}

/** Wall time of an instant as shown on a given local date's dial: 1440 when it is that date's next midnight. */
export function wallOn(date: IsoDate, utcMs: number, timeZone: string): WallMinutes {
  const w = wallClock(utcMs, timeZone);
  if (w.date === date) return w.minutes;
  return w.date < date ? 0 : 1440;
}

interface WallSpan {
  start: WallMinutes;
  end: WallMinutes;
}

/** Quarter-hour steps of a date that do not exist on the wall clock (spring forward). */
export function nonexistentSpans(date: IsoDate, timeZone: string): WallSpan[] {
  const spans: WallSpan[] = [];
  for (let m = 0; m < 1440; m += 15) {
    const w = wallClock(localToUtc(date, m, timeZone), timeZone);
    if (w.date === date && w.minutes === m) continue;
    const last = spans[spans.length - 1];
    if (last && last.end === m) last.end = m + 15;
    else spans.push({ start: m, end: m + 15 });
  }
  return spans;
}

/** Elapsed quarter hours of a wall-clock window on one date. */
export function elapsedQuarters(date: IsoDate, start: WallMinutes, end: WallMinutes, timeZone: string): number {
  return Math.round((localToUtc(date, end, timeZone) - localToUtc(date, start, timeZone)) / (15 * MINUTE_MS));
}

/** Dial geometry: 0° is 00:00 at the top, 0.25° per minute clockwise. */
export function wallDegrees(minutes: WallMinutes): number {
  return minutes * 0.25;
}
