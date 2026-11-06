import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffTokens, wordDiff } from './diff.ts';

test('tokens are whitespace runs and non-whitespace runs', () => {
  assert.deepEqual(diffTokens('the  slow\tdog '), ['the', '  ', 'slow', '\t', 'dog', ' ']);
  assert.deepEqual(diffTokens(''), []);
});

test('replaced words are written as deletions then insertions', () => {
  assert.deepEqual(wordDiff('the quick brown fox', 'the slow brown dog'), [
    { op: 'equal', text: 'the ' },
    { op: 'delete', text: 'quick' },
    { op: 'insert', text: 'slow' },
    { op: 'equal', text: ' brown ' },
    { op: 'delete', text: 'fox' },
    { op: 'insert', text: 'dog' },
  ]);
});

test('whitespace tokens are compared exactly', () => {
  assert.deepEqual(wordDiff('one two three', 'one  two three'), [
    { op: 'equal', text: 'one' },
    { op: 'delete', text: ' ' },
    { op: 'insert', text: '  ' },
    { op: 'equal', text: 'two three' },
  ]);
});

test('empty sides', () => {
  assert.deepEqual(wordDiff('', ''), []);
  assert.deepEqual(wordDiff('', 'a b'), [{ op: 'insert', text: 'a b' }]);
  assert.deepEqual(wordDiff('a b', ''), [{ op: 'delete', text: 'a b' }]);
  assert.deepEqual(wordDiff('same text', 'same text'), [{ op: 'equal', text: 'same text' }]);
});

test('pure insertions and deletions in the middle', () => {
  assert.deepEqual(wordDiff('a c', 'a b c'), [
    { op: 'equal', text: 'a ' },
    { op: 'insert', text: 'b ' },
    { op: 'equal', text: 'c' },
  ]);
  assert.deepEqual(wordDiff('a b c', 'a c'), [
    { op: 'equal', text: 'a ' },
    { op: 'delete', text: 'b ' },
    { op: 'equal', text: 'c' },
  ]);
});

test('ties follow the forward greedy choice rule', () => {
  assert.deepEqual(wordDiff('a', 'b'), [
    { op: 'delete', text: 'a' },
    { op: 'insert', text: 'b' },
  ]);
  // Two equally short scripts exist; the rule keeps the leading deletion path.
  assert.deepEqual(wordDiff('x a', 'a x'), [
    { op: 'delete', text: 'x ' },
    { op: 'equal', text: 'a' },
    { op: 'insert', text: ' x' },
  ]);
});

test('reconstructs both texts and handles long inputs quickly', () => {
  const from = Array.from({ length: 3000 }, (_, i) => `w${i % 97}`).join(' ');
  const to = Array.from({ length: 3000 }, (_, i) => `w${(i * 7) % 89}`).join(' ');
  const started = Date.now();
  const ops = wordDiff(from, to);
  assert.ok(Date.now() - started < 2000);
  assert.equal(ops.filter((o) => o.op !== 'insert').map((o) => o.text).join(''), from);
  assert.equal(ops.filter((o) => o.op !== 'delete').map((o) => o.text).join(''), to);
  for (let i = 1; i < ops.length; i++) assert.notEqual(ops[i].op, ops[i - 1].op);
});
