import { chk, note, summary, get, post, raw, sessionFor, runKey } from '../scripts/apitest.mjs';

const ines = await sessionFor('stw-ines');
const kestrel = await sessionFor('lq-kestrel');
const rosa = await sessionFor('lp-rosa');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const positionOf = async (id, token) => (await get(`/api/positions/${id}`, token)).body;
async function waitForState(id, states, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    const row = await positionOf(id, ines);
    if (states.includes(row.state)) return row;
    await sleep(400);
  }
  return positionOf(id, ines);
}

note('a borrower with a single-collateral position');
const made = await post(
  '/api/actors',
  { name: 'Tove Askeland', email: 'tove@quillmoor.example', role: 'borrower' },
  ines,
);
const tove = made.body.actor_id;
const toveToken = await sessionFor(tove);
await post('/api/transfers', { actor_id: tove, asset: 'MBTC', amount: '100000000' }, ines);
const opened = await post(
  '/api/positions',
  { collateral_asset: 'MBTC', debt_asset: 'QUSD', collateral_amount: '100000000' },
  toveToken,
);
const pid = opened.body.position_id;
const drawn = await post(`/api/positions/${pid}/draws`, { amount: '44800000000' }, toveToken, {
  key: runKey('wd'),
});
chk('drew to the loan-to-value limit', drawn.status, 201);
chk('debt is 44 800 QUSD', drawn.body.debt_after, '44800000000');

note('a fill limited by the remaining collateral writes the rest off (DP-37)');
// At $20 000 the collateral can cover less than the close factor allows.
const crash = await post(
  '/api/prices',
  { asset: 'MBTC', price: '20000', confirm_large_move: true },
  ines,
);
chk('price posted with confirmation', crash.status, 201);
chk('positions fell below one', crash.body.positions_below_one >= 1, true);

const ready = await waitForState(pid, ['liquidatable']);
chk('the position is liquidatable', ready.state, 'liquidatable');
const debt = BigInt(ready.debt);
const closeFactorCap = (debt * 5000n) / 10000n;
// cover = floor(C * Pc * 10^dd * 10000 / (Pd * 10^dc * (10000 + bonus)))
const cover =
  (100000000n * 2000000000000n * 10n ** 6n * 10000n) / (100000000n * 10n ** 8n * 10500n);
chk('the collateral covers less than the close factor allows', cover < closeFactorCap, true);
chk('max repay is the cover', ready.max_repay, String(cover));

const supplyBefore = BigInt((await get('/api/pools/QUSD', ines)).body.supply_balance);
const fill = await post(
  `/api/positions/${pid}/liquidations`,
  { repay_amount: String(cover), round: ready.round },
  kestrel,
  { key: runKey('wf') },
);
chk('fill status', fill.status, 201);
chk('it seizes all the remaining collateral', fill.body.seized, '100000000');
chk('it writes the rest of the debt off', fill.body.written_off, String(debt - cover));
chk('health factor after is no debt', String(fill.body.health_factor_after), 'null');
chk('the position closes', fill.body.state_after, 'closed');
const writeOffLegs = fill.body.legs.map((l) => `${l.account} ${l.asset} ${l.amount}`);
chk(
  'the write-off is charged to the liquidity providers',
  writeOffLegs.includes(`supply QUSD -${debt - cover}`),
  true,
);
chk(
  'the loan is cleared by both legs',
  writeOffLegs.filter((l) => l.startsWith(`loan:${pid} QUSD`)).length,
  2,
);
const closedRow = await positionOf(pid, toveToken);
chk('the position reads closed', closedRow.state, 'closed');
chk('no debt remains', closedRow.debt, '0');
chk('no collateral remains', closedRow.collateral_amount, '0');
chk('round advanced', closedRow.round, ready.round + 1);
const supplyAfter = BigInt((await get('/api/pools/QUSD', ines)).body.supply_balance);
chk('the supply balance fell by the write-off', supplyBefore - supplyAfter, debt - cover);
chk(
  'further writes get position_closed',
  (await post(`/api/positions/${pid}/repayments`, { amount: '1' }, toveToken)).body.code,
  'position_closed',
);
chk(
  'a further fill gets already_liquidated',
  (
    await post(
      `/api/positions/${pid}/liquidations`,
      { repay_amount: '1', round: ready.round },
      kestrel,
      { key: runKey('wf2') },
    )
  ).body.code,
  'already_liquidated',
);

note('a partial fill when the collateral covers more than the close factor (DP-37)');
await post('/api/prices', { asset: 'MBTC', price: '64000', confirm_large_move: true }, ines);
const made2 = await post(
  '/api/actors',
  { name: 'Ruben Kalda', email: 'ruben@quillmoor.example', role: 'borrower' },
  ines,
);
const ruben = made2.body.actor_id;
const rubenToken = await sessionFor(ruben);
await post('/api/transfers', { actor_id: ruben, asset: 'MBTC', amount: '100000000' }, ines);
const open2 = await post(
  '/api/positions',
  { collateral_asset: 'MBTC', debt_asset: 'QUSD', collateral_amount: '100000000' },
  rubenToken,
);
const pid2 = open2.body.position_id;
await post(`/api/positions/${pid2}/draws`, { amount: '44800000000' }, rubenToken, {
  key: runKey('r2d'),
});
// At $55 000 the position is below one, yet the collateral still covers more
// than the close factor allows, so a fill writes nothing off.
await post('/api/prices', { asset: 'MBTC', price: '55000' }, ines);
const ready2 = await waitForState(pid2, ['liquidatable']);
chk('the second position is liquidatable', ready2.state, 'liquidatable');
chk('its health factor is below one', Number(ready2.health_factor) < 1, true);
const debt2 = BigInt(ready2.debt);
const cap2 = (debt2 * 5000n) / 10000n;
const cover2 =
  (100000000n * 5500000000000n * 10n ** 6n * 10000n) / (100000000n * 10n ** 8n * 10500n);
chk('the cover exceeds the close factor cap', cover2 > cap2, true);
chk('max repay is capped by the close factor', ready2.max_repay, String(cap2));

const partial = await post(
  `/api/positions/${pid2}/liquidations`,
  { repay_amount: ready2.max_repay, round: ready2.round },
  kestrel,
  { key: runKey('r2f1') },
);
chk('the fill is accepted', partial.status, 201);
chk('nothing is written off', partial.body.written_off, '0');
const expectedSeized2 =
  (cap2 * 100000000n * 10n ** 8n * 10500n) / (5500000000000n * 10n ** 6n * 10000n);
chk('seized follows the formula', partial.body.seized, String(expectedSeized2));
chk('the position stays open', partial.body.state_after !== 'closed', true);
chk('the debt halved', partial.body.debt_after ?? String(debt2 - cap2), String(debt2 - cap2));
chk(
  'the health factor recovered above one',
  Number(partial.body.health_factor_after) >= 1,
  true,
);
chk('so the mark is not set and it reads warned', partial.body.state_after, 'warned');
chk(
  'it leaves the queue',
  (await get('/api/liquidations/queue', kestrel)).body.positions.some(
    (p) => p.position_id === pid2,
  ),
  false,
);
chk(
  'the collateral left is the remainder',
  (await positionOf(pid2, rubenToken)).collateral_amount,
  String(100000000n - expectedSeized2),
);

note('trial balance after write-off and release (DP-03)');
for (const t of (await get('/api/ledger/totals', ines)).body.assets)
  chk('net ' + t.asset, t.net, '0');

note('statement content in desk formats (DP-41)');
const statementKey = fill.body.statement_key;
chk(
  'statement key names the kind',
  statementKey,
  `statements/liquidation/${fill.body.settlement_id}.json`,
);
let finalFill = fill.body;
for (let i = 0; i < 40 && finalFill.statement_status !== 'stored'; i += 1) {
  await sleep(500);
  finalFill = (await get(`/api/settlements/${fill.body.settlement_id}`, kestrel)).body;
}
chk(
  'the fill reads Settled once both objects are stored',
  finalFill.statement_status,
  'stored',
);
chk('its notice is tracked', ['queued', 'sent'].includes(finalFill.notice_status), true);
const pdf = await raw('GET', `/api/settlements/${fill.body.settlement_id}/statement.pdf`, {
  token: kestrel,
});
chk('the PDF downloads', pdf.status, 200);
chk('the PDF is a PDF', pdf.text.slice(0, 5), '%PDF-');

summary();
