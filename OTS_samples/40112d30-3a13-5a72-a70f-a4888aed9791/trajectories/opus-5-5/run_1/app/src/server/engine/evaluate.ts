import { formatDate, isRealDate } from "../../shared/formats.js";
import { CalcError, Decimal, REASON } from "./decimal.js";
import type { ArithOp, CompareOp, Node } from "./formula.js";

export type Value =
  | { t: "blank" }
  | { t: "num"; v: Decimal }
  | { t: "text"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "date"; v: string }
  | { t: "list"; v: string[] }
  | { t: "opaque" };

export const BLANK: Value = { t: "blank" };

export function text(v: string): Value {
  return v === "" ? BLANK : { t: "text", v };
}

export function bool(v: boolean): Value {
  return { t: "bool", v };
}

export function num(v: Decimal): Value {
  return { t: "num", v };
}

export interface Scope {
  ref(key: string, row: string | null): Value;
  today: string;
}

export function truth(value: Value): boolean {
  switch (value.t) {
    case "blank":
      return false;
    case "bool":
      return value.v;
    case "num":
      return !value.v.isZero();
    case "list":
      return value.v.length > 0;
    default:
      return true;
  }
}

function toNumber(value: Value): Decimal {
  if (value.t === "blank") return Decimal.ZERO;
  if (value.t === "num") return value.v;
  throw new CalcError(REASON.needsNumber);
}

export function toText(value: Value): string {
  switch (value.t) {
    case "blank":
    case "opaque":
      return "";
    case "num":
      return value.v.toText();
    case "text":
      return value.v;
    case "bool":
      return value.v ? "true" : "false";
    case "date":
      return formatDate(value.v);
    case "list":
      return value.v.join(", ");
  }
}

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

function dateFromDayNumber(n: number): string {
  const date = new Date(n * 86400000);
  const y = date.getUTCFullYear();
  if (!Number.isFinite(n) || y < 1 || y > 9999) throw new CalcError(REASON.needsDate);
  return `${String(y).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function toDate(value: Value): string {
  if (value.t === "date") return value.v;
  throw new CalcError(REASON.needsDate);
}

function compare(op: CompareOp, a: Value, b: Value): boolean {
  if (a.t === "blank" || b.t === "blank") {
    if (op === "=") return a.t === b.t;
    if (op === "<>") return a.t !== b.t;
    return false;
  }
  let order: number;
  if (a.t === "num" && b.t === "num") order = a.v.cmp(b.v);
  else if (a.t === "text" && b.t === "text") {
    const x = a.v.toLowerCase();
    const y = b.v.toLowerCase();
    order = x === y ? 0 : x < y ? -1 : 1;
  } else if (a.t === "date" && b.t === "date") order = a.v === b.v ? 0 : a.v < b.v ? -1 : 1;
  else if (a.t === "bool" && b.t === "bool" && (op === "=" || op === "<>")) order = a.v === b.v ? 0 : 1;
  else if (op === "=") return false;
  else if (op === "<>") return true;
  else throw new CalcError(REASON.cannotCompare);
  switch (op) {
    case "=":
      return order === 0;
    case "<>":
      return order !== 0;
    case "<":
      return order < 0;
    case "<=":
      return order <= 0;
    case ">":
      return order > 0;
    case ">=":
      return order >= 0;
  }
}

function numbersOf(values: Value[]): Decimal[] {
  return values.filter((v) => v.t !== "blank").map(toNumber);
}

function wholeOf(value: Decimal): number {
  return Number(value.trunc().toText());
}

export function evaluate(node: Node, scope: Scope): Value {
  const ev = (n: Node): Value => evaluate(n, scope);
  switch (node.k) {
    case "num":
      return num(node.v);
    case "text":
      return text(node.v);
    case "bool":
      return bool(node.v);
    case "ref":
      return scope.ref(node.key, node.row);
    case "neg":
      return num(toNumber(ev(node.arg)).neg());
    case "not":
      return bool(!truth(ev(node.arg)));
    case "and":
      return bool(truth(ev(node.left)) && truth(ev(node.right)));
    case "or":
      return bool(truth(ev(node.left)) || truth(ev(node.right)));
    case "join":
      return text(toText(ev(node.left)) + toText(ev(node.right)));
    case "compare":
      return bool(compare(node.op, ev(node.left), ev(node.right)));
    case "arith":
      return num(arithmetic(node.op, toNumber(ev(node.left)), toNumber(ev(node.right))));
    case "call":
      return callFunction(node, scope);
  }
}

function arithmetic(op: ArithOp, a: Decimal, b: Decimal): Decimal {
  switch (op) {
    case "+":
      return a.add(b);
    case "-":
      return a.sub(b);
    case "*":
      return a.mul(b);
    case "/":
      return a.div(b);
    case "%":
      return a.mod(b);
    case "^":
      return a.pow(b);
  }
}

function callFunction(node: Extract<Node, { k: "call" }>, scope: Scope): Value {
  if (node.name === "IF") return truth(evaluate(node.args[0], scope)) ? evaluate(node.args[1], scope) : evaluate(node.args[2], scope);
  const args = node.args.map((a) => evaluate(a, scope));
  const anyBlank = args.some((a) => a.t === "blank");
  switch (node.name) {
    case "SUM":
      return num(numbersOf(args).reduce((s, v) => s.add(v), Decimal.ZERO));
    case "MIN":
    case "MAX": {
      const values = numbersOf(args);
      if (values.length === 0) return BLANK;
      const pick = node.name === "MIN" ? -1 : 1;
      return num(values.reduce((best, v) => (v.cmp(best) === pick ? v : best)));
    }
    case "AVG": {
      const values = numbersOf(args);
      if (values.length === 0) return BLANK;
      return num(values.reduce((s, v) => s.add(v), Decimal.ZERO).div(Decimal.fromInt(values.length)));
    }
    case "COUNT":
      return num(Decimal.fromInt(args.filter((a) => a.t !== "blank").length));
    case "ROUND": {
      if (anyBlank) return BLANK;
      const places = wholeOf(toNumber(args[1]));
      if (Math.abs(places) > 1000) throw new CalcError(REASON.tooLarge);
      return num(toNumber(args[0]).round(places));
    }
    case "FLOOR":
      return anyBlank ? BLANK : num(toNumber(args[0]).floor());
    case "CEIL":
      return anyBlank ? BLANK : num(toNumber(args[0]).ceil());
    case "ABS":
      return anyBlank ? BLANK : num(toNumber(args[0]).abs());
    case "BLANK":
      return bool(args[0].t === "blank");
    case "LEN":
      return num(Decimal.fromInt(Array.from(toText(args[0])).length));
    case "UPPER":
      return text(toText(args[0]).toUpperCase());
    case "LOWER":
      return text(toText(args[0]).toLowerCase());
    case "TRIM":
      return text(toText(args[0]).trim().replace(/ {2,}/g, " "));
    case "DATE": {
      const a = args[0];
      if (a.t === "date") return a;
      if (a.t === "text" && isRealDate(a.v)) return { t: "date", v: a.v };
      throw new CalcError(REASON.needsDate);
    }
    case "DAYS":
      if (anyBlank) return BLANK;
      return num(Decimal.fromInt(dayNumber(toDate(args[0])) - dayNumber(toDate(args[1]))));
    case "ADD_DAYS": {
      if (anyBlank) return BLANK;
      const start = toDate(args[0]);
      const days = toNumber(args[1]).trunc();
      if (days.abs().cmp(Decimal.fromInt(4000000)) > 0) throw new CalcError(REASON.needsDate);
      return { t: "date", v: dateFromDayNumber(dayNumber(start) + days.toNumber()) };
    }
    case "TODAY":
      return { t: "date", v: scope.today };
    case "HAS": {
      const list = args[0];
      if (list.t === "blank") return bool(false);
      const wanted = toText(args[1]).toLowerCase();
      const items = list.t === "list" ? list.v : [toText(list)];
      return bool(items.some((item) => item.toLowerCase() === wanted));
    }
    case "TICKED": {
      const list = args[0];
      return num(Decimal.fromInt(list.t === "list" ? list.v.length : list.t === "blank" ? 0 : 1));
    }
  }
}
