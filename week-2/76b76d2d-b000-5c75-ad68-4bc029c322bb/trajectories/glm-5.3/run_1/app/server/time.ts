import { DateTime } from 'luxon';

export const torontoTz = 'America/Toronto';

export function now(): DateTime {
  return DateTime.now();
}

/** Whole-second ISO 8601 with Toronto offset, e.g. 2026-11-03T19:00:00-05:00 */
export function iso(dt: DateTime): string {
  return dt.setZone(torontoTz).set({ millisecond: 0 }).toISO({ suppressMilliseconds: true }) as string;
}

export function isoMs(dt: DateTime): string {
  return dt.toUTC().toISO({ suppressMilliseconds: false }) ?? '';
}

export function dateOnly(dt: DateTime): string {
  return dt.setZone(torontoTz).toFormat('yyyy-MM-dd');
}

export function timeOnly(dt: DateTime): string {
  return dt.setZone(torontoTz).toFormat('HH:mm');
}

export function minutesUntil(later: DateTime, from: DateTime): number {
  return Math.ceil(later.diff(from, 'minutes').minutes);
}

/** Parse an ISO instant string that carries an explicit offset. */
export function parseIso(value: string): DateTime {
  const dt = DateTime.fromISO(value, { setZone: true });
  if (!dt.isValid) throw new Error(`bad instant: ${value}`);
  return dt;
}
