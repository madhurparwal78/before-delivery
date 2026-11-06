// Development checks for the simulation and local-time engine. Run: node tools/checks.mjs
import { simulate, snapshotAt } from '../src/sim/battle.ts';
import { dayStart, nextDayStart, weekStart, nextWeekStart, dateKey } from '../src/domain/localtime.ts';

// --- battle: a single Saltjack against a starter island with a Kiln Tower (hp 600 at L1)
const layout = [
  { index: 0, id: 1, type: 'tide_barracks', x: 12, y: 18, rotation: 0, level: 1, hp: 500 },
  { index: 1, id: 2, type: 'kiln_tower', x: 18, y: 26, rotation: 0, level: 1, hp: 600 },
];
const run = simulate({ seed: 12345, layout, deploys: [{ tick: 0, unit: 'saltjack', x: 0, y: 20 }], lootable: { brine: 300, peat: 300, copper: 0 } });
console.log('finalTick', run.finalTick, 'destruction', run.destruction, 'stars', run.stars, 'loot', run.loot);
console.log('determinism:', JSON.stringify(simulate({ seed: 12345, layout, deploys: [{ tick: 0, unit: 'saltjack', x: 0, y: 20 }], lootable: { brine: 300, peat: 300, copper: 0 } }).ticks.at(-1)) === JSON.stringify(run.ticks.at(-1)));
const s = snapshotAt({ seed: 12345, layout, deploys: [{ tick: 0, unit: 'saltjack', x: 0, y: 20 }], lootable: { brine: 300, peat: 300, copper: 0 } }, 3);
console.log('tick3 units', JSON.stringify(s.units), 'hash', s.hash);

// --- local days
const Z = 'America/Santiago';
// 5 Sep 2027: Santiago springs forward at midnight (24:00 -> 01:00). Local day starts at 01:00.
const t = Date.parse('2027-09-05T12:00:00.000Z');
console.log('santiago date', dateKey(t, Z), 'dayStart', new Date(dayStart(t, Z)).toISOString());
console.log('expected 2027-09-05T05:00:00.000Z (01:00 local, since midnight skipped)');

// Havana: Sunday 14 March 2027 — clocks jump 00:00 -> 01:00
const H = 'America/Havana';
const t2 = Date.parse('2027-03-14T12:00:00.000Z');
console.log('havana dayStart', new Date(dayStart(t2, H)).toISOString(), 'expect 2027-03-14T05:00:00.000Z');
console.log('havana nextDay', new Date(nextDayStart(t2, H)).toISOString(), 'expect 2027-03-15T04:00:00.000Z (midnight local)');

// Lisbon fall-back: 31 Oct 2027 01:00 -> 00:00 (repeated midnight at 00:00 on 31 Oct? actually transition 01:00->00:00 means 00:00 occurs once on 31 Oct; the repeated hour is 00:00-00:59 twice? no: 01:00->00:00 repeats 00:00-00:59)
const L = 'Europe/Lisbon';
const t3 = Date.parse('2027-10-31T12:00:00.000Z');
console.log('lisbon dayStart 31 Oct', new Date(dayStart(t3, L)).toISOString(), 'expect 2027-10-31T23:00:00.000Z? (00:00 local = 23:00Z on 30 Oct? no: WEST ends 02:00 local -> 01:00; check)');
console.log('lisbon nextDay 1 Nov', new Date(nextDayStart(t3, L)).toISOString(), 'expect 2027-11-01T00:00:00.000Z (00:00 local WET)');
console.log('lisbon weekStart', new Date(weekStart(t3, L)).toISOString(), 'expect 2027-10-25T23:00:00.000Z Monday 00:00 WEST');
console.log('lisbon nextWeekStart', new Date(nextWeekStart(t3, L)).toISOString(), 'expect 2027-11-01T00:00:00.000Z');

// Kathmandu +05:45
const K = 'Asia/Kathmandu';
const t4 = Date.parse('2027-09-05T18:10:00.000Z');
console.log('kathmandu date', dateKey(t4, K), 'expect 2027-09-05 (23:55 local)');
console.log('kathmandu nextDay', new Date(nextDayStart(t4, K)).toISOString(), 'expect 2027-09-05T18:15:00.000Z (00:00 local 6 Sep)');

// Kiritimati +14
const P = 'Pacific/Kiritimati';
const t5 = Date.parse('2028-12-31T09:55:00.000Z');
console.log('kiritimati date', dateKey(t5, P), 'expect 2029-01-01 (23:55 local +14 = 13:55? 09:55Z + 14h = 23:55 31 Dec? hmm +14: 2028-12-31T23:55 local)');

// Santiago repeated midnight: 2027-04-04? Chile falls back first Saturday of April at 24:00 -> 23:00? Actually 03:00->02:00. Let's test nextDay over the autumn change: 3 Apr 2027
const t6 = Date.parse('2027-04-03T12:00:00.000Z');
console.log('santiago autumn dayStart', new Date(dayStart(t6, Z)).toISOString(), 'expect 2027-04-03T04:00:00.000Z');
const t7 = t6 + 36 * 3600 * 1000;
console.log('santiago autumn nextDay', new Date(nextDayStart(t6, Z)).toISOString(), 'expect 2027-04-04T05:00:00.000Z? (03:00->02:00 fallback, midnight exists once = 04:00Z)');
