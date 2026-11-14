import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnswerValue, Question } from '../../shared/types.ts';
import { option } from './fixtures.ts';
import { answerFits, isBlank } from './index.ts';

test('blank: undefined, null, empty, whitespace, empty list and empty object', () => {
  const blank: (AnswerValue | null | undefined)[] = [undefined, null, '', '   ', '\n\t', [], {}];
  const answered: AnswerValue[] = ['0', ' a ', ['a'], { r1: 'x' }, { name: 'a.pdf', size: 1, type: 'application/pdf' }];
  for (const value of blank) assert.equal(isBlank(value), true);
  for (const value of answered) assert.equal(isBlank(value), false);
});

const choice: Question = { key: 'c', type: 'choice', label: 'C', options: [option('a'), option('b')] };
const grid: Question = { key: 'g', type: 'grid', label: 'G', rows: [option('r1'), option('r2')], columns: [option('x'), option('y')] };
const ranking: Question = { key: 'r', type: 'ranking', label: 'R', options: [option('a'), option('b'), option('c')] };

const FITS: [string, Question, unknown, boolean][] = [
  ['null clears anything', choice, null, true],
  ['text', { key: 't', type: 'short_text', label: 'T' }, 'hello', true],
  ['text is not a number', { key: 't', type: 'long_text', label: 'T' }, 5, false],
  ['text of 10,000 characters', { key: 't', type: 'long_text', label: 'T' }, 'x'.repeat(10_000), true],
  ['text of 10,001 characters', { key: 't', type: 'long_text', label: 'T' }, 'x'.repeat(10_001), false],
  ['number text', { key: 'n', type: 'number', label: 'N' }, 'not even a number', true],
  ['date text', { key: 'd', type: 'date', label: 'D' }, '2026-03-14', true],
  ['scale text', { key: 's', type: 'scale', label: 'S', min: 1, max: 5 }, '3', true],
  ['choice option', choice, 'a', true],
  ['choice not an option', choice, 'z', false],
  ['dropdown option', { ...choice, type: 'dropdown' }, 'b', true],
  ['choice with a list', choice, ['a'], false],
  ['checkbox options', { ...choice, type: 'checkbox' }, ['a', 'b'], true],
  ['checkbox not an option', { ...choice, type: 'checkbox' }, ['a', 'z'], false],
  ['checkbox with a string', { ...choice, type: 'checkbox' }, 'a', false],
  ['checkbox repeating an option', { ...choice, type: 'checkbox' }, ['a', 'a'], false],
  ['grid cells inside rows and columns', grid, { r1: 'x', r2: 'y' }, true],
  ['grid unknown row', grid, { r3: 'x' }, false],
  ['grid unknown column', grid, { r1: 'z' }, false],
  ['grid with a list', grid, ['x'], false],
  ['ranking permutation', ranking, ['c', 'a', 'b'], true],
  ['ranking missing an option', ranking, ['c', 'a'], false],
  ['ranking with a repeat', ranking, ['a', 'a', 'b'], false],
  ['ranking with a stranger', ranking, ['a', 'b', 'z'], false],
  ['file can never be committed', { key: 'f', type: 'file', label: 'F' }, { name: 'a', size: 1, type: 'x' }, false],
  ['calculated can never be committed', { key: 'k', type: 'calculated', label: 'K', formula: '1' }, '1', false],
];

for (const [name, question, value, expected] of FITS) {
  test(`answer fits: ${name}`, () => {
    assert.equal(answerFits(question, value), expected);
  });
}
