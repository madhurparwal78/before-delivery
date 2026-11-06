// Kitchen time: every date, month and label is computed in the kitchen's IANA zone.

export type LocalDate = string; // YYYY-MM-DD
export type LocalTime = string; // HH:MM
export type Month = string; // YYYY-MM

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(zone, f);
  }
  return f;
}

interface WallClock { year: number; month: number; day: number; hour: number; minute: number; second: number }

function wallClock(ms: number, zone: string): WallClock {
  const out: Record<string, number> = {};
  for (const p of formatter(zone).formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { year: out.year!, month: out.month!, day: out.day!, hour: out.hour!, minute: out.minute!, second: out.second! };
}

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

export function isLocalDate(s: unknown): s is LocalDate {
  if (typeof s !== "string") return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function isLocalTime(s: unknown): s is LocalTime {
  return typeof s === "string" && TIME_RE.test(s);
}

export function isMonth(s: unknown): s is Month {
  return typeof s === "string" && MONTH_RE.test(s);
}

export function minutesOf(t: LocalTime): number {
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}

export function timeOf(minutes: number): LocalTime {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function dateParts(d: LocalDate): [number, number, number] {
  return [Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10))];
}

export function addDays(d: LocalDate, n: number): LocalDate {
  const [y, m, day] = dateParts(d);
  const t = new Date(Date.UTC(y, m - 1, day + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  const [y1, m1, d1] = dateParts(from);
  const [y2, m2, d2] = dateParts(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export function weekdayKey(d: LocalDate): WeekdayKey {
  const [y, m, day] = dateParts(d);
  return WEEKDAY_KEYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]!;
}

export function monthOf(d: LocalDate): Month {
  return d.slice(0, 7);
}

export function addMonths(m: Month, n: number): Month {
  const idx = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n;
  return `${pad(Math.floor(idx / 12), 4)}-${pad((idx % 12) + 1)}`;
}

export function firstOfMonth(m: Month): LocalDate {
  return `${m}-01`;
}

/** "November 2026" */
export function monthName(m: Month): string {
  return `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
}

/** "Tuesday 27 October 2026" */
export function longDate(d: LocalDate): string {
  const [y, m, day] = dateParts(d);
  const wd = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  return `${WEEKDAY_NAMES[wd]} ${day} ${MONTH_NAMES[m - 1]} ${y}`;
}

export function localDateOf(ms: number, zone: string): LocalDate {
  const w = wallClock(ms, zone);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
}

export function localTimeOf(ms: number, zone: string): LocalTime {
  const w = wallClock(ms, zone);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

/** Minutes the zone is ahead of UTC at an instant. */
function offsetMinutes(ms: number, zone: string): number {
  const w = wallClock(ms, zone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/**
 * The instant of a kitchen-local wall time. A repeated time (fall back) means its first, earlier
 * occurrence; a time inside a spring-forward gap does not exist and returns null.
 */
export function zonedInstant(d: LocalDate, t: LocalTime, zone: string): number | null {
  const [y, m, day] = dateParts(d);
  const naive = Date.UTC(y, m - 1, day, Number(t.slice(0, 2)), Number(t.slice(3, 5)));
  const candidates = new Set<number>();
  for (const probe of [naive - 43_200_000, naive + 43_200_000]) {
    const at = naive - offsetMinutes(probe, zone) * 60_000;
    if (localDateOf(at, zone) === d && localTimeOf(at, zone) === t) candidates.add(at);
  }
  return candidates.size ? Math.min(...candidates) : null;
}

/** Local midnight that starts a date; midnight always exists in the zones Lineboard serves. */
export function startOfDay(d: LocalDate, zone: string): number {
  return zonedInstant(d, "00:00", zone)!;
}

/** ISO 8601 with the kitchen's offset at that instant, e.g. 2026-11-03T18:00:00-05:00 */
export function isoWithOffset(ms: number, zone: string): string {
  const w = wallClock(ms, zone);
  const off = offsetMinutes(ms, zone);
  const sign = off < 0 ? "-" : "+";
  const a = Math.abs(off);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** "2026-11-03 18:00" in kitchen time */
export function localStamp(ms: number, zone: string): string {
  return `${localDateOf(ms, zone)} ${localTimeOf(ms, zone)}`;
}

/** An end time: any HH:MM, or "24:00" for the end of its date (never a start). */
export function isEndTime(s: unknown): s is LocalTime {
  return s === "24:00" || isLocalTime(s);
}

/** The instant a local end time names; 24:00 is 00:00 on the next date, with that instant's offset. */
export function zonedEndInstant(d: LocalDate, t: LocalTime, zone: string): number | null {
  return t === "24:00" ? startOfDay(addDays(d, 1), zone) : zonedInstant(d, t, zone);
}
