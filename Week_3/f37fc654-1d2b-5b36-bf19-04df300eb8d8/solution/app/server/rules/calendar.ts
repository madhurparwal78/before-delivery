// Venue-zone instants (brief: Install days, Holds, Quotes, Milestones and due dates, Sponsor links,
// Crew alerts). Every instant the server decides on is computed here from the server clock.
import { config } from "../config.js";

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClock(ms: number, zone: string): number[] {
  let fmt = formatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(zone, fmt);
  }
  const get = (type: string): number => Number(fmt.formatToParts(ms).find((p) => p.type === type)?.value);
  return [get("year"), get("month"), get("day"), get("hour"), get("minute"), get("second")];
}

/** The zone's UTC offset at an instant, in milliseconds. */
function offsetMs(ms: number, zone: string): number {
  const [y, mo, d, h, mi, s] = wallClock(ms, zone);
  return Date.UTC(y, mo - 1, d, h, mi, s) - Math.floor(ms / 1000) * 1000;
}

/** The venue-local calendar date `YYYY-MM-DD` at an instant. */
export function localDate(ms: number, zone: string): string {
  const [y, mo, d] = wallClock(ms, zone);
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The instant a venue-local wall-clock time occurs on a date. */
function zonedInstant(date: string, hour: number, minute: number, second: number, zone: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, mo - 1, d, hour, minute, second);
  const first = wall - offsetMs(wall, zone);
  return wall - offsetMs(first, zone);
}

/** ISO 8601 carrying the venue's UTC offset on that instant. */
export function isoInZone(ms: number, zone: string): string {
  const offset = offsetMs(ms, zone);
  const local = new Date(Math.floor(ms / 1000) * 1000 + offset).toISOString().slice(0, 19);
  const minutes = Math.round(offset / 60_000);
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const ms = (date: string): number => Date.parse(`${date}T00:00:00Z`);
  return Math.round((ms(to) - ms(from)) / DAY_MS);
}

export function isCalendarDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value;
}

/** An install day is the venue-local date between its two local midnights (23 or 25 hours on DST days). */
export function dayBounds(date: string, zone: string): { startsAt: number; endsAt: number } {
  return { startsAt: zonedInstant(date, 0, 0, 0, zone), endsAt: zonedInstant(addDays(date, 1), 0, 0, 0, zone) };
}

const BOOKABLE_FROM_DAYS = 21;
export const BOOKABLE_TO_DAYS = 365;

/** A date can be held from 21 to 365 days (inclusive) after the venue-local date today. */
export function isBookable(date: string, zone: string, now: number): boolean {
  const ahead = daysBetween(localDate(now, zone), date);
  return ahead >= BOOKABLE_FROM_DAYS && ahead <= BOOKABLE_TO_DAYS;
}

/** 23:59:59 venue-local on the 14th calendar day after the trigger's venue-local date. */
export function dueAt(triggeredAt: number, zone: string): number {
  return zonedInstant(addDays(localDate(triggeredAt, zone), 14), 23, 59, 59, zone);
}

/** A quote's validUntil: the calendar rule, or issue + QUOTE_TTL_SECONDS when that is set. */
export function quoteValidUntil(issuedAt: number, zone: string): number {
  const ttl = config.timers.quoteTtlSeconds;
  return ttl === null ? dueAt(issuedAt, zone) : Math.floor(issuedAt / 1000) * 1000 + ttl * 1000;
}

/** Usable through the second validUntil itself; refused from the next second. */
export function quoteUsable(validUntil: number, now: number): boolean {
  return now < validUntil + 1000;
}

export function holdExpiresAt(recordedAt: number): number {
  return recordedAt + config.timers.holdSeconds * 1000;
}

/** Active while server time is strictly before expiresAt. */
export function holdActive(expiresAt: number, now: number): boolean {
  return now < expiresAt;
}

export function secondsRemaining(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

export function inviteExpiresAt(sentAt: number): number {
  return sentAt + config.timers.inviteTtlSeconds * 1000;
}

/** Valid while server time is strictly before expiresAt. */
export function inviteValid(expiresAt: number, now: number): boolean {
  return now < expiresAt;
}

/** Day-before load-in alert: 09:00 venue-local on the day before the install day. */
export function loadInAlertAt(installDate: string, zone: string): number {
  return zonedInstant(addDays(installDate, -1), 9, 0, 0, zone);
}
