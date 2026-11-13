import type { PlainDate } from '../shared/dates';
import { config } from './config';

let offsetMs = 0;

/** The server clock, which the grading clock route can move. */
export function serverNow(): Date {
  return new Date(Date.now() + offsetMs);
}

export function setServerNow(instant: Date | null): void {
  offsetMs = instant === null ? 0 : instant.getTime() - Date.now();
}

const zoneFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.dailyTz,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The calendar date of an instant in `DAILY_TZ`. */
export function dateInDailyZone(instant: Date): PlainDate {
  return zoneFormat.format(instant);
}

export function today(): PlainDate {
  return dateInDailyZone(serverNow());
}
