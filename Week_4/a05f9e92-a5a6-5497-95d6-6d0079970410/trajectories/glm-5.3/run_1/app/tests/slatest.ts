import { computeSla, SlaDefinitionRow, SlaStage } from '../src/server/sla.js';
import { ScheduleRow } from '../src/server/schedule.js';

const office: ScheduleRow = {
  name: 'Office hours', time_zone: 'Europe/Berlin',
  hours: { mon: [['08:00','17:00']], tue: [['08:00','17:00']], wed: [['08:00','17:00']], thu: [['08:00','17:00']], fri: [['08:00','17:00']], sat: [], sun: [] },
  holidays: ['2026-01-01'],
};
const resolution: SlaDefinitionRow = {
  name: 'Incident resolution', table: 'incident',
  start: 'true', pause: 'state = "on_hold"', stop: 'state in ["resolved", "closed", "cancelled"]',
  schedule: 'Office hours', targets: { '1': 14400, '2': 32400, '3': 64800, '4': 129600, '5': 259200 },
};

const h = 3600_000;
// Created Monday 30 March 2026 08:00 Berlin (=06:00 UTC, after DST switch)
const start = Date.UTC(2026, 2, 30, 6, 0, 0);
const hist = (state: string, at: number) => ({ state, fields: {}, at });

// 1. Four hours in progress -> exactly at target for priority 1 (breach at target)
const r1 = computeSla({ definition: resolution, schedule: office, priority: 1, startAt: start,
  history: [hist('new', start), hist('in_progress', start)], now: start + 4 * h });
console.log('4h elapsed:', r1.elapsed, 'expect 14400; breached:', r1.breached, 'expect true; stage:', r1.stage);

// 2. Two hours, then on hold for one hour, then resumed: elapsed stops during hold
const holdAt = start + 2 * h;
const r2 = computeSla({ definition: resolution, schedule: office, priority: 2, startAt: start,
  history: [hist('new', start), hist('in_progress', start), hist('on_hold', holdAt), hist('in_progress', holdAt + h)],
  now: holdAt + h + h });
console.log('hold split:', r2.elapsed, 'expect 10800 (2h + 1h); paused:', r2.paused, 'expect 3600; stage:', r2.stage, 'expect in_progress');

// 3. Still on hold: stage paused
const r3 = computeSla({ definition: resolution, schedule: office, priority: 2, startAt: start,
  history: [hist('new', start), hist('in_progress', start), hist('on_hold', holdAt)],
  now: holdAt + h });
console.log('paused now:', r3.elapsed, 'expect 7200; paused:', r3.paused, 'expect 3600; stage:', r3.stage, 'expect paused');

// 4. Resolved: stage completed, elapsed frozen at resolve time
const r4 = computeSla({ definition: resolution, schedule: office, priority: 2, startAt: start,
  history: [hist('new', start), hist('in_progress', start), hist('resolved', start + 2 * h)],
  now: start + 8 * h });
console.log('resolved:', r4.elapsed, 'expect 7200; stage:', r4.stage, 'expect completed');

// 5. Reopened: resumes from elapsed at resolve, stopped time never counts
const r5 = computeSla({ definition: resolution, schedule: office, priority: 2, startAt: start,
  history: [hist('new', start), hist('in_progress', start), hist('resolved', start + 2 * h), hist('in_progress', start + 6 * h)],
  now: start + 7 * h });
console.log('reopened:', r5.elapsed, 'expect 10800 (2h at resolve + 1h after); stage:', r5.stage, 'expect in_progress');

// 6. Overnight: from 16:00 to next day 09:00 counts 1h + 1h = 2h
const late = Date.UTC(2026, 2, 30, 15, 0, 0); // 16:00 Berlin
const r6 = computeSla({ definition: resolution, schedule: office, priority: 5, startAt: late,
  history: [hist('new', late), hist('in_progress', late)], now: late + 17 * h });
console.log('overnight:', r6.elapsed, 'expect 7200; nextChange set:', r6.nextChange !== null);
