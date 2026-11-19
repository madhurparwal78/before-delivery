import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Cell, ChartKind, MeasurePill, Pill, QueryColumn, QueryResult, SheetShape } from '../model.ts';
import { layoutChart } from './layout.ts';
import type { ChartLayout, LayoutOptions } from './types.ts';

const sum = (field: string): MeasurePill => ({ field, agg: 'SUM', table_calc: null });
const desktop: LayoutOptions = { touch: false, compact: false };
const phone: LayoutOptions = { touch: true, compact: true };

function sheet(parts: Partial<SheetShape>): SheetShape {
  return {
    name: 'Test', rows: [], columns: [], color: null, size: null, label: [], detail: [], filters: [], chart: 'automatic',
    totals: false, reference_lines: [], trend: false, sort: {}, ...parts,
  };
}

function result(chart: ChartKind, columns: QueryColumn[], rows: Cell[][], parts: Partial<QueryResult> = {}): QueryResult {
  return { gen: 1, chart, columns, rows, total: null, reference_lines: [], trend: null, notices: [], ...parts };
}

const dim = (name: string): QueryColumn => ({ name, role: 'dimension' });
const measure = (name: string): QueryColumn => ({ name, role: 'measure' });

const regions = result('bar', [dim('Region'), measure('Sales')], [['East', 435], ['North', 480], ['South', 60], ['West', 325]]);
const REGION_ROWS: Pill[] = ['Region'];

function near(actual: number, expected: number, what: string): void {
  assert.ok(Math.abs(actual - expected) <= 0.05, `${what}: ${actual} is not ${expected}`);
}

function ticksOf(layout: ChartLayout): string[] {
  return layout.ticks.map((t) => t.text);
}

test('horizontal bars: the dimension on Rows, lengths follow the ticks, bands are equal and in order', () => {
  const layout = layoutChart(sheet({ rows: REGION_ROWS, columns: [sum('Sales')] }), regions, { width: 800, height: null }, desktop);
  assert.equal(layout.kind, 'bar');
  assert.deepEqual(ticksOf(layout), ['0', '200', '400', '600']);
  const { plot, marks } = layout;
  assert.deepEqual(marks.map((m) => m.id), ['East', 'North', 'South', 'West']);
  marks.forEach((mark, i) => {
    near(mark.box.width, (plot.width * [435, 480, 60, 325][i]!) / 600, mark.id);
    near(mark.box.x, plot.x, `${mark.id} starts at the plot`);
    assert.equal(mark.shape, 'bar');
  });
  const thickness = marks.map((m) => m.box.height);
  assert.ok(thickness.every((t) => Math.abs(t - thickness[0]!) < 0.05));
  const tops = marks.map((m) => m.box.y);
  assert.deepEqual([...tops].sort((a, b) => a - b), tops);
  near(tops[1]! - tops[0]!, tops[2]! - tops[1]!, 'equal pitch');
  assert.ok(marks[3]!.box.y + marks[3]!.box.height <= plot.y + plot.height);
});

test('marks carry the brief attributes', () => {
  const layout = layoutChart(sheet({ rows: REGION_ROWS, columns: [sum('Sales')] }), regions, { width: 800, height: null }, desktop);
  const east = layout.marks[0]!;
  assert.equal(east.ariaLabel, 'East, Sales 435, bar 1 of 4');
  assert.equal(layout.marks[3]!.ariaLabel, 'West, Sales 325, bar 4 of 4');
  assert.equal(east.tooltip, 'Region: East; Sales: 435');
  assert.equal(east.value, '435');
  assert.equal(east.measure, 'Sales');
  assert.deepEqual(east.dims, ['East']);
  assert.equal(east.color, '233, 71, 159');
  assert.equal(east.pattern, 'solid');
  assert.equal(layout.legend.length, 0);
  assert.deepEqual(layout.dimensions, ['Region']);
});

test('vertical bars: the dimension on Columns, heights follow the ticks, left to right', () => {
  const layout = layoutChart(sheet({ rows: [sum('Sales')], columns: ['Region'] }), regions, { width: 800, height: null }, desktop);
  const { plot, marks } = layout;
  marks.forEach((mark, i) => {
    near(mark.box.height, (plot.height * [435, 480, 60, 325][i]!) / 600, mark.id);
    near(mark.box.y + mark.box.height, plot.y + plot.height, `${mark.id} sits on the baseline`);
  });
  const lefts = marks.map((m) => m.box.x);
  assert.deepEqual([...lefts].sort((a, b) => a - b), lefts);
  assert.equal(new Set(marks.map((m) => m.box.width)).size, 1);
});

test('a Color dimension stacks segments in Color member order', () => {
  const rows: Cell[][] = [
    ['East', 'Black', 150], ['East', 'Green', 210], ['East', 'Herbal', 75], ['North', 'Black', 150], ['North', 'Green', 210],
    ['North', 'Herbal', 120], ['South', 'Green', 30], ['South', 'Herbal', 30], ['West', 'Black', 280], ['West', 'Herbal', 45],
  ];
  const stacked = result('bar', [dim('Region'), dim('Category'), measure('Sales')], rows);
  const layout = layoutChart(sheet({ rows: REGION_ROWS, columns: [sum('Sales')], color: 'Category' }), stacked, { width: 800, height: null }, desktop);
  assert.deepEqual(ticksOf(layout), ['0', '200', '400', '600']);
  const east = layout.marks.filter((m) => m.dims[0] === 'East');
  assert.deepEqual(east.map((m) => m.dims[1]), ['Black', 'Green', 'Herbal']);
  near(east[0]!.box.x + east[0]!.box.width, east[1]!.box.x, 'segments touch');
  near(east[2]!.box.x + east[2]!.box.width - east[0]!.box.x, (layout.plot.width * 435) / 600, 'East total');
  assert.deepEqual(east.map((m) => [m.color, m.pattern]), [['233, 71, 159', 'solid'], ['26, 10, 20', 'dots'], ['217, 225, 63', 'stripes']]);
  assert.deepEqual(layout.legend.map((l) => l.text), ['Black', 'Green', 'Herbal']);
  assert.equal(layout.marks[0]!.ariaLabel, 'East, Black, Sales 150, bar 1 of 10');
  const west = layout.marks.filter((m) => m.dims[0] === 'West');
  assert.ok(west[1]!.box.y === west[0]!.box.y, 'a band holds its segments on one line');
});

test('a heat map colours cells by the sequential scale and outlines a null cell', () => {
  const rows: Cell[][] = [['East', 'Black', 150], ['East', 'Green', 210], ['South', 'Black', null], ['South', 'Green', 30], ['West', 'Black', 280]];
  const heat = result('heat_map', [dim('Region'), dim('Category'), measure('Sales')], rows);
  const layout = layoutChart(sheet({ rows: REGION_ROWS, columns: ['Category'], color: sum('Sales') }), heat, { width: 600, height: null }, desktop);
  const byId = new Map(layout.marks.map((m) => [m.id, m]));
  assert.equal(byId.get('East | Black')!.color, '243, 159, 205');
  assert.equal(byId.get('East | Green')!.color, '239, 119, 184');
  assert.equal(byId.get('South | Black')!.color, '');
  assert.equal(byId.get('South | Black')!.value, '');
  assert.equal(byId.get('South | Black')!.text, '(null)');
  assert.equal(byId.get('East | Black')!.text, '150');
  assert.equal(byId.get('East | Black')!.shape, 'cell');
  assert.equal(byId.get('East | Black')!.ariaLabel, 'East, Black, Sales 150, cell 1 of 5');
  assert.deepEqual(layout.legend.map((l) => l.text), ['30 to 280']);
  assert.equal(layout.ticks.length, 0);
  const east = byId.get('East | Black')!;
  const south = byId.get('South | Black')!;
  const green = byId.get('East | Green')!;
  assert.ok(south.box.y > east.box.y && green.box.x > east.box.x, 'rows go down, columns go right');
  assert.equal(byId.get('South | Black')!.tooltip, 'Region: South; Category: Black; Sales: (null)');
});

test('a line puts points at their values and draws the trend', () => {
  const months = result('line', [dim('Date'), measure('Sales')], [['2027-01', 530], ['2027-02', 440], ['2027-03', 350]], {
    trend: { slope: -90, intercept: 530 },
  });
  const layout = layoutChart(sheet({ rows: [sum('Sales')], columns: [{ field: 'Date', level: 'month' }], trend: true }), months, { width: 800, height: null }, desktop);
  assert.deepEqual(ticksOf(layout), ['0', '200', '400', '600']);
  const { plot, marks } = layout;
  marks.forEach((mark, i) => {
    const value = [530, 440, 350][i]!;
    near(mark.box.y + mark.box.height / 2, plot.y + plot.height - (plot.height * value) / 600, mark.id);
    assert.equal(mark.shape, 'point');
  });
  assert.equal(layout.series.length, 1);
  assert.equal(layout.series[0]!.runs[0]!.length, 3);
  const trend = layout.trend!.segment;
  near(trend.x1, marks[0]!.box.x + marks[0]!.box.width / 2, 'trend starts at the first point');
  near(trend.y1, marks[0]!.box.y + marks[0]!.box.height / 2, 'trend starts at 530');
  near(trend.y2, marks[2]!.box.y + marks[2]!.box.height / 2, 'trend ends at 350');
});

test('a scatter places points on both axes and sizes them by the Size measure', () => {
  const rows: Cell[][] = [['A', 40, 100, 1], ['B', 80, 200, 4], ['C', 0, 0, 9]];
  const scatter = result('scatter', [dim('Order'), measure('Units'), measure('Sales'), measure('Size')], rows);
  const layout = layoutChart(
    sheet({ rows: [sum('Units')], columns: [sum('Sales')], detail: ['Order'], size: sum('Size') }),
    result('scatter', [dim('Order'), measure('Units'), measure('Sales'), measure('Size')], rows), { width: 800, height: 500 }, desktop,
  );
  assert.equal(layout.kind, scatter.chart);
  const { plot, marks } = layout;
  const b = marks[1]!;
  near(b.box.x + b.box.width / 2, plot.x + (plot.width * 200) / 200, 'x of B');
  near(b.box.y + b.box.height / 2, plot.y + plot.height - (plot.height * 80) / 80, 'y of B');
  assert.ok(marks[2]!.radius > marks[1]!.radius && marks[1]!.radius > marks[0]!.radius);
  assert.ok(layout.ticks.length > 4);
});

test('reference lines and the text table', () => {
  const lines = result('bar', regions.columns, regions.rows, {
    reference_lines: [{ type: 'average', value: 325 }, { type: 'constant', value: 7 }],
  });
  const layout = layoutChart(sheet({ rows: REGION_ROWS, columns: [sum('Sales')] }), lines, { width: 800, height: null }, desktop);
  assert.deepEqual(layout.references.map((r) => r.type), ['Average', 'Constant']);
  near(layout.references[0]!.segment.x1, layout.plot.x + (layout.plot.width * 325) / 600, 'average');
  assert.equal(layout.references[0]!.label.text, 'Average 325');

  const whole = result('text_table', [measure('Sales')], [[1320]]);
  const table = layoutChart(sheet({ columns: [sum('Sales')] }), whole, { width: 800, height: null }, desktop);
  assert.equal(table.marks[0]!.id, 'all');
  assert.equal(table.marks[0]!.value, '1320');
  assert.equal(table.marks[0]!.shape, 'text');
  assert.equal(table.marks[0]!.text, '1,320');
  assert.equal(table.marks[0]!.ariaLabel, 'all, Sales 1,320, text 1 of 1');
});

test('the empty view lays out nothing', () => {
  const empty = layoutChart(sheet({}), result('none' as ChartKind, [], []), { width: 400, height: null }, desktop);
  assert.equal(empty.kind, 'none');
  assert.equal(empty.marks.length, 0);
});

test('below 768 px bars are 44 thick and points and cells have 44 x 44 tap areas', () => {
  const bars = layoutChart(sheet({ rows: REGION_ROWS, columns: [sum('Sales')] }), regions, { width: 360, height: 200 }, phone);
  assert.ok(bars.marks.every((m) => m.box.height >= 44), 'bars at least 44 thick');
  near(bars.marks[0]!.box.width, (bars.plot.width * 435) / 600, 'phone bar length');
  const tall = layoutChart(sheet({ rows: [sum('Sales')], columns: ['Region'] }), regions, { width: 360, height: null }, phone);
  assert.ok(tall.marks.every((m) => m.box.width >= 44));
  const points = result('scatter', [dim('Order'), measure('Units'), measure('Sales')], [['A', 1, 2], ['B', 1.1, 2.1]]);
  const dots = layoutChart(sheet({ rows: [sum('Units')], columns: [sum('Sales')], detail: ['Order'] }), points, { width: 360, height: null }, phone);
  assert.ok(dots.marks.every((m) => m.tap.width >= 44 && m.tap.height >= 44));
  const heat = result('heat_map', [dim('Region'), dim('Category'), measure('Sales')], [['East', 'Black', 1], ['East', 'Green', 2], ['North', 'Black', 3]]);
  const cells = layoutChart(sheet({ rows: REGION_ROWS, columns: ['Category'], color: sum('Sales') }), heat, { width: 360, height: null }, phone);
  assert.ok(cells.marks.every((m) => m.tap.width >= 44 && m.tap.height >= 44));
  assert.ok(cells.size.width >= 0 && cells.size.height > 0);
});

test('the layout is deterministic and cheap for 2000 marks', () => {
  const rows: Cell[][] = Array.from({ length: 2000 }, (_, i) => [`m${String(i).padStart(4, '0')}`, (i * 37) % 1000]);
  const big = result('bar', [dim('Item'), measure('Sales')], rows);
  const shape = sheet({ rows: ['Item'], columns: [sum('Sales')] });
  const started = performance.now();
  const first = layoutChart(shape, big, { width: 1000, height: null }, desktop);
  const elapsed = performance.now() - started;
  assert.equal(first.marks.length, 2000);
  assert.ok(elapsed < 500, `took ${elapsed} ms`);
  assert.equal(JSON.stringify(first), JSON.stringify(layoutChart(shape, big, { width: 1000, height: null }, desktop)));
});

test('shares read as percents on the axis and in the label', () => {
  const pill: MeasurePill = { field: 'Sales', agg: 'SUM', table_calc: { kind: 'share', using: 'table_down', fields: [] } };
  const shares = result('bar', [dim('Region'), { name: 'Percent of total of Sales', role: 'measure', share: true }], [['East', 0.3346], ['North', 0.3692]]);
  const layout = layoutChart(sheet({ rows: REGION_ROWS, columns: [pill] }), shares, { width: 800, height: null }, desktop);
  assert.deepEqual(ticksOf(layout), ['0%', '10%', '20%', '30%', '40%']);
  assert.equal(layout.marks[0]!.ariaLabel, 'East, Percent of total of Sales 33.5%, bar 1 of 2');
  assert.equal(layout.marks[0]!.value, '0.3346');
});
