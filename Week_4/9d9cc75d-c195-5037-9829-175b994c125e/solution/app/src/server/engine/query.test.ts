import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Cell, SetDef } from '../../shared/model.ts';
import { hiddenNotice, markNotice, NO_ROWS_NOTICE, workNotice } from './bounds.ts';
import { buildDataset } from './dataset.ts';
import { by, F, M, members, model, NOT_NULL, percent, records, refusal, result, sample, sampleModel, sheet, TC } from './fixture.test.ts';
import { measureCaption } from '../../shared/display.ts';
import { sampleView } from './sample.ts';
import {
  HEAT_MAP_REFUSAL,
  LINE_REFUSAL,
  SCATTER_REFUSAL,
  SIZE_NEEDS_MEASURE,
  SIZE_SCATTER_ONLY,
  tooManyMeasures,
} from './view.ts';

const MONTH = { field: 'Date', level: 'month' as const };

test('facts at start', async () => {
  assert.deepEqual(by(await result(sheet({ rows: ['Region'], columns: [M('Sales')] })), 'Sales'), {
    East: 435,
    North: 480,
    South: 60,
    West: 325,
    '(null)': 20,
  });
  assert.deepEqual(by(await result(sheet({ rows: ['Category'], columns: [M('Sales')] })), 'Sales'), { Black: 600, Green: 450, Herbal: 270 });
  assert.deepEqual(by(await result(sheet({ rows: ['Product'], columns: [M('Sales')] })), 'Sales'), {
    'Dusk Blend': 200,
    'Ember Assam': 400,
    'Moss Sencha': 450,
    'Quiet Mint': 270,
  });
  assert.deepEqual(by(await result(sheet({ rows: ['Stockist'], columns: [M('Sales')], filters: [NOT_NULL] })), 'Sales'), {
    'Alder Cup': 300,
    'Birch Kettle': 180,
    'Cedar Pot': 435,
    'Dune Mug': 60,
    'Elm Leaf': 325,
  });
  const months = await result(sheet({ rows: [M('Sales')], columns: [MONTH] }));
  assert.equal(months.chart, 'line');
  assert.deepEqual(by(months, 'Sales'), { '2027-01': 485, '2027-02': 530, '2027-03': 305 });
  const whole = await result(sheet({ columns: [M('Sales')] }));
  assert.deepEqual(whole.rows, [[1320]]);
});

test('the Region by Category grid, with no mark where no row exists', async () => {
  const grid = await result(sheet({ rows: ['Region'], columns: ['Category'], label: [M('Sales')], filters: [NOT_NULL] }));
  assert.equal(grid.chart, 'text_table');
  assert.deepEqual(grid.rows, [
    ['East', 'Black', 150],
    ['East', 'Green', 210],
    ['East', 'Herbal', 75],
    ['North', 'Black', 150],
    ['North', 'Green', 210],
    ['North', 'Herbal', 120],
    ['South', 'Black', null],
    ['South', 'Green', 30],
    ['South', 'Herbal', 30],
    ['West', 'Black', 280],
    ['West', 'Herbal', 45],
  ]);
  assert.deepEqual(grid.columns, [
    { name: 'Region', role: 'dimension' },
    { name: 'Category', role: 'dimension' },
    { name: 'Sales', role: 'measure' },
  ]);
});

test('a right-table measure counts once per distinct right key in a mark', async () => {
  assert.deepEqual(by(await result(sheet({ rows: ['Region'], columns: [M('Target')] })), 'Target'), {
    East: 700,
    North: 1400,
    South: 400,
    West: 600,
    '(null)': null,
  });
  const totals = await result(sheet({ rows: ['Region'], columns: [M('Target')], totals: true }));
  assert.deepEqual(totals.total, [null, 3100]);
});

test('a duplicate right key joins its first line', async () => {
  const dup = model(
    [
      { name: 'orders', csv: 'Order,Stockist ID,Sales\n1,S1,10\n2,S2,20\n3,S9,30\n' },
      { name: 'stockists', csv: 'Stockist ID,Region\nS1,North\nS2,East\nS1,South\n' },
    ],
    { left_table: 'orders', left_key: 'Stockist ID', right_table: 'stockists', right_key: 'Stockist ID' },
  );
  const ds = buildDataset(dup);
  assert.equal(ds.rowCount, 3);
  assert.equal(ds.byName.get('Stockist ID')?.values.length, 3);
  assert.deepEqual(by(await result(sheet({ rows: ['Region'], columns: [M('Sales')] }), { dataset: ds }), 'Sales'), {
    East: 20,
    North: 10,
    '(null)': 30,
  });
  assert.equal(buildDataset(dup), ds);
});

test('bins, groups, renames and date levels', async () => {
  const shaped = buildDataset(
    sampleModel((fields, newId) => {
      const units = fields.find((f) => f.name === 'Units');
      const product = fields.find((f) => f.name === 'Product');
      const base = { table: null, kind: 'dimension' as const, continuous: false, hidden: false, column: null, dropped: false };
      return [
        ...fields.map((f) => (f.name === 'Tier' ? { ...f, name: 'Level' } : f)),
        { ...base, id: newId(), name: 'Units (bin)', type: 'text' as const, derived: { kind: 'bin' as const, field: units?.id ?? '', size: 3 } },
        {
          ...base,
          id: newId(),
          name: 'Product (group)',
          type: 'text' as const,
          derived: { kind: 'group' as const, field: product?.id ?? '', groups: [{ name: 'Morning teas', members: ['Ember Assam', 'Dusk Blend'] }] },
        },
      ];
    }),
  );
  const bins = await result(sheet({ rows: ['Units (bin)'], label: [M('Order', 'COUNT')] }), { dataset: shaped });
  assert.deepEqual(bins.rows, [
    ['0 to 2', 5],
    ['3 to 5', 6],
    ['6 to 8', 4],
    [null, 1],
  ]);
  assert.deepEqual(by(await result(sheet({ rows: ['Product (group)'], columns: [M('Sales')] }), { dataset: shaped }), 'Sales'), {
    'Morning teas': 600,
    'Moss Sencha': 450,
    'Quiet Mint': 270,
  });
  assert.deepEqual(by(await result(sheet({ rows: ['Level'], columns: [M('Sales')] }), { dataset: shaped }), 'Sales'), {
    Gold: 1060,
    Silver: 240,
    '(null)': 20,
  });
  const offset = buildDataset(model([{ name: 't', csv: 'Date,V\n2027-01-03T23:30:00-05:00,1\n' }], null));
  for (const [level, want] of [
    ['week', '2027-01-04'],
    ['day', '2027-01-04'],
    ['month', '2027-01'],
    ['year', '2027'],
  ] as const) {
    const rows = await result(sheet({ rows: [{ field: 'Date', level }], label: [M('V')] }), { dataset: offset });
    assert.deepEqual(rows.rows, [[want, 1]], level);
  }
});

test('chart types and the refusals in order', async () => {
  const cases: [Parameters<typeof sheet>[0], string][] = [
    [{ rows: [M('Sales')], columns: [M('Units')], detail: ['Order'] }, 'scatter'],
    [{ rows: [M('Sales')], columns: [MONTH] }, 'line'],
    [{ rows: [M('Sales')], columns: ['Category'] }, 'bar'],
    [{ rows: ['Category'], columns: [M('Sales')] }, 'bar'],
    [{ rows: ['Region'], columns: ['Category'], color: M('Sales') }, 'heat_map'],
    [{ rows: ['Region'], columns: ['Category'], label: [M('Sales')] }, 'text_table'],
    [{ label: [M('Sales')] }, 'none'],
    [{ rows: ['Region'], columns: [M('Sales'), M('Units')] }, tooManyMeasures('Units')],
    [{ chart: 'line', rows: ['Region'], columns: [M('Sales')] }, LINE_REFUSAL],
    [{ chart: 'scatter', rows: ['Region'], columns: [M('Sales')] }, SCATTER_REFUSAL],
    [{ chart: 'heat_map', rows: ['Region'], columns: ['Category'] }, HEAT_MAP_REFUSAL],
    [{ rows: ['Region'], columns: [M('Sales')], size: M('Units') }, SIZE_SCATTER_ONLY],
    [{ rows: [M('Sales')], columns: [M('Units')], detail: ['Order'], size: 'Category' }, SIZE_NEEDS_MEASURE],
    [{ chart: 'line', rows: ['Region'], columns: [M('Sales'), M('Units')] }, tooManyMeasures('Units')],
    [{ chart: 'bar', rows: [M('Sales')], columns: [{ field: 'Date', level: 'day' }] }, 'bar'],
  ];
  for (const [shape, want] of cases) {
    if (want.includes(' ')) assert.equal(await refusal(sheet(shape)), want);
    else assert.equal((await result(sheet(shape))).chart, want);
  }
});

test('sort: ascending by default, descending, by the first measure', async () => {
  const shape = (mode: 'asc' | 'desc' | 'measure') => sheet({ rows: ['Region'], columns: [M('Sales')], filters: [NOT_NULL], sort: { Region: mode } });
  const order = async (mode: 'asc' | 'desc' | 'measure') => records(await result(shape(mode))).map((r) => r.Region);
  assert.deepEqual(await order('asc'), ['East', 'North', 'South', 'West']);
  assert.deepEqual(await order('desc'), ['West', 'South', 'North', 'East']);
  assert.deepEqual(await order('measure'), ['North', 'East', 'West', 'South']);
  const numeric = records(await result(sheet({ rows: ['Order'], label: [M('Sales')] }))).map((r) => r.Order);
  assert.deepEqual(numeric, Array.from({ length: 16 }, (_, i) => i + 1));
});

test('level of detail examples', async () => {
  const calcs = {
    AtSales: '{AT [Region] : SUM([Sales])}',
    WholeSales: '{SUM([Sales])}',
    PlusSales: '{PLUS [Product] : SUM([Sales])}',
    MinusSales: '{MINUS [Category] : SUM([Sales])}',
  };
  const on = async (measure: ReturnType<typeof M>, columns: string[] = []) =>
    by(await result(sheet({ rows: ['Region'], columns, label: [measure], filters: [NOT_NULL] }), { calcs }), `${measure.agg} ${measure.field}`);
  assert.deepEqual(await on(M('AtSales', 'AVG')), { East: 435, North: 480, South: 60, West: 325 });
  assert.deepEqual(await on(M('WholeSales', 'AVG')), { East: 1300, North: 1300, South: 1300, West: 1300 });
  assert.deepEqual(await on(M('PlusSales', 'AVG')), { East: 145, North: 135, South: 30, West: 108.333333333 });
  assert.equal((await on(M('PlusSales', 'MAX'))).North, 210);
  const minus = await on(M('MinusSales', 'AVG'), ['Category']);
  assert.equal(minus['East | Black'], 435);
  assert.equal(minus['North | Herbal'], 480);
});

test('the ten query order examples', async () => {
  const calcs = {
    AtSales: '{AT [Region] : SUM([Sales])}',
    PlusSales: '{PLUS [Product] : SUM([Sales])}',
    MinusSales: '{MINUS [Category] : SUM([Sales])}',
  };
  const order = sheet({ rows: ['Region'], label: [M('Sales'), M('AtSales', 'AVG')], filters: [NOT_NULL] });
  // 1
  assert.deepEqual(await members(order, 'Product', 'context', { calcs, filters: [F('Category', 'source', ['Green'])] }), ['Moss Sencha']);
  // 2
  assert.deepEqual(by(await result(order, { calcs, filters: [F('Product', 'context', ['Quiet Mint'])] }), 'AVG AtSales'), {
    East: 75,
    North: 120,
    South: 30,
    West: 45,
  });
  // 3
  const dimension = await result(order, { calcs, filters: [F('Product', 'dimension', ['Quiet Mint'])] });
  assert.deepEqual(by(dimension, 'Sales'), { East: 75, North: 120, South: 30, West: 45 });
  assert.deepEqual(by(dimension, 'AVG AtSales'), { East: 435, North: 480, South: 60, West: 325 });
  // 4
  const top = F('Region', 'top', [], { n: 1, by: M('Sales') });
  assert.deepEqual(by(await result(order, { calcs, filters: [top, F('Category', 'dimension', ['Black'])] }), 'Sales'), { North: 150 });
  assert.deepEqual(by(await result(order, { calcs, filters: [top, F('Category', 'context', ['Black'])] }), 'Sales'), { West: 280 });
  // 5
  const plus = sheet({ rows: ['Region'], label: [M('PlusSales', 'AVG')], filters: [NOT_NULL] });
  assert.deepEqual(by(await result(plus, { calcs, filters: [F('Category', 'dimension', ['Black'])] }), 'AVG PlusSales'), {
    East: 150,
    North: 75,
    South: null,
    West: 140,
  });
  const minus = sheet({ rows: ['Region'], columns: ['Category'], label: [M('MinusSales', 'AVG')], filters: [NOT_NULL] });
  assert.equal(by(await result(minus, { calcs, filters: [F('Product', 'dimension', ['Quiet Mint'])] }), 'AVG MinusSales')['East | Herbal'], 75);
  // 6
  assert.equal(by(await result(plus, { calcs }), 'AVG PlusSales').North, 135);
  // 7
  const measure = F('Sales', 'measure', [], { agg: 'SUM', min: 300 });
  assert.deepEqual(Object.keys(by(await result(order, { calcs, filters: [measure] }), 'Sales')), ['East', 'North', 'West']);
  // 8
  const share = M('Sales', 'SUM', TC('share', 'table_down'));
  const shares = sheet({ rows: ['Region'], columns: [share], filters: [NOT_NULL] });
  assert.deepEqual(percent(by(await result(shares, { filters: [measure] }), measureCaption(share))), { East: 35.1, North: 38.7, West: 26.2 });
  const unfiltered = await result(shares);
  assert.deepEqual(percent(by(unfiltered, measureCaption(share))), { East: 33.5, North: 36.9, South: 4.6, West: 25 });
  assert.equal(unfiltered.columns[1]?.share, true);
  // 9
  const rank = M('Sales', 'SUM', TC('rank', 'table_down'));
  const rankFilter = F('Sales', 'table_calc', [], { agg: 'SUM', table_calc: TC('rank', 'table_down'), max: 2 });
  const ranked = await result(sheet({ rows: ['Region'], columns: [M('Sales')], label: [rank, share], filters: [NOT_NULL] }), { filters: [rankFilter] });
  assert.deepEqual(by(ranked, 'Rank of Sales'), { East: 2, North: 1 });
  assert.deepEqual(percent(by(ranked, 'Percent of total of Sales')), { East: 33.5, North: 36.9 });
  // 10
  const totals = await result(
    sheet({
      rows: ['Region'],
      columns: [M('Sales')],
      label: [rank, share, M('Sales', 'AVG')],
      totals: true,
      reference_lines: [{ type: 'average', value: null, parameter: null }],
      filters: [NOT_NULL],
    }),
    { filters: [rankFilter] },
  );
  assert.deepEqual(by(totals, 'AVG Sales'), { East: 145, North: 80 });
  assert.deepEqual(totals.total, [null, 915, 'n/a', 'n/a', 101.666666667]);
  assert.deepEqual(totals.reference_lines, [{ type: 'average', value: 457.5 }]);
});

test('table calculation examples', async () => {
  const grid = (kind: Parameters<typeof TC>[0], using: Parameters<typeof TC>[1], fields: string[] = []) =>
    sheet({ rows: ['Region'], columns: ['Category'], label: [M('Sales', 'SUM', TC(kind, using, fields))], filters: [NOT_NULL] });
  const cells = async (shape: ReturnType<typeof sheet>) => {
    const pill = shape.label[0];
    assert.ok(pill !== undefined && typeof pill !== 'string' && 'agg' in pill);
    return by(await result(shape), measureCaption(pill));
  };
  const run = await cells(grid('run_total', 'table_across'));
  assert.deepEqual([run['East | Black'], run['East | Green'], run['East | Herbal']], [150, 360, 435]);
  assert.deepEqual([run['South | Black'], run['South | Green'], run['South | Herbal']], [null, 30, 60]);
  assert.deepEqual([run['West | Black'], run['West | Herbal']], [280, 325]);
  const down = await cells(grid('run_total', 'table_down'));
  assert.deepEqual(['East', 'North', 'South', 'West'].map((r) => down[`${r} | Black`]), [150, 300, null, 580]);
  assert.deepEqual(['East', 'North', 'South', 'West'].map((r) => down[`${r} | Herbal`]), [75, 195, 225, 270]);
  const diff = await cells(grid('prev_diff', 'table_across'));
  assert.deepEqual(['East | Black', 'East | Green', 'East | Herbal', 'South | Black', 'South | Green', 'South | Herbal', 'West | Black', 'West | Herbal'].map((k) => diff[k]), [
    null,
    60,
    -135,
    null,
    null,
    0,
    null,
    -235,
  ]);
  const share = percent(await cells(grid('share', 'table_down')));
  assert.deepEqual(['East', 'North', 'South', 'West'].map((r) => share[`${r} | Black`]), [25.9, 25.9, null, 48.3]);
  const rank = await cells(grid('rank', 'table_down'));
  assert.deepEqual(['East', 'North', 'South', 'West'].map((r) => rank[`${r} | Black`]), [2, 2, null, 1]);
  const chosen = await cells(grid('rank', 'chosen', ['Region', 'Category']));
  assert.deepEqual(chosen, {
    'East | Black': 4,
    'East | Green': 2,
    'East | Herbal': 7,
    'North | Black': 4,
    'North | Green': 2,
    'North | Herbal': 6,
    'South | Black': null,
    'South | Green': 9,
    'South | Herbal': 9,
    'West | Black': 1,
    'West | Herbal': 8,
  });
  const pane = (using: 'pane_down' | 'table_down') =>
    result(sheet({ rows: ['Tier', 'Stockist'], columns: [M('Sales', 'SUM', TC('run_total', using))], filters: [NOT_NULL] }));
  assert.deepEqual((await pane('pane_down')).rows.map((r) => r[2]), [300, 735, 1060, 180, 240]);
  assert.deepEqual((await pane('table_down')).rows.map((r) => r[2]), [300, 735, 1060, 1240, 1300]);
});

test('table calculations in formulas compute Table across', async () => {
  const calcs = { Running: 'RUN_TOTAL(SUM([Sales]))', Named: '[Running]', Portion: 'SHARE(SUM([Sales]))' };
  const across = await result(sheet({ rows: ['Region'], columns: ['Category'], label: [M('Named'), M('Portion')], filters: [NOT_NULL] }), { calcs });
  const named = by(across, 'Named');
  assert.deepEqual([named['East | Black'], named['East | Green'], named['East | Herbal'], named['West | Herbal']], [150, 360, 435, 325]);
  assert.equal(percent(by(across, 'Portion'))['East | Black'], 34.5);
  assert.deepEqual(across.columns.slice(2), [
    { name: 'Named', role: 'measure' },
    { name: 'Portion', role: 'measure', share: true },
  ]);
});

const TOP_COUNT = { id: 'p1', name: 'Top count', type: 'number' as const, value: 2, values: [] };
const TOP_SET: SetDef = { id: 's1', name: 'Top regions', field: 'Region', top: { n: '@Top count', by: M('Sales') } };

test('parameters, sets and lines', async () => {
  const drive = sheet({
    rows: ['Region'],
    columns: [M('Excess')],
    color: 'Top regions',
    reference_lines: [{ type: 'constant', value: null, parameter: 'Top count' }],
    filters: [NOT_NULL],
  });
  const extras = { parameters: [TOP_COUNT], sets: [TOP_SET], calcs: { Excess: 'COUNT([Order]) - [@Top count]' } };
  const two = await result(drive, extras);
  assert.deepEqual(two.rows, [
    ['East', 'In', 1],
    ['North', 'In', 4],
    ['South', 'Out', 1],
    ['West', 'Out', 1],
  ]);
  assert.deepEqual(two.reference_lines, [{ type: 'constant', value: 2 }]);
  const three = await result(drive, { ...extras, values: { 'Top count': '3' } });
  assert.deepEqual(three.rows, [
    ['East', 'In', 0],
    ['North', 'In', 3],
    ['South', 'Out', 0],
    ['West', 'In', 0],
  ]);
  assert.deepEqual(three.reference_lines, [{ type: 'constant', value: 3 }]);
  const picked: SetDef = { id: 's2', name: 'Picked', field: 'Region', members: ['West'] };
  const pickedRows = records(await result(sheet({ rows: ['Picked', 'Region'], columns: [M('Sales')], filters: [NOT_NULL] }), { sets: [picked] }));
  assert.deepEqual(pickedRows.filter((r) => r.Picked === 'In').map((r) => r.Region), ['West']);
  const replaced = records(await result(sheet({ rows: ['Region'], label: [M('Sales')], filters: [F('Picked', 'dimension', ['In'])] }), { sets: [picked], replaced: { Picked: ['East'] } }));
  assert.deepEqual(replaced.map((r) => r.Region), ['East']);
  const inFormula = records(await result(sheet({ rows: ['Region', 'Is top'], filters: [NOT_NULL] }), { ...extras, calcs: { 'Is top': '[Top regions]' } }));
  assert.deepEqual(inFormula.map((r) => r['Is top']), [true, true, false, false]);
  const byParam = records(await result(sheet({ rows: ['Region'], label: [M('Sales')], filters: [F('Region', 'dimension', ['@Pick'])] }), {
    parameters: [{ id: 'p2', name: 'Pick', type: 'list', value: 'East', values: ['East', 'West'] }],
  }));
  assert.deepEqual(byParam.map((r) => r.Region), ['East']);
});

test('reference and trend lines', async () => {
  const lines = await result(
    sheet({
      rows: ['Region'],
      columns: [M('Sales')],
      filters: [NOT_NULL],
      reference_lines: [
        { type: 'average', value: null, parameter: null },
        { type: 'median', value: null, parameter: null },
        { type: 'constant', value: 7, parameter: null },
      ],
    }),
  );
  assert.deepEqual(lines.reference_lines, [
    { type: 'average', value: 325 },
    { type: 'median', value: 380 },
    { type: 'constant', value: 7 },
  ]);
  assert.deepEqual((await result(sheet({ rows: [M('Sales')], columns: [MONTH], trend: true }))).trend, { slope: -90, intercept: 530 });
  const scatter = (await result(sheet({ rows: [M('Sales')], columns: [M('Units')], detail: ['Order'], trend: true }))).trend;
  assert.deepEqual([Math.round((scatter?.slope ?? 0) * 100) / 100, Math.round((scatter?.intercept ?? 0) * 100) / 100], [24.92, -10.02]);
  const onShare = await result(
    sheet({
      rows: ['Region'],
      columns: [M('Sales', 'SUM', TC('share', 'table_down'))],
      filters: [NOT_NULL],
      reference_lines: [
        { type: 'average', value: null, parameter: null },
        { type: 'median', value: null, parameter: null },
      ],
    }),
  );
  assert.deepEqual(percent(Object.fromEntries(onShare.reference_lines.map((l) => [l.type, l.value]))), { average: 25, median: 29.2 });
});

test('row-level security holds first, on every surface', async () => {
  const south = { security: { field: 'Region', allowed: ['South'] as Cell[] }, sets: [{ id: 's3', name: 'Top stockists', field: 'Stockist', top: { n: 2, by: M('Sales') } }] };
  const byCategory = sheet({ rows: ['Category'], columns: [M('Sales')], totals: true, reference_lines: [{ type: 'average', value: null, parameter: null }] });
  const r = await result(byCategory, south);
  assert.deepEqual(by(r, 'Sales'), { Black: null, Green: 30, Herbal: 30 });
  assert.deepEqual(r.total, [null, 60]);
  assert.deepEqual(r.reference_lines, [{ type: 'average', value: 30 }]);
  assert.deepEqual(await members(byCategory, 'Stockist', 'dimension', south), ['Dune Mug']);
  assert.deepEqual(await members(byCategory, 'Product', 'dimension', south), ['Ember Assam', 'Moss Sencha', 'Quiet Mint']);
  const calcs = { WholeSales: '{SUM([Sales])}', AtSales: '{AT [Region] : SUM([Sales])}' };
  assert.deepEqual(by(await result(sheet({ rows: ['Category'], label: [M('WholeSales', 'AVG')] }), { ...south, calcs }), 'AVG WholeSales'), {
    Black: 60,
    Green: 60,
    Herbal: 60,
  });
  assert.deepEqual(by(await result(sheet({ rows: ['Region'], label: [M('AtSales', 'AVG')] }), { ...south, calcs }), 'AVG AtSales'), { South: 60 });
  const top = records(await result(sheet({ rows: ['Top stockists', 'Stockist'], columns: [M('Sales')] }), south));
  assert.deepEqual(top.filter((x) => x['Top stockists'] === 'In').map((x) => x.Stockist), ['Dune Mug']);
  const none = await result(byCategory, { security: { field: 'Region', allowed: [] } });
  assert.deepEqual([none.rows, none.notices, none.total], [[], [NO_ROWS_NOTICE], [null, null]]);
  const orders = await result(sheet({ rows: ['Region'], columns: [M('Sales')] }), { security: { field: 'Order', allowed: ['1', '2'] } });
  assert.deepEqual(by(orders, 'Sales'), { North: 170 });
  const dates = await result(sheet({ rows: ['Region'], columns: [M('Sales')] }), { security: { field: 'Date', allowed: ['2027-01-04'] } });
  assert.deepEqual(by(dates, 'Sales'), { North: 120 });
  assert.equal(await refusal(sheet({ chart: 'line', rows: ['Region'], columns: [M('Sales')] }), { security: { field: 'Region', allowed: [] } }), NO_ROWS_NOTICE);
});

test('a hidden field leaves the view and gives the notice', async () => {
  const hidden = buildDataset(sampleModel((fields) => fields.map((f) => (f.name === 'Target' ? { ...f, hidden: true } : f))));
  const r = await result(sheet({ rows: ['Region'], columns: [M('Target')], filters: [NOT_NULL] }), { dataset: hidden });
  assert.deepEqual(r.notices, [hiddenNotice('Target')]);
  assert.deepEqual(r.columns, [{ name: 'Region', role: 'dimension' }]);
  assert.ok(!JSON.stringify(r).includes('700'));
});

test('bounded work, marks and time', async () => {
  const rows = (n: number) =>
    buildDataset(
      model([{ name: 'data', csv: `Id,Group,Value\n${Array.from({ length: n }, (_, i) => `${i + 1},G${(i + 1) % 10},${(i + 1) % 100}`).join('\n')}\n` }], null, (fields) =>
        fields.map((f) => (f.name === 'Id' ? { ...f, kind: 'dimension' as const, continuous: false } : f)),
      ),
    );
  const big = rows(50000);
  const heavy = `[Value]${' + 1'.repeat(50)}`;
  const light = `-[Value]${' + 1'.repeat(49)}`;
  assert.equal(await refusal(sheet({ rows: ['Group'], label: [M('Heavy')] }), { dataset: big, calcs: { Heavy: heavy } }), workNotice(5000000));
  const started = performance.now();
  const ok = await result(sheet({ rows: ['Group'], label: [M('Light')] }), { dataset: big, calcs: { Light: light } });
  assert.equal(ok.rows.length, 10);
  assert.ok(performance.now() - started < 3000, `took ${performance.now() - started} ms`);
  const ids = sheet({ rows: ['Id'], columns: [M('Value')] });
  assert.equal(await refusal(ids, { dataset: rows(2001) }), markNotice(2001, 2000));
  assert.equal((await result(ids, { dataset: rows(2000) })).rows.length, 2000);
  assert.equal(
    await refusal(sheet({ rows: ['Group'], label: [M('Light')] }), { dataset: big, calcs: { Light: light }, limits: { queryBudgetMs: 1 } }),
    'This view took too long. The limit is 0 seconds.',
  );
});

test('another query answers while a long one runs', async () => {
  const big = buildDataset(model([{ name: 'data', csv: `Group,Value\n${Array.from({ length: 50000 }, (_, i) => `G${i % 10},${i % 100}`).join('\n')}\n` }], null));
  const light = `-[Value]${' + 1'.repeat(49)}`;
  const long = Promise.all([1, 2, 3, 4].map(() => result(sheet({ rows: ['Group'], label: [M('Light')] }), { dataset: big, calcs: { Light: light } })));
  const started = performance.now();
  await result(sheet({ rows: ['Region'], columns: [M('Sales')] }));
  const small = performance.now() - started;
  await long;
  assert.ok(small < 1000, `the small query took ${small} ms`);
});

test('the sample view is SUM(Sales) by Region without the null region', async () => {
  const { sheet: shape, result: r } = sampleView();
  assert.equal(shape.name, 'Fernhollow Tea');
  assert.equal(r.chart, 'bar');
  assert.deepEqual(r.rows, [
    ['East', 435],
    ['North', 480],
    ['South', 60],
    ['West', 325],
  ]);
  assert.equal(sample.rowCount, 16);
});
