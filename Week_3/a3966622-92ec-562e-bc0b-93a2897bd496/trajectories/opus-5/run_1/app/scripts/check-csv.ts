import { csvDocument, csvIntegerCell, csvTextCell } from '../src/domain/csv.ts';
import { billedHalfHours, inNightWindow } from '../src/domain/tariff.ts';
import { instantToWall, parsePortDateTime, wallToInstant } from '../src/domain/porttime.ts';
import { cutoffDisplay, noticeCutoff } from '../src/domain/notice.ts';

function show(label: string, actual: unknown, expected: unknown): void {
  const ok = String(actual) === String(expected);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
}

show('formula label guarded', csvTextCell('=HYPERLINK("x","y")'), '"\'=HYPERLINK(""x"",""y"")"');
show('minus label guarded', csvTextCell('-T61'), "'-T61");
show('plus label guarded', csvTextCell('+T62'), "'+T62");
show('at label guarded', csvTextCell('@T63'), "'@T63");
show('plain label untouched', csvTextCell('T-2026-A'), 'T-2026-A');
show('comma label quoted', csvTextCell('A,B'), '"A,B"');
show('negative integer plain', csvIntegerCell(-7017), '-7017');
show('document ends with CRLF', JSON.stringify(csvDocument([['a'], ['b']])), '"a\\r\\nb\\r\\n"');

const wall = (text: string) => {
  const parsed = parsePortDateTime(text);
  if (parsed === null) throw new Error(text);
  return parsed;
};
const instant = (text: string) => {
  const value = wallToInstant(wall(text));
  if (value === null) throw new Error(text);
  return value;
};

show('22:00 is night', inNightWindow(wall('2026-06-10T22:00')), 'true');
show('05:59 is night', inNightWindow(wall('2026-06-10T05:59')), 'true');
show('06:00 is day', inNightWindow(wall('2026-06-10T06:00')), 'false');
show('21:59 is day', inNightWindow(wall('2026-06-10T21:59')), 'false');

show('allowance absorbs 30 minutes', billedHalfHours(1800, 1, 1800), 0);
show('one second over the allowance bills a half hour', billedHalfHours(1801, 1, 1800), 1);
show('started half hour bills whole', billedHalfHours(3601, 1, 1800), 2);
show('no allowance', billedHalfHours(60, 0, 1800), 1);

const cases: [string, string, string, string][] = [
  ['2027-03-14T03:30', '2027-03-14T00:30:00', '-04:00', '2027-03-14 00:30 AST'],
  ['2027-11-07T03:30', '2027-11-07T01:30:00', '-04:00', '2027-11-07 01:30 AST'],
  ['2027-11-07T02:30', '2027-11-07T01:30:00', '-03:00', '2027-11-07 01:30 ADT'],
  ['2027-11-07T01:30', '2027-11-06T23:30:00', '-03:00', '2027-11-06 23:30 ADT'],
];
for (const [boarding, cutoffAt, offset, shown] of cases) {
  const cutoff = noticeCutoff(instant(boarding));
  show(`cutoff of ${boarding}`, `${cutoff.cutoff_at} ${cutoff.cutoff_utc_offset}`, `${cutoffAt} ${offset}`);
  show(`cutoff shown for ${boarding}`, cutoffDisplay(cutoff), shown);
}

show(
  'wall of a repeated local time is its first occurrence',
  instantToWall(instant('2026-11-01T01:30')).hour,
  1,
);
