/**
 * Checks the domain engines against every worked example published in the
 * brief. Run with `npm run verify:domain`.
 */

import { formatAmount, formatLength, formatMass, tenthsMmToInchString, tenthsKgToPoundString } from '../../shared/format.js';
import { canonicalPlate } from './plates.js';
import { checkFit } from './fit.js';
import { allocateProportional, buildScheduleAmounts, extractVat, reverseVatForDraw } from './money.js';
import { allocateStages, respreadAmounts } from './schedule.js';
import { buildKitQuote, inspectionFeeOn, vatRateFor } from './quote.js';
import { withdrawalDeadlineDate, withdrawalDeadline } from './withdrawal.js';
import { isoWithAmsterdamOffset, monthlyDueDates } from './clock.js';
import { ROAD_CLASS_NAMES, revisionFor } from '../../shared/seed.js';
import type { ResolvedDonor, Stage } from '../../shared/types.js';

let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
  } else {
    console.log(`ok   ${label} = ${a}`);
  }
}

function donor(
  model: string,
  country: 'NL' | 'BE' | 'DE',
  year: number,
  roadClass: 25 | 45,
  massTenths: number,
  plate: string | null,
): ResolvedDonor {
  return {
    plate,
    country,
    model,
    modelName: model,
    firstAdmissionYear: year,
    roadClass,
    className: ROAD_CLASS_NAMES[country][roadClass],
    plateColour: 'white',
    registeredMassTenthsKg: massTenths,
    revision: revisionFor(model, year),
    confirmed: plate !== null,
  };
}

console.log('--- formatters ---');
check('3.0 mm in inches', tenthsMmToInchString(30), '0.118');
check('86.0 kg in pounds', tenthsKgToPoundString(860), '189.6');
check('length metric', formatLength(30, 'metric'), '3.0 mm');
check('length imperial', formatLength(30, 'imperial'), '0.118 in');
check('mass metric', formatMass(860, 'metric'), '86.0 kg');
check('amount', formatAmount(149500), '€1,495.00');
check('amount zero', formatAmount(0), '€0.00');

console.log('--- plates ---');
check('NL canonical', canonicalPlate('fgh 12 k', 'NL'), 'FGH-12-K');
check('BE canonical', canonicalPlate('aklm204', 'BE'), 'A-KLM-204');
check('DE canonical', canonicalPlate('418rtv', 'DE'), '418-RTV');
check('NL invalid', canonicalPlate('418-RTV', 'NL'), null);

console.log('--- fit: pack clearance stations by revision ---');
// P-2100 on plate FGH-12-K (K50, 2019, revision A): 3.0 mm at Footboard rib, passes.
const k50a = donor('K50', 'NL', 2019, 25, 1100, 'FGH-12-K');
const fitA = checkFit({ donor: k50a, packId: 'P-2100', hubId: 'H-1000', roadClass: 25, units: 'metric' });
check('K50 2019 revision', fitA.revision, 'A');
check('K50 2019 S2 gap', fitA.rails.pack.stations[1]?.gapMm, '3.0');
check('K50 2019 S2 name', fitA.rails.pack.stations[1]?.name, 'Footboard rib');
check('K50 2019 S2 passes', fitA.rails.pack.stations[1]?.passes, true);
check('K50 2019 verdict', fitA.verdict, 'fits');

// On plate DBR-45-T (K50, 2021, revision B) the gap there is 0.0 mm: too_tight.
const k50b = donor('K50', 'NL', 2021, 45, 1100, 'DBR-45-T');
const fitB = checkFit({ donor: k50b, packId: 'P-2100', hubId: 'H-1000', roadClass: 45, units: 'metric' });
check('K50 2021 revision', fitB.revision, 'B');
check('K50 2021 S2 gap', fitB.rails.pack.stations[1]?.gapMm, '0.0');
check('K50 2021 S2 passes (minimum)', fitB.rails.pack.stations[1]?.passes, false);
check('K50 2021 verdict', fitB.verdict, 'too_tight');
check('K50 2021 stop travel (part passes station)', fitB.rails.pack.stopTravelMm, '210.0');
check(
  'K50 2021 sentence',
  fitB.sentence,
  'Too tight. Gap 0.0 mm at Footboard rib; the minimum is 3.0 mm.',
);

console.log('--- fit: 418-RTV with P-1500 and H-1000 ---');
const r50 = donor('R50', 'DE', 2017, 25, 740, '418-RTV');
const fitR = checkFit({ donor: r50, packId: 'P-1500', hubId: 'H-1000', roadClass: 25, units: 'metric' });
check('R50 verdict', fitR.verdict, 'fits');
check('R50 built mass', fitR.builtMassKg, '72.0');
check('R50 range', fitR.rangeKm, 68);
check('R50 donor front share', fitR.axle.donorFrontPct, '43.4');
check('R50 built front share', fitR.axle.builtFrontPct, '51.0');
check('R50 axle shift', fitR.axle.shiftPct, '7.6');
check('R50 axle passes', fitR.axle.passes, true);
check('R50 S2 gap (192.9 tenths)', fitR.rails.pack.stations[1]?.gapMm, '22.9');
check('R50 hub H3 gap (106.9 − 96.0)', fitR.rails.hub.stations[2]?.gapMm, '10.9');
check('R50 sentence', fitR.sentence, 'Fits. Smallest gap 10.9 mm at Sprocket line.');

console.log('--- fit: unconfirmed donor ---');
const handEntered = donor('R50', 'DE', 2017, 25, 740, null);
const fitHand = checkFit({ donor: handEntered, packId: 'P-1500', hubId: 'H-1000', roadClass: 25, units: 'metric' });
check('hand-entered confirmed flag', fitHand.confirmed, false);
check('hand-entered sentence suffix', fitHand.sentence.endsWith(' Donor unconfirmed.'), true);

console.log('--- VAT: posted to DE ---');
const postedQuote = buildKitQuote({
  donor: r50,
  packId: 'P-1500',
  hubId: 'H-1000',
  roadClass: 25,
  fulfilment: 'posted',
  country: 'DE',
  amsterdamDate: '2026-12-01',
  fit: fitR,
});
check('posted total', postedQuote.totalCents, 149500);
check('posted VAT', postedQuote.vatCents, 23870);
check('posted line VATs', postedQuote.lines.map((l) => l.vatCents), [6690, 10203, 5572, 782, 623]);
check('posted line codes', postedQuote.lines.map((l) => l.code), ['H-1000', 'P-1500', 'CTRL', 'TANK-OUT', 'POST']);
check(
  'posted line names',
  postedQuote.lines.map((l) => l.name),
  ['Hub motor H-1000', 'Traction pack P-1500', 'Controller and harness', 'Fuel tank removal', 'Postage'],
);
check('posted rate', postedQuote.vatRatePct, 19);
check('posted notices', postedQuote.notices.length, 1);

console.log('--- VAT: fitted at the workshop ---');
const workshopQuote = buildKitQuote({
  donor: r50,
  packId: 'P-1500',
  hubId: 'H-1000',
  roadClass: 25,
  fulfilment: 'workshop',
  country: 'DE',
  amsterdamDate: '2026-12-01',
  fit: fitR,
});
check('workshop total', workshopQuote.totalCents, 174500);
check('workshop VAT', workshopQuote.vatCents, 30285);
check('workshop line VATs', workshopQuote.lines.map((l) => l.vatCents), [7272, 11090, 6057, 850, 5016]);
check('workshop rate (NL whatever the country)', vatRateFor('workshop', 'DE'), 21);

console.log('--- schedule ---');
const amounts = buildScheduleAmounts(149500);
check('schedule amounts', [amounts.deposit, amounts['instalment-1'], amounts['instalment-2'], amounts['instalment-3']], [29900, 39867, 39867, 39866]);
check(
  'schedule sums to total',
  amounts.deposit + amounts['instalment-1'] + amounts['instalment-2'] + amounts['instalment-3'],
  149500,
);

console.log('--- allocation ---');
const lineWeights = postedQuote.lines.map((l) => ({ lineId: l.id, weightCents: l.grossCents, ratePct: l.vatRatePct }));
check(
  'deposit allocation',
  allocateProportional(29900, lineWeights).map((s) => s.grossCents),
  [8380, 12780, 6980, 980, 780],
);
check(
  'instalment 1 allocation',
  allocateProportional(39867, lineWeights).map((s) => s.grossCents),
  [11173, 17040, 9307, 1307, 1040],
);
check(
  'deposit allocation VAT',
  allocateProportional(29900, lineWeights).map((s) => s.vatCents),
  [1338, 2041, 1114, 156, 125],
);
const quoteStages = postedQuote.schedule;
check(
  'every stage allocation sums to its amount',
  quoteStages.map((s) => s.allocations.reduce((t, a) => t + a.grossCents, 0) === s.amountCents),
  [true, true, true, true],
);
check(
  'line allocations sum to line gross',
  postedQuote.lines.map(
    (line) =>
      quoteStages.reduce(
        (t, s) => t + (s.allocations.find((a) => a.lineId === line.id)?.grossCents ?? 0),
        0,
      ) === line.grossCents,
  ),
  [true, true, true, true, true],
);
check(
  'line allocations sum to line VAT',
  postedQuote.lines.map(
    (line) =>
      quoteStages.reduce((t, s) => t + (s.allocations.find((a) => a.lineId === line.id)?.vatCents ?? 0), 0) ===
      line.vatCents,
  ),
  [true, true, true, true, true],
);

console.log('--- refund: 1000 cents on the pack line ---');
const depositAlloc = quoteStages[0] as Stage;
const packAlloc = depositAlloc.allocations[1];
check('pack deposit allocation gross', packAlloc?.grossCents, 12780);
check('pack deposit allocation VAT', packAlloc?.vatCents, 2041);
const reversed = reverseVatForDraw(1000, packAlloc?.grossCents ?? 0, packAlloc?.vatCents ?? 0, 19);
check('VAT reversed for the draw', reversed, 160);

const refundedLines = postedQuote.lines.map((line, index) =>
  index === 1
    ? { ...line, grossCents: line.grossCents - 1000, vatCents: line.vatCents - reversed }
    : { ...line },
);
check('pack line after refund', [refundedLines[1]?.grossCents, refundedLines[1]?.vatCents], [62900, 10043]);
check(
  'order after refund',
  [
    refundedLines.reduce((t, l) => t + l.grossCents, 0),
    refundedLines.reduce((t, l) => t + l.vatCents, 0),
  ],
  [148500, 23710],
);

const afterRefundAmounts = respreadAmounts(
  148500,
  [
    { stage: 'deposit', status: 'paid', amountCents: 29900 },
    { stage: 'instalment-1', status: 'scheduled', amountCents: 39867 },
    { stage: 'instalment-2', status: 'scheduled', amountCents: 39867 },
    { stage: 'instalment-3', status: 'scheduled', amountCents: 39866 },
  ],
  29900 - 1000,
);
check(
  'stages after refund re-spread',
  ['instalment-1', 'instalment-2', 'instalment-3'].map((s) => afterRefundAmounts.get(s as never)),
  [39867, 39867, 39866],
);

const afterRefundStages = allocateStages(
  refundedLines.map((l) => ({ id: l.id, grossCents: l.grossCents, vatCents: l.vatCents, ratePct: l.vatRatePct })),
  [
    {
      stage: 'deposit',
      amountCents: 29900,
      status: 'paid',
      dueDate: null,
      attempts: 0,
      confirmedAt: null,
      vatCorrectedCents: 0,
      locked: depositAlloc.allocations,
      returnedByLine: new Map([['P-1500', { grossCents: 1000, vatCents: reversed }]]),
    },
    ...(['instalment-1', 'instalment-2', 'instalment-3'] as const).map((stage) => ({
      stage,
      amountCents: afterRefundAmounts.get(stage) as number,
      status: 'scheduled' as const,
      dueDate: null,
      attempts: 0,
      confirmedAt: null,
      vatCorrectedCents: 0,
      locked: null,
      returnedByLine: new Map<string, { grossCents: number; vatCents: number }>(),
    })),
  ],
);
check(
  'instalment 1 re-allocated after refund',
  afterRefundStages[1]?.allocations.map((a) => a.grossCents),
  [11249, 16886, 9369, 1316, 1047],
);
check(
  'line allocations less returned draws sum to line gross',
  refundedLines.map(
    (line) =>
      afterRefundStages.reduce(
        (t, s) => t + (s.allocations.find((a) => a.lineId === line.id)?.grossCents ?? 0),
        0,
      ) -
        (line.id === 'P-1500' ? 1000 : 0) ===
      line.grossCents,
  ),
  [true, true, true, true, true],
);

console.log('--- switch to workshop fitting ---');
const switchedLines = workshopQuote.lines;
check('switched total', switchedLines.reduce((t, l) => t + l.grossCents, 0), 174500);
check('switched VAT', switchedLines.reduce((t, l) => t + l.vatCents, 0), 30285);
const correctedDepositVat = depositAlloc.allocations.map((a) => extractVat(a.grossCents, 21));
check('deposit allocation VAT at the new rate', correctedDepositVat, [1454, 2218, 1211, 170, 135]);
check(
  'VAT correction',
  correctedDepositVat.reduce((t, v) => t + v, 0) - depositAlloc.allocations.reduce((t, a) => t + a.vatCents, 0),
  414,
);
const switchedAmounts = respreadAmounts(
  174500,
  [
    { stage: 'deposit', status: 'paid', amountCents: 29900 },
    { stage: 'instalment-1', status: 'scheduled', amountCents: 39867 },
    { stage: 'instalment-2', status: 'scheduled', amountCents: 39867 },
    { stage: 'instalment-3', status: 'scheduled', amountCents: 39866 },
  ],
  29900,
);
check(
  'unpaid stages after the switch',
  ['instalment-1', 'instalment-2', 'instalment-3'].map((s) => switchedAmounts.get(s as never)),
  [48200, 48200, 48200],
);
check(
  'instalment 1 allocation after the switch',
  allocateProportional(
    48200,
    switchedLines.map((l) => ({ lineId: l.id, weightCents: l.grossCents, ratePct: l.vatRatePct })),
  ).map((s) => s.grossCents),
  [11574, 17650, 9640, 1353, 7983],
);

console.log('--- dated inspection fee ---');
check('NL fee in 2026', inspectionFeeOn('NL', '2026-12-31').grossCents, 13100);
check('NL fee in 2027', inspectionFeeOn('NL', '2027-01-01').grossCents, 13600);
check('BE fee in 2026', inspectionFeeOn('BE', '2026-12-31').grossCents, 9500);
check('BE fee in 2027', inspectionFeeOn('BE', '2027-01-01').grossCents, 9800);
check('DE fee in 2027', inspectionFeeOn('DE', '2027-06-01').grossCents, 8900);

console.log('--- class move adds a VAT-free fee and its notices ---');
const moveQuote = buildKitQuote({
  donor: r50,
  packId: 'P-1500',
  hubId: 'H-2400',
  roadClass: 45,
  fulfilment: 'posted',
  country: 'DE',
  amsterdamDate: '2026-12-01',
  fit: checkFit({ donor: r50, packId: 'P-1500', hubId: 'H-2400', roadClass: 45, units: 'metric' }),
});
check('class move fee line', moveQuote.lines[5]?.code, 'INSPECT-DE');
check('class move fee is VAT free', [moveQuote.lines[5]?.vatRatePct, moveQuote.lines[5]?.vatCents], [0, 0]);
check('class move fee name', moveQuote.lines[5]?.name, 'Inspection fee');
check('class move notices', moveQuote.notices.length, 4);
check(
  'class move notices text',
  moveQuote.notices.slice(1),
  [
    'Plate: a new plate is needed for the new class.',
    'Helmet: a helmet is required in the 45 km/h class.',
    'Licence: check the licence your class requires before riding.',
  ],
);

console.log('--- verdict order puts a rail before a limit ---');
// R50's sprocket line is 106.9 and the H-2400 shaft is 104.0, so the gap is
// 2.9 mm: `too_tight` outranks the broken class-power limit.
const tightBeforeLimit = checkFit({ donor: r50, packId: 'P-1500', hubId: 'H-2400', roadClass: 25, units: 'metric' });
check('too tight outranks outside limits', tightBeforeLimit.verdict, 'too_tight');
check(
  'too tight sentence',
  tightBeforeLimit.sentence,
  'Too tight. Gap 2.9 mm at Sprocket line; the minimum is 3.0 mm.',
);
check('the class-power limit still reports its own failure', tightBeforeLimit.limits[1]?.passes, false);
// The H-3600 shaft is 112.0, past R50's sprocket line, so the hub fouls.
const foulsBeforeLimit = checkFit({ donor: r50, packId: 'P-1500', hubId: 'H-3600', roadClass: 45, units: 'metric' });
check('fouls outranks outside limits', foulsBeforeLimit.verdict, 'fouls');
check('fouls sentence', foulsBeforeLimit.sentence, 'Fouls. Hub motor stops at 45.0 mm on Swingarm arm.');

console.log('--- road class and donor power limits ---');
const d50 = donor('D50', 'NL', 2020, 25, 900, 'GHJ-77-M');
const overClass = checkFit({ donor: d50, packId: 'P-1500', hubId: 'H-3600', roadClass: 25, units: 'metric' });
check('H-3600 in the 25 class', overClass.verdict, 'outside_limits');
check('H-3600 over the class limit', overClass.limits[1]?.passes, false);
check(
  'H-3600 class sentence',
  overClass.limits[1]?.sentence,
  'Hub power 3.6 kW is over the snorfiets limit of 1.0 kW.',
);
check('H-3600 is within 120 percent of the D50', overClass.limits[2]?.passes, true);
// The D50's short wheelbase moves the axle split past the limit, and
// `axle_split` comes before `road_class_power` in the rule order.
check('the axle limit is named first', overClass.sentence, 'Outside limits. Axle split moves 10.1 points; the limit is 10.0.');

console.log('--- axle split is compared exactly, not on the rounded display ---');
// The D50's front share is exactly 40.0 percent; with P-1500 and H-3600 the
// built share is 50.093…, so the shift of 10.093… fails although it displays
// as 10.1. A heavier hub at the rear axle pulls the share back.
check('D50 donor front share', overClass.axle.donorFrontPct, '40.0');
check('D50 built front share', overClass.axle.builtFrontPct, '50.1');
check('D50 axle shift fails', [overClass.axle.shiftPct, overClass.axle.passes], ['10.1', false]);
check('R50 axle shift passes', [fitR.axle.shiftPct, fitR.axle.passes], ['7.6', true]);
// K50 is 3.0 kW, so 120 percent is 3.6 kW and the 4.2 kW hub is over it.
const overDonor = checkFit({ donor: k50a, packId: 'P-1500', hubId: 'H-4200', roadClass: 45, units: 'metric' });
check('H-4200 over 120 percent of the K50', overDonor.limits[2]?.passes, false);
check(
  'donor power sentence',
  overDonor.limits[2]?.sentence,
  "Hub power 4.2 kW is over 120 percent of the donor's 3.0 kW.",
);
const exactly120 = checkFit({ donor: r50, packId: 'P-1500', hubId: 'H-2400', roadClass: 45, units: 'metric' });
check('H-2400 is exactly 120 percent of the R50 and passes', exactly120.limits[2]?.passes, true);
check(
  'H-1000 is exactly the 25 class limit and passes',
  checkFit({ donor: r50, packId: 'P-1500', hubId: 'H-1000', roadClass: 25, units: 'metric' }).limits[1]?.passes,
  true,
);

console.log('--- dimensions and mass ---');
const grows = checkFit({ donor: r50, packId: 'P-1800', hubId: 'H-1000', roadClass: 25, units: 'metric' });
check('P-1800 grows the length', grows.verdict, 'outside_limits');
check('P-1800 sentence', grows.sentence, 'Outside limits. The kit grows the overall length by 6.0 mm.');
const heavy = donor('K50', 'NL', 2019, 25, 700, 'FGH-12-K');
const overMass = checkFit({ donor: heavy, packId: 'P-1100', hubId: 'H-1000', roadClass: 25, units: 'metric' });
check('built mass over the registered mass', overMass.verdict, 'outside_limits');
check('over mass sentence', overMass.sentence, 'Outside limits. Built mass 81.5 kg is over the registered 70.0 kg.');
const exactMass = donor('K50', 'NL', 2019, 25, 815, 'FGH-12-K');
check(
  'equal to the registered mass passes',
  checkFit({ donor: exactMass, packId: 'P-1100', hubId: 'H-1000', roadClass: 25, units: 'metric' }).limits[3]?.passes,
  true,
);

console.log('--- withdrawal deadlines ---');
check('NL delivered 2026-12-07', withdrawalDeadlineDate('2026-12-07', 'NL'), '2026-12-21');
check('NL delivered 2026-12-11', withdrawalDeadlineDate('2026-12-11', 'NL'), '2026-12-28');
check('DE delivered 2027-03-12', withdrawalDeadlineDate('2027-03-12', 'DE'), '2027-03-30');
check('NL delivered 2027-03-12', withdrawalDeadlineDate('2027-03-12', 'NL'), '2027-03-26');
check(
  'NL deadline instant 2026-12-07',
  isoWithAmsterdamOffset(withdrawalDeadline('2026-12-07', 'NL') as Date),
  '2026-12-21T23:59:00+01:00',
);
check(
  'NL deadline instant 2026-12-11',
  isoWithAmsterdamOffset(withdrawalDeadline('2026-12-11', 'NL') as Date),
  '2026-12-28T23:59:00+01:00',
);
check(
  'DE deadline instant 2027-03-12',
  isoWithAmsterdamOffset(withdrawalDeadline('2027-03-12', 'DE') as Date),
  '2027-03-30T23:59:00+02:00',
);
check(
  'NL deadline instant 2027-03-12',
  isoWithAmsterdamOffset(withdrawalDeadline('2027-03-12', 'NL') as Date),
  '2027-03-26T23:59:00+01:00',
);

console.log('--- monthly due dates ---');
check('anchored on the 31st', monthlyDueDates('2027-01-31', 3), ['2027-02-28', '2027-03-31', '2027-04-30']);
check('anchored on the 7th', monthlyDueDates('2026-12-07', 3), ['2027-01-07', '2027-02-07', '2027-03-07']);
check('across a year end', monthlyDueDates('2026-11-30', 3), ['2026-12-30', '2027-01-30', '2027-02-28']);

console.log('--- range ---');
check(
  'P-1500 in the 45 class',
  checkFit({ donor: donor('K50', 'NL', 2019, 45, 1100, 'DBR-45-T'), packId: 'P-1500', hubId: 'H-2400', roadClass: 45, units: 'metric' }).rangeKm,
  48,
);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILED`);
  process.exit(1);
}
