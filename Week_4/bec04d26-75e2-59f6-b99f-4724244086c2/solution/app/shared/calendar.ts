/** Calendar-date arithmetic on `YYYY-MM-DD` strings. Pure integer maths: no clock, no zone, no `Date`. */

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December"] as const;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** Days since 1970-01-01 of a civil date. */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function civilFromDays(days: number): [number, number, number] {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shifted = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shifted + 2) / 5) + 1;
  const month = shifted < 10 ? shifted + 3 : shifted - 9;
  return [yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day];
}

export function parseDate(date: string): [number, number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
}

export function formatDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function isRealDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = parseDate(text);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function daysInMonth(year: number, month: number): number {
  return civilFromDays(daysFromCivil(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1) - 1)[2];
}

export function addDays(date: string, count: number): string {
  const [year, month, day] = parseDate(date);
  return formatDate(...civilFromDays(daysFromCivil(year, month, day) + count));
}

/** 0 is Sunday. */
export function weekday(date: string): number {
  const [year, month, day] = parseDate(date);
  return (((daysFromCivil(year, month, day) + 4) % 7) + 7) % 7;
}

/** Whole days from `from` to `to`. */
export function daysBetween(from: string, to: string): number {
  return daysFromCivil(...parseDate(to)) - daysFromCivil(...parseDate(from));
}

/** `Monday June 22`: the brief's date words, full weekday and month, no comma. */
export function dateWords(date: string): string {
  const [, month, day] = parseDate(date);
  return `${WEEKDAYS[weekday(date)]} ${MONTHS[month - 1]} ${day}`;
}

/** `YYYY-MM` shifted by whole months. */
export function addMonths(yearMonth: string, count: number): string {
  const total = Number(yearMonth.slice(0, 4)) * 12 + Number(yearMonth.slice(5, 7)) - 1 + count;
  return `${pad(Math.floor(total / 12), 4)}-${pad((total % 12) + 1)}`;
}

export function monthTitle(yearMonth: string): string {
  return `${MONTHS[Number(yearMonth.slice(5, 7)) - 1]} ${yearMonth.slice(0, 4)}`;
}
