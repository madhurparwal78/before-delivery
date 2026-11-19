import type { Config } from './config';

export interface Clock {
  now(): Date;
  config: Config;
}

/**
 * All server-side rules read time exclusively through the app clock, which lives in
 * the database so every instance sharing the database agrees on it.
 */
export class DbClock implements Clock {
  current: Date = new Date();
  constructor(readonly config: Config) {}
  now(): Date {
    return this.current;
  }
  set(d: Date): void {
    this.current = d;
  }
}

const DATE_TIME = new Map<string, Intl.DateTimeFormat>();
const DATE_ONLY = new Map<string, Intl.DateTimeFormat>();

export function dayStart(d: Date, tz: string): Date {
  // Local start of day in tz, expressed as a UTC instant.
  const key = `${d.toISOString()}|${tz}`;
  void key;
  const fmt = getDateTimeFormat(tz);
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const y = Number(get('year'));
  const mo = Number(get('month')) - 1;
  const day = Number(get('day'));
  return zonedTimeToUtc(y, mo, day, 0, 0, 0, 0, tz);
}

export function dayEnd(d: Date, tz: string): Date {
  const fmt = getDateTimeFormat(tz);
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const y = Number(get('year'));
  const mo = Number(get('month')) - 1;
  const day = Number(get('day'));
  return zonedTimeToUtc(y, mo, day, 23, 59, 59, 999, tz);
}

export function calendarDateOf(d: Date, tz: string): string {
  const fmt = getDateFormat(tz);
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return `${get('year')}-${pad2(Number(get('month')))}-${pad2(Number(get('day')))}`;
}

export function calendarDateOfParts(d: Date, tz: string): { y: number; m: number; d: number } {
  const fmt = getDateFormat(tz);
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')) };
}

/** Parse a YYYY-MM-DD calendar date as a start-of-day instant in tz. */
export function parseDay(date: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Bad date ${date}`);
  return zonedTimeToUtc(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0, tz);
}

export function endOfParseDay(date: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Bad date ${date}`);
  return zonedTimeToUtc(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999, tz);
}

export function addDays(date: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Bad date ${date}`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const next = new Date(t + days * 86400000);
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

export function dayDiff(a: string, b: string): number {
  const pa = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a);
  const pb = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b);
  if (!pa || !pb) throw new Error('Bad date');
  const ta = Date.UTC(Number(pa[1]), Number(pa[2]) - 1, Number(pa[3]));
  const tb = Date.UTC(Number(pb[1]), Number(pb[2]) - 1, Number(pb[3]));
  return Math.round((tb - ta) / 86400000);
}

export function isoOf(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, '') + 'Z';
}

export function isoMilli(d: Date): string {
  return d.toISOString();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function getDateTimeFormat(tz: string): Intl.DateTimeFormat {
  let f = DATE_TIME.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    DATE_TIME.set(tz, f);
  }
  return f;
}

function getDateFormat(tz: string): Intl.DateTimeFormat {
  let f = DATE_ONLY.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    DATE_ONLY.set(tz, f);
  }
  return f;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** D MMM YYYY in tz, e.g. 15 Apr 2026 or 2 Mar 2026. */
export function formatDay(dateOrDay: string | Date, tz: string): string {
  let y: number;
  let m: number;
  let d: number;
  if (typeof dateOrDay === 'string') {
    const mm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOrDay);
    if (!mm) throw new Error(`Bad date ${dateOrDay}`);
    y = Number(mm[1]);
    m = Number(mm[2]);
    d = Number(mm[3]);
  } else {
    const p = calendarDateOfParts(dateOrDay, tz);
    y = p.y;
    m = p.m;
    d = p.d;
  }
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** D MMM YYYY HH:mm in tz. */
export function formatDateTime(d: Date, tz: string): string {
  const fmt = getDateTimeFormat(tz);
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return `${Number(get('day'))} ${MONTHS[Number(get('month')) - 1]} ${get('year')} ${get('hour')}:${get('minute')}`;
}

/** HH:mm in tz. */
export function formatTime(d: Date, tz: string): string {
  const fmt = getDateTimeFormat(tz);
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return `${get('hour')}:${get('minute')}`;
}

/**
 * Convert a local wall-clock time in tz to a UTC instant. Uses the standard-time
 * offset when the local time is ambiguous or nonexistent.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  tz: string,
): Date {
  const naive = Date.UTC(year, month, day, hour, minute, second, ms);
  const guess = new Date(naive);
  let offset = tzOffsetMs(guess, tz);
  const asTz = new Date(naive - offset);
  const offset2 = tzOffsetMs(asTz, tz);
  if (offset2 !== offset) offset = offset2;
  return new Date(naive - offset);
}

function tzOffsetMs(d: Date, tz: string): number {
  const dtf = getDateTimeFormat(tz);
  const parts = dtf.formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUTC = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asUTC - (d.getTime() - d.getTime() % 1000);
}
