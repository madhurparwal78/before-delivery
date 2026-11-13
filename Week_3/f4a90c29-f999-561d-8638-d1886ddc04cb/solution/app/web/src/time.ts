import { Store } from "./store";
import type { Zone } from "./types";

export const MINUTE = 60000;
export const DAY = 86400000;
export const ZONES: Zone[] = ["America/New_York", "Europe/London", "Pacific/Auckland"];
export const CITY_OF: Record<Zone, string> = {
  "America/New_York": "New York",
  "Europe/London": "London",
  "Pacific/Auckland": "Auckland",
};

/** A wall is a clock reading with no zone, held as UTC-labelled milliseconds. */
export type Wall = number;

const formats = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    formats.set(zone, f);
  }
  return f;
}

export function wallInZone(instant: number, zone: string): Wall {
  const p: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute);
}

export function instantOfWall(wall: Wall, zone: string): number {
  let guess = wall - (wallInZone(wall, zone) - wall);
  guess = wall - (wallInZone(guess, zone) - guess);
  return guess;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function dateOf(w: Wall): string {
  const d = new Date(w);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function timeOf(w: Wall): string {
  const d = new Date(w);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function parseDate(s: string): Wall | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const w = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return dateOf(w) === s ? w : null;
}

/** Reads `YYYY-MM-DDTHH:MM`, `YYYY-MM-DD HH:MM` or `YYYY-MM-DD`. */
export function parseWall(s: string): Wall | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  const day = parseDate(m[1]);
  if (day === null) return null;
  if (m[2] === undefined) return day;
  if (+m[2] > 23 || +m[3] > 59) return null;
  return day + (+m[2] * 60 + +m[3]) * MINUTE;
}

export function apiWall(w: Wall): string {
  return `${dateOf(w)}T${timeOf(w)}`;
}

export function typedWall(w: Wall): string {
  return `${dateOf(w)} ${timeOf(w)}`;
}

export function addDays(date: string, n: number): string {
  return dateOf((parseDate(date) as Wall) + n * DAY);
}

export function addMonths(date: string, n: number): string {
  const w = new Date(parseDate(date) as Wall);
  const target = new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return dateOf(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(w.getUTCDate(), last)));
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function weekday(date: string): number {
  return new Date(parseDate(date) as Wall).getUTCDay();
}

/** `Mon 8 Mar 2027`. */
export function dayLabel(date: string): string {
  const w = new Date(parseDate(date) as Wall);
  return `${WEEKDAYS[w.getUTCDay()]} ${w.getUTCDate()} ${MONTHS[w.getUTCMonth()]} ${w.getUTCFullYear()}`;
}

export function shortDayLabel(date: string): string {
  const w = new Date(parseDate(date) as Wall);
  return `${WEEKDAYS[w.getUTCDay()]} ${w.getUTCDate()} ${MONTHS[w.getUTCMonth()]}`;
}

export function monthTitle(date: string): string {
  const w = new Date(parseDate(date) as Wall);
  return `${MONTH_NAMES[w.getUTCMonth()]} ${w.getUTCFullYear()}`;
}

export function rangeTitle(from: string, to: string): string {
  const a = new Date(parseDate(from) as Wall);
  const b = new Date(parseDate(to) as Wall);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const left = `${a.getUTCDate()}${a.getUTCMonth() === b.getUTCMonth() && sameYear ? "" : " " + MONTHS[a.getUTCMonth()]}${sameYear ? "" : " " + a.getUTCFullYear()}`;
  return `${left} – ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
}

export function firstOfMonth(date: string): string {
  return date.slice(0, 8) + "01";
}

/** Whole days between two dates. */
export function daysBetween(a: string, b: string): number {
  return Math.round(((parseDate(b) as Wall) - (parseDate(a) as Wall)) / DAY);
}

// The server clock: the device clock never decides today, the now line or any default date.
let clockOffset = 0;
/** Counts clock syncs, so views that show the date or the now line read the server clock again. */
export const clock$ = new Store(0);

export function serverNow(): number {
  return Date.now() + clockOffset;
}

export async function syncClock(): Promise<void> {
  const before = Date.now();
  const response = await fetch("/api/time", { cache: "no-store" });
  if (!response.ok) return;
  const body = (await response.json()) as { now_utc: string };
  clockOffset = Date.parse(body.now_utc) + (Date.now() - before) / 2 - Date.now();
  clock$.set((n) => n + 1);
}

export function prefersReducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}
