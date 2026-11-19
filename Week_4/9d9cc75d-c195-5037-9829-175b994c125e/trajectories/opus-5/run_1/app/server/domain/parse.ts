import { arr, asObject, bool, int, str } from '../http.js';
import type {
  Agg,
  ChartType,
  DashboardAction,
  DateLevel,
  FilterSpec,
  LayoutNode,
  MeasurePill,
  Pill,
  ReferenceLineSpec,
  SheetSpec,
  TableCalcSpec,
} from '../../shared/types.js';

const AGGS: Agg[] = ['SUM', 'AVG', 'MEDIAN', 'MIN', 'MAX', 'COUNT', 'COUNT_UNIQUE'];
const LEVELS: DateLevel[] = ['year', 'month', 'week', 'day'];
const CHARTS: ChartType[] = ['automatic', 'bar', 'line', 'scatter', 'text_table', 'heat_map'];
const CALC_KINDS: TableCalcSpec['kind'][] = ['run_total', 'prev_diff', 'share', 'rank'];
const USINGS: TableCalcSpec['using'][] = ['table_across', 'table_down', 'pane_down', 'chosen'];
const STEPS: FilterSpec['step'][] = ['source', 'context', 'dimension', 'top', 'measure', 'table_calc'];

function parseTableCalc(value: unknown): TableCalcSpec | null {
  if (value === null || value === undefined) return null;
  const obj = asObject(value);
  const kind = str(obj.kind) as TableCalcSpec['kind'] | null;
  const using = str(obj.using) as TableCalcSpec['using'] | null;
  if (kind === null || !CALC_KINDS.includes(kind)) return null;
  return {
    kind,
    using: using !== null && USINGS.includes(using) ? using : 'table_across',
    fields: arr(obj.fields).filter((f): f is string => typeof f === 'string'),
  };
}

export function parseMeasurePill(value: unknown): MeasurePill | null {
  const obj = asObject(value);
  const field = str(obj.field);
  const agg = str(obj.agg) as Agg | null;
  if (field === null) return null;
  return {
    field,
    agg: agg !== null && AGGS.includes(agg) ? agg : 'SUM',
    table_calc: parseTableCalc(obj.table_calc),
  };
}

export function parsePill(value: unknown): Pill | null {
  if (typeof value === 'string') return value;
  const obj = asObject(value);
  if ('agg' in obj) return parseMeasurePill(value);
  const field = str(obj.field);
  if (field === null) return null;
  const level = str(obj.level) as DateLevel | null;
  if (level !== null && LEVELS.includes(level)) return { field, level };
  return field;
}

function parsePills(value: unknown): Pill[] {
  return arr(value)
    .map(parsePill)
    .filter((p): p is Pill => p !== null);
}

export function parseFilter(value: unknown): FilterSpec | null {
  const obj = asObject(value);
  const field = str(obj.field);
  const step = str(obj.step) as FilterSpec['step'] | null;
  if (field === null || step === null || !STEPS.includes(step)) return null;
  const n = typeof obj.n === 'number' ? obj.n : typeof obj.n === 'string' ? obj.n : null;
  const level = str(obj.level) as DateLevel | null;
  return {
    field,
    step,
    values: 'values' in obj ? arr(obj.values) : [],
    n,
    by: 'by' in obj && obj.by !== null ? parseMeasurePill(obj.by) : null,
    min: int(obj.min),
    max: int(obj.max),
    agg: (str(obj.agg) as Agg | null) ?? null,
    table_calc: parseTableCalc(obj.table_calc),
    level: level !== null && LEVELS.includes(level) ? level : null,
  };
}

export function parseFilters(value: unknown): FilterSpec[] {
  return arr(value)
    .map(parseFilter)
    .filter((f): f is FilterSpec => f !== null);
}

function parseReferenceLines(value: unknown): ReferenceLineSpec[] {
  return arr(value)
    .map((item) => {
      const obj = asObject(item);
      const type = str(obj.type);
      if (type !== 'average' && type !== 'median' && type !== 'constant') return null;
      return { type, value: int(obj.value), parameter: str(obj.parameter) };
    })
    .filter((l): l is ReferenceLineSpec => l !== null);
}

export function parseSheetSpec(body: Record<string, unknown>): SheetSpec {
  const chart = str(body.chart) as ChartType | null;
  const sort: Record<string, 'asc' | 'desc' | 'measure'> = {};
  for (const [field, mode] of Object.entries(asObject(body.sort))) {
    if (mode === 'asc' || mode === 'desc' || mode === 'measure') sort[field] = mode;
  }
  const colorPill = body.color === null || body.color === undefined ? null : parsePill(body.color);
  const sizePill = body.size === null || body.size === undefined ? null : parsePill(body.size);
  return {
    name: (str(body.name) ?? '').trim(),
    rows: parsePills(body.rows),
    columns: parsePills(body.columns),
    color: colorPill,
    size: sizePill,
    label: parsePills(body.label),
    detail: parsePills(body.detail),
    filters: parseFilters(body.filters),
    chart: chart !== null && CHARTS.includes(chart) ? chart : 'automatic',
    totals: bool(body.totals) ?? false,
    reference_lines: parseReferenceLines(body.reference_lines),
    trend: bool(body.trend) ?? false,
    sort,
  };
}

export function parseParameterOverrides(value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, v] of Object.entries(asObject(value))) out[name] = v;
  return out;
}

export function parseSetOverrides(value: unknown): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const [name, v] of Object.entries(asObject(value))) out[name] = arr(v);
  return out;
}

export function parseLayout(value: unknown): LayoutNode {
  const obj = asObject(value);
  const sheet = str(obj.sheet);
  if (sheet !== null) return { sheet, fixed: int(obj.fixed) };
  const type = str(obj.type);
  return {
    type: type === 'vertical' ? 'vertical' : 'horizontal',
    children: arr(obj.children).map(parseLayout),
    fixed: int(obj.fixed),
  };
}

export function parseActions(value: unknown): DashboardAction[] {
  return arr(value)
    .map((item) => {
      const obj = asObject(item);
      const name = (str(obj.name) ?? '').trim();
      const type = str(obj.type);
      const source = str(obj.source);
      if (name === '' || source === null) return null;
      if (type !== 'filter' && type !== 'highlight' && type !== 'set_parameter' && type !== 'change_set') return null;
      return {
        name,
        type,
        source,
        targets: arr(obj.targets).filter((t): t is string => typeof t === 'string'),
        field: str(obj.field) ?? '',
        parameter: str(obj.parameter),
        set: str(obj.set),
      };
    })
    .filter((a): a is DashboardAction => a !== null);
}

export function parseFloating(value: unknown): { sheet: string; x: number; y: number; w: number; h: number }[] {
  return arr(value)
    .map((item) => {
      const obj = asObject(item);
      const sheet = str(obj.sheet);
      if (sheet === null) return null;
      return {
        sheet,
        x: int(obj.x) ?? 0,
        y: int(obj.y) ?? 0,
        w: int(obj.w) ?? 0,
        h: int(obj.h) ?? 0,
      };
    })
    .filter((f): f is { sheet: string; x: number; y: number; w: number; h: number } => f !== null);
}
