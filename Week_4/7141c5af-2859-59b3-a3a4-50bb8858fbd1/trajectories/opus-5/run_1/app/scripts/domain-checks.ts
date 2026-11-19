/**
 * The published worked examples, checked against the domain rules directly.
 * Verification only.
 */
import { parseDec, toFixed, fromInt, divHalfUp } from '../src/server/domain/decimal.ts';
import {
  computeEstimate,
  formatMinor,
  splitMilestones,
  hidesNeeded,
  quarterMetres,
  sqCmToSqFt,
  sqFtWithMetres,
  formatAmount,
  type Currency,
} from '../src/server/domain/money.ts';
import {
  englishDateTimeAt,
  instantText,
  localTime,
  resolveWall,
  TOWN_ZONE,
  wallToInstant,
} from '../src/server/domain/time.ts';
import { isStampNumber } from '../src/server/domain/stamp.ts';
import { noteToHtml } from '../src/shared/noteMarkup.ts';
import { foldName } from '../src/server/domain/names.ts';
import { readSeatHeight } from '../src/server/domain/seatHeight.ts';
import {
  checkPlacement,
  checkRotation,
  hideFigure,
  HIDE_AREA_SQ_FT,
  PATTERN_AREA_SQ_FT,
  seededPlacements,
} from '../src/server/domain/layout.ts';
import { checkHeader, decodeUtf8, detectDelimiter, parseCsv, writeCsv } from '../src/server/domain/csv.ts';
import { formatDate } from '../src/shared/dates.ts';

let passed = 0;
const failed: string[] = [];

function check(label: string, got: unknown, want: unknown): void {
  const a = typeof got === 'object' ? JSON.stringify(got) : String(got);
  const b = typeof want === 'object' ? JSON.stringify(want) : String(want);
  if (a === b) {
    passed += 1;
    console.log(`ok   ${label}`);
  } else {
    failed.push(label);
    console.log(`FAIL ${label}\n       got  ${a}\n       want ${b}`);
  }
}

const D = (text: string) => parseDec(text)!;

// ------------------------------------------------------------------- money
const seeded: [string, Currency, number, string, string, string, string, string, string, string, string, string][] = [
  ['Lounge chair', 'EUR', 22, '48.25', '13.70', '14.54', '12.50', '85.00', '\u20ac661.03', '\u20ac1,062.50', '\u20ac379.18', '\u20ac2,102.71'],
  ['Tubular armchair', 'GBP', 20, '30.25', '5.30', '14.54', '10.00', '72.00', '\u00a3160.33', '\u00a3720.00', '\u00a3176.07', '\u00a31,056.40'],
  ['Cantilever side chair', 'USD', 0, '48.25', '12.15', '14.54', '8.00', '92.00', 'US$586.24', 'US$736.00', 'US$0.00', 'US$1,322.24'],
  ['Folding deck chair', 'JPY', 0, '52.75', '1990', '14.54', '6.00', '13800', '\u00a5104,973', '\u00a582,800', '\u00a50', '\u00a5187,773'],
  ['Swivel desk chair', 'AED', 0, '48.25', '66.90', '14.54', '5.00', '340.00', 'AED 3,227.93', 'AED 1,700.00', 'AED 0.00', 'AED 4,927.93'],
  ['Bentwood armchair', 'GBP', 20, '48.25', '13.20', '14.54', '9.00', '72.00', '\u00a3636.90', '\u00a3648.00', '\u00a3256.98', '\u00a31,541.88'],
];
for (const [name, currency, tax, average, price, area, hours, rate, material, labour, taxAmount, total] of seeded) {
  const e = computeEstimate({
    currency,
    taxPercent: tax,
    labourHours: D(hours),
    labourRate: D(rate),
    material: { pricePerUnit: D(price), unit: 'sqFt', lotAverageSqFt: D(average) },
    patternAreaSqFt: D(area),
  });
  check(`${name} material`, formatMinor(currency, e.materialMinor), material);
  check(`${name} labour`, formatMinor(currency, e.labourMinor), labour);
  check(`${name} tax`, formatMinor(currency, e.taxMinor), taxAmount);
  check(`${name} total`, formatMinor(currency, e.totalMinor), total);
}

check('milestones 2102.71', splitMilestones(210271n).map((m) => formatMinor('EUR', m)), ['\u20ac630.82', '\u20ac841.08', '\u20ac630.81']);
check('milestones 4250.55', splitMilestones(425055n).map((m) => formatMinor('EUR', m)), ['\u20ac1,275.17', '\u20ac1,700.22', '\u20ac1,275.16']);
check('milestones 333333', splitMilestones(333333n).map((m) => formatMinor('JPY', m)), ['\u00a5100,000', '\u00a5133,334', '\u00a599,999']);

check('hides 62.50 over 48.25', hidesNeeded(D('62.50'), D('48.25')), 2);
check('hides 125.00 over 48.25', hidesNeeded(D('125.00'), D('48.25')), 3);
check('quarter metres 7.30', toFixed(quarterMetres(D('7.30')), 2), '7.50');
check('quarter metres 7.50', toFixed(quarterMetres(D('7.50')), 2), '7.50');
check('quarter metres 7.51', toFixed(quarterMetres(D('7.51')), 2), '7.75');
check('48.25 sq ft at 13.70', formatAmount('EUR', D('661.025')), '\u20ac661.03');
check('30.25 sq ft at 6.10', formatAmount('EUR', D('184.525')), '\u20ac184.53');
check('52.75 sq ft at 1990', formatAmount('JPY', D('104972.5')), '\u00a5104,973');
const frameOnly = computeEstimate({ currency: 'EUR', taxPercent: 22, labourHours: D('2.75'), labourRate: D('85.00'), material: null });
check('frame-only labour', formatMinor('EUR', frameOnly.labourMinor), '\u20ac233.75');
check('frame-only tax', formatMinor('EUR', frameOnly.taxMinor), '\u20ac51.43');
check('areas in both units', sqFtWithMetres(D('48.25')), '48.25 sq ft (4.48 m\u00b2)');

// -------------------------------------------------------------------- hide
check('hide area', HIDE_AREA_SQ_FT, '51.67');
check('pattern area', PATTERN_AREA_SQ_FT, '14.54');
check('Seat only', hideFigure(seededPlacements()), { usedSqFt: '3.87', usedPercent: '7.5' });
check('all five', toFixed(sqCmToSqFt(13504), 2), '14.54');
check('all five percent', toFixed(divHalfUp(fromInt(13504 * 100), fromInt(48000), 1), 1), '28.1');
check('Seat turns only 0 or 180', checkRotation('Seat', 90), 'grainBound');
check('45 is out of range', checkRotation('Seat', 45), 'outOfRange');
check('Headrest turns 270', checkRotation('Headrest', 270), null);
const tray = seededPlacements().map((p) => ({ ...p, state: 'tray' as const, x: null, y: null }));
check('off the hide', checkPlacement('Seat', 139, 0, 0, tray), { kind: 'offHide' });
check('at the edge', checkPlacement('Seat', 138, 0, 0, tray), null);
check('a negative coordinate runs off the hide', checkPlacement('Seat', -1, 0, 0, tray), { kind: 'offHide' });
check('a part coordinate is out of range', checkPlacement('Seat', 1.5, 0, 0, tray), { kind: 'coordinate' });
check('crosses the flaw', checkPlacement('Seat', 100, 60, 0, tray), { kind: 'flaw', flaw: { x: 120, y: 80, width: 30, height: 20 } });
check('touching the flaw is allowed', checkPlacement('Headrest', 80, 80, 0, tray), null);
check('overlaps Seat', checkPlacement('Back', 0, 0, 0, seededPlacements()), { kind: 'overlap', other: 'Seat' });
check('touching Seat is allowed', checkPlacement('Back', 0, 58, 0, seededPlacements()), null);

// -------------------------------------------------------------------- time
const turin = TOWN_ZONE.Turin;
const glueA = wallToInstant(turin, { year: 2027, month: 3, day: 26, hour: 16, minute: 0, second: 0 })!;
check('glue over a 23-hour day', englishDateTimeAt(turin, glueA + 48 * 3600 * 1000, 'Turin'), 'Sun 28 Mar 2027, 17:00 Turin time');
const glueB = wallToInstant(turin, { year: 2027, month: 10, day: 29, hour: 16, minute: 0, second: 0 })!;
check('glue over a 25-hour day', englishDateTimeAt(turin, glueB + 48 * 3600 * 1000, 'Turin'), 'Sun 31 Oct 2027, 15:00 Turin time');
check('02:30 does not exist in Turin', resolveWall(turin, { year: 2027, month: 3, day: 28, hour: 2, minute: 30, second: 0 }).kind, 'absent');
check('02:30 does not exist in New York', resolveWall(TOWN_ZONE['New York'], { year: 2027, month: 3, day: 14, hour: 2, minute: 30, second: 0 }).kind, 'absent');
const repeated = resolveWall(turin, { year: 2027, month: 10, day: 31, hour: 2, minute: 30, second: 0 });
check('a repeated time is the first of the two', repeated.kind === 'repeated' ? instantText(repeated.ms) : '', '2027-10-31T00:30:00Z');

const collections: [number, number, number, string, string][] = [
  [2027, 3, 12, '2027-03-12T14:00:00Z', '15:00'],
  [2027, 3, 15, '2027-03-15T13:00:00Z', '14:00'],
  [2027, 3, 26, '2027-03-26T13:00:00Z', '14:00'],
  [2027, 3, 29, '2027-03-29T13:00:00Z', '15:00'],
  [2027, 11, 1, '2027-11-01T13:00:00Z', '14:00'],
  [2027, 11, 8, '2027-11-08T14:00:00Z', '15:00'],
];
for (const [year, month, day, instant, turinTime] of collections) {
  const ms = wallToInstant(TOWN_ZONE['New York'], { year, month, day, hour: 9, minute: 0, second: 0 })!;
  check(`09:00 New York on ${year}-${month}-${day}`, [instantText(ms), localTime(turin, ms)], [instant, turinTime]);
}
for (const [day, want] of [[26, '01:00'], [29, '02:00']] as [number, string][]) {
  const ms = wallToInstant(TOWN_ZONE.Kyoto, { year: 2027, month: 3, day, hour: 9, minute: 0, second: 0 })!;
  check(`09:00 Kyoto on 2027-03-${day}`, localTime(turin, ms), want);
}
for (const [day, want] of [[26, '06:00'], [29, '07:00']] as [number, string][]) {
  const ms = wallToInstant(TOWN_ZONE.Dubai, { year: 2027, month: 3, day, hour: 9, minute: 0, second: 0 })!;
  check(`09:00 Dubai on 2027-03-${day}`, localTime(turin, ms), want);
}

// ------------------------------------------------------- the smaller rules
check('48201768 checks out', isStampNumber('48201768'), true);
check('48201769 does not', isStampNumber('48201769'), false);
check('bold', noteToHtml('**Tear** along the front seam'), '<strong>Tear</strong> along the front seam');
check('italic', noteToHtml('*Stain* under the left arm'), '<em>Stain</em> under the left arm');
check('an http link', noteToHtml('[here](http://a.example/x)'), '<a href="http://a.example/x" rel="noreferrer noopener">here</a>');
check('any other address is plain text', noteToHtml('[x](javascript:alert(1))'), '[x](javascript:alert(1))');
check('HTML is plain text', noteToHtml('<script>bad()</script>'), '&lt;script&gt;bad()&lt;/script&gt;');
check('zoe orsted matches Zo\u00eb \u00d8rsted', foldName('zoe orsted') === foldName('Zo\u00eb \u00d8rsted'), true);
check('\u00df folds to ss', foldName('STRA\u00dfE'), 'strasse');
check('44.5 on the English page', readSeatHeight('44.5', 'en').kind, 'ok');
check('44,5 on the English page is refused', readSeatHeight('44,5', 'en').kind, 'refused');
check('44,5 on the Italian page', readSeatHeight('44,5', 'it').kind, 'ok');
check('44.5 on the Italian page is refused', readSeatHeight('44.5', 'it').kind, 'refused');
check('full-width digits on the Japanese page', readSeatHeight('\uff14\uff14\uff0e\uff15', 'ja').kind, 'ok');
check('Arabic-Indic digits on the Arabic page', readSeatHeight('\u0664\u0664\u066b\u0665', 'ar').kind, 'ok');
check('29.9 is out of range', readSeatHeight('29.9', 'en').kind, 'refused');
check('two decimals are refused', readSeatHeight('44.55', 'en').kind, 'refused');

const file = '\uFEFFclient;piece;maker;year;stamp;material;notes\r\n"Ricci;Co";"Chair\nTwo";M;1957;48201768;VM-2041;"note ""q"""\r\n';
const text = decodeUtf8(new TextEncoder().encode(file))!;
check('the header row decides the separator', detectDelimiter(text), ';');
const records = parseCsv(text, ';');
check('records, not lines', records.length, 2);
check('the header is known', checkHeader(records[0]!), null);
check('a quoted line break stays in the field', records[1]![1], 'Chair\nTwo');
check('an inner quote is doubled back', records[1]![6], 'note "q"');
check('a dangerous cell carries the apostrophe', writeCsv([['=SUM(1)', '-5', '@x', 'ok']]), '"\'=SUM(1)","\'-5","\'@x","ok"\r\n');

const march29 = { year: 2027, month: 3, day: 29, weekday: 1 };
check('English date', formatDate(march29, 'en'), 'Mon 29 Mar 2027');
check('Italian date', formatDate(march29, 'it'), 'lun 29 mar 2027');
check('Japanese date', formatDate(march29, 'ja'), '2027\u5e743\u670829\u65e5(\u6708)');
check('Arabic date', formatDate(march29, 'ar'), '\u0627\u0644\u0627\u062b\u0646\u064a\u0646 29 \u0645\u0627\u0631\u0633 2027');

console.log();
console.log(`${passed} passed, ${failed.length} failed`);
for (const name of failed) console.log(`  - ${name}`);
if (failed.length > 0) process.exit(1);
