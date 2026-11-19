import { calcRound } from "../../shared/display.js";
import type { Node } from "../formula/parser.js";
import { isAggregateName, isTableCalcName } from "../formula/parser.js";
import { evalRow, type Value } from "../formula/evaluator.js";
import {
  type FieldDef,
  type Filter,
  type Row,
  type AggFn,
  aggValue,
  compareValues,
} from "./core.js";

export interface QueryContext {
  fields: FieldDef[];
  calcs: { name: string; node: Node }[];
  parameters: Map<string, Value>;
  sets: Map<string, { field: string; members: Value[] | null; top: { n: number | string; by: { field: string; agg: string } | null } | null }>;
  rows: Row[];
  /** The right table's name when the source relates two tables. */
  rightTable: string | null;
  /** The right key field name used by the relation. */
  rightKeyField: string | null;
  /** LOD precomputed values per calculation name. */
  lodValues?: Map<string, Map<Row, number | null>>;
}

const DAY_MS = 86400000;

/** The value a dimension holds for one row: fields, date levels, bins and groups. */
export function dimValueFor(row: Row, field: FieldDef, level: string | null): Value {
  if (field.type === "date" && level) {
    const ms = row.values.get(field.name);
    if (ms === null || ms === undefined || typeof ms !== "number") return null;
    return dateLevelValue(ms, level);
  }
  if (field.origin?.kind === "bin" && field.type === "number") {
    const v = row.values.get(field.name);
    if (v === null || v === undefined || typeof v !== "number") return null;
    const size = field.origin.size ?? 1;
    const start = Math.floor(v / size) * size;
    return `${start} to ${start + size - 1}`;
  }
  if (field.origin?.kind === "group") {
    const v = row.values.get(field.name);
    if (v === null || v === undefined) return null;
    const groups = field.origin.groups ?? [];
    for (const g of groups) {
      if (g.members.map(String).includes(String(v))) return g.name;
    }
    return v;
  }
  const v = row.values.get(field.name);
  return v === undefined ? null : v;
}

/** Date levels in UTC; weeks start on Monday. */
export function dateLevelValue(ms: number, level: string): number {
  const d = new Date(ms);
  if (level === "year") return Date.UTC(d.getUTCFullYear(), 0, 1);
  if (level === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  if (level === "week") {
    const day = d.getUTCDay();
    const back = (day + 6) % 7;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back);
  }
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export { evalRow, aggValue, compareValues, calcRound, isAggregateName, isTableCalcName, DAY_MS };
export type { Value } from "../formula/evaluator.js";
export type { Row, FieldDef, Filter, AggFn, ResolvedMeasure } from "./core.js";
