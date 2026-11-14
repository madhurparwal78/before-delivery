import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Answers, FormDefinition, Question } from '../../shared/types.ts';
import { BUDGET, calculatedQuestion, dateQuestion, env, form, numberQuestion, option, page, SUPPER, textQuestion, TRIP } from './fixtures.ts';
import { checkAnswers } from './index.ts';

const messagesFor = (definition: FormDefinition, answers: Answers, pageKey?: string): string[] =>
  checkAnswers(definition, answers, env, pageKey === undefined ? { kind: 'all' } : { kind: 'page', page: pageKey })
    .map((error) => error.message);

/** The message for one question of a one-page form, or null when it passes. */
function messageFor(question: Question, answer: Answers[string] | undefined): string | null {
  const answers: Answers = answer === undefined ? {} : { q: answer };
  return messagesFor(form([page('p', 'P', [question])]), answers)[0] ?? null;
}

const q = (extra: Partial<Question> & Pick<Question, 'type'>): Question => ({ key: 'q', label: 'Label', ...extra });
const choices = [option('a', 'Apple'), option('b', 'Berry')];

const FIELD_CASES: [string, Question, Answers[string] | undefined, string | null][] = [
  ['required text', q({ type: 'short_text', required: true }), undefined, 'Label: answer this question.'],
  ['required text, spaces only', q({ type: 'long_text', required: true }), '   ', 'Label: answer this question.'],
  ['required number', q({ type: 'number', required: true }), '', 'Label: answer this question.'],
  ['required choice', q({ type: 'choice', required: true, options: choices }), undefined, 'Label: choose an option.'],
  ['required dropdown', q({ type: 'dropdown', required: true, options: choices }), undefined, 'Label: choose an option.'],
  ['required scale', q({ type: 'scale', required: true, min: 1, max: 5 }), undefined, 'Label: choose an option.'],
  ['required checkbox', q({ type: 'checkbox', required: true, options: choices }), [], 'Label: tick at least one option.'],
  ['required grid, no rows', q({ type: 'grid', required: true, rows: [option('r1'), option('r2')], columns: [option('x')] }), undefined, 'Label: choose an option in every row.'],
  ['required grid, one row of two', q({ type: 'grid', required: true, rows: [option('r1'), option('r2')], columns: [option('x')] }), { r1: 'x' }, 'Label: choose an option in every row.'],
  ['required grid, every row', q({ type: 'grid', required: true, rows: [option('r1'), option('r2')], columns: [option('x')] }), { r1: 'x', r2: 'x' }, null],
  ['optional grid, one row of two', q({ type: 'grid', rows: [option('r1'), option('r2')], columns: [option('x')] }), { r1: 'x' }, null],
  ['required ranking', q({ type: 'ranking', required: true, options: choices }), undefined, 'Label: move at least one option to set your order.'],
  ['ranking once stored', q({ type: 'ranking', required: true, options: choices }), ['b', 'a'], null],
  ['required date', q({ type: 'date', required: true }), undefined, 'Label: enter a date.'],
  ['required file', q({ type: 'file', required: true }), undefined, 'Label: attach a file.'],
  ['required file, stored', q({ type: 'file', required: true }), { name: 'a.pdf', size: 1, type: 'application/pdf' }, null],
  ['optional blank skips every check', q({ type: 'number', min: 5, decimals: 0 }), undefined, null],
  ['number format', q({ type: 'number' }), 'abc', 'Label: enter a number.'],
  ['number format, trailing dot', q({ type: 'number' }), '3.', 'Label: enter a number.'],
  ['number trimmed', q({ type: 'number' }), ' 3.50 ', null],
  ['number decimals', q({ type: 'number', decimals: 1 }), '3.25', 'Label: use at most 1 decimal places.'],
  ['number decimals zero', q({ type: 'number', decimals: 0 }), '3.5', 'Label: enter a whole number.'],
  ['number range', q({ type: 'number', min: 1, max: 8 }), '9', 'Label: enter a number from 1 to 8.'],
  ['number range low', q({ type: 'number', min: 1, max: 8 }), '0', 'Label: enter a number from 1 to 8.'],
  ['number only min', q({ type: 'number', min: 1 }), '0', 'Label: enter a number from 1 or more.'],
  ['number only max', q({ type: 'number', max: 2.5 }), '2.51', 'Label: enter a number up to 2.5.'],
  ['number at the limit', q({ type: 'number', max: 2.5 }), '2.50', null],
  ['number string bound', q({ type: 'number', min: '1.50' }), '1.4', 'Label: enter a number from 1.5 or more.'],
  ['number format beats range', q({ type: 'number', min: 1 }), 'x', 'Label: enter a number.'],
  ['number decimals beat range', q({ type: 'number', decimals: 0, min: 5 }), '1.5', 'Label: enter a whole number.'],
  ['date format', q({ type: 'date' }), '2026-02-30', 'Label: enter a real date as YYYY-MM-DD.'],
  ['date format, words', q({ type: 'date' }), 'tomorrow', 'Label: enter a real date as YYYY-MM-DD.'],
  ['date range', q({ type: 'date', min: '2026-03-01', max: '2026-03-31' }), '2026-04-02', 'Label: enter a date from 1 Mar 2026 to 31 Mar 2026.'],
  ['date only min', q({ type: 'date', min: '2026-03-01' }), '2026-02-28', 'Label: enter a date from 1 Mar 2026 or later.'],
  ['date only max', q({ type: 'date', max: '2026-03-31' }), '2026-04-01', 'Label: enter a date up to 31 Mar 2026.'],
  ['date on the limit', q({ type: 'date', max: '2026-03-31' }), '2026-03-31', null],
  ['text min length', q({ type: 'short_text', min_length: 3 }), ' ab ', 'Label: use at least 3 characters.'],
  ['text max length', q({ type: 'short_text', max_length: 3 }), 'abcd', 'Label: use at most 3 characters.'],
  ['text length counts characters', q({ type: 'short_text', max_length: 3 }), 'héé', null],
  ['text length trims', q({ type: 'short_text', max_length: 3 }), '  abc  ', null],
  ['text length beats pattern', q({ type: 'short_text', min_length: 30, pattern: 'digits' }), 'abc', 'Label: use at least 30 characters.'],
  ['pattern email', q({ type: 'short_text', pattern: 'email' }), 'a@b', 'Label: enter an email address like name@example.com.'],
  ['pattern email passes', q({ type: 'short_text', pattern: 'email' }), ' a@b.co ', null],
  ['pattern phone', q({ type: 'short_text', pattern: 'phone' }), '12-34', 'Label: enter digits, spaces and an optional leading +.'],
  ['pattern phone passes', q({ type: 'short_text', pattern: 'phone' }), '+44 7700 900123', null],
  ['pattern digits', q({ type: 'short_text', pattern: 'digits' }), '12a', 'Label: use digits only.'],
  ['pattern letters', q({ type: 'short_text', pattern: 'letters' }), 'ab1', 'Label: use letters only.'],
  ['ticks range', q({ type: 'checkbox', options: choices, min_selected: 2, max_selected: 3 }), ['a'], 'Label: tick from 2 to 3 options.'],
  ['ticks only min', q({ type: 'checkbox', options: choices, min_selected: 2 }), ['a'], 'Label: tick at least 2 options.'],
  ['ticks only max', q({ type: 'checkbox', options: choices, max_selected: 1 }), ['a', 'b'], 'Label: tick at most 1 options.'],
  ['ticks within range', q({ type: 'checkbox', options: choices, max_selected: 2 }), ['a', 'b'], null],
  ['optional checkbox, blank, minimum', q({ type: 'checkbox', options: choices, min_selected: 2 }), [], null],
];

for (const [name, question, answer, expected] of FIELD_CASES) {
  test(`field check: ${name}`, () => {
    assert.equal(messageFor(question, answer), expected);
  });
}

test('only the first failing check of a question reports, with insertions filled in its label', () => {
  const definition = form([page('p', 'P', [
    textQuestion('name', 'Name'),
    numberQuestion('age', 'Age of {{name}}', { min: 1, decimals: 0 }),
  ])]);
  assert.deepEqual(checkAnswers(definition, { name: 'Ada', age: '0.5' }, env, { kind: 'all' }),
    [{ key: 'age', message: 'Age of Ada: enter a whole number.', page: 'p' }]);
  assert.deepEqual(checkAnswers(definition, { age: 'x' }, env, { kind: 'all' }),
    [{ key: 'age', message: 'Age of (not answered yet): enter a number.', page: 'p' }]);
});

test('hidden questions and pages are not checked, and scope picks the page', () => {
  const required = (key: string, extra: Partial<Question> = {}): Question => textQuestion(key, key, { required: true, ...extra });
  const definition = form([
    page('one', 'One', [required('a'), required('b', { show_rule: { name: 'Never', when: '1 = 0' } })]),
    page('two', 'Two', [required('c')], { show_rule: { name: 'Skip two', when: '{a} <> "skip"' } }),
    page('three', 'Three', [required('d')]),
  ]);
  const keys = (answers: Answers, scope: Parameters<typeof checkAnswers>[3]): string[] =>
    checkAnswers(definition, answers, env, scope).map((error) => error.key);
  assert.deepEqual(keys({}, { kind: 'all' }), ['a', 'c', 'd']);
  assert.deepEqual(keys({ a: 'skip' }, { kind: 'all' }), ['d']);
  assert.deepEqual(keys({}, { kind: 'page', page: 'one' }), ['a']);
  assert.deepEqual(keys({}, { kind: 'page', page: 'three' }), ['d']);
  assert.deepEqual(keys({ a: 'skip' }, { kind: 'page', page: 'two' }), []);
  assert.deepEqual(checkAnswers(definition, {}, env, { kind: 'all' }).map((error) => error.page), ['one', 'two', 'three']);
});

test('trip check: the end date must be after the start date, and only when both are answered', () => {
  const run = (answers: Answers): string[] => messagesFor(TRIP, answers, 'trip');
  assert.deepEqual(run({ start: '2026-03-14', end: '2026-03-14' }), ['End date must be after the start date.']);
  assert.deepEqual(run({ start: '2026-03-14', end: '2026-03-10' }), ['End date must be after the start date.']);
  assert.deepEqual(run({ start: '2026-03-14', end: '2026-03-15' }), []);
  assert.deepEqual(run({ start: '2026-03-14' }), ['End date: enter a date.']);
  assert.deepEqual(run({ start: 'nope', end: '2026-03-10' }), ['Start date: enter a real date as YYYY-MM-DD.']);
  assert.deepEqual(run({ start: '2026-02-30', end: '2026-03-10' }), ['Start date: enter a real date as YYYY-MM-DD.']);
});

const BUDGET_ROWS: [string, string, string, string, string | null][] = [
  ['33.3', '33.3', '33.4', '100', null],
  ['10.1', '20.2', '69.7', '100', null],
  ['0.1', '0.2', '99.7', '100', null],
  ['33.3', '33.3', '33.3', '99.9', 'The percentages must total 100. They total 99.9.'],
  ['50', '50', '1', '101', 'The percentages must total 100. They total 101.'],
  ['70.1', '29.8', '0.1', '100', null],
  ['1.1', '2.2', '96.7', '100', null],
];

for (const [rent, food, other, total, expected] of BUDGET_ROWS) {
  test(`budget check: ${rent} + ${food} + ${other} is ${total}`, () => {
    const errors = checkAnswers(BUDGET, { rent, food, other }, env, { kind: 'page', page: 'budget' });
    assert.deepEqual(errors, expected === null ? [] : [{ key: 'other', message: expected, page: 'budget' }]);
  });
}

test('budget check: runs only when its inputs are shown, answered and free of errors', () => {
  const run = (answers: Answers): string[] => messagesFor(BUDGET, answers, 'budget');
  assert.deepEqual(run({ rent: '50', food: '50' }), ['Other percent: answer this question.']);
  assert.deepEqual(run({ rent: '50', food: '50', other: 'x' }), ['Other percent: enter a number.']);
  assert.deepEqual(run({ rent: '50', food: '50.55', other: '1' }), ['Food percent: use at most 1 decimal places.']);
  assert.deepEqual(run({ rent: '10', food: '10', other: '10' }), ['The percentages must total 100. They total 30.']);
  assert.deepEqual(run({ rent: '10', food: '10', other: '10.55' }), ['Other percent: use at most 1 decimal places.']);
});

test('form-level checks: one error per target, evaluation errors do not fail, hidden targets are skipped', () => {
  const checks = (...fail: string[]) => fail.map((fail_when, index) => ({
    name: `Check ${index}`, page: 'p', target: 'b', fail_when, message: `Message ${index} for {{a}}`,
  }));
  const questions = [numberQuestion('a', 'A'), numberQuestion('b', 'B'), calculatedQuestion('half', 'Half', '{a} / {b}')];
  const run = (failWhen: string[], answers: Answers, extra: Partial<Question> = {}): string[] =>
    messagesFor(form([page('p', 'P', questions.map((question) => (question.key === 'b' ? { ...question, ...extra } : question)))], checks(...failWhen)), answers);
  assert.deepEqual(run(['{a} > 1', '{a} > 0'], { a: '2', b: '1' }), ['Message 0 for 2']);
  assert.deepEqual(run(['{a} > 0', '{a} > 1'], { a: '2', b: '1' }), ['Message 0 for 2']);
  assert.deepEqual(run(['{a} > 1'], { a: '1', b: '1' }), []);
  assert.deepEqual(run(['{a} + "x" > 1', '1 < "x"'], { a: '2', b: '1' }), []);
  assert.deepEqual(run(['{half} > 1'], { a: '2', b: '0' }), []);
  assert.deepEqual(run(['{half} > 1'], { a: '4', b: '2' }), ['Message 0 for 4']);
  assert.deepEqual(run(['{a} > 1'], { a: '2', b: '1' }, { show_rule: { name: 'Hide b', when: '{a} < 0' } }), []);
  assert.deepEqual(run(['{a} > 1'], { a: '2', b: '1' }, { min: 5 }), ['B: enter a number from 5 or more.']);
});

test('supper club: its field checks as the respondent meets them', () => {
  const run = (answers: Answers): string[] => messagesFor(SUPPER, answers);
  assert.deepEqual(run({}), ['Are you coming?: choose an option.', 'Main course: choose an option.']);
  assert.deepEqual(run({ attending: 'Yes', guests: '9', meal: 'Fish' }), [
    'How many guests?: enter a number from 1 to 8.', 'Do you need parking?: choose an option.',
  ]);
  assert.deepEqual(run({ attending: 'No' }), []);
});

test('a date question never reads a text-only bound', () => {
  assert.equal(messageFor(dateQuestion('q', 'Label', { min: '2026-03-01' }), '2026-03-01'), null);
});
