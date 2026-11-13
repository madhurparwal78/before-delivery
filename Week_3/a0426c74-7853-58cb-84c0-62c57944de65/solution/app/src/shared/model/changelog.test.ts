import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LineEntity } from '../types.ts';
import { ChangeLog } from './changelog.ts';
import { emptyDrawingState, type Change } from './index.ts';

const line = (x2: number): LineEntity => ({ handle: 'L1', type: 'line', layer: '0', x1: 0, y1: 0, x2, y2: 0 });
const change = (before: LineEntity | null, after: LineEntity | null, derived = false): Change => ({ kind: 'entity', key: 'L1', before, after, derived });
const state = (entity: LineEntity) => ({ ...emptyDrawingState(), entities: { L1: entity } });

test('otherChangeSince finds the latest non-derived change by someone else after the revision', () => {
  const log = new ChangeLog(() => state(line(30)), 100);
  log.record([change(line(0), line(10))], 'asha', 5);
  log.record([change(line(10), line(20))], 'bram', 8);
  log.record([change(line(20), line(30), true)], 'asha', 9);
  assert.deepEqual(log.otherChangeSince('entity', 'L1', 'asha', 4), { user: 'bram', revision: 8 });
  assert.deepEqual(log.otherChangeSince('entity', 'L1', 'bram', 4), { user: 'asha', revision: 5 });
  assert.equal(log.otherChangeSince('entity', 'L1', 'bram', 5), null);
  assert.equal(log.otherChangeSince('entity', 'L1', 'asha', 8), null);
  assert.equal(log.otherChangeSince('layer', 'L1', 'asha', 0), null);
});

test('entityAt answers with the before value of the first change after the revision, else the current entity', () => {
  const log = new ChangeLog(() => state(line(20)), 100);
  log.record([change(null, line(10))], 'asha', 5);
  log.record([change(line(10), line(20))], 'bram', 8);
  assert.equal(log.entityAt('L1', 4), null);
  assert.deepEqual(log.entityAt('L1', 5), line(10));
  assert.deepEqual(log.entityAt('L1', 7), line(10));
  assert.deepEqual(log.entityAt('L1', 8), line(20));
});

test('the before value of a group older than the window is let go', () => {
  const log = new ChangeLog(() => state(line(20)), 3);
  log.record([change(line(0), line(10))], 'asha', 5);
  assert.deepEqual(log.entityAt('L1', 4), line(0));
  log.record([change(line(10), line(20))], 'bram', 9);
  assert.equal(log.entityAt('L1', 4), null);
  assert.deepEqual(log.entityAt('L1', 8), line(10));
});
