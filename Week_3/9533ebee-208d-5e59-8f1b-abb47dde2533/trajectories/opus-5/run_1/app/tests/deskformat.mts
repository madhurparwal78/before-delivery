import * as F from '../src/domain/deskformat.ts';
import * as T from '../src/domain/desktime.ts';

const Z = 'America/St_Johns';
let fails = 0;
const chk = (label: string, got: string, want: string): void => {
  const ok = got === want;
  if (!ok) fails += 1;
  console.log(
    (ok ? 'PASS' : 'FAIL') +
      ' ' +
      label +
      ' ' +
      JSON.stringify(got) +
      (ok ? '' : ' want ' + JSON.stringify(want)),
  );
};
const NN = '\u202F';
const MI = '\u2212';

chk('amount 7877529600/6', F.formatAmount(7877529600n, 6), '7' + NN + '877,529600');
chk('amount 37038/8', F.formatAmount(37038n, 8), '0,00037038');
chk('amount negative', F.formatAmount(-37038000000n, 6), MI + '37' + NN + '038,000000');
chk('signed positive leg', F.formatSignedAmount(60000000000n, 6), '+60' + NN + '000,000000');
chk('price 5600000000000', F.formatPrice(5600000000000n), '$56' + NN + '000,00000000');
chk('price 54400000000000', F.formatPrice(5440000000000n), '$54' + NN + '400,00000000');
chk('pct 1005', F.formatPercent(1005n), '10,05%');
chk('pct plain 8000', F.formatPercentPlain(8000n), '80,00');
chk('hf', F.formatHealthFactor('1.1250'), '1,1250');
chk('hf null', F.formatHealthFactor(null), 'No debt');
chk('share price', F.formatSharePrice('1.000000000000'), '1,000000000000');
chk('shock -125', F.formatShock(-125), MI + '12,5');
chk('shock +50', F.formatShock(50), '+5,0');
chk('shock 0', F.formatShock(0), '0,0');
chk('dur 300', F.formatDuration(300), '5:00');
chk('dur 3600', F.formatDuration(3600), '60:00');
chk('dur 20', F.formatDuration(20), '0:20');
chk(
  'shares',
  F.formatShares(2000000000000n),
  '2' + NN + '000' + NN + '000' + NN + '000' + NN + '000',
);
chk('avail QUSD', F.formatAmount(1799000000000n, 6), '1' + NN + '799' + NN + '000,000000');
chk('exposed 2 MBTC', F.formatAmount(200000000n, 8), '2,00000000');
chk('four digit grouping', F.formatAmount(1000000000n, 6), '1' + NN + '000,000000');

const pr = (t: string): string => {
  const r = F.parsePriceInput(t);
  return r.ok ? r.value : 'ERR:' + r.problem;
};
chk('price in "56 000,5"', pr('56' + NN + '000,5'), '56000.5');
chk('price in "52 000"', pr('52' + NN + '000'), '52000');
chk('price in with $', pr('$56' + NN + '000,00000000'), '56000.00000000');

const am = (t: string, d: number): string => {
  const r = F.parseAmountInput(t, d);
  return r.ok ? r.value.toString() : 'ERR:' + r.problem;
};
chk('amt 0,12345678 MBTC', am('0,12345678', 8), '12345678');
chk('amt grouped', am('7' + NN + '877,5296', 6), '7877529600');
chk('amt bad grouping', am('78' + NN + '77,5', 6), 'ERR:shape');
chk('amt too many dec', am('1,1234567', 6), 'ERR:decimals');
chk('amt zero', am('0,000000', 6), 'ERR:zero');
chk('amt point', am('1.5', 6), 'ERR:shape');
chk('amt leading zero', am('01', 6), 'ERR:shape');
chk('amt ungrouped 1000', am('1000', 6), '1000000000');
chk('amt 18 dec', am('1,000000000000000000', 18), '1000000000000000000');

const dt = (t: string): string => {
  const r = T.parseDeskWallTime(t, Z);
  return r.ok ? T.formatCanonicalUtc(r.instantMs) : 'ERR:' + r.problem;
};
chk('fold 2026-11-01 01:30', dt('2026-11-01 01:30'), '2026-11-01T04:00:00Z');
chk('gap 2026-03-08 02:30', dt('2026-03-08 02:30'), 'ERR:gap');
chk('winter wall', dt('2026-01-15 08:30'), '2026-01-15T12:00:00Z');
chk('summer wall', dt('2026-07-15 09:30'), '2026-07-15T12:00:00Z');
chk('bad shape', dt('2026-13-01 01:30'), 'ERR:shape');
chk(
  'fmt winter',
  T.formatWallDateTime(Date.parse('2026-01-15T12:00:00Z'), Z),
  '2026-01-15 08:30:00 NST',
);
chk('fmt summer', T.formatWallTime(Date.parse('2026-07-15T12:00:00Z'), Z), '09:30:00 NDT');
chk(
  'canonical drops frac',
  T.formatCanonicalUtc(Date.parse('2026-11-01T04:00:00.789Z')),
  '2026-11-01T04:00:00Z',
);
chk(
  'rfc3339 offset',
  T.formatCanonicalUtc(T.parseRfc3339('2026-11-01T01:30:00-02:30') ?? 0),
  '2026-11-01T04:00:00Z',
);
chk('rfc3339 needs offset', String(T.parseRfc3339('2026-11-01T01:30:00')), 'null');

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILED');
