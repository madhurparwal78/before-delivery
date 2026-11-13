import { DateTime, IANAZone } from 'luxon';
import { WEEKDAYS, type Weekday } from '../shared/rules.js';

type Zone = string;

/**
 * The day-start instant on local date D: the first instant that date's local
 * clock reads the day-start hour, on the hour. A spring-forward gap moves to
 * the first instant after the gap; a fall-back repeat takes the first
 * occurrence only. This is the single place the close instant is decided.
 */
export function dayStartInstant(dateISO: string, timeZone: Zone, dayStartHour: number): Date {
  const midnight = DateTime.fromISO(`${dateISO}T00:00:00`, { zone: timeZone });
  const candidate = midnight.set({ hour: dayStartHour, minute: 0, second: 0, millisecond: 0 });
  // In a spring-forward gap Luxon resolves the skipped wall time to the
  // instant after the gap; in a fall-back repeat it keeps the first
  // occurrence's offset. Both match the published rule.
  return candidate.toJSDate();
}

/** The close instant of local date D = the day-start instant on D+1. */
export function closeInstantFor(dateISO: string, timeZone: Zone, dayStartHour: number): Date {
  const next = DateTime.fromISO(`${dateISO}T00:00:00`, { zone: timeZone }).plus({ days: 1 }).toISODate()!;
  return dayStartInstant(next, timeZone, dayStartHour);
}

/** The local date whose day contains instant, in a zone at a day-start hour. */
export function localDateOf(instant: Date, timeZone: Zone, dayStartHour: number): string {
  const dt = DateTime.fromMillis(instant.getTime(), { zone: timeZone });
  return dt.minus({ hours: dayStartHour }).startOf('day').toISODate()!;
}

export function isZoneValid(timeZone: string): boolean {
  return IANAZone.isValidZone(timeZone);
}

/** Every IANA zone id, sorted; the settings combobox and validation source. */
export function allZones(): string[] {
  return [...Intl.supportedValuesOf('timeZone')].sort();
}

/** Weekday name of local date D in the zone. */
export function weekdayOf(dateISO: string, timeZone: Zone): Weekday {
  const dt = DateTime.fromISO(`${dateISO}T00:00:00`, { zone: timeZone });
  return WEEKDAYS[(dt.weekday - 1) % 7];
}

/** The next day start text: `<weekday> <HH:MM> (<zone>)` for the close instant. */
export function nextDayStartText(instant: Date, timeZone: Zone): string {
  const dt = DateTime.fromMillis(instant.getTime(), { zone: timeZone });
  const weekday = WEEKDAYS[(dt.weekday - 1) % 7];
  const hh = String(dt.hour).padStart(2, '0');
  const mm = String(dt.minute).padStart(2, '0');
  return `${weekday} ${hh}:${mm} (${timeZone})`;
}

/** Local date in a zone as YYYY-MM-DD. */
export function localDateInZone(instant: Date, timeZone: Zone): string {
  return DateTime.fromMillis(instant.getTime(), { zone: timeZone }).toISODate()!;
}
