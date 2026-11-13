import './testenv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as copy from '../shared/copy.ts';
import { ApiError } from '../shared/errors.ts';
import { assertStorableText } from './body.ts';

function refusal(json: unknown): ApiError {
  try {
    assertStorableText(json);
  } catch (error) {
    assert.ok(error instanceof ApiError, String(error));
    return error;
  }
  return assert.fail('expected a refusal');
}

test('text PostgreSQL cannot store is refused wherever it sits: values, keys, arrays, nested objects', () => {
  for (const json of ['a\0b', { name: 'a\0b' }, { 'k\0': 1 }, [[{ deep: ['x', 'y\0'] }]], '\ud800', 'x\udc00y', { ok: 'fine', bad: '\ud83d' }]) {
    const error = refusal(json);
    assert.equal(error.code, 'invalid');
    assert.equal(error.message, copy.UNSTORABLE_TEXT);
  }
});

test('ordinary text passes: unicode, emoji pairs, control characters other than null, numbers, null', () => {
  assert.doesNotThrow(() => assertStorableText({ a: 'Zażółć 😀 ‮ \u0001\t\n', b: [1, null, true, { c: '' }] }));
});

test('a body nested a million deep neither overflows the stack nor passes for free', () => {
  const depth = 400000;
  const nested = JSON.parse(`${'['.repeat(depth)}"a\\u0000"${']'.repeat(depth)}`);
  assert.equal(refusal(nested).code, 'invalid');
  assert.doesNotThrow(() => assertStorableText(JSON.parse(`${'['.repeat(depth)}"a"${']'.repeat(depth)}`)));
});
