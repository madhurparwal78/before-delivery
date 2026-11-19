import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Cell } from '../../../shared/model.ts';
import { calculations, LIMITS, M, records, result, sample, sheet } from '../fixture.test.ts';
import { checkFormula, validateCalculation } from './calculation.ts';
import { toDisplayFormula, toStoredFormula } from './names.ts';

const scope = (calcs: Record<string, string> = {}) => ({
  dataset: sample,
  calculations: calculations(calcs),
  parameters: [{ id: 'p1', name: 'Top count', type: 'number' as const, value: 2, values: [] }],
  sets: [{ id: 's1', name: 'Top regions', field: 'Region', top: { n: '@Top count', by: M('Sales') } }],
});
const check = (formula: string, calcs: Record<string, string> = {}) => checkFormula(formula, scope(calcs), LIMITS);
const error = (formula: string, calcs: Record<string, string> = {}) => {
  const checked = check(formula, calcs);
  assert.equal(checked.valid, false, formula);
  return checked.valid ? null : [checked.message, checked.line, checked.column];
};

test('the published error examples', () => {
  assert.deepEqual(error('SUM([Salez]) +'), ['Line 1, column 15: formula ended early.', 1, 15]);
  assert.deepEqual(error('SUM([Salez])'), ['Line 1, column 5: unknown field "Salez".', 1, 5]);
  assert.deepEqual(error('SUM([Product])'), ['Line 1, column 5: SUM argument 1 must be number, found text.', 1, 5]);
  assert.deepEqual(error('SUM([Sales]) / [Units]'), ['Line 1, column 16: cannot mix aggregate and row values.', 1, 16]);
  assert.deepEqual(error('MAX(1))'), ['Line 1, column 7: unexpected ")".', 1, 7]);
  assert.deepEqual(error('SUM([Sales])\n    + [Unitz]'), ['Line 2, column 7: unknown field "Unitz".', 2, 7]);
  assert.deepEqual(error('avg([Sales])'), ['Line 1, column 1: unknown function "avg".', 1, 1]);
  assert.deepEqual(error('POW(4)'), ['Line 1, column 1: unknown function "POW".', 1, 1]);
  assert.deepEqual(error('ABS(1, 2, 3)'), ['Line 1, column 1: ABS expects 1 arguments, found 3.', 1, 1]);
  assert.deepEqual(error('[@Nope] + 1'), ['Line 1, column 1: unknown parameter "Nope".', 1, 1]);
});

test('length and depth limits, exactly the limit allowed', () => {
  assert.deepEqual(error('1'.repeat(2001)), ['Formula is 2,001 characters. The limit is 2,000.', null, null]);
  assert.equal(check('1'.repeat(2000)).valid, true);
  assert.deepEqual(error(`${'('.repeat(17)}1${')'.repeat(17)}`), ['Line 1, column 17: nested deeper than 16 levels.', 1, 17]);
  assert.equal(check(`${'('.repeat(16)}1${')'.repeat(16)}`).valid, true);
  assert.deepEqual(error('ABS(ABS(1)'), ['Line 1, column 11: formula ended early.', 1, 11]);
});

test('a syntax error wins over nesting, and checks keep their order', () => {
  assert.deepEqual(error(`${'('.repeat(20)}1 +`), ['Line 1, column 24: formula ended early.', 1, 24]);
  assert.deepEqual(error('ABS([Salez], 1)'), ['Line 1, column 5: unknown field "Salez".', 1, 5]);
  assert.deepEqual(error("'a' + UPPER(1)"), ['Line 1, column 1: + argument 1 must be number, found text.', 1, 1]);
  assert.deepEqual(error("[Units] = 'x'"), ['Line 1, column 9: cannot compare number with text.', 1, 9]);
  assert.deepEqual(error('SUM(SUM([Sales]))'), ['Line 1, column 5: cannot mix aggregate and row values.', 1, 5]);
  assert.deepEqual(error('RUN_TOTAL([Sales])'), ['Line 1, column 11: cannot mix aggregate and row values.', 1, 11]);
  assert.deepEqual(error('{AT [Region] : {SUM([Sales])}}'), ['Line 1, column 16: cannot mix aggregate and row values.', 1, 16]);
  assert.deepEqual(error('{AT [Region] : SUM({SUM([Sales])})}'), [
    'Line 1, column 20: a level-of-detail expression cannot contain another.',
    1,
    20,
  ]);
  assert.deepEqual(error('{RANK_OF(SUM([Sales]))}'), [
    'Line 1, column 2: a table calculation cannot appear inside a level-of-detail expression.',
    1,
    2,
  ]);
  assert.deepEqual(error('{AT [Sales] : SUM([Units])}'), ['Line 1, column 5: AT argument 1 must be dimension, found measure.', 1, 5]);
  assert.deepEqual(error('"x"'), ['Line 1, column 1: unexpected """.', 1, 1]);
});

test('a formula check answers fast for a formula far over the limit', () => {
  const started = performance.now();
  assert.equal(check('('.repeat(999000)).valid, false);
  assert.equal(check(`${'('.repeat(999)}1${')'.repeat(999)}`).valid, false);
  const huge = checkFormula('('.repeat(1000000), scope(), { formulaMaxChars: 2000000, formulaMaxDepth: 16 });
  assert.equal(huge.valid, false);
  assert.ok(performance.now() - started < 1000);
});

test('types and aggregation of valid formulas', () => {
  assert.deepEqual(check('{AT [Region] : SUM([Sales])}'), { valid: true, type: 'number', aggregate: false });
  assert.deepEqual(check("IF([Units] > 4, 'big', 'small')"), { valid: true, type: 'text', aggregate: false });
  assert.deepEqual(check('COUNT([Order]) - [@Top count]'), { valid: true, type: 'number', aggregate: true });
  assert.deepEqual(check('[Top regions] AND TRUE'), { valid: true, type: 'boolean', aggregate: false });
  for (const formula of ['RUN_TOTAL(SUM([Sales]))', 'PREV_DIFF(SUM([Sales]))', 'SHARE(SUM([Sales]))', 'RANK_OF(SUM([Sales]))']) {
    assert.deepEqual(check(formula), { valid: true, type: 'number', aggregate: true });
  }
  assert.deepEqual(check('[Running] * 2', { Running: 'RUN_TOTAL(SUM([Sales]))' }), { valid: true, type: 'number', aggregate: true });
  assert.deepEqual(error('[Running] + [Units]', { Running: 'SUM([Sales])' }), ['Line 1, column 13: cannot mix aggregate and row values.', 1, 13]);
  assert.equal(check('TEXT([Date])').valid && check('TEXT([Date])').valid, true);
});

test('saving: names, formula errors and cycles', () => {
  const saved = scope({ A: '1', B: '[A] + 1' });
  const pair = scope({ X: '1', Y: '[X] + 1' });
  const x = pair.calculations[0];
  assert.deepEqual(validateCalculation({ id: x?.id ?? null, name: 'X', formula: '[Y] + 1' }, pair, LIMITS), {
    formula: 'Cycle: X -> Y -> X.',
  });
  const three = scope({ A: '1', B: '[C] + 1', C: '[A] + 1' });
  assert.deepEqual(validateCalculation({ id: 'c0', name: 'A', formula: '[B]' }, three, LIMITS), { formula: 'Cycle: A -> B -> C -> A.' });
  assert.deepEqual(validateCalculation({ id: 'c0', name: 'A', formula: '[A] + 1' }, saved, LIMITS), { formula: 'Cycle: A -> A.' });
  assert.deepEqual(validateCalculation({ id: null, name: ' ', formula: '1' }, saved, LIMITS), { name: 'Name is required.' });
  assert.deepEqual(validateCalculation({ id: null, name: 'Sales', formula: 'SUM([Salez])' }, saved, LIMITS), {
    name: 'A field named Sales already exists.',
    formula: 'Line 1, column 5: unknown field "Salez".',
  });
  assert.deepEqual(validateCalculation({ id: null, name: 'C', formula: '[B] * 2' }, saved, LIMITS), {});
});

test('stored formulas carry ids, so a rename shows in the display formula', () => {
  const s = scope({ A: '1' });
  const stored = toStoredFormula("{AT [Region] : SUM([Sales])} + [A] + [@Top count] + LEN('[Sales]')", s);
  const sales = sample.byName.get('Sales')?.id ?? '';
  assert.ok(stored.includes(`[${sales}]`) && stored.includes('[c0]') && stored.includes('[@p1]') && stored.includes("'[Sales]'"));
  assert.equal(toDisplayFormula(stored, s), "{AT [Region] : SUM([Sales])} + [A] + [@Top count] + LEN('[Sales]')");
  const renamed = { ...s, dataset: { ...sample, fields: sample.fields.map((f) => (f.name === 'Sales' ? { ...f, name: 'Revenue' } : f)) } };
  assert.equal(toDisplayFormula(toStoredFormula('{AT [Region] : SUM([Sales])}', s), renamed), '{AT [Region] : SUM([Revenue])}');
});

const rowCases: [string, string, Record<string, Cell>][] = [
  ["IF([Units] > 4, 'big', 'small')", 'dim', { 1: 'small', 16: 'small' }],
  ['IFNULL([Sales], 0)', 'num', { 16: 0 }],
  ['ISNULL([Units])', 'dim', { 16: true }],
  ['ABS(-135)', 'num', { 1: 135 }],
  ['ROUND(-2.5, 0)', 'num', { 1: -3 }],
  ["UPPER('Moss Sencha')", 'dim', { 1: 'MOSS SENCHA' }],
  ["LOWER('Moss Sencha')", 'dim', { 1: 'moss sencha' }],
  ["LEN('Quiet Mint')", 'num', { 1: 10 }],
  ["LEFT('Ember Assam', 5)", 'dim', { 1: 'Ember' }],
  ["RIGHT('Ember Assam', 5)", 'dim', { 1: 'Assam' }],
  ["CONTAINS('Dusk Blend', 'Blend')", 'dim', { 1: true }],
  ["PART_OF([Date], 'year')", 'num', { 5: 2027 }],
  ["PART_OF([Date], 'month')", 'num', { 5: 1 }],
  ["PART_OF([Date], 'week')", 'num', { 5: 3 }],
  ["PART_OF([Date], 'day')", 'num', { 5: 20 }],
  ["PART_OF([Date], 'weekday')", 'num', { 5: 3 }],
  ["TEXT(TRUNC_TO([Date], 'year'))", 'dim', { 5: '2027-01-01' }],
  ["TEXT(TRUNC_TO([Date], 'month'))", 'dim', { 5: '2027-01-01' }],
  ["TEXT(TRUNC_TO([Date], 'week'))", 'dim', { 5: '2027-01-18' }],
  ["DAYS_BETWEEN(TRUNC_TO([Date], 'month'), [Date])", 'num', { 16: 15 }],
  ["NUM('12.5')", 'num', { 1: 12.5 }],
  ["NUM('tea')", 'num', { 1: null }],
  ['TEXT(12.5)', 'dim', { 1: '12.5' }],
  ['TEXT([Date])', 'dim', { 5: '2027-01-20' }],
  ['-7 % 3', 'num', { 1: -1 }],
  ['5 / 0', 'num', { 1: null }],
  ['5 % 0', 'num', { 1: null }],
  ['NOT NULL', 'dim', { 1: null }],
  ['TRUE OR NULL', 'dim', { 1: true }],
  ['FALSE AND NULL', 'dim', { 1: false }],
  ["'a' & NULL", 'dim', { 1: null }],
  ["IF(NULL, 'yes', 'no')", 'dim', { 1: 'no' }],
  ['1 + NULL', 'num', { 1: null }],
  ["'it''s'", 'dim', { 1: "it's" }],
];

test('the function examples, row by row', async () => {
  for (const [formula, kind, expected] of rowCases) {
    const shape = kind === 'dim' ? sheet({ rows: ['Order', 'X'] }) : sheet({ rows: ['Order'], label: [M('X')] });
    const rows = records(await result(shape, { calcs: { X: formula } }));
    const byOrder = new Map(rows.map((r) => [String(r.Order), r.X]));
    for (const [order, want] of Object.entries(expected)) assert.deepEqual(byOrder.get(order), want, `${formula} on Order ${order}`);
  }
});

test('the aggregate examples', async () => {
  const cases: [string, number][] = [
    ['SUM([Sales])', 1320],
    ['AVG([Sales])', 88],
    ['MEDIAN([Sales])', 80],
    ['MIN([Sales])', 20],
    ['MAX([Sales])', 210],
    ['COUNT([Sales])', 15],
    ['COUNT([Order])', 16],
    ['COUNT_UNIQUE([Product])', 4],
  ];
  for (const [formula, want] of cases) {
    const lod = records(await result(sheet({ rows: ['Category'], label: [M('X', 'AVG')] }), { calcs: { X: `{${formula}}` } }));
    assert.deepEqual(lod.map((r) => r['AVG X']), [want, want, want], formula);
    const whole = records(await result(sheet({ label: [M('X')] }), { calcs: { X: formula } }));
    assert.deepEqual(whole.map((r) => r.X), [want], formula);
  }
  const empty = records(await result(sheet({ label: [M('S'), M('C')] }), { calcs: { S: 'SUM([Sales])', C: 'COUNT([Sales])' }, filters: [{ field: 'Order', step: 'source', values: [16], n: null, by: null, min: null, max: null, agg: null, table_calc: null }] }));
  assert.deepEqual(empty, [{ S: null, C: 0 }]);
});
