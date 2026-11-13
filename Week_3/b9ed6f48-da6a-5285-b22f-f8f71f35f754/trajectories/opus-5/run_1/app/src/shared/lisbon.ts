/**
 * Europe/Lisbon wall-clock arithmetic. Lisbon is +00:00 in winter and +01:00 in summer;
 * EU rules move the clock at 01:00 UTC on the last Sunday of March and of October.
 */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function lastSundayUtc(year: number, month: number): number {
  const lastDay = Date.UTC(year, month + 1, 0);
  const weekday = new Date(lastDay).getUTCDay();
  return lastDay - weekday * DAY;
}

/** The offset in force at an instant, in minutes east of UTC. */
export function lisbonOffsetMinutes(instantMs: number): 0 | 60 {
  const year = new Date(instantMs).getUTCFullYear();
  const start = lastSundayUtc(year, 2) + HOUR;
  const end = lastSundayUtc(year, 9) + HOUR;
  return instantMs >= start && instantMs < end ? 60 : 0;
}

export type WallClockResolution =
  | { kind: 'ok'; instantMs: number; offsetMinutes: 0 | 60 }
  | { kind: 'skipped' };

/**
 * Reads a Lisbon wall-clock time. A repeated wall time means its first occurrence (+01:00);
 * a wall time the clock skips over does not exist.
 */
export function lisbonWallToInstant(wall: WallClock): WallClockResolution {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  for (const offsetMinutes of [60, 0] as const) {
    const instantMs = naive - offsetMinutes * MINUTE;
    if (lisbonOffsetMinutes(instantMs) === offsetMinutes) return { kind: 'ok', instantMs, offsetMinutes };
  }
  return { kind: 'skipped' };
}

export function instantToWall(instantMs: number): WallClock & { weekday: number; offsetMinutes: 0 | 60 } {
  const offsetMinutes = lisbonOffsetMinutes(instantMs);
  const shifted = new Date(instantMs + offsetMinutes * MINUTE);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay(),
    offsetMinutes,
  };
}

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

function offsetSuffix(offsetMinutes: 0 | 60): string {
  return offsetMinutes === 60 ? '+01:00' : '+00:00';
}

/** ISO 8601 with seconds and the Lisbon offset in force at that instant. */
export function toLisbonIso(instantMs: number): string {
  const w = instantToWall(instantMs);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}${offsetSuffix(w.offsetMinutes)}`;
}

/** `<date>`: `30 Nov 2026`. */
export function formatLisbonDate(instantMs: number): string {
  const w = instantToWall(instantMs);
  return `${w.day} ${MONTHS[w.month - 1]} ${w.year}`;
}

/** `<datetime>`: `Sat 14 Nov 2026, 18:30 Lisbon time`. */
export function formatLisbonDateTime(instantMs: number): string {
  const w = instantToWall(instantMs);
  return `${WEEKDAYS[w.weekday]} ${w.day} ${MONTHS[w.month - 1]} ${w.year}, ${pad(w.hour)}:${pad(w.minute)} Lisbon time`;
}

/** A plain `YYYY-MM-DD` day in Lisbon. */
export function lisbonDayKey(instantMs: number): string {
  const w = instantToWall(instantMs);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
}

/** `YYYY-MM` for the Lisbon month of an instant. */
export function lisbonMonthKey(instantMs: number): string {
  const w = instantToWall(instantMs);
  return `${pad(w.year, 4)}-${pad(w.month)}`;
}

/** Formats a `YYYY-MM-DD` day as `<date>` without leaving Lisbon. */
export function formatDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  return `${day} ${MONTHS[(month as number) - 1]} ${year}`;
}

export interface MonthRange {
  startMs: number;
  endMs: number;
}

/** The half-open instant range of a `YYYY-MM` Lisbon month. */
export function lisbonMonthRange(monthKey: string): MonthRange | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return null;
  const [year, month] = monthKey.split('-').map(Number) as [number, number];
  const start = lisbonWallToInstant({ year, month, day: 1, hour: 0, minute: 0, second: 0 });
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = lisbonWallToInstant({ year: nextYear, month: nextMonth, day: 1, hour: 0, minute: 0, second: 0 });
  if (start.kind !== 'ok' || end.kind !== 'ok') return null;
  return { startMs: start.instantMs, endMs: end.instantMs };
}

const WALL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Reads a `YYYY-MM-DD HH:MM[:SS]` Lisbon wall-clock entry. */
export function parseWallClockEntry(input: string): WallClock | null {
  const match = WALL_PATTERN.exec(input.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const wall: WallClock = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second ?? '0'),
  };
  if (wall.month < 1 || wall.month > 12 || wall.day < 1 || wall.day > 31) return null;
  if (wall.hour > 23 || wall.minute > 59 || wall.second > 59) return null;
  const probe = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  if (probe.getUTCMonth() + 1 !== wall.month || probe.getUTCDate() !== wall.day) return null;
  return wall;
}

/** Reads a `YYYY-MM-DD` Lisbon date entry. */
export function parseDayEntry(input: string): string | null {
  const text = input.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const wall = parseWallClockEntry(`${text} 00:00`);
  return wall ? text : null;
}

/** The Lisbon day a `YYYY-MM-DD` key starts on, as an instant. */
export function dayKeyToInstant(dayKey: string): number | null {
  const wall = parseWallClockEntry(`${dayKey} 00:00`);
  if (!wall) return null;
  const resolved = lisbonWallToInstant(wall);
  return resolved.kind === 'ok' ? resolved.instantMs : null;
}

export type WallEntryResult =
  | { kind: 'ok'; iso: string }
  | { kind: 'format' }
  | { kind: 'skipped' };

/** Turns a Lisbon wall-clock entry into ISO 8601 with the offset in force at that wall time. */
export function wallEntryToIso(entry: string): WallEntryResult {
  const wall = parseWallClockEntry(entry);
  if (!wall) return { kind: 'format' };
  const resolved = lisbonWallToInstant(wall);
  if (resolved.kind !== 'ok') return { kind: 'skipped' };
  const suffix = offsetSuffix(resolved.offsetMinutes);
  return {
    kind: 'ok',
    iso: `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}${suffix}`,
  };
}

export function compareDayKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
