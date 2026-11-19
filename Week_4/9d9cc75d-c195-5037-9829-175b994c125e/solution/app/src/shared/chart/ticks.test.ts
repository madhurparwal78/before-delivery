import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeTicks } from './ticks.ts';

test('the brief example: 435, 480, 60, 325 gives step 200', () => {
  assert.deepEqual(computeTicks([435, 480, 60, 325]), [0, 200, 400, 600]);
});

test('small values give step 1 and the axis always includes 0', () => {
  assert.deepEqual(computeTicks([1, 2, 3]), [0, 1, 2, 3]);
  assert.deepEqual(computeTicks([150]), [0, 50, 100, 150]);
});

test('all zero or null gives 0 and 1', () => {
  assert.deepEqual(computeTicks([]), [0, 1]);
  assert.deepEqual(computeTicks([0, null, 0]), [0, 1]);
  assert.deepEqual(computeTicks([null]), [0, 1]);
});

test('negative values extend the axis below 0', () => {
  assert.deepEqual(computeTicks([-135, 40]), [-150, -100, -50, 0, 50]);
  assert.deepEqual(computeTicks([-30, -10]), [-30, -20, -10, 0]);
});

test('fractions stay exact decimals', () => {
  assert.deepEqual(computeTicks([0.3, 0.1]), [0, 0.1, 0.2, 0.3]);
  assert.deepEqual(computeTicks([0.3346, 0.0462]), [0, 0.1, 0.2, 0.3, 0.4]);
});

test('large values and a step of 10 times the power', () => {
  assert.deepEqual(computeTicks([1000]), [0, 500, 1000]);
  assert.deepEqual(computeTicks([9000]), [0, 5000, 10000]);
  assert.deepEqual(computeTicks([1_200_000]), [0, 500_000, 1_000_000, 1_500_000]);
});
