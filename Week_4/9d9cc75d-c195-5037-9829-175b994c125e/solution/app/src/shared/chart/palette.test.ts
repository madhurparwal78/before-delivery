import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memberStyle, patternInk, sequentialColour } from './palette.ts';
import { memberOrder } from './plan.ts';

test('members take the five colours and patterns in order, cycling', () => {
  assert.deepEqual(memberStyle(0), { color: '233, 71, 159', pattern: 'solid' });
  assert.deepEqual(memberStyle(1), { color: '26, 10, 20', pattern: 'dots' });
  assert.deepEqual(memberStyle(2), { color: '217, 225, 63', pattern: 'stripes' });
  assert.deepEqual(memberStyle(4), { color: '234, 160, 205', pattern: 'rings' });
  assert.deepEqual(memberStyle(5), memberStyle(0));
  assert.deepEqual(memberStyle(7), memberStyle(2));
});

test('the sequential scale rounds each channel half up', () => {
  assert.equal(sequentialColour(150, 30, 280), '243, 159, 205');
  assert.equal(sequentialColour(210, 30, 280), '239, 119, 184');
  assert.equal(sequentialColour(30, 30, 280), '253, 241, 247');
  assert.equal(sequentialColour(280, 30, 280), '233, 71, 159');
  assert.equal(sequentialColour(5, 5, 5), '233, 71, 159');
});

test('pattern ink reads against the mark colour', () => {
  assert.equal(patternInk('26, 10, 20'), '253, 241, 247');
  assert.equal(patternInk('217, 225, 63'), '26, 10, 20');
});

test('member order merges sorted sequences', () => {
  assert.deepEqual(memberOrder([['Black', 'Green', 'Herbal'], ['Black', 'Herbal']]), ['Black', 'Green', 'Herbal']);
  assert.deepEqual(memberOrder([['Black', 'Herbal'], ['Black', 'Green', 'Herbal']]), ['Black', 'Green', 'Herbal']);
  assert.deepEqual(memberOrder([['a', 'c'], ['a', 'b', 'c']]), ['a', 'b', 'c']);
  assert.deepEqual(memberOrder([]), []);
});
