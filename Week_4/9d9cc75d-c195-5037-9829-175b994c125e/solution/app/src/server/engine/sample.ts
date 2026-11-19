// The home page's sample sheet, computed from the bundled Fernhollow Tea files through the same parsing, field rules,
// join and query order as an uploaded source. Pure, so the browser can run it.
import type { QueryResult, SheetShape, SourceField } from '../../shared/model.ts';
import { ORDERS_CSV, STOCKISTS_CSV } from '../../shared/sample.ts';
import { readCsv, type CsvTable } from '../sources/csv.ts';
import { reconcileFields } from '../sources/fields.ts';
import type { SourceModel } from '../sources/model.ts';
import type { QueryLimits } from './contract.ts';
import { buildDataset } from './dataset.ts';
import { runQueryNow } from './query.ts';

const LIMITS: QueryLimits = {
  formulaMaxChars: 2000,
  formulaMaxDepth: 16,
  markMax: 2000,
  queryWorkMax: 5000000,
  queryBudgetMs: 5000,
};

const SHEET: SheetShape = {
  name: 'Fernhollow Tea',
  rows: ['Region'],
  columns: [{ field: 'Sales', agg: 'SUM', table_calc: null }],
  color: null,
  size: null,
  label: [],
  detail: [],
  filters: [
    {
      field: 'Region',
      step: 'source',
      values: ['East', 'North', 'South', 'West'],
      n: null,
      by: null,
      min: null,
      max: null,
      agg: null,
      table_calc: null,
    },
  ],
  chart: 'automatic',
  totals: false,
  reference_lines: [],
  trend: false,
  sort: {},
};

function table(text: string): CsvTable {
  const read = readCsv(new TextEncoder().encode(text), { csvMaxBytes: Number.MAX_SAFE_INTEGER, rowMax: Number.MAX_SAFE_INTEGER });
  if (!read.ok) throw new Error('the bundled sample does not parse');
  return read.table;
}

function sampleModel(): SourceModel {
  const orders = table(ORDERS_CSV);
  const stockists = table(STOCKISTS_CSV);
  const relation = { left_table: 'orders', left_key: 'Stockist ID', right_table: 'stockists', right_key: 'Stockist ID' };
  let next = 0;
  const tables = [
    { name: 'orders', columns: orders.columns },
    { name: 'stockists', columns: stockists.columns },
  ];
  const discreteOrder = (field: SourceField): Partial<SourceField> =>
    field.name === 'Order' ? { kind: 'dimension', continuous: false } : {};
  const fields = reconcileFields([], tables, relation, () => `sample-${++next}`).map((f) => ({ ...f, ...discreteOrder(f) }));
  return {
    sourceId: 'sample',
    snapshotId: 'sample',
    tables: [
      { name: 'orders', columns: orders.columns, rows: orders.rows },
      { name: 'stockists', columns: stockists.columns, rows: stockists.rows },
    ],
    fields,
    relation,
    hierarchy: { name: 'Geography', fields: ['Region', 'Stockist'] },
    security: { field: null, users: {} },
  };
}

/** SUM(Sales) by Region with the source filter Region is not null. */
export function sampleView(): { sheet: SheetShape; result: QueryResult } {
  const outcome = runQueryNow({
    dataset: buildDataset(sampleModel()),
    calculations: [],
    parameters: [],
    sets: [],
    sheet: SHEET,
    request: { filters: [], parameters: {}, sets: {} },
    security: null,
    limits: LIMITS,
  });
  if (!outcome.ok) throw new Error(outcome.message);
  return { sheet: SHEET, result: { gen: 1, ...outcome.result } };
}
