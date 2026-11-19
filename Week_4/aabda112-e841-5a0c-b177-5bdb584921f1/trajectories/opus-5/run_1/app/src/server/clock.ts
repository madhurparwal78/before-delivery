import { TIME_ZONE } from './config';
import { query } from './db';

const HOUR_MS = 3_600_000;

const wallFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export type ClinicParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function clinicParts(instant: number): ClinicParts {
  const parts = wallFormatter.formatToParts(new Date(instant));
  const read = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const hour = read('hour');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
    second: read('second'),
  };
}

/** Wall-clock offset of the clinic zone at an instant, in ms (0 or +1h). */
function offsetAt(instant: number): number {
  const p = clinicParts(instant);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

export function clinicDateOf(instant: number): string {
  const p = clinicParts(instant);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function clinicMinuteOf(instant: number): number {
  const p = clinicParts(instant);
  return p.hour * 60 + p.minute;
}

/**
 * Turns a clinic wall-clock time into an instant. A time skipped by the spring
 * forward answers null; a time that happens twice answers its first occurrence.
 */
export function instantOfClinicWallTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number | null {
  const wall = Date.UTC(year, month - 1, day, hour, minute, 0);
  const candidates = [wall - HOUR_MS, wall];
  const valid = candidates.filter((instant) => wall - instant === offsetAt(instant));
  return valid.length === 0 ? null : Math.min(...valid);
}

const CLINIC_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;
const CLINIC_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseClinicDateTime(text: unknown): number | null | 'malformed' {
  if (typeof text !== 'string') return 'malformed';
  const match = CLINIC_DATE_TIME.exec(text.trim());
  if (!match) return 'malformed';
  const [, y, m, d, h, min] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(min);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return 'malformed';
  const instant = instantOfClinicWallTime(year, month, day, hour, minute);
  if (instant === null) return null;
  const check = clinicParts(instant);
  if (check.day !== day || check.month !== month || check.year !== year) return 'malformed';
  return instant;
}

export function isClinicDate(text: unknown): text is string {
  if (typeof text !== 'string') return false;
  const match = CLINIC_DATE.exec(text);
  if (!match) return false;
  const [, y, m, d] = match;
  const instant = instantOfClinicWallTime(Number(y), Number(m), Number(d), 12, 0);
  if (instant === null) return false;
  return clinicDateOf(instant) === text;
}

/** Start of a clinic date, as an instant. */
export function startOfClinicDate(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const instant = instantOfClinicWallTime(y, m, d, 0, 0);
  return instant ?? Date.UTC(y, m - 1, d, 0, 0) - HOUR_MS;
}

/** End of a clinic date (exclusive): midnight starting the next clinic date. */
export function endOfClinicDate(date: string): number {
  return startOfClinicDate(addClinicDays(date, 1));
}

export function addClinicDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, '0')}-${String(
    moved.getUTCDate(),
  ).padStart(2, '0')}`;
}

export function clinicDateDiffDays(from: string, to: string): number {
  const a = Date.UTC(...(from.split('-').map(Number) as [number, number, number]));
  const b = Date.UTC(...(to.split('-').map(Number) as [number, number, number]));
  return Math.round((b - a) / 86_400_000);
}

/** The instant of a clinic-time hour on a clinic date. */
export function instantOfClinicHour(date: string, hour: number): number {
  const [y, m, d] = date.split('-').map(Number);
  const instant = instantOfClinicWallTime(y, m, d, hour, 0);
  return instant ?? startOfClinicDate(date) + hour * HOUR_MS;
}

export function instantOfSlot(date: string, minuteOfDay: number): number | null {
  const [y, m, d] = date.split('-').map(Number);
  return instantOfClinicWallTime(y, m, d, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
}

let baseInstant: number | null = null;
let baseRealTime = 0;

export function serverNow(): number {
  if (baseInstant === null) return Date.now();
  return baseInstant + (Date.now() - baseRealTime);
}

export function serverNowIso(): string {
  return new Date(serverNow()).toISOString();
}

export function clinicToday(): string {
  return clinicDateOf(serverNow());
}

export async function loadClockFromDatabase(): Promise<void> {
  const rows = await query<{ base_ms: string | null; set_at_ms: string }>(
    'select base_ms, set_at_ms from server_clock where id = 1',
  );
  const row = rows[0];
  if (!row || row.base_ms === null) {
    baseInstant = null;
    return;
  }
  baseInstant = Number(row.base_ms);
  baseRealTime = Number(row.set_at_ms);
}

export async function setServerClock(instant: number): Promise<void> {
  baseInstant = instant;
  baseRealTime = Date.now();
  await query(
    `insert into server_clock (id, base_ms, set_at_ms) values (1, $1, $2)
     on conflict (id) do update set base_ms = $1, set_at_ms = $2`,
    [instant, baseRealTime],
  );
}

export function isoToMs(instant: string): number {
  return new Date(instant).getTime();
}
