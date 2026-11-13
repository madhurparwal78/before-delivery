import { chk, note, summary, get, post, raw, sessionFor, runKey } from '../scripts/apitest.mjs';

const ines = await sessionFor('stw-ines');
const rosa = await sessionFor('lp-rosa');
const sanna = await sessionFor('br-sanna');
const dele = await sessionFor('br-dele');
const kestrel = await sessionFor('lq-kestrel');
const vane = await sessionFor('lq-vane');
const petra = await sessionFor('tr-petra');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function settled(settlementId, token, want = 'stored', tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    const reply = await get(`/api/settlements/${settlementId}`, token);
    if (reply.body.statement_status === want) return reply.body;
    await sleep(500);
  }
  return (await get(`/api/settlements/${settlementId}`, token)).body;
}

note('onboarding and inbound transfers (DP-02)');
const added = await post(
  '/api/actors',
  { name: 'Hale Brightwater', email: 'hale@quillmoor.example', role: 'borrower' },
  ines,
);
chk('member added', added.status, 201);
chk('role kept', added.body.role, 'borrower');
const hale = added.body.actor_id;
const dup = await post(
  '/api/actors',
  { name: 'Other', email: 'HALE@QUILLMOOR.EXAMPLE', role: 'trader' },
  ines,
);
chk('email unique without regard to case', dup.status, 409);
chk('email_taken detail', dup.body.detail, 'A member with this email already exists.');
chk(
  'bad email refused',
  (await post('/api/actors', { name: 'X', email: 'nope', role: 'trader' }, ines)).body.errors
    .email,
  'Enter a valid email address.',
);
chk(
  'bad role refused',
  (await post('/api/actors', { name: 'X', email: 'x@y.example', role: 'wizard' }, ines)).body
    .errors.role,
  'Choose a role.',
);
chk(
  'empty name refused',
  (await post('/api/actors', { name: '', email: 'x@y.example', role: 'trader' }, ines)).body
    .errors.name,
  'Enter a name of 1 to 80 characters.',
);

const transfer = await post(
  '/api/transfers',
  { actor_id: hale, asset: 'MBTC', amount: '500000000' },
  ines,
);
chk('transfer recorded', transfer.status, 201);
chk('transfer amount', transfer.body.amount, '500000000');
const haleToken = await sessionFor(hale);
chk(
  'transfer reached the wallet',
  (await get('/api/wallet', haleToken)).body.balances.find((b) => b.asset === 'MBTC').amount,
  '500000000',
);
// Accrual postings may land between the transfer and this read, so the
// transfer is found by its kind and reference rather than by being newest.
const transferPosting = (await get('/api/ledger/postings?limit=200', ines)).body.postings.find(
  (p) => p.kind === 'transfer_in' && p.ref === hale,
);
const legs = transferPosting.legs;
chk('transfer is one balanced posting of two legs', legs.length, 2);
chk('transfer legs net to zero', BigInt(legs[0].amount) + BigInt(legs[1].amount), 0n);
chk('custody leg', legs.find((l) => l.account === 'custody').amount, '-500000000');
chk('wallet leg', legs.find((l) => l.account === `wallet:${hale}`).amount, '500000000');
chk(
  'unknown member refused',
  (await post('/api/transfers', { actor_id: 'nobody', asset: 'QUSD', amount: '1' }, ines)).body
    .errors.actor_id,
  'Choose an existing member.',
);

note('opening a position and drawing (DP-15)');
const opened = await post(
  '/api/positions',
  { collateral_asset: 'MBTC', debt_asset: 'QUSD', collateral_amount: '200000000' },
  haleToken,
);
chk('position opened', opened.status, 201);
const pid = opened.body.position_id;
chk('new id continues the series', pid, 'pos-0006');
chk('collateral locked', opened.body.collateral_amount, '200000000');
chk('no debt yet', opened.body.debt, '0');
chk('health factor null with no debt', String(opened.body.health_factor), 'null');
chk('liquidation price null with no debt', String(opened.body.liquidation_price), 'null');
chk('state healthy', opened.body.state, 'healthy');
chk(
  'wallet debited',
  (await get('/api/wallet', haleToken)).body.balances.find((b) => b.asset === 'MBTC').amount,
  '300000000',
);

// LTV: 200000000 MBTC at 64000 => $128 000; ltv 70% => max draw $89 600 => 89600000000 QUSD
const past = await post(`/api/positions/${pid}/draws`, { amount: '89600000001' }, haleToken, {
  key: runKey('d0'),
});
chk('draw past loan-to-value -> 422', past.status, 422);
chk(
  'loan-to-value message',
  past.body.errors.amount,
  'This draw would take the position past its 70,00% loan-to-value limit.',
);
const atLimit = await post(
  `/api/positions/${pid}/draws`,
  { amount: '89600000000' },
  haleToken,
  { key: runKey('d1') },
);
chk('draw exactly at the limit is allowed', atLimit.status, 201);
chk('draw settlement kind', atLimit.body.kind, 'draw');
chk('draw amount', atLimit.body.amount, '89600000000');
chk('debt after', atLimit.body.debt_after, '89600000000');
chk('health factor after', atLimit.body.health_factor_after, '1.0714');
chk('state after', atLimit.body.state_after, 'warned');
chk(
  'statement key',
  atLimit.body.statement_key,
  `statements/draw/${atLimit.body.settlement_id}.json`,
);
chk('pdf key', atLimit.body.pdf_key, `statements/draw/${atLimit.body.settlement_id}.pdf`);
chk('event id present', /^[0-9a-f-]{36}$/.test(atLimit.body.event_id), true);
const drawLegs = atLimit.body.legs.map((l) => `${l.account} ${l.amount}`);
chk(
  'draw legs',
  JSON.stringify(drawLegs),
  JSON.stringify([`loan:${pid} -89600000000`, `wallet:${hale} 89600000000`]),
);
chk(
  'wallet received the draw',
  (await get('/api/wallet', haleToken)).body.balances.find((b) => b.asset === 'QUSD').amount,
  '89600000000',
);

note('settlement finality from storage (DP-40, DP-57)');
chk('a fresh draw starts pending', atLimit.body.statement_status, 'pending_statement');
const finalDraw = await settled(atLimit.body.settlement_id, haleToken);
chk('turns Settled once the PDF is stored', finalDraw.statement_status, 'stored');
chk(
  'pdf_rendered_at set',
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(finalDraw.pdf_rendered_at),
  true,
);
const pdf = await raw('GET', `/api/settlements/${atLimit.body.settlement_id}/statement.pdf`, {
  token: haleToken,
});
chk('pdf downloads', pdf.status, 200);
chk('pdf content type', pdf.headers.get('content-type'), 'application/pdf');
chk('pdf magic', pdf.text.slice(0, 5), '%PDF-');
let webhooked = finalDraw;
for (let i = 0; i < 40 && webhooked.webhook_status !== 'delivered'; i += 1) {
  await sleep(500);
  webhooked = (await get(`/api/settlements/${atLimit.body.settlement_id}`, haleToken)).body;
}
chk('webhook delivered', webhooked.webhook_status, 'delivered');

note('retries move nothing (DP-16, DP-20)');
const replay = await post(`/api/positions/${pid}/draws`, { amount: '89600000000' }, haleToken, {
  key: runKey('d1'),
});
chk('replay status', replay.status, 201);
chk('replay header', replay.headers.get('idempotency-replayed'), 'true');
chk(
  'replay is the original receipt',
  JSON.parse(replay.text).settlement_id,
  atLimit.body.settlement_id,
);
chk(
  'debt unchanged by the replay',
  (await get(`/api/positions/${pid}`, haleToken)).body.debt >= '89600000000',
  true,
);
const postings = await get(`/api/ledger/postings?limit=200`, ines);
const draws = postings.body.postings.filter((p) => p.kind === 'draw' && p.ref === pid);
chk('exactly one draw posting', draws.length, 1);
chk(
  'accrual postings appear',
  postings.body.postings.some((p) => p.kind === 'accrual'),
  true,
);

note('repayment and collateral (DP-18)');
const overRepay = await post(
  `/api/positions/${pid}/repayments`,
  { amount: '999999999999' },
  haleToken,
);
chk('repay above the debt -> 422', overRepay.status, 422);
chk(
  'repay message names the debt',
  /^The current debt is [\d\u202F]+,\d{6} QUSD\.$/.test(overRepay.body.errors.amount),
  true,
);
const partial = await post(
  `/api/positions/${pid}/repayments`,
  { amount: '600000000' },
  haleToken,
);
chk('partial repay', partial.status, 201);
chk('debt fell', BigInt(partial.body.debt_after) < 89600000000n, true);
chk('reply carries health factor', /^\d+\.\d{4}$/.test(partial.body.health_factor_after), true);
chk('reply carries state', partial.body.state_after, 'warned');

const addColl = await post(
  `/api/positions/${pid}/collateral`,
  { amount: '100000000' },
  haleToken,
);
chk('collateral added', addColl.status, 201);
chk('collateral is now 3 MBTC', addColl.body.collateral_amount, '300000000');
chk('health factor improved', Number(addColl.body.health_factor) > 1.1, true);
chk('state back to healthy', addColl.body.state, 'healthy');

const withdrawTooMuch = await post(
  `/api/positions/${pid}/collateral-withdrawals`,
  { amount: '400000000' },
  haleToken,
);
chk('withdraw above the collateral -> 422', withdrawTooMuch.status, 422);
chk(
  'collateral message',
  withdrawTooMuch.body.errors.amount,
  'The position holds 3,00000000 MBTC.',
);
const withdrawPastLtv = await post(
  `/api/positions/${pid}/collateral-withdrawals`,
  { amount: '200000000' },
  haleToken,
);
chk('withdraw past loan-to-value -> 422', withdrawPastLtv.status, 422);
chk(
  'withdrawal message',
  withdrawPastLtv.body.errors.amount,
  'This withdrawal would take the position past its 70,00% loan-to-value limit.',
);
const withdrewSome = await post(
  `/api/positions/${pid}/collateral-withdrawals`,
  { amount: '10000000' },
  haleToken,
);
chk('small withdrawal allowed', withdrewSome.status, 201);
chk('collateral reduced', withdrewSome.body.collateral_amount, '290000000');

note('repay all clears the debt (DP-20)');
await post('/api/transfers', { actor_id: hale, asset: 'QUSD', amount: '2000000000' }, ines);
const repaidAll = await post(`/api/positions/${pid}/repayments`, { amount: 'all' }, haleToken);
chk('repay all', repaidAll.status, 201);
chk('no debt remains', repaidAll.body.debt_after, '0');
chk('health factor null', String(repaidAll.body.health_factor_after), 'null');
chk('state healthy', repaidAll.body.state_after, 'healthy');
const afterAll = await get(`/api/positions/${pid}`, haleToken);
chk('position reads no debt', afterAll.body.debt, '0');
chk('liquidation price null', String(afterAll.body.liquidation_price), 'null');

note('withdrawing all collateral of a debt-free position closes it');
const closed = await post(
  `/api/positions/${pid}/collateral-withdrawals`,
  { amount: '290000000' },
  haleToken,
);
chk('closed', closed.body.state, 'closed');
chk(
  'later writes get position_closed',
  (await post(`/api/positions/${pid}/repayments`, { amount: '1' }, haleToken)).body.code,
  'position_closed',
);
chk(
  'position_closed detail',
  (await post(`/api/positions/${pid}/collateral`, { amount: '1' }, haleToken)).body.detail,
  'This position is closed.',
);
chk(
  'closed excluded by default',
  (await get('/api/positions', ines)).body.positions.some((p) => p.position_id === pid),
  false,
);
chk(
  'closed included on request',
  (await get('/api/positions?include_closed=true', ines)).body.positions.some(
    (p) => p.position_id === pid,
  ),
  true,
);

note('liquidity supply and withdrawal (DP-06)');
const supplied = await post('/api/pools/QUSD/supplies', { amount: '1000000000' }, rosa);
chk('supplied', supplied.status, 201);
chk('shares minted', BigInt(supplied.body.shares_minted) > 0n, true);
chk('share price has 12 decimals', /^\d+\.\d{12}$/.test(supplied.body.share_price), true);
const tooBig = await post('/api/pools/QUSD/withdrawals', { amount: '99999999999999' }, rosa, {
  key: runKey('w0'),
});
chk('withdraw above share value -> 422', tooBig.status, 422);
chk(
  'share value message',
  /^Your shares are worth [\d\u202F]+,\d{6} QUSD\.$/.test(tooBig.body.errors.amount),
  true,
);
const withdrew = await post('/api/pools/QUSD/withdrawals', { amount: '500000000' }, rosa, {
  key: runKey('w1'),
});
chk('withdrawal settles', withdrew.status, 201);
chk('withdrawal kind', withdrew.body.kind, 'withdrawal');
chk('withdrawal has no position', String(withdrew.body.position_id), 'null');
chk('shares burned', BigInt(withdrew.body.shares_burned) > 0n, true);
chk('share price after', /^\d+\.\d{12}$/.test(withdrew.body.share_price_after), true);
const withdrawReplay = await post(
  '/api/pools/QUSD/withdrawals',
  { amount: '500000000' },
  rosa,
  { key: runKey('w1') },
);
chk(
  'withdrawal replay returns the original receipt',
  JSON.parse(withdrawReplay.text).settlement_id,
  withdrew.body.settlement_id,
);
chk('withdrawal replay marked', withdrawReplay.headers.get('idempotency-replayed'), 'true');
const withdrawFinal = await settled(withdrew.body.settlement_id, rosa);
chk('withdrawal reads Settled', withdrawFinal.statement_status, 'stored');

note('trial balance after every movement (DP-03)');
for (const a of (await get('/api/ledger/totals', ines)).body.assets)
  chk('net ' + a.asset, a.net, '0');

summary();
