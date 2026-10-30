import {
  centralOffsetMinutes,
  centralParts,
  instantFromCentral,
} from '../../shared/centralTime.js';

export function isoWithCentralOffset(date: Date): string {
  const parts = centralParts(date);
  const offset = centralOffsetMinutes(date);
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${String(parts.year).padStart(4, '0')}-${pad(parts.month)}-${pad(parts.day)}` +
    `T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}

/**
 * Whole elapsed minutes between the two instants that fall on a Monday to
 * Friday in the agency zone. Weekend minutes do not count and no holidays are
 * skipped.
 */
export function businessMinutesBetween(from: Date, to: Date): number {
  if (to.getTime() <= from.getTime()) return 0;
  const end = to.getTime();
  let cursor = from.getTime();
  let weekdayMillis = 0;
  while (cursor < end) {
    const parts = centralParts(new Date(cursor));
    const nextCivilDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
    const nextDayStart = instantFromCentral(
      nextCivilDay.getUTCFullYear(),
      nextCivilDay.getUTCMonth() + 1,
      nextCivilDay.getUTCDate(),
      0,
      0,
    ).getTime();
    const segmentEnd = Math.min(end, nextDayStart);
    const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
    if (weekday >= 1 && weekday <= 5) {
      weekdayMillis += segmentEnd - cursor;
    }
    cursor = segmentEnd;
  }
  return Math.floor(weekdayMillis / 60000);
}

