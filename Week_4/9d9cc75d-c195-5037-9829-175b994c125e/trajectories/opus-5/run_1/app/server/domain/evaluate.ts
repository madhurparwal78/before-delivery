import { type Ast, FUNCTIONS } from '../../shared/formula.js';
import { calcRound, roundHalfAway } from '../../shared/display.js';
import type { Agg } from '../../shared/types.js';
import type { CellData } from './csv.js';

export type DataRow = Record<string, CellData> & { __i: number };

export interface EvalEnv {
  parameters: Record<string, CellData>;
  setMembers: Map<string, { field: string; keys: Set<string> }>;
  calcs: Map<string, Ast>;
  lodValues: Map<Ast, Map<number, CellData>>;
  tableCalcValues: Map<Ast, CellData>;
  dedupe: (rows: DataRow[], node: Ast) => DataRow[];
}

const DAY = 86400000;

export function dateMs(v: CellData): number | null {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function mondayOf(ms: number): number {
  const d = new Date(ms);
  const day = d.getUTCDay();
  const back = (day + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back);
}

export function isoWeek(ms: number): number {
  const monday = mondayOf(ms);
  const thursday = monday + 3 * DAY;
  const year = new Date(thursday).getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4);
  const firstMonday = mondayOf(jan4);
  return Math.round((monday - firstMonday) / (7 * DAY)) + 1;
}

function num(v: CellData): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function text(v: CellData): string | null {
  return typeof v === 'string' ? v : null;
}

export function textOf(v: CellData): string {
  if (v === null) return '';
  if (typeof v === 'number') return String(calcRound(v));
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const ms = dateMs(v);
  if (ms !== null && /^\d{4}-\d{2}-\d{2}T/.test(v)) return isoDate(ms);
  return v;
}

export function applyFunction(name: string, args: CellData[]): CellData {
  switch (name) {
    case 'IF': {
      const cond = args[0];
      return cond === true ? args[1] : args[2];
    }
    case 'IFNULL':
      return args[0] === null ? args[1] : args[0];
    case 'ISNULL':
      return args[0] === null;
    case 'ABS': {
      const a = num(args[0]);
      return a === null ? null : Math.abs(a);
    }
    case 'ROUND': {
      const a = num(args[0]);
      const dp = num(args[1]);
      return a === null || dp === null ? null : roundHalfAway(a, Math.trunc(dp));
    }
    case 'UPPER': {
      const a = text(args[0]);
      return a === null ? null : a.toUpperCase();
    }
    case 'LOWER': {
      const a = text(args[0]);
      return a === null ? null : a.toLowerCase();
    }
    case 'LEN': {
      const a = text(args[0]);
      return a === null ? null : [...a].length;
    }
    case 'LEFT': {
      const a = text(args[0]);
      const n = num(args[1]);
      return a === null || n === null ? null : [...a].slice(0, Math.max(0, Math.trunc(n))).join('');
    }
    case 'RIGHT': {
      const a = text(args[0]);
      const n = num(args[1]);
      if (a === null || n === null) return null;
      const chars = [...a];
      const k = Math.max(0, Math.trunc(n));
      return chars.slice(Math.max(0, chars.length - k)).join('');
    }
    case 'CONTAINS': {
      const a = text(args[0]);
      const b = text(args[1]);
      return a === null || b === null ? null : a.includes(b);
    }
    case 'PART_OF': {
      const ms = dateMs(args[0]);
      const part = text(args[1]);
      if (ms === null || part === null) return null;
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
          return ((d.getUTCDay() + 6) % 7) + 1;
        default:
          return null;
      }
    }
    case 'TRUNC_TO': {
      const ms = dateMs(args[0]);
      const unit = text(args[1]);
      if (ms === null || unit === null) return null;
      const d = new Date(ms);
      switch (unit) {
        case 'year':
          return new Date(Date.UTC(d.getUTCFullYear(), 0, 1)).toISOString();
        case 'month':
          return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
        case 'week':
          return new Date(mondayOf(ms)).toISOString();
        default:
          return null;
      }
    }
    case 'DAYS_BETWEEN': {
      const a = dateMs(args[0]);
      const b = dateMs(args[1]);
      if (a === null || b === null) return null;
      return Math.floor(b / DAY) - Math.floor(a / DAY);
    }
    case 'NUM': {
      const a = text(args[0]);
      if (a === null) return null;
      const t = a.trim();
      if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
      return Number(t);
    }
    case 'TEXT':
      return args[0] === null ? null : textOf(args[0]);
    default:
      return null;
  }
}

function compare(a: CellData, b: CellData): number | null {
  if (a === null || b === null) return null;
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1;
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

function arithmetic(op: string, l: CellData, r: CellData): CellData {
  if (op === '&') {
    const a = text(l);
    const b = text(r);
    return a === null || b === null ? null : a + b;
  }
  const a = num(l);
  const b = num(r);
  if (a === null || b === null) return null;
  switch (op) {
    case '+':
      return calcRound(a + b);
    case '-':
      return calcRound(a - b);
    case '*':
      return calcRound(a * b);
    case '/':
      return b === 0 ? null : calcRound(a / b);
    case '%': {
      if (b === 0) return null;
      const rem = Math.abs(a) % Math.abs(b);
      return calcRound(a < 0 ? -rem : rem);
    }
    default:
      return null;
  }
}

export function evalRow(node: Ast, row: DataRow, env: EvalEnv): CellData {
  switch (node.k) {
    case 'num':
      return node.v;
    case 'str':
      return node.v;
    case 'bool':
      return node.v;
    case 'null':
      return null;
    case 'param':
      return env.parameters[node.name] ?? null;
    case 'ref': {
      const calc = env.calcs.get(node.name);
      if (calc !== undefined && !(node.name in row)) return evalRow(calc, row, env);
      const set = env.setMembers.get(node.name);
      if (set !== undefined && !(node.name in row)) {
        const v = row[set.field];
        return set.keys.has(keyOf(v));
      }
      return node.name in row ? row[node.name] : null;
    }
    case 'unary': {
      const v = evalRow(node.arg, row, env);
      if (node.op === '-') {
        const n = num(v);
        return n === null ? null : calcRound(-n);
      }
      return v === null ? null : v === false;
    }
    case 'bin':
      return evalBin(node, (child) => evalRow(child, row, env));
    case 'call': {
      const sig = FUNCTIONS[node.name];
      if (sig?.aggregate === true || sig?.tableCalc === true) return null;
      return applyFunction(
        node.name,
        node.args.map((a) => evalRow(a, row, env)),
      );
    }
    case 'lod': {
      const map = env.lodValues.get(node);
      return map === undefined ? null : map.get(row.__i) ?? null;
    }
    default:
      return null;
  }
}

function evalBin(node: Ast & { k: 'bin' }, child: (n: Ast) => CellData): CellData {
  if (node.op === 'OR' || node.op === 'AND') {
    const l = child(node.l);
    const r = child(node.r);
    if (node.op === 'OR') {
      if (l === true || r === true) return true;
      if (l === null || r === null) return null;
      return false;
    }
    if (l === false || r === false) return false;
    if (l === null || r === null) return null;
    return true;
  }
  const l = child(node.l);
  const r = child(node.r);
  if (['=', '<>', '<', '<=', '>', '>='].includes(node.op)) {
    const c = compare(l, r);
    if (c === null) return null;
    switch (node.op) {
      case '=':
        return c === 0;
      case '<>':
        return c !== 0;
      case '<':
        return c < 0;
      case '<=':
        return c <= 0;
      case '>':
        return c > 0;
      default:
        return c >= 0;
    }
  }
  return arithmetic(node.op, l, r);
}

export function aggregateValues(agg: Agg, values: CellData[]): CellData {
  if (agg === 'COUNT') return values.filter((v) => v !== null).length;
  if (agg === 'COUNT_UNIQUE') {
    const seen = new Set<string>();
    values.forEach((v) => {
      if (v !== null) seen.add(keyOf(v));
    });
    return seen.size;
  }
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  switch (agg) {
    case 'SUM':
      return calcRound(nums.reduce((a, b) => a + b, 0));
    case 'AVG':
      return calcRound(nums.reduce((a, b) => a + b, 0) / nums.length);
    case 'MEDIAN': {
      const sorted = [...nums].sort((a, b) => a - b);
      const mid = sorted.length >> 1;
      return calcRound(sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
    }
    case 'MIN':
      return calcRound(Math.min(...nums));
    default:
      return calcRound(Math.max(...nums));
  }
}

export function evalAggregate(node: Ast, rows: DataRow[], env: EvalEnv): CellData {
  switch (node.k) {
    case 'num':
      return node.v;
    case 'str':
      return node.v;
    case 'bool':
      return node.v;
    case 'null':
      return null;
    case 'param':
      return env.parameters[node.name] ?? null;
    case 'ref': {
      const calc = env.calcs.get(node.name);
      if (calc !== undefined) return evalAggregate(calc, rows, env);
      return null;
    }
    case 'unary': {
      const v = evalAggregate(node.arg, rows, env);
      if (node.op === '-') {
        const n = num(v);
        return n === null ? null : calcRound(-n);
      }
      return v === null ? null : v === false;
    }
    case 'bin':
      return evalBin(node, (child) => evalAggregate(child, rows, env));
    case 'call': {
      const sig = FUNCTIONS[node.name];
      if (sig?.tableCalc === true) return env.tableCalcValues.get(node) ?? null;
      if (sig?.aggregate === true) {
        const arg = node.args[0];
        const source = env.dedupe(rows, arg);
        return aggregateValues(node.name as Agg, source.map((r) => evalRow(arg, r, env)));
      }
      return applyFunction(
        node.name,
        node.args.map((a) => evalAggregate(a, rows, env)),
      );
    }
    default:
      return null;
  }
}

export function keyOf(v: CellData): string {
  if (v === null) return '\u0000null';
  if (typeof v === 'number') return `n:${v}`;
  if (typeof v === 'boolean') return `b:${v ? 1 : 0}`;
  return `s:${v}`;
}

/** Descending order with nulls last, used wherever a measure orders members. */
export function compareDescending(a: CellData, b: CellData): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return -compareValues(a, b);
}

export function compareValues(a: CellData, b: CellData): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}
