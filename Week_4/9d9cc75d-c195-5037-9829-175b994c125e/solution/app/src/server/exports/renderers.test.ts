import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Filter, MeasurePill, QueryResult, SheetShape } from '../../shared/model.ts';
import { renderCsv } from './csv.ts';
import type { ExportDocument } from './document.ts';
import { filterLine, pdfLines, renderPdf } from './pdf.ts';
import { PNG_HEIGHT, PNG_WIDTH, renderPng } from './png.ts';

const fontDir = fileURLToPath(new URL('../../../public/fonts', import.meta.url));
const sum: MeasurePill = { field: 'Total price', agg: 'SUM', table_calc: null };

function sheet(name: string): SheetShape {
  return {
    name, rows: ['Item'], columns: [sum], color: null, size: null, label: [], detail: [], filters: [], chart: 'automatic',
    totals: true, reference_lines: [], trend: false, sort: {},
  };
}

const result: QueryResult = {
  gen: 1,
  chart: 'bar',
  columns: [{ name: 'Item', role: 'dimension' }, { name: 'Total price', role: 'measure' }],
  rows: [['=SUM(A1)', 10], ['-dash', 1200], ['plain, "quoted"', -5], ['\tindented', 3], [-7, 4], [null, 1.5]],
  total: [null, 1213.5],
  reference_lines: [],
  trend: null,
  notices: [],
};

const filter = (extra: Partial<Filter>): Filter => ({
  field: 'Total price', step: 'measure', values: [], n: null, by: null, min: null, max: null, agg: null, table_calc: null, ...extra,
});

function document(dashboard = false): ExportDocument {
  const frame = dashboard ? { x: 0, y: 0, width: 640, height: 400 } : null;
  const blocks = [{ name: 'Orders by item', sheet: sheet('Orders by item'), result, frame }];
  if (dashboard) blocks.push({ name: 'Second, sheet', sheet: sheet('Second, sheet'), result, frame: { x: 640, y: 0, width: 640, height: 400 } });
  return { name: dashboard ? 'Board' : 'Orders by item', dashboard, filters: [], parameters: {}, blocks };
}

test('csv: header and rows as the twin shows them, no separators, formulas neutralised, numbers untouched', () => {
  const bytes = renderCsv(document());
  assert.notEqual(bytes[0], 0xef);
  assert.deepEqual(bytes.toString('utf8').split('\r\n'), [
    'Item,Total price',
    "'=SUM(A1),10",
    "'-dash,1200",
    '"plain, ""quoted""",-5',
    "'\tindented,3",
    '-7,4',
    '(null),1.5',
    'Grand total,1213.5',
    '',
  ]);
});

test('csv: a dashboard writes each sheet after a line with its name, with one empty line between blocks', () => {
  const lines = renderCsv(document(true)).toString('utf8').split('\r\n');
  assert.equal(lines[0], 'Orders by item');
  assert.equal(lines[1], 'Item,Total price');
  const second = lines.indexOf('"Second, sheet"');
  assert.equal(lines[second - 1], '');
  assert.equal(lines[second + 1], 'Item,Total price');
});

test('pdf lines: name, one line per filter, then each sheet with its header and rows joined by a bar', () => {
  const lines = pdfLines(document()).map((line) => line.text);
  assert.deepEqual(lines.slice(0, 5), ['Orders by item', 'Filters: none', 'Orders by item', 'Item | Total price', '=SUM(A1) | 10']);
  assert.ok(lines.includes('-dash | 1,200'));
  assert.equal(lines.at(-1), 'Grand total | 1,213.5');
});

test('filter lines follow the brief', () => {
  const none = {};
  assert.equal(filterLine(filter({ step: 'dimension', field: 'Region', values: ['East', null] }), none), 'Filters: Region is East, (null)');
  assert.equal(filterLine(filter({ min: 3 }), none), 'Filters: Total price is at least 3');
  assert.equal(filterLine(filter({ max: 1200 }), none), 'Filters: Total price is at most 1,200');
  assert.equal(filterLine(filter({ min: 3, max: 40.5 }), none), 'Filters: Total price is 3 to 40.5');
  assert.equal(filterLine(filter({ step: 'top', field: 'Region', n: 2, by: sum }), none), 'Filters: Region is top 2 by Total price');
  assert.equal(filterLine(filter({ step: 'top', field: 'Region', n: '@Count', by: sum }), { Count: 3 }), 'Filters: Region is top 3 by Total price');
});

test('pdf: a real PDF whose text carries the lines', () => {
  const withFilter = { ...document(), filters: [filter({ min: 3 })] };
  const pdf = renderPdf(withFilter, fontDir);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  const text = spawnSync('pdftotext', ['-layout', '-', '-'], { input: pdf });
  if (text.error) return;
  const out = text.stdout.toString('utf8');
  assert.ok(out.includes('Filters: Total price is at least 3'));
  assert.ok(out.includes('Grand total | 1,213.5'));
});

test('png: 1200 x 800 and not blank, for a sheet and for a dashboard', () => {
  for (const dashboard of [false, true]) {
    const png = renderPng(document(dashboard), fontDir);
    assert.equal(png.subarray(0, 8).toString('latin1'), '\x89PNG\r\n\x1a\n');
    assert.equal(png.readUInt32BE(16), PNG_WIDTH);
    assert.equal(png.readUInt32BE(20), PNG_HEIGHT);
    assert.ok(new Set(png).size > 50);
  }
});
