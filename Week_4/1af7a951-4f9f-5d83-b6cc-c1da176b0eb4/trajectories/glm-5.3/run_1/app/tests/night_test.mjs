// Night-key tests against the shared domain module, covering the published
// rules including DST-aware zone handling.
import assert from 'node:assert/strict';
import { derivedNightKey, nightKeyFor, nightNumberFor, captureWindowStatus, snapshotFor, wakeAlarmFor } from '../dist/shared/nights.js';
import { clockFor } from '../dist/shared/timezones.js';

// Bedtime-derived key: at/after bedtime it is the local date; before it is
// the previous date.
// America/Chicago in July is CDT (UTC-5).
const julyEvening = new Date('2026-07-10T01:00:00Z'); // 2026-07-09 20:00 Chicago
assert.equal(derivedNightKey(julyEvening, 'America/Chicago', '20:00'), '2026-07-09');
const julyEarly = new Date('2026-07-09T04:40:00Z'); // 2026-07-08 23:40 Chicago, before 23:00? no: 23:40 >= 23:00
assert.equal(derivedNightKey(julyEarly, 'America/Chicago', '23:00'), '2026-07-08');

// the spec example: bedtime 23:00, entry at 03:40 local belongs to the
// previous evening's night
const at0340 = new Date('2026-11-10T09:40:00Z'); // 03:40 Chicago (CST, UTC-6)
assert.equal(derivedNightKey(at0340, 'America/Chicago', '23:00'), '2026-11-09');

// never moves earlier than the latest stored key
assert.equal(nightKeyFor(at0340, 'America/Chicago', '23:00', '2026-11-15'), '2026-11-15');
assert.equal(nightKeyFor(at0340, 'America/Chicago', '23:00', null), '2026-11-09');

// westward travel: derived moves back but the published key stays
const afterTravel = new Date('2026-11-10T18:00:00Z'); // 10:00 LA local, before a 20:00 bedtime
assert.equal(derivedNightKey(afterTravel, 'America/Los_Angeles', '20:00'), '2026-11-09');
// spec example: bedtime 20:00, entry at 21:00 on day D filed under D; after
// moving 4h west it is 17:00 on D locally, so derived is D-1, but the stored
// key D keeps the published night at D
assert.equal(nightKeyFor(afterTravel, 'America/Los_Angeles', '20:00', '2026-11-10'), '2026-11-10');

// night number
assert.equal(nightNumberFor('2026-11-10', '2026-11-09'), 2);
assert.equal(nightNumberFor('2026-11-09', '2026-11-09'), 1);
assert.equal(nightNumberFor('2026-11-08', '2026-11-09'), 0);
assert.equal(nightNumberFor('2026-11-08', null), 0);

// capture window closes at 14:00 local on the day after the night key
const before2pm = new Date('2026-11-11T19:00:00Z'); // 13:00 Chicago on 2026-11-11
assert.equal(captureWindowStatus(before2pm, 'America/Chicago', '2026-11-10'), 'open');
const at2pm = new Date('2026-11-11T21:00:00Z'); // 15:00 Chicago
assert.equal(captureWindowStatus(at2pm, 'America/Chicago', '2026-11-10'), 'closed');

// wake alarm: bedtime plus five hours, wrapping
assert.equal(wakeAlarmFor('23:00'), '04:00');
assert.equal(wakeAlarmFor('23:30'), '04:30');
assert.equal(wakeAlarmFor('20:15'), '01:15');

// snapshot combines the rules
const snap = snapshotFor(at0340, 'America/Chicago', '23:00', '2026-11-05', null);
assert.equal(snap.night_key, '2026-11-09');
assert.equal(snap.night_number, 5);
assert.equal(snap.capture_window, 'open');

// DST correctness: America/Chicago changes on 2026-03-08 (CST -> CDT)
// 23:00 local on 2026-03-07 is 2026-03-08T05:00:00Z (CST, UTC-6)
const cstBedtime = new Date('2026-03-08T05:00:00Z');
const c = clockFor('America/Chicago');
assert.equal(c.hm(cstBedtime), '23:00');
assert.equal(c.ymd(cstBedtime), '2026-03-07');
// 23:00 local on 2026-03-08 is 2026-03-09T04:00:00Z (CDT, UTC-5)
const cdtBedtime = new Date('2026-03-09T04:00:00Z');
assert.equal(c.hm(cdtBedtime), '23:00');
assert.equal(c.ymd(cdtBedtime), '2026-03-08');

// 45-minute offset zone
const kathmandu = new Date('2026-11-10T18:15:00Z'); // 23:59:59+05:45 = 2026-11-11 00:00
const k = clockFor('Asia/Kathmandu');
assert.equal(k.hm(kathmandu), '00:00');
assert.equal(k.ymd(kathmandu), '2026-11-11');

// 30-minute negative offset zone: America/St_Johns (NST, UTC-3:30)
const stjohns = new Date('2026-11-10T03:00:00Z'); // 23:30 local on 2026-11-09
const s = clockFor('America/St_Johns');
assert.equal(s.ymd(stjohns), '2026-11-09');
assert.equal(s.hm(stjohns), '23:30');

// Etc sign inversion: Etc/GMT+10 is ten hours behind UTC
const etc = new Date('2026-11-10T18:00:00Z'); // 08:00 in Etc/GMT+10
const e = clockFor('Etc/GMT+10');
assert.equal(e.ymd(etc), '2026-11-10');
assert.equal(e.hm(etc), '08:00');

// dateAtLocal inverts correctly across the DST spring-forward
const localEvening = c.dateAtLocal('2026-03-07', '23:00');
assert.equal(localEvening.toISOString(), '2026-03-08T05:00:00.000Z');
const localEvening2 = c.dateAtLocal('2026-03-08', '23:00');
assert.equal(localEvening2.toISOString(), '2026-03-09T04:00:00.000Z');

console.log('all night-key domain tests passed');
