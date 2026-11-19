// Shared test setup: the bundled sample as an uploaded source, and short ways to write sheets and run queries.
import type { Agg, CalculationDef, Cell, Filter, FilterStep, MeasurePill, ParameterDef, QueryResult, SetDef, SheetShape, TableCalc } from '../../shared/model.ts';
import { ORDERS_CSV, STOCKISTS_CSV } from '../../shared/sample.ts';
import { readCsv, type CsvTable } from '../sources/csv.ts';
import { reconcileFields, type FieldRecord } from '../sources/fields.ts';
import type { SourceModel } from '../sources/model.ts';
import type { Dataset, QueryLimits, Security } from './contract.ts';
import { buildDataset } from './dataset.ts';
import { listMembers, runQuery } from './query.ts';

export const LIMITS: QueryLimits = { formulaMaxChars: 2000, formulaMaxDepth: 16, markMax: 2000, queryWorkMax: 5000000, queryBudgetMs: 5000 };

export function csvTable(text: string): CsvTable {
  const read = readCsv(new TextEncoder().encode(text), { csvMaxBytes: 1e9, rowMax: 1e9 });
  if (!read.ok) throw new Error(JSON.stringify(read.errors));
  return read.table;
}

export function model(
  tables: { name: string; csv: string }[],
  relation: SourceModel['relation'],
  shape: (fields: FieldRecord[], newId: () => string) => FieldRecord[] = (f) => f,
): SourceModel {
  const parsed = tables.map((t) => ({ name: t.name, table: csvTable(t.csv) }));
  let next = 0;
  const newId = (): string => `f${++next}`;
  const fields = reconcileFields([], parsed.map((t) => ({ name: t.name, columns: t.table.columns })), relation, newId);
  return {
    sourceId: 's',
    snapshotId: 'x',
    tables: parsed.map((t) => ({ name: t.name, columns: t.table.columns, rows: t.table.rows })),
    fields: shape(fields, newId),
    relation,
    hierarchy: null,
    security: { field: null, users: {} },
  };
}

export const SAMPLE_RELATION = { left_table: 'orders', left_key: 'Stockist ID', right_table: 'stockists', right_key: 'Stockist ID' };

export function sampleModel(shape?: (fields: FieldRecord[], newId: () => string) => FieldRecord[]): SourceModel {
  return model(
    [
      { name: 'orders', csv: ORDERS_CSV },
      { name: 'stockists', csv: STOCKISTS_CSV },
    ],
    SAMPLE_RELATION,
    (fields, newId) => {
      const discrete = fields.map((f) => (f.name === 'Order' ? { ...f, kind: 'dimension' as const, continuous: false } : f));
      return shape ? shape(discrete, newId) : discrete;
    },
  );
}

export const sample: Dataset = buildDataset(sampleModel());

export const M = (field: string, agg: Agg = 'SUM', table_calc: TableCalc | null = null): MeasurePill => ({ field, agg, table_calc });
export const TC = (kind: TableCalc['kind'], using: TableCalc['using'], fields: string[] = []): TableCalc => ({ kind, using, fields });
export const F = (field: string, step: FilterStep, values: Cell[] = [], extra: Partial<Filter> = {}): Filter => ({
  field,
  step,
  values,
  n: null,
  by: null,
  min: null,
  max: null,
  agg: null,
  table_calc: null,
  ...extra,
});
export const NOT_NULL = F('Region', 'source', ['East', 'North', 'South', 'West']);

export function sheet(shape: Partial<SheetShape>): SheetShape {
  return {
    name: 'S',
    rows: [],
    columns: [],
    color: null,
    size: null,
    label: [],
    detail: [],
    filters: [],
    chart: 'automatic',
    totals: false,
    reference_lines: [],
    trend: false,
    sort: {},
    ...shape,
  };
}

export interface Extras {
  calcs?: Record<string, string>;
  parameters?: ParameterDef[];
  sets?: SetDef[];
  filters?: Filter[];
  values?: Record<string, string | number>;
  replaced?: Record<string, Cell[]>;
  security?: Security | null;
  limits?: Partial<QueryLimits>;
  dataset?: Dataset;
}

export function calculations(calcs: Record<string, string> = {}): CalculationDef[] {
  return Object.entries(calcs).map(([name, formula], i) => ({ id: `c${i}`, name, formula }));
}

function input(shape: SheetShape, extras: Extras) {
  return {
    dataset: extras.dataset ?? sample,
    calculations: calculations(extras.calcs),
    parameters: extras.parameters ?? [],
    sets: extras.sets ?? [],
    sheet: shape,
    request: { filters: extras.filters ?? [], parameters: extras.values ?? {}, sets: extras.replaced ?? {} },
    security: extras.security ?? null,
    limits: { ...LIMITS, ...extras.limits },
  };
}

export async function result(shape: SheetShape, extras: Extras = {}): Promise<Omit<QueryResult, 'gen'>> {
  const outcome = await runQuery(input(shape, extras));
  if (!outcome.ok) throw new Error(`refused: ${outcome.message}`);
  return outcome.result;
}

export async function refusal(shape: SheetShape, extras: Extras = {}): Promise<string> {
  const outcome = await runQuery(input(shape, extras));
  if (outcome.ok) throw new Error('the view was not refused');
  return outcome.message;
}

export function members(shape: SheetShape, field: string, step: FilterStep, extras: Extras = {}): Promise<Cell[]> {
  return listMembers(input(shape, extras), field, step);
}

/** Rows as objects keyed by column caption. */
export function records(res: Omit<QueryResult, 'gen'>): Record<string, Cell>[] {
  return res.rows.map((row) => Object.fromEntries(res.columns.map((c, i) => [c.name, row[i] ?? null])));
}

/** `{dimension values joined by " | ": measure}`; null dimension values read `(null)`. */
export function by(res: Omit<QueryResult, 'gen'>, measure: string): Record<string, Cell> {
  const dims = res.columns.filter((c) => c.role === 'dimension').map((c) => c.name);
  return Object.fromEntries(records(res).map((r) => [dims.map((d) => (r[d] === null ? '(null)' : String(r[d]))).join(' | '), r[measure] ?? null]));
}

export const percent = (values: Record<string, Cell>): Record<string, number | null> =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 1000) / 10 : null]));
