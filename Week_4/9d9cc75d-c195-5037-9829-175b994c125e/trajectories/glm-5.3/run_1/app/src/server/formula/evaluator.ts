import { calcRound, roundAway } from "../../shared/display.js";
import type { Node } from "./parser.js";
import { isAggregateName, isTableCalcName } from "./parser.js";

/** Row values are plain scalars; dates are UTC milliseconds. */
export type Value = number | string | boolean | null;

export interface RowEnv {
  fields: Map<string, Value>;
}

export interface EvalContext {
  parameters: Map<string, Value>;
  setMembership: (name: string, member: Value) => boolean;
  calcs: Map<string, Node>;
}

/**
 * Evaluate the row-level part of a formula: literals, fields, parameters,
 * sets, operators and the non-aggregate functions. Aggregates and
 * level-of-detail expressions are handled by the query engine.
 */
export function evalRow(node: Node, row: Map<string, Value>, ctx: EvalContext): Value {
  switch (node.kind) {
    case "number":
      return node.value;
    case "text":
      return node.value;
    case "boolean":
      return node.value;
    case "null":
      return null;
    case "field": {
      const v = row.get(node.name);
      return v === undefined ? null : v;
    }
    case "parameter":
      return ctx.parameters.get(node.name) ?? null;
    case "set": {
      // A set on a row answers whether the row's member is in the set; the
      // caller injects the member under the set's field name.
      const v = row.get(node.name);
      return v === undefined ? null : v;
    }
    case "unary": {
      const v = evalRow(node.operand, row, ctx);
      if (node.op === "NOT") {
        if (v === null) return null;
        return !v;
      }
      if (v === null) return null;
      return -v;
    }
    case "binary":
      return evalBinary(node, row, ctx);
    case "call":
      return evalCall(node, row, ctx);
    case "lod":
      return null;
  }
}

function evalBinary(node: Node & { kind: "binary" }, row: Map<string, Value>, ctx: EvalContext): Value {
  if (node.op === "AND") {
    const l = evalRow(node.left, row, ctx);
    if (l === false) return false;
    const r = evalRow(node.right, row, ctx);
    if (r === false) return false;
    if (l === null || r === null) return null;
    return true;
  }
  if (node.op === "OR") {
    const l = evalRow(node.left, row, ctx);
    if (l === true) return true;
    const r = evalRow(node.right, row, ctx);
    if (r === true) return true;
    if (l === null || r === null) return null;
    return false;
  }
  const l = evalRow(node.left, row, ctx);
  const r = evalRow(node.right, row, ctx);
  if (l === null || r === null) return null;
  if (typeof l === "number" && typeof r === "number") {
    switch (node.op) {
      case "+":
        return calcRound(l + r);
      case "-":
        return calcRound(l - r);
      case "*":
        return calcRound(l * r);
      case "/":
        if (r === 0) return null;
        return calcRound(l / r);
      case "%": {
        if (r === 0) return null;
        const m = Math.abs(l) % Math.abs(r);
        return l < 0 ? -m : m;
      }
    }
  }
  switch (node.op) {
    case "&":
      return toText(l) + toText(r);
    case "=":
      return l === r;
    case "<>":
      return l !== r;
    case "<":
      return l < r;
    case "<=":
      return l <= r;
    case ">":
      return l > r;
    case ">=":
      return l >= r;
  }
  return null;
}

function toText(v: Value): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  return v;
}

const DAY_MS = 86400000;

function toNumber(v: Value): number | null {
  if (v === null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
}

function mondayOf(ms: number): number {
  const d = new Date(ms);
  const day = d.getUTCDay();
  const back = (day + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back);
}

function evalCall(node: Node & { kind: "call" }, row: Map<string, Value>, ctx: EvalContext): Value {
  const fn = node.fn;
  if (isAggregateName(fn) || isTableCalcName(fn)) {
    // Aggregates are computed by the query engine, not here.
    return null;
  }
  const args = node.args.map((a) => evalRow(a, row, ctx));
  switch (fn) {
    case "IF": {
      const cond = args[0];
      if (cond === null || cond === false) return args[2];
      return args[1];
    }
    case "IFNULL":
      return args[0] === null ? args[1] : args[0];
    case "ISNULL":
      return args[0] === null;
    case "ABS": {
      const v = toNumber(args[0]);
      return v === null ? null : Math.abs(v);
    }
    case "ROUND": {
      const v = toNumber(args[0]);
      const dp = toNumber(args[1]);
      if (v === null || dp === null) return null;
      return roundAway(v, Math.trunc(dp));
    }
    case "UPPER":
      return args[0] === null ? null : toText(args[0]).toUpperCase();
    case "LOWER":
      return args[0] === null ? null : toText(args[0]).toLowerCase();
    case "LEN":
      return args[0] === null ? null : toText(args[0]).length;
    case "LEFT": {
      if (args[0] === null) return null;
      const n = toNumber(args[1]);
      if (n === null) return null;
      return toText(args[0]).slice(0, Math.max(0, Math.trunc(n)));
    }
    case "RIGHT": {
      if (args[0] === null) return null;
      const n = toNumber(args[1]);
      if (n === null) return null;
      const k = Math.max(0, Math.trunc(n));
      const s = toText(args[0]);
      return k === 0 ? "" : s.slice(Math.max(0, s.length - k));
    }
    case "CONTAINS":
      if (args[0] === null || args[1] === null) return null;
      return toText(args[0]).includes(toText(args[1]));
    case "PART_OF": {
      const ms = toNumber(args[0]);
      const part = toText(args[1]);
      if (ms === null || part === null) return null;
      const d = new Date(ms);
      if (part === "year") return d.getUTCFullYear();
      if (part === "month") return d.getUTCMonth() + 1;
      if (part === "week") return isoWeek(d);
      if (part === "day") return d.getUTCDate();
      if (part === "weekday") return ((d.getUTCDay() + 6) % 7) + 1;
      return null;
    }
    case "TRUNC_TO": {
      const ms = toNumber(args[0]);
      const part = toText(args[1]);
      if (ms === null) return null;
      const d = new Date(ms);
      if (part === "year") return Date.UTC(d.getUTCFullYear(), 0, 1);
      if (part === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
      if (part === "week") return mondayOf(ms);
      return null;
    }
    case "DAYS_BETWEEN": {
      const a = toNumber(args[0]);
      const b = toNumber(args[1]);
      if (a === null || b === null) return null;
      return Math.round((b - a) / DAY_MS);
    }
    case "NUM": {
      const s = toText(args[0]);
      const n = Number(s);
      return s.trim() !== "" && Number.isFinite(n) ? n : null;
    }
    case "TEXT": {
      const v = args[0];
      if (v === null) return null;
      if (typeof v === "number") {
        if (Number.isInteger(v)) return String(v);
        return String(v);
      }
      if (typeof v === "boolean") return v ? "true" : "false";
      if (typeof v === "string") return v;
      const d = new Date(v);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
  }
  return null;
}
