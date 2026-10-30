import { zonedParts } from '../../shared/format';

function offsetMinutes(instantMs: number, timeZone: string): number {
  const parts = zonedParts(instantMs, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return (asUtc - Math.floor(instantMs / 60000) * 60000) / 60000;
}

function matchesLocal(instantMs: number, timeZone: string, wanted: number[]): boolean {
  const parts = zonedParts(instantMs, timeZone);
  return (
    parts.year === wanted[0] &&
    parts.month === wanted[1] &&
    parts.day === wanted[2] &&
    parts.hour === wanted[3] &&
    parts.minute === wanted[4]
  );
}

export const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u;

/**
 * Reads a wall-clock time in the workspace time zone. A time skipped by a
 * daylight-saving jump moves forward by the size of the jump; a time that
 * occurs twice uses the first occurrence.
 */
export function workspaceLocalToInstant(local: string, timeZone: string): Date | null {
  const match = LOCAL_DATE_TIME.exec(local);
  if (!match) return null;
  const wanted = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5])];
  if (wanted[1] < 1 || wanted[1] > 12 || wanted[2] < 1 || wanted[2] > 31) return null;
  if (wanted[3] > 23 || wanted[4] > 59) return null;
  const guess = Date.UTC(wanted[0], wanted[1] - 1, wanted[2], wanted[3], wanted[4]);
  const first = guess - offsetMinutes(guess, timeZone) * 60000;
  const second = guess - offsetMinutes(first, timeZone) * 60000;
  const candidates = [...new Set([first, second])].filter((candidate) =>
    matchesLocal(candidate, timeZone, wanted),
  );
  if (candidates.length > 0) return new Date(Math.min(...candidates));
  return new Date(Math.max(first, second));
}

export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** ISO 8601 UTC with whole seconds and a trailing Z. */
export function toInstant(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = typeof value === 'string' ? new Date(value) : value;
  return `${date.toISOString().slice(0, 19)}Z`;
}

export function toCalendarDate(value: Date | string | null): string | null {
  if (value === null) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}
