import { calcRound, roundAway, displayNumber } from "../../shared/display.js";
import type { Node } from "../formula/parser.js";
import { isAggregateName, isTableCalcName } from "../formula/parser.js";
import { evalRow, type Value } from "../formula/evaluator.js";

export interface FieldDef {
  id: string;
  name: string;
  table: string;
  type: "number" | "text" | "date" | "boolean";
  kind: "dimension" | "measure";
  continuous: boolean;
  hidden: boolean;
  origin: {
    kind: "column" | "bin" | "group" | "calculation";
    field?: string;
    size?: number;
    groups?: { name: string; members: string[] }[];
  } | null;
}

export interface Pill {
  field: string;
  agg?: string;
  level?: "year" | "month" | "week" | "day";
  table_calc?: { kind: string; using: string; fields: string[] } | null;
}

export interface Filter {
  field: string;
  step: "source" | "context" | "dimension" | "top" | "measure" | "table_calc";
  values?: (string | number | null)[];
  n?: number | string;
  by?: { field: string; agg: string } | null;
  min?: number | null;
  max?: number | null;
  agg?: string;
  table_calc?: { kind: string; using: string; fields: string[] } | null;
}

export interface Row {
  values: Map<string, Value>;
}

export type AggFn = "SUM" | "AVG" | "MEDIAN" | "MIN" | "MAX" | "COUNT" | "COUNT_UNIQUE";

/** Convert a stored cell to a runtime value; dates become UTC milliseconds. */
export function cellValue(type: FieldDef["type"], raw: string | null): Value {
  if (raw === null) return null;
  if (type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (type === "date") {
    const t = Date.parse(raw);
    return Number.isNaN(t) ? null : t;
  }
  if (type === "boolean") {
    const l = raw.toLowerCase();
    if (l === "true" || l === "yes") return true;
    if (l === "false" || l === "no") return false;
    return null;
  }
  return raw;
}

function aggNumber(fn: AggFn, values: number[]): number | null {
  if (fn === "COUNT") return values.length;
  if (values.length === 0) return null;
  switch (fn) {
    case "SUM":
      return calcRound(values.reduce((a, b) => a + b, 0));
    case "AVG":
      return calcRound(values.reduce((a, b) => a + b, 0) / values.length);
    case "MEDIAN": {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      if (sorted.length % 2 === 1) return sorted[mid];
      return calcRound((sorted[mid - 1] + sorted[mid]) / 2);
    }
    case "MIN":
      return Math.min(...values);
    case "MAX":
      return Math.max(...values);
    case "COUNT_UNIQUE":
      return new Set(values).size;
  }
}

function aggValue(fn: AggFn, values: Value[]): Value {
  if (fn === "COUNT") return values.length;
  if (fn === "COUNT_UNIQUE") return new Set(values).size;
  if (values.length === 0) return null;
  const nonNull = values.filter((v) => v !== null);
  if (fn === "MIN" || fn === "MAX") {
    if (nonNull.length === 0) return null;
    const sorted = [...nonNull].sort((a, b) => compareValues(a, b));
    return fn === "MIN" ? sorted[0] : sorted[sorted.length - 1];
  }
  const nums = nonNull.filter((v) => typeof v === "number") as number[];
  if (fn === "MEDIAN") {
    return aggNumber("MEDIAN", nums);
  }
  return aggNumber(fn, nums);
}

export function compareValues(a: Value, b: Value): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b ? 0 : a ? 1 : -1;
  const as = String(a);
  const bs = String(b);
  if (as < bs) return -1;
  if (as > bs) return 1;
  return 0;
}

export function compareValuesDesc(a: Value, b: Value): number {
  return -compareValues(a, b);
}

/** Aggregate a measure over the underlying rows, ignoring nulls. */
export function aggregate(fn: AggFn, rows: Row[], fieldName: string, valueOf: (row: Row, field: string) => Value): Value {
  const values: Value[] = [];
  for (const r of rows) {
    values.push(valueOf(r, fieldName));
  }
  return aggValue(fn, values);
}

export { aggValue, aggNumber };

/** The dimensions and measure structure of a resolved view. */
export interface ResolvedMeasure {
  caption: string;
  field: string;
  agg: AggFn;
  tableCalc: { kind: string; using: string; fields: string[] } | null;
  share: boolean;
}

export function makeResolvedMeasure(field: string, agg: AggFn, tableCalc: { kind: string; using: string; fields: string[] } | null): ResolvedMeasure {
  let base = agg === "SUM" ? field : `${agg} ${field}`;
  let share = false;
  if (tableCalc) {
    if (tableCalc.kind === "run_total") base = `Running total of ${base}`;
    else if (tableCalc.kind === "prev_diff") base = `Difference from previous of ${base}`;
    else if (tableCalc.kind === "share") {
      base = `Percent of total of ${base}`;
      share = true;
    } else if (tableCalc.kind === "rank") base = `Rank of ${base}`;
  }
  return { caption: base, field, agg, tableCalc, share };
}

export function formatMeasureValue(m: ResolvedMeasure, v: Value): string {
  if (v === null) return "(null)";
  if (m.share) {
    const pct = roundAway(v as number, 1);
    return `${pct}%`;
  }
  return displayNumber(v as number);
}
