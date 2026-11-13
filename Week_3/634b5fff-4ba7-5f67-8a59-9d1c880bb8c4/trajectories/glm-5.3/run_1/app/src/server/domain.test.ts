import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { errorBody, apiError, validationError } from './errors.js';
import { nextBoxState, isPaymentForward, publicBoxState } from './orders.js';
import { chapterFor, CHAPTER_RANGES, STRIKE_CHAPTERS } from '../client/chapters.js';
import { cameraAt, boxShelfPosition, shelfColumnsFor } from '../client/cameraPath.js';
import { verifySignature } from './pure.js';

const SECRET = 'sbx_gateway_callback_secret_01';

test('every error uses the one published shape', () => {
  assert.deepEqual(errorBody('not_found'), { error: { code: 'not_found', message: 'We could not find that.' } });
  assert.deepEqual(errorBody('validation_failed', { 'buyer.email': 'Enter a valid email address.' }), {
    error: {
      code: 'validation_failed',
      message: 'Please check the highlighted fields.',
      fields: { 'buyer.email': 'Enter a valid email address.' },
    },
  });
});

test('api errors carry status and code', () => {
  const err = apiError(409, 'box_held');
  assert.equal(err.status, 409);
  assert.equal(err.code, 'box_held');
  assert.ok(validationError({}).fields);
});

test('box transitions are decided in one place', () => {
  assert.ok(nextBoxState('available', 'held'));
  assert.ok(nextBoxState('held', 'claimed'));
  assert.ok(nextBoxState('held', 'awaiting_transfer'));
  assert.ok(nextBoxState('awaiting_transfer', 'claimed'));
  assert.ok(nextBoxState('awaiting_transfer', 'available'));
  assert.ok(nextBoxState('claimed', 'packed'));
  assert.ok(nextBoxState('packed', 'shipped'));
  assert.ok(nextBoxState('shipped', 'returned'));
  assert.ok(nextBoxState('returned', 'available'));
  assert.ok(nextBoxState('held', 'available'));
  assert.ok(nextBoxState('claimed', 'available'));
  assert.ok(nextBoxState('claimed', 'returned'));
  assert.ok(nextBoxState('packed', 'returned'));
  assert.ok(!nextBoxState('available', 'shipped'));
  assert.ok(!nextBoxState('shipped', 'claimed'));
  assert.ok(!nextBoxState('packed', 'available'));
});

test('the public sees taken for everything from awaiting_transfer on', () => {
  assert.equal(publicBoxState('available'), 'available');
  assert.equal(publicBoxState('held'), 'held');
  assert.equal(publicBoxState('awaiting_transfer'), 'taken');
  assert.equal(publicBoxState('claimed'), 'taken');
  assert.equal(publicBoxState('shipped'), 'taken');
  assert.equal(publicBoxState('returned'), 'taken');
});

test('payment moves only go forward', () => {
  assert.ok(isPaymentForward('started', 'challenge'));
  assert.ok(isPaymentForward('challenge', 'authorised'));
  assert.ok(isPaymentForward('authorised', 'captured'));
  assert.ok(isPaymentForward('captured', 'partially_refunded'));
  assert.ok(isPaymentForward('partially_refunded', 'refunded'));
  assert.ok(!isPaymentForward('captured', 'authorised'));
  assert.ok(!isPaymentForward('refunded', 'captured'));
});

test('seven chapter ranges cover progress, each including its lower edge', () => {
  assert.equal(CHAPTER_RANGES.length, 7);
  assert.equal(chapterFor(0), 'alley');
  assert.equal(chapterFor(0.12), 'stove');
  assert.equal(chapterFor(0.30), 'goose');
  assert.equal(chapterFor(0.46), 'tree');
  assert.equal(chapterFor(0.62), 'star');
  assert.equal(chapterFor(0.72), 'grandmother');
  assert.equal(chapterFor(0.86), 'shelf');
  assert.equal(chapterFor(1), 'shelf');
  // The strike chapters exclude alley and shelf.
  assert.ok(!STRIKE_CHAPTERS.includes('alley'));
  assert.ok(!STRIKE_CHAPTERS.includes('shelf'));
  assert.equal(STRIKE_CHAPTERS.length, 5);
});

test('equal steps of progress cover equal distances within 5%', () => {
  const steps = [0, 0.25, 0.5, 0.75, 1];
  const positions = steps.map((s) => cameraAt(s).position);
  const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
    Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const d = dist(positions[0], positions[1]);
  for (let i = 1; i < steps.length - 1; i++) {
    const step = dist(positions[i], positions[i + 1]);
    assert.ok(Math.abs(step - d) / d <= 0.05, `step ${i}: ${step} vs ${d}`);
  }
  // Returning to a progress value returns to the same place.
  const a = cameraAt(0.37).position;
  const b = cameraAt(0.37).position;
  assert.deepEqual(a, b);
});

test('published shelf column bands', () => {
  assert.equal(shelfColumnsFor(375), 6);
  assert.equal(shelfColumnsFor(767), 6);
  assert.equal(shelfColumnsFor(768), 12);
  assert.equal(shelfColumnsFor(1279), 12);
  assert.equal(shelfColumnsFor(1280), 20);
});

test('box shelf positions cover the grid', () => {
  const p = boxShelfPosition(1, 6);
  assert.ok(p.x < 0, 'first column starts left of centre');
  const q = boxShelfPosition(6, 6);
  assert.ok(q.x > 0, 'last column ends right of centre');
  const r = boxShelfPosition(7, 6);
  assert.ok(r.y > p.y, 'the second row sits above the first');
});

test('a callback with a bad signature changes nothing', () => {
  assert.equal(verifySignature('{"a":1}', 't=1,v1=deadbeef', SECRET), false);
  assert.equal(verifySignature('{"a":1}', undefined, SECRET), false);
  assert.equal(verifySignature('{"a":1}', 'not-a-signature', SECRET), false);
  // A stale timestamp is refused in either direction.
  const stale = Math.floor(Date.now() / 1000) - 400;
  assert.equal(verifySignature('{"a":1}', `t=${stale},v1=${'0'.repeat(64)}`, SECRET), false);
});

test('a good signature passes', () => {
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', SECRET).update(`${t}.{"a":1}`).digest('hex');
  assert.equal(verifySignature('{"a":1}', `t=${t},v1=${sig}`, SECRET), true);
  // A different body fails.
  assert.equal(verifySignature('{"a":2}', `t=${t},v1=${sig}`, SECRET), false);
});

test('hold, challenge and authorisation seconds have the published defaults', () => {
  assert.equal(Number(process.env.HOLD_SECONDS ?? 600), 600);
  assert.equal(Number(process.env.CHALLENGE_SECONDS ?? 300), 300);
  assert.equal(Number(process.env.AUTH_SECONDS ?? 604_800), 604_800);
});
