import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readRect } from './clipRect.ts';

test('four numbers make a clip rectangle', () => {
  assert.deepEqual(readRect('90, -10, 130,10'), [90, -10, 130, 10]);
});

test('anything else is refused', () => {
  assert.equal(readRect('1,2,3'), null);
  assert.equal(readRect('1,2,3,x'), null);
  assert.equal(readRect(''), null);
});
