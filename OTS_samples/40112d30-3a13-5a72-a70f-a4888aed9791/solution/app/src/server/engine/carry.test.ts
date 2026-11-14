import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Answers, FormDefinition, Page, Question } from '../../shared/types.ts';
import { M16, M17, M18 } from '../../shared/messages.ts';
import { choiceQuestion, dateQuestion, env, form, numberQuestion, option, page, SUPPER, textQuestion } from './fixtures.ts';
import { carryAnswers, pageToOpen } from './index.ts';

const edit = (definition: FormDefinition, key: string, change: Partial<Question>): FormDefinition => ({
  ...definition,
  pages: definition.pages.map((candidate): Page => ({
    ...candidate,
    questions: candidate.questions.map((question) => (question.key === key ? { ...question, ...change } : question)),
  })),
});

const SAVED: Answers = { attending: 'Yes', guests: '3', meal: 'Vegetarian', diet: 'vegan', parking: 'Yes' };

test('carry: nothing changed keeps every answer', () => {
  const carried = carryAnswers(SUPPER, SUPPER, SAVED);
  assert.deepEqual(carried, { answers: SAVED, dropped: [], droppedLabels: [] });
});

test('carry: drops answers whose option, range, type or key is gone, in the old form order', () => {
  const newer = edit(edit(edit(SUPPER, 'meal', { options: [option('Fish')] }), 'guests', { max: 2 }), 'diet', { type: 'long_text' });
  const carried = carryAnswers(SUPPER, newer, SAVED);
  assert.deepEqual(carried.answers, { attending: 'Yes', parking: 'Yes' });
  assert.deepEqual(carried.dropped, ['guests', 'meal', 'diet']);
  assert.deepEqual(carried.droppedLabels, ['How many guests?', 'Main course', 'Which diet?']);
  const removed = { ...SUPPER, pages: SUPPER.pages.filter((candidate) => candidate.key !== 'travel') };
  assert.deepEqual(carryAnswers(SUPPER, removed, SAVED).dropped, ['parking']);
});

test('carry: the labels are the old edition raw labels, and the notices read as published', () => {
  const older = edit(SUPPER, 'comment', { label: 'Anything for {{meal}}?' });
  const carried = carryAnswers(older, edit(older, 'comment', { type: 'number' }), { comment: 'hello', guests: '1' });
  assert.deepEqual(carried.droppedLabels, ['Anything for {{meal}}?']);
  assert.equal(M16(carried.droppedLabels[0] ?? ''), 'This form changed since you saved. 1 of your answers no longer applies: Anything for {{meal}}?.');
  assert.equal(M17(2, 'A, B'), 'This form changed since you saved. 2 of your answers no longer apply: A, B.');
  assert.equal(M18, 'This form changed since you saved. All your answers still apply.');
});

test('carry: number, date, scale and text limits are checked against the new edition', () => {
  const older = form([page('p', 'P', [
    numberQuestion('n', 'N'), numberQuestion('m', 'M'), dateQuestion('d', 'D'),
    { key: 's', type: 'scale', label: 'S', min: 1, max: 10 }, textQuestion('t', 'T'), textQuestion('u', 'U'),
  ])]);
  const newer = form([page('p', 'P', [
    numberQuestion('n', 'N', { decimals: 0 }), numberQuestion('m', 'M', { min: 1, max: 5 }),
    dateQuestion('d', 'D', { min: '2026-04-01' }),
    { key: 's', type: 'scale', label: 'S', min: 1, max: 5 }, textQuestion('t', 'T', { max_length: 2 }), textQuestion('u', 'U', { max_length: 2 }),
  ])]);
  const carried = carryAnswers(older, newer, { n: '2.5', m: '3', d: '2026-03-14', s: '7', t: 'abc', u: ' ab ' });
  assert.deepEqual(carried.answers, { m: '3', u: ' ab ' });
  assert.deepEqual(carried.dropped, ['n', 'd', 's', 't']);
});

test('carry: file answers are kept while the key is still a file question; blank answers are neither kept nor dropped', () => {
  const older = form([page('p', 'P', [{ key: 'f', type: 'file', label: 'F' }, textQuestion('t', 'T')])]);
  const file = { name: 'a.pdf', size: 3, type: 'application/pdf' };
  assert.deepEqual(carryAnswers(older, older, { f: file, t: '  ' }), { answers: { f: file }, dropped: [], droppedLabels: [] });
  const retyped = edit(older, 'f', { type: 'short_text' });
  assert.deepEqual(carryAnswers(older, retyped, { f: file }).dropped, ['f']);
});

test('carry: answers hidden in the old edition travel too', () => {
  const carried = carryAnswers(SUPPER, SUPPER, { ...SAVED, attending: 'No' });
  assert.deepEqual(carried.answers, { ...SAVED, attending: 'No' });
});

test('page to open: the first shown page with an empty required question or a dropped answer, else the saved page', () => {
  assert.equal(pageToOpen(SUPPER, SAVED, [], 'meals', env), 'meals');
  assert.equal(pageToOpen(SUPPER, { ...SAVED, meal: 'Fish' }, [], 'travel', env), 'travel');
  assert.equal(pageToOpen(SUPPER, { attending: 'Yes', guests: '3' }, [], 'travel', env), 'meals');
  assert.equal(pageToOpen(SUPPER, {}, [], 'thanks', env), 'about');
  assert.equal(pageToOpen(SUPPER, SAVED, ['guests'], 'thanks', env), 'about');
  assert.equal(pageToOpen(SUPPER, SAVED, ['diet'], 'thanks', env), 'meals');
  assert.equal(pageToOpen(SUPPER, { ...SAVED, guests: '1' }, ['parking'], 'thanks', env), 'thanks');
  assert.equal(pageToOpen(SUPPER, { ...SAVED, guests: '1' }, [], 'travel', env), 'about');
});

test('page to open: a saved page that is gone or skipped falls back to the first shown page', () => {
  assert.equal(pageToOpen(SUPPER, SAVED, [], 'removed', env), 'about');
  const skipping = form([
    page('first', 'First', [choiceQuestion('go', 'Go', ['yes', 'no'])], { show_rule: { name: 'Never', when: '1 = 0' } }),
    page('second', 'Second', [textQuestion('t', 'T')]),
  ]);
  assert.equal(pageToOpen(skipping, {}, [], 'first', env), 'second');
  assert.equal(pageToOpen(skipping, {}, ['go'], 'first', env), 'second');
});
