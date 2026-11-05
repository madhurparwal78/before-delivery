/** Club-time conversion and display: the one place wall-clock text meets instants. */

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const fieldFormatters = new Map<string, Intl.DateTimeFormat>();
const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function fieldFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = fieldFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    fieldFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zoneFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' });
    zoneFormatters.set(timeZone, formatter);
  }
  return formatter;
}

interface ZonedParts extends LocalParts {
  weekday: string;
}

function zonedParts(instantMs: number, timeZone: string): ZonedParts {
  const parts = fieldFormatter(timeZone).formatToParts(new Date(instantMs));
  const lookup: Record<string, string> = {};
  for (const part of parts) lookup[part.type] = part.value;
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
    minute: Number(lookup.minute),
    second: Number(lookup.second),
    weekday: lookup.weekday ?? '',
  };
}

function asUtcMs(parts: LocalParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function offsetMs(instantMs: number, timeZone: string): number {
  return asUtcMs(zonedParts(instantMs, timeZone)) - instantMs;
}

export function parseLocalText(text: string): LocalParts | null {
  const match = LOCAL_PATTERN.exec(text);
  if (!match) return null;
  const parts: LocalParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: match[6] === undefined ? 0 : Number(match[6]),
  };
  if (parts.month < 1 || parts.month > 12) return null;
  if (parts.day < 1 || parts.day > 31) return null;
  if (parts.hour > 23 || parts.minute > 59 || parts.second > 59) return null;
  const probe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (probe.getUTCMonth() !== parts.month - 1 || probe.getUTCDate() !== parts.day) return null;
  return parts;
}

/** The instant for a club-local wall clock, or null when that time does not exist. */
export function localToInstant(local: LocalParts, timeZone: string): Date | null {
  const target = asUtcMs(local);
  const firstOffset = offsetMs(target, timeZone);
  const candidates = new Set<number>([target - firstOffset]);
  candidates.add(target - offsetMs(target - firstOffset, timeZone));
  const valid: number[] = [];
  for (const candidate of candidates) {
    const back = zonedParts(candidate, timeZone);
    if (
      back.year === local.year &&
      back.month === local.month &&
      back.day === local.day &&
      back.hour === local.hour &&
      back.minute === local.minute &&
      back.second === local.second
    ) {
      valid.push(candidate);
    }
  }
  if (valid.length === 0) return null;
  return new Date(Math.min(...valid));
}

/** Reads club-local text, answering 'invalid' for bad text and null for a time in a gap. */
export function instantFromLocalText(text: string, timeZone: string): Date | null | 'invalid' {
  const parts = parseLocalText(text);
  if (!parts) return 'invalid';
  return localToInstant(parts, timeZone);
}

export function toIsoSeconds(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

export function clubDate(instantMs: number, timeZone: string): string {
  const parts = zonedParts(instantMs, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function zoneAbbreviation(instantMs: number, timeZone: string): string {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(instantMs));
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
}

function timeText(parts: ZonedParts): string {
  const suffix = parts.hour < 12 ? 'am' : 'pm';
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  const minute = String(parts.minute).padStart(2, '0');
  if (parts.second === 0) return `${hour12}:${minute} ${suffix}`;
  return `${hour12}:${minute}:${String(parts.second).padStart(2, '0')} ${suffix}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dateText(parts: ZonedParts): string {
  return `${parts.weekday} ${parts.day} ${MONTHS[parts.month - 1]}`;
}

export function cutoffDisplay(instantMs: number, timeZone: string): string {
  const parts = zonedParts(instantMs, timeZone);
  return `${dateText(parts)}, ${timeText(parts)} ${zoneAbbreviation(instantMs, timeZone)}`;
}

export function pickupDisplay(startMs: number, endMs: number, timeZone: string): string {
  const start = zonedParts(startMs, timeZone);
  const end = zonedParts(endMs, timeZone);
  const startZone = zoneAbbreviation(startMs, timeZone);
  const endZone = zoneAbbreviation(endMs, timeZone);
  const sameDate = start.year === end.year && start.month === end.month && start.day === end.day;
  const startPiece = startZone === endZone ? timeText(start) : `${timeText(start)} ${startZone}`;
  const endPiece = sameDate ? timeText(end) : `${dateText(end)}, ${timeText(end)}`;
  return `${dateText(start)}, ${startPiece} to ${endPiece} ${endZone}`;
}

/** Club-local wall-clock text for a stored instant, used by the coordinator's time fields. */
export function localTextForInstant(instantMs: number, timeZone: string): string {
  const parts = zonedParts(instantMs, timeZone);
  const date = `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  const clock = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  if (parts.second === 0) return `${date} ${clock}`;
  return `${date} ${clock}:${String(parts.second).padStart(2, '0')}`;
}

/** The instant of a club-local wall clock a number of club days from an instant. */
export function clubWallClockAfterDays(
  instantMs: number,
  days: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const parts = zonedParts(instantMs, timeZone);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  const wanted: LocalParts = {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour,
    minute,
    second,
  };
  const instant = localToInstant(wanted, timeZone);
  if (instant) return instant;
  const nudged = localToInstant({ ...wanted, hour: hour + 1 }, timeZone);
  return nudged ?? new Date(instantMs);
}
