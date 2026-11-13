// Contests, database loss and several server processes.
import { chk, note, summary, get, post, sessionFor, runKey, raw } from '../scripts/apitest.mjs';

const ines = await sessionFor('stw-ines');
const rosa = await sessionFor('lp-rosa');
const tomas = await sessionFor('lp-tomas');
const sanna = await sessionFor('br-sanna');
const petra = await sessionFor('tr-petra');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SECOND_BASE = process.env['SECOND_BASE'] ?? 'http://127.0.0.1:4174';

note("the last of a pool's liquidity is served one at a time (DP-08)");
// A fresh pool with a known, small amount of liquidity.
const made = await post(
  '/api/actors',
  {
    name: 'Imre Solvang',
    email: `imre-${runKey('e')}@quillmoor.example`,
    role: 'liquidity_provider',
  },
  ines,
);
const imre = made.body.actor_id;
const imreToken = await sessionFor(imre);
await post(
  '/api/transfers',
  { actor_id: imre, asset: 'METH', amount: '2000000000000000000' },
  ines,
);
const supplied = await post(
  '/api/pools/METH/supplies',
  { amount: '2000000000000000000' },
  imreToken,
);
chk('supplied 2 METH', supplied.status, 201);

const pool = await get('/api/pools/METH', ines);
const available = BigInt(pool.body.available_liquidity);
chk('the pool reports its available liquidity', available > 0n, true);

// Two withdrawals that together ask for more than the holder's share value
// are both within liquidity, so the share-value check is what bites. Instead
// drive the contest with concurrent draws against a pool's whole liquidity.
const borrower = await post(
  '/api/actors',
  { name: 'Noor Vasquez', email: `noor-${runKey('e')}@quillmoor.example`, role: 'borrower' },
  ines,
);
const noor = borrower.body.actor_id;
const noorToken = await sessionFor(noor);
// The collateral is deliberately large, so the pool's liquidity is what
// binds rather than the loan-to-value limit.
await post('/api/transfers', { actor_id: noor, asset: 'MBTC', amount: '12000000000' }, ines);
const open1 = await post(
  '/api/positions',
  { collateral_asset: 'MBTC', debt_asset: 'METH', collateral_amount: '6000000000' },
  noorToken,
);
const open2 = await post(
  '/api/positions',
  { collateral_asset: 'MBTC', debt_asset: 'METH', collateral_amount: '6000000000' },
  noorToken,
);
chk('two positions opened', open1.status + open2.status, 402);

const methPool = await get('/api/pools/METH', ines);
const liquidity = BigInt(methPool.body.available_liquidity);
// Each draw asks for two thirds of the pool, so together they overdraw it.
const each = (liquidity * 2n) / 3n;
const [d1, d2] = await Promise.all([
  post(`/api/positions/${open1.body.position_id}/draws`, { amount: String(each) }, noorToken, {
    key: runKey('c1'),
  }),
  post(`/api/positions/${open2.body.position_id}/draws`, { amount: String(each) }, noorToken, {
    key: runKey('c2'),
  }),
]);
const filled = [d1, d2].filter((r) => r.status === 201);
const refused = [d1, d2].filter((r) => r.status === 409);
chk('one draw is served', filled.length, 1);
chk('the one that no longer fits is refused', refused.length, 1);
chk('insufficient_liquidity', refused[0].body.code, 'insufficient_liquidity');
chk(
  'the detail names the pool and what is left',
  /^Only [\d\u202F]+,\d{18} METH is available in the METH pool right now\.$/.test(
    refused[0].body.detail,
  ),
  true,
);
chk(
  'the pool never went negative',
  BigInt((await get('/api/pools/METH', ines)).body.available_liquidity) >= 0n,
  true,
);
for (const t of (await get('/api/ledger/totals', ines)).body.assets)
  chk('net ' + t.asset, t.net, '0');

note('a draw past the available liquidity is refused (DP-08)');
const tooMuch = await post(
  `/api/positions/${open2.body.position_id}/draws`,
  { amount: String(liquidity * 10n) },
  noorToken,
  { key: runKey('c3') },
);
chk('refused', tooMuch.status, 409);
chk('insufficient_liquidity', tooMuch.body.code, 'insufficient_liquidity');

note('a liquidity withdrawal past the available liquidity is refused (DP-08)');
const drained = await get('/api/pools/METH', ines);
const left = BigInt(drained.body.available_liquidity);
const holding = (await get('/api/wallet', tomas)).body.lp_holdings.find(
  (h) => h.asset === 'METH',
);
chk(
  "the provider's share value exceeds what is left in the pool",
  BigInt(holding.value) > left,
  true,
);
const overDraw = await post(
  '/api/pools/METH/withdrawals',
  { amount: String(left + 1n) },
  tomas,
  { key: runKey('c4') },
);
chk('refused', overDraw.status, 409);
chk('insufficient_liquidity', overDraw.body.code, 'insufficient_liquidity');
chk(
  'the detail names what is available',
  overDraw.body.detail.includes('METH pool right now'),
  true,
);

note('a second server process shares the same database (DP-56, DP-58)');
const health = await fetch(`${SECOND_BASE}/api/health`)
  .then((r) => r.json())
  .catch(() => null);
if (health === null) {
  console.log('     (no second process running, skipped)');
} else {
  chk('the second process is healthy', health.status, 'ok');
  const sessionOnSecond = await fetch(`${SECOND_BASE}/api/me`, {
    headers: { authorization: `Bearer ${ines}` },
  }).then((r) => r.json());
  chk(
    'a session opened on the first process is valid on the second',
    sessionOnSecond.actor_id,
    'stw-ines',
  );
  const poolsOnSecond = await fetch(`${SECOND_BASE}/api/pools`, {
    headers: { authorization: `Bearer ${ines}` },
  }).then((r) => r.json());
  const first = await get('/api/pools', ines);
  const methFirst = first.body.pools.find((p) => p.asset === 'METH');
  const methSecond = poolsOnSecond.pools.find((p) => p.asset === 'METH');
  chk(
    'both processes read the same pool figures',
    methSecond.total_borrowed,
    methFirst.total_borrowed,
  );
  chk('both read the same price', methSecond.price, methFirst.price);

  note('a replay is honoured across processes (DP-16, DP-56)');
  const key = runKey('x1');
  const firstCall = await post('/api/pools/QUSD/supplies', { amount: '1000000' }, rosa);
  chk('a supply on the first process', firstCall.status, 201);
  const w1 = await post('/api/pools/QUSD/withdrawals', { amount: '500000' }, rosa, { key });
  chk('a keyed withdrawal on the first process', w1.status, 201);
  const w2 = await fetch(`${SECOND_BASE}/api/pools/QUSD/withdrawals`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${rosa}`,
      'content-type': 'application/json',
      'idempotency-key': key,
    },
    body: JSON.stringify({ amount: '500000' }),
  });
  chk(
    'the same key on the second process replays',
    w2.headers.get('idempotency-replayed'),
    'true',
  );
  chk(
    'and returns the same settlement',
    (await w2.json()).settlement_id,
    w1.body.settlement_id,
  );

  note('a contest is settled across processes (DP-08, DP-43)');
  const poolNow = BigInt((await get('/api/pools/METH', ines)).body.available_liquidity);
  if (poolNow > 2n) {
    const share = String((poolNow * 2n) / 3n);
    const [x, y] = await Promise.all([
      post(`/api/positions/${open1.body.position_id}/draws`, { amount: share }, noorToken, {
        key: runKey('x2'),
      }),
      fetch(`${SECOND_BASE}/api/positions/${open2.body.position_id}/draws`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${noorToken}`,
          'content-type': 'application/json',
          'idempotency-key': runKey('x3'),
        },
        body: JSON.stringify({ amount: share }),
      }).then(async (r) => ({ status: r.status, body: await r.json() })),
    ]);
    const ok = [x, y].filter((r) => r.status === 201).length;
    const no = [x, y].filter((r) => r.status === 409).length;
    chk('exactly one of the two processes is served', ok, 1);
    chk('the other gets insufficient_liquidity', no, 1);
  }
  for (const t of (await get('/api/ledger/totals', ines)).body.assets)
    chk('net ' + t.asset, t.net, '0');
}

note('the ledger stays balanced after every contest (DP-03)');
for (const t of (await get('/api/ledger/totals', ines)).body.assets)
  chk('net ' + t.asset, t.net, '0');

void sanna;
void petra;
void raw;
void sleep;
void available;
summary();
