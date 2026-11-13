import './testenv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clock } from './clock.ts';
import { RateLimiter } from './ratelimit.ts';

test('allows exactly the limit within a minute and counts per key', () => {
  const limiter = new RateLimiter(3);
  assert.ok(limiter.take('a'));
  assert.ok(limiter.take('a', 2));
  assert.equal(limiter.take('a'), false);
  assert.ok(limiter.take('b', 3));
});

test('a refused batch records nothing and hits expire after a minute of the server clock', () => {
  const limiter = new RateLimiter(5);
  assert.equal(limiter.take('a', 6), false);
  assert.ok(limiter.take('a', 5));
  assert.equal(limiter.take('a'), false);
  clock.advance(60001);
  assert.ok(limiter.take('a', 5));
});
