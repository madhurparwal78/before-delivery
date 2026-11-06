import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cardRowDelay,
  coastDone,
  coastOffset,
  coastVelocity,
  quireEase,
  snapOffset,
  SPRING_OMEGA,
  springAt,
  springSettled,
  tetherReverseMs,
} from './motion.ts';

const close = (a: number, b: number, eps = 1e-9): void => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('quireEase solves cubic-bezier(0.2, 0, 0, 1)', () => {
  assert.equal(quireEase(0), 0);
  assert.equal(quireEase(1), 1);
  for (let i = 1; i < 100; i++) {
    const s = i / 100;
    const r = 1 - s;
    const x = 3 * r * r * s * 0.2 + s * s * s;
    const y = 3 * r * s * s + s * s * s;
    close(quireEase(x), y, 1e-6);
  }
  let prev = 0;
  for (let i = 1; i <= 50; i++) {
    const v = quireEase(i / 50);
    assert.ok(v >= prev && v <= 1);
    prev = v;
  }
});

// The reference spring formulas.
function spring(x0: number, v0: number, target: number, t: number): number {
  const w = 20;
  return target + (x0 - target + (v0 + w * (x0 - target)) * t) * Math.exp(-w * t);
}

function springV(x0: number, v0: number, target: number, t: number): number {
  const w = 20;
  return (v0 - w * (v0 + w * (x0 - target)) * t) * Math.exp(-w * t);
}

test('critically damped spring matches the formula', () => {
  assert.equal(SPRING_OMEGA, 20);
  for (const [x0, v0, target] of [[-320, 0, 0], [-100, 900, -320], [500, -40, 0]] as const) {
    for (const t of [0, 0.015, 0.032, 0.1, 0.4]) {
      const got = springAt(x0, v0, target, t);
      close(got.offset, spring(x0, v0, target, t));
      close(got.velocity, springV(x0, v0, target, t));
    }
  }
  assert.ok(springSettled(-0.4, 9, 0));
  assert.ok(!springSettled(-0.6, 0, 0));
  assert.ok(!springSettled(0, 11, 0));
});

test('coast velocity uses the latest sample at least 100 ms older than the last', () => {
  const samples = [
    { t: 0, offset: 1000 },
    { t: 50, offset: 990 },
    { t: 120, offset: 970 },
    { t: 200, offset: 960 },
    { t: 236, offset: 950 },
  ];
  close(coastVelocity(samples), (950 - 970) / (236 - 120));
  close(coastVelocity(samples.slice(0, 3)), (970 - 1000) / 120);
  close(coastVelocity(samples.slice(0, 2)), (990 - 1000) / 50);
  assert.equal(coastVelocity([{ t: 5, offset: 1 }, { t: 5, offset: 9 }]), 0);
  assert.equal(coastVelocity([]), 0);
});

test('coast offset decays with a 325 ms time constant and stops below 0.02 px/ms', () => {
  close(coastOffset(1000, -0.5, 0), 1000);
  close(coastOffset(1000, -0.5, 325), 1000 - 0.5 * 325 * (1 - Math.exp(-1)));
  close(coastOffset(1000, 1, 1e9), 1325);
  assert.ok(!coastDone(0.5, 0));
  const stop = 325 * Math.log(0.5 / 0.02);
  assert.ok(!coastDone(-0.5, stop - 1));
  assert.ok(coastDone(-0.5, stop + 1));
  assert.ok(coastDone(0, 0));
});

test('snap, tether reverse and row delays', () => {
  assert.equal(snapOffset(440), 296);
  assert.equal(snapOffset(450), 592);
  assert.equal(snapOffset(100, 50), 100);
  close(tetherReverseMs(0.25), 135);
  assert.equal(cardRowDelay(0), 210);
  assert.equal(cardRowDelay(3), 390);
});
