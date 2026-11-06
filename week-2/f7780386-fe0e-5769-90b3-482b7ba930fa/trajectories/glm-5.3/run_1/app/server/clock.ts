// The single server clock. Every server-side notion of now reads this module,
// never Date.now() in business code and never the database's clock.
//
// The clock starts at PASSBOARD_NOW (an ISO 8601 instant with an offset) when
// serve starts, then advances in real time. The kitchen's zone is
// America/Chicago.

import { KITCHEN_TIME_ZONE } from '../shared/seed.js';

let offsetMillis = 0;

export function initClock(): void {
  const raw = process.env['PASSBOARD_NOW'];
  if (raw === undefined || raw === '') return;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`PASSBOARD_NOW is not a valid ISO 8601 instant: ${raw}`);
  }
  offsetMillis = parsed - Date.now();
}

export function nowEpochMillis(): number {
  return Date.now() + offsetMillis;
}

export const KITCHEN_TZ = KITCHEN_TIME_ZONE;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

function zonedParts(epochMillis: number, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(new Date(epochMillis));
  const out: Record<string, number> = {};
  for (const p of parts) out[p.type] = Number(p.value);
  const hour = out['hour'] === 24 ? 0 : out['hour']!;
  return { year: out['year']!, month: out['month']!, day: out['day']!, hour, minute: out['minute']!, second: out['second']! };
}

/** The zone's UTC offset in minutes at the given instant. */
export function offsetMinutesAt(epochMillis: number, timeZone: string): number {
  const p = zonedParts(epochMillis, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUTC - Math.floor(epochMillis / 1000) * 1000) / 60000);
}

/** ISO 8601 to the second with the zone's UTC offset at that instant. */
export function instantInZone(epochMillis: number, timeZone: string): string {
  const p = zonedParts(epochMillis, timeZone);
  const off = offsetMinutesAt(epochMillis, timeZone);
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}` +
    `T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export interface KitchenNow {
  epochMillis: number;
  /** ISO 8601 to the second with the kitchen's UTC offset at that instant. */
  instant: string;
  /** Kitchen date, YYYY-MM-DD. */
  today: string;
  /** Kitchen-local clock time, HH:MM. */
  clock: string;
  /** Minutes since kitchen-local midnight, 0..1439. */
  minutes: number;
}

export function kitchenNow(): KitchenNow {
  const epochMillis = nowEpochMillis();
  const p = zonedParts(epochMillis, KITCHEN_TZ);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    epochMillis,
    instant: instantInZone(epochMillis, KITCHEN_TZ),
    today: `${String(p.year).padStart(4, '0')}-${pad(p.month)}-${pad(p.day)}`,
    clock: `${pad(p.hour)}:${pad(p.minute)}`,
    minutes: p.hour * 60 + p.minute,
  };
}

/** A kitchen-local date and minute-of-day as an epoch instant. */
export function kitchenInstant(date: string, minutes: number, seconds = 0): number {
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const asUTC = Date.parse(`${date}T${pad(h)}:${pad(m)}:${pad(seconds)}Z`);
  const firstGuess = asUTC - offsetMinutesAt(asUTC, KITCHEN_TZ) * 60000;
  return asUTC - offsetMinutesAt(firstGuess, KITCHEN_TZ) * 60000;
}

/** The kitchen-local 24:00 that ends a kitchen date, as an epoch instant. */
export function endOfKitchenDate(date: string): number {
  return kitchenInstant(date, 24 * 60, 0);
}

export function addDaysToKitchenDate(date: string, days: number): string {
  const dt = new Date(Date.parse(date + 'T00:00:00Z'));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
