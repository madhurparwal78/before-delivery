// The 27 functions and the operators: their arity, argument types and what they compute on single values. Null rules
// live here: arithmetic, `&` and comparisons with null give null, `x / 0` and `x % 0` give null, AND/OR are three-valued.
import { roundHalfAway } from '../../../shared/display.ts';
import type { Agg, Cell, TableCalcKind, ValueType } from '../../../shared/model.ts';
import { convertCell } from '../../sources/csv.ts';
import { compareValues, dayStart, dayText, isoWeek, truncateDate, weekday } from '../values.ts';
import type { BinaryOp } from './ast.ts';

/** A static type: null is the type of the NULL literal (and of anything unknown), which fits every argument. */
export type StaticType = ValueType | null;

/** What an argument accepts: one type, any type, or a number or a date. */
export type ArgRule = ValueType | 'any' | 'orderable';

export const AGGREGATES: ReadonlySet<string> = new Set<Agg>(['SUM', 'AVG', 'MEDIAN', 'MIN', 'MAX', 'COUNT', 'COUNT_UNIQUE']);

export const TABLE_CALC_FUNCTIONS: Record<string, TableCalcKind> = {
  RUN_TOTAL: 'run_total',
  PREV_DIFF: 'prev_diff',
  SHARE: 'share',
  RANK_OF: 'rank',
};

interface FunctionSpec {
  args: ArgRule[];
  /** the result type; `arg` follows the arguments: MIN and MAX the first, IF the second or third, IFNULL either */
  result: ValueType | 'arg';
}

const number: FunctionSpec = { args: ['number'], result: 'number' };

export const FUNCTIONS: Record<string, FunctionSpec> = {
  SUM: number,
  AVG: number,
  MEDIAN: number,
  MIN: { args: ['orderable'], result: 'arg' },
  MAX: { args: ['orderable'], result: 'arg' },
  COUNT: { args: ['any'], result: 'number' },
  COUNT_UNIQUE: { args: ['any'], result: 'number' },
  IF: { args: ['boolean', 'any', 'any'], result: 'arg' },
  IFNULL: { args: ['any', 'any'], result: 'arg' },
  ISNULL: { args: ['any'], result: 'boolean' },
  ABS: number,
  ROUND: { args: ['number', 'number'], result: 'number' },
  UPPER: { args: ['text'], result: 'text' },
  LOWER: { args: ['text'], result: 'text' },
  LEN: { args: ['text'], result: 'number' },
  LEFT: { args: ['text', 'number'], result: 'text' },
  RIGHT: { args: ['text', 'number'], result: 'text' },
  CONTAINS: { args: ['text', 'text'], result: 'boolean' },
  PART_OF: { args: ['date', 'text'], result: 'number' },
  TRUNC_TO: { args: ['date', 'text'], result: 'date' },
  DAYS_BETWEEN: { args: ['date', 'date'], result: 'number' },
  NUM: { args: ['text'], result: 'number' },
  TEXT: { args: ['any'], result: 'text' },
  RUN_TOTAL: number,
  PREV_DIFF: number,
  SHARE: number,
  RANK_OF: number,
};

const DAY_MS = 86400000;

const chars = (text: string): string[] => Array.from(text);

function textOf(value: Exclude<Cell, null>, type: StaticType): string {
  if (typeof value === 'number') return type === 'date' ? dayText(value) : String(Number(value.toFixed(9)));
  return String(value);
}

function partOf(ms: number, part: string): number | null {
  const d = new Date(ms);
  switch (part) {
    case 'year':
      return d.getUTCFullYear();
    case 'month':
      return d.getUTCMonth() + 1;
    case 'week':
      return isoWeek(ms);
    case 'day':
      return d.getUTCDate();
    case 'weekday':
      return weekday(ms);
    default:
      return null;
  }
}

function roundTo(value: number, places: number): number {
  const digits = Math.trunc(places);
  if (digits >= 0) return roundHalfAway(value, Math.min(digits, 9));
  const scale = 10 ** -digits;
  return roundHalfAway(value / scale, 0) * scale;
}

type ScalarFn = (args: Cell[]) => Cell;

/** A scalar function's computation, given its arguments' static types. */
export function scalarFunction(name: string, types: StaticType[]): ScalarFn {
  const num = (v: Cell): number | null => (typeof v === 'number' ? v : null);
  const str = (v: Cell): string | null => (typeof v === 'string' ? v : null);
  switch (name) {
    case 'IF':
      return ([c, a, b]) => (c === true ? (a ?? null) : (b ?? null));
    case 'IFNULL':
      return ([a, b]) => (a === null || a === undefined ? (b ?? null) : a);
    case 'ISNULL':
      return ([a]) => a === null;
    case 'ABS':
      return ([a]) => (typeof a === 'number' ? Math.abs(a) : null);
    case 'ROUND':
      return ([a, b]) => {
        const x = num(a ?? null);
        const n = num(b ?? null);
        return x === null || n === null ? null : roundTo(x, n);
      };
    case 'UPPER':
      return ([a]) => str(a ?? null)?.toUpperCase() ?? null;
    case 'LOWER':
      return ([a]) => str(a ?? null)?.toLowerCase() ?? null;
    case 'LEN':
      return ([a]) => {
        const s = str(a ?? null);
        return s === null ? null : chars(s).length;
      };
    case 'LEFT':
    case 'RIGHT':
      return ([a, b]) => {
        const s = str(a ?? null);
        const n = num(b ?? null);
        if (s === null || n === null) return null;
        const list = chars(s);
        const count = Math.max(0, Math.min(list.length, Math.trunc(n)));
        return (name === 'LEFT' ? list.slice(0, count) : list.slice(list.length - count)).join('');
      };
    case 'CONTAINS':
      return ([a, b]) => {
        const s = str(a ?? null);
        const t = str(b ?? null);
        return s === null || t === null ? null : s.includes(t);
      };
    case 'PART_OF':
      return ([a, b]) => {
        const d = num(a ?? null);
        const part = str(b ?? null);
        return d === null || part === null ? null : partOf(d, part);
      };
    case 'TRUNC_TO':
      return ([a, b]) => {
        const d = num(a ?? null);
        const level = str(b ?? null);
        if (d === null || (level !== 'year' && level !== 'month' && level !== 'week')) return null;
        return truncateDate(d, level);
      };
    case 'DAYS_BETWEEN':
      return ([a, b]) => {
        const from = num(a ?? null);
        const to = num(b ?? null);
        return from === null || to === null ? null : Math.round((dayStart(to) - dayStart(from)) / DAY_MS);
      };
    case 'NUM':
      return ([a]) => {
        const s = str(a ?? null);
        return s === null ? null : convertCell(s.trim(), 'number');
      };
    case 'TEXT': {
      const type = types[0] ?? null;
      return ([a]) => (a === null || a === undefined ? null : textOf(a, type));
    }
    default:
      throw new Error(`${name} is not a scalar function`);
  }
}

type BinaryFn = (a: Cell, b: Cell) => Cell;

const arithmetic = (f: (x: number, y: number) => number | null): BinaryFn => (a, b) =>
  typeof a === 'number' && typeof b === 'number' ? f(a, b) : null;

const comparison = (f: (order: number) => boolean): BinaryFn => (a, b) =>
  a === null || b === null ? null : f(compareValues(a, b));

export const BINARY_FUNCTIONS: Record<BinaryOp, BinaryFn> = {
  OR: (a, b) => (a === true || b === true ? true : a === null || b === null ? null : false),
  AND: (a, b) => (a === false || b === false ? false : a === null || b === null ? null : true),
  '=': comparison((o) => o === 0),
  '<>': comparison((o) => o !== 0),
  '<': comparison((o) => o < 0),
  '<=': comparison((o) => o <= 0),
  '>': comparison((o) => o > 0),
  '>=': comparison((o) => o >= 0),
  '+': arithmetic((x, y) => x + y),
  '-': arithmetic((x, y) => x - y),
  '*': arithmetic((x, y) => x * y),
  '/': arithmetic((x, y) => (y === 0 ? null : x / y)),
  '%': arithmetic((x, y) => (y === 0 ? null : x % y)),
  '&': (a, b) => (typeof a === 'string' && typeof b === 'string' ? a + b : null),
};

export const negate = (a: Cell): Cell => (typeof a === 'number' ? -a : null);
export const not = (a: Cell): Cell => (typeof a === 'boolean' ? !a : null);
