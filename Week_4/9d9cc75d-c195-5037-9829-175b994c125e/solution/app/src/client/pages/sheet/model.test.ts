import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SheetShape } from '../../../shared/model.ts';
import {
  drill,
  drillState,
  filterCaption,
  insertPill,
  movePill,
  nextSort,
  pillCaption,
  pillFor,
  removePill,
  stepFilter,
  stepPill,
  viewDimensions,
  viewMeasures,
} from './model.ts';

const empty: SheetShape = {
  name: 'Test',
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
};

const sales = { field: 'Sales', agg: 'SUM', table_calc: null } as const;
const geography = ['Region', 'Stockist'];

test('a field becomes a pill by its kind: measures SUM, level-of-detail AVG, dates Month', () => {
  assert.deepEqual(pillFor({ key: 'a', name: 'Sales', kind: 'measure', type: 'number', lod: false }), sales);
  assert.deepEqual(pillFor({ key: 'b', name: 'At', kind: 'measure', type: 'number', lod: true }), { field: 'At', agg: 'AVG', table_calc: null });
  assert.deepEqual(pillFor({ key: 'c', name: 'Date', kind: 'dimension', type: 'date', lod: false }), { field: 'Date', level: 'month' });
  assert.equal(pillFor({ key: 'd', name: 'Region', kind: 'dimension', type: 'text', lod: false }), 'Region');
});

test('captions follow the display rule', () => {
  assert.equal(pillCaption(sales), 'Sales');
  assert.equal(pillCaption({ field: 'Sales', agg: 'AVG', table_calc: null }), 'AVG Sales');
  assert.equal(pillCaption({ field: 'Units', agg: 'SUM', table_calc: { kind: 'run_total', using: 'table_across', fields: [] } }), 'Running total of Units');
});

test('Color holds one pill; Rows keeps order and moves one place', () => {
  const coloured = insertPill(insertPill(empty, 'Color', 'Region'), 'Color', 'Category');
  assert.equal(coloured.color, 'Category');
  const rows = insertPill(insertPill(empty, 'Rows', 'Region'), 'Rows', 'Category');
  assert.deepEqual(stepPill(rows, 'Rows', 0, 1)?.rows, ['Category', 'Region']);
  assert.equal(stepPill(rows, 'Rows', 1, 1), null);
  assert.deepEqual(removePill(rows, 'Rows', 0).rows, ['Category']);
});

test('moving a pill between shelves and within one', () => {
  const shape = { ...empty, rows: ['Region', 'Category', 'Product'] };
  assert.deepEqual(movePill(shape, 'Rows', 0, 'Rows', 3).rows, ['Category', 'Product', 'Region']);
  const moved = movePill(shape, 'Rows', 1, 'Columns', 0);
  assert.deepEqual([moved.rows, moved.columns], [['Region', 'Product'], ['Category']]);
});

test('drill expands the next level right after the pill and collapses every lower level', () => {
  const shape = { ...empty, rows: ['Region', 'Category'] };
  assert.equal(drillState(shape, 'Rows', 0, geography), 'expand');
  const expanded = drill(shape, 'Rows', 0, geography);
  assert.deepEqual(expanded.rows, ['Region', 'Stockist', 'Category']);
  assert.equal(drillState(expanded, 'Rows', 0, geography), 'collapse');
  assert.equal(drillState(expanded, 'Rows', 1, geography), null);
  assert.deepEqual(drill(expanded, 'Rows', 0, geography).rows, ['Region', 'Category']);
});

test('sort cycles ascending, descending, by measure, ascending', () => {
  assert.deepEqual([nextSort(undefined), nextSort('desc'), nextSort('measure'), nextSort('asc')], ['desc', 'measure', 'asc', 'desc']);
});

test('view dimensions and measures', () => {
  const shape: SheetShape = { ...empty, rows: ['Region'], columns: [sales], color: 'Category', label: [sales, { ...sales, agg: 'AVG' }] };
  assert.deepEqual(viewDimensions(shape), ['Region', 'Category']);
  assert.deepEqual(viewMeasures(shape).map(pillCaption), ['Sales', 'AVG Sales']);
});

test('filters step within the shelf and a data source filter is named apart', () => {
  const filter = { field: 'Region', step: 'dimension', values: [], n: null, by: null, min: null, max: null, agg: null, table_calc: null } as const;
  const shape: SheetShape = { ...empty, filters: [{ ...filter, step: 'source' }, filter] };
  assert.deepEqual(stepFilter(shape, 1, -1)?.filters.map(filterCaption), ['Region', 'Region (data source)']);
  assert.equal(stepFilter(shape, 0, -1), null);
});
