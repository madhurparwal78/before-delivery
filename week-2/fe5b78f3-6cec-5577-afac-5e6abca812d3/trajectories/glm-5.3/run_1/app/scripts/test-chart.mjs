#!/usr/bin/env node
// Chart scenario, phase by phase, with server clock restarts between phases.
import { execSync } from 'node:child_process';

const B = 'http://localhost:4173';
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, env = {}) => execSync(cmd, { stdio: 'pipe', env: { ...process.env, ...env } });

let cookie = '';
async function api(method, path, body, opts = {}) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try { return await apiOnce(method, path, body, opts); }
    catch (e) { if (attempt === 9) throw e; await sleep(400); }
  }
  throw new Error('unreachable');
}

async function apiOnce(method, path, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) };
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(B + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.get('set-cookie');
  if (sc?.includes('pakka_session=') && !sc.includes('Max-Age=0')) cookie = sc.split(';')[0];
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
}

async function startClock(start, rate) {
  cookie = '';
  run('bash /app/scripts/start-clock.sh', { RAIL_CLOCK_START: start, RAIL_CLOCK_RATE: String(rate) });
}

const bookBody = (train, date, from, to, passengers, quota = 'GN', cls = 'SL', extra = {}) => ({
  train, run_date: date, from, to, class: cls, quota, passengers,
  keep_in_one_coach: false, lower_berth_only: false, accept: 'WL',
  contact_phone: '+919800000001', ...extra,
});
const pax = (n) => Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, age: 30, gender: 'M', berth_preference: 'NONE' }));

async function mailpitMessages() {
  try {
    const res = await fetch('http://mailpit:8025/api/v1/messages?limit=1000');
    const d = await res.json();
    return d.messages ?? [];
  } catch { return []; }
}

async function phaseA() {
  console.log('--- Phase A: fill and book before the chart');
  await startClock('2026-11-13T06:30:00', 1);
  await api('POST', '/api/session', { email: 'meera.iyer@example.test', password: 'chart-paper-01' });
  for (let i = 1; i <= 14; i++) {
    const r = await api('POST', '/api/bookings', bookBody('12951', '2026-11-13', 'MMCT', 'NDLS', pax(6)),
      { headers: { 'Idempotency-Key': `chfill-${i}` } });
    check(`fill ${i} 201`, r.status === 201, JSON.stringify(r.data).slice(0, 100));
  }
  let racPnr = '';
  for (let i = 1; i <= 4; i++) {
    const r = await api('POST', '/api/bookings', bookBody('12951', '2026-11-13', 'MMCT', 'NDLS', pax(6)),
      { headers: { 'Idempotency-Key': `racfill-${i}` } });
    check(`rac fill ${i} 201`, r.status === 201, JSON.stringify(r.data).slice(0, 100));
    if (i === 1) racPnr = r.data.pnr;
  }
  const mixed = await api('POST', '/api/bookings', bookBody('12951', '2026-11-13', 'MMCT', 'NDLS',
    [{ name: 'W One', age: 30, gender: 'M', berth_preference: 'NONE' }, { name: 'W Two', age: 30, gender: 'F', berth_preference: 'NONE' }]),
    { headers: { 'Idempotency-Key': 'chart-mixed' } });
  check('mixed WL party booked', mixed.status === 201);
  check('mixed WL 1,2', mixed.data.passengers.map((p) => p.current_status.label).join(',') === 'GNWL 1,GNWL 2',
    mixed.data.passengers.map((p) => p.current_status.label).join(','));
  const confirmed = await api('POST', '/api/bookings', bookBody('12951', '2026-11-13', 'MMCT', 'NDLS',
    [{ name: 'Rac One', age: 30, gender: 'M', berth_preference: 'NONE' }]),
    { headers: { 'Idempotency-Key': 'chart-rac' } });
  check('single WL 3 booked', confirmed.status === 201 && confirmed.data.passengers[0].current_status.label === 'GNWL 3',
    JSON.stringify(confirmed.data.passengers?.[0]?.current_status ?? confirmed.data).slice(0, 100));
  for (let i = 1; i <= 7; i++) {
    const r = await api('POST', '/api/bookings', bookBody('22477', '2026-11-14', 'JP', 'JU', pax(6)),
      { headers: { 'Idempotency-Key': `thfill-${i}` } });
    check(`thar fill ${i} 201`, r.status === 201, JSON.stringify(r.data).slice(0, 100));
  }
  const racAfter = await api('POST', '/api/bookings', bookBody('22477', '2026-11-14', 'JP', 'JU',
    [{ name: 'Rac After', age: 30, gender: 'M', berth_preference: 'NONE' }]),
    { headers: { 'Idempotency-Key': 'chart-rac-after' } });
  check('thar RAC booked', racAfter.status === 201 && racAfter.data.passengers[0].current_status.label === 'RAC 1 S1 7 SL',
    JSON.stringify(racAfter.data.passengers?.[0]?.current_status ?? racAfter.data).slice(0, 100));
  return { mixed: mixed.data.pnr, confirmed: confirmed.data.pnr, racAfter: racAfter.data.pnr, racPnr };
}

async function phaseB(pnrs) {
  console.log('--- Phase B: the chart instant on 12951 2026-11-13');
  await startClock('2026-11-13T07:20:00', 60);
  await api('POST', '/api/session', { email: 'meera.iyer@example.test', password: 'chart-paper-01' });
  let r = await api('POST', '/api/bookings', bookBody('12951', '2026-11-13', 'MMCT', 'NDLS', pax(1)),
    { headers: { 'Idempotency-Key': 'chart-refuse' } });
  check('booking refused after chart', r.status === 409 && r.data.error === 'chart_prepared', JSON.stringify(r.data));
  r = await api('GET', '/api/trains?from=MMCT&to=NDLS&date=2026-11-13&quota=GN&class=SL');
  check('CHART PREPARED label', r.data.trains[0].classes[0].label === 'CHART PREPARED');
  check('window chart_prepared', r.data.trains[0].classes[0].window === 'chart_prepared');
  check('chart_prepared true', r.data.trains[0].chart_prepared === true);

  console.log('  waiting for the chart job...');
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    r = await api('GET', `/api/bookings/${pnrs.mixed}`);
    if (r.data.tickets.some((t) => t.kind === 'chart')) break;
  }
  r = await api('GET', `/api/bookings/${pnrs.mixed}`);
  check('state chart_prepared', r.data.state === 'chart_prepared', r.data.state);
  check('version counts the chart', r.data.version === 2, `v=${r.data.version}`);
  check('waitlisted -> NOT CNF', r.data.passengers.every((p) => p.current_status.label === 'NOT CNF'),
    r.data.passengers.map((p) => p.current_status.label).join(','));
  const chartCancel = r.data.cancellations.find((c) => c.passengers[0]?.band === 'chart_full');
  check('chart cancellation entry chart_full', chartCancel !== undefined, JSON.stringify(r.data.cancellations));
  check('chart refund = full fare', chartCancel && chartCancel.refund_paise === 129000, String(chartCancel?.refund_paise));
  const refund = r.data.refunds.find((x) => x.reason === 'chart');
  check('chart refund row exists', refund !== undefined);

  r = await api('GET', `/api/bookings/${pnrs.racPnr}`);
  check('RAC passenger stays RAC', r.data.passengers[0].current_status.label.startsWith('RAC 1'), r.data.passengers[0].current_status.label);
  const chartTicketVersion = r.data.tickets.find((t) => t.kind === 'chart')?.version;
  check('chart e-ticket reserved', chartTicketVersion === 2, JSON.stringify(r.data.tickets));

  console.log('  waiting for the refund worker...');
  let issued = false;
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    r = await api('GET', `/api/bookings/${pnrs.mixed}`);
    const rf = r.data.refunds.find((x) => x.reason === 'chart');
    if (rf?.status === 'issued') { issued = true; break; }
  }
  check('chart refund issued', issued, JSON.stringify(r.data.refunds));

  const t1 = await fetch(`${B}/api/bookings/${pnrs.mixed}/tickets/1`, { headers: { Cookie: cookie } });
  check('v1 ticket downloadable', t1.status === 200);
  const v1bytes = Buffer.from(await t1.arrayBuffer());
  const chartV = r.data.tickets.map((t) => t.version).pop();
  const t2 = await fetch(`${B}/api/bookings/${pnrs.mixed}/tickets/${chartV}`, { headers: { Cookie: cookie } });
  check('chart ticket downloadable', t2.status === 200);
  check('tickets differ', !v1bytes.equals(Buffer.from(await t2.arrayBuffer())));

  console.log('  checking Mailpit...');
  let mails = [];
  for (let i = 0; i < 6; i++) {
    mails = await mailpitMessages();
    if (mails.find((m) => m.Subject === `Refund issued: PNR ${pnrs.mixed}`)) break;
    await sleep(2000);
  }
  const chartMail = mails.find((m) => m.Subject === `Chart prepared: PNR ${pnrs.racPnr}`);
  check('chart mail arrived', chartMail !== undefined, mails.map((m) => m.Subject).join(' | ').slice(0, 300));
  const refundMail = mails.find((m) => m.Subject === `Refund issued: PNR ${pnrs.mixed}`);
  check('refund mail arrived', refundMail !== undefined, mails.map((m) => m.Subject).join(' | ').slice(0, 300));
  const eTicketMails = mails.filter((m) => m.Subject.startsWith('E-ticket for PNR')).length;
  check('e-ticket mails queued', eTicketMails >= 14, String(eTicketMails));
}

async function phaseC(pnrs) {
  console.log('--- Phase C: RAC after the chart on 22477 2026-11-14 (chart 06:00, dep 14:00)');
  await startClock('2026-11-14T08:00:00', 1);
  await api('POST', '/api/session', { email: 'meera.iyer@example.test', password: 'chart-paper-01' });
  let r = await api('GET', `/api/bookings/${pnrs.racAfter}`);
  check('thar booking chart prepared', r.data.state === 'chart_prepared' && r.data.chart_prepared === true);

  r = await api('POST', `/api/bookings/${pnrs.racAfter}/cancellation-quote`, { passengers: [1] });
  check('rac_after_chart band', r.data.passengers[0].band === 'rac_after_chart', JSON.stringify(r.data.passengers[0]));
  check('charge 6000, gst 0', r.data.passengers[0].charge_paise === 6000 && r.data.passengers[0].gst_paise === 0);
  const fare = r.data.passengers[0].refund_paise + 6000;
  check('refund = fare - 60 (JP-JU 326km SL = 17000)', fare === 17000, String(fare));

  const cancel = await api('POST', `/api/bookings/${pnrs.racAfter}/cancellations`, { passengers: [1] },
    { headers: { 'Idempotency-Key': 'rac-cancel' } });
  check('cancel 201', cancel.status === 201, JSON.stringify(cancel.data).slice(0, 150));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

const pnrs = await phaseA();
await phaseB(pnrs);
await phaseC(pnrs);
