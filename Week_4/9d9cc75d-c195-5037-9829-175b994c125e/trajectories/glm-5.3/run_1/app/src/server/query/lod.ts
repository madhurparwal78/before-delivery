import { calcRound } from "../../shared/display.js";
import type { Node } from "../formula/parser.js";
import { isAggregateName } from "../formula/parser.js";
import { evalRow, type Value } from "../formula/evaluator.js";
import { type FieldDef, type Row, type AggFn, aggValue } from "./core.js";
import { dimValueFor, type QueryContext } from "./evaluate.js";

export type LodForm = "at" | "plus" | "minus" | "whole";

export interface LodScope {
  /** Rows in scope for this LOD step. */
  rows: Row[];
  /** The view's dimensions for PLUS and MINUS. */
  viewDims: { field: FieldDef; level: string | null }[];
}

/**
 * The LOD rules: AT computes at exactly those dims, PLUS at the view's
 * dimensions plus those, MINUS at the view's dimensions minus those, and
 * {agg} at no dims. Each gives one number per source row at its level.
 */
export function lodDims(node: Node & { kind: "lod" }, viewDims: { field: FieldDef; level: string | null }[], allFields: FieldDef[]): { field: FieldDef; level: string | null }[] {
  const listed = node.dims
    .map((d) => (d.kind === "field" ? d.name : null))
    .filter((n): n is string => n !== null)
    .map((name) => {
      const inView = viewDims.find((d) => d.field.name === name);
      if (inView) return inView;
      const f = allFields.find((fd) => fd.name === name);
      return f ? { field: f, level: null } : undefined;
    })
    .filter((d): d is { field: FieldDef; level: string | null } => d !== undefined);
  if (node.form === "at") return listed;
  if (node.form === "whole") return [];
  if (node.form === "plus") {
    const names = new Set(listed.map((d) => d.field.name));
    return [...viewDims.filter((d) => !names.has(d.field.name)), ...listed];
  }
  // minus
  const names = new Set(listed.map((d) => d.field.name));
  return viewDims.filter((d) => !names.has(d.field.name));
}

/**
 * Precompute one LOD node's per-row values over its scope. Each row gets the
 * aggregate of the group of rows that share its values on the LOD dims.
 */
export function lodRowValues(
  node: Node & { kind: "lod" },
  scope: LodScope,
  fields: FieldDef[],
  ctx: QueryContext,
): Map<Row, number | null> {
  const fieldByName = new Map(fields.map((f) => [f.name, f]));
  const dims = lodDims(node, scope.viewDims, fields);
  const groups = new Map<string, { dimValues: Value[]; rows: Row[] }>();
  for (const r of scope.rows) {
    const keyParts = dims.map((d) => dimValueFor(r, d.field, d.level));
    const key = keyParts.map((v) => (v === null ? "\u0000" : String(v))).join("\u0001");
    let g = groups.get(key);
    if (!g) {
      g = { dimValues: keyParts, rows: [] };
      groups.set(key, g);
    }
    g.rows.push(r);
  }
  const rowValue = new Map<Row, number | null>();
  for (const g of groups.values()) {
    const v = evalAgg(node.body, g.rows, ctx, fields);
    for (const r of g.rows) rowValue.set(r, v);
  }
  return rowValue;
}

/** Evaluate an aggregate-only formula body over a set of rows. */
function evalAgg(node: Node, rows: Row[], ctx: QueryContext, fields: FieldDef[]): number | null {
  const v = evalAggValue(node, rows, ctx, fields);
  return typeof v === "number" ? v : null;
}

/**
 * Evaluate a formula's result for a set of rows: aggregates run over the
 * rows, row-level parts inside them run per row, and arithmetic combines.
 */
export function evalAggValue(node: Node, rows: Row[], ctx: QueryContext, fields: FieldDef[]): Value {
  const evalCtx = {
    parameters: ctx.parameters,
    setMembership: (): boolean => false,
    calcs: new Map<string, Node>(),
  };
  switch (node.kind) {
    case "number":
      return node.value;
    case "text":
      return node.value;
    case "boolean":
      return node.value;
    case "null":
      return null;
    case "unary": {
      const v = evalAggValue(node.operand, rows, ctx, fields);
      if (node.op === "NOT") return v === null ? null : !v;
      if (v === null) return null;
      return -v;
    }
    case "binary": {
      const l = evalAggValue(node.left, rows, ctx, fields);
      const r = evalAggValue(node.right, rows, ctx, fields);
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
          case "%":
            if (r === 0) return null;
            {
              const m = Math.abs(l) % Math.abs(r);
              return l < 0 ? -m : m;
            }
        }
      }
      if (node.op === "&") return String(l) + String(r);
      if (node.op === "=") return l === r;
      if (node.op === "<>") return l !== r;
      return null;
    }
    case "call": {
      if (isAggregateName(node.fn)) {
        const arg = node.args[0];
        const values = rows.map((r) => evalRow(arg, r.values, evalCtx));
        return aggValue(node.fn as AggFn, values);
      }
      if (node.fn === "IF") {
        const cond = evalAggValue(node.args[0], rows, ctx, fields);
        return cond === null || cond === false
          ? evalAggValue(node.args[2], rows, ctx, fields)
          : evalAggValue(node.args[1], rows, ctx, fields);
      }
      if (node.fn === "IFNULL") {
        const a = evalAggValue(node.args[0], rows, ctx, fields);
        return a === null ? evalAggValue(node.args[1], rows, ctx, fields) : a;
      }
      if (node.fn === "ISNULL") {
        return evalAggValue(node.args[0], rows, ctx, fields) === null;
      }
      if (node.fn === "ABS") {
        const v = evalAggValue(node.args[0], rows, ctx, fields);
        return typeof v === "number" ? Math.abs(v) : null;
      }
      // Other scalar functions over aggregates: evaluate args then apply.
      const args = node.args.map((a) => evalAggValue(a, rows, ctx, fields));
      return scalarFn(node.fn, args);
    }
    case "lod":
      // A bare LOD in an arithmetic context: average its per-row values.
      return null;
    default:
      return null;
  }
}

function scalarFn(fn: string, args: Value[]): Value {
  switch (fn) {
    case "UPPER":
      return args[0] === null ? null : String(args[0]).toUpperCase();
    case "LOWER":
      return args[0] === null ? null : String(args[0]).toLowerCase();
    case "LEN":
      return args[0] === null ? null : String(args[0]).length;
    case "ROUND": {
      const a = args[0];
      const b = args[1];
      if (typeof a !== "number" || typeof b !== "number") return null;
      const f = Math.pow(10, Math.trunc(b));
      const x = a * f;
      const r = x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5);
      return r / f;
    }
    case "TEXT":
      return args[0] === null ? null : String(args[0]);
    case "NUM": {
      const n = Number(args[0]);
      return Number.isFinite(n) ? n : null;
    }
    default:
      return null;
  }
}
