export type ErrorCode = '#VALUE!' | '#DIV/0!' | '#REF!' | '#NAME?' | '#ERROR!' | '#CYCLE' | '#LIMIT';

export interface CellError {
  readonly err: ErrorCode;
}

export type CellValue = number | string | boolean | CellError | null;

export function error(code: ErrorCode): CellError {
  return { err: code };
}

export function isError(value: CellValue): value is CellError {
  return typeof value === 'object' && value !== null && 'err' in value;
}

export type NumberFormat = 'general' | '0' | '0.0' | '0.00' | '0.000' | '0.0%' | 'date';

export const NUMBER_FORMATS: NumberFormat[] = ['general', '0', '0.0', '0.00', '0.000', '0.0%', 'date'];

export function isNumberFormat(text: unknown): text is NumberFormat {
  return typeof text === 'string' && (NUMBER_FORMATS as string[]).includes(text);
}

export type CellInputKind = 'empty' | 'formula' | 'number' | 'date' | 'boolean' | 'text';

export interface ParsedInput {
  kind: CellInputKind;
  /** Literal value for non-formula inputs; the formula source (without `=`) for formulas. */
  literal: CellValue;
  formula?: string;
}

const NUMBER_INPUT_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
const DATE_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const DATE_EPOCH_DAYS = 25569; // days from 1899-12-30 to 1970-01-01
const MS_PER_DAY = 86400000;

export function dateToSerial(year: number, month: number, day: number): number {
  const utc = Date.UTC(year, month - 1, day) / MS_PER_DAY;
  return utc + DATE_EPOCH_DAYS;
}

export function serialToDateParts(serial: number): { year: number; month: number; day: number } {
  const days = Math.floor(serial) - DATE_EPOCH_DAYS;
  const d = new Date(days * MS_PER_DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function parseInput(input: string): ParsedInput {
  if (input === '') return { kind: 'empty', literal: null };
  if (input.startsWith('=')) return { kind: 'formula', literal: null, formula: input.slice(1) };
  if (input.startsWith("'")) return { kind: 'text', literal: input.slice(1) };
  if (NUMBER_INPUT_RE.test(input)) return { kind: 'number', literal: Number(input) };
  const dm = DATE_INPUT_RE.exec(input);
  if (dm) {
    const year = Number(dm[1]);
    const month = Number(dm[2]);
    const day = Number(dm[3]);
    if (isRealDate(year, month, day)) {
      return { kind: 'date', literal: dateToSerial(year, month, day) };
    }
  }
  const upper = input.toUpperCase();
  if (upper === 'TRUE') return { kind: 'boolean', literal: true };
  if (upper === 'FALSE') return { kind: 'boolean', literal: false };
  return { kind: 'text', literal: input };
}

/** Rounding half away from zero. */
export function roundHalfAway(x: number, digits: number): number {
  if (!Number.isFinite(x)) return x;
  const factor = Math.pow(10, digits);
  const scaled = x * factor;
  const rounded = Math.sign(scaled) * Math.round(Math.abs(Number(scaled.toPrecision(15))));
  return rounded / factor;
}

function fixed(x: number, digits: number): string {
  const rounded = roundHalfAway(x, digits);
  const abs = Math.abs(rounded).toFixed(digits);
  return (rounded < 0 && Number(abs) !== 0 ? '-' : '') + abs;
}

export function generalNumberText(x: number): string {
  if (!Number.isFinite(x)) return '#NUM!';
  if (Number.isInteger(x) && Math.abs(x) < 1e10) return String(x);
  const text = x.toPrecision(10);
  let out = Number(text).toString();
  if (out.includes('e')) out = Number(x.toPrecision(10)).toExponential();
  return out;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

export function formatSerialDate(serial: number): string {
  const { year, month, day } = serialToDateParts(serial);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

export function displayValue(value: CellValue, format: NumberFormat): string {
  if (value === null) return '';
  if (isError(value)) return value.err;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'string') return value;
  switch (format) {
    case 'general':
      return generalNumberText(value);
    case '0':
      return fixed(value, 0);
    case '0.0':
      return fixed(value, 1);
    case '0.00':
      return fixed(value, 2);
    case '0.000':
      return fixed(value, 3);
    case '0.0%':
      return `${fixed(value * 100, 1)}%`;
    case 'date':
      return formatSerialDate(value);
  }
}

/** The JSON `value` field: numbers, strings and booleans pass through, errors become null. */
export function jsonValue(value: CellValue): number | string | boolean | null {
  if (value === null || isError(value)) return null;
  return value;
}
