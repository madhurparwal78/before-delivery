// The workspace clock and every date/time format of the brief (Business rules > Formats, Time and limits).
import { STUDIO_ZONES, type StudioZone } from '../shared/zones.ts';
import { pool, type Queryable } from './db.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const DAY_MS = 86400000;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;

/** The zone of a new workspace when none is chosen. */
export const DEFAULT_ZONE: StudioZone = STUDIO_ZONES[0];

export function isStudioZone(value: unknown): value is StudioZone {
  return typeof value === 'string' && (STUDIO_ZONES as readonly string[]).includes(value);
}

interface ClockRow { clock_base: Date | null; clock_set_at: Date | null }

/** The workspace's now: real time, unless the grading clock is set, then it runs on from the set instant. */
export function clockedNow(clock: ClockRow, real: Date = new Date()): Date {
  if (!clock.clock_base || !clock.clock_set_at) return real;
  return new Date(clock.clock_base.getTime() + (real.getTime() - clock.clock_set_at.getTime()));
}

export async function workspaceNow(workspaceId: string, client: Queryable = pool): Promise<Date> {
  const { rows } = await client.query<ClockRow>('SELECT clock_base, clock_set_at FROM workspaces WHERE id = $1', [workspaceId]);
  const row = rows[0];
  return row ? clockedNow(row) : new Date();
}

export async function setWorkspaceClock(workspaceId: string, now: Date): Promise<void> {
  await pool.query('UPDATE workspaces SET clock_base = $2, clock_set_at = $3 WHERE id = $1', [workspaceId, now, new Date()]);
}

export async function clearWorkspaceClock(workspaceId: string): Promise<void> {
  await pool.query('UPDATE workspaces SET clock_base = NULL, clock_set_at = NULL WHERE id = $1', [workspaceId]);
}

/** Reads an ISO 8601 date-time; a missing offset means UTC. Null for anything else. */
export function parseInstant(text: unknown): Date | null {
  if (typeof text !== 'string' || !ISO_INSTANT.test(text)) return null;
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const date = new Date(hasOffset ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClock(date: Date, zone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(zone, formatter);
  }
  const found: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) found[part.type] = Number(part.value);
  return {
    year: found.year ?? 0, month: found.month ?? 0, day: found.day ?? 0,
    hour: found.hour ?? 0, minute: found.minute ?? 0, second: found.second ?? 0,
  };
}

const two = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` in the studio zone. */
export function studioDate(date: Date, zone: string): string {
  const w = wallClock(date, zone);
  return `${w.year}-${two(w.month)}-${two(w.day)}`;
}

/** `YYYYMMDD` in the studio zone. */
export function studioDateCompact(date: Date, zone: string): string {
  return studioDate(date, zone).replaceAll('-', '');
}

/** `Nov 4, 2026, 2:05 PM` in the studio zone. */
export function dateTimeLabel(date: Date, zone: string): string {
  const w = wallClock(date, zone);
  return `${MONTHS[w.month - 1]} ${w.day}, ${w.year}, ${w.hour % 12 || 12}:${two(w.minute)} ${w.hour < 12 ? 'AM' : 'PM'}`;
}

/** `Nov 4, 2026` from a `YYYY-MM-DD` calendar date. */
export function dateLabel(ymd: string): string {
  const [year, month, day] = ymd.split('-').map(Number);
  return `${MONTHS[(month ?? 1) - 1]} ${day}, ${year}`;
}

/** `HH:mm`, 24-hour, in the studio zone. */
export function clockTime(date: Date, zone: string): string {
  const w = wallClock(date, zone);
  return `${two(w.hour)}:${two(w.minute)}`;
}

export { sizeLabel } from '../shared/size.ts';

function zoneOffsetMs(date: Date, zone: string): number {
  const w = wallClock(date, zone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant 23:59:59 on `dateYmd` in the studio zone. */
export function zoneEndOfDay(dateYmd: string, zone: string): Date {
  const [year, month, day] = dateYmd.split('-').map(Number);
  const wall = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, 23, 59, 59);
  const first = wall - zoneOffsetMs(new Date(wall), zone);
  return new Date(wall - zoneOffsetMs(new Date(first), zone));
}

/** Whole calendar days from one `YYYY-MM-DD` date to another. */
export function studioDaysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / DAY_MS);
}
