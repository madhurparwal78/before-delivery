import { chk, note, summary, get, post, sessionFor } from '../scripts/apitest.mjs';

const STUB = 'http://127.0.0.1:8099';
const ines = await sessionFor('stw-ines');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);
const poolOf = async (asset) => (await get(`/api/pools/${asset}`, ines)).body;

const reading = (asset, { round, mantissa, exponent = -8, publishTime }) => ({
  feed: `${asset}-USD`,
  round,
  price: { mantissa: String(mantissa), exponent },
  publish_time: publishTime,
});

async function control(command) {
  await fetch(`${STUB}/control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
}
const serve = (asset, options) => control({ asset, ...options });
const clear = () => control({ clear: true });

async function waitFor(asset, predicate, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    const pool = await poolOf(asset);
    if (predicate(pool)) return pool;
    await sleep(300);
  }
  return poolOf(asset);
}
const statusIs =
  (...wanted) =>
  (pool) =>
    wanted.includes(pool.oracle_status);
const priceIs = (price) => (pool) => pool.price === price;

await clear();

note('an absent feed keeps the last good price (DP-32)');
const absent = await waitFor('MBTC', statusIs('unreachable'));
chk('an absent feed reads unreachable', absent.oracle_status, 'unreachable');
chk('the seed price holds', absent.price, '64000.00000000');
chk('price source is still the seed post', absent.price_source, 'manual');

const seedPostedAt = Math.floor(Date.parse(absent.price_posted_at) / 1000);

note('a publication no later than the current price is not newer (DP-31)');
await serve('MBTC', {
  body: reading('MBTC', {
    round: 1,
    mantissa: '6400000000000',
    publishTime: seedPostedAt - 600,
  }),
});
const notNewer = await waitFor('MBTC', statusIs('not_newer'));
chk('a manual post holds against an older publication', notNewer.oracle_status, 'not_newer');
chk('price unchanged', notNewer.price, '64000.00000000');

// Give the clock room so a reading can be newer than the seed post without
// being published in the future.
while (nowSec() <= seedPostedAt + 1) await sleep(300);

note('a strictly newer round and publication is applied (DP-31)');
const appliedAt = nowSec();
await serve('MBTC', {
  body: reading('MBTC', { round: 1042, mantissa: '6500012345678', publishTime: appliedAt }),
});
const applied = await waitFor('MBTC', priceIs('65000.12345678'));
chk('the reading is applied', applied.price, '65000.12345678');
chk('mantissa and exponent converted with integer arithmetic', applied.price, '65000.12345678');
chk('status ok', applied.oracle_status, 'ok');
chk('price source is the oracle', applied.price_source, 'oracle');
chk('the round is published', applied.oracle_round, 1042);
chk(
  'posted_at is the publication instant',
  Math.floor(Date.parse(applied.price_posted_at) / 1000),
  appliedAt,
);
const history = await get('/api/prices?asset=MBTC', ines);
chk('recorded as posted by the oracle', history.body.prices[0].posted_by, 'oracle');
chk(
  'with its own evidence object',
  history.body.prices[0].evidence_key,
  `evidence/prices/${history.body.prices[0].price_post_id}.json`,
);
chk(
  'applied exactly once for this round',
  history.body.prices.filter((p) => p.oracle_round === 1042).length,
  1,
);

note('a lower round is ignored (DP-32)');
await serve('MBTC', {
  body: reading('MBTC', { round: 1041, mantissa: '100000000000', publishTime: nowSec() }),
});
const oldRound = await waitFor('MBTC', statusIs('old_round'));
chk('old_round reported', oldRound.oracle_status, 'old_round');
chk('the last good price holds', oldRound.price, '65000.12345678');

note('the same round with different content is an older round (DP-32)');
await serve('MBTC', {
  body: reading('MBTC', { round: 1042, mantissa: '6600000000000', publishTime: appliedAt }),
});
chk(
  'same round, different price',
  (await waitFor('MBTC', statusIs('old_round'))).oracle_status,
  'old_round',
);
chk('the last good price holds', (await poolOf('MBTC')).price, '65000.12345678');

note('the same round with the same content reads ok (DP-32)');
await serve('MBTC', {
  body: reading('MBTC', { round: 1042, mantissa: '6500012345678', publishTime: appliedAt }),
});
chk(
  'the current price is that reading',
  (await waitFor('MBTC', statusIs('ok'))).oracle_status,
  'ok',
);

note('a malformed body is ignored (DP-32)');
await serve('MBTC', { body: '{"feed":"MBTC-USD","round":' });
chk(
  'truncated JSON is malformed',
  (await waitFor('MBTC', statusIs('malformed'))).oracle_status,
  'malformed',
);
chk('the last good price holds', (await poolOf('MBTC')).price, '65000.12345678');

await serve('MBTC', {
  body: reading('METH', { round: 9000, mantissa: '100000000', publishTime: nowSec() }),
});
chk(
  'a wrong feed name is malformed',
  (await waitFor('MBTC', statusIs('malformed'))).oracle_status,
  'malformed',
);

await serve('MBTC', {
  body: reading('MBTC', {
    round: 9001,
    mantissa: '6600000000000',
    publishTime: nowSec() + 600,
  }),
});
chk(
  'a publication far in the future is malformed',
  (await waitFor('MBTC', statusIs('malformed'))).oracle_status,
  'malformed',
);

await serve('MBTC', {
  body: {
    feed: 'MBTC-USD',
    round: 9002,
    price: { mantissa: '0640', exponent: -8 },
    publish_time: nowSec(),
  },
});
chk(
  'a mantissa with leading zeros is malformed',
  (await waitFor('MBTC', statusIs('malformed'))).oracle_status,
  'malformed',
);

await serve('MBTC', {
  body: {
    feed: 'MBTC-USD',
    round: '9003',
    price: { mantissa: '6600000000000', exponent: -8 },
    publish_time: nowSec(),
  },
});
chk(
  'a round sent as a string is malformed',
  (await waitFor('MBTC', statusIs('malformed'))).oracle_status,
  'malformed',
);

note('an unreachable or slow feed keeps the last good price (DP-32)');
await serve('MBTC', { status: 503, body: 'down' });
chk(
  'a non-200 reads unreachable',
  (await waitFor('MBTC', statusIs('unreachable'))).oracle_status,
  'unreachable',
);
chk('the last good price holds', (await poolOf('MBTC')).price, '65000.12345678');

await serve('MBTC', {
  body: reading('MBTC', { round: 9100, mantissa: '7000000000000', publishTime: nowSec() }),
  delayMs: 2500,
});
chk(
  'a slow feed times out and reads unreachable',
  (await waitFor('MBTC', statusIs('unreachable'))).oracle_status,
  'unreachable',
);
chk('the slow reading was not applied', (await poolOf('MBTC')).price, '65000.12345678');

note('a move of more than 60% is never applied automatically (DP-32)');
await serve('MBTC', {
  body: reading('MBTC', { round: 9200, mantissa: '20000000000000', publishTime: nowSec() }),
});
const largeMove = await waitFor('MBTC', statusIs('large_move'));
chk('large_move reported', largeMove.oracle_status, 'large_move');
chk('the last good price holds', largeMove.price, '65000.12345678');

note('a fresh reading applies on the next poll, with no restart (DP-32)');
await serve('MBTC', {
  body: reading('MBTC', { round: 9300, mantissa: '6600000000000', publishTime: nowSec() }),
});
const recovered = await waitFor('MBTC', priceIs('66000.00000000'));
chk('the price moves again', recovered.price, '66000.00000000');
chk('status ok', recovered.oracle_status, 'ok');
chk('round 9300', recovered.oracle_round, 9300);

note('a manual post holds until a later publication arrives (DP-31, DP-33)');
await sleep(1200);
const manual = await post('/api/prices', { asset: 'MBTC', price: '60000' }, ines);
chk('manual post accepted', manual.status, 201);
chk('manual price in force', (await poolOf('MBTC')).price, '60000.00000000');
// The round 9300 reading is still served, but its publication is now older
// than the manual post, so it can never replace it.
const held = await waitFor('MBTC', statusIs('not_newer'));
chk('the oracle has nothing newer', held.oracle_status, 'not_newer');
chk('the manual post holds', held.price, '60000.00000000');
chk('price source is manual', held.price_source, 'manual');
chk('oracle_round is null for a manual post', String(held.oracle_round), 'null');

await sleep(1200);
await serve('MBTC', {
  body: reading('MBTC', { round: 9301, mantissa: '6100000000000', publishTime: nowSec() }),
});
const tookOver = await waitFor('MBTC', priceIs('61000.00000000'));
chk('a later publication takes over', tookOver.price, '61000.00000000');
chk('source oracle again', tookOver.price_source, 'oracle');
chk('round 9301', tookOver.oracle_round, 9301);

note('an exponent above -8 scales up, and a long one floors (DP-31)');
await sleep(1200);
await serve('MBTC', {
  body: reading('MBTC', { round: 9302, mantissa: '62000', exponent: 0, publishTime: nowSec() }),
});
chk(
  'exponent 0 scales to price units',
  (await waitFor('MBTC', priceIs('62000.00000000'))).price,
  '62000.00000000',
);
await sleep(1200);
await serve('MBTC', {
  body: reading('MBTC', {
    round: 9303,
    mantissa: '630001234567891',
    exponent: -10,
    publishTime: nowSec(),
  }),
});
chk(
  'exponent -10 floors to 8 decimals',
  (await waitFor('MBTC', priceIs('63000.12345678'))).price,
  '63000.12345678',
);

note('trial balance is untouched by price posts (DP-03)');
for (const t of (await get('/api/ledger/totals', ines)).body.assets)
  chk('net ' + t.asset, t.net, '0');

await clear();
summary();
