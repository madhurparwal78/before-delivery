import { config } from './config.js';

/**
 * The single clock: every rule reads "now" through here, applying this
 * instance's CLOCK_OFFSET_SECONDS (DP-83).
 */
export function now(): Date {
  return new Date(Date.now() + config.clockOffsetSeconds * 1000);
}

/** Practice time zone; reloaded from config on each use so instances stay independent. */
let practiceZone = 'America/Denver';

export function setPracticeZone(zone: string): void {
  practiceZone = zone;
}

export function practiceZoneName(): string {
  return practiceZone;
}

function fmtOffset(offsetSeconds: number): string {
  const sign = offsetSeconds < 0 ? '-' : '+';
  const a = Math.abs(offsetSeconds);
  const h = String(Math.floor(a / 3600)).padStart(2, '0');
  const m = String(Math.floor((a % 3600) / 60)).padStart(2, '0');
  return `${sign}${h}:${m}`;
}

/** Offset of `zone` at `instant`, in seconds east of UTC. */
export function offsetAt(zone: string, instant: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = dtf.formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const asUTC = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day),
    Number(map.hour === '24' ? '0' : map.hour), Number(map.minute), Number(map.second));
  return Math.round((asUTC - instant.getTime()) / 1000);
}

/** Parts of `instant` read as wall clock in `zone`. */
export function zonedParts(zone: string, instant: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = dtf.formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return {
    year: Number(map.year), month: Number(map.month), day: Number(map.day),
    hour: Number(map.hour === '24' ? 0 : Number(map.hour)), minute: Number(map.minute), second: Number(map.second)
  };
}

export function businessDate(zone: string, instant: Date): string {
  const p = zonedParts(zone, instant);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function todayInPractice(): string {
  return businessDate(practiceZone, now());
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

/**
 * Resolves a wall-clock business date + HH:MM in the practice zone to the instant
 * of its *earliest* occurrence, or null when that clock time never occurs that
 * date (a spring-forward gap). Single source for starts_at (DP-03, DP-46).
 */
export function resolveWallClock(date: string, time: string, zone: string): Date | null {
  if (!DATE_RE.test(date) || !TIME_RE.test(time)) return null;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = offsetAt(zone, new Date(utcGuess - 24 * 3600 * 1000));
  const off2 = offsetAt(zone, new Date(utcGuess + 24 * 3600 * 1000));
  for (const off of [off1, off2]) {
    const t = new Date(utcGuess - off * 1000);
    const parts = zonedParts(zone, t);
    if (parts.year === y && parts.month === m && parts.day === d && parts.hour === hh && parts.minute === mm) {
      return t;
    }
  }
  return null;
}

/** Prints an instant with the practice-zone offset in force at it. */
export function printInstant(t: Date): string {
  const off = offsetAt(practiceZone, t);
  const p = zonedParts(practiceZone, t);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T` +
    `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}` +
    `${fmtOffset(off)}`;
}

/** `YYYY-MM-DD HH:MM (<zone>)` for cancellation cutoffs (Feedback states). */
export function printCutoff(t: Date): string {
  const p = zonedParts(practiceZone, t);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ` +
    `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} (${practiceZone})`;
}

/** `HH:MM` in the practice zone. */
export function printTime(t: Date): string {
  const p = zonedParts(practiceZone, t);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** `HH:MM:SS` in the practice zone. */
export function printTimeSec(t: Date): string {
  const p = zonedParts(practiceZone, t);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}`;
}

/** `YYYY-MM-DD HH:MM (<zone>)` used in the vet-link email. */
export function printDateTimeZone(t: Date): string {
  const p = zonedParts(practiceZone, t);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ` +
    `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} (${practiceZone})`;
}

export function validDate(s: unknown): s is string {
  return typeof s === 'string' && DATE_RE.test(s);
}

export function validTime(s: unknown): s is string {
  return typeof s === 'string' && TIME_RE.test(s);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

export function dateDiffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}
