import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Answers, FormDefinition, Question } from '../../shared/types.ts';
import { M11 } from '../../shared/messages.ts';
import { env, calculatedQuestion, dateQuestion, form, numberQuestion, option, page, textQuestion } from './fixtures.ts';
import { definitionProblems } from './index.ts';
import { resolve } from './index.ts';

/** The shown text of a calculated field `c` with the given formula, over a fixed set of questions. */
function shown(formula: string, answers: Answers = {}, extra: Partial<Question> = {}): string {
  const definition = form([page('p', 'P', [
    numberQuestion('a', 'A'),
    numberQuestion('b', 'B'),
    textQuestion('n', 'N'),
    dateQuestion('s', 'S'),
    dateQuestion('e', 'E'),
    calculatedQuestion('c', 'C', formula, extra),
  ])]);
  const calc = resolve(definition, answers, env).questions.find((question) => question.key === 'c')?.calc;
  assert.ok(calc, 'the calculated field resolves');
  return calc.text;
}

const TOO_LARGE = 'Cannot calculate: the number is too large.';
const BAD_POWER = 'Cannot calculate: the power must be a whole number from 0 to 64.';

const ARITHMETIC: [string, string][] = [
  ['0.1 + 0.2', '0.3'],
  ['1.1 * 3', '3.3'],
  ['ROUND(2.675, 2)', '2.68'],
  ['ROUND(1.005, 2)', '1.01'],
  ['ROUND(-2.5, 0)', '-3'],
  ['ROUND(1234.5678, -2)', '1200'],
  ['2 + 3 * 4 ^ 2', '50'],
  ['-2 ^ 2', '-4'],
  ['2 ^ 3 ^ 2', '512'],
  ['(2 + 3) * 4', '20'],
  ['7 % 3', '1'],
  ['-7 % 3', '2'],
  ['10 / 4', '2.5'],
  ['1 / 3 * 3', '0.999999999999'],
  ['2 ^ 0.5', BAD_POWER],
  ['1 / 0', 'Cannot calculate: division by zero.'],
  ['5 % 0', 'Cannot calculate: division by zero.'],
  ['2 ^ 65', BAD_POWER],
  ['(10 ^ 60) ^ 20', TOO_LARGE],
  ['FLOOR(-1.5)', '-2'],
  ['CEIL(-1.5)', '-1'],
  ['DATE("2026-02-30")', 'Cannot calculate: it needs a date written YYYY-MM-DD.'],
  ['"a" + 1', 'Cannot calculate: it needs a number.'],
];

for (const [formula, expected] of ARITHMETIC) {
  test(`arithmetic: ${formula} is ${expected}`, () => {
    assert.equal(shown(formula), expected);
  });
}

const PLACES: [string, number, string][] = [
  ['7 / 3', 2, '2.33'],
  ['1 / 3 * 3', 2, '1.00'],
  ['0.125', 2, '0.13'],
  ['2.5', 0, '3'],
  ['19.999', 2, '20.00'],
];

for (const [formula, places, expected] of PLACES) {
  test(`places: ${formula} at ${places} places shows ${expected}`, () => {
    assert.equal(shown(formula, {}, { places }), expected);
  });
}

test('prefix and suffix wrap numbers only and later formulas use the unrounded value', () => {
  assert.equal(shown('7 / 3', {}, { places: 2, prefix: '£', suffix: ' each' }), '£2.33 each');
  assert.equal(shown('"x"', {}, { prefix: '£' }), 'x');
  const definition = form([page('p', 'P', [
    calculatedQuestion('third', 'Third', '1 / 3', { places: 2 }),
    calculatedQuestion('triple', 'Triple', '{third} * 3', { places: 2 }),
    calculatedQuestion('exact', 'Exact', '{third} * 3'),
  ])]);
  const questions = resolve(definition, {}, env).questions;
  assert.deepEqual(questions.map((question) => question.calc?.text), ['0.33', '1.00', '0.999999999999']);
  assert.deepEqual(questions.map((question) => question.calc?.value), ['0.333333333333', '0.999999999999', '0.999999999999']);
});

const WORKED_ANSWERS: Answers = { n: '  ana   maria ', s: '2026-03-14', e: '2026-03-01' };
const WORKED: [string, string][] = [
  ['UPPER("ada")', 'ADA'],
  ['LOWER("ADA")', 'ada'],
  ['TRIM({n})', 'ana maria'],
  ['LEN("héllo")', '5'],
  ['"Yes" = "yes"', 'true'],
  ['1 & " of " & 2', '1 of 2'],
  ['"10" = 10', 'false'],
  ['DAYS({s}, {e})', '13'],
  ['DAYS({e}, {s})', '-13'],
  ['ADD_DAYS({s}, 20)', '3 Apr 2026'],
  ['ADD_DAYS(DATE("2026-02-27"), 2)', '1 Mar 2026'],
  ['{s} > {e}', 'true'],
  ['TODAY()', '16 Mar 2026'],
  ['DAYS(TODAY(), DATE("2026-01-01"))', '74'],
  ['"Due " & ADD_DAYS({s}, 1)', 'Due 15 Mar 2026'],
];

for (const [formula, expected] of WORKED) {
  test(`functions: ${formula} is ${expected}`, () => {
    assert.equal(shown(formula, WORKED_ANSWERS), expected);
  });
}

const BLANK_ANSWERS: Answers = { b: '4' };
const BLANKS: [string, string][] = [
  ['{a} + 5', '5'],
  ['{a} * 5', '0'],
  ['{a} & "x"', 'x'],
  ['{a} = 0', 'false'],
  ['{a} = ""', 'true'],
  ['{a} > 3', 'false'],
  ['{a} < 3', 'false'],
  ['{a} <> 3', 'true'],
  ['BLANK({a})', 'true'],
  ['SUM({a}, {b})', '4'],
  ['AVG({a}, {b})', '4'],
  ['MIN({a}, {b})', '4'],
  ['MAX({a})', M11],
  ['COUNT({a}, {b})', '1'],
  ['ROUND({a}, 2)', M11],
  ['{a}', M11],
  ['DAYS({a}, {b})', M11],
  ['NOT {a}', 'true'],
  ['IF({a}, 1, 2)', '2'],
  ['LEN({a})', '0'],
];

for (const [formula, expected] of BLANKS) {
  test(`blanks: ${formula} is ${expected}`, () => {
    assert.equal(shown(formula, BLANK_ANSWERS), expected);
  });
}

test('operators: precedence, short-circuit and comparison rules', () => {
  assert.equal(shown('1 + 2 & 3'), '33');
  assert.equal(shown('NOT 1 = 2'), 'true');
  assert.equal(shown('1 = 1 OR 1 / 0'), 'true');
  assert.equal(shown('0 AND 1 / 0'), 'false');
  assert.equal(shown('IF(1, 5, 1 / 0)'), '5');
  assert.equal(shown('true AND false OR TRUE'), 'true');
  assert.equal(shown('2 ^ -1'), BAD_POWER);
  assert.equal(shown('--3'), '3');
  assert.equal(shown('"a" < 1'), 'Cannot calculate: these answers cannot be compared.');
  assert.equal(shown('"abc" < "ABD"'), 'true');
  assert.equal(shown('TRUE < FALSE'), 'Cannot calculate: these answers cannot be compared.');
  assert.equal(shown('"a" <> 1'), 'true');
  assert.equal(shown('TRUE = 1'), 'false');
});

test('functions: aggregate, rounding and date edge cases', () => {
  assert.equal(shown('SUM()'), M11);
  assert.equal(shown('SUM({a})', {}), '0');
  assert.equal(shown('MAX(3, 9, 4)'), '9');
  assert.equal(shown('MIN(3, 9, 4)'), '3');
  assert.equal(shown('AVG(1, 2)'), '1.5');
  assert.equal(shown('AVG(1, 2, 2)'), '1.666666666667');
  assert.equal(shown('COUNT("", "x", 0)'), '2');
  assert.equal(shown('ABS(-4.5)'), '4.5');
  assert.equal(shown('CEIL(1.2)'), '2');
  assert.equal(shown('FLOOR(1.9)'), '1');
  assert.equal(shown('ROUND(5, 99999999999)'), '5');
  assert.equal(shown('ROUND(5, -99999999999)'), '0');
  assert.equal(shown('ROUND(15, -1)'), '20');
  assert.equal(shown('ROUND(1.5, 0.9)'), '2');
  assert.equal(shown('ADD_DAYS(DATE("2026-03-14"), -14.9)'), '28 Feb 2026');
  assert.equal(shown('ADD_DAYS(DATE("9999-12-31"), 1)'), 'Cannot calculate: it needs a date written YYYY-MM-DD.');
  assert.equal(shown('ADD_DAYS(DATE("2026-03-14"), 99999999999999)'), 'Cannot calculate: it needs a date written YYYY-MM-DD.');
  assert.equal(shown('DATE({n})', { n: '2026-03-14' }), '14 Mar 2026');
  assert.equal(shown('DATE({n})'), M11);
  assert.equal(shown('LEN(12.50)'), '4');
  assert.equal(shown('UPPER(TODAY())'), '16 MAR 2026');
  assert.equal(shown('TRIM("  a   b ")'), 'a b');
  assert.equal(shown('NOT TRUE'), 'false');
});

test('references: typed answers, invalid numbers and dates are blank, grid rows and tick lists', () => {
  assert.equal(shown('{a} + 1', { a: 'abc' }), '1');
  assert.equal(shown('BLANK({s})', { s: '2026-02-30' }), 'true');
  assert.equal(shown('{a} + 1', { a: ' 3.50 ' }), '4.5');
  const definition = form([page('p', 'P', [
    { key: 'g', type: 'grid', label: 'G', rows: [option('r1')], columns: [option('x'), option('y')] },
    { key: 't', type: 'checkbox', label: 'T', options: [option('x'), option('y')] },
    { key: 'r', type: 'ranking', label: 'R', options: [option('x'), option('y')] },
    calculatedQuestion('row', 'Row', '{g.r1} & "!"'),
    calculatedQuestion('has', 'Has', 'HAS({t}, "y")'),
    calculatedQuestion('ticks', 'Ticks', 'TICKED({t})'),
    calculatedQuestion('anyRank', 'Rank', 'COUNT({r}, {g}) & BLANK({t})'),
  ])]);
  const answers: Answers = { g: { r1: 'y' }, t: ['x', 'y'], r: ['y', 'x'] };
  const texts = (given: Answers): (string | undefined)[] =>
    resolve(definition, given, env).questions.slice(3).map((question) => question.calc?.text);
  assert.deepEqual(texts(answers), ['y!', 'true', '2', '2false']);
  assert.deepEqual(texts({}), ['!', 'false', '0', '0true']);
});

test('limits: exactly 1,000 digits is allowed, one more is too large', () => {
  const thousand = '9'.repeat(1000);
  assert.equal(shown('{a} + 0', { a: thousand }), thousand);
  assert.equal(shown('{a} + 1', { a: thousand }), TOO_LARGE);
  assert.equal(shown('{a}', { a: '9'.repeat(1001) }), TOO_LARGE);
  assert.equal(shown('{a} * {a}', { a: '9'.repeat(600) }), TOO_LARGE);
  assert.equal(shown('0.5 ^ 64'), '0.0000000000000000000542101086242752217003726400434970855712890625');
});

test('limits: oversized work finishes at once', () => {
  const started = Date.now();
  const nested = '((((((((((((((((10 ^ 64) ^ 64) ^ 64) ^ 64) ^ 64) ^ 64) ^ 64) ^ 64) ^ 64) ^ 64) ^ 64) ^ 64) ^ 64) ^ 64) ^ 64) ^ 64) ^ 64';
  assert.equal(shown(nested), TOO_LARGE);
  assert.equal(shown('ROUND(1, -1000000000)'), '0');
  assert.equal(shown('{a} / {a}', { a: '7'.repeat(1000) }), '1');
  assert.equal(shown('{a} % 3', { a: '7'.repeat(1000) }), '1');
  assert.ok(Date.now() - started < 1000, 'every evaluation answers well within a second');
});

/** The calculated field, a ranking, a checkbox and a later question: the DP-04 draft of the reference tests. */
const DRAFT: FormDefinition = form([
  page('p1', 'First', [
    { key: 'rk', type: 'ranking', label: 'Order', options: [option('x'), option('y')] },
    { key: 't', type: 'checkbox', label: 'Ticks', options: [option('x'), option('y')] },
    numberQuestion('a', 'Amount'),
    calculatedQuestion('c', 'Result', '{a}'),
  ]),
  page('p2', 'Second', [numberQuestion('d', 'Later')]),
]);

function formulaRefusal(formula: string): string | null {
  const definition: FormDefinition = {
    ...DRAFT,
    pages: DRAFT.pages.map((candidate) => ({
      ...candidate,
      questions: candidate.questions.map((question) => (question.key === 'c' ? { ...question, formula } : question)),
    })),
  };
  return definitionProblems(definition, env).find((problem) => problem.key === 'c' && problem.field === 'formula')?.message ?? null;
}

const REFUSALS: [string, string][] = [
  ['', 'Column 1: the formula is empty.'],
  ['1 +', 'Column 4: the formula ends too early.'],
  ['(1 + 2', 'Column 7: a closing bracket is missing.'],
  ['SUM(1', 'Column 6: a closing bracket is missing.'],
  ['1 $ 2', 'Column 3: unexpected character $.'],
  ['"open', 'Column 1: this text has no closing quote.'],
  ['ROUND(1)', 'Column 1: ROUND takes 2 values.'],
  ['IF(1, 2)', 'Column 1: IF takes 3 values.'],
  ['SUMM(1)', 'Column 1: there is no function called SUMM.'],
  ['1 2', 'Column 3: unexpected 2.'],
  ['foo', 'Column 1: unexpected foo.'],
  ['TODAY(1)', 'Column 1: TODAY takes 0 values.'],
  ['SUM()', 'Column 1: SUM takes at least 1 value.'],
  ['FLOOR(1, 2)', 'Column 1: FLOOR takes 1 value.'],
  [')', 'Column 1: unexpected ).'],
  ['process.exit()', 'Column 8: unexpected character ..'],
  ['constructor.constructor(1)', 'Column 12: unexpected character ..'],
  ['1'.repeat(501), 'The formula is longer than 500 characters.'],
  [`${'('.repeat(17)}1${')'.repeat(17)}`, 'The formula has more than 16 levels of brackets.'],
  ['{zz} + 1', 'Column 1: there is no question called {zz}.'],
  ['1 + {d}', 'Column 5: {d} comes later in the form, so it cannot be used here.'],
  ['{c} + 1', 'Column 1: a calculated field cannot use itself.'],
  ['{t} + 1', 'Column 1: {t} can only be used inside HAS, TICKED, BLANK or COUNT.'],
  ['{rk} + 1', 'Column 1: {rk} can only be used inside BLANK or COUNT.'],
  ['1 < 2 < 3', 'Column 7: unexpected <.'],
  ['SUM(1,)', 'Column 7: unexpected ).'],
  ['SUM(1 2)', 'Column 7: unexpected 2.'],
  ['1 + {a.row}', 'Column 5: there is no question called {a.row}.'],
  ['{x', 'Column 1: unexpected character {.'],
  ['"a" $ "open', 'Column 5: unexpected character $.'],
];

for (const [formula, expected] of REFUSALS) {
  test(`refusal: ${JSON.stringify(formula.slice(0, 40))}`, () => {
    assert.equal(formulaRefusal(formula), expected);
  });
}

test('refusal: formulas exactly at the caps are allowed', () => {
  assert.equal(formulaRefusal('1'.repeat(500)), null);
  assert.equal(formulaRefusal(`${'('.repeat(16)}1${')'.repeat(16)}`), null);
  assert.equal(formulaRefusal('1'.repeat(501)), 'The formula is longer than 500 characters.');
});

test('refusal: references allowed by BLANK, COUNT, HAS and TICKED', () => {
  assert.equal(formulaRefusal('COUNT({rk}, {t}) + TICKED({t})'), null);
  assert.equal(formulaRefusal('IF(HAS({t}, "x"), BLANK({rk}), 1)'), null);
  assert.equal(formulaRefusal('HAS({rk}, "x")'), 'Column 5: {rk} can only be used inside BLANK or COUNT.');
});

test('refusal: caps follow the configured limits and are reported after the characters', () => {
  const small = { ...env, formulaMaxChars: 5, formulaMaxDepth: 1 };
  const definition = form([page('p', 'P', [calculatedQuestion('c', 'C', '1 + 2 + 3')])]);
  const message = (formula: string): string | undefined =>
    definitionProblems({ ...definition, pages: [page('p', 'P', [calculatedQuestion('c', 'C', formula)])] }, small)[0]?.message;
  assert.equal(message('1 + 2 + 3'), 'The formula is longer than 5 characters.');
  assert.equal(message('((1))'), 'The formula has more than 1 levels of brackets.');
  assert.equal(message('1 + $ + 2'), 'Column 5: unexpected character $.');
});
