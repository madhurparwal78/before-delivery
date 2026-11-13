import { Temporal } from '@js-temporal/polyfill';

/** Inclusive interval of nights: first..last both belong to the interval. */
export interface NightInterval {
  first: string; // YYYY-MM-DD
  last: string;  // YYYY-MM-DD
}

export type PlainDate = Temporal.PlainDate;
export type ZonedDateTime = Temporal.ZonedDateTime;
export type Instant = Temporal.Instant;
export type PlainTime = Temporal.PlainTime;

export function parseDate(s: string): PlainDate {
  return Temporal.PlainDate.from(s);
}

export function parseTime(hhmm: string): PlainTime {
  return Temporal.PlainTime.from(hhmm);
}

export function addDays(d: PlainDate, n: number): PlainDate {
  return d.add({ days: n });
}

export function daysBetween(a: PlainDate, b: PlainDate): number {
  return b.since(a).days;
}

export function overlaps(a: NightInterval, b: NightInterval): boolean {
  return Temporal.PlainDate.compare(parseDate(a.first), parseDate(b.last)) <= 0
    && Temporal.PlainDate.compare(parseDate(b.first), parseDate(a.last)) <= 0;
}

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)$/;
const RFC3339_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

/** Parse an RFC 3339 instant: any offset or Z, no fractional seconds. */
export function parseInstant(s: string): Instant {
  if (!RFC3339.test(s)) throw new Error('bad instant');
  return Temporal.Instant.from(s);
}

/** True for a string already in output form: numeric offset, never Z. */
export function isOutputInstant(s: string): boolean {
  return RFC3339_OFFSET.test(s);
}

export function nowInstant(): Instant {
  return Temporal.Now.instant();
}

/** Wall clock + date + zone to a ZonedDateTime, Temporal compatible disambiguation. */
export function zonedAt(date: PlainDate, time: PlainTime, zone: string): ZonedDateTime {
  const dt = new Temporal.PlainDateTime(date.year, date.month, date.day, time.hour, time.minute);
  return dt.toZonedDateTime(zone);
}

/** The daily wall-clock exchange time this firstExchangeAt reads in its zone. */
export function exchangeWallClock(firstExchangeAt: string): { date: PlainDate; time: PlainTime; zone: string } {
  const zdt = Temporal.ZonedDateTime.from(firstExchangeAt);
  return { date: zdt.toPlainDate(), time: zdt.toPlainTime(), zone: zdt.timeZoneId };
}

/** RFC 3339 output in the zone's numeric offset at that instant; never Z. */
export function formatInstant(date: PlainDate, time: PlainTime, zone: string): string {
  const s = zonedAt(date, time, zone).toString({ timeZoneName: 'never' });
  return /T\d{2}:\d{2}:00/.test(s) ? s : s.replace(/T(\d{2}:\d{2})/, 'T$1:00');
}

export function instantOutput(i: Instant, zone: string): string {
  const s = i.toZonedDateTimeISO(zone).toString({ timeZoneName: 'never' });
  return /T\d{2}:\d{2}:00/.test(s) ? s : s.replace(/T(\d{2}:\d{2})/, 'T$1:00');
}

/** Any IANA zone name, links included. */
export function isValidZone(name: string): boolean {
  try {
    new Temporal.ZonedDateTime(0n, name);
    return true;
  } catch {
    return false;
  }
}

export function instantOnTheMinute(i: Instant): boolean {
  const zdt = i.toZonedDateTimeISO('UTC');
  return zdt.second === 0 && zdt.millisecond === 0 && zdt.microsecond === 0 && zdt.nanosecond === 0;
}

/** Local date of an instant in a zone. */
export function localDate(i: Instant, zone: string): PlainDate {
  return i.toZonedDateTimeISO(zone).toPlainDate();
}
