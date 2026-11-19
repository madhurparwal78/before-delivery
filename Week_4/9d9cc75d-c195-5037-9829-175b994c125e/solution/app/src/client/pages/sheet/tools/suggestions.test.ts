import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FUNCTIONS } from './functions.ts';
import { landingStep } from './query-order.ts';
import { insert, suggest, typedAt } from './suggestions.ts';

const FIELDS = ['Region', 'Category', 'Sales', 'Stockist', 'Units'];

function names(text: string): string[] {
  const typed = typedAt(text, text.length);
  return typed ? suggest(typed, FIELDS).map((entry) => entry.name) : [];
}

test('there are 27 functions', () => {
  assert.equal(new Set(FUNCTIONS).size, 27);
});

test('a word lists functions, then fields, each alphabetical, ignoring case', () => {
  assert.deepEqual(names('C'), ['CONTAINS', 'COUNT', 'COUNT_UNIQUE', 'Category']);
  assert.deepEqual(names('s'), ['SHARE', 'SUM', 'Sales', 'Stockist']);
});

test('a bracket lists fields only and narrows', () => {
  assert.deepEqual(names('SUM(['), ['Category', 'Region', 'Sales', 'Stockist', 'Units']);
  assert.deepEqual(names('{AT [Reg'), ['Region']);
  assert.deepEqual(names('[st'), ['Stockist']);
});

test('digits, operators and a closed bracket open nothing', () => {
  assert.deepEqual(names('12'), []);
  assert.deepEqual(names('12ab'), []);
  assert.deepEqual(names('[Sales] + '), []);
  assert.deepEqual(names('SUM('), []);
});

test('insertion replaces the typed word and leaves the caret after it', () => {
  const text = '{AT [Reg';
  const typed = typedAt(text, text.length);
  assert.ok(typed);
  assert.deepEqual(insert(text, text.length, typed, { name: 'Region', kind: 'field' }), { text: '{AT [Region]', caret: 12 });
  const word = 'x + SU';
  const typedWord = typedAt(word, word.length);
  assert.ok(typedWord);
  assert.deepEqual(insert(word, word.length, typedWord, { name: 'SUM', kind: 'function' }), { text: 'x + SUM(', caret: 8 });
});

test('insertion inside brackets that already close does not double the bracket', () => {
  const text = '[Reg] + 1';
  const typed = typedAt(text, 4);
  assert.ok(typed);
  assert.deepEqual(insert(text, 4, typed, { name: 'Region', kind: 'field' }), { text: '[Region] + 1', caret: 8 });
});

test('the landing step follows the formula', () => {
  const plain = { valid: true, type: 'number', aggregate: false } as const;
  const aggregate = { ...plain, aggregate: true };
  assert.equal(landingStep('[Units] * 2', plain), 5);
  assert.equal(landingStep('SUM([Sales])', aggregate), 7);
  assert.equal(landingStep('{AT [Region] : SUM([Sales])}', plain), 4);
  assert.equal(landingStep('{SUM([Sales])}', plain), 4);
  assert.equal(landingStep('{PLUS [Product] : SUM([Sales])}', plain), 6);
  assert.equal(landingStep('RUN_TOTAL(SUM([Sales]))', aggregate), 9);
  assert.equal(landingStep("IF([Region] = '{PLUS', 1, 2)", plain), 5);
});
