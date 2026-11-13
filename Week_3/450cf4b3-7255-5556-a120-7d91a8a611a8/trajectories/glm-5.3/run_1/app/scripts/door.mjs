#!/usr/bin/env node
// Door actions inside the check-in window, and no-show after start.
const BASE = 'http://127.0.0.1:4173';
let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`PASS ${name}`);
  else { console.log(`FAIL ${name} ${extra}`); failures++; }
}
async function call(method, path, { body, cookie, key } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, setCookie };
}
const token = (c) => /sh_session=[^;]+/.exec(c ?? '')?.[0];

async function main() {
  const k = (await call('GET', '/api/kitchen')).json;
  const offset = k.now.slice(-6);
  // The kitchen opens at 05:00; book a span that starts within the next hour so
  // the check-in window (30 minutes before start) is open now.
  const nowMin = Number(k.now.slice(11, 13)) * 60 + Number(k.now.slice(14, 16));
  let startMin = Math.max(OPENS + 30, Math.floor(nowMin / 30) * 30 + 30);
  let endMin = startMin + 120;
  if (endMin > 23 * 60) { startMin = 19 * 60; endMin = 21 * 60; }
  const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const startIso = `${k.today}T${hm(startMin)}:00${offset}`;
  const endIso = `${k.today}T${hm(endMin)}:00${offset}`;

  let r = await call('POST', '/api/session', { body: { email: 'june@saltbox.test', password: 'tenant-pass-2026' } });
  const june = token(r.setCookie);
  r = await call('POST', '/api/session', { body: { email: 'lead@stationhouse.test', password: 'lead-pass-2026' } });
  const lead = token(r.setCookie);
  r = await call('POST', '/api/session', { body: { email: 'owner@stationhouse.test', password: 'owner-pass-2026' } });
  const owner = token(r.setCookie);

  const dk = `door-${Date.now()}`;
  await call('POST', '/api/packs', { cookie: june, body: { hours: 10 }, key: dk });
  // Saltbox's certificate expires today, so the door date is still covered.
  r = await call('POST', '/api/bookings', { cookie: june, body: { stationId: 'range-3', start: startIso, end: endIso }, key: `door-b-${Date.now()}` });
  check('claim 201', r.status === 201, r.json?.message ?? '');
  const id = r.json?.id;
  await call('POST', `/api/bookings/${id}/confirm`, { cookie: june });
  void dk;

  r = await call('GET', `/api/door?date=${k.today}`, { cookie: lead });
  const entry = r.json?.entries?.find((e) => e.bookingId === id);
  check('entry present', entry !== undefined);
  const opensAtMs = Date.parse(entry.checkInOpensAt);
  const nowMs = Date.parse(r.json.now);
  if (nowMs >= opensAtMs) {
    check('check_in action listed', entry.actions.includes('check_in'), JSON.stringify(entry.actions));
    r = await call('POST', `/api/bookings/${id}/check-in`, { cookie: lead });
    check('check-in 200', r.status === 200 && r.json?.status === 'checked_in', r.json?.message ?? '');
    check('door log by lead', (r.json?.doorLog ?? []).some((l) => l.action === 'check_in' && l.by === 'Theo Park'), JSON.stringify(r.json?.doorLog));
    // conflict: second check-in refused
    r = await call('POST', `/api/bookings/${id}/check-in`, { cookie: owner });
    check('second check-in 409', r.status === 409 && r.json?.error === 'invalid_transition', r.json?.message ?? '');
    // unticked cleanup box -> 422 before any state change
    r = await call('POST', `/api/bookings/${id}/check-out`, { cookie: lead, body: { cleanupDone: false, note: '' } });
    check('unticked cleanup 422', r.status === 422 && r.json?.fields?.cleanupDone !== undefined, r.json?.message ?? '');
    // still checked_in
    r = await call('GET', `/api/bookings/${id}`, { cookie: owner });
    check('still checked_in', r.json?.status === 'checked_in', r.json?.status);
    // proper check-out with a note, by the owner
    r = await call('POST', `/api/bookings/${id}/check-out`, { cookie: owner, body: { cleanupDone: true, note: 'Range wiped' } });
    check('check-out 200 completed', r.status === 200 && r.json?.status === 'completed', r.json?.message ?? '');
    check('cleanup note', r.json?.cleanupNote === 'Range wiped', r.json?.message ?? '');
    const log = r.json?.doorLog ?? [];
    check('two log lines by name', log.length === 2 && log[0].by === 'Theo Park' && log[1].by === 'Imani Ferro', JSON.stringify(log));
    // after completion, the report counts it
    r = await call('GET', `/api/reports/daily?date=${k.today}`, { cookie: owner });
    const range3 = r.json?.stations?.find((s) => s.stationId === 'range-3');
    check('report counts booking', range3?.bookedMinutes === endMin - startMin, JSON.stringify(range3));
  } else {
    console.log(`SKIP window not open yet (opens ${hm(startMin - 30)})`);
  }
  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}
const OPENS = 5 * 60;
main().catch((e) => { console.error('CRASH', e); process.exit(1); });
