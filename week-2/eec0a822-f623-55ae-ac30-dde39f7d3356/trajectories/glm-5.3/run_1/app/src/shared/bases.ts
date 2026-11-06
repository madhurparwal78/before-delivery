import { Decimal } from './decimal.js';

/**
 * Base clock mathematics. Europe/Zagreb (split) and Europe/Athens (lavrio),
 * including historical transitions. Athens is one hour ahead of Zagreb for the
 * era the app operates in.
 */

export type Base = 'split' | 'lavrio';

export interface Instant {
  readonly ms: number;
}

export function instant(ms: number): Instant {
  return { ms };
}

export function addSeconds(i: Instant, seconds: number): Instant {
  return { ms: i.ms + seconds * 1000 };
}

export function diffSeconds(a: Instant, b: Instant): number {
  return (a.ms - b.ms) / 1000;
}

export function instToIso(i: Instant): string {
  return new Date(i.ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Parse `2027-07-03T15:00:00Z`. Returns null on malformed input. */
export function isoToInst(s: string): Instant | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s)) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : { ms };
}

import { BASE_OFFSETS } from './offsets.js';

function baseOffsetMs(base: Base, utcMs: number): number {
  const table = BASE_OFFSETS[base];
  let offset = table[0][1];
  for (const [t, o] of table) {
    if (utcMs >= t) offset = o;
    else break;
  }
  return offset;
}

/** Base-local date of a UTC instant, as YYYY-MM-DD. */
export function localDate(base: Base, i: Instant): string {
  return new Date(i.ms + baseOffsetMs(base, i.ms)).toISOString().slice(0, 10);
}

export interface LocalWall {
  wallMs: number;
  utcMs: number | null;
  /** UTC of the repeated hour's second occurrence, or null. */
  repeatMs: number | null;
  kind: 'normal' | 'gap' | 'repeat';
}

/**
 * Resolve a base-local wall time to UTC. In the spring-forward gap returns
 * kind 'gap' with utcMs null. In the autumn repeat, utcMs is the FIRST
 * occurrence and repeatMs the second.
 */
export function wallToUtc(base: Base, year: number, month: number, day: number, hour: number, minute: number): LocalWall {
  const wallMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const probes = [7200000, 3600000, 10800000, 0];
  const valid = new Set<number>();
  for (const p of probes) {
    const utcMs = wallMs - p;
    const o = baseOffsetMs(base, utcMs);
    if (wallMs - o === utcMs) valid.add(o);
  }
  if (valid.size === 0) return { wallMs, utcMs: null, repeatMs: null, kind: 'gap' };
  const sorted = [...valid].sort((a, b) => b - a);
  if (valid.size === 1) return { wallMs, utcMs: wallMs - sorted[0], repeatMs: null, kind: 'normal' };
  return { wallMs, utcMs: wallMs - sorted[0], repeatMs: wallMs - sorted[1], kind: 'repeat' };
}

/** Base-local wall-clock components of an instant, for display. */
export function localParts(base: Base, i: Instant): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const d = new Date(i.ms + baseOffsetMs(base, i.ms));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  };
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** `Sat 3 Jul 2027` */
/** `Sat 3 Jul 2027, 17:00 Split time` */
export function fmtDateTime(base: Base, i: Instant): string {
  const p = localParts(base, i);
  const name = base === 'split' ? 'Split' : 'Lavrio';
  return `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} ${name} time`;
}

/** `Sat 3 Jul 2027` from a plain base-local date (no instant). */
export function fmtDateOnly(base: Base, date: string): string {
  const d = parseYmd(date);
  if (!d) return date;
  const wd = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
  return `${WEEKDAYS[wd]} ${d.day} ${MONTHS[d.month - 1]} ${d.year}`;
}

export function parseYmd(s: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Day of week of a base-local date: 0=Sun..6=Sat. */
export function ymdWeekday(base: Base, date: string): number {
  const d = parseYmd(date);
  if (!d) return -1;
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

/** Is the base-local date a Saturday? */
export function isSaturday(base: Base, date: string): boolean {
  return ymdWeekday(base, date) === 6;
}

/** Add n days to a YYYY-MM-DD. */
export function addDays(date: string, n: number): string {
  const d = parseYmd(date);
  if (!d) return date;
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return t.toISOString().slice(0, 10);
}

/** Difference in whole days between two base-local dates (a - b). */
/** The next Saturday (base-local) strictly after the given base-local date. */
export function nextSaturdayAfter(base: Base, date: string): string {
  const wd = ymdWeekday(base, date);
  if (wd < 0) return date;
  return addDays(date, (6 - wd + 7) % 7 || 7);
}

/**
 * Half-hour slots of one base-local day, as they really occur. Days have 46,
 * 48 or 50 slots. A repeated hour's second occurrence is labelled "(repeat)".
 */
export function daySlots(base: Base, date: string): Array<{ startsAt: Instant; label: string; repeated: boolean }> {
  const out: Array<{ startsAt: Instant; label: string; repeated: boolean }> = [];
  const d = parseYmd(date);
  if (!d) return out;
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const w = wallToUtc(base, d.year, d.month, d.day, h, m);
      if (w.utcMs === null) continue;
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      out.push({ startsAt: { ms: w.utcMs }, label: `${hh}:${mm}`, repeated: false });
      if (w.repeatMs !== null) {
        out.push({ startsAt: { ms: w.repeatMs }, label: `${hh}:${mm} (repeat)`, repeated: true });
      }
    }
  }
  out.sort((a, b) => a.startsAt.ms - b.startsAt.ms);
  return out;
}

/** Metres to one decimal + feet and inches, e.g. `18.3 m – 60 ft 0 in`. */
export function fmtMeasurement(metres: string | number): string {
  const m = new Decimal(String(metres));
  const oneDecimal = m.toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
  const inches = Number(m.dividedBy(new Decimal('0.0254')).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed());
  const sign = inches < 0 ? '-' : '';
  const abs = Math.abs(inches);
  const feet = Math.floor(abs / 12);
  const rest = abs % 12;
  return `${oneDecimal.toFixed(1)} m – ${sign}${feet} ft ${rest} in`;
}

/** Money: `EUR 12,450.00`. */
export function fmtMoney(minor: string | number, currency: string): string {
  const value = typeof minor === 'number' ? minor : Number(minor);
  const neg = value < 0;
  const s = String(Math.abs(value));
  const pad = s.padStart(3, '0');
  const whole = pad.slice(0, -2);
  const cents = pad.slice(-2);
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${currency} ${withCommas}.${cents}`;
}

/** `12.3 nm` */
export function fmtNm(nm: string | number): string {
  const d = new Decimal(String(nm)).toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
  return `${d.toFixed(1)} nm`;
}

/** `6.5 kn` */
export function fmtKn(kn: string | number): string {
  const d = new Decimal(String(kn)).toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
  return `${d.toFixed(1)} kn`;
}

/** `34%` */
/** The 26 charter weeks whose Saturdays come after the given base-local date. */
export function weeksWindow(base: Base, today: string): string[] {
  const first = nextSaturdayAfter(base, today);
  const out: string[] = [];
  for (let i = 0; i < 26; i++) out.push(addDays(first, i * 7));
  return out;
}
