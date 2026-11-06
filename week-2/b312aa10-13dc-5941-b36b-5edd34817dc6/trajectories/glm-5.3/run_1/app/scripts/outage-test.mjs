const base = 'http://localhost:4290';
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' — ' + detail}`);
};
let jar = null;
async function call(method, path, body, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) };
  if (jar) headers.Cookie = jar;
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = response.headers.get('set-cookie');
  if (sc) jar = sc.split(';')[0];
  let data = null;
  const text = await response.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

check('health answers while dependencies are down', (await fetch(base + '/api/health')).status === 200);
let jar0 = null;
{
  const response = await fetch(base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'ada@bellobakes.example', password: 'lineboard-demo' }) });
  jar0 = (response.headers.get('set-cookie') ?? '').split(';')[0];
}
const status1 = await (await fetch(base + '/api/service-status', { headers: { Cookie: jar0 } })).json();
check('billing reported down', status1.billing === 'down', JSON.stringify(status1));
check('storage reported down', status1.storage === 'down');
check('fresh counts are zero', status1.queued.billing === 0 && status1.queued.storage === 0, JSON.stringify(status1.queued));

await call('POST', '/api/session', { email: 'ada@bellobakes.example', password: 'lineboard-demo' });
const hold = await call('POST', '/api/bookings', { stationId: 'stn_oven2', date: '2026-11-10', start: '18:00', end: '21:00' }, { headers: { 'Idempotency-Key': 'outage-hold-1' } });
check('hold works during outage', hold.status === 201);
const confirm = await call('POST', `/api/bookings/${hold.data.bookings[0].id}/confirm`, {}, { headers: { 'Idempotency-Key': 'outage-confirm-1' } });
check('confirm answers 202 pending billing', confirm.status === 202 && confirm.data.bookings[0].billingStatus === 'pending_billing', `${confirm.status} ${JSON.stringify(confirm.data.bookings?.[0]?.billingStatus)}`);
const status2 = await (await fetch(base + '/api/service-status', { headers: { Cookie: jar0 } })).json();
check('queued billing count is 1', status2.queued.billing === 1, JSON.stringify(status2.queued));

const form = new FormData();
form.append('type', 'insurance_certificate');
form.append('expiryDate', '2027-11-04');
form.append('file', new Blob([Buffer.from('%PDF-1.4 outage test')]), 'test.pdf');
const upload = await fetch(base + '/api/documents', { method: 'POST', body: form, headers: { Cookie: jar } });
check('upload refused 503 during storage outage', upload.status === 503, upload.status);
check('upload refuses with storage copy', (await upload.json()).message === 'Document storage is unavailable. Your file was not saved; try again shortly.');
// Close a month with no pending items: the 503 comes before the mismatch check.
{
  const response = await fetch(base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'ops@northside.example', password: 'lineboard-demo' }) });
  jar = (response.headers.get('set-cookie') ?? '').split(';')[0];
}
const close = await call('POST', '/api/months/2026-10/close', {});
check('month close refused 503 with billing down', close.status === 503 && close.data.error === 'billing_unavailable', `${close.status} ${JSON.stringify(close.data).slice(0, 80)}`);
// With a pending item, the pending refusal comes first.
const closePending = await call('POST', '/api/months/2026-11/close', {});
check('close with pending item refused 409 billing_pending', closePending.status === 409 && closePending.data.error === 'billing_pending', `${closePending.status}`);



await call('POST', '/api/sanitation-entries', { area: 'Prep stations', task: 'Wiped counters', sanitizerPpm: 200, initials: 'TL' });
const pdf = await call('POST', '/api/sanitation-reports', { month: '2026-11' });
check('sanitation pdf queued 202', pdf.status === 202 && pdf.data.report.status === 'queued', JSON.stringify(pdf.data));
const status3 = await (await fetch(base + '/api/service-status', { headers: { Cookie: jar0 } })).json();
check('queued storage count is 1', status3.queued.storage === 1, JSON.stringify(status3.queued));

console.log('--- bringing services back ---');
console.log(failures === 0 ? 'OUTAGE PHASE PASS' : `${failures} FAILURES`);
