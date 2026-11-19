/**
 * Formula evaluation: values, operators, functions, date arithmetic.
 * All decimal arithmetic is exact and carried on strings/Decimal, never
 * through binary floating point.
 */
import { Decimal } from 'decimal.js';
import { roundTo4 } from '../shared/decimal.js';
import { AstNode } from './formula.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Kind = 'decimal' | 'text' | 'date' | 'bool' | 'blank' | 'error' | 'reference';

export interface Value {
  kind: Kind;
  /** decimal: canonical 4-place text; date: YYYY-MM-DD; error: the error string */
  value: string | null;
  /** for reference: the target row id */
  rowId?: string | null;
}

export const ERRORS = ['#DIV/0!', '#TYPE!', '#NAME?', '#REF!', '#CIRC!'] as const;
export type ErrorString = (typeof ERRORS)[number];

export const decimal = (text: string): Value => ({ kind: 'decimal', value: text });
export const text = (t: string): Value => ({ kind: 'text', value: t });
export const date = (d: string): Value => ({ kind: 'date', value: d });
export const bool = (b: boolean): Value => ({ kind: 'bool', value: b ? 'TRUE' : 'FALSE' });
export const blank = (): Value => ({ kind: 'blank', value: null });
export const error = (e: ErrorString): Value => ({ kind: 'error', value: e });
export const reference = (rowId: string | null): Value => ({
  kind: 'reference',
  value: rowId,
  rowId,
});

export const isBlank = (v: Value) => v.kind === 'blank';

/** The display text of a value, as the grid, CSV and traversals show it. */
export function displayOf(v: Value): string {
  switch (v.kind) {
    case 'blank':
      return '';
    case 'bool':
      return v.value!;
    case 'decimal':
      return v.value!;
    case 'date':
      return v.value!;
    case 'error':
      return v.value!;
    case 'text':
      return v.value!;
    case 'reference':
      // the caller resolves the target display; blank when unknown
      return '';
  }
}

// ---------------------------------------------------------------------------
// Date helpers: plain calendar days, no time of day, no time zone.
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (y < 1 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const daysInMonth = [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]!;
  return d <= daysInMonth;
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Howard Hinnant's civil calendar algorithms, on exact integers. */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z: number): { y: number; m: number; d: number } {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: y + (m <= 2 ? 1 : 0), m, d };
}

/** The day number of a date, counting 0001-01-01 as day 1. Exact integers. */
export function dateToDayNumber(s: string): number {
  const m = DATE_RE.exec(s)!;
  return daysFromCivil(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)) + 719163;
}

/** The date of a day number, or null outside 0001-01-01 to 9999-12-31. */
export function dayNumberToDate(n: number): string | null {
  const { y, m, d } = civilFromDays(n - 719163);
  if (y < 1 || y > 9999) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export const MIN_DAY = 1;
export const MAX_DAY = 3652059;

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

export function decAdd(a: string, b: string): string {
  return roundTo4(new Decimal(a).plus(new Decimal(b)).toFixed(20));
}
export function decSub(a: string, b: string): string {
  return roundTo4(new Decimal(a).minus(new Decimal(b)).toFixed(20));
}
export function decMul(a: string, b: string): string {
  return roundTo4(new Decimal(a).times(new Decimal(b)).toFixed(20));
}
export function decDiv(a: string, b: string): string | ErrorString {
  const bb = new Decimal(b);
  if (bb.isZero()) return '#DIV/0!';
  return roundTo4(new Decimal(a).dividedBy(bb).toDecimalPlaces(20).toFixed(20));
}
export function decNeg(a: string): string {
  const d = new Decimal(a).neg();
  return roundTo4(d.toFixed(20));
}
export function decSum(values: string[]): string {
  let acc = new Decimal(0);
  for (const v of values) acc = acc.plus(new Decimal(v));
  return roundTo4(acc.toFixed(20));
}

/** Canonicalise a formula decimal literal (digits[.digits]) to 4 places. */
export function literalToDecimal(text: string): string {
  return roundTo4(text);
}

export function compareValues(a: Value, b: Value, op: string): Value {
  if (a.kind === 'error') return a;
  if (b.kind === 'error') return b;
  const typeOf = (v: Value): 'decimal' | 'text' | 'date' | 'bool' | 'blank' | 'error' =>
    v.kind === 'reference' ? 'text' : v.kind;
  let ta = typeOf(a);
  let tb = typeOf(b);
  // blank coerces to the other side's type
  if (ta === 'blank' && tb !== 'blank') ta = tb;
  if (tb === 'blank' && ta !== 'blank') tb = ta;
  if (ta !== tb) return error('#TYPE!');
  let cmp: number;
  if (ta === 'decimal') {
    const av = a.kind === 'blank' ? '0' : a.value!;
    const bv = b.kind === 'blank' ? '0' : b.value!;
    cmp = new Decimal(av).cmp(new Decimal(bv));
  } else if (ta === 'text') {
    const av = a.kind === 'blank' ? '' : a.kind === 'reference' ? '' : a.value!;
    const bv = b.kind === 'blank' ? '' : b.kind === 'reference' ? '' : b.value!;
    cmp = av < bv ? -1 : av > bv ? 1 : 0;
  } else if (ta === 'date') {
    const av = a.kind === 'blank' ? '' : a.value!;
    const bv = b.kind === 'blank' ? '' : b.value!;
    cmp = av < bv ? -1 : av > bv ? 1 : 0;
  } else if (ta === 'bool') {
    const av = a.kind === 'blank' ? 'FALSE' : a.value!;
    const bv = b.kind === 'blank' ? 'FALSE' : b.value!;
    cmp = av === bv ? 0 : av === 'FALSE' ? -1 : 1;
  } else {
    // blank against blank
    cmp = 0;
  }
  switch (op) {
    case '=':
      return bool(cmp === 0);
    case '<>':
      return bool(cmp !== 0);
    case '<':
      return bool(cmp < 0);
    case '>':
      return bool(cmp > 0);
    case '<=':
      return bool(cmp <= 0);
    case '>=':
      return bool(cmp >= 0);
    default:
      return error('#TYPE!');
  }
}

/** The text a value becomes under `&`. */
export function joinText(v: Value): string {
  switch (v.kind) {
    case 'blank':
      return '';
    case 'reference':
      return '';
    case 'bool':
    case 'decimal':
    case 'date':
    case 'text':
    case 'error':
      return v.value ?? '';
  }
}

export const isWholeDecimal = (s: string): boolean => new Decimal(s).isInteger();
