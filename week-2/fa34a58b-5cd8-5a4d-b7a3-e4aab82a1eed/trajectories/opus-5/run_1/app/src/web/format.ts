/**
 * Formatting of server-published instants. Nothing here reads the device clock
 * or zone: every value comes from a string the hub sent.
 */

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
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

export function dayOf(instant: string): string {
  return instant.slice(0, 10);
}

export function hhmm(instant: string): string {
  return instant.slice(11, 16);
}

export function hhmmss(instant: string): string {
  return instant.slice(11, 19);
}

export function offsetOf(instant: string): string {
  return instant.slice(19);
}

export function abbrOf(offset: string): string {
  return offset === '-05:00' ? 'CDT' : 'CST';
}

export function abbrAt(instant: string): string {
  return abbrOf(offsetOf(instant));
}

function weekdayIndex(day: string): number {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, dayOfMonth ?? 1)).getUTCDay();
}

export function longDate(day: string): string {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  return `${WEEKDAY_NAMES[weekdayIndex(day)]} ${dayOfMonth} ${MONTH_NAMES[(month ?? 1) - 1]} ${year}`;
}

export function shortWeekday(day: string): string {
  return (WEEKDAY_NAMES[weekdayIndex(day)] as string).slice(0, 3);
}

export function addDays(day: string, count: number): string {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  const shifted = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (dayOfMonth ?? 1) + count));
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
