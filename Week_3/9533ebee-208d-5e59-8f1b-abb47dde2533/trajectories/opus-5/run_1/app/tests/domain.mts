import {
  poolFigures,
  sharePriceScaled,
  sharesToMint,
  sharesToBurn,
} from '../src/domain/pool.ts';
import {
  borrowRateBps,
  supplyRateBps,
  indexForward,
  debtAtIndex,
} from '../src/domain/interest.ts';
import {
  healthFactorScaled,
  liquidationPrice,
  maxRepay,
  seizedForRepay,
  bonusPortion,
  coverFromCollateral,
  evaluatePosition,
  passesLoanToValue,
} from '../src/domain/position.ts';
import { quoteFigures } from '../src/domain/quote.ts';
import { splitWithReserve } from '../src/domain/money.ts';
import { shockedPrice, isAtRisk } from '../src/domain/shock.ts';
import {
  convertToPriceUnits,
  parseOracleBody,
  isLargeMove,
  decideOracleReading,
} from '../src/domain/oracle.ts';

let fails = 0;
const chk = (label: string, got: unknown, want: unknown): void => {
  const g = String(got);
  const w = String(want);
  const ok = g === w;
  if (!ok) fails += 1;
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + label + ' = ' + g + (ok ? '' : '  want ' + w));
};

// ---- Pool figures, QUSD at seed ----
const qusd = poolFigures({
  supply: 2000000000000n,
  reserve: 0n,
  swap: 0n,
  loanTotal: -201000000000n,
});
chk('QUSD available', qusd.availableLiquidity, 1799000000000n);
chk('QUSD borrowed', qusd.totalBorrowed, 201000000000n);
chk('QUSD utilization bps', qusd.utilizationBps, 1005n);
chk('QUSD share price', sharePriceScaled(2000000000000n, 2000000000000n), 10n ** 12n);
chk('mint with no shares', sharesToMint(500n, 0n, 0n), 500n);
chk('burn ceil', sharesToBurn(10n, 1000n, 300n), 3n);

// ---- Rates ----
const qusdCurve = { baseBps: 0n, slope1Bps: 400n, kinkBps: 9000n, slope2Bps: 6000n };
const br = borrowRateBps(1005n, qusdCurve);
chk('QUSD borrow rate bps', br, 44n);
chk('QUSD supply rate bps', supplyRateBps(br, 1005n, 1000n), 3n);
chk(
  'rate above kink',
  borrowRateBps(9500n, { baseBps: 0n, slope1Bps: 400n, kinkBps: 4500n, slope2Bps: 30000n }),
  400n + (30000n * 5000n) / 5500n,
);
chk('index idle', indexForward(10n ** 27n, 44n, 0n), 10n ** 27n);
chk('debt ceil at index', debtAtIndex(100n, 10n ** 27n, 10n ** 27n + 1n), 101n);

// ---- Health factors and liquidation prices, every seed position ----
const S6 = 10n ** 6n,
  S8 = 10n ** 8n,
  S18 = 10n ** 18n;
const PQ = 100000000n,
  PM = 6400000000000n,
  PE = 320000000000n;
const mbtcPos = (c: bigint, d: bigint) => ({
  collateral: c,
  debt: d,
  collateralPrice: PM,
  debtPrice: PQ,
  collateralScale: S8,
  debtScale: S6,
});
const seeds: Array<[string, bigint, bigint, bigint, bigint]> = [
  ['pos-0001', 200000000n, 60000000000n, 16000n, 4000000000000n],
  ['pos-0002', 150000000n, 64000000000n, 11250n, 5688888888889n],
  ['pos-0003', 100000000n, 40000000000n, 12000n, 5333333333334n],
  ['pos-0004', 50000000n, 21000000000n, 11428n, 5600000000000n],
];
for (const [id, c, d, hf, lp] of seeds) {
  chk(id + ' hf', healthFactorScaled(mbtcPos(c, d), 7500n), hf);
  chk(id + ' liq price', liquidationPrice(mbtcPos(c, d), 7500n), lp);
}
const p5 = {
  collateral: 10n ** 19n,
  debt: 16000000000n,
  collateralPrice: PE,
  debtPrice: PQ,
  collateralScale: S18,
  debtScale: S6,
};
chk('pos-0005 hf', healthFactorScaled(p5, 8000n), 16000n);
chk('pos-0005 liq price', liquidationPrice(p5, 8000n), 200000000000n);
chk('no debt hf', healthFactorScaled(mbtcPos(100n, 0n), 7500n), 'null');

// ---- Swap example: 12345678 MBTC -> QUSD ----
const q = quoteFigures({
  amountIn: 12345678n,
  swapFeeBps: 30n,
  priceFrom: PM,
  priceTo: PQ,
  scaleFrom: S8,
  scaleTo: S6,
  reserveFactorBps: 1000n,
});
chk('swap fee', q.fee, 37038n);
chk('swap amount_out', q.amountOut, 7877529600n);
chk('fee_to_reserve', q.split.toReserve, 3704n);
chk('fee_to_supply', q.split.toSupply, 33334n);
chk('split sums', q.split.toReserve + q.split.toSupply, 37038n);
const tie = splitWithReserve(1n, 5000n);
chk('split tie goes to supply', tie.toSupply + '/' + tie.toReserve, '1/0');
const sp = splitWithReserve(37038n, 1000n);
chk('split 37038 at 10%', sp.toSupply + '/' + sp.toReserve, '33334/3704');

// ---- Shock ruler, MBTC at seed ----
chk('shock -15 price', shockedPrice(PM, -150), 5440000000000n);
chk('shock -12.5 price', shockedPrice(PM, -125), 5600000000000n);
const liqPrices: Array<[string, bigint]> = [
  ['pos-0001', 4000000000000n],
  ['pos-0002', 5688888888889n],
  ['pos-0003', 5333333333334n],
  ['pos-0004', 5600000000000n],
];
const atRisk15 = liqPrices
  .filter(([, lp]) => isAtRisk(shockedPrice(PM, -150), lp))
  .map(([id]) => id);
chk('at risk at -15%', atRisk15.join(','), 'pos-0002,pos-0004');
const atRisk125 = liqPrices
  .filter(([, lp]) => isAtRisk(shockedPrice(PM, -125), lp))
  .map(([id]) => id);
chk('at risk at -12.5% (pos-0004 equal => clear)', atRisk125.join(','), 'pos-0002');

// ---- Posting MBTC at 52 000 => 3 positions below one ----
const at52 = liqPrices.filter(([, lp]) => 5200000000000n < lp).map(([id]) => id);
chk('below one at 52000', at52.join(','), 'pos-0002,pos-0003,pos-0004');

// ---- Liquidation fill math ----
const v = mbtcPos(150000000n, 64000000000n);
const cover = coverFromCollateral(v, 500n);
chk('cover is large vs close factor', cover > (64000000000n * 5000n) / 10000n, 'true');
chk('max repay = close factor cap', maxRepay(v, 500n), 32000000000n);
const seized = seizedForRepay(32000000000n, v, 500n);
chk('seized for 32000 QUSD', seized, (32000000000n * PQ * S8 * 10500n) / (PM * S6 * 10000n));
chk(
  'bonus portion',
  bonusPortion(32000000000n, seized, v),
  seized - (32000000000n * PQ * S8) / (PM * S6),
);

// ---- LTV check ----
chk(
  'seed pos-0001 within ltv',
  passesLoanToValue(mbtcPos(200000000n, 60000000000n), 7000n),
  'true',
);
chk(
  'overdrawn fails ltv',
  passesLoanToValue(mbtcPos(200000000n, 100000000000n), 7000n),
  'false',
);

// ---- State machine ----
const ev = (hf: bigint | null, grace: number | null, mark: boolean, now = 1000) =>
  evaluatePosition({
    collateral: 1n,
    debt: hf === null ? 0n : 1n,
    healthFactorScaled: hf,
    storedGraceEndsAtMs: grace,
    afterFillMark: mark,
    nowMs: now,
    graceSeconds: 300,
  });
chk(
  'closed',
  evaluatePosition({
    collateral: 0n,
    debt: 0n,
    healthFactorScaled: null,
    storedGraceEndsAtMs: null,
    afterFillMark: false,
    nowMs: 0,
    graceSeconds: 300,
  }).state,
  'closed',
);
chk('no debt healthy', ev(null, null, false).state, 'healthy');
chk('hf 1.6 healthy', ev(16000n, null, false).state, 'healthy');
chk('hf 1.1000 healthy (boundary)', ev(11000n, null, false).state, 'healthy');
chk('hf 1.0999 warned', ev(10999n, null, false).state, 'warned');
chk('hf 1.0000 warned (boundary)', ev(10000n, null, false).state, 'warned');
chk('hf 0.99 starts grace', ev(9900n, null, false).state, 'liquidatable_grace');
chk('grace end set', ev(9900n, null, false).graceEndsAtMs, 1000 + 300000);
chk('in grace', ev(9900n, 5000, false).state, 'liquidatable_grace');
chk('grace expired -> liquidatable', ev(9900n, 500, false).state, 'liquidatable');
chk('grace expired + mark -> partially', ev(9900n, 500, true).state, 'partially_liquidated');
chk('mark no grace -> partially', ev(9900n, null, true).state, 'partially_liquidated');
chk('healthy rearms notice', ev(16000n, 500, true).rearmsMarginNotice, 'true');
chk(
  'healthy clears grace+mark',
  String(ev(16000n, 500, true).graceEndsAtMs) + '/' + ev(16000n, 500, true).afterFillMark,
  'null/false',
);
chk(
  'warned clears grace+mark',
  String(ev(10500n, 500, true).graceEndsAtMs) + '/' + ev(10500n, 500, true).afterFillMark,
  'null/false',
);

// ---- Oracle ----
chk('convert exp -8', convertToPriceUnits(6400000000000n, -8), 6400000000000n);
chk('convert exp 0', convertToPriceUnits(64000n, 0), 6400000000000n);
chk('convert exp -10 floors', convertToPriceUnits(640001234567891n, -10), 6400012345678n);
chk('convert zero is malformed', convertToPriceUnits(1n, -18), 'null');
const NOW = 1793577600000 + 100000;
const good = parseOracleBody(
  '{"feed":"MBTC-USD","round":1042,"price":{"mantissa":"6400012345678","exponent":-8},"publish_time":1793702400}',
  'MBTC',
  1793702400000 + 1000,
);
chk('parse good round', good?.round, 1042);
chk('parse good price', good?.priceUnits, 6400012345678n);
chk(
  'wrong feed malformed',
  String(
    parseOracleBody(
      '{"feed":"QUSD-USD","round":1,"price":{"mantissa":"1","exponent":0},"publish_time":1}',
      'MBTC',
      NOW,
    ),
  ),
  'null',
);
chk(
  'future publish malformed',
  String(
    parseOracleBody(
      '{"feed":"MBTC-USD","round":1,"price":{"mantissa":"1","exponent":0},"publish_time":' +
        Math.floor(NOW / 1000 + 10) +
        '}',
      'MBTC',
      NOW,
    ),
  ),
  'null',
);
chk(
  'mantissa leading zero malformed',
  String(
    parseOracleBody(
      '{"feed":"MBTC-USD","round":1,"price":{"mantissa":"0640","exponent":0},"publish_time":1}',
      'MBTC',
      NOW,
    ),
  ),
  'null',
);
chk(
  'numeric round as string malformed',
  String(
    parseOracleBody(
      '{"feed":"MBTC-USD","round":"1","price":{"mantissa":"1","exponent":0},"publish_time":1}',
      'MBTC',
      NOW,
    ),
  ),
  'null',
);
chk('not json malformed', String(parseOracleBody('<html>', 'MBTC', NOW)), 'null');
chk('exactly 60% allowed', isLargeMove(100n, 160n), 'false');
chk('over 60% large', isLargeMove(100n, 161n), 'true');
chk('down exactly 60% allowed', isLargeMove(100n, 40n), 'false');
chk('down over 60% large', isLargeMove(100n, 39n), 'true');

const standing = {
  currentPrice: PM,
  currentPostedAtMs: 1793600000000,
  currentIsOracle: false,
  lastAppliedRound: 1,
  lastAppliedPrice: PM,
  lastAppliedPublishedAtMs: 1793577600000,
};
const mk = (round: number, price: bigint, pub: number) => ({
  round,
  priceUnits: price,
  publishedAtMs: pub,
  rawBody: '',
});
chk(
  'older round ignored',
  decideOracleReading(mk(0, PM, 1793577600000), standing).status,
  'old_round',
);
chk(
  'same round diff price',
  decideOracleReading(mk(1, PM + 1n, 1793577600000), standing).status,
  'old_round',
);
chk(
  'same round same content, manual holds',
  decideOracleReading(mk(1, PM, 1793577600000), standing).status,
  'not_newer',
);
chk(
  'newer round but older publication',
  decideOracleReading(mk(2, PM, 1793590000000), standing).status,
  'not_newer',
);
chk(
  'newer round, later publication applies',
  decideOracleReading(mk(2, PM, 1793600001000), standing).apply,
  'true',
);
chk(
  'newer but large move',
  decideOracleReading(mk(2, PM * 3n, 1793600001000), standing).status,
  'large_move',
);
chk(
  'same round, current is that oracle post',
  decideOracleReading(mk(1, PM, 1793577600000), { ...standing, currentIsOracle: true }).status,
  'ok',
);

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILED');
