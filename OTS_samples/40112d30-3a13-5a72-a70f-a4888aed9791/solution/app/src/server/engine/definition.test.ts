import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FormCheck, FormDefinition, Page, Question } from '../../shared/types.ts';
import { M37, M82 } from '../../shared/messages.ts';
import { BAKERY, BUDGET, calculatedQuestion, env, form, numberQuestion, option, page, SUPPER, TRIP } from './fixtures.ts';
import { asDefinition, definitionProblems, normalizeQuestion, validateStructure } from './index.ts';

const withQuestion = (question: unknown): unknown => ({ ...SUPPER, pages: [{ key: 'p', title: 'P', questions: [question] }], checks: [] });

test('the reference forms are structurally valid', () => {
  for (const definition of [SUPPER, BAKERY, TRIP, BUDGET]) {
    assert.equal(validateStructure(definition), null);
    assert.equal(asDefinition(definition), definition);
    assert.deepEqual(definitionProblems(definition, env), []);
  }
});

test('structure: unknown type, unknown field and missing fields are CHANGE_INVALID', () => {
  const code = (question: unknown) => validateStructure(withQuestion(question))?.code;
  assert.equal(code({ key: 'odd', type: 'slider', label: 'Odd' }), 'CHANGE_INVALID');
  assert.equal(code({ key: 'odd', label: 'Odd' }), 'CHANGE_INVALID');
  assert.equal(code({ key: 'odd', type: 'number' }), 'CHANGE_INVALID');
  assert.equal(code({ key: 'odd', type: 'number', label: 'Odd', formula: '1' }), 'CHANGE_INVALID');
  assert.equal(code({ key: 'odd', type: 'number', label: 'Odd', colour: 'red' }), 'CHANGE_INVALID');
  assert.equal(code({ key: 'pick', type: 'choice', label: 'Pick' }), 'CHANGE_INVALID');
  assert.equal(code({ key: 'pick', type: 'choice', label: 'Pick', options: 'red' }), 'CHANGE_INVALID');
  assert.equal(code({ key: 'pick', type: 'choice', label: 'Pick', options: [{ value: 'a' }] }), 'CHANGE_INVALID');
  assert.equal(code({ key: 'pick', type: 'choice', label: 'Pick', options: [option('a'), option('a')] }), 'CHANGE_INVALID');
  assert.equal(code({ key: 'pick', type: 'choice', label: 'Pick', options: [] }), undefined);
  assert.equal(code({ key: 'odd', type: 'number', label: 'Odd', min: 'abc' }), 'CHANGE_INVALID');
  assert.equal(code({ key: 'odd', type: 'number', label: 'Odd', min: 1e-7 }), 'CHANGE_INVALID');
  assert.equal(code({ key: 'odd', type: 'number', label: 'Odd', min: 0.5, max: '12.50' }), undefined);
  assert.equal(code({ key: 'odd', type: 'date', label: 'Odd', min: '2026-02-30' }), 'CHANGE_INVALID');
  assert.equal(code({ key: 'odd', type: 'short_text', label: 'Odd', pattern: 'zip' }), 'CHANGE_INVALID');
  assert.equal(code({ key: 'odd', type: 'short_text', label: 'Odd', max_length: -1 }), 'CHANGE_INVALID');
  assert.equal(code({ key: 'odd', type: 'file', label: 'Odd', accept: ['gif'] }), 'CHANGE_INVALID');
  assert.equal(code({ key: 'odd', type: 'file', label: 'Odd', accept: ['pdf'], max_bytes: 10 }), undefined);
  assert.equal(code({ key: 'odd', type: 'calculated', label: 'Odd', formula: '1', places: 101 }), 'CHANGE_INVALID');
  assert.equal(code({ key: 'odd', type: 'short_text', label: 'Odd', show_rule: { name: 'x' } }), 'CHANGE_INVALID');
  assert.equal(code('text'), 'CHANGE_INVALID');
  assert.equal(validateStructure('text')?.code, 'CHANGE_INVALID');
  assert.equal(validateStructure({ ...SUPPER, extra: 1 })?.code, 'CHANGE_INVALID');
  assert.equal(validateStructure({ title: 't' })?.code, 'CHANGE_INVALID');
});

test('structure: a bad key gets M82, a duplicate key DUPLICATE_KEY with M37', () => {
  assert.deepEqual(validateStructure(withQuestion({ key: 'Bad Key', type: 'number', label: 'x' })),
    { code: 'VALIDATION_FAILED', message: M82, key: 'Bad Key' });
  const duplicate = { ...SUPPER, pages: [page('p', 'P', [numberQuestion('a', 'A'), numberQuestion('a', 'Again')])] };
  assert.deepEqual(validateStructure(duplicate), { code: 'DUPLICATE_KEY', message: M37, key: 'a' });
  const acrossPages = { ...SUPPER, pages: [page('p', 'P', [numberQuestion('a', 'A')]), page('q', 'Q', [numberQuestion('a', 'A')])] };
  assert.equal(validateStructure(acrossPages)?.code, 'DUPLICATE_KEY');
  const duplicatePage = { ...SUPPER, pages: [page('p', 'P', []), page('p', 'Again', [])] };
  assert.equal(validateStructure(duplicatePage)?.code, 'DUPLICATE_KEY');
});

test('structure: checks must name an existing page and target', () => {
  const check: FormCheck = { name: 'Check', page: 'p', target: 'a', fail_when: '1 = 1', message: 'No' };
  const base = (checks: FormCheck[]): FormDefinition => form([page('p', 'P', [numberQuestion('a', 'A')])], checks);
  assert.equal(validateStructure(base([check])), null);
  assert.equal(validateStructure(base([{ ...check, page: 'nowhere' }]))?.code, 'CHANGE_INVALID');
  assert.equal(validateStructure(base([{ ...check, target: 'nowhere' }]))?.code, 'CHANGE_INVALID');
  assert.equal(validateStructure({ ...base([check]), checks: [{ name: 'x' }] })?.code, 'CHANGE_INVALID');
});

test('structure: lenient lets the Add question dialog leave out rows, columns, limits and formula', () => {
  const grid = { key: 'grid', type: 'grid', label: 'Grid' };
  const scale = { key: 'scale', type: 'scale', label: 'Scale' };
  const calculated = { key: 'calc', type: 'calculated', label: 'Calc' };
  for (const question of [grid, scale, calculated]) {
    assert.equal(validateStructure(withQuestion(question))?.code, 'CHANGE_INVALID');
    assert.equal(validateStructure(withQuestion(question), true), null);
  }
  assert.equal(validateStructure(withQuestion({ key: 'pick', type: 'choice', label: 'Pick' }), true)?.code, 'CHANGE_INVALID');
});

test('normalizeQuestion adds the add_question defaults', () => {
  const grid: Question = { key: 'grid', type: 'grid', label: 'Grid' };
  assert.deepEqual(normalizeQuestion(grid), {
    ...grid, rows: [{ value: 'row_1', label: 'Row 1' }], columns: [{ value: 'col_1', label: 'Column 1' }],
  });
  assert.deepEqual(normalizeQuestion({ key: 's', type: 'scale', label: 'S' }), { key: 's', type: 'scale', label: 'S', min: 1, max: 5 });
  assert.deepEqual(normalizeQuestion({ key: 's', type: 'scale', label: 'S', min: 0, max: 10 }), { key: 's', type: 'scale', label: 'S', min: 0, max: 10 });
  assert.deepEqual(normalizeQuestion({ key: 'c', type: 'calculated', label: 'C' }), { key: 'c', type: 'calculated', label: 'C', formula: '' });
  const number = numberQuestion('n', 'N');
  assert.equal(normalizeQuestion(number), number);
});

const WITH_FIXTURE: Page[] = [
  page('p1', 'First', [
    { key: 'rk', type: 'ranking', label: 'Order', options: [option('x'), option('y')] },
    numberQuestion('a', 'Amount'),
  ]),
  page('p2', 'Second', [numberQuestion('d', 'Later')]),
];

const problemsFor = (pages: Page[], checks: FormCheck[] = []) => definitionProblems(form(pages, checks), env);

test('problems: a calculated field without a formula reports the empty-formula refusal', () => {
  const [problem] = problemsFor([page('p', 'P', [{ key: 'cost', type: 'calculated', label: 'Cost' }])]);
  assert.deepEqual(problem, { key: 'cost', field: 'formula', message: 'Column 1: the formula is empty.' });
  assert.equal(problemsFor([page('p', 'P', [calculatedQuestion('cost', 'Cost', '   ')])])[0]?.message, 'Column 1: the formula is empty.');
});

test('problems: rules, jumps, insertions and checks', () => {
  const rule = (name: string, when: string) => ({ name, when });
  const [first, second] = WITH_FIXTURE;
  assert.ok(first && second);
  const cases: [Page[], FormCheck[], { key: string; field: string; message: string }][] = [
    [[{ ...first, questions: [numberQuestion('a', 'Amount', { show_rule: rule('Own', '{a} > 1') })] }, second], [],
      { key: 'a', field: 'show_rule', message: 'Column 1: a rule cannot use the question it belongs to.' }],
    [[{ ...first, questions: [numberQuestion('a', 'Amount', { show_rule: rule('Later', '{d} > 1') })] }, second], [],
      { key: 'a', field: 'show_rule', message: 'Column 1: {d} comes later in the form, so it cannot be used here.' }],
    [[first, { ...second, jumps: [{ name: 'Back', to: 'p1', when: '1 = 1' }] }], [],
      { key: 'p2', field: 'jumps', message: 'A jump can only go to a later page.' }],
    [[{ ...first, jumps: [{ name: 'Gone', to: 'nowhere', when: '1 = 1' }] }, second], [],
      { key: 'p1', field: 'jumps', message: 'A jump can only go to a later page.' }],
    [[{ ...first, jumps: [{ name: 'Same', to: 'p1', when: '{a} = 1' }] }, second], [],
      { key: 'p1', field: 'jumps', message: 'A jump can only go to a later page.' }],
    [[{ ...first, jumps: [{ name: 'Fine', to: 'p2', when: '{d} = 1' }] }, second], [],
      { key: 'p1', field: 'jumps', message: 'Column 1: {d} comes later in the form, so it cannot be used here.' }],
    [[first, { ...second, show_rule: rule('Own page', '{d} = 1') }], [],
      { key: 'p2', field: 'show_rule', message: 'Column 1: {d} comes later in the form, so it cannot be used here.' }],
    [[first, { ...second, show_rule: rule('Earlier', '{a} = 1') }], [], undefined as never],
    [[first, { ...second, title: 'About {{a}} and {{rk}}' }], [],
      { key: 'p2', field: 'title', message: '{{rk}} cannot be inserted.' }],
    [[{ ...first, title: 'Early {{a}}' }, second], [],
      { key: 'p1', field: 'title', message: '{{a}} comes later in the form, so it cannot be inserted here.' }],
    [[{ ...first, questions: [numberQuestion('a', 'Amount {{d}}'), numberQuestion('b', 'B')] }, second], [],
      { key: 'a', field: 'label', message: '{{d}} comes later in the form, so it cannot be inserted here.' }],
    [[{ ...first, questions: [numberQuestion('a', 'Amount {{zz}}')] }, second], [],
      { key: 'a', field: 'label', message: '{{zz}} is not a question in this form.' }],
    [[{ ...first, questions: [numberQuestion('a', 'Amount', { help: 'See {{a}}' })] }, second], [],
      { key: 'a', field: 'help', message: '{{a}} comes later in the form, so it cannot be inserted here.' }],
    [[first, second], [{ name: 'C', page: 'p1', target: 'a', fail_when: '{d} > 1', message: 'x' }],
      { key: 'a', field: 'fail_when', message: 'Column 1: {d} comes later in the form, so it cannot be used here.' }],
    [[first, second], [{ name: 'C', page: 'p2', target: 'd', fail_when: '{a} > 1', message: 'See {{gone}}' }],
      { key: 'd', field: 'message', message: '{{gone}} is not a question in this form.' }],
  ];
  for (const [pages, checks, expected] of cases) {
    const problems = problemsFor(pages, checks);
    if (expected === undefined) assert.deepEqual(problems, []);
    else assert.deepEqual(problems[0], expected);
  }
});

test('problems: row insertions are allowed for a grid row but not for the whole grid', () => {
  const grid: Question = { key: 'g', type: 'grid', label: 'G', rows: [option('r1')], columns: [option('x')] };
  const later = (label: string) => problemsFor([page('p', 'P', [grid, numberQuestion('n', label)])])[0]?.message ?? null;
  assert.equal(later('Row {{g.r1}}'), null);
  assert.equal(later('Row {{g}}'), '{{g}} cannot be inserted.');
  assert.equal(later('Row {{g.nope}}'), '{{g.nope}} is not a question in this form.');
  assert.equal(later('Row {{n}}'), '{{n}} comes later in the form, so it cannot be inserted here.');
});

test('problems: listed in form order, one per part', () => {
  const problems = problemsFor([
    page('p', '{{zz}}', [
      numberQuestion('a', '{{zz}}', { help: '{{zz}}' }),
      calculatedQuestion('c', 'C', '1 +'),
    ], { show_rule: { name: 'r', when: '' } }),
  ]);
  assert.deepEqual(problems.map((problem) => `${problem.key}.${problem.field}`), ['p.show_rule', 'p.title', 'a.label', 'a.help', 'c.formula']);
});
