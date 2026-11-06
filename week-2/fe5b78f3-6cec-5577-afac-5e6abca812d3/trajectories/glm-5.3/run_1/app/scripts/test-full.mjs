#!/usr/bin/env node
// Full backend scenario test: fill, promote, cancel, chart, quotas, options.
import { execSync } from 'node:child_process';

const B = 'http://localhost:4173';
let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

let cookie = '';
async function api(method, path, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) };
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(B + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie?.includes('pakka_session=') && !setCookie.includes('Max-Age=0')) {
    cookie = setCookie.split(';')[0];
  }
  let data = null;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('json')) data = await res.json();
  else data = await res.text();
  return { status: res.status, data, headers: res.headers };
}

async function wipe() {
  execSync(`node /tmp/wipe.cjs`, { stdio: 'pipe' });
}

const D = '2026-11-13'; // 12951 MMCT->NDLS SL run date

async function bookParty(key, passengers, opts = {}) {
  return api('POST', '/api/bookings', {
    train: '12951', run_date: D, from: opts.from ?? 'MMCT', to: opts.to ?? 'NDLS',
    class: opts.cls ?? 'SL', quota: opts.quota ?? 'GN', passengers,
    keep_in_one_coach: opts.keep ?? false, lower_berth_only: opts.lower ?? false,
    accept: opts.accept ?? 'WL', contact_phone: opts.phone ?? '+919800000001',
  }, { headers: { 'Idempotency-Key': key } });
}

const pax = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({
  name: `P${i + 1}`, age: 30, gender: 'M', berth_preference: 'NONE', ...extra,
}));

async function main() {
  await wipe();
  console.log('--- sign in');
  let r = await api('POST', '/api/session', { email: 'meera.iyer@example.test', password: 'chart-paper-01' });
  check('sign in 200', r.status === 200);

  console.log('--- fill: 13 parties of 6 = 78 CNF');
  for (let i = 1; i <= 13; i++) {
    r = await bookParty(`fill-${i}`, pax(6));
    check(`fill-${i} 201`, r.status === 201);
  }
  r = await api('GET', `/api/trains?from=MMCT&to=NDLS&date=${D}&quota=GN&class=SL`);
  check('AVL 6 after 78', r.data.trains[0].classes[0].label === 'AVL 6 / RAC 24 / GNWL 0', r.data.trains[0].classes[0].label);

  console.log('--- one more party: 6 CNF fills the berths');
  r = await bookParty('fill-14', pax(6));
  check('fill-14 all CNF', r.data.passengers.every((p) => p.current_status.status === 'CNF'));
  r = await api('GET', `/api/trains?from=MMCT&to=NDLS&date=${D}&quota=GN&class=SL`);
  check('AVL 0 / RAC 24', r.data.trains[0].classes[0].label === 'AVL 0 / RAC 24 / GNWL 0', r.data.trains[0].classes[0].label);

  console.log('--- RAC fill: 24 RAC places, then WL');
  r = await bookParty('rac-a', pax(6, { age: 40, gender: 'F' }));
  check('rac-a RAC 1..6', r.data.passengers.map((p) => p.current_status.label).join(',') ===
    ['S1 7', 'S1 7', 'S1 15', 'S1 15', 'S1 23', 'S1 23'].map((b, i) => `RAC ${i + 1} ${b} SL`).join(','));
  for (let i = 1; i <= 3; i++) {
    r = await bookParty(`rac-${i}`, pax(6));
    check(`rac-${i} 201`, r.status === 201);
  }
  r = await api('GET', `/api/trains?from=MMCT&to=NDLS&date=${D}&quota=GN&class=SL`);
  check('RAC 0 / GNWL 0', r.data.trains[0].classes[0].label === 'AVL 0 / RAC 0 / GNWL 0', r.data.trains[0].classes[0].label);

  console.log('--- waiting list: numbered from 1');
  const wl1 = await bookParty('wl-1', pax(3));
  check('wl-1 GNWL 1,2,3', wl1.data.passengers.map((p) => p.current_status.label).join(',') === 'GNWL 1,GNWL 2,GNWL 3',
    wl1.data.passengers.map((p) => p.current_status.label).join(','));
  const wl2 = await bookParty('wl-2', pax(3));
  check('wl-2 GNWL 4,5,6', wl2.data.passengers.map((p) => p.current_status.label).join(',') === 'GNWL 4,GNWL 5,GNWL 6',
    wl2.data.passengers.map((p) => p.current_status.label).join(','));
  r = await api('GET', `/api/trains?from=MMCT&to=NDLS&date=${D}&quota=GN&class=SL`);
  check('GNWL 6', r.data.trains[0].classes[0].label === 'AVL 0 / RAC 0 / GNWL 6', r.data.trains[0].classes[0].label);

  console.log('--- availability changed: accept CNF now');
  r = await bookParty('wl-3', pax(1), { accept: 'CNF' });
  check('409 availability_changed', r.status === 409 && r.data.error === 'availability_changed', JSON.stringify(r.data).slice(0, 120));
  check('offer accept WL', r.data.offer?.accept === 'WL');
  check('offer label GNWL 7', r.data.offer?.label === 'GNWL 7', r.data.offer?.label);
  check('charged false', r.data.charged === false);

  console.log('--- book at offer (one step, accept WL)');
  const wl3 = await bookParty('wl-3b', pax(1), { accept: 'WL' });
  check('wl-3b GNWL 7', wl3.data.passengers[0].current_status.label === 'GNWL 7');

  console.log('--- party split: keep in one coach with WL passengers');
  r = await bookParty('split-1', pax(2), { keep: true });
  check('409 party_split', r.status === 409 && r.data.error === 'party_split', JSON.stringify(r.data).slice(0, 100));

  console.log('--- lower berth only: WL passengers get no berth');
  r = await bookParty('lower-1', pax(1), { lower: true, accept: 'WL' });
  check('409 no_lower_berth', r.status === 409 && r.data.error === 'no_lower_berth', JSON.stringify(r.data).slice(0, 100));

  console.log('--- waitlist cap: SL cap = floor(42*2*0.3) = 25');
  for (let i = 0; i < 3; i++) {
    r = await bookParty(`cap-${i}`, pax(6));
    check(`cap-${i} 201 WL`, r.status === 201);
  }
  r = await api('GET', `/api/trains?from=MMCT&to=NDLS&date=${D}&quota=GN&class=SL`);
  check('GNWL at cap 25 -> REGRET', r.data.trains[0].classes[0].label === 'AVL 0 / RAC 0 / REGRET', r.data.trains[0].classes[0].label);
  r = await bookParty('cap-3', pax(1));
  check('409 waitlist_full beyond cap', r.status === 409 && r.data.error === 'waitlist_full', JSON.stringify(r.data).slice(0, 120));
  r = await api('GET', `/api/trains?from=MMCT&to=NDLS&date=${D}&quota=GN&class=SL`);
  check('REGRET at cap', r.data.trains[0].classes[0].label === 'AVL 0 / RAC 0 / REGRET', r.data.trains[0].classes[0].label);

  console.log('--- promotion: cancel a CNF passenger from fill-1');
  // find fill-1's PNR: first booking made
  r = await api('GET', '/api/bookings');
  const list = r.data.bookings;
  const fill1 = list.find((b) => b.summary.startsWith('CNF') && b.summary.split(',').length === 6);
  const pnr1 = fill1.pnr;
  r = await api('POST', `/api/bookings/${pnr1}/cancellations`, { passengers: [1] }, { headers: { 'Idempotency-Key': 'cancel-1' } });
  check('cancel 201', r.status === 201, JSON.stringify(r.data).slice(0, 100));
  check('band flat 12000', r.data.cancellation.passengers[0].band === 'flat' && r.data.cancellation.passengers[0].charge_paise === 12000,
    JSON.stringify(r.data.cancellation.passengers[0]));
  const wlpnr = wl1.data.pnr;
  r = await api('GET', `/api/bookings/${wlpnr}`);
  const labels = r.data.passengers.map((p) => p.current_status.label);
  check('wl-1 p1 promoted to RAC 24 (end of queue)', labels[0] === 'RAC 24 S1 7 SL', labels.join(','));
  check('wl-1 p2,p3 renumbered GNWL 1,2', labels[1] === 'GNWL 1' && labels[2] === 'GNWL 2', labels.join(','));
  check('wl-1 version rose', r.data.version > wl1.data.version, `${wl1.data.version} -> ${r.data.version}`);
  const r2 = await api('GET', `/api/bookings/${wl2.data.pnr}`);
  const labels2 = r2.data.passengers.map((p) => p.current_status.label);
  check('wl-2 renumbered 3,4,5', labels2.join(',') === 'GNWL 3,GNWL 4,GNWL 5', labels2.join(','));

  console.log('--- status moved mail queued for wl-1 owner (own PNR)');
  // mail check later via mailpit

  console.log('--- already cancelled');
  r = await api('POST', `/api/bookings/${pnr1}/cancellations`, { passengers: [1] }, { headers: { 'Idempotency-Key': 'cancel-2' } });
  check('409 already_cancelled', r.status === 409 && r.data.error === 'already_cancelled');

  console.log('--- idempotent replay of the stored cancellation');
  r = await api('POST', `/api/bookings/${pnr1}/cancellations`, { passengers: [1] }, { headers: { 'Idempotency-Key': 'cancel-1' } });
  check('replay 201', r.status === 201);

  console.log('--- senior lower berths on a fresh 3A run');
  r = await bookParty('senior-1', [
    { name: 'Grandpa', age: 67, gender: 'M', berth_preference: 'NONE' },
    { name: 'Grandma', age: 63, gender: 'F', berth_preference: 'NONE' },
  ], { cls: '3A' });
  check('senior booking 201', r.status === 201, JSON.stringify(r.data).slice(0, 200));
  const seniorLabels = r.data.passengers.map((p) => p.current_status.label);
  check('seniors on SS berths (lower)', r.data.passengers.every((p) => {
    const cs = p.current_status;
    return cs.status === 'CNF' && ['1', '4', '9', '12', '17', '20'].includes(String(cs.berth)) && ['LB', 'SL'].includes(cs.berth_type);
  }), seniorLabels.join(','));

  console.log('--- Ladies quota for a woman');
  r = await bookParty('ladies-1', [{ name: 'Asha', age: 30, gender: 'F', berth_preference: 'NONE' }], { quota: 'LD' });
  check('ladies 201 CNF', r.status === 201 && r.data.passengers[0].current_status.status === 'CNF', JSON.stringify(r.data).slice(0, 150));
  check('ladies berth in LD pool 41-46', (() => { const b = r.data.passengers[0].current_status.berth; return b >= 41 && b <= 46; })());

  console.log('--- Ladies quota rejects a man');
  r = await bookParty('ladies-2', [{ name: 'Ravi', age: 30, gender: 'M', berth_preference: 'NONE' }], { quota: 'LD' });
  check('422 ladies gender', r.status === 422 && r.data.errors['passengers[0].gender'] === 'Ladies quota is for women travellers');

  console.log('--- Senior quota eligibility');
  r = await bookParty('senior-2', [{ name: 'Young', age: 40, gender: 'M', berth_preference: 'NONE' }], { quota: 'SS' });
  check('422 senior criteria', r.status === 422 && Object.values(r.data.errors)[0] === 'Senior quota is for passengers aged 60 or over, or women aged 45 or over');

  console.log('--- Tatkal not open');
  r = await bookParty('tq-1', pax(1), { quota: 'TQ', accept: 'CNF' });
  check('409 tatkal_not_open', r.status === 409 && r.data.error === 'tatkal_not_open' && r.data.opens_at === '2026-11-12T11:00:00+05:30',
    JSON.stringify(r.data));

  console.log('--- window not open (61 days ahead)');
  r = await api('POST', '/api/bookings', {
    train: '12951', run_date: '2027-01-30', from: 'MMCT', to: 'NDLS', class: 'SL', quota: 'GN',
    passengers: pax(1), keep_in_one_coach: false, lower_berth_only: false, accept: 'CNF',
    contact_phone: '+919800000001',
  }, { headers: { 'Idempotency-Key': 'far-1' } });
  // run date 2027-01-30 opens 2026-12-01; today is 2026-11-03 -> not open
  check('409 booking_not_open', r.status === 409 && r.data.error === 'booking_not_open' && r.data.opens_at === '2026-12-01T00:00:00+05:30',
    JSON.stringify(r.data));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
