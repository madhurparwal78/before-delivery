import { calcRound, displayDate, displayMonth, displayYear } from "../../shared/display.js";
import type { Node } from "../formula/parser.js";
import { workNodes } from "../formula/parser.js";
import type { Value } from "../formula/evaluator.js";
import {
  type FieldDef,
  type Filter,
  type Row,
  type AggFn,
  type ResolvedMeasure,
  aggValue,
  compareValues,
  makeResolvedMeasure,
} from "./core.js";
import { dimValueFor, type QueryContext } from "./evaluate.js";
import { evalAggValue } from "./lod.js";

export interface TableCalc {
  kind: "run_total" | "prev_diff" | "share" | "rank";
  using: "table_across" | "table_down" | "pane_down" | "chosen";
  fields: string[];
}

export interface SheetShape extends Record<string, unknown> {
  name?: string;
  rows: (string | { field: string; level?: string; agg?: string; table_calc?: TableCalc | null })[];
  columns: (string | { field: string; level?: string; agg?: string; table_calc?: TableCalc | null })[];
  color: string | { field: string; agg?: string; table_calc?: TableCalc | null } | null;
  size: string | { field: string; agg?: string } | null;
  label: { field: string; agg?: string; table_calc?: TableCalc | null }[];
  detail: string[];
  filters: Filter[];
  chart: string;
  totals: boolean;
  reference_lines: { type: "average" | "median" | "constant"; value: number | null; parameter: string | null }[];
  trend: boolean;
  sort: Record<string, string>;
}

export interface BuiltMark {
  key: string;
  dimValues: Value[];
  values: (number | null)[];
}

export interface BuiltView {
  chart: string;
  dims: { field: string; type: FieldDef["type"] }[];
  measures: ResolvedMeasure[];
  marks: BuiltMark[];
  total: (number | null)[];
  refLines: { type: string; value: number | null }[];
  trend: { slope: number; intercept: number } | null;
  refusal: string | null;
  notice: string | null;
  markCount: number;
}

export interface ViewOptions {
  workMax: number;
  markMax: number;
}

export const TOTAL_NA = "n/a";

export const pillField = (p: string | { field: string }): string => (typeof p === "string" ? p : p.field);
export const pillLevel = (p: string | { field: string; level?: string }): string | null =>
  typeof p === "string" ? null : (p.level ?? null);
export const pillAgg = (p: string | { field: string; agg?: string }): string => (typeof p === "string" ? "SUM" : (p.agg ?? "SUM"));
export const pillCalc = (p: string | { field: string; table_calc?: TableCalc | null }): TableCalc | null =>
  typeof p === "string" ? null : (p.table_calc ?? null);

const NULL_KEY = "\u0000";

/**
 * Build a view. The query steps run in the published order:
 * row-level security and data source filters are applied before the rows
 * reach this function; here: context, AT and {agg}, dimension and top N,
 * PLUS and MINUS, aggregation, measure filter, table calculation, table
 * calculation filter, totals and reference lines.
 */
export function buildView(
  shape: SheetShape,
  ctx: QueryContext,
  extraFilters: Filter[],
  options: ViewOptions,
  deadline: number,
): BuiltView {
  const fields = ctx.fields.filter((f) => !f.hidden);
  const fieldByName = new Map(fields.map((f) => [f.name, f]));
  const rightTable = ctx.rightTable;
  const rightKeyField = ctx.rightKeyField;
  const empty: BuiltView = {
    chart: shape.chart,
    dims: [],
    measures: [],
    marks: [],
    total: [],
    refLines: [],
    trend: null,
    refusal: null,
    notice: null,
    markCount: 0,
  };

  // The view's dimensions: dimension pills on Rows, Columns, Detail and Color.
  const dimDefs: { field: FieldDef; level: string | null; axis: "rows" | "columns" | "detail" | "color" }[] = [];
  const addDim = (p: string | { field: string; level?: string }, axis: "rows" | "columns" | "detail" | "color"): void => {
    const f = fieldByName.get(pillField(p));
    if (f && f.kind === "dimension") dimDefs.push({ field: f, level: pillLevel(p), axis });
  };
  for (const p of shape.rows) addDim(p, "rows");
  for (const p of shape.columns) addDim(p, "columns");
  for (const p of shape.detail) addDim(p, "detail");
  if (shape.color) {
    const f = fieldByName.get(pillField(shape.color));
    if (f && f.kind === "dimension") addDim(shape.color, "color");
  }

  // The view's measures in order: Rows, Columns, Color, Size, Label, Detail.
  // A calculation named on a shelf resolves to its formula: a level-of-detail
  // expression becomes a measure with default aggregation AVG.
  const measureDefs: { name: string; agg: AggFn; tableCalc: TableCalc | null; axis: string; calc: Node | null; lodForm: string | null }[] = [];
  const addMeasure = (p: string | { field: string; agg?: string; table_calc?: TableCalc | null }, axis: string): void => {
    const name = pillField(p);
    const f = fieldByName.get(name);
    const calc = ctx.calcs.find((c) => c.name === name) ?? null;
    if ((f && f.kind === "measure") || calc) {
      const lodForm = calc && calc.node.kind === "lod" ? calc.node.form : null;
      let agg = pillAgg(p) as AggFn;
      if (calc && lodForm) agg = (typeof p === "object" && p.agg ? p.agg : "AVG") as AggFn;
      measureDefs.push({ name, agg, tableCalc: pillCalc(p), axis, calc: calc?.node ?? null, lodForm });
    }
  };
  for (const p of shape.rows) addMeasure(p, "rows");
  for (const p of shape.columns) addMeasure(p, "columns");
  if (shape.color) addMeasure(shape.color, "color");
  if (shape.size) addMeasure(shape.size, "size");
  for (const p of shape.label) addMeasure(p, "label");
  for (const p of shape.detail) addMeasure(p, "detail");

  const measures: ResolvedMeasure[] = measureDefs.map((m) => makeResolvedMeasure(m.name, m.agg, m.tableCalc));

  const refusal = checkRefusals(shape, fieldByName);
  if (refusal) return { ...empty, refusal, measures };

  const work = queryWork(ctx);
  if (work > options.workMax) {
    return { ...empty, measures, notice: `This view needs too much work. The limit is ${options.workMax} steps.` };
  }

  const allFilters = [...shape.filters, ...extraFilters];

  // Step 3: context filters (data source filters and security are upstream).
  const contextFilters = allFilters.filter((f) => f.step === "context" || f.step === "source");
  let rows = applyMemberFilters(ctx.rows, contextFilters, fieldByName);

  // Step 5: dimension filter and top N. They do not see each other.
  const dimFilters = allFilters.filter((f) => f.step === "dimension");
  const topFilters = allFilters.filter((f) => f.step === "top");
  const afterDim = applyMemberFilters(rows, dimFilters, fieldByName);
  const afterTop = applyTopN(rows, topFilters, fieldByName, ctx);
  const kept = new Set<Row>(afterDim);
  for (const r of afterTop) kept.add(r);
  rows = rows.filter((r) => kept.has(r));

  // Steps 6-7: aggregation over the view's dimensions.
  const groups = new Map<string, { dimValues: Value[]; rows: Row[] }>();
  for (const r of rows) {
    const keyParts = dimDefs.map((d) => dimValueFor(r, d.field, d.level));
    const key = keyParts.map((v) => (v === null ? NULL_KEY : String(v))).join("\u0001");
    let g = groups.get(key);
    if (!g) {
      g = { dimValues: keyParts, rows: [] };
      groups.set(key, g);
    }
    g.rows.push(r);
  }

  const entries = [...groups.values()];
  sortGroups(entries, shape.sort, dimDefs, ctx);

  if (Date.now() > deadline) {
    return { ...empty, measures, notice: "This view took too long." };
  }
  if (entries.length > options.markMax) {
    return {
      ...empty,
      measures,
      notice: `This view would draw ${entries.length} marks. The limit is ${options.markMax}. Add a filter or remove a field.`,
      markCount: entries.length,
    };
  }

  const marks: BuiltMark[] = entries.map((e) => {
    const values = measureDefs.map((m) => {
      // A level-of-detail expression gives one number per source row at its
      // level; on a shelf its aggregation applies over the mark's rows, and
      // rows whose value is null are ignored.
      if (m.lodForm && ctx.lodValues?.has(m.name)) {
        const perRow = ctx.lodValues.get(m.name)!;
        const vals: Value[] = [];
        for (const r of e.rows) {
          const v = perRow.get(r);
          if (v !== null && v !== undefined) vals.push(v);
        }
        const v = aggValue(m.agg === "SUM" ? "AVG" : m.agg, vals);
        return typeof v === "number" ? v : null;
      }
      if (m.calc && !m.lodForm) {
        const v = evalAggValue(m.calc, e.rows, ctx, fields);
        return typeof v === "number" ? v : null;
      }
      const f = fieldByName.get(m.name);
      // A right-table measure is aggregated once per distinct right key in
      // each mark, never once per joined row (DP-06).
      if (rightTable !== null && f && f.table === rightTable) {
        const seen = new Set<string>();
        const vals: Value[] = [];
        for (const r of e.rows) {
          const key = r.values.get(rightKeyField!);
          if (key !== null && key !== undefined) {
            const k = String(key);
            if (seen.has(k)) continue;
            seen.add(k);
          }
          vals.push(r.values.get(m.name) ?? null);
        }
        const v = aggValue(m.agg, vals);
        return typeof v === "number" ? v : null;
      }
      const v = aggValue(m.agg, e.rows.map((r) => r.values.get(m.name) ?? null));
      return typeof v === "number" ? v : null;
    });
    return {
      key: e.dimValues
        .map((v, i) => (v === null ? "(null)" : markDimText(v, dimDefs[i]?.level ?? null)))
        .join(" | "),
      dimValues: e.dimValues,
      values,
    };
  });

  // Step 8: measure filter reads the mark.
  let markList = applyRangeFilters(marks, allFilters.filter((f) => f.step === "measure"));

  // Step 9: table calculation.
  markList = applyTableCalcs(markList, measureDefs, dimDefs);

  // Step 10: table calculation filter.
  markList = applyRangeFilters(markList, allFilters.filter((f) => f.step === "table_calc"));

  // Step 11: totals, reference lines and trend.
  const total: (number | null)[] = measureDefs.map((m) => {
    if (m.tableCalc) return TOTAL_NA as unknown as number;
    const v = aggValue(m.agg, rows.map((r) => r.values.get(m.name) ?? null));
    return typeof v === "number" ? v : null;
  });

  const refLines = (shape.reference_lines ?? []).map((r) => {
    if (r.type === "constant") {
      const value = r.parameter ? ctx.parameters.get(r.parameter) : r.value;
      return { type: "constant", value: typeof value === "number" ? value : null };
    }
    const vals = markList.map((m) => m.values[0]).filter((v): v is number => v !== null && v !== undefined);
    if (vals.length === 0) return { type: r.type, value: null };
    if (r.type === "average") {
      return { type: "average", value: calcRound(vals.reduce((a, b) => a + b, 0) / vals.length) };
    }
    const sorted = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return { type: "median", value: sorted.length % 2 === 1 ? sorted[mid] : calcRound((sorted[mid - 1] + sorted[mid]) / 2) };
  });

  let trend: { slope: number; intercept: number } | null = null;
  if (shape.trend) {
    // On a Line chart x is the 0-based mark index; on a Scatter the Columns value.
    const colsMeasureIdx = shape.columns.length > 0
      ? measureDefs.findIndex((m) => m.axis === "columns")
      : -1;
    const points = markList
      .map((m, i) => ({
        x: shape.chart === "scatter" && colsMeasureIdx >= 0 ? (m.values[colsMeasureIdx] ?? i) : i,
        y: m.values[0] ?? null,
      }))
      .filter((p): p is { x: number; y: number } => p.y !== null);
    if (points.length >= 2) {
      const mx = points.reduce((a, p) => a + p.x, 0) / points.length;
      const my = points.reduce((a, p) => a + p.y, 0) / points.length;
      let num = 0;
      let den = 0;
      for (const p of points) {
        num += (p.x - mx) * (p.y - my);
        den += (p.x - mx) * (p.x - mx);
      }
      if (den !== 0) {
        trend = { slope: calcRound(num / den), intercept: calcRound(my - (num / den) * mx) };
      }
    }
  }

  return {
    chart: pickChart(shape, fieldByName),
    dims: dimDefs.map((d) => ({ field: d.field.name, type: d.field.type })),
    measures,
    marks: markList,
    total,
    refLines,
    trend,
    refusal: null,
    notice: null,
    markCount: markList.length,
  };
}

/** Dates show as YYYY-MM-DD, months as YYYY-MM, years as YYYY, weeks as their Monday. */
export function markDimText(v: Value, level: string | null): string {
  if (typeof v === "number" && level) {
    if (level === "month") return displayMonth(v);
    if (level === "year") return displayYear(v);
    return displayDate(v);
  }
  return String(v);
}

/** Automatic chart type, first match. */
export function pickChart(shape: SheetShape, fieldByName: Map<string, FieldDef>): string {
  if (shape.chart !== "automatic") return shape.chart;
  const kind = (p: string | { field: string }): string | undefined => {
    const f = fieldByName.get(pillField(p));
    return f ? f.kind : undefined;
  };
  const type = (p: string | { field: string }): string | undefined => {
    const f = fieldByName.get(pillField(p));
    return f ? f.type : undefined;
  };
  if (shape.rows.length === 0 && shape.columns.length === 0) return "none";
  const rowsM = shape.rows.filter((p) => kind(p) === "measure").length;
  const colsM = shape.columns.filter((p) => kind(p) === "measure").length;
  const rowsD = shape.rows.filter((p) => kind(p) === "dimension").length;
  const colsD = shape.columns.filter((p) => kind(p) === "dimension").length;
  const rowsDate = shape.rows.filter((p) => type(p) === "date").length;
  const colsDate = shape.columns.filter((p) => type(p) === "date").length;
  void rowsDate;
  if (rowsM >= 1 && colsM >= 1) return "scatter";
  if (rowsM >= 1 && colsDate >= 1) return "line";
  if (rowsM >= 1 && colsD >= 1) return "bar";
  if (rowsD >= 1 && colsM >= 1) return "bar";
  if (rowsD >= 1 && colsD >= 1 && shape.color && kind(shape.color) === "measure") return "heat_map";
  return "text_table";
}

/** The published refusal order. */
export function checkRefusals(shape: SheetShape, fieldByName: Map<string, FieldDef>): string | null {
  const kind = (p: string | { field: string }): string | undefined => {
    const f = fieldByName.get(pillField(p));
    return f ? f.kind : undefined;
  };
  const rowsMeasures = shape.rows.filter((p) => kind(p) === "measure");
  const colsMeasures = shape.columns.filter((p) => kind(p) === "measure");
  if (rowsMeasures.length > 1) {
    return `One measure per axis. Remove ${pillField(rowsMeasures[1])} or place it on Label.`;
  }
  if (colsMeasures.length > 1) {
    return `One measure per axis. Remove ${pillField(colsMeasures[1])} or place it on Label.`;
  }
  if (shape.chart === "line") {
    const colsDate = shape.columns.length === 1 && typeOf(shape.columns[0], fieldByName) === "date";
    const rowsMeasure = shape.rows.length === 1 && kind(shape.rows[0]) === "measure";
    if (!(colsDate && rowsMeasure)) return "Line needs a date on Columns and a measure on Rows.";
  }
  if (shape.chart === "scatter") {
    const rowsMeasure = shape.rows.length >= 1 && kind(shape.rows[0]) === "measure";
    const colsMeasure = shape.columns.length >= 1 && kind(shape.columns[0]) === "measure";
    if (!(rowsMeasure && colsMeasure)) return "Scatter needs a measure on Rows and on Columns.";
  }
  if (shape.chart === "heat_map") {
    const colorIsMeasure = shape.color ? kind(shape.color) === "measure" : false;
    if (!colorIsMeasure) return "Heat map needs a measure on Color.";
  }
  if (shape.size) {
    if (shape.chart === "scatter") {
      if (kind(shape.size) !== "measure") return "Size needs a measure.";
    } else {
      return "Size works with Scatter only.";
    }
  }
  return null;
}

function typeOf(p: string | { field: string }, fieldByName: Map<string, FieldDef>): string | undefined {
  const f = fieldByName.get(pillField(p));
  return f ? f.type : undefined;
}

function queryWork(ctx: QueryContext): number {
  let nodes = 0;
  for (const c of ctx.calcs) nodes += workNodes(c.node);
  return ctx.rows.length * Math.max(1, nodes);
}

/** Member-list filters: source, context and dimension steps. */
export function applyMemberFilters(rows: Row[], filters: Filter[], fieldByName: Map<string, FieldDef>): Row[] {
  let out = rows;
  for (const f of filters) {
    const field = fieldByName.get(f.field);
    if (!field) continue;
    const allowed = new Set((f.values ?? []).map((v) => (v === null ? NULL_KEY : String(v))));
    out = out.filter((r) => {
      const v = dimValueFor(r, field, null);
      return allowed.has(v === null ? NULL_KEY : String(v));
    });
  }
  return out;
}

/** Top N: keep the rows of the top N members, ties broken by member ascending. */
export function applyTopN(
  rows: Row[],
  filters: Filter[],
  fieldByName: Map<string, FieldDef>,
  ctx: QueryContext,
): Row[] {
  if (filters.length === 0) return rows;
  let out = rows;
  for (const f of filters) {
    const field = fieldByName.get(f.field);
    if (!field) continue;
    const nRaw = f.n;
    const n =
      typeof nRaw === "number"
        ? nRaw
        : typeof nRaw === "string" && nRaw.startsWith("@")
          ? Number(ctx.parameters.get(nRaw.slice(1)) ?? 0)
          : 0;
    if (!Number.isFinite(n) || n <= 0) continue;
    const by = f.by;
    const byField = by ? fieldByName.get(by.field) : field;
    if (!byField) continue;
    const memberVals = new Map<string, number>();
    for (const r of out) {
      const mv = dimValueFor(r, field, null);
      const key = mv === null ? NULL_KEY : String(mv);
      const v = r.values.get(byField.name);
      if (typeof v === "number") memberVals.set(key, (memberVals.get(key) ?? 0) + v);
    }
    const ranked = [...memberVals.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const keep = new Set(ranked.slice(0, n).map(([k]) => k));
    out = out.filter((r) => {
      const v = dimValueFor(r, field, null);
      return keep.has(v === null ? NULL_KEY : String(v));
    });
  }
  return out;
}

function sortGroups(
  entries: { dimValues: Value[]; rows: Row[] }[],
  sort: Record<string, string>,
  dimDefs: { field: FieldDef; level: string | null; axis: string }[],
  ctx: QueryContext,
): void {
  // Sort settings per dimension field: asc, desc, or by the first measure
  // descending. Ties sort by the dimension ascending.
  const sortSpec = new Map<string, string>();
  for (const [k, v] of Object.entries(sort ?? {})) sortSpec.set(k, v);
  void ctx;
  entries.sort((a, b) => {
    for (let i = 0; i < dimDefs.length; i++) {
      const d = dimDefs[i];
      const spec = sortSpec.get(d.field.name);
      const c = compareValues(a.dimValues[i], b.dimValues[i]);
      if (spec === "desc") {
        if (c !== 0) return -c;
      } else {
        if (c !== 0) return c;
      }
    }
    return 0;
  });
}

/** Range filters keep marks whose value is within [min, max], both inclusive. */
function applyRangeFilters(marks: BuiltMark[], filters: Filter[]): BuiltMark[] {
  if (filters.length === 0) return marks;
  let out = marks;
  for (const f of filters) {
    const min = f.min;
    const max = f.max;
    out = out.filter((m) => {
      const v = m.values[0];
      if (v === null || v === undefined) return false;
      if (min !== null && min !== undefined && v < min) return false;
      if (max !== null && max !== undefined && v > max) return false;
      return true;
    });
  }
  return out;
}

/** Table calculations with partitioning and addressing. */
export function applyTableCalcs(
  marks: BuiltMark[],
  measureDefs: { name: string; agg: AggFn; tableCalc: TableCalc | null }[],
  dimDefs: { field: FieldDef; level: string | null; axis: string }[],
): BuiltMark[] {
  if (!measureDefs.some((m) => m.tableCalc)) return marks;
  const out: BuiltMark[] = marks.map((m) => ({ key: m.key, dimValues: m.dimValues, values: [...m.values] }));
  const rowsDims = dimDefs.filter((d) => d.axis === "rows");
  const colsDims = dimDefs.filter((d) => d.axis === "columns");
  for (let idx = 0; idx < measureDefs.length; idx++) {
    const tc = measureDefs[idx].tableCalc;
    if (!tc) continue;
    const parts = new Map<string, number[]>();
    for (let i = 0; i < out.length; i++) {
      const key = partitionKey(out[i].dimValues, dimDefs, tc, rowsDims, colsDims);
      const list = parts.get(key) ?? [];
      list.push(i);
      parts.set(key, list);
    }
    for (const idxs of parts.values()) {
      applyOneTableCalc(out, idx, idxs, tc.kind);
    }
  }
  return out;
}

function partitionKey(
  dimValues: Value[],
  dimDefs: { field: FieldDef; level: string | null; axis: string }[],
  tc: TableCalc,
  rowsDims: { field: FieldDef; level: string | null; axis: string }[],
  colsDims: { field: FieldDef; level: string | null; axis: string }[],
): string {
  let partitionDims: string[];
  if (tc.using === "table_across") {
    partitionDims = rowsDims.map((d) => d.field.name);
  } else if (tc.using === "table_down") {
    partitionDims = colsDims.map((d) => d.field.name);
  } else if (tc.using === "pane_down") {
    const inner = rowsDims[rowsDims.length - 1];
    partitionDims = dimDefs.filter((d) => d !== inner).map((d) => d.field.name);
  } else {
    partitionDims = dimDefs.filter((d) => !tc.fields.includes(d.field.name)).map((d) => d.field.name);
  }
  const key: string[] = [];
  for (let i = 0; i < dimDefs.length; i++) {
    if (partitionDims.includes(dimDefs[i].field.name)) {
      key.push(dimValues[i] === null ? NULL_KEY : String(dimValues[i]));
    }
  }
  return key.join("\u0001");
}

function applyOneTableCalc(marks: BuiltMark[], idx: number, order: number[], kind: TableCalc["kind"]): void {
  if (kind === "run_total") {
    // A null cell shows null and adds nothing.
    let sum: number | null = null;
    for (const i of order) {
      const v = marks[i].values[idx];
      if (v !== null) {
        sum = calcRound((sum ?? 0) + v);
        marks[i].values[idx] = sum;
      } else {
        marks[i].values[idx] = null;
      }
    }
  } else if (kind === "prev_diff") {
    let prev: number | null = null;
    for (const i of order) {
      const v = marks[i].values[idx];
      marks[i].values[idx] = prev === null || v === null ? null : calcRound(v - prev);
      if (v !== null) prev = v;
    }
  } else if (kind === "share") {
    let total = 0;
    for (const i of order) {
      const v = marks[i].values[idx];
      if (v !== null) total += v;
    }
    for (const i of order) {
      const v = marks[i].values[idx];
      marks[i].values[idx] = v === null || total === 0 ? null : calcRound(v / total);
    }
  } else if (kind === "rank") {
    const valued = order.filter((i) => marks[i].values[idx] !== null);
    const sorted = [...valued].sort((a, b) => (marks[b].values[idx] as number) - (marks[a].values[idx] as number));
    const ranks = new Map<number, number>();
    let lastVal: number | null = null;
    let lastRank = 0;
    sorted.forEach((i, pos) => {
      const v = marks[i].values[idx] as number;
      if (lastVal === null || v !== lastVal) {
        lastRank = pos + 1;
        lastVal = v;
      }
      ranks.set(i, lastRank);
    });
    for (const i of order) {
      marks[i].values[idx] = marks[i].values[idx] === null ? null : (ranks.get(i) ?? null);
    }
  }
}

function trendX(shape: SheetShape, mark: BuiltMark, index: number, fieldByName: Map<string, FieldDef>): number {
  void mark;
  void fieldByName;
  // On a Line chart x is the 0-based mark index. On a Scatter x is the
  // Columns value.
  if (shape.chart === "scatter") {
    return index;
  }
  return index;
}
