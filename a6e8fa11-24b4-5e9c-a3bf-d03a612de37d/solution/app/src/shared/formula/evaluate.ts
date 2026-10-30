// Formula evaluation (Business rules · Formulas). One evaluator, imported by the server and the browser.
import { generalNumber, roundHalfAway } from "../format.js";
import { type Area } from "../refs.js";
import { type CellValue, type ErrorValue, type Scalar, errorValue, isError, serialOfDate } from "../values.js";
import { type Node, type RefNode } from "./parser.js";

export interface EvalContext {
  /** The sheet id a reference names, or null when no such sheet exists. */
  sheetOf(ref: RefNode): string | null;
  valueAt(sheetId: string, row: number, col: number): CellValue;
  today(): number;
  now(): number;
}

interface RangeValue {
  range: { sheetId: string; area: Area };
}

type Value = CellValue | RangeValue;

function isRange(v: Value): v is RangeValue {
  return typeof v === "object" && v !== null && "range" in v;
}

const VALUE = errorValue("#VALUE!");
const DIV0 = errorValue("#DIV/0!");

function* rangeValues(ctx: EvalContext, r: RangeValue): Generator<CellValue> {
  const { sheetId, area } = r.range;
  for (let row = area.top; row <= area.bottom; row++) {
    for (let col = area.left; col <= area.right; col++) yield ctx.valueAt(sheetId, row, col);
  }
}

/** A value used where one scalar is expected; a one-cell range is its cell. */
function scalar(ctx: EvalContext, v: Value): CellValue {
  if (!isRange(v)) return v;
  const { area, sheetId } = v.range;
  if (area.top === area.bottom && area.left === area.right) return ctx.valueAt(sheetId, area.top, area.left);
  return VALUE;
}

function toNumber(v: CellValue): number | ErrorValue {
  if (v === null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") return VALUE;
  return v;
}

function toText(v: CellValue): string | ErrorValue {
  if (v === null) return "";
  if (typeof v === "number") return generalNumber(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return v;
  return v;
}

function toBoolean(v: CellValue): boolean | ErrorValue {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return VALUE;
  return v;
}

function finite(n: number): number | ErrorValue {
  return Number.isFinite(n) ? n : VALUE;
}

const TYPE_RANK = { number: 0, string: 1, boolean: 2 } as const;

function compare(a: Scalar | null, b: Scalar | null): number {
  const left: Scalar = a ?? (typeof b === "string" ? "" : typeof b === "boolean" ? false : 0);
  const right: Scalar = b ?? (typeof left === "string" ? "" : typeof left === "boolean" ? false : 0);
  const ta = typeof left as keyof typeof TYPE_RANK;
  const tb = typeof right as keyof typeof TYPE_RANK;
  if (ta !== tb) return TYPE_RANK[ta] - TYPE_RANK[tb];
  if (typeof left === "string") {
    const x = left.toLowerCase();
    const y = (right as string).toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const x = Number(left);
  const y = Number(right);
  return x < y ? -1 : x > y ? 1 : 0;
}

function binary(op: string, a: CellValue, b: CellValue): CellValue {
  if (isError(a)) return a;
  if (isError(b)) return b;
  if (op === "&") {
    const x = toText(a);
    const y = toText(b);
    if (isError(x)) return x;
    if (isError(y)) return y;
    return x + y;
  }
  if (["=", "<>", "<", "<=", ">", ">="].includes(op)) {
    const c = compare(a, b);
    switch (op) {
      case "=":
        return c === 0;
      case "<>":
        return c !== 0;
      case "<":
        return c < 0;
      case "<=":
        return c <= 0;
      case ">":
        return c > 0;
      default:
        return c >= 0;
    }
  }
  const x = toNumber(a);
  const y = toNumber(b);
  if (isError(x)) return x;
  if (isError(y)) return y;
  switch (op) {
    case "+":
      return finite(x + y);
    case "-":
      return finite(x - y);
    case "*":
      return finite(x * y);
    case "/":
      return y === 0 ? DIV0 : finite(x / y);
    default:
      return finite(x ** y);
  }
}

/** Numbers drawn from function arguments: ranges skip text, booleans and empty cells; direct text is #VALUE!. */
function numbers(ctx: EvalContext, args: Value[]): number[] | ErrorValue {
  const out: number[] = [];
  for (const arg of args) {
    if (isRange(arg)) {
      for (const v of rangeValues(ctx, arg)) {
        if (isError(v)) return v;
        if (typeof v === "number") out.push(v);
      }
    } else {
      const n = toNumber(arg);
      if (isError(n)) return n;
      if (arg !== null) out.push(n);
    }
  }
  return out;
}

function matches(cell: CellValue, criterion: CellValue): boolean {
  if (isError(cell) || isError(criterion)) return false;
  if (criterion === null) return cell === null || cell === "";
  if (typeof criterion === "string") {
    if (typeof cell === "string") return cell.toLowerCase() === criterion.toLowerCase();
    if (typeof cell === "number" && criterion.trim() !== "" && !Number.isNaN(Number(criterion))) return cell === Number(criterion);
    return false;
  }
  return cell === criterion;
}

interface Conditional {
  count: number;
  sum: number;
}

function conditional(ctx: EvalContext, range: Value, criterion: Value, target: Value | undefined): Conditional | ErrorValue {
  if (!isRange(range) || (target !== undefined && !isRange(target))) return VALUE;
  const wanted = scalar(ctx, criterion);
  if (isError(wanted)) return wanted;
  const { sheetId, area } = range.range;
  const values = target === undefined ? range.range : { sheetId: target.range.sheetId, area: target.range.area };
  const result: Conditional = { count: 0, sum: 0 };
  for (let row = area.top; row <= area.bottom; row++) {
    for (let col = area.left; col <= area.right; col++) {
      if (!matches(ctx.valueAt(sheetId, row, col), wanted)) continue;
      result.count++;
      const v = ctx.valueAt(values.sheetId, values.area.top + row - area.top, values.area.left + col - area.left);
      if (isError(v)) return v;
      if (typeof v === "number") result.sum += v;
    }
  }
  return result;
}

function logical(ctx: EvalContext, args: Value[], all: boolean): CellValue {
  let seen = false;
  let result = all;
  for (const arg of args) {
    const values = isRange(arg) ? [...rangeValues(ctx, arg)] : [arg];
    for (const v of values) {
      if (isError(v)) return v;
      if (isRange(arg) && (typeof v === "string" || v === null)) continue;
      const b = toBoolean(v);
      if (isError(b)) return b;
      seen = true;
      result = all ? result && b : result || b;
    }
  }
  return seen ? result : VALUE;
}

type Fn = (ctx: EvalContext, args: Value[]) => CellValue;

function arity(min: number, max: number, fn: Fn): Fn {
  return (ctx, args) => (args.length < min || args.length > max ? errorValue("#ERROR!") : fn(ctx, args));
}

function firstNumber(ctx: EvalContext, v: Value): number | ErrorValue {
  return toNumber(scalar(ctx, v));
}

const FUNCTIONS: Record<string, Fn> = {
  SUM: arity(1, 255, (ctx, args) => {
    const ns = numbers(ctx, args);
    return isError(ns) ? ns : finite(ns.reduce((s, n) => s + n, 0));
  }),
  AVERAGE: arity(1, 255, (ctx, args) => {
    const ns = numbers(ctx, args);
    if (isError(ns)) return ns;
    return ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : DIV0;
  }),
  MIN: arity(1, 255, (ctx, args) => {
    const ns = numbers(ctx, args);
    return isError(ns) ? ns : ns.length ? Math.min(...ns) : 0;
  }),
  MAX: arity(1, 255, (ctx, args) => {
    const ns = numbers(ctx, args);
    return isError(ns) ? ns : ns.length ? Math.max(...ns) : 0;
  }),
  COUNT: arity(1, 255, (ctx, args) => {
    let n = 0;
    for (const arg of args) {
      const values = isRange(arg) ? [...rangeValues(ctx, arg)] : [arg];
      n += values.filter((v) => typeof v === "number").length;
    }
    return n;
  }),
  COUNTA: arity(1, 255, (ctx, args) => {
    let n = 0;
    for (const arg of args) {
      const values = isRange(arg) ? [...rangeValues(ctx, arg)] : [arg];
      n += values.filter((v) => v !== null).length;
    }
    return n;
  }),
  STDEV: arity(1, 255, (ctx, args) => {
    const ns = numbers(ctx, args);
    if (isError(ns)) return ns;
    if (ns.length < 2) return DIV0;
    const mean = ns.reduce((s, n) => s + n, 0) / ns.length;
    return Math.sqrt(ns.reduce((s, n) => s + (n - mean) ** 2, 0) / (ns.length - 1));
  }),
  ROUND: arity(2, 2, (ctx, args) => {
    const x = firstNumber(ctx, args[0]);
    const d = firstNumber(ctx, args[1]);
    if (isError(x)) return x;
    if (isError(d)) return d;
    return roundHalfAway(x, Math.trunc(d));
  }),
  ABS: arity(1, 1, (ctx, args) => {
    const x = firstNumber(ctx, args[0]);
    return isError(x) ? x : Math.abs(x);
  }),
  AND: arity(1, 255, (ctx, args) => logical(ctx, args, true)),
  OR: arity(1, 255, (ctx, args) => logical(ctx, args, false)),
  SUMIF: arity(2, 3, (ctx, args) => {
    const r = conditional(ctx, args[0], args[1], args[2]);
    return isError(r) ? r : r.sum;
  }),
  COUNTIF: arity(2, 2, (ctx, args) => {
    const r = conditional(ctx, args[0], args[1], undefined);
    return isError(r) ? r : r.count;
  }),
  AVERAGEIF: arity(2, 3, (ctx, args) => {
    const r = conditional(ctx, args[0], args[1], args[2]);
    if (isError(r)) return r;
    return r.count ? r.sum / r.count : DIV0;
  }),
  DATE: arity(3, 3, (ctx, args) => {
    const parts = args.map((a) => firstNumber(ctx, a));
    const bad = parts.find(isError);
    if (bad) return bad;
    const [y, m, d] = parts.map((p) => Math.trunc(p as number));
    return serialOfDate(y, m, d);
  }),
  TODAY: arity(0, 0, (ctx) => ctx.today()),
  NOW: arity(0, 0, (ctx) => ctx.now()),
};

function evaluateNode(node: Node, ctx: EvalContext): Value {
  switch (node.t) {
    case "num":
    case "str":
    case "bool":
      return node.v;
    case "name":
      return errorValue("#NAME?");
    case "ref": {
      const sheetId = ctx.sheetOf(node);
      if (sheetId === null || !node.inGrid) return errorValue("#REF!");
      return { range: { sheetId, area: node.area } };
    }
    case "unary": {
      const a = scalar(ctx, evaluateNode(node.a, ctx));
      const n = toNumber(a);
      if (isError(n)) return n;
      return node.op === "-" ? -n : n;
    }
    case "binary": {
      const a = scalar(ctx, evaluateNode(node.a, ctx));
      if (isError(a)) return a;
      return binary(node.op, a, scalar(ctx, evaluateNode(node.b, ctx)));
    }
    case "call": {
      if (node.name === "IF") {
        if (node.args.length < 2 || node.args.length > 3) return errorValue("#ERROR!");
        const cond = toBoolean(scalar(ctx, evaluateNode(node.args[0], ctx)));
        if (isError(cond)) return cond;
        if (cond) return scalar(ctx, evaluateNode(node.args[1], ctx));
        return node.args.length === 3 ? scalar(ctx, evaluateNode(node.args[2], ctx)) : false;
      }
      const fn = FUNCTIONS[node.name];
      if (!fn) return errorValue("#NAME?");
      const args: Value[] = [];
      for (const a of node.args) {
        const v = evaluateNode(a, ctx);
        if (isError(v)) return v;
        args.push(v);
      }
      return fn(ctx, args);
    }
  }
}

/** Evaluates a parsed formula to a single cell value. */
export function evaluateFormula(ast: Node, ctx: EvalContext): CellValue {
  return scalar(ctx, evaluateNode(ast, ctx));
}
