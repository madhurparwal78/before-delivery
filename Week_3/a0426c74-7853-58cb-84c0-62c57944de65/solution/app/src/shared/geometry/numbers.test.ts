import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clamp, compareHandles, fmt3, fmtAngle, fmtData, fmtFixed, handleNumber, isOptimisticHandle, measureDistance, midpoint, normalizeAngle, optimisticHandle, round6,
} from './numbers.ts';

describe('numbers', () => {
  it('rounds stored numbers to 6 decimals, half away from zero', () => {
    assert.equal(round6(1.0000005), 1.000001);
    assert.equal(round6(-1.0000005), -1.000001);
    assert.equal(round6(0.1 + 0.2), 0.3);
    assert.equal(Object.is(round6(-0.0000001), 0), true);
  });

  it('prints display numbers with 3 decimals trimmed and -0 as 0', () => {
    assert.equal(fmt3(12.56637061), '12.566');
    assert.equal(fmt3(10), '10');
    assert.equal(fmt3(7.8539816), '7.854');
    assert.equal(fmt3(-0.0004), '0');
    assert.equal(fmt3(2.0005), '2.001');
    assert.equal(fmt3(-2.0005), '-2.001');
  });

  it('prints angles with 2 decimals trimmed', () => {
    assert.equal(fmtAngle(45), '45');
    assert.equal(fmtAngle(33.690067), '33.69');
    assert.equal(fmtAngle(0.004), '0');
  });

  it('prints data attributes as stored numbers trimmed', () => {
    assert.equal(fmtData(25.4), '25.4');
    assert.equal(fmtData(3.5355339059), '3.535534');
    assert.equal(fmtData(-0), '0');
    assert.equal(fmtData(1e-7), '0');
  });

  it('prints dimension values at the style precision with zeros kept, half away from zero', () => {
    assert.equal(fmtFixed(10, 2), '10.00');
    assert.equal(fmtFixed(Math.hypot(13, 4), 2), '13.60');
    assert.equal(fmtFixed(Math.hypot(13, 4), 3), '13.601');
    assert.equal(fmtFixed(2.5, 2), '2.50');
    assert.equal(fmtFixed(0.125, 2), '0.13');
    assert.equal(fmtFixed(1.005, 2), '1.01');
    assert.equal(fmtFixed(7, 0), '7');
  });

  it('normalises angles into [0, 360)', () => {
    assert.equal(normalizeAngle(-90), 270);
    assert.equal(normalizeAngle(360), 0);
    assert.equal(normalizeAngle(450), 90);
    assert.equal(normalizeAngle(-1e-15), 0);
  });

  it('reads the number of a handle and orders handles', () => {
    assert.equal(handleNumber('L12'), 12);
    assert.equal(handleNumber('Site|L12'), 12);
    assert.equal(handleNumber('Outer|Inner|C3'), 3);
    assert.deepEqual(['L10', 'A2', 'new-1', 'C3'].sort(compareHandles), ['A2', 'C3', 'L10', 'new-1']);
  });

  it('measures DIST with an angle from 0 up to 360', () => {
    assert.deepEqual(measureDistance([0, 0], [3, 4]).distance, 5);
    assert.equal(Math.round(measureDistance([0, 0], [-1, -1]).angle), 225);
    assert.equal(measureDistance([0, 0], [10, 0]).angle, 0);
    assert.equal(measureDistance([0, 0], [0, -5]).angle, 270);
  });

  it('makes and recognises the handle of an entity the browser added before the server answered', () => {
    assert.equal(optimisticHandle(3), 'new-3');
    assert.ok(isOptimisticHandle('new-3') && !isOptimisticHandle('L3'));
  });

  it('clamps and takes midpoints', () => {
    assert.deepEqual([clamp(5, 0, 3), clamp(-1, 0, 3), clamp(2, 0, 3)], [3, 0, 2]);
    assert.deepEqual(midpoint([0, 0], [4, -2]), [2, -1]);
  });
});
