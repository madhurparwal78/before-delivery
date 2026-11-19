import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SheetShape } from '../../shared/model.ts';
import { mapSet, mapShape, refMaps } from './refs.ts';

const shape: SheetShape = {
  name: 'Drive',
  rows: ['Region', { field: 'Date', level: 'month' }],
  columns: [{ field: 'Excess', agg: 'SUM', table_calc: { kind: 'rank', using: 'chosen', fields: ['Region'] } }],
  color: 'Top regions',
  size: null,
  label: [],
  detail: ['Not yet made'],
  filters: [
    {
      field: 'Region',
      step: 'top',
      values: [],
      n: '@Top count',
      by: { field: 'Sales', agg: 'SUM', table_calc: null },
      min: null,
      max: null,
      agg: null,
      table_calc: null,
    },
  ],
  chart: 'automatic',
  totals: false,
  reference_lines: [{ type: 'constant', value: null, parameter: 'Top count' }],
  trend: false,
  sort: { Region: 'desc' },
};

const fields = [
  { id: 'f-region', name: 'Region' },
  { id: 'f-date', name: 'Date' },
  { id: 'f-sales', name: 'Sales' },
  { id: 'c-excess', name: 'Excess' },
  { id: 's-top', name: 'Top regions' },
];
const parameters = [{ id: 'p-top', name: 'Top count' }];

test('a stored shape names everything by id and comes back with current names after renames', () => {
  const stored = mapShape(shape, refMaps(fields, parameters).stored);
  assert.deepEqual(stored.rows, ['f-region', { field: 'f-date', level: 'month' }]);
  assert.equal(stored.color, 's-top');
  assert.deepEqual(stored.detail, ['Not yet made']);
  assert.equal(stored.filters[0]?.n, '@p-top');
  assert.equal(stored.reference_lines[0]?.parameter, 'p-top');
  assert.deepEqual(stored.sort, { 'f-region': 'desc' });

  const renamed = fields.map((f) => (f.id === 'f-sales' ? { ...f, name: 'Revenue' } : f));
  const shown = mapShape(stored, refMaps(renamed, [{ id: 'p-top', name: 'Top N' }]).display);
  assert.deepEqual(shown.filters[0]?.by, { field: 'Revenue', agg: 'SUM', table_calc: null });
  assert.equal(shown.filters[0]?.n, '@Top N');
  assert.deepEqual(shown.columns, shape.columns);
  assert.deepEqual(Object.keys(shown), Object.keys(shape));
});

test('a set keeps its members or Top N and maps its field, measure and count', () => {
  const maps = refMaps(fields, parameters);
  const top = { id: 's-top', name: 'Top regions', field: 'Region', top: { n: '@Top count', by: { field: 'Sales', agg: 'SUM' as const, table_calc: null } } };
  assert.deepEqual(mapSet(mapSet(top, maps.stored), maps.display), top);
  assert.deepEqual(mapSet({ id: 's', name: 'Picked', field: 'Region', members: ['West'] }, maps.stored), {
    id: 's',
    name: 'Picked',
    field: 'f-region',
    members: ['West'],
  });
});
