import {
  venueWallToInstant,
  instantToVenueWall,
  venueAbbrevForDate,
  venueOffsetLabel,
} from '../src/shared/venue.js';

let fails = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) fails++;
  console.log(ok ? 'ok  ' : 'FAIL', label, '=>', got, ok ? '' : 'want ' + want);
}

// Published instants from the brief.
check(
  'd1 11:30 ADT',
  new Date(venueWallToInstant('2026-10-31', 11.5 * 3600_000)).toISOString(),
  '2026-10-31T14:30:00.000Z',
);
check(
  'd2 11:00 AST',
  new Date(venueWallToInstant('2026-11-01', 11 * 3600_000)).toISOString(),
  '2026-11-01T15:00:00.000Z',
);
check('day1 abbrev', venueAbbrevForDate('2026-10-31'), 'ADT');
check('day2 abbrev', venueAbbrevForDate('2026-11-01'), 'AST');
check('day1 label', venueOffsetLabel('2026-10-31'), '-03');
check('day2 label', venueOffsetLabel('2026-11-01'), '-04');

// Round trip for a range of times across the transition.
for (const date of ['2026-10-31', '2026-11-01']) {
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 17]) {
      const wall = h * 3600_000 + m * 60_000;
      const inst = venueWallToInstant(date, wall);
      const back = instantToVenueWall(inst);
      if (back.date !== date || back.wallClock !== wall) {
        fails++;
        console.log('FAIL roundtrip', date, h, m, '->', new Date(inst).toISOString(), back);
      }
    }
  }
}
console.log('roundtrips done');
console.log(fails === 0 ? 'ALL OK' : fails + ' FAILURES');
