/**
 * The brief's worked examples, checked against the shared domain modules.
 * Run with: node scripts/domain-check.mjs (built by scripts/build-checks.mjs)
 */
import { eveningDate, localTimeLine, parseTimestamp, utcOffset, withinObservationWindow } from '../src/shared/clock.js';
import { completenessFailures, editionFor } from '../src/shared/completeness.js';
import { apertureToMm, deriveOptics, readoutLine, sortEyepieces } from '../src/shared/optics.js';
import { derivePair } from '../src/shared/pair.js';
import { clampToField, moveCursor, pixelToSky, skyToPixel } from '../src/shared/projection.js';
import { roundHalfUp, formatAperture } from '../src/shared/round.js';
import { safeNextPath } from '../src/shared/next-path.js';
import { parseStrokeFile } from '../src/shared/strokes.js';
import type { ProgramEdition, SkyPoint, TrainId } from '../src/shared/types.js';

let failures = 0;
function check(label: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!condition) failures += 1;
}

// ---- derived optics ------------------------------------------------------
const dob10 = { id: 't1', name: '10-inch Dobsonian', aperture_mm: 254, focal_length_mm: 1200 };
const refractor = { id: 't2', name: '80 mm refractor', aperture_mm: 80, focal_length_mm: 480 };
const ep25 = { id: 'e1', name: '25 mm wide', focal_length_mm: 25, apparent_field_deg: 67 };
const ep10 = { id: 'e2', name: '10 mm wide', focal_length_mm: 10, apparent_field_deg: 67 };
const ep6 = { id: 'e3', name: '6 mm', focal_length_mm: 6, apparent_field_deg: 60 };
const barlow = { id: 'b1', name: '2× Barlow', factor: 2 };

const at25 = deriveOptics({ telescope: dob10, eyepiece: ep25, barlow: null, train: 'straight' });
check(
  'the brief: 10-inch with 25 mm wide gives 48x, 84 arcmin, 5.3 mm',
  at25.magnification === 48 && at25.true_field_arcmin === 84 && at25.exit_pupil_mm === 5.3,
  JSON.stringify(at25),
);
const at10 = deriveOptics({ telescope: dob10, eyepiece: ep10, barlow: null, train: 'straight' });
check(
  'the brief: 10 mm wide gives 120x, 34 arcmin, 2.1 mm',
  at10.magnification === 120 && at10.true_field_arcmin === 34 && at10.exit_pupil_mm === 2.1,
  JSON.stringify(at10),
);
const at6 = deriveOptics({ telescope: dob10, eyepiece: ep6, barlow: null, train: 'straight' });
check(
  'the brief: 6 mm gives 200x, 18 arcmin, 1.3 mm',
  at6.magnification === 200 && at6.true_field_arcmin === 18 && at6.exit_pupil_mm === 1.3,
  JSON.stringify(at6),
);
const withBarlow = deriveOptics({ telescope: dob10, eyepiece: ep10, barlow, train: 'straight' });
check('a Barlow multiplies the magnification', withBarlow.magnification === 240, JSON.stringify(withBarlow));
check(
  'the readout line is the published form',
  readoutLine(at10) === '120× · 34′ field · 2.1 mm exit pupil · North down, east right.',
  readoutLine(at10),
);
check('an exact half rounds up: 33.5 arcmin becomes 34', roundHalfUp(33.5) === 34);
check('ten inches is 254 mm', apertureToMm(10, 'in') === 254, String(apertureToMm(10, 'in')));
check('eight inches is 203.2 mm', apertureToMm(8, 'in') === 203.2, String(apertureToMm(8, 'in')));
check('a whole aperture prints bare', formatAperture(254) === '254');
check('a fractional aperture prints to one decimal', formatAperture(203.2) === '203.2');
check(
  'eyepieces sort longest focal length first',
  JSON.stringify(sortEyepieces([ep6, ep25, ep10]).map((e) => e.focal_length_mm)) === '[25,10,6]',
);
check('the 80 mm refractor derives too', deriveOptics({ telescope: refractor, eyepiece: ep25, barlow: null, train: 'straight' }).magnification === 19);

// ---- projection ----------------------------------------------------------
// A tap at half the radius right of centre and half above it, at a 34' field.
const FIELD = 34;
const RADIUS = 100;
const expected: Record<TrainId, string> = {
  straight: '[8.5,-8.5]',
  mirror_diagonal: '[8.5,8.5]',
  erecting_prism: '[-8.5,8.5]',
};
for (const train of ['straight', 'mirror_diagonal', 'erecting_prism'] as TrainId[]) {
  const stored = pixelToSky({ x: RADIUS / 2, y: -RADIUS / 2 }, train, FIELD, RADIUS);
  check(
    `the brief's projection table: ${train} stores ${expected[train]}`,
    JSON.stringify(stored) === expected[train],
    JSON.stringify(stored),
  );
}
// Arrow directions per train.
const arrowCases: Array<[TrainId, 'right' | 'up', (p: SkyPoint) => boolean, string]> = [
  ['straight', 'right', (p) => p[0] > 0, 'adds east'],
  ['straight', 'up', (p) => p[1] < 0, 'subtracts north'],
  ['mirror_diagonal', 'right', (p) => p[0] > 0, 'adds east'],
  ['mirror_diagonal', 'up', (p) => p[1] > 0, 'adds north'],
  ['erecting_prism', 'right', (p) => p[0] < 0, 'subtracts east'],
  ['erecting_prism', 'up', (p) => p[1] > 0, 'adds north'],
];
for (const [train, direction, holds, wording] of arrowCases) {
  const moved = moveCursor([0, 0], direction, train, FIELD, 1);
  check(`${train}: ${direction} arrow ${wording}`, holds(moved), JSON.stringify(moved));
}
// A star 10' north under a 34' field sits 10/17 of the radius from the centre.
for (const train of ['straight', 'mirror_diagonal'] as TrainId[]) {
  const pixel = skyToPixel([0, 10], train, FIELD, RADIUS);
  const fraction = Math.hypot(pixel.x, pixel.y) / RADIUS;
  check(
    `a star 10' north sits 59% of the radius out under ${train}`,
    Math.abs(fraction - 10 / 17) < 1e-9,
    fraction.toFixed(4),
  );
}
check(
  'under straight through it falls below the centre',
  skyToPixel([0, 10], 'straight', FIELD, RADIUS).y > 0,
);
check(
  'after a mirror diagonal it sits above the centre',
  skyToPixel([0, 10], 'mirror_diagonal', FIELD, RADIUS).y < 0,
);
// Ten presses of Right at 34', then a swap to 18', stores [9,0].
let cursor: SkyPoint = [0, 0];
for (let press = 0; press < 10; press += 1) {
  cursor = moveCursor(cursor, 'right', 'straight', FIELD, 1);
}
check("ten Right presses reach 10' east", JSON.stringify(cursor) === '[10,0]', JSON.stringify(cursor));
cursor = clampToField(cursor, 18);
check(
  'a narrower field moves the cursor along its radius to the edge, storing [9,0]',
  JSON.stringify(cursor) === '[9,0]',
  JSON.stringify(cursor),
);

// ---- measured pair -------------------------------------------------------
const pairCases: Array<[SkyPoint, string, number, number]> = [
  [[3, 4], '5.0 and 37', 5.0, 37],
  [[-1, 0], '1.0 and 270', 1.0, 270],
  [[-0.01, 10], '10.0 and 0', 10.0, 0],
];
for (const [secondary, label, separation, angle] of pairCases) {
  const measured = derivePair({ primary: [0, 0], secondary });
  check(
    `the brief's pair example ${JSON.stringify(secondary)} gives ${label}`,
    measured.separation_arcmin === separation && measured.position_angle_deg === angle,
    `${measured.separation_arcmin} / ${measured.position_angle_deg}`,
  );
}
for (const train of ['straight', 'mirror_diagonal', 'erecting_prism'] as TrainId[]) {
  const measured = derivePair({ primary: [0, 0], secondary: [3, 4] });
  check(
    `pair values are the same under ${train}`,
    measured.separation_arcmin === 5 && measured.position_angle_deg === 37,
  );
}

// ---- evening dates and offsets ------------------------------------------
const denver = 'America/Denver';
const cases: Array<[string, string, string, string]> = [
  ['2025-06-22T03:30:00Z', '2025-06-21', '21:30', '-06:00'],
  ['2026-07-18T02:45:00Z', '2026-07-17', '20:45', '-06:00'],
  ['2026-11-01T01:30:00Z', '2026-10-31', '19:30', '-06:00'],
];
for (const [stamp, evening, clock, offset] of cases) {
  const date = parseTimestamp(stamp);
  if (!date) {
    check(`parse ${stamp}`, false);
    continue;
  }
  check(
    `${stamp} belongs to the evening of ${evening} at ${clock} UTC${offset}`,
    eveningDate(date, denver) === evening && localTimeLine(date, denver) === `${clock} local, UTC${offset}`,
    `${eveningDate(date, denver)} / ${localTimeLine(date, denver)}`,
  );
}
// The night the clocks fall back tells repeated local times apart.
const beforeFallBack = parseTimestamp('2026-11-01T07:25:00Z');
const afterFallBack = parseTimestamp('2026-11-01T08:25:00Z');
check(
  'the two 01:25 local times carry different offsets',
  beforeFallBack !== null &&
    afterFallBack !== null &&
    localTimeLine(beforeFallBack, denver) === '01:25 local, UTC-06:00' &&
    localTimeLine(afterFallBack, denver) === '01:25 local, UTC-07:00',
  `${beforeFallBack && localTimeLine(beforeFallBack, denver)} / ${afterFallBack && localTimeLine(afterFallBack, denver)}`,
);
check('UTC prints as +00:00', utcOffset(new Date('2026-01-01T00:00:00Z'), 'UTC') === '+00:00');
const noon = parseTimestamp('2026-07-17T18:00:00Z');
check(
  'a start at exactly 12:00 local belongs to that date',
  noon !== null && eveningDate(noon, denver) === '2026-07-17',
  noon ? eveningDate(noon, denver) : 'unparsed',
);

// The 18 elapsed hours are measured in real time, over a fall back.
const start = parseTimestamp('2026-11-01T01:30:00Z') as Date;
const almost = new Date(start.getTime() + (17 * 60 + 59) * 60_000);
const exactly = new Date(start.getTime() + 18 * 60 * 60_000);
check('17 hours 59 minutes after the start is accepted', withinObservationWindow(almost, start));
check('exactly 18 hours fails', !withinObservationWindow(exactly, start));
check('a time before the start fails', !withinObservationWindow(new Date(start.getTime() - 1000), start));

// ---- timestamp formats ---------------------------------------------------
check('a plain Z timestamp parses', parseTimestamp('2026-07-18T03:20:00Z') !== null);
check('a millisecond fraction parses', parseTimestamp('2026-07-18T03:20:00.123Z') !== null);
check('a one-digit fraction parses', parseTimestamp('2026-07-18T03:20:00.1Z') !== null);
check('four fraction digits are refused', parseTimestamp('2026-07-18T03:20:00.1234Z') === null);
check('an offset instead of Z is refused', parseTimestamp('2026-07-18T03:20:00+00:00') === null);
check('a date alone is refused', parseTimestamp('2026-07-18') === null);
check('an impossible calendar date is refused', parseTimestamp('2026-02-30T00:00:00Z') === null);

// ---- rule editions and completeness -------------------------------------
const globularEditions: ProgramEdition[] = [
  {
    edition: 1,
    effective_from: '2000-01-01',
    min_description: 60,
    sketch_required: true,
    concentration_required: false,
    pair_required: false,
  },
  {
    edition: 2,
    effective_from: '2026-09-01',
    min_description: 80,
    sketch_required: true,
    concentration_required: true,
    pair_required: false,
  },
];
check('an evening before the newer edition uses edition 1', editionFor(globularEditions, '2026-07-17').edition === 1);
check('the day the newer edition takes effect uses edition 2', editionFor(globularEditions, '2026-09-01').edition === 2);
check('a later evening uses edition 2', editionFor(globularEditions, '2026-10-31').edition === 2);

const rules = {
  required_count: 5,
  editions: globularEditions,
  object_ids: ['m13', 'm92', 'm3', 'm5', 'm15', 'm2'],
};
const m2 = {
  id: 'o1',
  object_id: 'm2',
  kind: 'globular' as const,
  evening_date: '2026-10-31',
  observed_at: '2026-11-01T08:20:00Z',
  seeing: 7,
  transparency_nelm: 6.3,
  concentration_class: null,
  has_pair: false,
  description: 'Bright round glow with a grainy halo; core unresolved at 200x tonight.',
  has_sketch: true,
  sequence: 1,
};
check(
  'the seeded M2 fails on its class and its description length',
  JSON.stringify(completenessFailures(m2, rules)) === '["missing_concentration","short_description"]',
  JSON.stringify(completenessFailures(m2, rules)),
);
check(
  'with class IV and 80 characters it qualifies',
  completenessFailures({ ...m2, concentration_class: 'IV', description: 'x'.repeat(80) }, rules).length === 0,
);
check(
  'with 79 characters it still falls short',
  JSON.stringify(
    completenessFailures({ ...m2, concentration_class: 'IV', description: 'x'.repeat(79) }, rules),
  ) === '["short_description"]',
);
check(
  'an object off the list reports only not_on_program',
  JSON.stringify(completenessFailures({ ...m2, object_id: 'm27' }, rules)) === '["not_on_program"]',
);

// ---- the safe next path --------------------------------------------------
check('a plain path is honoured', safeNextPath('/objects/m13') === '/objects/m13');
check('a path with a query is honoured', safeNextPath('/sessions/x?observation=y') === '/sessions/x?observation=y');
check('an absolute URL falls back', safeNextPath('https://evil.test/x') === '/tonight');
check('a protocol-relative path falls back', safeNextPath('//evil.test') === '/tonight');
check('a backslash path falls back', safeNextPath('/\\evil.test') === '/tonight');
check('the sign-in route falls back', safeNextPath('/signin') === '/tonight');
check('the sign-up route falls back', safeNextPath('/signup?x=1') === '/tonight');
check('an encoded protocol-relative path falls back', safeNextPath('%2F%2Fevil.test') === '/tonight');
check('nothing falls back', safeNextPath(null) === '/tonight');

// ---- stroke files --------------------------------------------------------
check(
  'a valid stroke file parses',
  parseStrokeFile('{"format":"lowlamp-strokes/1","strokes":[],"stars":[{"at":[1,2],"brightness":3}]}') !== null,
);
check('a wrong format is refused', parseStrokeFile('{"format":"other","strokes":[],"stars":[]}') === null);
check('a bad brightness is refused', parseStrokeFile('{"format":"lowlamp-strokes/1","strokes":[],"stars":[{"at":[1,2],"brightness":6}]}') === null);
check('three decimals are refused', parseStrokeFile('{"format":"lowlamp-strokes/1","strokes":[],"stars":[{"at":[1.234,2],"brightness":3}]}') === null);
check('a bad stroke width is refused', parseStrokeFile('{"format":"lowlamp-strokes/1","strokes":[{"width":"huge","points":[]}],"stars":[]}') === null);
check('text that is not JSON is refused', parseStrokeFile('not json') === null);

console.log(failures === 0 ? '\nall domain checks passed' : `\n${failures} domain checks failed`);
process.exit(failures === 0 ? 0 : 1);
