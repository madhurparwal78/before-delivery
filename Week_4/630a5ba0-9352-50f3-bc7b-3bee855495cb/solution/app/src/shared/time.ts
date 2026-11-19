// Calendar maths in a member's profile time zone, built on Intl only.
// Dates are "YYYY-MM-DD", local times "HH:MM", instants epoch milliseconds.

const MINUTE = 60_000;
const DAY = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, found);
  }
  return found;
}

type Wall = { date: string; time: string };

function parts(instant: number, zone: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return out;
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** Offset of the zone from UTC at an instant, in milliseconds. */
function offsetAt(instant: number, zone: string): number {
  const p = parts(instant, zone);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(instant / 1000) * 1000;
}

export function wallOf(instant: number, zone: string): Wall {
  const p = parts(instant, zone);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

export function isZone(zone: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(zone)) return false;
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}

export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export function isTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d) + days * DAY);
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

export function daysBetween(from: string, to: string): number {
  const toUtc = (s: string): number => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(to) - toUtc(from)) / DAY);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/**
 * The instant a local wall-clock time names. In a daylight-saving gap the time moves later by the
 * gap's length; when the time occurs twice the earlier instant wins.
 */
export function localToInstant(date: string, time: string, zone: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const before = offsetAt(naive - DAY / 2, zone);
  const after = offsetAt(naive + DAY / 2, zone);
  const valid = [naive - before, naive - after].filter((t) => {
    const w = wallOf(t, zone);
    return w.date === date && w.time === time;
  });
  return valid.length ? Math.min(...valid) : naive - before;
}

/** The member's today: the server (or device) clock read in the profile zone. */
export function todayIn(zone: string, now: number): string {
  return wallOf(now, zone).date;
}

/** A board day runs from local 00:00 to the next local 00:00. */
export function dayBounds(date: string, zone: string): { start: number; end: number } {
  return { start: localToInstant(date, "00:00", zone), end: localToInstant(addDays(date, 1), "00:00", zone) };
}

export function overlapMinutes(start: number, end: number, date: string, zone: string): number {
  const bounds = dayBounds(date, zone);
  const span = Math.min(end, bounds.end) - Math.max(start, bounds.start);
  return span > 0 ? Math.round(span / MINUTE) : 0;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Thursday 29 October" */
export function dayLabel(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${WEEKDAYS[weekdayOf(date)]} ${d} ${MONTHS[m - 1]}`;
}

/** "Thu 29" */
export function shortDay(date: string): string {
  return `${WEEKDAYS[weekdayOf(date)].slice(0, 3)} ${Number(date.slice(8, 10))}`;
}

export function shiftTime(time: string, minutes: number): string {
  const total = minutesOf(time) + minutes;
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}

/** ISO week "YYYY-Www" holding a date. */
export function isoWeekOf(date: string): string {
  const thursday = addDays(date, 3 - weekdayOf(date));
  const year = Number(thursday.slice(0, 4));
  const week = Math.floor(daysBetween(`${year}-01-01`, thursday) / 7) + 1;
  return `${year}-W${pad(week)}`;
}

/** Monday of an ISO week, or null when the text is not a real ISO week. */
export function mondayOfIsoWeek(week: string): string | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!match) return null;
  const year = Number(match[1]);
  const number = Number(match[2]);
  const jan4 = `${year}-01-04`;
  const monday = addDays(addDays(jan4, -weekdayOf(jan4)), (number - 1) * 7);
  return number >= 1 && isoWeekOf(monday) === week ? monday : null;
}

export function isoInstant(instant: number): string {
  return new Date(instant).toISOString().replace(/\.\d{3}Z$/, "Z");
}
