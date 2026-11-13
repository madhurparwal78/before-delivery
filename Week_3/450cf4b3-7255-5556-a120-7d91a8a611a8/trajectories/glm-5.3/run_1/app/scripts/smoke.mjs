#!/usr/bin/env node
// End-to-end smoke test against the running server.
const BASE = 'http://127.0.0.1:4173';
const RUN = Math.random().toString(36).slice(2, 8);
let failures = 0;

function check(name, cond, extra = '') {
  if (cond) console.log(`PASS ${name}`);
  else { console.log(`FAIL ${name} ${extra}`); failures++; }
}

async function call(method, path, { body, key, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  let text = '';
  try { text = await res.text(); } catch {}
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, json, headers: res.headers, setCookie, text };
}

function extractToken(setCookie) {
  if (!setCookie) return null;
  const m = /sh_session=([^;]+)/.exec(setCookie);
  return m ? `sh_session=${m[1]}` : null;
}

async function main() {
  // 1. kitchen
  let r = await call('GET', '/api/kitchen');
  check('kitchen 200', r.status === 200, r.text);
  const kitchen = r.json;

  // 2. sign in as owner
  r = await call('POST', '/api/session', { body: { email: 'owner@stationhouse.test', password: 'owner-pass-2026' } });
  check('owner sign-in 200', r.status === 200, r.text);
  const ownerCookie = extractToken(r.setCookie);

  // 3. owner lists tenants
  r = await call('GET', '/api/tenants', { cookie: ownerCookie });
  check('tenants 200', r.status === 200, r.text);
  check('7 seed tenants', r.json?.tenants?.length === 7, `got ${r.json?.tenants?.length}`);
  const dana = r.json.tenants.find((t) => t.businessName === 'Bright Fork Catering');
  const night = r.json.tenants.find((t) => t.businessName === 'Night Market Dumplings');
  check('dana approved', dana?.status === 'approved');
  check('night suspended', night?.status === 'suspended');

  // 4. sign in as dana (tenant)
  r = await call('POST', '/api/session', { body: { email: 'dana@brightfork.test', password: 'tenant-pass-2026' } });
  check('tenant sign-in 200', r.status === 200, r.text);
  const danaCookie = extractToken(r.setCookie);

  // 5. floor read
  r = await call('GET', `/api/floor?date=${kitchen.today}&from=09:00&to=12:00`, { cookie: danaCookie });
  check('floor 200', r.status === 200, r.text);
  check('floor stations 10', r.json?.stations?.length === 10, `got ${r.json?.stations?.length}`);
  check('coolerFree 36', r.json?.coolerFree?.length === 36, `got ${r.json?.coolerFree?.length}`);
  check('spanStatus open', r.json?.spanStatus === 'open', r.json?.spanStatus);
  const range1 = r.json.stations.find((s) => s.id === 'range-1');
  check('range-1 metrics', range1 && range1.freeMinutes === 180 && range1.occupiedMinutes === 0, JSON.stringify(range1));

  // 6. dana has no packs -> claim must refuse insufficient_hours
  // Requests must carry an explicit offset; the kitchen answers one in /api/kitchen.now.
  const nowIso = kitchen.now;
  const offset = nowIso.slice(-6);
  const [y, m, d] = kitchen.today.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  const bookDate = tomorrow;
  const startIso = `${bookDate}T09:00:00${offset}`;
  const endIso = `${bookDate}T12:00:00${offset}`;
  r = await call('POST', '/api/bookings', { cookie: danaCookie, key: `claim-1-${RUN}`, body: { stationId: 'range-1', start: startIso, end: endIso } });
  check('claim refused insufficient_hours', r.status === 409 && r.json?.error === 'insufficient_hours', r.text);

  // 7. buy a 10-hour pack (no password needed)
  r = await call('POST', '/api/packs', { cookie: danaCookie, key: `buy-1-${RUN}`, body: { hours: 10 } });
  check('pack purchase 201', r.status === 201, r.text);
  check('pack balance 600', r.json?.balanceMinutes === 600, r.text);
  const packId = r.json?.id;

  // 7b. replay the same purchase
  r = await call('POST', '/api/packs', { cookie: danaCookie, key: `buy-1-${RUN}`, body: { hours: 10 } });
  check('purchase replay 201 + header', r.status === 201 && r.headers.get('idempotent-replay') === 'true', r.text);

  // 7c. same key different body -> conflict
  r = await call('POST', '/api/packs', { cookie: danaCookie, key: `buy-1-${RUN}`, body: { hours: 20 } });
  check('purchase conflict 409', r.status === 409 && r.json?.error === 'idempotency_conflict', r.text);

  // 8. claim now works
  r = await call('POST', '/api/bookings', { cookie: danaCookie, key: `claim-2-${RUN}`, body: { stationId: 'range-1', start: startIso, end: endIso } });
  check('claim 201 held', r.status === 201 && r.json?.status === 'held', r.text);
  const bookingId = r.json?.id;
  check('booking pack reserved', r.json?.packId === packId, r.text);

  // 8b. pack now shows hold
  r = await call('GET', '/api/packs', { cookie: danaCookie });
  const pack = r.json?.packs?.[0];
  check('heldMinutes 180', pack?.heldMinutes === 180, JSON.stringify(pack));

  // 8c. overlapping claim by another tenant on the same station -> slot_taken
  r = await call('POST', '/api/session', { body: { email: 'lalo@tiolalo.test', password: 'tenant-pass-2026' } });
  const laloCookie = extractToken(r.setCookie);
  await call('POST', '/api/packs', { cookie: laloCookie, key: `buy-lalo-${RUN}`, body: { hours: 10 } });
  r = await call('POST', '/api/bookings', { cookie: laloCookie, key: `claim-lalo-${RUN}`, body: { stationId: 'range-1', start: startIso, end: endIso } });
  check('overlap slot_taken', r.status === 409 && r.json?.error === 'slot_taken', r.text);

  // 8d. paired claim with shelf
  r = await call('POST', '/api/bookings', { cookie: laloCookie, key: `claim-lalo2-${RUN}`, body: { stationId: 'prep-a', start: startIso, end: endIso, shelfId: 'shelf-1' } });
  check('paired claim 201', r.status === 201 && r.json?.shelfId === 'shelf-1', r.text);
  const laloBookingId = r.json?.id;

  // 9. confirm dana's booking
  r = await call('POST', `/api/bookings/${bookingId}/confirm`, { cookie: danaCookie });
  check('confirm 200 confirmed', r.status === 200 && r.json?.status === 'confirmed', r.text);
  check('debited 180', r.json?.debitedMinutes === 180, r.text);
  check('confirmation email queued', r.json?.emails?.length === 1 && r.json.emails[0].status === 'queued', r.text);
  check('movable true', r.json?.movable === true, r.text);

  // 9b. double confirm still 200, no second debit
  r = await call('POST', `/api/bookings/${bookingId}/confirm`, { cookie: danaCookie });
  check('second confirm 200', r.status === 200 && r.json?.debitedMinutes === 180, r.text);

  // 9c. balance now 420, held 0
  r = await call('GET', '/api/packs', { cookie: danaCookie });
  check('balance 420', r.json?.packs?.[0]?.balanceMinutes === 420, JSON.stringify(r.json?.packs?.[0]));

  // 10. ledger integrity
  r = await call('GET', `/api/packs/${packId}`, { cookie: danaCookie });
  const entries = r.json?.entries ?? [];
  const packSide = entries.filter((e) => e.side === 'pack').reduce((a, e) => a + e.minutes, 0);
  check('ledger balance equals sum', packSide === r.json.balanceMinutes, `${packSide} vs ${r.json.balanceMinutes}`);
  check('purchase + booking entries', entries.some((e) => e.movement === 'purchase') && entries.some((e) => e.movement === 'booking_debit'), r.text);

  // 11. move the booking
  r = await call('POST', `/api/bookings/${bookingId}/move`, { cookie: danaCookie, key: `move-1-${RUN}`, body: { stationId: 'range-2', start: startIso, end: endIso } });
  check('move 200', r.status === 200 && r.json?.stationId === 'range-2', r.text);
  check('move email queued', r.json?.emails?.length === 2, r.text);

  // 11b. second move refused
  r = await call('POST', `/api/bookings/${bookingId}/move`, { cookie: danaCookie, key: `move-2-${RUN}`, body: { stationId: 'range-1', start: startIso, end: endIso } });
  check('second move refused', r.status === 409 || (r.status === 422 && r.json?.fields?.start), r.text);

  // 11c. lalo confirms the paired booking so the report counts it
  r = await call('POST', `/api/bookings/${laloBookingId}/confirm`, { cookie: laloCookie });
  check('lalo paired confirm 200', r.status === 200 && r.json?.status === 'confirmed', r.text);

  // 12. door list as lead
  r = await call('POST', '/api/session', { body: { email: 'lead@stationhouse.test', password: 'lead-pass-2026' } });
  const leadCookie = extractToken(r.setCookie);
  r = await call('GET', `/api/door?date=${bookDate}`, { cookie: leadCookie });
  check('door 200', r.status === 200, r.text);
  const doorEntry = r.json?.entries?.find((e) => e.bookingId === bookingId);
  check('door entry present', doorEntry !== undefined, r.text);
  const laloEntry = r.json?.entries?.find((e) => e.tenantName === "Tío Lalo's Tacos");
  check('lalo cleared', laloEntry?.cleared === true, JSON.stringify(laloEntry));

  // 13. role table
  r = await call('POST', '/api/packs', { cookie: leadCookie, key: `lead-buy-${RUN}`, body: { hours: 10 } });
  check('lead pack 403', r.status === 403, r.text);
  r = await call('POST', `/api/bookings/${bookingId}/check-in`, { cookie: danaCookie });
  check('tenant check-in 403', r.status === 403, r.text);
  r = await call('GET', `/api/packs/${packId}`, { cookie: leadCookie });
  check('lead real pack 403', r.status === 403, r.text);
  r = await call('GET', '/api/packs/00000000-0000-0000-0000-000000000000', { cookie: leadCookie });
  check('lead unknown pack 404', r.status === 404, r.text);
  r = await call('GET', `/api/bookings/${laloEntry?.bookingId ?? 'x'}`, { cookie: danaCookie });
  check('other tenant booking 404', r.status === 404, r.text);

  // 14. reauth for 20-hour pack
  r = await call('POST', '/api/packs', { cookie: danaCookie, key: `buy-20-${RUN}`, body: { hours: 20 } });
  check('reauth required 403', r.status === 403 && r.json?.error === 'reauth_required', r.text);
  r = await call('POST', '/api/session/confirm', { cookie: danaCookie, body: { password: 'tenant-pass-2026' } });
  check('confirm password 204', r.status === 204, r.text);
  r = await call('POST', '/api/packs', { cookie: danaCookie, key: `buy-20-${RUN}`, body: { hours: 20 } });
  check('20-pack purchase 201', r.status === 201 && r.json?.balanceMinutes === 1200, r.text);

  // 15. report
  r = await call('GET', `/api/reports/daily?date=${bookDate}`, { cookie: ownerCookie });
  check('report 200', r.status === 200, r.text);
  check('report total 540', r.json?.totalBookedMinutes === 540, `got ${r.json?.totalBookedMinutes}`);
  check('report stations 10', r.json?.stations?.length === 10, r.text);
  const range2 = r.json?.stations?.find((s) => s.stationId === 'range-2');
  check('range-2 180 min', range2?.bookedMinutes === 180, JSON.stringify(range2));

  // 16. cancel then refund
  r = await call('POST', `/api/bookings/${bookingId}/cancel`, { cookie: danaCookie });
  check('cancel 200', r.status === 200 && r.json?.status === 'cancelled', r.text);
  check('credit 180 returned', r.json?.refundedMinutes === 180, r.text);

  r = await call('POST', '/api/session/confirm', { cookie: ownerCookie, body: { password: 'owner-pass-2026' } });
  check('owner confirm 204', r.status === 204, r.text);
  r = await call('GET', `/api/packs/${packId}`, { cookie: ownerCookie });
  const refundable = r.json?.refundableCents;
  check('refundable 26000', refundable === 26000, `got ${refundable}`);
  r = await call('POST', `/api/packs/${packId}/refund`, { cookie: ownerCookie, body: { expectedCents: refundable } });
  check('refund 200', r.status === 200 && r.json?.status === 'refunded', r.text);
  check('refundedCents 26000', r.json?.refundedCents === 26000, r.text);
  check('balance 0', r.json?.balanceMinutes === 0, r.text);
  r = await call('POST', `/api/packs/${packId}/refund`, { cookie: ownerCookie, body: { expectedCents: 999 } });
  check('double refund 409', r.status === 409, r.text);

  // 17. sign-in limit
  for (let i = 0; i < 5; i++) {
    await call('POST', '/api/session', { body: { email: 'sam@copperpot.test', password: 'wrong-password-1' } });
  }
  r = await call('POST', '/api/session', { body: { email: 'sam@copperpot.test', password: 'tenant-pass-2026' } });
  check('sign-in limit 429', r.status === 429 && r.headers.get('retry-after') !== null, `${r.status} ${r.text}`);

  // 18. cross-origin refused
  const res2 = await fetch(BASE + '/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://evil.test' },
    body: JSON.stringify({ email: 'x', password: 'y' }),
  });
  check('cross origin 403', res2.status === 403 && (await res2.json()).error === 'cross_origin');

  // 19. security headers on app page
  const page = await fetch(BASE + '/board');
  check('page 200', page.status === 200);
  check('page CSP', (page.headers.get('content-security-policy') ?? '').includes("default-src 'self'"));
  check('page nosniff', page.headers.get('x-content-type-options') === 'nosniff');

  // 20. 404 for source files
  const src = await fetch(BASE + '/package.json');
  check('package.json 404', src.status === 404);
  const envFile = await fetch(BASE + '/.env');
  check('.env 404', envFile.status === 404);

  // 21. unauthenticated
  r = await call('GET', '/api/packs');
  check('unauthenticated 401', r.status === 401 && r.json?.error === 'unauthenticated', r.text);

  // 22. wait for mail delivery then check receipt email sent
  console.log('  waiting 35s for mail delivery...');
  await new Promise((res) => setTimeout(res, 35_000));
  r = await call('GET', '/api/packs', { cookie: danaCookie });
  const sentPack = r.json?.packs?.find((p) => p.hours === 10);
  const twentyPack = r.json?.packs?.find((p) => p.hours === 20);
  check('10-pack receipt sent', sentPack?.receiptEmail?.status === 'sent', JSON.stringify(sentPack?.receiptEmail));
  check('20-pack receipt sent', twentyPack?.receiptEmail?.status === 'sent', JSON.stringify(twentyPack?.receiptEmail));

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('CRASH', e); process.exit(1); });
