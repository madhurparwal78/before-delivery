/** A development smoke test over the running API. */
const base = process.env.BASE ?? 'http://127.0.0.1:4173';

let failures = 0;

function check(label, condition, detail) {
  if (condition) console.log(`ok   ${label}`);
  else {
    failures += 1;
    console.log(`FAIL ${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`);
  }
}

async function call(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers['content-type'] = 'application/json';
  }
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body instanceof FormData ? options.body : options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: 'manual',
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, json, headers: response.headers };
}

async function signIn(email) {
  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'pegboard-2026' }),
  });
  const cookie = response.headers.getSetCookie()[0].split(';')[0];
  return cookie;
}

function as(cookie, extra = {}) {
  return { cookie, ...extra };
}

async function callAs(cookie, path, options = {}) {
  return call(path, { ...options, headers: { cookie, ...(options.headers ?? {}) } });
}

const main = async () => {
  check('health', (await call('/api/health')).status === 200);
  check('unauthenticated items', (await call('/api/items')).status === 401);
  check('bad credentials', (await call('/api/session', { method: 'POST', body: { email: 'hal@members.example', password: 'nope' } })).status === 401);
  check('missing fields', (await call('/api/session', { method: 'POST', body: {} })).status === 422);
  check('cross origin', (await call('/api/session', { method: 'POST', body: {}, headers: { origin: 'http://evil.test' } })).status === 403);
  check('unsupported media', (await call('/api/session', { method: 'POST', headers: { 'content-type': 'text/plain' } })).status === 415);
  check('run.json hidden', (await call('/run.json')).status === 404);
  check('package.json hidden', (await call('/package.json')).status === 404);
  check('src hidden', (await call('/src/server/main.ts')).status === 404);
  check('app shell', (await call('/catalogue')).status === 200);
  check('unknown api', (await call('/api/nope')).status === 404);

  const hal = await signIn('hal@members.example');
  const dev = await signIn('dev@commonshed.example');
  const rosa = await signIn('rosa@commonshed.example');

  const library = await callAs(hal, '/api/library');
  check('library time zone', library.json.time_zone === 'America/New_York', library.json);
  check('library closures', JSON.stringify(library.json.closed_dates) === JSON.stringify(['2026-07-04', '2026-11-26', '2026-12-25', '2026-12-26']), library.json.closed_dates);
  check('late fee today', library.json.late_fee_cents_per_day === 100, library.json.late_fee_cents_per_day);

  const items = await callAs(hal, '/api/items');
  check('ten items', items.json.items.length === 10, items.json.items?.length);
  check('tile saw first', items.json.items[0].id === 'tile-saw');
  check('tile saw free', items.json.items[0].units_free_today === 2, items.json.items[0]);

  const lanes = await callAs(hal, '/api/items/tile-saw/lanes');
  check('lane count', lanes.json.lanes.length === 2);
  check('lane window', lanes.json.to === new Date(Date.parse(`${lanes.json.from}T00:00:00Z`) + 27 * 86400000).toISOString().slice(0, 10), lanes.json);
  check('units free null', lanes.json.units_free === null);

  // Find two open days inside the horizon.
  const closed = new Set(library.json.closed_dates);
  const openDays = new Set(library.json.open_days);
  const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const openDates = [];
  for (let offset = 0; offset < 28; offset += 1) {
    const date = new Date(Date.parse(`${lanes.json.from}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
    const weekday = weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()];
    if (openDays.has(weekday) && !closed.has(date)) openDates.push(date);
  }
  const start = openDates[1];
  const end = openDates[2];
  check('open dates found', start !== undefined && end !== undefined, openDates.slice(0, 5));

  const ranged = await callAs(hal, `/api/items/tile-saw/lanes?start=${start}&end=${end}`);
  check('ranged free', ranged.json.units_free === 2, ranged.json.units_free);
  check('busy for range false', ranged.json.lanes[0].busy_for_range === false);

  check('lane one sided', (await callAs(hal, `/api/items/tile-saw/lanes?start=${start}`)).status === 422);

  const holdKey = `smoke-hold-${Date.now()}`;
  const held = await callAs(hal, '/api/holds', {
    method: 'POST',
    body: { item_id: 'tile-saw', start_date: start, end_date: end },
    headers: { 'idempotency-key': holdKey },
  });
  check('hold created', held.status === 201, held.json);
  check('hold lane', held.json?.hold?.unit?.lane_index === 0, held.json?.hold?.unit);
  check('hold free count', held.json?.units_free === 1, held.json?.units_free);
  check('hold requested', held.json?.hold?.status === 'requested');

  const replay = await callAs(hal, '/api/holds', {
    method: 'POST',
    body: { item_id: 'tile-saw', start_date: start, end_date: end },
    headers: { 'idempotency-key': holdKey },
  });
  check('hold replay same id', replay.status === 201 && replay.json.hold.id === held.json.hold.id, replay.json);

  const conflict = await callAs(hal, '/api/holds', {
    method: 'POST',
    body: { item_id: 'pressure-washer', start_date: start, end_date: end },
    headers: { 'idempotency-key': holdKey },
  });
  check('key conflict', conflict.status === 409 && conflict.json.error.code === 'idempotency_conflict', conflict.json);

  check('missing key', (await callAs(hal, '/api/holds', { method: 'POST', body: { item_id: 'tile-saw', start_date: start, end_date: end } })).json.error.fields.idempotency_key !== undefined);

  const badDates = await callAs(hal, '/api/holds', {
    method: 'POST',
    body: { item_id: 'tile-saw', start_date: '2020-01-01', end_date: '2020-01-02' },
    headers: { 'idempotency-key': `smoke-bad-${Date.now()}` },
  });
  check('bad dates', badDates.status === 422 && badDates.json.error.fields.start_date !== undefined, badDates.json);

  const holdId = held.json.hold.id;
  check('member sees own hold', (await callAs(hal, `/api/holds/${holdId}`)).status === 200);
  const mina = await signIn('mina@members.example');
  check('other member not found', (await callAs(mina, `/api/holds/${holdId}`)).status === 404);
  check('member cannot ready', (await callAs(hal, `/api/holds/${holdId}/ready`, { method: 'POST', body: {} })).status === 403);

  const ready = await callAs(dev, `/api/holds/${holdId}/ready`, { method: 'POST', body: {} });
  check('marked ready', ready.status === 200 && ready.json.hold.status === 'ready', ready.json);
  check('pickup deadline set', ready.json.hold.pickup_deadline !== null);
  check('ready twice', (await callAs(dev, `/api/holds/${holdId}/ready`, { method: 'POST', body: {} })).json.error.code === 'invalid_transition');

  const lent = await callAs(dev, '/api/loans', {
    method: 'POST',
    body: { hold_id: holdId },
    headers: { 'idempotency-key': `smoke-lend-${Date.now()}` },
  });
  check('loan created', lent.status === 201, lent.json);
  check('loan deposit', lent.json?.loan?.deposit_cents === 5000, lent.json?.loan?.deposit_cents);
  check('loan due date', lent.json?.loan?.due_date === end, lent.json?.loan?.due_date);

  const loanId = lent.json.loan.id;
  const second = await callAs(dev, '/api/loans', {
    method: 'POST',
    body: { hold_id: holdId },
    headers: { 'idempotency-key': `smoke-lend2-${Date.now()}` },
  });
  check('second checkout refused', second.status === 409 && second.json.error.message === "This hold is collected and can't do that.", second.json);

  const ledger = await callAs(rosa, `/api/ledger?loan_id=${loanId}`);
  check('deposit hold entry', ledger.json.entries.length === 1 && ledger.json.entries[0].kind === 'deposit_hold', ledger.json);
  check('deposits held', ledger.json.deposits_held_cents >= 5000, ledger.json.deposits_held_cents);
  check('member cannot read ledger', (await callAs(hal, '/api/ledger')).status === 403);

  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
  const form = new FormData();
  form.append('photo', new Blob([jpeg], { type: 'image/jpeg' }), 'IMG_0001.jpg');
  const uploaded = await callAs(dev, `/api/loans/${loanId}/photos`, { method: 'POST', body: form });
  check('photo uploaded', uploaded.status === 201 && uploaded.json.photo.stage === 'checkout', uploaded.json);
  check('photo url', uploaded.json?.photo?.url === `/api/loans/${loanId}/photos/${uploaded.json?.photo?.id}`);

  const download = await fetch(`${base}${uploaded.json.photo.url}`, { headers: { cookie: dev } });
  check('photo download', download.status === 200 && download.headers.get('content-type') === 'image/jpeg');
  check('photo cache header', download.headers.get('cache-control') === 'private, no-store');

  const svgForm = new FormData();
  svgForm.append('photo', new Blob([Buffer.from('<svg></svg>')], { type: 'image/svg+xml' }), 'x.svg');
  check('svg refused', (await callAs(dev, `/api/loans/${loanId}/photos`, { method: 'POST', body: svgForm })).json.error.code === 'unsupported_photo');

  const returned = await callAs(dev, `/api/loans/${loanId}/return`, { method: 'POST', body: {} });
  check('checked in', returned.status === 200 && returned.json.loan.status === 'returned', returned.json);
  check('on time', returned.json.loan.on_time === true);
  check('return twice', (await callAs(dev, `/api/loans/${loanId}/return`, { method: 'POST', body: {} })).json.error.message === "This loan is returned and can't do that.");

  const inspected = await callAs(dev, `/api/loans/${loanId}/inspection`, { method: 'POST', body: { outcome: 'damaged', note: 'Chipped blade guard.' } });
  check('inspected', inspected.status === 200 && inspected.json.loan.status === 'inspected', inspected.json);
  const noteless = await callAs(dev, `/api/loans/${loanId}/inspection`, { method: 'POST', body: { outcome: 'damaged' } });
  check('damaged needs note', noteless.status === 422 && noteless.json.error.fields.note === 'Describe the damage in up to 500 characters.', noteless.json);

  check('volunteer cannot settle', (await callAs(dev, `/api/loans/${loanId}/settlement`, { method: 'POST', body: { damage_cents: 0 }, headers: { 'idempotency-key': `s-${Date.now()}` } })).status === 403);

  const settled = await callAs(rosa, `/api/loans/${loanId}/settlement`, {
    method: 'POST',
    body: { damage_cents: 1500 },
    headers: { 'idempotency-key': `smoke-settle-${Date.now()}` },
  });
  check('settled', settled.status === 201, settled.json);
  check('settlement split', settled.json?.settlement?.released_cents === 3500 && settled.json?.settlement?.damage_from_deposit_cents === 1500, settled.json?.settlement);
  check('no extra damage', settled.json?.settlement?.extra_damage_cents === 0);
  check('no late fee', settled.json?.settlement?.late_fee_cents === 0);

  const mismatch = await callAs(rosa, `/api/loans/${loanId}/settlement`, {
    method: 'POST',
    body: { damage_cents: 100 },
    headers: { 'idempotency-key': `smoke-settle2-${Date.now()}` },
  });
  check('settle twice', mismatch.status === 409, mismatch.json);

  const receipt = await callAs(hal, `/api/loans/${loanId}/receipt`);
  check('receipt', receipt.status === 200 && receipt.json.receipt.total_charged_cents === 1500, receipt.json);

  const loanLedger = await callAs(rosa, `/api/ledger?loan_id=${loanId}`);
  const net = loanLedger.json.entries
    .filter((entry) => ['deposit_hold', 'deposit_release', 'damage_charge'].includes(entry.kind))
    .reduce((sum, entry) => sum + entry.amount_cents, 0);
  check('deposit entries net to zero', net === 0, loanLedger.json.entries);

  const counter = await callAs(dev, '/api/counter/status');
  check('counter status', counter.json.billing === 'up' && counter.json.photo_storage === 'up', counter.json);

  console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} checks failed.`);
  process.exit(failures === 0 ? 0 : 1);
};

await main();
