import { chk, note, summary, get, post, raw, sessionFor, runKey } from '../scripts/apitest.mjs';

const ines = await sessionFor('stw-ines');
const dele = await sessionFor('br-dele');
const kestrel = await sessionFor('lq-kestrel');
const vane = await sessionFor('lq-vane');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const positionOf = async (id, token) => (await get(`/api/positions/${id}`, token)).body;
const noticeCount = async (id, kind) =>
  (await positionOf(id, ines)).notices.filter((n) => n.kind === kind).length;

/** Waits for the server to move a position into one of the given states. */
async function waitForState(id, states, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    const row = await positionOf(id, ines);
    if (states.includes(row.state)) return row;
    await sleep(500);
  }
  return positionOf(id, ines);
}

note('price post validation, with no state change (DP-26)');
chk(
  'zero price refused',
  (await post('/api/prices', { asset: 'MBTC', price: '0' }, ines)).body.errors.price,
  'Enter a price above zero with at most 8 decimal places.',
);
chk(
  '9 decimals refused',
  (await post('/api/prices', { asset: 'MBTC', price: '1.123456789' }, ines)).body.errors.price,
  'Enter a price above zero with at most 8 decimal places.',
);
chk(
  'a number is not a price',
  (await post('/api/prices', { asset: 'MBTC', price: 52000 }, ines)).body.errors.price,
  'Enter a price above zero with at most 8 decimal places.',
);
const large = await post('/api/prices', { asset: 'MBTC', price: '10000' }, ines);
chk('a move of more than 60% needs confirmation', large.status, 422);
chk(
  'large move message',
  large.body.errors.price,
  'This moves the price by more than 60%. Confirm the large move to post it.',
);
chk(
  'confirm_large_move must be a boolean',
  (
    await post(
      '/api/prices',
      { asset: 'MBTC', price: '10000', confirm_large_move: 'yes' },
      ines,
    )
  ).body.errors.confirm_large_move,
  'Send true or false.',
);
chk(
  'unlisted asset refused',
  (await post('/api/prices', { asset: 'XYZ', price: '1' }, ines)).body.errors.asset,
  'Choose a listed asset.',
);
chk(
  'MBTC price untouched by refusals',
  (await get('/api/pools/MBTC', ines)).body.price,
  '64000.00000000',
);

note('a drop below the warning level sends exactly one margin notice (DP-23)');
chk('pos-0002 starts with no margin notice', await noticeCount('pos-0002', 'margin'), 0);
chk('pos-0002 starts healthy', (await positionOf('pos-0002', ines)).state, 'healthy');
// 57 000 puts pos-0002 just below the 1.1000 warning level but above 1.
const warn = await post('/api/prices', { asset: 'MBTC', price: '57000' }, ines);
chk('post accepted', warn.status, 201);
chk('nothing below one yet', warn.body.positions_below_one, 0);
const warned = await positionOf('pos-0002', ines);
chk('pos-0002 is warned', warned.state, 'warned');
chk('warned has no grace end', String(warned.grace_ends_at), 'null');
chk('warned max_repay is 0', warned.max_repay, '0');
chk('exactly one margin notice', await noticeCount('pos-0002', 'margin'), 1);
chk('pos-0001 is still healthy', (await positionOf('pos-0001', ines)).state, 'healthy');
chk('pos-0001 has no notice', await noticeCount('pos-0001', 'margin'), 0);

note('positions below one enter the grace period (DP-21, DP-26)');
const at52 = await post('/api/prices', { asset: 'MBTC', price: '52000' }, ines);
chk('3 positions now below health factor 1', at52.body.positions_below_one, 3);
const queue52 = await get('/api/liquidations/queue', kestrel);
chk('queue holds those three', queue52.body.positions.length, 3);
chk(
  'queue members',
  queue52.body.positions
    .map((p) => p.position_id)
    .sort()
    .join(','),
  'pos-0002,pos-0003,pos-0004',
);
chk(
  'queue is lowest health factor first',
  Number(queue52.body.positions[0].health_factor) <=
    Number(queue52.body.positions[1].health_factor),
  true,
);
chk(
  'they are liquidatable in grace',
  queue52.body.positions.every((p) => p.state === 'liquidatable_grace'),
  true,
);
chk(
  'grace_ends_at is set in grace',
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(queue52.body.positions[0].grace_ends_at),
  true,
);
chk(
  'max_repay is 0 while in grace',
  queue52.body.positions.every((p) => p.max_repay === '0'),
  true,
);
chk('pos-0002 still has one margin notice', await noticeCount('pos-0002', 'margin'), 1);
chk('pos-0003 was armed and now has one', await noticeCount('pos-0003', 'margin'), 1);

note('liquidation is refused in grace and when healthy (DP-21)');
const duringGrace = await post(
  '/api/positions/pos-0002/liquidations',
  { repay_amount: '1000000', round: 0 },
  kestrel,
  { key: runKey('g1') },
);
chk('in_grace', duringGrace.status, 409);
chk('in_grace code', duringGrace.body.code, 'in_grace');
chk('in_grace detail', duringGrace.body.detail, 'This position is in its grace period.');
const stillHealthy = await post(
  '/api/positions/pos-0001/liquidations',
  { repay_amount: '1000000', round: 0 },
  kestrel,
  { key: runKey('g2') },
);
chk('a healthy position is not liquidatable', stillHealthy.body.code, 'not_liquidatable');
chk(
  'not_liquidatable detail',
  stillHealthy.body.detail,
  'This position is not below health factor 1.',
);

note('the grace ends on the server clock, with no request touching it (DP-23)');
const ready = await waitForState('pos-0002', ['liquidatable']);
chk('pos-0002 is liquidatable after its grace', ready.state, 'liquidatable');
chk('grace_ends_at is null outside grace', String(ready.grace_ends_at), 'null');
chk(
  'max repay is the close factor of the debt',
  ready.max_repay,
  String((BigInt(ready.debt) * 5000n) / 10000n),
);
// A state conflict outranks a field check, so these run once it is liquidatable.
chk(
  'round is required',
  (
    await post('/api/positions/pos-0002/liquidations', { repay_amount: '1' }, kestrel, {
      key: runKey('g3'),
    })
  ).body.errors.round,
  'Send the round shown for this position.',
);
chk(
  'a numeric string is not a round',
  (
    await post(
      '/api/positions/pos-0002/liquidations',
      { repay_amount: '1', round: '0' },
      kestrel,
      { key: runKey('g4') },
    )
  ).body.errors.round,
  'Send the round shown for this position.',
);

note('a liquidation fill (DP-37)');
const overMax = await post(
  '/api/positions/pos-0002/liquidations',
  { repay_amount: String(BigInt(ready.max_repay) + 1n), round: ready.round },
  kestrel,
  { key: runKey('f0') },
);
chk('above max repay -> 422', overMax.status, 422);
chk(
  'max repay message',
  /^Repay at most [\d\u202F]+,\d{6} QUSD on this fill\.$/.test(
    overMax.body.errors.repay_amount,
  ),
  true,
);

const half = BigInt(ready.max_repay) / 2n;
const fill = await post(
  '/api/positions/pos-0002/liquidations',
  { repay_amount: String(half), round: ready.round },
  kestrel,
  { key: runKey('f1') },
);
chk('fill status', fill.status, 201);
chk('fill kind', fill.body.kind, 'liquidation');
chk('fill repaid', fill.body.repaid, String(half));
chk('fill amount equals repaid', fill.body.amount, fill.body.repaid);
chk('fill asset is the debt asset', fill.body.asset, 'QUSD');
chk('round incremented', fill.body.round, ready.round + 1);
chk('borrower recorded', fill.body.borrower_id, 'br-dele');
chk(
  'prices recorded',
  `${fill.body.price_collateral}/${fill.body.price_debt}`,
  '52000.00000000/1.00000000',
);
chk('nothing written off on a partial fill', fill.body.written_off, '0');
const PC = 5200000000000n,
  PD = 100000000n,
  SC = 10n ** 8n,
  SD = 10n ** 6n;
const expectedSeized = (half * PD * SC * 10500n) / (PC * SD * 10000n);
chk('seized follows the formula', fill.body.seized, String(expectedSeized));
chk(
  'bonus is the excess over par',
  fill.body.bonus_amount,
  String(expectedSeized - (half * PD * SC) / (PC * SD)),
);
chk(
  'fill legs',
  JSON.stringify(fill.body.legs.map((l) => `${l.account} ${l.asset} ${l.amount}`)),
  JSON.stringify([
    `wallet:lq-kestrel QUSD -${half}`,
    `loan:pos-0002 QUSD ${half}`,
    `collateral:pos-0002 MBTC -${expectedSeized}`,
    `wallet:lq-kestrel MBTC ${expectedSeized}`,
  ]),
);
chk(
  'liquidator received the collateral',
  (await get('/api/wallet', kestrel)).body.balances.find((b) => b.asset === 'MBTC').amount,
  String(expectedSeized),
);
chk('exactly one liquidation notice', await noticeCount('pos-0002', 'liquidation'), 1);
const afterFill = await positionOf('pos-0002', dele);
chk(
  'a fill that leaves it below one marks it partially liquidated',
  afterFill.state,
  'partially_liquidated',
);
chk('round is now 1', afterFill.round, 1);
chk('partially liquidated publishes a max repay', BigInt(afterFill.max_repay) > 0n, true);

note('the stale round is refused (DP-43)');
const staleRound = await post(
  '/api/positions/pos-0002/liquidations',
  { repay_amount: '1000000', round: 0 },
  vane,
  { key: runKey('f2') },
);
chk('already_liquidated', staleRound.status, 409);
chk('already_liquidated code', staleRound.body.code, 'already_liquidated');
chk(
  'already_liquidated detail',
  staleRound.body.detail,
  'Already liquidated at this health factor',
);

note('two liquidators at once: exactly one fills (DP-43, DP-45)');
const racePos = await waitForState('pos-0003', ['liquidatable']);
chk('pos-0003 is liquidatable', racePos.state, 'liquidatable');
const raceAmount = String(BigInt(racePos.max_repay) / 4n);
const kestrelKey = runKey('r1');
const vaneKey = runKey('r2');
const [a, b] = await Promise.all([
  post(
    '/api/positions/pos-0003/liquidations',
    { repay_amount: raceAmount, round: racePos.round },
    kestrel,
    { key: kestrelKey },
  ),
  post(
    '/api/positions/pos-0003/liquidations',
    { repay_amount: raceAmount, round: racePos.round },
    vane,
    { key: vaneKey },
  ),
]);
const winners = [a, b].filter((r) => r.status === 201);
const losers = [a, b].filter((r) => r.status === 409);
chk('exactly one fills', winners.length, 1);
chk('the other gets the conflict', losers.length, 1);
chk('loser code', losers[0].body.code, 'already_liquidated');
chk(
  'one fill posting only',
  (await get('/api/ledger/postings?limit=200', ines)).body.postings.filter(
    (p) => p.kind === 'liquidation' && p.ref === 'pos-0003',
  ).length,
  1,
);
chk(
  'round advanced by exactly one',
  (await positionOf('pos-0003', ines)).round,
  racePos.round + 1,
);
chk(
  'exactly one liquidation notice for pos-0003',
  await noticeCount('pos-0003', 'liquidation'),
  1,
);
const winnerIsKestrel = winners[0].body.actor_id === 'lq-kestrel';
const winnerRetry = await raw('POST', '/api/positions/pos-0003/liquidations', {
  token: winnerIsKestrel ? kestrel : vane,
  body: { repay_amount: raceAmount, round: racePos.round },
  key: winnerIsKestrel ? kestrelKey : vaneKey,
});
chk(
  "the winner's retry returns the original fill",
  JSON.parse(winnerRetry.text).settlement_id,
  winners[0].body.settlement_id,
);
chk('retry marked as a replay', winnerRetry.headers.get('idempotency-replayed'), 'true');
chk(
  'still one fill posting after the retry',
  (await get('/api/ledger/postings?limit=200', ines)).body.postings.filter(
    (p) => p.kind === 'liquidation' && p.ref === 'pos-0003',
  ).length,
  1,
);

note('recovery through repayment brings it back (DP-21)');
await post(
  '/api/transfers',
  { actor_id: 'br-dele', asset: 'QUSD', amount: '40000000000' },
  ines,
);
const recovered = await post('/api/positions/pos-0002/repayments', { amount: 'all' }, dele);
chk('repay all', recovered.status, 201);
chk('no debt remains', recovered.body.debt_after, '0');
chk('back to healthy', recovered.body.state_after, 'healthy');
chk(
  'it leaves the queue',
  (await get('/api/liquidations/queue', kestrel)).body.positions.some(
    (p) => p.position_id === 'pos-0002',
  ),
  false,
);

note('exactly 60% is allowed without confirmation (DP-26)');
const exactly60 = await post('/api/prices', { asset: 'METH', price: '1280' }, ines);
chk('exactly 60% down is allowed', exactly60.status, 201);
chk('previous price recorded', exactly60.body.previous_price, '3200.00000000');
chk('source manual', exactly60.body.source, 'manual');
chk(
  'evidence key',
  exactly60.body.evidence_key,
  `evidence/prices/${exactly60.body.price_post_id}.json`,
);
chk(
  'posted_at is canonical',
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(exactly60.body.posted_at),
  true,
);

note('price history (DP-31)');
const posts = await get('/api/prices?asset=MBTC', ines);
chk('newest first', posts.body.prices[0].price, '52000.00000000');
const seedPost = posts.body.prices[posts.body.prices.length - 1];
chk('the seed post carries no evidence', seedPost.evidence_key, null);
chk(
  'the seed post is a manual post by the steward',
  `${seedPost.source}/${seedPost.posted_by}`,
  'manual/stw-ines',
);

note('trial balance after every liquidation (DP-03)');
for (const t of (await get('/api/ledger/totals', ines)).body.assets)
  chk('net ' + t.asset, t.net, '0');

note('ledger filters (DP-04)');
chk(
  'limit honoured',
  (await get('/api/ledger/postings?limit=3', ines)).body.postings.length,
  3,
);
chk('limit 0 refused', (await get('/api/ledger/postings?limit=0', ines)).status, 422);
chk('limit 201 refused', (await get('/api/ledger/postings?limit=201', ines)).status, 422);
chk(
  'bad from refused',
  (await get('/api/ledger/postings?from=nope', ines)).body.errors.from,
  'Send an RFC 3339 time with an offset.',
);
chk(
  'from without an offset refused',
  (await get('/api/ledger/postings?from=2026-11-01T00:00:00', ines)).body.errors.from,
  'Send an RFC 3339 time with an offset.',
);
chk(
  'to at or before from refused',
  (await get('/api/ledger/postings?from=2026-11-02T00:00:00Z&to=2026-11-01T00:00:00Z', ines))
    .body.errors.to,
  'End must be after start.',
);
chk(
  'an offset instant is accepted',
  (await get('/api/ledger/postings?from=2026-11-01T01:30:00-02:30', ines)).status,
  200,
);
const windowed = await get(
  '/api/ledger/postings?asset=MBTC&from=2020-01-01T00:00:00Z&limit=200',
  ines,
);
chk(
  'asset filter keeps only postings touching MBTC',
  windowed.body.postings.every((p) => p.legs.some((l) => l.asset === 'MBTC')),
  true,
);
chk(
  'accounts include supply',
  (await get('/api/ledger/accounts?asset=QUSD', ines)).body.accounts.some(
    (a) => a.account === 'supply',
  ),
  true,
);

summary();
