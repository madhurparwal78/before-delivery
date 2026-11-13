// Contests across two server processes sharing one database.
const RUN = Math.random().toString(36).slice(2, 10);
const A = 'http://127.0.0.1:4173';
const B = 'http://127.0.0.1:4174';

let failures = 0;
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ok ${name}`);
  else { failures += 1; console.log(`  FAIL ${name} ${detail}`); }
};

async function session(base, actorId) {
  const res = await fetch(base + '/api/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor_id: actorId }),
  });
  return (await res.json()).token;
}

function post(base, token, path, body, key) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  if (key !== undefined) headers['Idempotency-Key'] = key;
  return fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) })
    .then(async (res) => ({
      status: res.status, body: await res.json(), replayed: res.headers.get('Idempotency-Replayed'),
    }));
}

async function get(base, token, path) {
  const res = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
}

// 1. Liquidation race through two processes.
console.log('== liquidation race across processes ==');
const stewardA = await session(A, 'stw-ines');
await post(A, stewardA, '/api/prices', { asset: 'MBTC', price: '30000', confirm_large_move: true });
await new Promise((resolve) => { setTimeout(resolve, 8000); });
const kestrel = await session(A, 'lq-kestrel');
const vane = await session(B, 'lq-vane');
const queue = await get(A, stewardA, '/api/liquidations/queue');
const target = queue.body.positions[0];
check('queue has an at-risk position', target !== undefined, JSON.stringify(queue.body.positions).slice(0, 120));
if (target !== undefined) {
  const repay = BigInt(target.max_repay) / 4n > 0n ? (BigInt(target.max_repay) / 4n).toString() : target.max_repay;
  const [r1, r2] = await Promise.all([
    post(A, kestrel, `/api/positions/${target.position_id}/liquidations`, { repay_amount: repay, round: Number(target.round) }, `kestrel-${RUN}`),
    post(B, vane, `/api/positions/${target.position_id}/liquidations`, { repay_amount: repay, round: Number(target.round) }, `vane-${RUN}`),
  ]);
  const filled = [r1, r2].filter((r) => r.status === 201);
  const conflicted = [r1, r2].filter((r) => r.status === 409 && r.body.code === 'already_liquidated');
  check('exactly one fill', filled.length === 1, `statuses ${r1.status}/${r2.status} codes ${r1.body.code}/${r2.body.code}`);
  check('the other gets already_liquidated', conflicted.length === 1, `codes ${r1.body.code}/${r2.body.code}`);
  const winner = filled[0];
  if (winner !== undefined) {
    check('winner emits one settlement event', String(winner.body.event_id ?? '') !== '');
    const replayBase = winner === r1 ? A : B;
    const replayToken = winner === r1 ? kestrel : vane;
    const replayKey = winner === r1 ? `kestrel-${RUN}` : `vane-${RUN}`;
    const replay = await post(replayBase, replayToken, `/api/positions/${target.position_id}/liquidations`, { repay_amount: repay, round: Number(target.round) }, replayKey);
    check('replay returns the original fill', replay.status === 201 && replay.replayed === 'true' && replay.body.settlement_id === winner.body.settlement_id);
  }
}

// 2. Same idempotency key against two processes.
console.log('== idempotency across processes ==');
const rosaA = await session(A, 'lp-rosa');
const first = await post(A, rosaA, '/api/pools/QUSD/withdrawals', { amount: '1000' }, `cross-${RUN}`);
check('first withdrawal on process A', first.status === 201, `status ${first.status} code ${first.body.code}`);
const second = await post(B, rosaA, '/api/pools/QUSD/withdrawals', { amount: '1000' }, `cross-${RUN}`);
check('same key on process B replays', second.status === 201 && second.replayed === 'true' && second.body.settlement_id === first.body.settlement_id, `status ${second.status} replayed ${second.replayed}`);

// 3. Concurrent draws against the QUSD pool's liquidity.
console.log('== concurrent draws across processes ==');
// Drain most of the QUSD pool so the borrowers' LTV-sized draws overflow what is left.
const rosaDrain = await session(A, 'lp-rosa');
const poolBefore = await get(A, stewardA, '/api/pools/QUSD');
const almostAll = (BigInt(poolBefore.body.available_liquidity) - 5_000_000n).toString();
const drain = await post(A, rosaDrain, '/api/pools/QUSD/withdrawals', { amount: almostAll }, `drain-${RUN}`);
check('pool drained', drain.status === 201, `status ${drain.status} code ${drain.body.code}`);
const pool = await get(A, stewardA, '/api/pools/QUSD');
const available = Number(pool.body.available_liquidity);
const plan = [];
const borrowers = ['br-sanna', 'br-dele', 'br-mara'];
for (let index = 0; index < borrowers.length; index += 1) {
  const token = await session(index % 2 === 0 ? A : B, borrowers[index]);
  // give each borrower fresh collateral so their LTV allows a large draw
  await post(A, stewardA, '/api/transfers', { actor_id: borrowers[index], asset: 'MBTC', amount: '100000000' });
  const opened = await post(index % 2 === 0 ? A : B, token, '/api/positions', {
    collateral_asset: 'MBTC', debt_asset: 'QUSD', collateral_amount: '100000000',
  });
  check(`position opened for ${borrowers[index]}`, opened.status === 201, `status ${opened.status} code ${opened.body.code}`);
  plan.push({
    position: opened.body.position_id,
    token,
    base: index % 2 === 0 ? A : B,
    key: `draw-${RUN}-${index}`,
  });
}
const half = Math.max(Math.floor(available * 0.6), 1).toString();
const draws = await Promise.all(plan.map(async (item) =>
  post(item.base, item.token, `/api/positions/${item.position}/draws`, { amount: half }, item.key)));
const okDraws = draws.filter((d) => d.status === 201);
const rejected = draws.filter((d) => d.status === 409 && d.body.code === 'insufficient_liquidity');
check('at most one draw fits', okDraws.length <= 1, `statuses: ${draws.map((d) => d.status).join(',')}`);
check('the rest get insufficient_liquidity', okDraws.length + rejected.length === draws.length, `codes: ${draws.map((d) => String(d.body.code) + ' ' + JSON.stringify(d.body.errors ?? {})).join(' | ')}`);

// 4. Oracle application exactly once per round across processes.
console.log('== oracle single application ==');
const applied = await get(A, stewardA, '/api/prices?asset=MBTC');
const rounds = applied.body.prices.filter((p) => p.source === 'oracle').map((p) => String(p.oracle_round));
check('no duplicate oracle rounds applied', new Set(rounds).size === rounds.length, `rounds: ${rounds.join(',')}`);

console.log(failures === 0 ? 'ALL CONTEST CHECKS PASSED' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
