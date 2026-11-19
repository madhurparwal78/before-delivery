// Narrowing of sheet shapes, pills, filters and query requests from request bodies. A malformed part is a 422 on its key.
import type {
  Agg,
  Cell,
  ChartChoice,
  DateLevel,
  Filter,
  FilterStep,
  MeasurePill,
  ParameterValue,
  Pill,
  QueryRequest,
  ReferenceLine,
  ReferenceLineType,
  SheetShape,
  SortMode,
  TableCalc,
  TableCalcKind,
  TableCalcUsing,
} from '../../shared/model.ts';
import { invalid } from '../http/errors.ts';
import { isObject, nonBlank } from '../http/validate.ts';
import type { JsonObject } from '../http/validate.ts';
import { NAME_REQUIRED } from '../projects/routes.ts';

/** A body part that does not have its shape: `key` is the `errors` key, `text` its message. */
export class Malformed extends Error {
  constructor(
    readonly key: string,
    readonly text: string,
  ) {
    super(text);
  }
}

/** Runs a parse and turns its first `Malformed` into the 422 the routes answer. */
export function parsed<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof Malformed) throw invalid({ [error.key]: error.text });
    throw error;
  }
}

const AGGS: readonly Agg[] = ['SUM', 'AVG', 'MEDIAN', 'MIN', 'MAX', 'COUNT', 'COUNT_UNIQUE'];
const LEVELS: readonly DateLevel[] = ['year', 'month', 'week', 'day'];
const CALC_KINDS: readonly TableCalcKind[] = ['run_total', 'prev_diff', 'share', 'rank'];
const CALC_USING: readonly TableCalcUsing[] = ['table_across', 'table_down', 'pane_down', 'chosen'];
export const STEPS: readonly FilterStep[] = ['source', 'context', 'dimension', 'top', 'measure', 'table_calc'];
const CHARTS: readonly ChartChoice[] = ['automatic', 'bar', 'line', 'scatter', 'text_table', 'heat_map'];
const LINE_TYPES: readonly ReferenceLineType[] = ['average', 'median', 'constant'];
const SORTS: readonly SortMode[] = ['asc', 'desc', 'measure'];

export function oneOf<T extends string>(list: readonly T[], value: unknown): T | null {
  return list.find((item) => item === value) ?? null;
}

function isCell(value: unknown): value is Cell {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

export function cells(value: unknown, key: string, text: string): Cell[] {
  if (!Array.isArray(value) || !value.every(isCell)) throw new Malformed(key, text);
  return value;
}

function numberOrNull(value: unknown, key: string, text: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Malformed(key, text);
  return value;
}

function tableCalc(value: unknown, key: string, text: string): TableCalc | null {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) throw new Malformed(key, text);
  const kind = oneOf(CALC_KINDS, value.kind);
  const using = oneOf(CALC_USING, value.using);
  const fields = value.fields ?? [];
  if (kind === null || using === null || !Array.isArray(fields)) throw new Malformed(key, text);
  return { kind, using, fields: fields.map((f) => fieldName(f, key, text)) };
}

function fieldName(value: unknown, key: string, text: string): string {
  const name = nonBlank(value);
  if (name === null) throw new Malformed(key, text);
  return name;
}

/** `{"field","agg","table_calc"}`. */
export function measurePill(value: unknown, key: string, text: string): MeasurePill {
  if (!isObject(value)) throw new Malformed(key, text);
  const agg = oneOf(AGGS, value.agg);
  if (agg === null) throw new Malformed(key, text);
  return { field: fieldName(value.field, key, text), agg, table_calc: tableCalc(value.table_calc, key, text) };
}

function pill(value: unknown, key: string, text: string): Pill {
  if (typeof value === 'string') return fieldName(value, key, text);
  if (isObject(value) && 'agg' in value) return measurePill(value, key, text);
  if (!isObject(value)) throw new Malformed(key, text);
  const level = oneOf(LEVELS, value.level);
  if (level === null) throw new Malformed(key, text);
  return { field: fieldName(value.field, key, text), level };
}

function pills(value: unknown, key: string, label: string): Pill[] {
  const text = `${label} must be a list of pills.`;
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Malformed(key, text);
  return value.map((p) => pill(p, key, text));
}

function onePill(value: unknown, key: string, label: string): Pill | null {
  if (value === undefined || value === null) return null;
  return pill(value, key, `${label} must hold one pill or none.`);
}

function flag(value: unknown, key: string, label: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new Malformed(key, `${label} must be true or false.`);
  return value;
}

const FILTERS_TEXT = 'Filters must be a list of filters.';

function filter(value: unknown, key: string): Filter {
  if (!isObject(value)) throw new Malformed(key, FILTERS_TEXT);
  const step = oneOf(STEPS, value.step);
  if (step === null) throw new Malformed(key, FILTERS_TEXT);
  const n = value.n ?? null;
  if (n !== null && typeof n !== 'string' && (typeof n !== 'number' || !Number.isFinite(n))) {
    throw new Malformed(key, FILTERS_TEXT);
  }
  const agg = value.agg ?? null;
  const parsedAgg = agg === null ? null : oneOf(AGGS, agg);
  if (agg !== null && parsedAgg === null) throw new Malformed(key, FILTERS_TEXT);
  return {
    field: fieldName(value.field, key, FILTERS_TEXT),
    step,
    values: value.values === undefined ? [] : cells(value.values, key, FILTERS_TEXT),
    n,
    by: value.by === undefined || value.by === null ? null : measurePill(value.by, key, FILTERS_TEXT),
    min: numberOrNull(value.min, key, FILTERS_TEXT),
    max: numberOrNull(value.max, key, FILTERS_TEXT),
    agg: parsedAgg,
    table_calc: tableCalc(value.table_calc, key, FILTERS_TEXT),
  };
}

export function filters(value: unknown, key = 'filters'): Filter[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Malformed(key, FILTERS_TEXT);
  return value.map((f) => filter(f, key));
}

function referenceLines(value: unknown): ReferenceLine[] {
  const text = 'Reference lines must be a list of average, median or constant lines.';
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Malformed('reference_lines', text);
  return value.map((line) => {
    if (!isObject(line)) throw new Malformed('reference_lines', text);
    const type = oneOf(LINE_TYPES, line.type);
    const parameter = line.parameter ?? null;
    if (type === null || (parameter !== null && nonBlank(parameter) === null)) {
      throw new Malformed('reference_lines', text);
    }
    return { type, value: numberOrNull(line.value, 'reference_lines', text), parameter: nonBlank(parameter) };
  });
}

function sort(value: unknown): Record<string, SortMode> {
  const text = 'Sort must map fields to asc, desc or measure.';
  if (value === undefined) return {};
  if (!isObject(value)) throw new Malformed('sort', text);
  const out: Record<string, SortMode> = {};
  for (const [field, mode] of Object.entries(value)) {
    const parsedMode = oneOf(SORTS, mode);
    if (parsedMode === null) throw new Malformed('sort', text);
    out[field] = parsedMode;
  }
  return out;
}

/** The sheet shape of a body. Missing parts take their empty value; a part of the wrong shape is a 422 on its key. */
export function sheetShape(body: JsonObject): SheetShape {
  const name = nonBlank(body.name);
  if (name === null) throw new Malformed('name', NAME_REQUIRED);
  const chart = body.chart === undefined ? 'automatic' : oneOf(CHARTS, body.chart);
  if (chart === null) throw new Malformed('chart', `Chart must be one of ${CHARTS.join(', ')}.`);
  return {
    name: name.trim(),
    rows: pills(body.rows, 'rows', 'Rows'),
    columns: pills(body.columns, 'columns', 'Columns'),
    color: onePill(body.color, 'color', 'Color'),
    size: onePill(body.size, 'size', 'Size'),
    label: pills(body.label, 'label', 'Label'),
    detail: pills(body.detail, 'detail', 'Detail'),
    filters: filters(body.filters),
    chart,
    totals: flag(body.totals, 'totals', 'Totals'),
    reference_lines: referenceLines(body.reference_lines),
    trend: flag(body.trend, 'trend', 'Trend'),
    sort: sort(body.sort),
  };
}

export function parameterValues(value: unknown): Record<string, ParameterValue> {
  const text = 'Parameters must map names to values.';
  if (value === undefined) return {};
  if (!isObject(value)) throw new Malformed('parameters', text);
  const out: Record<string, ParameterValue> = {};
  for (const [name, v] of Object.entries(value)) {
    if (typeof v !== 'string' && (typeof v !== 'number' || !Number.isFinite(v))) throw new Malformed('parameters', text);
    out[name] = v;
  }
  return out;
}

function setMembers(value: unknown): Record<string, Cell[]> {
  const text = 'Sets must map names to lists of members.';
  if (value === undefined) return {};
  if (!isObject(value)) throw new Malformed('sets', text);
  const out: Record<string, Cell[]> = {};
  for (const [name, members] of Object.entries(value)) out[name] = cells(members, 'sets', text);
  return out;
}

/** `{"filters","parameters","sets"}` of a query or an export. */
export function queryRequest(body: JsonObject): QueryRequest {
  return { filters: filters(body.filters), parameters: parameterValues(body.parameters), sets: setMembers(body.sets) };
}

/** The name and formula of a calculation body; anything that is not text is empty, which the engine reports. */
export function calculationFields(body: JsonObject): { name: string; formula: string } {
  return {
    name: typeof body.name === 'string' ? body.name : '',
    formula: typeof body.formula === 'string' ? body.formula : '',
  };
}

export function isMeasurePill(p: Pill): p is MeasurePill {
  return typeof p !== 'string' && 'agg' in p;
}

/** The field a pill names. */
export function pillField(p: Pill): string {
  return typeof p === 'string' ? p : p.field;
}
