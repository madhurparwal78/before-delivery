export const COOP_ZONE = 'America/Chicago';

export type LiftResolution = 'exact' | 'first_occurrence' | 'shifted_after_gap';

export interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
  monthName: string;
  zoneAbbr: string;
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: COOP_ZONE,
  weekday: 'short',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'short',
});

const numericFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: COOP_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function lookup(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const found = parts.find((part) => part.type === type);
  return found ? found.value : '';
}

export function coopParts(at: Date): WallParts {
  const parts = partsFormatter.formatToParts(at);
  const numeric = numericFormatter.formatToParts(at);
  const hour = Number(lookup(numeric, 'hour'));
  return {
    year: Number(lookup(numeric, 'year')),
    month: Number(lookup(numeric, 'month')),
    day: Number(lookup(numeric, 'day')),
    hour: hour === 24 ? 0 : hour,
    minute: Number(lookup(numeric, 'minute')),
    second: Number(lookup(numeric, 'second')),
    weekday: lookup(parts, 'weekday'),
    monthName: lookup(parts, 'month'),
    zoneAbbr: lookup(parts, 'timeZoneName'),
  };
}

function wallAsUtcMillis(at: Date): number {
  const p = coopParts(at);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

function offsetMillis(at: Date): number {
  return wallAsUtcMillis(at) - at.getTime();
}

/** Every instant whose co-op wall clock reads exactly the given wall time. */
function occurrencesOfWallTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date[] {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  const found: number[] = [];
  const halfDay = 12 * 3600_000;
  for (const probe of [target - halfDay, target + halfDay]) {
    const candidate = target - offsetMillis(new Date(probe));
    if (found.includes(candidate)) continue;
    if (wallAsUtcMillis(new Date(candidate)) === target) found.push(candidate);
  }
  return found.sort((a, b) => a - b).map((millis) => new Date(millis));
}

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_MONTH = /^(\d{4})-(\d{2})$/;

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

export function isValidLocalDateTime(value: string): boolean {
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) return false;
  const [, y, m, d, h, mi] = match;
  const hour = Number(h);
  const minute = Number(mi);
  return isRealDate(Number(y), Number(m), Number(d)) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

export function isValidLocalDate(value: string): boolean {
  const match = LOCAL_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  return isRealDate(Number(y), Number(m), Number(d));
}

export function isValidMonth(value: string): boolean {
  const match = LOCAL_MONTH.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

export interface ResolvedWallTime {
  at: Date;
  resolution: LiftResolution;
}

/**
 * A repeated wall time resolves to its first occurrence; a wall time inside the
 * spring-forward gap resolves to the first valid minute after the gap.
 */
export function resolveCoopWallTime(local: string): ResolvedWallTime {
  const match = LOCAL_DATE_TIME.exec(local);
  if (!match) throw new Error(`not a co-op wall time: ${local}`);
  const [, y, m, d, h, mi] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  let minutes = Number(h) * 60 + Number(mi);
  const first = occurrencesOfWallTime(year, month, day, Number(h), Number(mi));
  if (first.length === 1) return { at: first[0] as Date, resolution: 'exact' };
  if (first.length > 1) return { at: first[0] as Date, resolution: 'first_occurrence' };
  for (let step = 0; step < 24 * 60; step += 1) {
    minutes += 1;
    const dayShift = Math.floor(minutes / (24 * 60));
    const inDay = minutes % (24 * 60);
    const shifted = new Date(Date.UTC(year, month - 1, day + dayShift));
    const next = occurrencesOfWallTime(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth() + 1,
      shifted.getUTCDate(),
      Math.floor(inDay / 60),
      inDay % 60,
    );
    if (next.length > 0) return { at: next[0] as Date, resolution: 'shifted_after_gap' };
  }
  throw new Error(`cannot resolve co-op wall time: ${local}`);
}

/** The instant of 00:00 co-op time on a `YYYY-MM-DD` co-op date. */
export function coopMidnight(date: string): Date {
  return resolveCoopWallTime(`${date}T00:00`).at;
}

export function coopDateOf(at: Date): string {
  const p = coopParts(at);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function addCoopDays(date: string, days: number): string {
  const match = LOCAL_DATE.exec(date);
  if (!match) throw new Error(`not a co-op date: ${date}`);
  const [, y, m, d] = match;
  const shifted = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d) + days));
  return shifted.toISOString().slice(0, 10);
}

/** `[start, end)` instants of a co-op calendar month, bounded by co-op midnights. */
export function coopMonthBounds(month: string): { start: Date; end: Date } {
  const match = LOCAL_MONTH.exec(month);
  if (!match) throw new Error(`not a co-op month: ${month}`);
  const year = Number(match[1]);
  const index = Number(match[2]);
  const first = `${match[1]}-${match[2]}-01`;
  const nextMonth = index === 12 ? `${year + 1}-01-01` : `${year}-${String(index + 1).padStart(2, '0')}-01`;
  return { start: coopMidnight(first), end: coopMidnight(nextMonth) };
}

/** `Sun 1 Nov 2026 · 01:30 CDT` */
export function displayCoopTime(at: Date): string {
  const p = coopParts(at);
  const hour = String(p.hour).padStart(2, '0');
  const minute = String(p.minute).padStart(2, '0');
  return `${p.weekday} ${p.day} ${p.monthName} ${p.year} · ${hour}:${minute} ${p.zoneAbbr}`;
}

/** `Mon 2 Nov 2026` */
export function displayCoopDate(at: Date): string {
  const p = coopParts(at);
  return `${p.weekday} ${p.day} ${p.monthName} ${p.year}`;
}

/** `Mon 2 Nov 2026` for a `YYYY-MM-DD` co-op date. */
export function displayCoopDateString(date: string): string {
  return displayCoopDate(coopMidnight(date));
}

/** `November 2026` for a `YYYY-MM` co-op month. */
export function displayCoopMonth(month: string): string {
  const match = LOCAL_MONTH.exec(month);
  if (!match) throw new Error(`not a co-op month: ${month}`);
  return `${MONTH_NAMES[Number(match[2]) - 1]} ${match[1]}`;
}

/** `2026-11-01 01:30 CDT`, the export's time column form. */
export function csvCoopTime(at: Date): string {
  const p = coopParts(at);
  const hour = String(p.hour).padStart(2, '0');
  const minute = String(p.minute).padStart(2, '0');
  return `${coopDateOf(at)} ${hour}:${minute} ${p.zoneAbbr}`;
}

/** UTC ISO 8601 with whole seconds, for example `2026-11-01T06:30:00Z`. */
export function isoInstant(at: Date): string {
  return `${new Date(Math.floor(at.getTime() / 1000) * 1000).toISOString().slice(0, 19)}Z`;
}
