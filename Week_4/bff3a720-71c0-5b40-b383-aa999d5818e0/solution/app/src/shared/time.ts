const NETWORK_ZONE = "Europe/Brussels";

const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: NETWORK_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
});

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const WEEKDAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Monday … 6 = Sunday */
  weekday: number;
}

export function localParts(at: Date): LocalParts {
  const found: Record<string, string> = {};
  for (const p of parts.formatToParts(at)) found[p.type] = p.value;
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    hour: Number(found.hour),
    minute: Number(found.minute),
    second: Number(found.second),
    weekday: Math.max(0, WEEKDAYS_SHORT.indexOf((found.weekday ?? "Mon") as (typeof WEEKDAYS_SHORT)[number])),
  };
}

const pad = (n: number): string => String(n).padStart(2, "0");

function offsetMinutes(at: Date): number {
  const p = localParts(at);
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at.getTime() / 1000) * 1000) / 60000;
}

/** ISO 8601 with the Europe/Brussels offset, whole seconds. */
export function isoBrussels(at: Date): string {
  const p = localParts(at);
  const offset = offsetMinutes(at);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** The instant at which Brussels wall clocks read the given date and time. */
export function brusselsInstant(year: number, month: number, day: number, hour: number, minute: number): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let guess = naive - offsetMinutes(new Date(naive)) * 60000;
  guess = naive - offsetMinutes(new Date(guess)) * 60000;
  return new Date(guess);
}

export function dateKey(at: Date): string {
  const p = localParts(at);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function monthKey(at: Date): string {
  const p = localParts(at);
  return `${p.year}-${pad(p.month)}`;
}

/** 24-hour HH:MM in the network zone. */
export function hhmm(at: Date): string {
  const p = localParts(at);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** `Fri 13 Nov` */
export function shortDate(at: Date): string {
  const p = localParts(at);
  return `${WEEKDAYS_SHORT[p.weekday]} ${p.day} ${MONTHS_SHORT[p.month - 1]}`;
}

/** `Fri 13 Nov, 08:30` */
export function shortDateTime(at: Date): string {
  return `${shortDate(at)}, ${hhmm(at)}`;
}

export interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

export function parseDateKey(key: string): CalendarDay | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const day: CalendarDay = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const check = new Date(Date.UTC(day.year, day.month - 1, day.day));
  if (check.getUTCFullYear() !== day.year || check.getUTCMonth() !== day.month - 1 || check.getUTCDate() !== day.day) return null;
  return day;
}

export function calendarKey(day: CalendarDay): string {
  return `${day.year}-${pad(day.month)}-${pad(day.day)}`;
}

function utcOf(day: CalendarDay): Date {
  return new Date(Date.UTC(day.year, day.month - 1, day.day));
}

function fromUtc(at: Date): CalendarDay {
  return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate() };
}

export function addDays(day: CalendarDay, days: number): CalendarDay {
  return fromUtc(new Date(utcOf(day).getTime() + days * 86400000));
}

/** Move by whole months, clamping to the last day of the new month. */
export function addMonths(day: CalendarDay, months: number): CalendarDay {
  const index = day.year * 12 + (day.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, day: Math.min(day.day, last) };
}

/** 0 = Monday … 6 = Sunday */
export function weekdayOf(day: CalendarDay): number {
  return (utcOf(day).getUTCDay() + 6) % 7;
}

export function daysBetween(a: CalendarDay, b: CalendarDay): number {
  return Math.round((utcOf(b).getTime() - utcOf(a).getTime()) / 86400000);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `Fri 13 Nov 2026` for the date button. */
export function buttonDate(day: CalendarDay): string {
  return `${WEEKDAYS_SHORT[weekdayOf(day)]} ${day.day} ${MONTHS_SHORT[day.month - 1]} ${day.year}`;
}

/** `Friday 13 November 2026` for a grid cell. */
export function longDate(day: CalendarDay): string {
  return `${WEEKDAYS_LONG[weekdayOf(day)]} ${day.day} ${MONTHS_LONG[day.month - 1]} ${day.year}`;
}

/** `November 2026` */
export function monthTitle(year: number, month: number): string {
  return `${MONTHS_LONG[month - 1]} ${year}`;
}

export function todayOf(at: Date): CalendarDay {
  const p = localParts(at);
  return { year: p.year, month: p.month, day: p.day };
}
