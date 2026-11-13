import { chk, note, summary, get, post, sessionFor, runKey } from '../scripts/apitest.mjs';

const ines = await sessionFor('stw-ines');
const sanna = await sessionFor('br-sanna');
const dele = await sessionFor('br-dele');
const petra = await sessionFor('tr-petra');
const rosa = await sessionFor('lp-rosa');
const kestrel = await sessionFor('lq-kestrel');

const STALE_BANNER =
  'Price feed stale. Borrowing, withdrawals of collateral and liquidations are paused.';
const STALE_SWAPS = 'Swaps are paused while the price feed is stale.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const poolOf = async (asset) => (await get(`/api/pools/${asset}`, ines)).body;
const positionOf = async (id, token) => (await get(`/api/positions/${id}`, token)).body;

/**
 * Reposts every asset at its current price. A position is paused while
 * *either* of its assets is stale, so reopening one market is not enough.
 */
async function reopenAll() {
  for (const asset of ['QUSD', 'MBTC', 'METH']) {
    const pool = await poolOf(asset);
    await post('/api/prices', { asset, price: pool.price }, ines);
  }
}

async function waitFor(check, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return true;
    await sleep(400);
  }
  return false;
}

note('a market goes stale once its price ages past the limit (DP-34)');
// STALENESS_SECONDS is 5 here and no oracle is reachable, so every market ages out.
const wentStale = await waitFor(
  async () => (await poolOf('MBTC')).market_state === 'stale_feed',
);
chk('MBTC is stale', wentStale, true);
const stalePool = await poolOf('MBTC');
chk('market_state', stalePool.market_state, 'stale_feed');
chk('its price age is published', stalePool.price_age_seconds >= 5, true);
chk('the last good price is still shown', stalePool.price, '64000.00000000');

note('draws, collateral withdrawals and liquidations are refused (DP-34)');
const draw = await post('/api/positions/pos-0001/draws', { amount: '1000000' }, sanna, {
  key: runKey('s1'),
});
chk('a draw is refused', draw.status, 423);
chk('market_stale code', draw.body.code, 'market_stale');
chk('the banner copy is the detail', draw.body.detail, STALE_BANNER);
const release = await post(
  '/api/positions/pos-0001/collateral-withdrawals',
  { amount: '1000' },
  sanna,
);
chk('a collateral withdrawal is refused', release.status, 423);
chk('with the banner copy', release.body.detail, STALE_BANNER);

note('previews, quotes and swaps are refused with their own copy (DP-34)');
const preview = await get(
  '/api/swap/preview?from_asset=MBTC&to_asset=QUSD&amount_in=1000',
  petra,
);
chk('a preview is refused', preview.status, 423);
chk('with the swap copy', preview.body.detail, STALE_SWAPS);
const quote = await post(
  '/api/swap/quotes',
  { from_asset: 'MBTC', to_asset: 'QUSD', amount_in: '1000' },
  petra,
);
chk('a quote is refused', quote.status, 423);
chk('with the swap copy', quote.body.detail, STALE_SWAPS);

note('supply, withdrawal, repayment, opening and adding collateral continue (DP-34)');
chk(
  'a supply still works',
  (await post('/api/pools/QUSD/supplies', { amount: '1000000' }, rosa)).status,
  201,
);
chk(
  'a liquidity withdrawal still works',
  (
    await post('/api/pools/QUSD/withdrawals', { amount: '1000000' }, rosa, {
      key: runKey('s2'),
    })
  ).status,
  201,
);
chk(
  'a repayment still works',
  (await post('/api/positions/pos-0001/repayments', { amount: '1000000' }, sanna)).status,
  201,
);
chk(
  'adding collateral still works',
  (
    await post(
      '/api/transfers',
      { actor_id: 'br-sanna', asset: 'MBTC', amount: '1000000' },
      ines,
    )
  ).status,
  201,
);
chk(
  'adding collateral is allowed',
  (await post('/api/positions/pos-0001/collateral', { amount: '1000000' }, sanna)).status,
  201,
);
await post(
  '/api/transfers',
  { actor_id: 'br-sanna', asset: 'METH', amount: '1000000000000000000' },
  ines,
);
chk(
  'opening a position is allowed',
  (
    await post(
      '/api/positions',
      {
        collateral_asset: 'METH',
        debt_asset: 'QUSD',
        collateral_amount: '1000000000000000000',
      },
      sanna,
    )
  ).status,
  201,
);

note('a post reopens the market at once (DP-34)');
const reopen = await post('/api/prices', { asset: 'MBTC', price: '64000' }, ines);
chk('post accepted', reopen.status, 201);
const reopened = await poolOf('MBTC');
chk('MBTC is open again', reopened.market_state, 'open');
chk('its age resets', reopened.price_age_seconds <= 2, true);
// A draw also needs its debt asset open, so QUSD is reposted too.
chk(
  'a draw is still paused while the debt asset is stale',
  (
    await post('/api/positions/pos-0001/draws', { amount: '1000000' }, sanna, {
      key: runKey('s3'),
    })
  ).status,
  423,
);
await post('/api/prices', { asset: 'QUSD', price: '1' }, ines);
chk(
  'a draw works once both markets are open',
  (
    await post('/api/positions/pos-0001/draws', { amount: '1000000' }, sanna, {
      key: runKey('s3b'),
    })
  ).status,
  201,
);

note('a recovery grace follows a stale market reopening (DP-35)');
// Put positions below one, let their grace expire, then let the feed go stale.
const drop = await post('/api/prices', { asset: 'MBTC', price: '52000' }, ines);
chk('3 positions below one', drop.body.positions_below_one, 3);
const becameLiquidatable = await waitFor(
  async () => (await positionOf('pos-0002', ines)).state === 'liquidatable',
);
chk('pos-0002 is liquidatable', becameLiquidatable, true);
const markedRound = (await positionOf('pos-0002', ines)).round;

const staleAgain = await waitFor(
  async () => (await poolOf('MBTC')).market_state === 'stale_feed',
);
chk('the feed goes stale again', staleAgain, true);
const refusedFill = await post(
  '/api/positions/pos-0002/liquidations',
  { repay_amount: '1000000', round: markedRound },
  kestrel,
  { key: runKey('s4') },
);
chk('a liquidation is refused while stale', refusedFill.status, 423);
chk('with the banner copy', refusedFill.body.detail, STALE_BANNER);

await post('/api/prices', { asset: 'QUSD', price: '1' }, ines);
await post('/api/prices', { asset: 'METH', price: '3200' }, ines);
const recovery = await post('/api/prices', { asset: 'MBTC', price: '52000' }, ines);
chk('the reopening post is accepted', recovery.status, 201);
chk('positions are still below one', recovery.body.positions_below_one, 3);
chk(
  'every market is open again',
  (await get('/api/pools', ines)).body.pools.every((p) => p.market_state === 'open'),
  true,
);
const inRecovery = await positionOf('pos-0002', ines);
chk('it is put back into a grace', inRecovery.state, 'liquidatable_grace');
chk(
  'with a grace end',
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(inRecovery.grace_ends_at),
  true,
);
const duringRecovery = await post(
  '/api/positions/pos-0002/liquidations',
  { repay_amount: '1000000', round: inRecovery.round },
  kestrel,
  { key: runKey('s5') },
);
chk('liquidation is refused during the recovery grace', duringRecovery.status, 409);
chk('in_grace', duringRecovery.body.code, 'in_grace');

note('after the recovery grace it is liquidatable again (DP-35)');
const liquidatableAgain = await waitFor(async () => {
  const row = await positionOf('pos-0002', ines);
  return row.state === 'liquidatable' || row.state === 'partially_liquidated';
});
chk('it becomes liquidatable again', liquidatableAgain, true);

note('a post onto an open market grants no grace (DP-35)');
await reopenAll();
const openPost = await post('/api/prices', { asset: 'MBTC', price: '51900' }, ines);
chk('post accepted', openPost.status, 201);
const noGrace = await positionOf('pos-0002', ines);
chk(
  'it stays liquidatable',
  ['liquidatable', 'partially_liquidated'].includes(noGrace.state),
  true,
);
chk('with no grace end', String(noGrace.grace_ends_at), 'null');

note('trial balance throughout (DP-03)');
for (const t of (await get('/api/ledger/totals', ines)).body.assets)
  chk('net ' + t.asset, t.net, '0');

summary();
