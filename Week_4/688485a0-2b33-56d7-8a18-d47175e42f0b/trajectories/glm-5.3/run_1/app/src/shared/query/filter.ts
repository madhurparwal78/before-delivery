import { JsonObj, JsonValue, isDateObject, dateMs, compareValues, typeName, compactJson } from "../values.js";
import { splitPath, pathFanout } from "./paths.js";
import { QUERY_DEPTH_LIMIT } from "../config.js";
import { fail, RequestError } from "../errors.js";

/**
 * The filter engine (DP-01 … DP-04): operators, logical combination, array
 * matching, and missing/null handling. One definition of every rule.
 */

export interface FilterPlan { readonly conditions: Condition[] }
export type Condition = FieldCondition | LogicalCondition;
export interface FieldCondition {
  readonly kind: "field";
  readonly path: string;
  readonly parts: string[];
  readonly ops: OpCondition[];
}
interface LogicalCondition {
  readonly kind: "logical";
  readonly op: "$and" | "$or" | "$nor";
  readonly filters: FilterPlan[];
}
export type OpCondition =
  | { op: "$eq" | "$ne"; value: JsonValue }
  | { op: "$gt" | "$gte" | "$lt" | "$lte"; value: JsonValue }
  | { op: "$in" | "$nin"; values: JsonValue[] }
  | { op: "$exists"; flag: boolean }
  | { op: "$size"; size: number }
  | { op: "$elemMatch"; filter: FilterPlan }
  | { op: "$not"; ops: OpCondition[] };

const LOGICAL = new Set(["$and", "$or", "$nor"]);
const FIELD_OPS = new Set(["$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$nin", "$exists", "$size", "$elemMatch", "$not"]);

/** A field value that never appeared; it equals null and is what $exists:false matches. */
export const MISSING = Symbol("missing");

function isOperatorObject(v: unknown): v is JsonObj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return keys.length > 0 && keys.every(k => k.startsWith("$"));
}

function depthOf(v: unknown, d: number): number {
  if (typeof v !== "object" || v === null) return d;
  let m = d;
  for (const k in v as JsonObj) m = Math.max(m, depthOf((v as JsonObj)[k], d + 1));
  return m;
}

/**
 * Parses and validates a filter. With `stageIndex`, every filter error is
 * reported as invalid_stage for that stage (DP-20).
 */
export function parseFilter(raw: unknown, stageIndex?: number): FilterPlan {
  const wrap = (fn: () => FilterPlan): FilterPlan => {
    if (depthOf(raw, 0) > QUERY_DEPTH_LIMIT) {
      if (stageIndex !== undefined) fail("invalid_stage", 422, { index: stageIndex });
      fail("query_too_deep", 422, { limit: QUERY_DEPTH_LIMIT });
    }
    try {
      return fn();
    } catch (err) {
      if (err instanceof RequestError && stageIndex !== undefined &&
        (err.code === "unknown_operator" || err.code === "invalid_query" || err.code === "query_too_deep")) {
        fail("invalid_stage", 422, { index: stageIndex });
      }
      throw err;
    }
  };
  return wrap(() => parsePlan(raw));
}

function parsePlan(raw: unknown): FilterPlan {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail("invalid_query", 422, { field: "filter" });
  }
  const obj = raw as JsonObj;
  const conditions: Condition[] = [];
  for (const key of Object.keys(obj)) {
    if (key.startsWith("$")) {
      if (!LOGICAL.has(key)) fail("unknown_operator", 422, { operator: key });
      const arr = obj[key];
      if (!Array.isArray(arr) || arr.length === 0) fail("invalid_query", 422, { field: "filter" });
      conditions.push({ kind: "logical", op: key as "$and" | "$or" | "$nor", filters: arr.map(parsePlan) });
    } else {
      conditions.push(parseField(key, obj[key]));
    }
  }
  return { conditions };
}

function parseField(path: string, cond: unknown): FieldCondition {
  const parts = splitPath(path);
  const ops: OpCondition[] = [];
  if (isOperatorObject(cond)) {
    for (const op of Object.keys(cond)) {
      if (!FIELD_OPS.has(op)) fail("unknown_operator", 422, { operator: op });
      const value = cond[op];
      switch (op) {
        case "$not": {
          if (!isOperatorObject(value)) fail("invalid_query", 422, { field: "filter" });
          const inner: OpCondition[] = [];
          for (const op2 of Object.keys(value)) {
            if (!FIELD_OPS.has(op2)) fail("unknown_operator", 422, { operator: op2 });
            inner.push(parseScalarOp(op2, value[op2]));
          }
          ops.push({ op: "$not", ops: inner });
          break;
        }
        case "$elemMatch":
          ops.push({ op: "$elemMatch", filter: parsePlan(value) });
          break;
        default:
          ops.push(parseScalarOp(op, value));
      }
    }
  } else {
    ops.push({ op: "$eq", value: cond as JsonValue });
  }
  return { kind: "field", path, parts, ops };
}

function parseScalarOp(op: string, value: unknown): OpCondition {
  switch (op) {
    case "$eq": case "$ne": case "$gt": case "$gte": case "$lt": case "$lte":
      return { op, value: value as JsonValue };
    case "$in": case "$nin":
      if (!Array.isArray(value)) fail("invalid_query", 422, { field: "filter" });
      return { op, values: value as JsonValue[] };
    case "$exists":
      if (typeof value !== "boolean") fail("invalid_query", 422, { field: "filter" });
      return { op: "$exists", flag: value };
    case "$size":
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) fail("invalid_query", 422, { field: "filter" });
      return { op: "$size", size: value };
    default:
      fail("unknown_operator", 422, { operator: op });
  }
}

/**
 * Candidates for one field condition: every value the path reaches, with the
 * elements of a final array value appended for any-element matching (DP-03).
 */
function candidates(doc: JsonObj, parts: string[]): (JsonValue | typeof MISSING)[] {
  const out: (JsonValue | typeof MISSING)[] = [];
  for (const v of pathFanout(doc, parts)) {
    out.push(v);
    if (Array.isArray(v)) out.push(...v);
  }
  if (out.length === 0) out.push(MISSING);
  return out;
}

export function matches(filter: FilterPlan, doc: JsonObj): boolean {
  for (const c of filter.conditions) {
    if (c.kind === "logical") {
      const results = c.filters.map(f => matches(f, doc));
      if (c.op === "$and" && !results.every(Boolean)) return false;
      if (c.op === "$or" && !results.some(Boolean)) return false;
      if (c.op === "$nor" && results.some(Boolean)) return false;
    } else if (!opsSatisfied(c, doc)) {
      return false;
    }
  }
  return true;
}

function opsSatisfied(c: FieldCondition, doc: JsonObj): boolean {
  const cands = candidates(doc, c.parts);
  return c.ops.every(op => opSatisfied(op, cands));
}

function opSatisfied(op: OpCondition, cands: (JsonValue | typeof MISSING)[]): boolean {
  switch (op.op) {
    case "$eq": return cands.some(v => eq(v, op.value));
    case "$ne": return !cands.some(v => eq(v, op.value));
    case "$in": return op.values.some(x => cands.some(v => eq(v, x)));
    case "$nin": return !op.values.some(x => cands.some(v => eq(v, x)));
    case "$gt": return cands.some(v => ordered(v, op.value, "gt"));
    case "$gte": return cands.some(v => ordered(v, op.value, "gte"));
    case "$lt": return cands.some(v => ordered(v, op.value, "lt"));
    case "$lte": return cands.some(v => ordered(v, op.value, "lte"));
    case "$exists":
      return op.flag ? cands.some(v => v !== MISSING) : cands.every(v => v === MISSING);
    case "$size":
      return cands.some(v => v !== MISSING && Array.isArray(v) && v.length === op.size);
    case "$elemMatch":
      return cands.some(v => {
        if (v === MISSING || !Array.isArray(v)) return false;
        return v.some(el => matchesElement(op.filter, el));
      });
    case "$not": return !op.ops.every(inner => opSatisfied(inner, cands));
  }
}

function matchesElement(filter: FilterPlan, el: JsonValue): boolean {
  if (typeof el !== "object" || el === null || Array.isArray(el) || isDateObject(el)) return false;
  return matches(filter, el as JsonObj);
}

/** Filter equality: null equals missing, numbers by value, dates by instant, objects and arrays by compact text. */
export function eq(a: JsonValue | typeof MISSING, b: JsonValue): boolean {
  if (a === MISSING) return b === null;
  if (isDateObject(a)) return isDateObject(b) && dateMs(a) === dateMs(b);
  if (isDateObject(b)) return false;
  if (a === null || b === null) return a === b;
  if (typeof a === "object" && typeof b === "object") return compactJson(a) === compactJson(b);
  return a === b;
}

/** Range comparison: only within one type class (DP-01). */
function ordered(a: JsonValue | typeof MISSING, b: JsonValue, dir: "gt" | "gte" | "lt" | "lte"): boolean {
  if (a === MISSING) return false;
  if (isDateObject(a)) {
    if (!isDateObject(b)) return false;
  } else if (isDateObject(b) || typeName(a) !== typeName(b)) {
    return false;
  }
  const cmp = compareValues(a, b);
  return dir === "gt" ? cmp > 0 : dir === "gte" ? cmp >= 0 : dir === "lt" ? cmp < 0 : cmp <= 0;
}

/** Sort spec: an ordered list of paths with direction (DP-10). */
export interface SortKey { path: string; dir: 1 | -1 }
export function parseSort(raw: unknown, stageIndex?: number): SortKey[] {
  const bad = (): never =>
    stageIndex !== undefined ? fail("invalid_stage", 422, { index: stageIndex }) : fail("invalid_query", 422, { field: "sort" });
  if (raw === null || raw === undefined) return [];
  if (typeof raw !== "object" || Array.isArray(raw)) bad();
  const obj = raw as JsonObj;
  const keys: SortKey[] = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v !== 1 && v !== -1) bad();
    keys.push({ path: k, dir: v as 1 | -1 });
  }
  if (depthOf(obj, 0) > QUERY_DEPTH_LIMIT) {
    if (stageIndex !== undefined) fail("invalid_stage", 422, { index: stageIndex });
    fail("query_too_deep", 422, { limit: QUERY_DEPTH_LIMIT });
  }
  return keys;
}
