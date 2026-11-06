import { AGENCY_TZ } from "./domain";

const SUNDAY = 0;
const SATURDAY = 6;

export interface Zoned {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 Sunday .. 6
}

function partsInZone(date: Date, tz: string): Zoned {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour === "24" ? "0" : p.hour),
    minute: Number(p.minute),
    weekday: weekdays.indexOf(p.weekday),
  };
}

export function partsCentral(date: Date): Zoned {
  return partsInZone(date, AGENCY_TZ);
}

function offsetMinutesAt(date: Date, tz: string): number {
  const p = partsInZone(date, tz);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  // Sub-minute remainder is second drift; the zone offset is the whole minutes.
  return Math.trunc((asUTC - date.getTime()) / 60000);
}

/** Format an instant as an ISO 8601 string carrying the Central-time offset. */
export function isoCentral(date: Date): string {
  const off = offsetMinutesAt(date, AGENCY_TZ);
  const sign = off < 0 ? "-" : "+";
  const a = Math.abs(off);
  const hh = String(Math.floor(a / 60)).padStart(2, "0");
  const mm = String(a % 60).padStart(2, "0");
  const p = partsCentral(date);
  return (
    `${p.year}-${pad(p.month)}-${pad(p.day)}T` +
    `${pad(p.hour)}:${pad(p.minute)}:00${sign}${hh}:${mm}`
  );
}

/** Parse an ISO 8601 string (any offset) or return null. */
export function parseInstant(input: string): Date | null {
  if (typeof input !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(input)) {
    return null;
  }
  const normalised = (input.length === 16 ? input + ":00" : input).replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(normalised.endsWith("T") ? normalised.slice(0, -1) : normalised);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Convert a Central-time local date/time (minutes after midnight) to an instant. */
export function centralToInstant(dateISO: string, minutes: number): Date {
  const naive = Date.parse(`${dateISO}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00Z`);
  if (Number.isNaN(naive)) return new Date(NaN);
  // Central time is UTC-6 (CST) or UTC-5 (CDT); the instant is the naive time
  // plus the offset. Try each candidate and confirm by round-trip.
  for (const offMinutes of [360, 300]) {
    const guess = new Date(naive + offMinutes * 60000);
    const p = partsCentral(guess);
    if (p.hour * 60 + p.minute === minutes && centralDateISO(guess) === dateISO) {
      return guess;
    }
  }
  return new Date(NaN);
}

/** The Central-time calendar date (YYYY-MM-DD) of an instant. */
export function centralDateISO(date: Date): string {
  const p = partsCentral(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutes after midnight Central of an instant. */
export function minutesOfDayCentral(date: Date): number {
  const p = partsCentral(date);
  return p.hour * 60 + p.minute;
}

/** True when two instants are on the same Central-time calendar date. */
export function sameCentralDay(a: Date, b: Date): boolean {
  return centralDateISO(a) === centralDateISO(b);
}

/** Monday 00:00 Central of the week containing `date`. */
export function centralWeekStart(date: Date): Date {
  const p = partsCentral(date);
  const dayOffset = p.weekday === SUNDAY ? 6 : p.weekday - 1;
  const naive = Date.parse(`${centralDateISO(date)}T00:00:00Z`) - dayOffset * 86_400_000;
  const mondayISO = new Date(naive).toISOString().slice(0, 10);
  return centralToInstant(mondayISO, 0);
}

/** The Central-time weekday (0 Sunday..6) of an instant. */
export function centralWeekday(date: Date): number {
  return partsCentral(date).weekday;
}

/** Midnight (00:00) Central of the day containing `date`. */
export function centralDayStart(date: Date): Date {
  return centralToInstant(centralDateISO(date), 0);
}

/**
 * Business minutes between two instants: whole elapsed minutes that fall on
 * Monday–Friday in the agency zone.
 */
export function businessMinutes(from: Date, to: Date): number {
  if (to.getTime() <= from.getTime()) return 0;
  let total = 0;
  let cursor = new Date(from.getTime());
  while (true) {
    const dayStart = centralDayStart(cursor);
    const wd = centralWeekday(dayStart);
    const weekend = wd === SUNDAY || wd === SATURDAY;
    const nextDay = new Date(dayStart.getTime() + 24 * 3600 * 1000);
    const segEnd = to.getTime() < nextDay.getTime() ? to : nextDay;
    if (segEnd.getTime() > cursor.getTime() && !weekend) {
      total += Math.floor((segEnd.getTime() - cursor.getTime()) / 60000);
    }
    if (segEnd.getTime() >= to.getTime()) break;
    cursor = nextDay;
  }
  return total;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatDayShort(date: Date): string {
  const p = partsCentral(date);
  return `${DAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]}`;
}

export function formatDayLong(date: Date): string {
  const p = partsCentral(date);
  return `${DAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

export function formatTimeHM(date: Date): string {
  const p = partsCentral(date);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatRange(start: Date, end: Date): string {
  return `${formatDayShort(start)} ${formatTimeHM(start)}–${formatTimeHM(end)}`;
}

export function formatHMM(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
}

export function formatHoursAndMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)} h ${pad(minutes % 60)} m`;
}

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const a = Math.abs(cents);
  return `${sign}$${Math.floor(a / 100).toLocaleString("en-US")}.${pad(a % 100)}`;
}
