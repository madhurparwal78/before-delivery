import { TURIN_ZONE } from "./towns.ts";

const DAY_MS = 86_400_000;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

/** Wall clock in a zone as `YYYY-MM-DD` and `HH:MM:SS`. */
function wall(at: Date, zone: string): { date: string; time: string } {
  const parts: Record<string, string> = {};
  for (const part of formatter(zone).formatToParts(at)) parts[part.type] = part.value;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

export function wholeSecond(at: Date = new Date()): Date {
  return new Date(Math.floor(at.getTime() / 1000) * 1000);
}

/** Every instant in the API: whole-second UTC with a Z. */
export function instant(at: Date): string {
  return `${at.toISOString().slice(0, 19)}Z`;
}

export function addSeconds(at: Date, seconds: number): Date {
  return new Date(at.getTime() + seconds * 1000);
}

export function localDate(at: Date, zone: string): string {
  return wall(at, zone).date;
}

export function turinToday(): string {
  return localDate(new Date(), TURIN_ZONE);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 for Monday through 6 for Sunday. */
export function weekday(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function mondayOf(date: string): string {
  return addDays(date, -weekday(date));
}

export function isRealDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().startsWith(text);
}

export function isRealTime(text: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
}

/**
 * The instant of a wall time in a zone. A wall time that happens twice is the first of the two;
 * one that does not exist on its day gives null.
 */
export function wallInstant(date: string, time: string, zone: string): Date | null {
  const asUtc = Date.parse(`${date}T${time.length === 5 ? `${time}:00` : time}Z`);
  const offsets = new Set(
    [asUtc - DAY_MS, asUtc + DAY_MS].map((probe) => {
      const seen = wall(new Date(probe), zone);
      return Date.parse(`${seen.date}T${seen.time}Z`) - probe;
    }),
  );
  const matches = [...offsets]
    .map((offset) => new Date(asUtc - offset))
    .filter((candidate) => {
      const seen = wall(candidate, zone);
      return seen.date === date && seen.time.startsWith(time);
    })
    .sort((a, b) => a.getTime() - b.getTime());
  return matches[0] ?? null;
}

/** `<date>`: `Mon 29 Mar 2027`. */
export function dateCopy(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return `${DAYS[weekday(date)]} ${day} ${MONTHS[month - 1]} ${year}`;
}

/** `<time>`: 24-hour `HH:MM` in a zone, dropping the seconds. */
export function timeCopy(at: Date, zone: string = TURIN_ZONE): string {
  return wall(at, zone).time.slice(0, 5);
}

/** `<minute>`: an instant rounded up to a whole minute, as Turin `HH:MM`. */
export function minuteCopy(at: Date): string {
  return timeCopy(new Date(Math.ceil(at.getTime() / 60_000) * 60_000));
}

/** `<datetime>`: `Mon 29 Mar 2027, 06:20 Turin time`. */
export function datetimeCopy(at: Date): string {
  return `${dateCopy(localDate(at, TURIN_ZONE))}, ${timeCopy(at)} Turin time`;
}

function utcOffsetAtNoon(date: string, zone: string): number {
  const noon = Date.parse(`${date}T12:00:00Z`);
  const seen = wall(new Date(noon), zone);
  return Date.parse(`${seen.date}T${seen.time}Z`) - noon;
}

/** The first date after `from` on which the zone's clock has changed. */
export function nextClockChange(zone: string, from: string): string {
  let day = from;
  for (;;) {
    const next = addDays(day, 1);
    if (utcOffsetAtNoon(day, zone) !== utcOffsetAtNoon(next, zone)) return next;
    day = next;
  }
}
