import './testenv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clock } from './clock.ts';
import { scheduler } from './scheduler.ts';

test('runDue runs every due item in due order, including items scheduled by items', async () => {
  const ran: string[] = [];
  const now = clock.now();
  scheduler.schedule(now + 300, () => void ran.push('c'));
  scheduler.schedule(now + 100, () => {
    ran.push('a');
    scheduler.schedule(now + 200, () => void ran.push('b'));
  });
  scheduler.schedule(now + 10000, () => void ran.push('later'));
  clock.advance(500);
  await scheduler.runDue();
  assert.deepEqual(ran, ['a', 'b', 'c']);
  clock.advance(10000);
  await scheduler.runDue();
  assert.deepEqual(ran, ['a', 'b', 'c', 'later']);
});

test('runDue waits for async items and a cancelled item never runs', async () => {
  const ran: string[] = [];
  const now = clock.now();
  scheduler.schedule(now + 1, async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    ran.push('slow');
  });
  const cancel = scheduler.schedule(now + 1, () => void ran.push('cancelled'));
  cancel();
  clock.advance(5);
  await scheduler.runDue();
  assert.deepEqual(ran, ['slow']);
});

test('items due at the same time run in the order they were scheduled', async () => {
  const ran: number[] = [];
  const due = clock.now() + 50;
  for (let i = 0; i < 20; i++) scheduler.schedule(due, () => void ran.push(i));
  clock.advance(100);
  await scheduler.runDue();
  assert.deepEqual(ran, Array.from({ length: 20 }, (_, i) => i));
});
