import { instantAtLocalTime, localTimeOf, minutesOfDay } from '../../shared/time.js';

export interface SessionTimes {
  start: Date;
  end: Date;
  endTime: string;
}

export function isSlotStart(startTime: string): boolean {
  return minutesOfDay(startTime) % 30 === 0;
}

/** A session is as long as its task's estimate and must end by local midnight. */
export function sessionTimes(
  date: string,
  startTime: string,
  estimateMinutes: number,
  timeZone: string,
): SessionTimes | 'crosses_midnight' {
  if (minutesOfDay(startTime) + estimateMinutes > 1440) return 'crosses_midnight';
  const start = instantAtLocalTime(date, startTime, timeZone);
  const end = new Date(start.getTime() + estimateMinutes * 60_000);
  return { start, end, endTime: localTimeOf(end, timeZone) };
}
