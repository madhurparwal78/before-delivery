import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { Answers } from '../../shared/types.ts';
import { M05, M10, M11, M45, M46 } from '../../shared/messages.ts';
import { BAKERY, env, SUPPER } from './fixtures.ts';
import { evaluate, nextShownPage, previousShownPage, resolve, respondentStructure } from './index.ts';

const FIRST: Answers = { attending: 'Yes', guests: '3', meal: 'Vegetarian', diet: 'vegan', parking: 'Yes' };

interface WalkRow {
  name: string;
  answers: Answers;
  pages: string[];
  questions: string[];
  counting: string[];
}

const WALK: WalkRow[] = [
  {
    name: 'yes, 3 guests', answers: FIRST,
    pages: ['About you', 'Meals', 'Travel', 'Anything else'],
    questions: ['attending', 'guests', 'meal', 'diet', 'parking', 'comment'],
    counting: ['attending', 'diet', 'guests', 'meal', 'parking'],
  },
  {
    name: 'back: guests 1', answers: { ...FIRST, guests: '1' },
    pages: ['About you', 'Meals', 'Anything else'],
    questions: ['attending', 'guests', 'meal', 'diet', 'comment'],
    counting: ['attending', 'diet', 'guests', 'meal'],
  },
  {
    name: 'back: attending No', answers: { ...FIRST, guests: '1', attending: 'No' },
    pages: ['About you', 'Anything else'],
    questions: ['attending', 'guests', 'comment'],
    counting: ['attending', 'guests'],
  },
  {
    name: 'meal changed to Fish', answers: { ...FIRST, meal: 'Fish' },
    pages: ['About you', 'Meals', 'Travel', 'Anything else'],
    questions: ['attending', 'guests', 'meal', 'parking', 'comment'],
    counting: ['attending', 'guests', 'meal', 'parking'],
  },
  {
    name: 'guests blank', answers: { attending: 'Yes', meal: 'Vegetarian', diet: 'vegan', parking: 'Yes' },
    pages: ['About you', 'Meals', 'Anything else'],
    questions: ['attending', 'guests', 'meal', 'diet', 'comment'],
    counting: ['attending', 'diet', 'meal'],
  },
];

for (const row of WALK) {
  test(`supper club walk: ${row.name}`, () => {
    const resolved = resolve(SUPPER, row.answers, env);
    const titles = resolved.pages.filter((candidate) => candidate.state === 'lit').map((candidate) => candidate.title);
    assert.deepEqual(titles, row.pages);
    assert.deepEqual(resolved.questions.filter((question) => question.state === 'lit').map((question) => question.key), row.questions);
    assert.deepEqual([...resolved.counting].sort(), row.counting);
  });
}

test('supper club walk: skipped items name the rule or jump that skipped them', () => {
  const resolved = resolve(SUPPER, { ...FIRST, attending: 'No' }, env);
  assert.deepEqual(resolved.pages.map((candidate) => [candidate.key, candidate.skipped_by]), [
    ['about', null], ['meals', 'Not attending'], ['travel', 'Not attending'], ['thanks', null],
  ]);
  const skipped = resolved.questions.filter((question) => question.state === 'skipped');
  assert.deepEqual(skipped.map((question) => [question.key, question.skipped_by, question.value, question.text]), [
    ['meal', 'Not attending', null, ''], ['diet', 'Not attending', null, ''], ['parking', 'Not attending', null, ''],
  ]);
  const byRule = resolve(SUPPER, { ...FIRST, guests: '1' }, env);
  assert.deepEqual(byRule.pages.map((candidate) => candidate.skipped_by), [null, null, 'Two or more guests', null]);
  assert.equal(byRule.questions.find((question) => question.key === 'parking')?.skipped_by, 'Two or more guests');
  const diet = resolve(SUPPER, { ...FIRST, meal: 'Fish' }, env).questions.find((question) => question.key === 'diet');
  assert.deepEqual([diet?.state, diet?.skipped_by], ['skipped', 'Vegetarian meal']);
});

test('a page reached by a jump is still skipped by its own rule, and the walk continues', () => {
  const definition = {
    ...SUPPER,
    pages: SUPPER.pages.map((candidate) => (candidate.key === 'about'
      ? { ...candidate, jumps: [{ name: 'Straight to travel', when: '{attending} = "No"', to: 'travel' }] }
      : candidate)),
  };
  const resolved = resolve(definition, { attending: 'No' }, env);
  assert.deepEqual(resolved.pages.map((candidate) => [candidate.key, candidate.state, candidate.skipped_by]), [
    ['about', 'lit', null], ['meals', 'skipped', 'Straight to travel'],
    ['travel', 'skipped', 'Two or more guests'], ['thanks', 'lit', null],
  ]);
});

test('a jump that does not go forward is ignored and the first met jump wins', () => {
  const definition = {
    ...SUPPER,
    pages: SUPPER.pages.map((candidate) => (candidate.key === 'meals'
      ? { ...candidate, jumps: [{ name: 'Back', when: '1 = 1', to: 'about' }, { name: 'Gone', when: '1 = 1', to: 'nowhere' }] }
      : candidate.key === 'about'
        ? { ...candidate, jumps: [{ name: 'Broken', when: '1 /', to: 'thanks' }, { name: 'Real', when: '1 = 1', to: 'travel' }] }
        : candidate)),
  };
  const resolved = resolve(definition, { guests: '2' }, env);
  assert.deepEqual(resolved.pages.map((candidate) => candidate.skipped_by), [null, 'Real', null, null]);
});

test('hidden answers count as blank everywhere and come back when shown again', () => {
  const hidden = resolve(SUPPER, { ...FIRST, attending: 'No' }, env);
  assert.deepEqual(hidden.questions.find((question) => question.key === 'comment')?.label, 'Anything to add about your (not answered yet) meal?');
  const shownAgain = resolve(SUPPER, FIRST, env);
  assert.equal(shownAgain.questions.find((question) => question.key === 'comment')?.label, 'Anything to add about your Vegetarian meal?');
});

test('navigation follows the shown pages for the current answers', () => {
  const resolved = resolve(SUPPER, { ...FIRST, guests: '1' }, env);
  assert.equal(nextShownPage(resolved, 'meals'), 'thanks');
  assert.equal(nextShownPage(resolved, 'thanks'), null);
  assert.equal(previousShownPage(resolved, 'thanks'), 'meals');
  assert.equal(previousShownPage(resolved, 'about'), null);
  assert.equal(nextShownPage(resolved, 'travel'), 'thanks');
  assert.equal(previousShownPage(resolved, 'travel'), 'meals');
});

const respondent = (answers: Answers, currentPage: string, prior?: Answers) =>
  evaluate(SUPPER, answers, env, { audience: 'respondent', seq: 7, currentPage, prior });

test('evaluation: page count, page number and announcement', () => {
  const evaluation = respondent({ ...FIRST, guests: '1' }, 'thanks');
  assert.equal(evaluation.seq, 7);
  assert.equal(evaluation.shown_pages, 3);
  assert.equal(evaluation.page_number, 3);
  assert.equal(evaluation.announce, M05(3, 3, 'Anything else'));
  assert.equal(evaluation.pages.length, 4);
  assert.deepEqual(evaluation.pages[2]?.questions.map((question) => [question.key, question.state, question.skipped_by]), [
    ['parking', 'skipped', 'Two or more guests'],
  ]);
  assert.deepEqual(evaluation.pages[0]?.questions[1], { key: 'guests', state: 'lit', skipped_by: null, label: 'How many guests?', help: 'Count yourself.' });
  assert.equal(evaluate(SUPPER, {}, env, { audience: 'respondent', seq: 1 }).page_number, 0);
});

test('evaluation: hidden_now and restored match the Supper club counts', () => {
  assert.deepEqual(pathChange(FIRST, { ...FIRST, guests: '1' }), [1, 0]);
  assert.deepEqual(pathChange(FIRST, { ...FIRST, attending: 'No' }), [3, 0]);
  assert.deepEqual(pathChange(FIRST, { ...FIRST, meal: 'Fish' }), [1, 0]);
  assert.deepEqual(pathChange({ ...FIRST, guests: '1' }, FIRST), [0, 1]);
  assert.deepEqual(pathChange({ ...FIRST, attending: 'No' }, FIRST), [0, 3]);
  assert.deepEqual(pathChange({ ...FIRST, meal: 'Fish' }, FIRST), [0, 1]);
  assert.deepEqual(pathChange(FIRST, { ...FIRST, parking: '' }), [0, 0], 'a cleared answer is not hidden');
  assert.deepEqual(pathChange(FIRST, FIRST), [0, 0]);
});

function pathChange(prior: Answers, answers: Answers): [number, number] {
  const evaluation = respondent(answers, 'about', prior);
  return [evaluation.hidden_now, evaluation.restored];
}

const BAKERY_ROWS: { answers: Answers; expected: string[] }[] = [
  { answers: { loaves: '3', rolls: '7', delivery: 'yes', people: '4' }, expected: ['£13.20', '£0.00', '£15.70', '£3.93'] },
  { answers: { loaves: '3', delivery: 'no', people: '2' }, expected: ['£10.05', '£0.00', '£10.05', '£5.03'] },
  { answers: { loaves: '5', rolls: '7', delivery: 'no', people: '3' }, expected: ['£19.90', '£0.00', '£19.90', '£6.63'] },
  { answers: { delivery: 'no', people: '1' }, expected: ['£0.00', '£0.00', '£0.00', '£0.00'] },
  { answers: { loaves: '6', rolls: '3', delivery: 'yes' }, expected: ['£21.45', '£2.68', '£21.27', 'Cannot calculate: division by zero.'] },
  { answers: { loaves: '7', rolls: '1', delivery: 'no', people: '2' }, expected: ['£23.90', '£2.99', '£20.91', '£10.46'] },
  { answers: { loaves: '8', rolls: '4', delivery: 'no', people: '3' }, expected: ['£28.60', '£3.58', '£25.02', '£8.34'] },
];

BAKERY_ROWS.forEach(({ answers, expected }, index) => {
  test(`bakery row ${index + 1}`, () => {
    const resolved = resolve(BAKERY, answers, env);
    const texts = ['subtotal', 'discount', 'total', 'each'].map((key) => resolved.questions.find((question) => question.key === key)?.calc?.text);
    assert.deepEqual(texts, expected);
  });
});

test('bakery: the hidden margin never reaches a respondent, and the large-order question follows the total', () => {
  const answers: Answers = { loaves: '8', rolls: '4', delivery: 'no', people: '3' };
  const forRespondent = evaluate(BAKERY, answers, env, { audience: 'respondent', seq: 1, currentPage: 'order' });
  assert.deepEqual(Object.keys(forRespondent.values), ['subtotal', 'discount', 'total', 'each']);
  assert.ok(!forRespondent.pages.some((candidate) => candidate.questions.some((question) => question.key === 'margin')));
  assert.deepEqual(forRespondent.values.total, { value: '25.02', text: '£25.02' });
  assert.equal(forRespondent.pages[0]?.questions.find((question) => question.key === 'bulk_note')?.state, 'lit');
  const small = evaluate(BAKERY, { loaves: '1' }, env, { audience: 'respondent', seq: 1, currentPage: 'order' });
  assert.equal(small.pages[0]?.questions.find((question) => question.key === 'bulk_note')?.state, 'skipped');
  assert.equal(small.pages[0]?.questions.find((question) => question.key === 'bulk_note')?.skipped_by, 'Large order');
});

test('trial evaluation includes hidden calculated fields and announces the last visible one', () => {
  const answers: Answers = { loaves: '8', rolls: '4', delivery: 'no', people: '3' };
  const trial = evaluate(BAKERY, answers, env, { audience: 'owner', seq: 3 });
  assert.deepEqual(Object.keys(trial.values), ['subtotal', 'discount', 'total', 'each', 'margin']);
  assert.deepEqual(trial.values.margin, { value: '7.506', text: '7.51' });
  assert.equal(trial.announce, M45(1, 1, 'Each', '£8.34'));
  assert.equal(trial.page_number, 0);
  const noCalculated = evaluate(SUPPER, {}, env, { audience: 'owner', seq: 3 });
  assert.equal(noCalculated.announce, M46(3, 4));
  assert.deepEqual(noCalculated.values, {});
  const blank = evaluate(BAKERY, {}, env, { audience: 'owner', seq: 1 });
  assert.deepEqual(blank.values.each, { value: null, text: 'Cannot calculate: division by zero.' });
});

test('calculated fields skipped by a rule have no value and the not-calculated text', () => {
  const trial = evaluate(BAKERY, { loaves: '1' }, env, { audience: 'owner', seq: 1 });
  assert.deepEqual(trial.values.subtotal, { value: '3.35', text: '£3.35' });
  const definition = {
    ...BAKERY,
    pages: [{
      ...BAKERY.pages[0]!,
      questions: BAKERY.pages[0]!.questions.map((question) => (question.key === 'margin'
        ? { ...question, show_rule: { name: 'Big', when: '{total} > 100' } }
        : question)),
    }],
  };
  const skipped = evaluate(definition, { loaves: '1' }, env, { audience: 'owner', seq: 1 });
  assert.deepEqual(skipped.values.margin, { value: null, text: M11 });
});

test('insertion shows the effective answer as plain text by the published display rules', () => {
  const definition = {
    title: 'T', intro: '', checks: [],
    pages: [
      {
        key: 'p1', title: 'Hello {{name}}',
        questions: [
          { key: 'name', type: 'short_text' as const, label: 'Name' },
          { key: 'age', type: 'number' as const, label: 'Age' },
          { key: 'colour', type: 'choice' as const, label: 'Colour', options: [{ value: 'r', label: 'Red' }, { value: 'b', label: 'Blue' }] },
          { key: 'fruit', type: 'checkbox' as const, label: 'Fruit', options: [{ value: 'a', label: 'Apple' }, { value: 'p', label: 'Pear' }, { value: 'c', label: 'Cherry' }] },
          { key: 'day', type: 'date' as const, label: 'Day' },
          { key: 'rows', type: 'grid' as const, label: 'Rows', rows: [{ value: 'r1', label: 'Row one' }], columns: [{ value: 'c1', label: 'Col one' }] },
          { key: 'total', type: 'calculated' as const, label: 'Total', formula: '{age} * 2', places: 1, prefix: '#' },
        ],
      },
      {
        key: 'p2', title: 'All done',
        questions: [{
          key: 'echo', type: 'long_text' as const,
          label: '{{name}}|{{age}}|{{colour}}|{{fruit}}|{{day}}|{{rows.r1}}|{{total}}|{{rows.r1}}',
          help: 'Hi {{name}}',
        }],
      },
    ],
  };
  const answers: Answers = {
    name: '<b>x</b>', age: '3.50', colour: 'b', fruit: ['p', 'a'], day: '2026-03-14', rows: { r1: 'c1' },
  };
  const resolved = resolve(definition, answers, env);
  assert.equal(resolved.questions.find((question) => question.key === 'echo')?.label, '<b>x</b>|3.5|Blue|Apple, Pear|14 Mar 2026|Col one|#7.0|Col one');
  assert.equal(resolved.questions.find((question) => question.key === 'echo')?.help, 'Hi <b>x</b>');
  assert.equal(resolved.pages[0]?.title, 'Hello <b>x</b>');
  const blank = resolve(definition, {}, env);
  assert.equal(blank.questions.find((question) => question.key === 'echo')?.label, [M10, M10, M10, M10, M10, M10, '#0.0', M10].join('|'));
});

test('answer text follows the published formats', () => {
  const definition = {
    title: 'T', intro: '', checks: [],
    pages: [{
      key: 'p', title: 'P',
      questions: [
        { key: 'n', type: 'number' as const, label: 'N' },
        { key: 'f', type: 'file' as const, label: 'F' },
        { key: 'rk', type: 'ranking' as const, label: 'R', options: [{ value: 'a', label: 'Ant' }, { value: 'b', label: 'Bee' }] },
        { key: 'g', type: 'grid' as const, label: 'G', rows: [{ value: 'r1', label: 'One' }, { value: 'r2', label: 'Two' }], columns: [{ value: 'x', label: 'Ex' }, { value: 'y', label: 'Why' }] },
        { key: 'sc', type: 'scale' as const, label: 'S', min: 1, max: 5, note: 'internal' },
      ],
    }],
  };
  const resolved = resolve(definition, {
    n: '3.50', f: { name: 'cv.pdf', size: 10, type: 'application/pdf' }, rk: ['b', 'a'], g: { r2: 'y', r1: 'x' }, sc: '4',
  }, env);
  assert.deepEqual(resolved.questions.map((question) => question.text), ['3.5', 'cv.pdf', 'Bee > Ant', 'One: Ex; Two: Why', '4']);
  assert.equal(resolved.questions[4]?.note, 'internal');
  assert.deepEqual(resolved.questions[3]?.value, { r2: 'y', r1: 'x' });
});

test('respondent structure shuffles by the published hash order and leaves out labels and hidden fields', () => {
  const values = ['red', 'green', 'blue', 'amber'];
  const definition = {
    title: 'T', intro: '', checks: [],
    pages: [{
      key: 'p', title: 'P',
      questions: [
        { key: 'pick', type: 'choice' as const, label: 'Pick', required: true, shuffle: true, options: values.map((value) => ({ value, label: value.toUpperCase() })) },
        { key: 'plain', type: 'checkbox' as const, label: 'Plain', options: values.map((value) => ({ value, label: value })) },
        { key: 'when', type: 'date' as const, label: 'When', min: '2026-01-01' },
        { key: 'doc', type: 'file' as const, label: 'Doc', max_bytes: 100 },
        { key: 'secret', type: 'calculated' as const, label: 'Secret', formula: '1', hidden: true },
        { key: 'shown', type: 'calculated' as const, label: 'Shown', formula: '1' },
      ],
    }],
  };
  const structure = respondentStructure(definition, env);
  const digest = (value: string): string => createHash('sha256').update(`nightform-1:pick:${value}`).digest('hex');
  assert.deepEqual(structure.pick?.options?.map((candidate) => candidate.value), [...values].sort((a, b) => (digest(a) < digest(b) ? -1 : 1)));
  assert.deepEqual(structure.plain?.options?.map((candidate) => candidate.value), values);
  assert.equal(structure.pick?.required, true);
  assert.equal(structure.when?.min, '2026-01-01');
  assert.deepEqual(structure.doc?.accept, ['pdf', 'png', 'jpeg']);
  assert.equal(structure.secret, undefined);
  assert.deepEqual(Object.keys(structure), ['pick', 'plain', 'when', 'doc', 'shown']);
  assert.ok(!JSON.stringify(structure).includes('Pick'));
  assert.deepEqual(structure.pick?.options, respondentStructure(definition, env).pick?.options);
});
