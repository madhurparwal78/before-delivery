import { chk, note, summary, get, sessionFor } from '../scripts/apitest.mjs';

const ines = await sessionFor('stw-ines');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

note('the real baseline feed against the seed prices (DP-31)');
// The environment serves round 1 published at 1793577600 with the seed
// mantissas. It is older than the seed posts, so the seed prices hold and
// every asset reads not_newer.
let pools = [];
for (let i = 0; i < 30; i += 1) {
  pools = (await get('/api/pools', ines)).body.pools;
  if (pools.every((p) => p.oracle_status !== 'unreachable')) break;
  await sleep(400);
}
const byAsset = Object.fromEntries(pools.map((p) => [p.asset, p]));
for (const [asset, price] of [
  ['QUSD', '1.00000000'],
  ['MBTC', '64000.00000000'],
  ['METH', '3200.00000000'],
]) {
  chk(`${asset} reads not_newer`, byAsset[asset].oracle_status, 'not_newer');
  chk(`${asset} keeps its seed price`, byAsset[asset].price, price);
  chk(`${asset} price source is still manual`, byAsset[asset].price_source, 'manual');
  chk(
    `${asset} oracle_round is null for a manual post`,
    String(byAsset[asset].oracle_round),
    'null',
  );
}
chk(
  'markets are open',
  pools.every((p) => p.market_state === 'open'),
  true,
);

note('no oracle post was recorded (DP-31)');
const history = await get('/api/prices', ines);
chk(
  'every post is still a manual seed post',
  history.body.prices.every((p) => p.source === 'manual'),
  true,
);
chk('three seed posts only', history.body.prices.length, 3);

summary();
