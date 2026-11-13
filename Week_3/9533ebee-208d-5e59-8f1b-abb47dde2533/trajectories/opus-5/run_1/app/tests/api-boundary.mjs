import {
  chk,
  note,
  summary,
  get,
  post,
  patch,
  raw,
  sessionFor,
  runKey,
} from '../scripts/apitest.mjs';

note('sessions and roles (DP-01)');
const anon = await get('/api/pools');
chk('no token -> 401', anon.status, 401);
chk('401 code', anon.body.code, 'unauthenticated');
chk('401 detail', anon.body.detail, 'Choose who you are acting as.');
chk('401 sends WWW-Authenticate', anon.headers.get('www-authenticate'), 'Bearer');
chk('401 is problem+json', anon.headers.get('content-type'), 'application/problem+json');

const bad = await get('/api/pools', 'not-a-real-token');
chk('unknown token -> 401', bad.status, 401);

const actors = await get('/api/actors');
chk('actor list is open', actors.status, 200);
chk('12 members', actors.body.actors.length, 12);
chk('ordered by name, first is Dele', actors.body.actors[0].name, 'Dele Oyelaran');

const ines = await sessionFor('stw-ines');
const odile = await sessionFor('stw-odile');
const rosa = await sessionFor('lp-rosa');
const petra = await sessionFor('tr-petra');
const sanna = await sessionFor('br-sanna');
const dele = await sessionFor('br-dele');
const kestrel = await sessionFor('lq-kestrel');
const vane = await sessionFor('lq-vane');

const me = await get('/api/me', ines);
chk('me', me.body.actor_id + '/' + me.body.role, 'stw-ines/risk_steward');

note('roles are enforced (DP-01)');
chk('trader cannot read the ledger', (await get('/api/ledger/totals', petra)).status, 403);
chk('steward can read the ledger', (await get('/api/ledger/totals', ines)).status, 200);
chk(
  'borrower cannot post prices',
  (await post('/api/prices', { asset: 'MBTC', price: '1' }, sanna)).status,
  403,
);
chk(
  'liquidity provider cannot swap',
  (
    await post(
      '/api/swap/quotes',
      { from_asset: 'QUSD', to_asset: 'MBTC', amount_in: '1' },
      rosa,
    )
  ).status,
  403,
);
chk('steward may read the queue', (await get('/api/liquidations/queue', ines)).status, 200);
chk('trader may not read the queue', (await get('/api/liquidations/queue', petra)).status, 403);

note('pool figures read from the ledger (DP-07)');
const pools = await get('/api/pools', ines);
chk('pools status', pools.status, 200);
const byAsset = Object.fromEntries(pools.body.pools.map((p) => [p.asset, p]));
chk(
  'QUSD borrowed grows from 201 000 by accrual',
  BigInt(byAsset.QUSD.total_borrowed) >= 201000000000n,
  true,
);
chk('QUSD utilization bps', byAsset.QUSD.utilization_bps, 1005);
chk('QUSD borrow rate bps', byAsset.QUSD.borrow_rate_bps, 44);
chk('QUSD supply rate bps', byAsset.QUSD.supply_rate_bps, 3);
chk('QUSD share price rises with accrual', byAsset.QUSD.share_price >= '1.000000000000', true);
chk(
  'available = supply + swap - borrowed',
  BigInt(byAsset.QUSD.available_liquidity),
  BigInt(byAsset.QUSD.supply_balance) +
    BigInt(byAsset.QUSD.swap_balance) -
    BigInt(byAsset.QUSD.total_borrowed),
);
chk('QUSD price', byAsset.QUSD.price, '1.00000000');
chk('MBTC price', byAsset.MBTC.price, '64000.00000000');
chk('METH price', byAsset.METH.price, '3200.00000000');
chk('MBTC available', byAsset.MBTC.available_liquidity, '4000000000');
chk('METH available', byAsset.METH.available_liquidity, '600000000000000000000');
chk('MBTC decimals', byAsset.MBTC.decimals, 8);
chk('METH name', byAsset.METH.name, 'Moor Ether');
chk('MBTC params ltv', byAsset.MBTC.params.ltv_bps, 7000);
chk('MBTC threshold', byAsset.MBTC.params.liquidation_threshold_bps, 7500);
chk('MBTC bonus', byAsset.MBTC.params.liquidation_bonus_bps, 500);
chk('MBTC close factor', byAsset.MBTC.params.close_factor_bps, 5000);
chk('MBTC swap fee', byAsset.MBTC.params.swap_fee_bps, 30);
chk('warning health factor', byAsset.MBTC.params.warning_health_factor, '1.1000');
chk(
  'MBTC curve',
  JSON.stringify(byAsset.MBTC.curve),
  JSON.stringify({ base_bps: 0, slope1_bps: 400, kink_bps: 4500, slope2_bps: 30000 }),
);
chk('market open', byAsset.MBTC.market_state, 'open');
chk('price source manual', byAsset.MBTC.price_source, 'manual');
chk('oracle round null for manual', String(byAsset.MBTC.oracle_round), 'null');
chk('borrow index starts at 1e27', byAsset.METH.borrow_index, '1000000000000000000000000000');
chk('durations: staleness', pools.body.staleness_limit, 'PT1H');
chk('durations: grace', pools.body.grace_period, 'PT5M');
chk('durations: quote', pools.body.quote_lifetime, 'PT30S');
chk('desk time zone', pools.body.desk_time_zone, 'America/St_Johns');
chk(
  'server_time canonical',
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(pools.body.server_time),
  true,
);

note('positions at start (DP-22)');
const positions = await get('/api/positions', ines);
const pos = Object.fromEntries(positions.body.positions.map((p) => [p.position_id, p]));
const expected = {
  'pos-0001': ['1.6000', '40000.00000000', '200000000', '60000000000'],
  'pos-0002': ['1.1250', '56888.88888889', '150000000', '64000000000'],
  'pos-0003': ['1.2000', '53333.33333334', '100000000', '40000000000'],
  'pos-0004': ['1.1428', '56000.00000000', '50000000', '21000000000'],
  'pos-0005': ['1.6000', '2000.00000000', '10000000000000000000', '16000000000'],
};
for (const [id, [hf, lp, coll, debt]] of Object.entries(expected)) {
  // Debt grows by accrual from the moment of seeding, so the health factor
  // sits just at or below its seeded value and the liquidation price just above.
  chk(
    id + ' health factor near seed',
    Math.abs(Number(pos[id].health_factor) - Number(hf)) < 0.0005,
    true,
  );
  chk(
    id + ' liquidation price near seed',
    Number(pos[id].liquidation_price) >= Number(lp),
    true,
  );
  chk(id + ' collateral', pos[id].collateral_amount, coll);
  chk(id + ' debt grows from seed', BigInt(pos[id].debt) >= BigInt(debt), true);
  chk(id + ' state', pos[id].state, 'healthy');
  chk(id + ' round', pos[id].round, 0);
  chk(id + ' max_repay', pos[id].max_repay, '0');
  chk(id + ' grace_ends_at', String(pos[id].grace_ends_at), 'null');
}

note('wallets (DP-02)');
const wallet = await get('/api/wallet', petra);
const petraBalances = Object.fromEntries(wallet.body.balances.map((b) => [b.asset, b.amount]));
chk('petra MBTC', petraBalances.MBTC, '100000000');
chk('petra QUSD', petraBalances.QUSD, '50000000000');
chk('petra METH', petraBalances.METH, '5000000000000000000');
chk('all three assets listed', wallet.body.balances.length, 3);
const rosaWallet = await get('/api/wallet', rosa);
chk('rosa holdings count', rosaWallet.body.lp_holdings.length, 2);
const rosaHoldings = Object.fromEntries(rosaWallet.body.lp_holdings.map((h) => [h.asset, h]));
chk('rosa QUSD shares', rosaHoldings.QUSD.shares, '2000000000000');
chk('rosa QUSD share value grows', BigInt(rosaHoldings.QUSD.value) >= 2000000000000n, true);
chk('shares are strings', typeof rosaHoldings.QUSD.shares, 'string');
const sannaWallet = await get('/api/wallet', sanna);
chk(
  'sanna position ids',
  JSON.stringify(sannaWallet.body.position_ids),
  JSON.stringify(['pos-0001']),
);

note('trial balance nets to zero (DP-03)');
const totals = await get('/api/ledger/totals', ines);
chk('three assets', totals.body.assets.length, 3);
for (const a of totals.body.assets) chk('net ' + a.asset, a.net, '0');

note('swap preview and quote (DP-12)');
const preview = await get(
  '/api/swap/preview?from_asset=MBTC&to_asset=QUSD&amount_in=12345678',
  petra,
);
chk('preview status', preview.status, 200);
chk('preview fee', preview.body.fee, '37038');
chk('preview amount_out', preview.body.amount_out, '7877529600');
chk('preview price_from', preview.body.price_from, '64000.00000000');
chk('preview price_to', preview.body.price_to, '1.00000000');

const quote = await post(
  '/api/swap/quotes',
  { from_asset: 'MBTC', to_asset: 'QUSD', amount_in: '12345678' },
  petra,
);
chk('quote status', quote.status, 201);
chk('quote fee', quote.body.fee, '37038');
chk('quote fee_to_reserve', quote.body.fee_to_reserve, '3704');
chk('quote fee_to_supply', quote.body.fee_to_supply, '33334');
chk('quote amount_out', quote.body.amount_out, '7877529600');
chk(
  'quote expiry is canonical',
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(quote.body.expires_at),
  true,
);
const lifetime =
  (Date.parse(quote.body.expires_at) - Date.parse(quote.body.server_time)) / 1000;
chk('quote lifetime 30s', lifetime, 30);

note('swap execution (DP-13)');
const swap = await post('/api/swaps', { quote_id: quote.body.quote_id }, petra, {
  key: runKey('swap1'),
});
chk('swap status', swap.status, 201);
chk('swap amount_in', swap.body.amount_in, '12345678');
chk('swap amount_out matches quote', swap.body.amount_out, quote.body.amount_out);
chk('swap fee matches quote', swap.body.fee, quote.body.fee);
const swapLegs = swap.body.legs.map((l) => `${l.account} ${l.asset} ${l.amount}`);
chk(
  'swap legs',
  JSON.stringify(swapLegs),
  JSON.stringify([
    'wallet:tr-petra MBTC -12345678',
    'supply MBTC 33334',
    'reserve MBTC 3704',
    'swap MBTC 12308640',
    'swap QUSD -7877529600',
    'wallet:tr-petra QUSD 7877529600',
  ]),
);

const reused = await post('/api/swaps', { quote_id: quote.body.quote_id }, petra, {
  key: runKey('swap1'),
});
chk('replay returns the original', reused.status, 201);
chk('replay marked', reused.headers.get('idempotency-replayed'), 'true');
chk('replay returns the same bytes', reused.text, swap.text);

const quote2 = await post(
  '/api/swap/quotes',
  { from_asset: 'MBTC', to_asset: 'QUSD', amount_in: '1000' },
  petra,
);
const otherBody = await post('/api/swaps', { quote_id: quote2.body.quote_id }, petra, {
  key: runKey('swap1'),
});
chk('same key, different body -> 409', otherBody.status, 409);
chk('reused code', otherBody.body.code, 'idempotency_key_reused');

const usedAgain = await post('/api/swaps', { quote_id: quote.body.quote_id }, petra, {
  key: runKey('swap2'),
});
chk('quote already used -> 409', usedAgain.status, 409);
chk('quote_used code', usedAgain.body.code, 'quote_used');
chk('quote_used detail', usedAgain.body.detail, 'This quote has already been used.');

note('the swap fee raised only the MBTC share price (DP-12)');
const afterSwap = await get('/api/pools', ines);
const after = Object.fromEntries(afterSwap.body.pools.map((p) => [p.asset, p]));
chk('MBTC share price rose', after.MBTC.share_price > '1.000000000000', true);
chk('MBTC supply balance', after.MBTC.supply_balance, String(4000000000n + 33334n));
chk('MBTC reserve balance', after.MBTC.reserve_balance, '3704');
chk('MBTC swap balance', after.MBTC.swap_balance, '12308640');
chk('QUSD swap balance', after.QUSD.swap_balance, '-7877529600');
chk(
  'petra MBTC after',
  (await get('/api/wallet', petra)).body.balances.find((b) => b.asset === 'MBTC').amount,
  String(100000000n - 12345678n),
);

note('trial balance still nets to zero after the swap (DP-03)');
for (const a of (await get('/api/ledger/totals', ines)).body.assets)
  chk('net ' + a.asset, a.net, '0');

note('strict bodies (DP-60)');
const unknownKey = await post(
  '/api/transfers',
  { actor_id: 'br-sanna', asset: 'QUSD', amount: '1', nope: 1 },
  ines,
);
chk('unknown field -> 422', unknownKey.status, 422);
chk('unknown field message', unknownKey.body.errors.nope, 'Unknown field.');
const proto = await post(
  '/api/transfers',
  '{"actor_id":"br-sanna","asset":"QUSD","amount":"1","__proto__":{"x":1}}',
  ines,
);
chk(
  '__proto__ is an unknown field',
  Object.getOwnPropertyDescriptor(proto.body.errors ?? {}, '__proto__')?.value,
  'Unknown field.',
);
const ctor = await post(
  '/api/transfers',
  '{"actor_id":"br-sanna","asset":"QUSD","amount":"1","constructor":1,"prototype":2}',
  ines,
);
chk('constructor is an unknown field', ctor.body.errors.constructor, 'Unknown field.');
chk('prototype is an unknown field', ctor.body.errors.prototype, 'Unknown field.');
const ctrl = await post(
  '/api/actors',
  { name: 'Bad\u0007Name', email: 'a@b.example', role: 'trader' },
  ines,
);
chk('control characters refused', ctrl.body.errors.name, 'Remove control characters.');
const numberAmount = await post(
  '/api/transfers',
  { actor_id: 'br-sanna', asset: 'QUSD', amount: 100 },
  ines,
);
chk(
  'a number is not an amount',
  numberAmount.body.errors.amount,
  'Enter a whole number of minor units above zero.',
);
const leadingZero = await post(
  '/api/transfers',
  { actor_id: 'br-sanna', asset: 'QUSD', amount: '0100' },
  ines,
);
chk(
  'leading zeros refused',
  leadingZero.body.errors.amount,
  'Enter a whole number of minor units above zero.',
);
const zero = await post(
  '/api/transfers',
  { actor_id: 'br-sanna', asset: 'QUSD', amount: '0' },
  ines,
);
chk('zero refused', zero.body.errors.amount, 'Enter a whole number of minor units above zero.');
const badAsset = await post(
  '/api/transfers',
  { actor_id: 'br-sanna', asset: 'XYZ', amount: '1' },
  ines,
);
chk('unlisted asset', badAsset.body.errors.asset, 'Choose a listed asset.');
const samePair = await post(
  '/api/positions',
  { collateral_asset: 'MBTC', debt_asset: 'MBTC', collateral_amount: '1' },
  sanna,
);
chk('same pair refused', samePair.body.errors.debt_asset, 'Choose two different assets.');
chk('422 detail', unknownKey.body.detail, 'Check the highlighted fields.');
chk('422 type', unknownKey.body.type, 'urn:quillmoor:problem:validation_failed');

note('error precedence (DP-60, DP-05)');
const bigBody = 'x'.repeat(16385);
const tooLarge = await raw('POST', '/api/transfers', {
  token: ines,
  body: JSON.stringify({ pad: bigBody }),
});
chk('16385 bytes -> 413', tooLarge.status, 413);
chk('413 detail', tooLarge.body.detail, 'The request body is too large.');
const exact = JSON.stringify({ actor_id: 'br-sanna', asset: 'QUSD', amount: '1', pad: '' });
const padded = JSON.stringify({
  actor_id: 'br-sanna',
  asset: 'QUSD',
  amount: '1',
  pad: 'x'.repeat(16384 - exact.length),
});
chk('exactly 16384 bytes is accepted', Buffer.byteLength(padded), 16384);
const atLimit = await raw('POST', '/api/transfers', { token: ines, body: padded });
chk('16384 bytes passes the limit rung', atLimit.status, 422);
// 413 beats cross-origin, which beats media type, which beats invalid json, which beats 401
chk(
  '413 beats origin',
  (
    await raw('POST', '/api/transfers', {
      body: JSON.stringify({ pad: bigBody }),
      headers: { origin: 'http://evil.example' },
    })
  ).status,
  413,
);
chk(
  'origin beats media type',
  (
    await raw('POST', '/api/transfers', {
      body: 'nope',
      headers: { origin: 'http://evil.example', 'content-type': 'text/plain' },
    })
  ).status,
  403,
);
chk(
  'cross origin detail',
  (
    await raw('POST', '/api/transfers', {
      body: '{}',
      headers: { origin: 'http://evil.example' },
    })
  ).body.detail,
  'Requests must come from Quillmoor\u2019s own pages.',
);
chk(
  'media type beats invalid json',
  (
    await raw('POST', '/api/transfers', {
      body: 'nope',
      headers: { 'content-type': 'text/plain' },
    })
  ).status,
  415,
);
chk(
  '415 detail',
  (
    await raw('POST', '/api/transfers', {
      body: 'x',
      headers: { 'content-type': 'text/plain' },
    })
  ).body.detail,
  'Send the body as application/json.',
);
chk(
  'invalid json beats 401',
  (
    await raw('POST', '/api/transfers', {
      body: '{oops',
      headers: { 'content-type': 'application/json' },
    })
  ).status,
  400,
);
chk(
  '400 detail',
  (
    await raw('POST', '/api/transfers', {
      body: '{oops',
      headers: { 'content-type': 'application/json' },
    })
  ).body.detail,
  'The request body is not valid JSON.',
);
chk(
  '401 beats key required',
  (
    await raw('POST', '/api/positions/pos-0001/draws', {
      body: '{}',
      headers: { 'content-type': 'application/json' },
    })
  ).status,
  401,
);
chk(
  'key required beats unknown resource',
  (await post('/api/positions/nope/draws', { amount: '1' }, sanna)).status,
  400,
);
chk(
  'key required detail',
  (await post('/api/positions/nope/draws', { amount: '1' }, sanna)).body.detail,
  'Send an Idempotency-Key header of 1 to 128 visible characters.',
);
chk(
  'unknown resource beats role',
  (await post('/api/positions/nope/draws', { amount: '1' }, petra, { key: runKey('k1') }))
    .status,
  404,
);
chk(
  '404 detail',
  (await get('/api/positions/nope', ines)).body.detail,
  'Nothing here by that name.',
);
chk(
  'role beats ownership',
  (await post('/api/positions/pos-0001/draws', { amount: '1' }, petra, { key: runKey('k2') }))
    .status,
  403,
);
chk(
  'ownership refused',
  (await post('/api/positions/pos-0002/draws', { amount: '1' }, sanna, { key: runKey('k3') }))
    .status,
  403,
);
chk(
  'forbidden detail',
  (await post('/api/positions/pos-0002/draws', { amount: '1' }, sanna, { key: runKey('k4') }))
    .body.detail,
  'Your role can\u2019t do this.',
);
chk(
  'same-origin request is allowed',
  (
    await raw('POST', '/api/sessions', {
      body: JSON.stringify({ actor_id: 'stw-ines' }),
      headers: { origin: 'http://127.0.0.1:4173' },
    })
  ).status,
  201,
);
chk(
  'unknown api path -> 404 problem',
  (await get('/api/nowhere', ines)).body.code,
  'not_found',
);

note('conditional risk saves (DP-28)');
const risk = await get('/api/assets/MBTC/risk', ines);
chk('risk status', risk.status, 200);
chk('risk ltv', risk.body.ltv_bps, 7000);
const etag = risk.headers.get('etag');
chk('strong etag', /^"[0-9a-f]{32}"$/.test(etag), true);
chk(
  'no If-Match -> 428',
  (await patch('/api/assets/MBTC/risk', { ltv_bps: 7100 }, ines)).status,
  428,
);
chk(
  '428 detail',
  (await patch('/api/assets/MBTC/risk', { ltv_bps: 7100 }, ines)).body.detail,
  'Send the If-Match header from your latest read.',
);
chk(
  'wrong If-Match -> 412',
  (await patch('/api/assets/MBTC/risk', { ltv_bps: 7100 }, ines, { ifMatch: '"0000"' })).status,
  412,
);
const saved = await patch('/api/assets/MBTC/risk', { ltv_bps: 7100 }, ines, { ifMatch: etag });
chk('save status', saved.status, 200);
chk('saved ltv', saved.body.ltv_bps, 7100);
chk('save reports positions below one', saved.body.positions_below_one, 0);
chk('etag changed', saved.headers.get('etag') !== etag, true);
const stale = await patch('/api/assets/MBTC/risk', { ltv_bps: 7200 }, odile, { ifMatch: etag });
chk('a second steward stale save -> 412', stale.status, 412);
chk(
  '412 detail',
  stale.body.detail,
  'These risk parameters changed since you opened them. Check the current values and save again.',
);
// bounds
const newEtag = saved.headers.get('etag');
chk(
  'ltv at threshold refused',
  (await patch('/api/assets/MBTC/risk', { ltv_bps: 7500 }, ines, { ifMatch: newEtag })).body
    .errors.ltv_bps,
  'Loan-to-value must be above 0% and below the liquidation threshold.',
);
chk(
  'threshold above 95% refused',
  (
    await patch('/api/assets/MBTC/risk', { liquidation_threshold_bps: 9600 }, ines, {
      ifMatch: newEtag,
    })
  ).body.errors.liquidation_threshold_bps,
  'Liquidation threshold must be above 0% and at most 95,00%.',
);
chk(
  'bonus above 20% refused',
  (
    await patch('/api/assets/MBTC/risk', { liquidation_bonus_bps: 2100 }, ines, {
      ifMatch: newEtag,
    })
  ).body.errors.liquidation_bonus_bps,
  'Bonus must be from 0% to 20,00%, and the threshold times one plus the bonus must stay below 100%.',
);
chk(
  'reserve factor above 50% refused',
  (
    await patch('/api/assets/MBTC/risk', { reserve_factor_bps: 5100 }, ines, {
      ifMatch: newEtag,
    })
  ).body.errors.reserve_factor_bps,
  'Reserve factor must be from 0% to 50,00%.',
);
// restore
const restore = await patch('/api/assets/MBTC/risk', { ltv_bps: 7000 }, ines, {
  ifMatch: newEtag,
});
chk('restored ltv', restore.body.ltv_bps, 7000);

summary();
