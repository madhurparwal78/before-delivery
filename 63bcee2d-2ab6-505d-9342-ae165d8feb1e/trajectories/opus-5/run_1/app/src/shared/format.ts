/** The published renderings of instants, dates and amounts. */

import type { Currency, TimeZoneName } from './domain.js';
import { zoneLabel } from './domain.js';
import { pad, wallClockOf, type CalendarDate, parseCalendarDate } from './zoned.js';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function monthName(month: number): string {
  return MONTHS[month - 1] ?? '';
}

/** `3 Nov 2026, 14:05:32 HKT` */
export function formatInstant(instant: Date, zone: TimeZoneName): string {
  const wall = wallClockOf(instant, zone);
  return `${wall.day} ${monthName(wall.month)} ${wall.year}, ${pad(wall.hour, 2)}:${pad(
    wall.minute,
    2,
  )}:${pad(wall.second, 2)} ${zoneLabel(zone)}`;
}

/** `3 Nov 2026` */
export function formatDateParts(date: CalendarDate): string {
  return `${date.day} ${monthName(date.month)} ${date.year}`;
}

/** `3 Nov 2026` from a YYYY-MM-DD string. */
export function formatDate(text: string): string {
  const date = parseCalendarDate(text);
  return date ? formatDateParts(date) : text;
}

/** `3 Nov 2026` for the calendar date the instant falls on in the zone. */
export function formatInstantDate(instant: Date, zone: TimeZoneName): string {
  const wall = wallClockOf(instant, zone);
  return formatDateParts(wall);
}

/** `60,000.00` */
export function formatCentsPlain(cents: number): string {
  const negative = cents < 0;
  const digits = String(Math.abs(cents)).padStart(3, '0');
  const whole = digits.slice(0, digits.length - 2);
  const fraction = digits.slice(digits.length - 2);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${fraction}`;
}

/** `HKD 60,000.00` */
export function formatAmount(cents: number, currency: Currency): string {
  return `${currency} ${formatCentsPlain(cents)}`;
}

/** `60000.00`, the plain decimal used in CSV exports and Kill Bill items. */
export function centsToDecimal(cents: number): string {
  const negative = cents < 0;
  const digits = String(Math.abs(cents)).padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, digits.length - 2)}.${digits.slice(
    digits.length - 2,
  )}`;
}

/** `10,000,000`, a byte limit with comma separators. */
export function formatByteLimit(bytes: number): string {
  return String(bytes).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
