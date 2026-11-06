const base = 'http://localhost:4290';
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' — ' + detail}`);
};

let jar = null;
{
  const response = await fetch(base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'ada@bellobakes.example', password: 'lineboard-demo' }) });
  jar = (response.headers.get('set-cookie') ?? '').split(';')[0];
}
let up = false;
let seconds = 0;
for (let i = 0; i < 40; i++) {
  const status = await (await fetch(base + '/api/service-status', { headers: { Cookie: jar } })).json();
  if (status.billing === 'up' && status.storage === 'up' && status.queued.billing === 0 && status.queued.storage === 0) {
    up = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 2000));
  seconds += 2;
}
check('services recover without restart', up, `${seconds}s`);
async function call(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (jar) headers.Cookie = jar;
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = response.headers.get('set-cookie');
  if (sc) jar = sc.split(';')[0];
  return { status: response.status, data: await response.json() };
}
await call('POST', '/api/session', { email: 'ada@bellobakes.example', password: 'lineboard-demo' });
const bookings = await call('GET', '/api/bookings?month=2026-11');
const confirmed = bookings.data.bookings.find((b) => b.status === 'confirmed');
check('booking became billed', confirmed?.billingStatus === 'billed', JSON.stringify(confirmed?.billingStatus));
const invoice = await call('GET', '/api/members/mem_ada/invoices/2026-11');
check('invoice line billed', invoice.data.lines.length === 1 && invoice.data.lines[0].billingStatus === 'billed', JSON.stringify(invoice.data.lines));
jar = null;
await call('POST', '/api/session', { email: 'ops@northside.example', password: 'lineboard-demo' });
const reports = await call('GET', '/api/sanitation-reports');
check('sanitation pdf stored', (reports.data.reports ?? []).some((r) => r.month === '2026-11' && r.status === 'stored'), JSON.stringify(reports.data).slice(0, 120));
console.log(failures === 0 ? 'RECOVERY PHASE PASS' : `${failures} FAILURES`);
process.exit(failures > 0 ? 1 : 0);
