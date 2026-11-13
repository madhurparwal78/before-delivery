#!/usr/bin/env node
// Journey tests: door actions, approve, upload, hold expiry.
const BASE = 'http://127.0.0.1:4173';
const RUN = Math.random().toString(36).slice(2, 8);
let failures = 0;

function check(name, cond, extra = '') {
  if (cond) console.log(`PASS ${name}`);
  else { console.log(`FAIL ${name} ${extra}`); failures++; }
}

async function call(method, path, { body, key, cookie, form } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const setCookie = res.headers.get('set-cookie');
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, headers: res.headers, setCookie };
}

function token(setCookie) {
  const m = /sh_session=([^;]+)/.exec(setCookie ?? '');
  return m ? `sh_session=${m[1]}` : null;
}

function multipart(fields, fileBytes) {
  const boundary = `----stationhouse${RUN}`;
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  }
  const buffers = [];
  if (fileBytes) {
    buffers.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cert.pdf"\r\nContent-Type: application/pdf\r\n\r\n`, 'utf8'));
    buffers.push(Buffer.from(fileBytes));
    buffers.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));
  } else {
    for (const [name, value] of Object.entries(fields)) {
      buffers.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'));
    }
    buffers.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
    return Buffer.concat(buffers);
  }
  for (const [name, value] of Object.entries(fields)) {
    buffers.unshift(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'));
  }
  return Buffer.concat(buffers);
}

async function main() {
  let r = await call('GET', '/api/kitchen');
  const kitchen = r.json;
  const offset = kitchen.now.slice(-6);
  const [y, m, d] = kitchen.today.split('-').map(Number);
  const today = kitchen.today;
  const dayFrom = (n) => new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);

  // owner + lead
  r = await call('POST', '/api/session', { body: { email: 'owner@stationhouse.test', password: 'owner-pass-2026' } });
  const owner = token(r.setCookie);
  r = await call('POST', '/api/session', { body: { email: 'lead@stationhouse.test', password: 'lead-pass-2026' } });
  const lead = token(r.setCookie);

  // pearl buys a pack and books TODAY so the door window opens soon
  r = await call('POST', '/api/session', { body: { email: 'pearl@crumbkettle.test', password: 'tenant-pass-2026' } });
  const pearl = token(r.setCookie);
  await call('POST', '/api/packs', { cookie: pearl, key: `jp-${RUN}`, body: { hours: 10 } });

  // book today 23:00 back to 21:00? Operating hours end 23:00; book 20:00-22:00 today.
  const startIso = `${today}T20:00:00${offset}`;
  const endIso = `${today}T22:00:00${offset}`;
  r = await call('POST', '/api/bookings', { cookie: pearl, key: `jb-${RUN}`, body: { stationId: 'range-3', start: startIso, end: endIso } });
  check('pearl claim 201', r.status === 201, r.json?.message ?? '');
  const bookingId = r.json?.id;
  r = await call('POST', `/api/bookings/${bookingId}/confirm`, { cookie: pearl });
  check('pearl confirm 200', r.status === 200, r.json?.message ?? '');

  // door list for today shows the entry with actions
  r = await call('GET', `/api/door?date=${today}`, { cookie: lead });
  const entry = r.json?.entries?.find((e) => e.bookingId === bookingId);
  check('door entry', entry !== undefined, JSON.stringify(r.json?.entries?.map((e) => e.bookingId)));
  check('door cleared', entry?.cleared === true, JSON.stringify(entry));
  const opensAt = new Date(entry.checkInOpensAt).getTime();
  const nowMs = Date.parse(r.json.now);
  if (nowMs < opensAt) {
    check('no check_in action yet', entry.actions.includes('check_in') === false, JSON.stringify(entry.actions));
    // wait for the window to open (up to 30 min is too long; instead mark no-show test uses a span that already started)
  } else {
    // check-in inside the window
    r = await call('POST', `/api/bookings/${bookingId}/check-in`, { cookie: lead });
    check('check-in 200', r.status === 200 && r.json?.status === 'checked_in', r.json?.message ?? '');
    const log = r.json?.doorLog ?? [];
    check('door log check_in', log.some((l) => l.action === 'check_in' && l.by === 'Theo Park'), JSON.stringify(log));
    // owner also tries -> 409 invalid_transition
    r = await call('POST', `/api/bookings/${bookingId}/check-in`, { cookie: owner });
    check('second check-in 409', r.status === 409 && r.json?.error === 'invalid_transition', r.json?.message ?? '');
    // check out without cleanupDone -> 422
    r = await call('POST', `/api/bookings/${bookingId}/check-out`, { cookie: lead, body: { cleanupDone: false, note: '' } });
    check('checkout unticked 422', r.status === 422 && r.json?.fields?.cleanupDone !== undefined, r.json?.message ?? '');
    // check out properly
    r = await call('POST', `/api/bookings/${bookingId}/check-out`, { cookie: owner, body: { cleanupDone: true, note: 'Wiped the range' } });
    check('checkout 200 completed', r.status === 200 && r.json?.status === 'completed', r.json?.message ?? '');
    check('cleanup note kept', r.json?.cleanupNote === 'Wiped the range', r.json?.message ?? '');
    const log2 = r.json?.doorLog ?? [];
    check('two log lines', log2.length === 2 && log2[1].by === 'Imani Ferro', JSON.stringify(log2));
  }

  // no-show: book a span that has started and is confirmed, then mark no-show (before end)
  // A short booking today 05:00-05:30 might already be past its end; use a span ending later.
  // Simplest: book today 21:30-23:00, mark no-show after start only if now >= start. Skip if not.
  const nsStart = `${today}T21:30:00${offset}`;
  const nsEnd = `${today}T23:00:00${offset}`;
  r = await call('POST', '/api/bookings', { cookie: pearl, key: `ns-${RUN}`, body: { stationId: 'mixer-60', start: nsStart, end: nsEnd } });
  if (r.status === 201) {
    const nsId = r.json.id;
    await call('POST', `/api/bookings/${nsId}/confirm`, { cookie: pearl });
    const nowMs2 = Date.now();
    const startMs = Date.parse(`${nsStart}`);
    if (nowMs2 >= startMs) {
      r = await call('POST', `/api/bookings/${nsId}/no-show`, { cookie: lead });
      check('no-show 200', r.status === 200 && r.json?.status === 'no_show', r.json?.message ?? '');
    } else {
      r = await call('POST', `/api/bookings/${nsId}/no-show`, { cookie: lead });
      check('no-show too early 409', r.status === 409 && r.json?.error === 'too_early', r.json?.message ?? '');
    }
  }

  // ---- approve journey: Copper Pot Jams is documents_pending ----
  r = await call('GET', '/api/tenants', { cookie: owner });
  const copper = r.json.tenants.find((t) => t.businessName === 'Copper Pot Jams');
  check('copper pending', copper?.status === 'documents_pending', copper?.status);
  r = await call('POST', `/api/tenants/${copper.id}/approve`, { cookie: owner });
  check('approve 200', r.status === 200 && r.json?.status === 'approved', r.json?.message ?? '');
  // approve again -> 409 invalid_transition
  r = await call('POST', `/api/tenants/${copper.id}/approve`, { cookie: owner });
  check('second approve 409', r.status === 409, r.json?.message ?? '');

  // ---- upload journey: Fennel & Fig is applied ----
  r = await call('POST', '/api/session', { body: { email: 'ari@fennelfig.test', password: 'tenant-pass-2026' } });
  const ari = token(r.setCookie);
  r = await call('GET', '/api/documents', { cookie: ari });
  check('ari no docs', r.json?.documents?.length === 0, JSON.stringify(r.json?.documents?.length));

  // upload a fake PDF certificate (insurance)
  const pdfBytes = Buffer.from('%PDF-1.4\n% fake certificate for testing\n' + 'x'.repeat(100));
  const form = multipart({
    kind: 'insurance_certificate',
    expiresOn: dayFrom(90),
    perOccurrenceLimit: '1000000',
    additionalInsured: 'true',
  }, pdfBytes);
  const res = await fetch(`${BASE}/api/documents`, {
    method: 'POST',
    headers: { Cookie: ari, 'Content-Type': 'multipart/form-data; boundary=----stationhouse' + RUN },
    body: form,
  });
  const docJson = await res.json();
  check('upload 201', res.status === 201, JSON.stringify(docJson).slice(200));
  check('upload sha256', docJson.sha256?.length === 64 && docJson.hasFile === true, JSON.stringify(docJson).slice(100));
  check('cover ok', docJson.coverState === 'ok', docJson.coverState);

  // auto transition applied -> documents_pending needs both kinds; food handler still missing
  r = await call('GET', '/api/me', { cookie: ari });
  check('ari still applied', r.json?.tenant?.status === 'applied', r.json?.tenant?.status);

  // upload food handler card as JPEG
  const jpg = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.from('jpeg-ish data'.repeat(10))]);
  const form2 = multipart({ kind: 'food_handler_card', expiresOn: dayFrom(90) }, jpg);
  const res2 = await fetch(`${BASE}/api/documents`, {
    method: 'POST',
    headers: { Cookie: ari, 'Content-Type': 'multipart/form-data; boundary=----stationhouse' + RUN },
    body: form2,
  });
  const docJson2 = await res2.json();
  check('card upload 201', res2.status === 201, JSON.stringify(docJson2).slice(150));
  check('card is jpeg', docJson2.contentType === 'image/jpeg', docJson2.contentType);

  // now status flips to documents_pending automatically
  r = await call('GET', '/api/me', { cookie: ari });
  check('ari documents_pending', r.json?.tenant?.status === 'documents_pending', r.json?.tenant?.status);

  // owner sees both documents with fingerprints
  r = await call('GET', '/api/tenants', { cookie: owner });
  const ariTenant = r.json.tenants.find((t) => t.businessName === 'Fennel & Fig');
  r = await call('GET', `/api/tenants/${ariTenant.id}`, { cookie: owner });
  const docs = r.json?.documents ?? [];
  check('owner sees 2 docs', docs.length === 2, JSON.stringify(docs.length));

  // file read returns the exact bytes
  const fileRes = await fetch(`${BASE}/api/documents/${docJson.id}/file`, { headers: { Cookie: ari } });
  const fileBytes = Buffer.from(await fileRes.arrayBuffer());
  check('file bytes identical', fileBytes.equals(pdfBytes), `${fileBytes.length} vs ${pdfBytes.length}`);
  check('file headers', (fileRes.headers.get('content-disposition') ?? '').includes('inline')
    && fileRes.headers.get('x-content-type-options') === 'nosniff'
    && (fileRes.headers.get('content-security-policy') ?? '').includes('sandbox')
    && fileRes.headers.get('cache-control') === 'private, no-store',
  JSON.stringify(Object.fromEntries(fileRes.headers.entries())));

  // another tenant cannot read the document (404)
  r = await call('GET', `/api/documents/${docJson.id}`, { cookie: pearl });
  check('other tenant doc 404', r.status === 404, r.status);
  const fileRes2 = await fetch(`${BASE}/api/documents/${docJson.id}/file`, { headers: { Cookie: pearl } });
  check('other tenant file 404', fileRes2.status === 404, fileRes2.status);

  // upload with wrong type (text) -> 422 on file
  const form3 = multipart({ kind: 'insurance_certificate', expiresOn: dayFrom(90), perOccurrenceLimit: '1000000', additionalInsured: 'true' }, Buffer.from('not a pdf at all'));
  const res3 = await fetch(`${BASE}/api/documents`, {
    method: 'POST',
    headers: { Cookie: ari, 'Content-Type': 'multipart/form-data; boundary=----stationhouse' + RUN },
    body: form3,
  });
  const bad3 = await res3.json();
  check('bad type 422', res3.status === 422 && bad3.fields?.file !== undefined, JSON.stringify(bad3).slice(120));

  // insurance below minimum -> 422 on limit
  const form4 = multipart({ kind: 'insurance_certificate', expiresOn: dayFrom(90), perOccurrenceLimit: '500000', additionalInsured: 'true' }, pdfBytes);
  const res4 = await fetch(`${BASE}/api/documents`, {
    method: 'POST',
    headers: { Cookie: ari, 'Content-Type': 'multipart/form-data; boundary=----stationhouse' + RUN },
    body: form4,
  });
  const bad4 = await res4.json();
  check('low limit 422', res4.status === 422 && bad4.fields?.perOccurrenceLimit !== undefined, JSON.stringify(bad4).slice(120));

  // past expiry -> 422 on expiresOn
  const form5 = multipart({ kind: 'insurance_certificate', expiresOn: dayFrom(-1), perOccurrenceLimit: '1000000', additionalInsured: 'true' }, pdfBytes);
  const res5 = await fetch(`${BASE}/api/documents`, {
    method: 'POST',
    headers: { Cookie: ari, 'Content-Type': 'multipart/form-data; boundary=----stationhouse' + RUN },
    body: form5,
  });
  const bad5 = await res5.json();
  check('past expiry 422', res5.status === 422 && bad5.fields?.expiresOn !== undefined, JSON.stringify(bad5).slice(120));

  // ---- renewal after lapse: Night Market uploads a new certificate ----
  r = await call('POST', '/api/session', { body: { email: 'wei@nightmarket.test', password: 'tenant-pass-2026' } });
  const wei = token(r.setCookie);
  r = await call('GET', '/api/me', { cookie: wei });
  check('wei suspended', r.json?.tenant?.status === 'suspended', r.json?.tenant?.status);
  // wei cannot claim while suspended
  r = await call('POST', '/api/bookings', { cookie: wei, key: `ws-${RUN}`, body: { stationId: 'prep-b', start: `${dayFrom(2)}T09:00:00${offset}`, end: `${dayFrom(2)}T11:00:00${offset}` } });
  check('suspended claim 409', r.status === 409 && r.json?.error === 'tenant_not_approved', r.json?.message ?? '');
  // renew the certificate
  const form6 = multipart({ kind: 'insurance_certificate', expiresOn: dayFrom(90), perOccurrenceLimit: '1000000', additionalInsured: 'true' }, pdfBytes);
  const res6 = await fetch(`${BASE}/api/documents`, {
    method: 'POST',
    headers: { Cookie: wei, 'Content-Type': 'multipart/form-data; boundary=----stationhouse' + RUN },
    body: form6,
  });
  const ren6 = await res6.json().catch(() => null);
  check('renewal 201', res6.status === 201, JSON.stringify(ren6).slice(100));
  r = await call('GET', '/api/me', { cookie: wei });
  check('wei approved again', r.json?.tenant?.status === 'approved', r.json?.tenant?.status);
  // the old certificate is superseded
  r = await call('GET', '/api/documents', { cookie: wei });
  const old = r.json.documents.find((x) => x.coverState === 'superseded');
  const current = r.json.documents.find((x) => x.coverState === 'ok');
  check('old superseded', old !== undefined, JSON.stringify(r.json.documents.map((x) => [x.kind, x.coverState])));
  check('new valid', current !== undefined);

  // ---- hold expiry ----
  console.log('  waiting for hold expiry (needs HOLD_SECONDS)...');
  r = await call('POST', '/api/session', { body: { email: 'dana@brightfork.test', password: 'tenant-pass-2026' } });
  const dana = token(r.setCookie);
  await call('POST', '/api/packs', { cookie: dana, key: `dp-${RUN}`, body: { hours: 10 } });
  // claim without confirming; the hold expires by the server clock
  r = await call('POST', '/api/bookings', { cookie: dana, key: `he-${RUN}`, body: { stationId: 'range-1', start: `${dayFrom(3)}T09:00:00${offset}`, end: `${dayFrom(3)}T11:00:00${offset}` } });
  check('hold created', r.status === 201, r.json?.message ?? '');
  const holdId = r.json?.id;
  const holdSeconds = kitchen.holdSeconds;
  await new Promise((res) => setTimeout(res, (holdSeconds + 3) * 1000));
  r = await call('GET', `/api/bookings/${holdId}`, { cookie: dana });
  check('hold expired by server', r.json?.status === 'cancelled' && r.json?.cancelReason === 'hold_expired', JSON.stringify(r.json).slice(100));
  // the station is free again
  r = await call('GET', `/api/floor?date=${dayFrom(3)}&from=09:00&to=11:00`, { cookie: dana });
  const range1 = r.json?.stations?.find((s) => s.id === 'range-1');
  check('station freed', range1?.freeMinutes === 120, JSON.stringify(range1).slice(120));
  // the pack no longer holds the minutes
  r = await call('GET', '/api/packs', { cookie: pearl });
  check('no hold on pack', (r.json?.packs ?? []).every((p) => p.heldMinutes === 0), JSON.stringify(r.json?.packs?.map((p) => p.heldMinutes)));

  // ---- claim limit: 10 counted claims in 60s ----
  let refused = 0;
  let held = 0;
  for (let i = 0; i < 13; i++) {
    r = await call('POST', '/api/bookings', { cookie: dana, key: `cl-${RUN}-${i}`, body: { stationId: 'range-2', start: `${dayFrom(10 + i)}T09:00:00${offset}`, end: `${dayFrom(10 + i)}T11:00:00${offset}` } });
    if (r.status === 429 && r.json?.error === 'rate_limited') refused++;
    if (r.status === 201) held++;
  }
  check('claim limit enforced', refused === 3, `refused ${refused} held ${held}`);
  const ra = r.headers.get('retry-after');
  check('claim limit retry-after', ra !== null && Number(ra) >= 1, ra ?? 'missing');

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('CRASH', e); process.exit(1); });
