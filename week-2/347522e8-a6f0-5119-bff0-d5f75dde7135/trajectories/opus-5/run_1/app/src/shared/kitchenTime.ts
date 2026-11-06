/**
 * Kitchen time. Every date, wall-clock time, off-peak slot, cutoff and "today"
 * in Railside is computed here, in the kitchen's zone, from an explicit instant.
 * Nothing in this module reads the host clock's zone, so the same answers come
 * out on the server and in the browser.
 */

export const KITCHEN_TIME_ZONE = 'America/Chicago';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
export const SLOT_MINUTES = 15;
const SLOT_MS = SLOT_MINUTES * MINUTE_MS;

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: KITCHEN_TIME_ZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const abbrevFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: KITCHEN_TIME_ZONE,
  timeZoneName: 'short',
});

const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'long',
});

const monthNameFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'long',
});

function readParts(instantMs: number): WallClock & { second: number } {
  const parts = partsFormatter.formatToParts(new Date(instantMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new Error(`missing date part ${type}`);
    return Number(found.value);
  };
  // en-US renders midnight as hour 24 in some ICU versions.
  const hour = get('hour') % 24;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Milliseconds the kitchen zone is ahead of UTC at the given instant. */
function zoneOffsetMsAt(instantMs: number): number {
  const p = readParts(instantMs);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

export function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `YYYY-MM-DD` for the kitchen day that contains the instant. */
export function kitchenDate(instantMs: number): string {
  const p = readParts(instantMs);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** `HH:MM` kitchen wall-clock time of the instant. */
export function kitchenHhmm(instantMs: number): string {
  const p = readParts(instantMs);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** Minutes since kitchen midnight of the instant's own day. */
export function kitchenMinuteOfDay(instantMs: number): number {
  const p = readParts(instantMs);
  return p.hour * 60 + p.minute;
}

/** `CST` or `CDT`, whichever is in force at the instant. */
export function kitchenZoneAbbrev(instantMs: number): string {
  const part = abbrevFormatter
    .formatToParts(new Date(instantMs))
    .find((p) => p.type === 'timeZoneName');
  if (!part) throw new Error('missing time zone name');
  return part.value;
}

export function isDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export function isMonthString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

/**
 * `HH:MM` on a 15-minute mark. `24:00` is accepted only where a range end is
 * expected, which the caller signals with `allowEndOfDay`.
 */
export function isHhmm(value: unknown, allowEndOfDay = false): value is string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false;
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(3, 5));
  if (minute % SLOT_MINUTES !== 0) return false;
  if (hour === 24) return allowEndOfDay && minute === 0;
  return hour >= 0 && hour <= 23;
}

export function minutesToHhmm(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** Whole days from `from` to `to`, counted on the calendar. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS);
}

export function weekdayName(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return weekdayFormatter.format(new Date(Date.UTC(y, m - 1, d)));
}

export function monthName(oneBasedMonth: number): string {
  return monthNameFormatter.format(new Date(Date.UTC(2000, oneBasedMonth - 1, 1)));
}

export function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export type WallClockResolution =
  | { kind: 'ok'; instantMs: number; repeated: boolean }
  | { kind: 'skipped' };

/**
 * Turns a kitchen date and `HH:MM` into an instant.
 *
 * A wall-clock time inside the spring-forward gap resolves to `skipped`; one
 * inside the repeated autumn hour resolves to its first occurrence, which is
 * the one still in daylight time.
 */
export function resolveKitchenWallClock(date: string, hhmm: string): WallClockResolution {
  if (hhmm === '24:00') {
    return resolveKitchenWallClock(addDays(date, 1), '00:00');
  }
  const [year, month, day] = date.split('-').map(Number);
  const hour = Number(hhmm.slice(0, 2));
  const minute = Number(hhmm.slice(3, 5));
  const naive = Date.UTC(year, month - 1, day, hour, minute);

  const offsets = new Set<number>();
  for (const probe of [naive - DAY_MS, naive, naive + DAY_MS]) {
    offsets.add(zoneOffsetMsAt(probe));
  }

  const found: number[] = [];
  for (const offset of offsets) {
    const candidate = naive - offset;
    const p = readParts(candidate);
    if (
      p.year === year &&
      p.month === month &&
      p.day === day &&
      p.hour === hour &&
      p.minute === minute &&
      !found.includes(candidate)
    ) {
      found.push(candidate);
    }
  }
  if (found.length === 0) return { kind: 'skipped' };
  found.sort((a, b) => a - b);
  return { kind: 'ok', instantMs: found[0], repeated: found.length > 1 };
}

/**
 * The same as `resolveKitchenWallClock` but for times the rules have already
 * proved to exist, such as a stored booking's start.
 */
export function kitchenInstant(date: string, hhmm: string): number {
  const resolved = resolveKitchenWallClock(date, hhmm);
  if (resolved.kind === 'ok') return resolved.instantMs;
  // A derived instant, such as a cutoff two days before a booking, can land in
  // the skipped hour. The gap's end is the first instant that wall clock reaches.
  const [year, month, day] = date.split('-').map(Number);
  const naive = Date.UTC(year, month - 1, day, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)));
  return naive - zoneOffsetMsAt(naive - DAY_MS);
}

export function startOfKitchenDay(date: string): number {
  return kitchenInstant(date, '00:00');
}

export function endOfKitchenDay(date: string): number {
  return startOfKitchenDay(addDays(date, 1));
}

export { DAY_MS, MINUTE_MS, SLOT_MS };
