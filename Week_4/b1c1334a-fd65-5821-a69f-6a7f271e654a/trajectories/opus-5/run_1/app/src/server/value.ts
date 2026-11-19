import type { CellJson, CellKind } from '../shared/api.js';
import type { ErrorValue } from '../shared/copy.js';
import { compare, formatDecimal, parseDecimalText, type Dec } from './decimal.js';

export type Value =
  | { t: 'blank' }
  | { t: 'dec'; d: Dec }
  | { t: 'text'; s: string }
  | { t: 'date'; s: string }
  | { t: 'bool'; b: boolean }
  | { t: 'err'; e: ErrorValue };

export const BLANK: Value = { t: 'blank' };

export function decValue(d: Dec): Value {
  return { t: 'dec', d };
}

export function errValue(e: ErrorValue): Value {
  return { t: 'err', e };
}

export function displayOf(value: Value): string {
  switch (value.t) {
    case 'blank':
      return '';
    case 'dec':
      return formatDecimal(value.d);
    case 'text':
      return value.s;
    case 'date':
      return value.s;
    case 'bool':
      return value.b ? 'TRUE' : 'FALSE';
    case 'err':
      return value.e;
  }
}

export function kindOf(value: Value): CellKind {
  switch (value.t) {
    case 'blank':
      return 'blank';
    case 'dec':
      return 'decimal';
    case 'text':
      return 'text';
    case 'date':
      return 'date';
    case 'bool':
      return 'bool';
    case 'err':
      return 'error';
  }
}

export function jsonValueOf(value: Value): CellJson['value'] {
  switch (value.t) {
    case 'blank':
      return null;
    case 'dec':
      return formatDecimal(value.d);
    case 'text':
      return value.s;
    case 'date':
      return value.s;
    case 'bool':
      return value.b;
    case 'err':
      return value.e;
  }
}

/** Text join turns each operand into its display text. */
export function textOf(value: Value): string {
  return displayOf(value);
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function parseDateText(text: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
  const maxDay =
    month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] as number);
  if (day > maxDay) return null;
  return { year, month, day };
}

/** Days from 0000-03-01, after Howard Hinnant's civil calendar algorithms. */
export function dateToDayNumber(text: string): number | null {
  const parts = parseDateText(text);
  if (parts === null) return null;
  const { year, month, day } = parts;
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra;
}

export function dayNumberToDate(days: number): string | null {
  const era = Math.floor(days / 146097);
  const dayOfEra = days - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const y = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime + (monthPrime < 10 ? 3 : -9);
  const year = month <= 2 ? y + 1 : y;
  if (year < 1 || year > 9999) return null;
  const text = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(
    day,
  ).padStart(2, '0')}`;
  return parseDateText(text) === null ? null : text;
}

export function compareCodePoints(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const x = (left[i] as string).codePointAt(0) as number;
    const y = (right[i] as string).codePointAt(0) as number;
    if (x !== y) return x < y ? -1 : 1;
  }
  return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
}

export function compareDecimals(a: Dec, b: Dec): number {
  return compare(a, b);
}

export function decimalFromText(text: string): Dec | null {
  return parseDecimalText(text);
}
