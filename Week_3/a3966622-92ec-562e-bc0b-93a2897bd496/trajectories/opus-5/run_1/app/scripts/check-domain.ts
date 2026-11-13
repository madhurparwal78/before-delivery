import { computePlan, openWindows, type PlanSubject } from '../src/domain/plan.ts';
import { tideTableFrom, tideHeightAt } from '../src/domain/tide.ts';
import { parsePortDate, parsePortDateTime, wallToInstant } from '../src/domain/porttime.ts';
import { clearanceCell, feetInchesFromMm, marginFromMm, moneyFromCents } from '../src/domain/numerals.ts';

const table = tideTableFrom(new Map());
const ternArrow: PlanSubject = { draught_mm: 11200, speed_kn: 10, block_coefficient: 0.8 };

function instant(text: string): number {
  const wall = parsePortDateTime(text);
  if (!wall) throw new Error(`bad wall ${text}`);
  const value = wallToInstant(wall);
  if (value === null) throw new Error(`no instant ${text}`);
  return value;
}

function show(label: string, actual: unknown, expected: unknown): void {
  const ok = String(actual) === String(expected);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
}

const plan0430 = computePlan(table, ternArrow, instant('2026-06-10T04:30'));
const sill = plan0430.waypoints.find((w) => w.id === 'W3');
show('04:30 Narrows Sill clearance', sill?.clearance_mm, 1134);
show('04:30 Narrows Sill margin', sill?.margin_mm, 14);
show('04:30 pinch', plan0430.pinch.waypoint_id, 'W3');
show('04:30 gate', plan0430.window_state, 'open');
show('04:30 leg speeds', plan0430.waypoints.map((w) => w.leg_speed_kn).join(','), '10,10,8,10,7,7');
show('04:30 squats', plan0430.waypoints.map((w) => w.squat_mm).join(','), '800,800,1024,800,784,784');
show('04:30 required', plan0430.required_mm, 1120);

const plan0425 = computePlan(table, ternArrow, instant('2026-06-10T04:25'));
show('04:25 gate', plan0425.window_state, 'closed');
show('04:25 Narrows Sill margin', plan0425.waypoints.find((w) => w.id === 'W3')?.margin_mm, -107);

const plan0650 = computePlan(table, ternArrow, instant('2026-06-10T06:50'));
const inner = plan0650.waypoints.find((w) => w.id === 'W6');
show('06:50 Inner Sill arrival', inner?.arrival_at, '2026-06-10T09:24:11');
show('06:50 pinch', plan0650.pinch.waypoint_id, 'W6');
show('06:50 Inner Sill margin', inner?.margin_mm, 53);
show('06:50 gate', plan0650.window_state, 'open');

const plan0655 = computePlan(table, ternArrow, instant('2026-06-10T06:55'));
show('06:55 gate', plan0655.window_state, 'closed');
show('06:55 Inner Sill margin', plan0655.waypoints.find((w) => w.id === 'W6')?.margin_mm, -74);

const plan0505 = computePlan(table, ternArrow, instant('2026-06-10T05:05'));
show('05:05 Outer Bar tide', plan0505.waypoints[0]?.tide_mm, 8440);

const day = (text: string) => {
  const date = parsePortDate(text);
  if (!date) throw new Error('bad date');
  return openWindows(table, ternArrow, date)
    .map((w) => `${w.from} to ${w.to}`)
    .join(' | ');
};
show('windows plain day', day('2026-06-10'), '04:30 to 06:50 | 17:00 to 18:55');

const fallBack = computePlan(table, ternArrow, instant('2026-11-01T05:05'));
show('2026-11-01 Outer Bar tide', fallBack.waypoints[0]?.tide_mm, 8730);
show('2026-11-01 windows', day('2026-11-01'), '04:15 to 06:50 | 17:00 to 18:55');

const fallBackEarly = computePlan(table, ternArrow, instant('2026-11-01T01:30'));
show('2026-11-01 01:30 W1 arrival', fallBackEarly.waypoints[0]?.arrival_at, '2026-11-01T01:48:00');
show('2026-11-01 01:30 W1 offset', fallBackEarly.waypoints[0]?.arrival_utc_offset, '-03:00');
show('2026-11-01 01:30 W2 arrival', fallBackEarly.waypoints[1]?.arrival_at, '2026-11-01T01:15:00');
show('2026-11-01 01:30 W2 offset', fallBackEarly.waypoints[1]?.arrival_utc_offset, '-04:00');

const spring = computePlan(table, ternArrow, instant('2027-03-14T05:05'));
show('2027-03-14 Outer Bar tide', spring.waypoints[0]?.tide_mm, 7984);
show('2027-03-14 windows', day('2027-03-14'), '04:45 to 06:50 | 17:00 to 18:55');

const marram: PlanSubject = { draught_mm: 12900, speed_kn: 9, block_coefficient: 0.82 };
show('Marram Light windows', openWindows(table, marram, parsePortDate('2026-06-10')!).length, 0);

show('feet 11200', feetInchesFromMm(11200), '36 ft 9 in');
show('feet 7600', feetInchesFromMm(7600), '24 ft 11.25 in');
show('margin +4', marginFromMm(4), '+0.00');
show('margin -4', marginFromMm(-4), '-0.00');
show('margin 0', marginFromMm(0), '+0.00');
show('clearance cell', clearanceCell(1140), '1.14 m / 3 ft 9 in');
show('money', moneyFromCents(291250), '2,912.50');
show('tide height standard low', Math.round(tideHeightAt(table, instant('2026-06-10T00:45'))), 1600);
