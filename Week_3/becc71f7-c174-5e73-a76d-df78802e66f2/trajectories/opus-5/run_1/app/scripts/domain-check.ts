/** Every worked example the brief publishes for the domain rules. */
import {
  addDays,
  brusselsInstant,
  formatDateOnly,
  formatDateTime,
  formatMonth,
  formatSheetDateTime,
  formatTime,
  isoSeconds,
  mondayOf,
  startOfBrusselsDay,
} from '../src/shared/brussels.js';
import { formatIban, formatMoney, parseEuros } from '../src/shared/money.js';
import { parseTagCode, tagCodeForSerial } from '../src/server/domain/tagCode.js';
import { isValidIban, normaliseIban } from '../src/server/domain/iban.js';
import { sepaName } from '../src/server/domain/sepaName.js';
import {
  choiceWindow,
  markdownPriceCents,
  previousPriceCents,
  stationInstant,
  stationsOf,
  type Ladder,
} from '../src/server/domain/ladder.js';
import { refundableUntil, splitSale } from '../src/server/domain/sale.js';
import { renderSalesBook } from '../src/server/domain/salesBook.js';
import { renderBankFile } from '../src/server/domain/pain001.js';
import { isBookableSlot, slotsOnDate } from '../src/server/domain/slots.js';
import { normalisedName } from '../src/server/domain/importSheet.js';

let passed = 0;
let failed = 0;
const eq = (label: string, got: unknown, want: unknown): void => {
  if (got === want) passed += 1;
  else {
    failed += 1;
    console.log(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
};

// ── Tag codes ─────────────────────────────────────────────────────────────────
const SEEDED_TAGS = [
  'HG-1000042-0',
  'HG-1000043-8',
  'HG-1000044-6',
  'HG-1000045-3',
  'HG-1000046-1',
  'HG-1000047-9',
  'HG-1000048-7',
  'HG-1000049-5',
  'HG-1000050-3',
  'HG-1000051-1',
  'HG-1000052-9',
  'HG-1000053-7',
];
SEEDED_TAGS.forEach((tagCode, index) => {
  eq(`tag code for ${1000042 + index}`, tagCodeForSerial(1000042 + index), tagCode);
});
eq('HG-1000042-0 is valid', parseTagCode('HG-1000042-0')?.tagCode, 'HG-1000042-0');
eq('HG-1000042-1 is not', parseTagCode('HG-1000042-1'), null);
eq('lookup ignores case and dashes', parseTagCode('hg10000420')?.tagCode, 'HG-1000042-0');

// ── IBANs ─────────────────────────────────────────────────────────────────────
eq('BE68 5390 0754 7034 is valid', isValidIban('BE68 5390 0754 7034'), true);
eq('BE68 5390 0754 7035 is not', isValidIban('BE68 5390 0754 7035'), false);
eq('lower case and spaces are accepted', isValidIban('be35 3101 2345 6737'), true);
eq('stored without spaces in upper case', normaliseIban('be35 3101 2345 6737'), 'BE35310123456737');
eq('shown in groups of four', formatIban('BE68539007547034'), 'BE68 5390 0754 7034');
eq('no IBAN counts as no valid IBAN', isValidIban(null), false);

// ── The SEPA name rule ────────────────────────────────────────────────────────
eq('Zoë & Łukasz Ørsted-Hæk', sepaName('Zo\u00eb & \u0141ukasz \u00d8rsted-H\u00e6k'), 'Zoe Lukasz Orsted-Haek');
eq('Ségolène D’Hondt', sepaName('S\u00e9gol\u00e8ne D\u2019Hondt'), 'Segolene D Hondt');
eq('ß becomes ss', sepaName('Gro\u00df'), 'Gross');
eq('Œ becomes OE', sepaName('\u0152uvre'), 'OEuvre');
eq('Þ becomes TH', sepaName('\u00deorsten'), 'THorsten');
eq('Đ becomes D', sepaName('\u0110uro'), 'Duro');
eq('at most 70 characters', sepaName('a'.repeat(90)).length, 70);

// ── Markdown prices, rounded half up ──────────────────────────────────────────
eq('EUR 49.90 at 25% off', markdownPriceCents(4990, 25), 3743);
eq('EUR 19.90 at 25% off', markdownPriceCents(1990, 25), 1493);
eq('EUR 120.00 at 50% off', markdownPriceCents(12000, 50), 6000);
eq('EUR 89.00 at 25% off', markdownPriceCents(8900, 25), 6675);
eq('EUR 39.00 at 50% off', markdownPriceCents(3900, 50), 1950);
eq('EUR 29.90 at 25% off', markdownPriceCents(2990, 25), 2243);

// ── Brussels days ─────────────────────────────────────────────────────────────
const seeded: Ladder = {
  id: 'seeded',
  effectiveOn: '2024-01-01',
  firstMarkdownPercent: 25,
  firstMarkdownDay: 30,
  secondMarkdownPercent: 50,
  secondMarkdownDay: 60,
  periodEndDay: 90,
};
eq(
  'taken in on 26 Feb 2027 reaches 25% off',
  isoSeconds(stationInstant('off_25', seeded, '2027-02-26')),
  '2027-03-27T23:00:00Z',
);
eq(
  'taken in on 27 Feb 2026 reaches 25% off',
  isoSeconds(stationInstant('off_25', seeded, '2026-02-27')),
  '2026-03-28T23:00:00Z',
);
eq(
  'taken in on 27 Feb 2026 reaches 50% off',
  isoSeconds(stationInstant('off_50', seeded, '2026-02-27')),
  '2026-04-27T22:00:00Z',
);
eq(
  'taken in on 27 Feb 2026 ends its period',
  isoSeconds(stationInstant('period_ends', seeded, '2026-02-27')),
  '2026-05-27T22:00:00Z',
);
eq(
  '28 Mar 2027 lasts 23 hours',
  (startOfBrusselsDay('2027-03-29') - startOfBrusselsDay('2027-03-28')) / 3_600_000,
  23,
);
eq(
  '31 Oct 2027 lasts 25 hours',
  (startOfBrusselsDay('2027-11-01') - startOfBrusselsDay('2027-10-31')) / 3_600_000,
  25,
);

// ── Stations ──────────────────────────────────────────────────────────────────
const context = {
  ladder: seeded,
  intakeDate: '2027-02-26',
  askingHistory: [{ askingPriceCents: 4990, effectiveFrom: startOfBrusselsDay('2027-02-26') }],
};
const atThirtyFive = startOfBrusselsDay(addDays('2027-02-26', 35));
const stations = stationsOf(context, atThirtyFive);
eq('four stations', stations.length, 4);
eq('station values', stations.map((s) => s.station).join(','), 'full_price,off_25,off_50,period_ends');
eq('station labels', stations.map((s) => s.label).join(','), 'Full price,25% off,50% off,Period ends');
eq('station states', stations.map((s) => s.state).join(','), 'done,current,next,next');
eq('station prices', stations.map((s) => s.priceCents).join(','), '4990,3743,2495,2495');
eq(
  'the previous price is the one before the markdown step',
  previousPriceCents(context, atThirtyFive),
  4990,
);
eq(
  'a piece that has never changed price has no previous price',
  previousPriceCents(context, startOfBrusselsDay('2027-02-26')),
  null,
);
eq(
  'the choice opens on day 76',
  isoSeconds(choiceWindow(seeded, '2027-02-26').opensAt),
  isoSeconds(startOfBrusselsDay(addDays('2027-02-26', 76))),
);

// ── Shares, commission and VAT ────────────────────────────────────────────────
const big = splitSale(31245);
eq('70% of EUR 312.45', big.consignorShareCents, 21872);
eq('its commission', big.commissionCents, 9373);
eq('the VAT inside it', big.vatCents, 1627);
const small = splitSale(2243);
eq('60% of EUR 22.43', small.consignorShareCents, 1346);
eq('its VAT', small.vatCents, 156);
const mid = splitSale(5500);
eq('60% of EUR 55.00', mid.consignorShareCents, 3300);
eq('its VAT', mid.vatCents, 382);
eq('EUR 300.00 still takes 60%', splitSale(30000).consignorShareCents, 18000);
eq('EUR 300.01 takes 70%', splitSale(30001).consignorShareCents, 21001);

// ── The refund window ─────────────────────────────────────────────────────────
eq(
  'a sale on 14 Mar 2027 is refundable until',
  isoSeconds(refundableUntil(brusselsInstant('2027-03-14', 14, 5))),
  '2027-03-28T21:59:59Z',
);

// ── Slots ─────────────────────────────────────────────────────────────────────
eq('a Saturday has 24 slots', slotsOnDate('2027-03-27').length, 24);
eq('a Monday has none', slotsOnDate('2027-03-29').length, 0);
eq('a Sunday has none', slotsOnDate('2027-03-28').length, 0);
eq(
  'Sat 27 Mar 2027 10:00 is 09:00Z',
  isoSeconds(slotsOnDate('2027-03-27')[0] as number),
  '2027-03-27T09:00:00Z',
);
eq(
  'Tue 30 Mar 2027 10:00 is 08:00Z',
  isoSeconds(slotsOnDate('2027-03-30')[0] as number),
  '2027-03-30T08:00:00Z',
);
eq(
  'the last slot starts at 17:40',
  formatTime(slotsOnDate('2027-03-30').at(-1) as number),
  '17:40',
);
const now = Date.now();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(now);
eq(
  'a slot today is not bookable',
  slotsOnDate(today).some((slot) => isBookableSlot(slot, now)),
  false,
);
eq(
  'a slot 400 days ahead is outside the range',
  slotsOnDate(addDays(today, 400)).some((slot) => isBookableSlot(slot, now)),
  false,
);
eq('the Monday of a week', mondayOf('2027-04-01'), '2027-03-29');

// ── Display formats ───────────────────────────────────────────────────────────
eq('a date', formatDateOnly('2027-03-30'), 'Tue 30 Mar 2027');
eq('a date-time', formatDateTime(Date.parse('2027-03-30T08:20:00Z')), 'Tue 30 Mar 2027, 10:20');
eq('a time alone', formatTime(Date.parse('2027-03-30T12:30:00Z')), '14:30');
eq('a month', formatMonth('2027-03'), 'March 2027');
eq('money', formatMoney(123450), '€1,234.50');
eq('a small amount', formatMoney(3743), '€37.43');
eq('euros typed in a form', parseEuros('49.90'), 4990);
eq('euros with a comma', parseEuros('49,90'), 4990);
eq('whole euros', parseEuros('49'), 4900);
eq('not euros', parseEuros('49.900'), null);
eq(
  "the sales book's sale date-time",
  formatSheetDateTime(brusselsInstant('2027-03-14', 14, 5)),
  '2027-03-14 14:05',
);

// ── The sales book file ───────────────────────────────────────────────────────
const book = renderSalesBook([
  {
    soldAt: brusselsInstant('2027-03-14', 14, 5),
    tagCode: 'HG-1000045-3',
    description: '=SUM(A1) bag',
    priceCents: 31245,
    consignorShareCents: 21872,
    commissionCents: 9373,
    vatCents: 1627,
  },
  {
    soldAt: brusselsInstant('2027-03-15', 11, 30),
    tagCode: 'HG-1000050-3',
    description: 'Poplin "white" shirt',
    priceCents: 2243,
    consignorShareCents: 1346,
    commissionCents: 897,
    vatCents: 156,
  },
]);
const bookLines = book.split('\r\n');
eq(
  'the header line',
  bookLines[0],
  '"Sale date","Tag code","Description","Sale price","Consignor share","Commission","VAT"',
);
eq(
  'a line',
  bookLines[1],
  '"2027-03-14 14:05","HG-1000045-3","\'=SUM(A1) bag","312.45","218.72","93.73","16.27"',
);
eq('a doubled quote', bookLines[2]?.includes('"Poplin ""white"" shirt"'), true);
eq('the totals row', bookLines[3], '"Total","","","334.88","232.18","102.70","17.83"');
eq('every line ends with CRLF', book.endsWith('\r\n'), true);

// ── The bank transfer file ────────────────────────────────────────────────────
const xml = renderBankFile({
  month: '2027-03',
  msgId: 'PAYOUT-2027-03',
  createdAt: Date.parse('2027-04-01T07:00:00Z'),
  executionDate: '2027-04-01',
  debtorName: 'Atelier Ourlet SRL',
  debtorIban: 'BE68539007547034',
  transfers: [
    {
      payoutId: 'PO-2027-03-001',
      creditorName: 'Zoe Orsted-Haek',
      iban: 'BE21001234567803',
      amountCents: 21872,
    },
  ],
});
for (const fragment of [
  '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">',
  '<MsgId>PAYOUT-2027-03</MsgId>',
  '<CreDtTm>2027-04-01T07:00:00Z</CreDtTm>',
  '<NbOfTxs>1</NbOfTxs>',
  '<CtrlSum>218.72</CtrlSum>',
  '<InitgPty>',
  '<PmtInfId>PAYOUT-2027-03</PmtInfId>',
  '<PmtMtd>TRF</PmtMtd>',
  '<Cd>SEPA</Cd>',
  '<ReqdExctnDt>2027-04-01</ReqdExctnDt>',
  '<IBAN>BE68539007547034</IBAN>',
  '<Id>NOTPROVIDED</Id>',
  '<ChrgBr>SLEV</ChrgBr>',
  '<EndToEndId>PO-2027-03-001</EndToEndId>',
  '<InstdAmt Ccy="EUR">218.72</InstdAmt>',
  '<Nm>Zoe Orsted-Haek</Nm>',
  '<IBAN>BE21001234567803</IBAN>',
  '<Ustrd>Consignment payout March 2027</Ustrd>',
]) {
  eq(`the bank file carries ${fragment}`, xml.includes(fragment), true);
}

// ── Spreadsheet name matching ─────────────────────────────────────────────────
eq('names normalise', normalisedName('Zo\u00eb \u00d8rsted-H\u00e6k'), 'zoe ørsted hæk');
eq('runs of other characters become one space', normalisedName('noa   vermeulen'), 'noa vermeulen');
eq('case and accents go', normalisedName('S\u00c9GOL\u00c8NE D\u2019HONDT'), 'segolene d hondt');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
export {};
