/**
 * The district zone, the instant format, window labels and window status.
 * Every time rule in the app is decided here.
 */
export const DISTRICT_ZONE = 'Australia/Sydney';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const districtFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISTRICT_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface DistrictParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function districtParts(instant: Date): DistrictParts {
  const parts: Record<string, string> = {};
  for (const part of districtFormat.formatToParts(instant)) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Minutes the district clock is ahead of UTC at this instant: 600 or 660. */
function districtOffsetMinutes(instant: Date): number {
  const p = districtParts(instant);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((wall - Math.floor(instant.getTime() / 1000) * 1000) / MINUTE_MS);
}

/**
 * The zone mark an instant carries in a label: set only while its local clock
 * reading occurs twice, which is the hour that repeats when daylight saving ends.
 */
function repeatedHourMark(instant: Date): string {
  const offset = districtOffsetMinutes(instant);
  const laterOffset = districtOffsetMinutes(new Date(instant.getTime() + HOUR_MS));
  const earlierOffset = districtOffsetMinutes(new Date(instant.getTime() - HOUR_MS));
  if (laterOffset < offset) return offset === 660 ? ' AEDT' : ' AEST';
  if (earlierOffset > offset) return offset === 660 ? ' AEDT' : ' AEST';
  return '';
}

/** An instant written at the district offset in force, with its repeated-hour mark. */
export function districtInstantLabel(instant: Date): string {
  const p = districtParts(instant);
  const weekday = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()] as string;
  const month = MONTHS[p.month - 1] as string;
  const hour = String(p.hour).padStart(2, '0');
  const minute = String(p.minute).padStart(2, '0');
  return `${weekday} ${p.day} ${month} ${hour}:${minute}${repeatedHourMark(instant)}`;
}

/** The one window label, shown identically by the API, screens, notices and packs. */
export function windowLabel(opensAt: Date, closesAt: Date): string {
  return `${districtInstantLabel(opensAt)} to ${districtInstantLabel(closesAt)}`;
}

/** The district date an instant falls on, as `YYYY-MM-DD`. */
export function districtDate(instant: Date): string {
  const p = districtParts(instant);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** The API instant format: whole seconds, UTC, `YYYY-MM-DDTHH:MM:SSZ`. */
export function formatInstant(instant: Date): string {
  return `${instant.toISOString().slice(0, 19)}Z`;
}

export function parseInstant(text: unknown): Date | null {
  if (typeof text !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(text)) return null;
  const value = Date.parse(text);
  if (Number.isNaN(value)) return null;
  const instant = new Date(value);
  return formatInstant(instant) === text ? instant : null;
}

export function truncateToSecond(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / 1000) * 1000);
}

export function truncateToMinute(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / MINUTE_MS) * MINUTE_MS);
}

export type WindowStatus = 'upcoming' | 'open' | 'closing' | 'closed';

const CLOSING_WINDOW_MS = 30 * MINUTE_MS;
const ORDER_HORIZON_MS = 240 * HOUR_MS;

export function windowStatus(opensAt: Date, closesAt: Date, now: Date): WindowStatus {
  const t = now.getTime();
  if (t >= closesAt.getTime()) return 'closed';
  if (t >= closesAt.getTime() - CLOSING_WINDOW_MS) return 'closing';
  if (t >= opensAt.getTime()) return 'open';
  return 'upcoming';
}

export const WINDOW_STATUS_LABELS: Record<WindowStatus, string> = {
  upcoming: 'Not yet open',
  open: 'Open',
  closing: 'Closing: final 30 minutes',
  closed: 'Closed',
};

/** The ordering horizon: from 10 days before opening until the closing instant. */
export function isOrderable(opensAt: Date, closesAt: Date, now: Date): boolean {
  const t = now.getTime();
  return t >= opensAt.getTime() - ORDER_HORIZON_MS && t < closesAt.getTime();
}

export function isTooEarly(opensAt: Date, now: Date): boolean {
  return now.getTime() < opensAt.getTime() - ORDER_HORIZON_MS;
}

/** Elapsed hours from opening to closing, or null when it is not a whole number. */
export function elapsedHours(opensAt: Date, closesAt: Date): number | null {
  const ms = closesAt.getTime() - opensAt.getTime();
  if (ms <= 0 || ms % HOUR_MS !== 0) return null;
  return ms / HOUR_MS;
}

/** Whole minutes from the window's opening to a restriction's effective instant. */
export function minutesBefore(opensAt: Date, effectiveAt: Date): number {
  const ms = effectiveAt.getTime() - opensAt.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / MINUTE_MS);
}
