#!/usr/bin/env node
// Concurrency: simultaneous claims on one window; simultaneous cancels;
// simultaneous confirms; move + rival claim.
const BASE = 'http://127.0.0.1:4173';
const RUN = Math.random().toString(36).slice(2, 8);
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
  const day = (n) => {
    const [y, m, d] = k.today.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  };

  const cookies = {};
  for (const email of ['dana@brightfork.test', 'lalo@tiolalo.test', 'pearl@crumbkettle.test', 'june@saltbox.test']) {
    const r = await call('POST', '/api/session', { body: { email, password: 'tenant-pass-2026' } });
    cookies[email] = token(r.setCookie);
    await call('POST', '/api/packs', { cookie: cookies[email], key: `pack-${RUN}-${email}`, body: { hours: 10 } });
  }

  // 1. Eight simultaneous claims for the same station and span.
  const span = { stationId: 'range-1', start: `${day(2)}T09:00:00${offset}`, end: `${day(2)}T11:00:00${offset}` };
  const claims = await Promise.all([
    'dana@brightfork.test', 'lalo@tiolalo.test', 'pearl@crumbkettle.test', 'june@saltbox.test',
    'dana@brightfork.test', 'lalo@tiolalo.test', 'pearl@crumbkettle.test', 'june@saltbox.test',
  ].map((email, i) => call('POST', '/api/bookings', { cookie: cookies[email], key: `sim-${RUN}-${i}`, body: span })));
  const held = claims.filter((c) => c.status === 201);
  const taken = claims.filter((c) => c.status === 409 && c.json?.error === 'slot_taken');
  // June's certificate expires today, so her claims may answer documents_not_valid.
  const refusedForDocs = claims.filter((c) => c.status === 409 && c.json?.error === 'documents_not_valid');
  const other = claims.filter((c) => c.status !== 201 && !(c.status === 409));
  check('exactly one claim held', held.length === 1, `${held.length} held`);
  check('others slot_taken or refused by documents', held.length + taken.length + refusedForDocs.length === claims.length && other.length === 0,
    `taken=${taken.length} docs=${refusedForDocs.length} other=${JSON.stringify(other.map((o) => [o.status, o.json?.error]))}`);
  check('no 5xx under contention', claims.every((c) => c.status < 500), JSON.stringify(claims.map((c) => c.status)));

  // 2. Simultaneous confirms of one live hold all answer 200 with one debit.
  const holdId = held[0].json.id;
  const winner = held[0].json.tenantId;
  const winnerEmail = Object.entries(cookies).find(() => false) ?? null;
  void winner; void winnerEmail;
  const hold = held[0].json;
  // find whose cookie created it: claims were in order; the held one's index
  const heldIndex = claims.indexOf(held[0]);
  const order = ['dana@brightfork.test', 'lalo@tiolalo.test', 'pearl@crumbkettle.test', 'june@saltbox.test',
    'dana@brightfork.test', 'lalo@tiolalo.test', 'pearl@crumbkettle.test', 'june@saltbox.test'];
  const ownerEmail = order[heldIndex];
  const confirms = await Promise.all([0, 1, 2, 3].map(() => call('POST', `/api/bookings/${holdId}/confirm`, { cookie: cookies[ownerEmail] })));
  check('all confirms 200', confirms.every((c) => c.status === 200), JSON.stringify(confirms.map((c) => c.status)));
  const debits = new Set(confirms.map((c) => c.json?.debitedMinutes));
  check('one debit figure', debits.size === 1, JSON.stringify([...debits]));

  // 3. Simultaneous cancels of one booking: one 200, others invalid_transition.
  const cancels = await Promise.all([0, 1, 2, 3].map(() => call('POST', `/api/bookings/${holdId}/cancel`, { cookie: cookies[ownerEmail] })));
  const okCancels = cancels.filter((c) => c.status === 200);
  check('exactly one cancel 200', okCancels.length === 1, `${okCancels.length} ok`);
  check('other cancels 409', cancels.filter((c) => c.status === 409).length === 3, JSON.stringify(cancels.map((c) => c.status)));
  check('credit at most once', (okCancels[0].json?.refundedMinutes ?? 0) === 120, JSON.stringify(okCancels[0].json?.refundedMinutes));

  // 4. Move and a rival claim at the same moment: never two occupants.
  const moveSpan = { stationId: 'range-2', start: `${day(3)}T09:00:00${offset}`, end: `${day(3)}T11:00:00${offset}` };
  const first = await call('POST', '/api/bookings', { cookie: cookies['dana@brightfork.test'], key: `mc-${RUN}-1`, body: { stationId: 'range-3', start: `${day(4)}T09:00:00${offset}`, end: `${day(4)}T11:00:00${offset}` } });
  check('seed booking 201', first.status === 201, first.json?.message ?? '');
  const seedId = first.json?.id;
  await call('POST', `/api/bookings/${seedId}/confirm`, { cookie: cookies['dana@brightfork.test'] });
  const results = await Promise.all([
    call('POST', `/api/bookings/${seedId}/move`, { cookie: cookies['dana@brightfork.test'], key: `mv-${RUN}`, body: moveSpan }),
    call('POST', '/api/bookings', { cookie: cookies['lalo@tiolalo.test'], key: `rival-${RUN}`, body: { stationId: 'range-2', start: `${day(3)}T09:00:00${offset}`, end: `${day(3)}T11:00:00${offset}` } }),
  ]);
  const moveOk = results[0].status === 200;
  const rival = results[1];
  check('move and rival never both win', !(moveOk && rival.status === 201), `move=${results[0].status} rival=${rival.status}`);
  // Check the floor: at most one occupant on range-2 for that span.
  const floor = await call('GET', `/api/floor?date=${day(3)}&from=09:00&to=11:00`, { cookie: cookies['dana@brightfork.test'] });
  const range2 = floor.json?.stations?.find((s) => s.id === 'range-2');
  check('range-2 single occupant', (range2?.occupiedMinutes ?? 0) <= 120, JSON.stringify(range2).slice(100));
  // range-3 must be free if the move succeeded
  const range3 = floor.json?.stations?.find((s) => s.id === 'range-3');
  if (moveOk) {
    check('old slot freed by move', (range3?.occupiedMinutes ?? 0) === 0, JSON.stringify(range3).slice(100));
  }

  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error('CRASH', e); process.exit(1); });
