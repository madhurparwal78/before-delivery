import test from 'node:test';
import assert from 'node:assert/strict';
import { dayStartInstant, closeInstantFor, localDateOf, isZoneValid, weekdayOf, nextDayStartText } from '../server/time.js';

test('day-start instant in UTC at hour 0', () => {
  const d = dayStartInstant('2026-03-05', 'UTC', 0);
  assert.equal(d.toISOString(), '2026-03-05T00:00:00.000Z');
});

test('close of D is the day start of D+1', () => {
  const c = closeInstantFor('2026-03-05', 'UTC', 0);
  assert.equal(c.toISOString(), '2026-03-06T00:00:00.000Z');
});

test('toronto hour 6: 03:00Z belongs to the previous local date', () => {
  // with day-start hour 6, instant 2026-11-06T03:00Z is 22:00 on 5 Nov local
  assert.equal(localDateOf(new Date('2026-11-06T03:00:00Z'), 'America/Toronto', 6), '2026-11-05');
  assert.equal(localDateOf(new Date('2026-11-06T11:00:00Z'), 'America/Toronto', 6), '2026-11-06');
});

test('local date with day-start hour 0 is the calendar date', () => {
  assert.equal(localDateOf(new Date('2026-11-06T23:30:00Z'), 'UTC', 0), '2026-11-06');
});

test('spring-forward gap: close runs at the first instant after the gap', () => {
  // America/Toronto 2026-03-08: 02:00 does not exist; close of 2026-03-07 at
  // hour 2 lands on 03:00 local (07:00Z)
  const c = closeInstantFor('2026-03-07', 'America/Toronto', 2);
  assert.equal(c.toISOString(), '2026-03-08T07:00:00.000Z');
});

test('fall-back repeat: the close runs at the first occurrence', () => {
  // America/Toronto 2026-11-01: 01:00 occurs twice (EDT -4 then EST -5).
  // The close of 2026-10-31 at hour 1 is the FIRST occurrence: 05:00Z.
  const c = closeInstantFor('2026-10-31', 'America/Toronto', 1);
  assert.equal(c.toISOString(), '2026-11-01T05:00:00.000Z');
});

test('gap at the day-start hour itself: the day begins after the gap', () => {
  // With day-start hour 2 on 2026-03-08 (the gap day), the day-start instant
  // resolves to the first instant after the gap: 03:00 local (07:00Z).
  const d = dayStartInstant('2026-03-08', 'America/Toronto', 2);
  assert.equal(d.toISOString(), '2026-03-08T07:00:00.000Z');
});

test('zone validation', () => {
  assert.equal(isZoneValid('Europe/Lisbon'), true);
  assert.equal(isZoneValid('America/Toronto'), true);
  assert.equal(isZoneValid('Asia/Manila'), true);
  assert.equal(isZoneValid('Not/AZone'), false);
  assert.equal(isZoneValid(''), false);
});

test('weekday of a local date', () => {
  // 2026-11-05 is a Thursday
  assert.equal(weekdayOf('2026-11-05', 'UTC'), 'Thu');
  assert.equal(weekdayOf('2026-11-06', 'UTC'), 'Fri');
  assert.equal(weekdayOf('2026-11-01', 'UTC'), 'Sun');
});

test('next day start text', () => {
  assert.equal(
    nextDayStartText(new Date('2026-11-07T11:00:00.000Z'), 'America/Toronto'),
    'Sat 06:00 (America/Toronto)'
  );
  assert.equal(nextDayStartText(new Date('2026-11-07T00:00:00.000Z'), 'UTC'), 'Sat 00:00 (UTC)');
});

test('lisbon day close at hour 0 is midnight local', () => {
  const c = closeInstantFor('2026-11-05', 'Europe/Lisbon', 0);
  assert.equal(c.toISOString(), '2026-11-06T00:00:00.000Z');
});

test('manila day close at hour 4 is 20:00Z of the previous UTC day', () => {
  const c = closeInstantFor('2026-11-05', 'Asia/Manila', 4);
  assert.equal(c.toISOString(), '2026-11-05T20:00:00.000Z');
});
