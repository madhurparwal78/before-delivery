import { config } from './config.ts';
import { pool } from './db.ts';
import { shortDate } from './engine/index.ts';

// All times the server judges use the server clock (the grading clock when set) in APP_TZ.

const MS_PER_MINUTE = 60_000;
const CLOCK_POLL_MS = 300;

interface ClockRow { base: Date | null; set_at: Date }
let override: { base: number; setAt: number } | null = null;

export function now(): Date {
  return override ? new Date(override.base + (Date.now() - override.setAt)) : new Date();
}

function adopt(row: ClockRow | undefined): void {
  override = row && row.base ? { base: row.base.getTime(), setAt: row.set_at.getTime() } : null;
}

export async function loadClock(): Promise<void> {
  const { rows } = await pool.query<ClockRow>('SELECT base, set_at FROM app_clock WHERE id = 1');
  adopt(rows[0]);
}

export function followClock(): void {
  setInterval(() => { void loadClock().catch(() => undefined); }, CLOCK_POLL_MS).unref();
}

/** Grading route: set the clock to an instant, or return to real time with null. */
export async function setClock(instant: Date | null): Promise<void> {
  const setAt = new Date();
  await pool.query(
    `INSERT INTO app_clock (id, base, set_at) VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET base = EXCLUDED.base, set_at = EXCLUDED.set_at`,
    [instant, setAt],
  );
  adopt({ base: instant, set_at: setAt });
}

const zoneFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: config.timeZone, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

interface Parts { y: number; mo: number; d: number; h: number; mi: number; s: number }

function partsOf(at: Date): Parts {
  const found: Record<string, number> = {};
  for (const part of zoneFormat.formatToParts(at)) if (part.type !== 'literal') found[part.type] = Number(part.value);
  return { y: found['year'] ?? 0, mo: found['month'] ?? 0, d: found['day'] ?? 0, h: found['hour'] ?? 0, mi: found['minute'] ?? 0, s: found['second'] ?? 0 };
}

function offsetMinutes(at: Date): number {
  const p = partsOf(at);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / MS_PER_MINUTE);
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of the instant in APP_TZ. */
export function localDate(at: Date): string {
  const p = partsOf(at);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

export function localDateTime(at: Date): string {
  const p = partsOf(at);
  return `${localDate(at)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** ISO 8601 with the APP_TZ offset, whole seconds: 2026-03-14T17:00:00+00:00. */
export function isoWithOffset(at: Date): string {
  const p = partsOf(at);
  const offset = offsetMinutes(at);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${localDate(at)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** `<date, time>` of the brief: `14 Mar 2026, 17:00`. */
export function dateTimeText(at: Date): string {
  const p = partsOf(at);
  return `${shortDate(localDate(at))}, ${pad(p.h)}:${pad(p.mi)}`;
}

/** Local wall-clock `YYYY-MM-DD[ T]HH:MM[:SS]` in APP_TZ to an instant, or null when it is not a real time. */
export function parseLocal(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number) as [number, number, number, number, number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return null;
  let instant = new Date(wall - offsetMinutes(new Date(wall)) * MS_PER_MINUTE);
  instant = new Date(wall - offsetMinutes(instant) * MS_PER_MINUTE);
  return instant;
}

/** An ISO instant with an offset, or a local wall-clock time without one. */
export function parseInstant(text: string): Date | null {
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(text.trim()) && /^\d{4}-\d{2}-\d{2}T/.test(text.trim())) {
    const at = new Date(text.trim());
    return Number.isNaN(at.getTime()) ? null : at;
  }
  return parseLocal(text);
}

export const minutesFromNow = (minutes: number): Date => new Date(now().getTime() + minutes * MS_PER_MINUTE);
export const hoursAfter = (at: Date, hours: number): Date => new Date(at.getTime() + hours * 60 * MS_PER_MINUTE);

/** `YYYYMMDDHHMM` and `YYYYMMDDHH` of the server clock, for rate-limit keys. */
export function clockMinuteKey(): string {
  const p = partsOf(now());
  return `${p.y}${pad(p.mo)}${pad(p.d)}${pad(p.h)}${pad(p.mi)}`;
}
export const clockHourKey = (): string => clockMinuteKey().slice(0, 10);
