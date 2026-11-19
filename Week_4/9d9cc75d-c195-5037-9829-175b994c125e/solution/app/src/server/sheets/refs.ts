// Stored sheets, sets and dashboard actions name fields, calculations and sets by id, and parameters by id, so a
// rename carries everywhere at once (formulas do the same through the engine). A name that resolves to nothing is kept
// as written, and so is an id that no longer resolves.
import type {
  DashboardAction,
  Filter,
  MeasurePill,
  Pill,
  ReferenceLine,
  SetDef,
  SheetShape,
  TableCalc,
} from '../../shared/model.ts';

interface Named {
  id: string;
  name: string;
}

/** One direction of the mapping: field-like references (fields, calculations, sets) and parameter references. */
export interface RefMap {
  field(ref: string): string;
  parameter(ref: string): string;
}

function lookup(pairs: readonly (readonly [string, string])[]): (ref: string) => string {
  const table = new Map(pairs);
  return (ref) => table.get(ref) ?? ref;
}

/** `stored` turns names into ids; `display` turns ids back into current names. Earlier entries win a name clash. */
export function refMaps(named: readonly Named[], parameters: readonly Named[]): { stored: RefMap; display: RefMap } {
  const first = [...named].reverse();
  return {
    stored: {
      field: lookup(first.map((n) => [n.name, n.id])),
      parameter: lookup([...parameters].reverse().map((p) => [p.name, p.id])),
    },
    display: {
      field: lookup(named.map((n) => [n.id, n.name])),
      parameter: lookup(parameters.map((p) => [p.id, p.name])),
    },
  };
}

function tableCalc(tc: TableCalc | null, m: RefMap): TableCalc | null {
  return tc === null ? null : { kind: tc.kind, using: tc.using, fields: tc.fields.map((f) => m.field(f)) };
}

function measure(p: MeasurePill, m: RefMap): MeasurePill {
  return { field: m.field(p.field), agg: p.agg, table_calc: tableCalc(p.table_calc, m) };
}

function pill(p: Pill, m: RefMap): Pill {
  if (typeof p === 'string') return m.field(p);
  if ('agg' in p) return measure(p, m);
  return { field: m.field(p.field), level: p.level };
}

/** A Top N count is a number or `@<parameter>`. */
function count<T extends number | string | null>(n: T, m: RefMap): T | string {
  return typeof n === 'string' && n.startsWith('@') ? `@${m.parameter(n.slice(1))}` : n;
}

function filter(f: Filter, m: RefMap): Filter {
  return {
    field: m.field(f.field),
    step: f.step,
    values: f.values,
    n: count(f.n, m),
    by: f.by === null ? null : measure(f.by, m),
    min: f.min,
    max: f.max,
    agg: f.agg,
    table_calc: tableCalc(f.table_calc, m),
  };
}

function line(l: ReferenceLine, m: RefMap): ReferenceLine {
  return { type: l.type, value: l.value, parameter: l.parameter === null ? null : m.parameter(l.parameter) };
}

/** Builds every key in the brief's order (jsonb does not keep it). */
export function mapShape(shape: SheetShape, m: RefMap): SheetShape {
  return {
    name: shape.name,
    rows: shape.rows.map((p) => pill(p, m)),
    columns: shape.columns.map((p) => pill(p, m)),
    color: shape.color === null ? null : pill(shape.color, m),
    size: shape.size === null ? null : pill(shape.size, m),
    label: shape.label.map((p) => pill(p, m)),
    detail: shape.detail.map((p) => pill(p, m)),
    filters: shape.filters.map((f) => filter(f, m)),
    chart: shape.chart,
    totals: shape.totals,
    reference_lines: shape.reference_lines.map((l) => line(l, m)),
    trend: shape.trend,
    sort: Object.fromEntries(Object.entries(shape.sort).map(([field, mode]) => [m.field(field), mode])),
  };
}

export function mapSet(set: SetDef, m: RefMap): SetDef {
  const mapped: SetDef = { id: set.id, name: set.name, field: m.field(set.field) };
  if (set.members !== undefined) mapped.members = set.members;
  if (set.top !== undefined) mapped.top = { n: count(set.top.n, m), by: measure(set.top.by, m) };
  return mapped;
}

export function mapAction(action: DashboardAction, m: RefMap): DashboardAction {
  return {
    ...action,
    field: m.field(action.field),
    parameter: action.parameter === null ? null : m.parameter(action.parameter),
    set: action.set === null ? null : m.field(action.set),
  };
}
