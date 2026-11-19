import { ScheduleRow, businessSeconds, isOpenAt, nextOpenChange, openWindowsForRange } from '../src/server/schedule.js';

const office: ScheduleRow = {
  name: 'Office hours',
  time_zone: 'Europe/Berlin',
  hours: { mon: [['08:00', '17:00']], tue: [['08:00', '17:00']], wed: [['08:00', '17:00']], thu: [['08:00', '17:00']], fri: [['08:00', '17:00']], sat: [], sun: [] },
  holidays: ['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-05-14', '2026-05-25', '2026-10-03', '2026-12-25', '2026-12-26'],
};
const clock24: ScheduleRow = {
  name: 'Around the clock',
  time_zone: 'Europe/Berlin',
  hours: { mon: [['00:00', '24:00']], tue: [['00:00', '24:00']], wed: [['00:00', '24:00']], thu: [['00:00', '24:00']], fri: [['00:00', '24:00']], sat: [['00:00', '24:00']], sun: [['00:00', '24:00']] },
  holidays: [],
};

// Friday 27 March 2026 08:00 Berlin = 07:00 UTC
const fri = Date.UTC(2026, 2, 27, 7, 0, 0);
// Monday 30 March 2026 08:00 Berlin = 06:00 UTC (DST began 29 March)
const mon = Date.UTC(2026, 2, 30, 6, 0, 0);

const dayMs = 86_400_000;
console.log('Fri 08:00->17:00 (9h):', businessSeconds(office, fri, fri + 9 * 3600_000), 'expect 32400');
console.log('Fri 08:00->Mon 08:00 (9h + weekend):', businessSeconds(office, fri, fri + 3 * dayMs), 'expect 32400');
console.log('Fri 17:00->Mon 08:00:', businessSeconds(office, fri + 9 * 3600_000, mon), 'expect 0');
console.log('Fri 08:00->Mon 17:00:', businessSeconds(office, fri, mon + 9 * 3600_000), 'expect 64800');
console.log('Mon 08:00 open:', isOpenAt(office, mon));
console.log('Mon 18:00 closed:', !isOpenAt(office, mon + 10 * 3600_000));
// DST Sunday 29 March has 23 real hours in Around the clock
const sunStart = Date.UTC(2026, 2, 28, 23, 0, 0); // 00:00 Berlin on 29 March
const windows = openWindowsForRange(clock24, sunStart, sunStart + 2 * dayMs);
console.log('29 March window length (h):', windows.map(w => (w[1] - w[0]) / 3600_000));
// 25 October overlap day has 25 hours
const octStart = Date.UTC(2026, 9, 24, 23, 0, 0);
const octWins = openWindowsForRange(clock24, octStart, octStart + 2 * dayMs);
console.log('25 October window length (h):', octWins.map(w => (w[1] - w[0]) / 3600_000));
console.log('Around the clock next change:', nextOpenChange(clock24, sunStart));
console.log('Office next change after Mon 08:00:', nextOpenChange(office, mon), '(', new Date(nextOpenChange(office, mon)!).toISOString(), ')');
// Berlin 27 March 08:00 -> 30 March 08:00 UTC times
console.log('27 Mar 08:00 Berlin =', new Date(fri).toISOString(), 'expect 2026-03-27T07:00');
console.log('30 Mar 08:00 Berlin =', new Date(mon).toISOString(), 'expect 2026-03-30T06:00');
