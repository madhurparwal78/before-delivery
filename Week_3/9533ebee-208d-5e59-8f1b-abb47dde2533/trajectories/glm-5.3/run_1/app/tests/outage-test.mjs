// Outage behaviour: each service unreachable on its own instance.
const BASE = 'http://127.0.0.1:4175';

let failures = 0;
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ok ${name}`);
  else { failures += 1; console.log(`  FAIL ${name} ${detail}`); }
};

async function session(actorId) {
  const res = await fetch(BASE + '/api/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor_id: actorId }),
  });
  return (await res.json()).token;
}

async function post(token, path, body, key) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  if (key !== undefined) headers['Idempotency-Key'] = key;
  const res = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

async function get(token, path) {
  const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
}

const steward = await session('stw-ines');
const rosa = await session('lp-rosa');
const borrower = await session('br-sanna');
const trader = await session('tr-petra');
const RUN = Math.random().toString(36).slice(2, 10);

console.log('== statement store outage ==');
const draw = await post(borrower, '/api/positions/pos-0001/draws', { amount: '1000000' }, `outage-draw-${RUN}`);
check('draw refused with statement_store_unavailable', draw.status === 503 && draw.body.code === 'statement_store_unavailable', `status ${draw.status} code ${draw.body.code}`);
const withdrawal = await post(rosa, '/api/pools/QUSD/withdrawals', { amount: '1000' }, `outage-wd-${RUN}`);
check('withdrawal refused with statement_store_unavailable', withdrawal.status === 503 && withdrawal.body.code === 'statement_store_unavailable', `status ${withdrawal.status} code ${withdrawal.body.code}`);
const price = await post(steward, '/api/prices', { asset: 'MBTC', price: '63000' });
check('price post refused with statement_store_unavailable', price.status === 503 && price.body.code === 'statement_store_unavailable', `status ${price.status} code ${price.body.code}`);

const supply = await post(rosa, '/api/pools/QUSD/supplies', { amount: '1000' });
check('supply keeps working', supply.status === 201, `status ${supply.status} code ${supply.body.code}`);
const repayment = await post(borrower, '/api/positions/pos-0001/repayments', { amount: '1000' });
check('repayment keeps working', repayment.status === 201, `status ${repayment.status} code ${repayment.body.code}`);
const fund = await post(steward, '/api/transfers', { actor_id: 'br-sanna', asset: 'MBTC', amount: '2000000' });
check('transfer keeps working', fund.status === 201, `status ${fund.status} code ${fund.body.code}`);
const collateral = await post(borrower, '/api/positions/pos-0001/collateral', { amount: '1000' });
check('adding collateral keeps working', collateral.status === 201, `status ${collateral.status} code ${collateral.body.code}`);
const pools = await get(steward, '/api/pools');
check('reads keep working', pools.status === 200, `status ${pools.status}`);
await new Promise((resolve) => { setTimeout(resolve, 3000); });
const qusd = await get(steward, '/api/pools/QUSD');
// The baseline feed publishes an older round, so not_newer is the correct status here;
// evidence_unavailable only applies once a reading passes the newer checks.
check('oracle status reflects the older baseline', qusd.body.oracle_status === 'not_newer', `status ${qusd.body.oracle_status}`);

console.log(failures === 0 ? 'ALL OUTAGE CHECKS PASSED' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
