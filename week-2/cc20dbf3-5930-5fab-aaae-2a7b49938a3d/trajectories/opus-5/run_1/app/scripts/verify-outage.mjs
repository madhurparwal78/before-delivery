/** Development checks for dependency outages, pickup expiry and reminders. */
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log(`ok   ${label}`);
  else {
    failures += 1;
    console.log(`FAIL ${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`);
  }
}

function startCopy(port, overrides, logPath) {
  const log = openSync(logPath, 'a');
  const child = spawn(process.execPath, ['dist/server/main.js'], {
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, APP_PUBLIC_PORT: String(port), ...overrides },
  });
  child.unref();
  return child;
}

async function waitReady(port) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      const routed = await fetch(`http://127.0.0.1:${port}/api/items`);
      if (health.ok && routed.status === 401) return true;
    } catch {
      /* not up yet */
    }
  }
  return false;
}

function client(port) {
  return async (cookie, path, options = {}) => {
    const headers = { ...(options.headers ?? {}) };
    if (cookie !== null) headers.cookie = cookie;
    let body;
    if (options.form !== undefined) body = options.form;
    else if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body,
    });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: response.status, json, headers: response.headers };
  };
}

async function signIn(port, email) {
  const response = await fetch(`http://127.0.0.1:${port}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'pegboard-2026' }),
  });
  return response.headers.getSetCookie()[0].split(';')[0];
}

let keyCounter = 0;
const key = () => `outage-${Date.now()}-${(keyCounter += 1)}`;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const main = async () => {
  const main4173 = client(4173);
  const rosa = await signIn(4173, 'rosa@commonshed.example');
  const dev = await signIn(4173, 'dev@commonshed.example');
  const hal = await signIn(4173, 'hal@members.example');

  const library = (await main4173(rosa, '/api/library')).json;
  const lanes = (await main4173(rosa, '/api/items/tile-saw/lanes')).json;
  const closed = new Set(library.closed_dates);
  const open = new Set(library.open_days);
  const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const openDates = [];
  for (let offset = 0; offset < 28; offset += 1) {
    const date = shift(lanes.from, offset);
    if (open.has(WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]) && !closed.has(date)) openDates.push(date);
  }

  // A copy that cannot reach billing, next to the main one.
  startCopy(4174, { KILLBILL_URL: 'http://127.0.0.1:9' }, '/tmp/server-nobilling.log');
  // A copy that cannot reach photo storage.
  startCopy(4175, { S3_ENDPOINT: 'http://127.0.0.1:9' }, '/tmp/server-nostorage.log');
  check('billing-down copy is healthy', await waitReady(4174));
  check('storage-down copy is healthy', await waitReady(4175));

  const noBilling = client(4174);
  const noStorage = client(4175);
  const devNoBilling = await signIn(4174, 'dev@commonshed.example');
  const rosaNoBilling = await signIn(4174, 'rosa@commonshed.example');
  const halNoBilling = await signIn(4174, 'hal@members.example');
  const devNoStorage = await signIn(4175, 'dev@commonshed.example');

  check('session issued by one copy works on another', (await main4173(devNoBilling, '/api/session')).status === 200);

  const banner = await noBilling(devNoBilling, '/api/counter/status');
  check('counter reports billing down', banner.json.billing === 'down', banner.json);
  check('counter reports photo storage up', banner.json.photo_storage === 'up', banner.json);
  const storageBanner = await noStorage(devNoStorage, '/api/counter/status');
  check('counter reports photo storage down', storageBanner.json.photo_storage === 'down', storageBanner.json);

  // ---- A deposit item cannot be lent while billing is down. ----
  const depositHold = await noBilling(halNoBilling, '/api/holds', {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { item_id: 'tile-saw', start_date: openDates[1], end_date: openDates[2] },
  });
  check('hold placed while billing is down', depositHold.status === 201, depositHold.json);
  const holdId = depositHold.json.hold.id;
  await noBilling(devNoBilling, `/api/holds/${holdId}/ready`, { method: 'POST', body: {} });

  const before = (await main4173(hal, `/api/items/tile-saw/lanes?start=${openDates[1]}&end=${openDates[2]}`)).json;
  const beforeHeld = (await main4173(rosa, '/api/ledger')).json.deposits_held_cents;

  const retryKey = key();
  const attempts = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    attempts.push(
      await noBilling(devNoBilling, '/api/loans', {
        method: 'POST',
        headers: { 'idempotency-key': retryKey },
        body: { hold_id: holdId },
      }),
    );
  }
  check('every retry gets the same outage answer', attempts.every((attempt) => attempt.status === 503 && attempt.json.error.code === 'billing_unavailable'), attempts.map((a) => [a.status, a.json.error?.code]));
  check('outage copy is the published one', attempts[0].json.error.message === "Billing is offline, so items with a deposit can't be lent right now. Items without a deposit still lend.", attempts[0].json);
  const leaked = JSON.stringify(attempts[0].json);
  check('outage answer is opaque', !/ECONNREFUSED|ETIMEDOUT|killbill|Kill Bill|minio|MinIO|127\.0\.0\.1|S3/i.test(leaked), leaked);
  check('no request_in_progress on retry', attempts.every((attempt) => attempt.json.error.code !== 'request_in_progress'));

  const stillReady = await main4173(dev, `/api/holds/${holdId}`);
  check('hold stays ready through the outage', stillReady.json.hold.status === 'ready', stillReady.json.hold.status);
  check('pickup deadline unchanged', stillReady.json.hold.pickup_deadline === depositHold.json.hold.pickup_deadline || stillReady.json.hold.pickup_deadline !== null);
  const after = (await main4173(hal, `/api/items/tile-saw/lanes?start=${openDates[1]}&end=${openDates[2]}`)).json;
  check('free count unchanged', after.units_free === before.units_free, [before.units_free, after.units_free]);
  check('deposits held unchanged', (await main4173(rosa, '/api/ledger')).json.deposits_held_cents === beforeHeld);

  // ---- Items without a deposit still lend while billing is down. ----
  const freeLend = await noBilling(devNoBilling, '/api/loans', {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { member_id: 'mem-mina', unit_id: 'drill-driver-1', due_date: openDates[1] },
  });
  check('a no-deposit item still lends', freeLend.status === 201, freeLend.json);

  // ---- The same key completes once after billing returns. ----
  const recovered = await main4173(dev, '/api/loans', {
    method: 'POST',
    headers: { 'idempotency-key': retryKey },
    body: { hold_id: holdId },
  });
  check('the same key lends once billing is back', recovered.status === 201, recovered.json);
  const recoveredLoanId = recovered.json.loan.id;
  const replayed = await main4173(dev, '/api/loans', {
    method: 'POST',
    headers: { 'idempotency-key': retryKey },
    body: { hold_id: holdId },
  });
  check('the stored response replays', replayed.status === 201 && replayed.json.loan.id === recoveredLoanId, replayed.json);
  const recoveredLedger = (await main4173(rosa, `/api/ledger?loan_id=${recoveredLoanId}`)).json;
  check('one deposit hold entry after recovery', recoveredLedger.entries.filter((entry) => entry.kind === 'deposit_hold').length === 1, recoveredLedger.entries);

  // ---- Settling while billing is down. ----
  await main4173(dev, `/api/loans/${recoveredLoanId}/return`, { method: 'POST', body: {} });
  await main4173(dev, `/api/loans/${recoveredLoanId}/inspection`, {
    method: 'POST',
    body: { outcome: 'damaged', note: 'Scuffed fence.' },
  });
  const settleKey = key();
  const refusedSettle = await noBilling(rosaNoBilling, `/api/loans/${recoveredLoanId}/settlement`, {
    method: 'POST',
    headers: { 'idempotency-key': settleKey },
    body: { damage_cents: 500 },
  });
  check('settlement refused while billing is down', refusedSettle.status === 503 && refusedSettle.json.error.code === 'billing_unavailable', refusedSettle.json);
  check('settlement outage copy', refusedSettle.json.error.message === "Billing is offline, so this loan can't be settled yet. Try again with the same damage charge once billing is back.", refusedSettle.json);
  const stillInspected = await main4173(rosa, `/api/loans/${recoveredLoanId}`);
  check('loan stays inspected', stillInspected.json.loan.status === 'inspected', stillInspected.json.loan.status);
  const noEntries = (await main4173(rosa, `/api/ledger?loan_id=${recoveredLoanId}`)).json;
  check('no settlement ledger entries yet', noEntries.entries.filter((entry) => entry.kind !== 'deposit_hold').length === 0, noEntries.entries);
  const noReceipt = await (await fetch('http://mailpit:8025/api/v1/search?query=' + encodeURIComponent(`subject:"Settlement receipt"`))).json();
  check('no receipt email yet', noReceipt.messages_count === 0, noReceipt.messages_count);

  const mismatched = await noBilling(rosaNoBilling, `/api/loans/${recoveredLoanId}/settlement`, {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { damage_cents: 700 },
  });
  check('the damage charge stays fixed through the outage', mismatched.status === 409 && mismatched.json.error.code === 'settlement_mismatch', mismatched.json);
  check('mismatch copy names the fixed amount', mismatched.json.error.message === "An earlier attempt fixed this loan's damage charge at $5.00. Settle again with that amount.", mismatched.json);

  const settledAfter = await main4173(rosa, `/api/loans/${recoveredLoanId}/settlement`, {
    method: 'POST',
    headers: { 'idempotency-key': settleKey },
    body: { damage_cents: 500 },
  });
  check('the same key settles once billing is back', settledAfter.status === 201, settledAfter.json);
  const settledLedger = (await main4173(rosa, `/api/ledger?loan_id=${recoveredLoanId}`)).json;
  check('one release entry after recovery', settledLedger.entries.filter((entry) => entry.kind === 'deposit_release').length === 1, settledLedger.entries);

  // ---- Photo storage outage. ----
  const storageLoan = await noStorage(devNoStorage, '/api/loans', {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { member_id: 'mem-mina', unit_id: 'drill-driver-2', due_date: openDates[1] },
  });
  check('a loan is created while photo storage is down', storageLoan.status === 201, storageLoan.json);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 9)]);
  const form = new FormData();
  form.append('photo', new Blob([jpeg], { type: 'image/jpeg' }), 'x.jpg');
  const refusedUpload = await noStorage(devNoStorage, `/api/loans/${storageLoan.json.loan.id}/photos`, { method: 'POST', form });
  check('upload refused while storage is down', refusedUpload.status === 503 && refusedUpload.json.error.code === 'photo_storage_unavailable', refusedUpload.json);
  check('storage outage copy', refusedUpload.json.error.message === 'Photo storage is offline. The loan is saved; add photos when it\u2019s back.', refusedUpload.json);
  check('storage outage answer is opaque', !/ECONNREFUSED|minio|MinIO|S3|127\.0\.0\.1/i.test(JSON.stringify(refusedUpload.json)), refusedUpload.json);
  const afterRefusal = await main4173(dev, `/api/loans/${storageLoan.json.loan.id}`);
  check('no photo record left behind', afterRefusal.json.loan.photos.length === 0, afterRefusal.json.loan.photos);
  const okUpload = await main4173(dev, `/api/loans/${storageLoan.json.loan.id}/photos`, {
    method: 'POST',
    form: (() => {
      const retry = new FormData();
      retry.append('photo', new Blob([jpeg], { type: 'image/jpeg' }), 'x.jpg');
      return retry;
    })(),
  });
  check('upload works on the healthy copy', okUpload.status === 201, okUpload.json);
  const refusedDownload = await noStorage(devNoStorage, okUpload.json.photo.url);
  check('download refused while storage is down', refusedDownload.status === 503 && refusedDownload.json.error.code === 'photo_storage_unavailable', refusedDownload.json);
  const loanReadDuringOutage = await noStorage(devNoStorage, `/api/loans/${storageLoan.json.loan.id}`);
  check('loan reads still list photo records', loanReadDuringOutage.json.loan.photos.length === 1, loanReadDuringOutage.json.loan.photos);

  // ---- Pickup window expiry on a copy with a short window. ----
  startCopy(
    4176,
    { SHEDLINE_PICKUP_WINDOW_SECONDS: '5', SHEDLINE_REMINDER_LEAD_SECONDS: '691200' },
    '/tmp/server-shortwindow.log',
  );
  check('short-window copy is healthy', await waitReady(4176));
  const shortWindow = client(4176);
  const devShort = await signIn(4176, 'dev@commonshed.example');
  const halShort = await signIn(4176, 'hal@members.example');
  const lapsing = await shortWindow(halShort, '/api/holds', {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { item_id: 'carpet-cleaner', start_date: openDates[1], end_date: openDates[2] },
  });
  check('hold placed for the lapse test', lapsing.status === 201, lapsing.json);
  const readied = await shortWindow(devShort, `/api/holds/${lapsing.json.hold.id}/ready`, { method: 'POST', body: {} });
  check('hold readied with a short window', readied.status === 200, readied.json);
  const beforeLapse = (await shortWindow(halShort, `/api/items/carpet-cleaner/lanes?start=${openDates[1]}&end=${openDates[2]}`)).json;
  check('the readied unit is taken', beforeLapse.units_free === 1, beforeLapse.units_free);

  await new Promise((resolve) => setTimeout(resolve, 9_000));
  const lapsed = await shortWindow(devShort, `/api/holds/${lapsing.json.hold.id}`);
  check('the hold has expired', lapsed.json.hold.status === 'expired', lapsed.json.hold);
  const afterLapse = (await shortWindow(halShort, `/api/items/carpet-cleaner/lanes?start=${openDates[1]}&end=${openDates[2]}`)).json;
  check('the unit is free again', afterLapse.units_free === 2, afterLapse.units_free);
  const lateCheckout = await shortWindow(devShort, '/api/loans', {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { hold_id: lapsing.json.hold.id },
  });
  check('checking out a lapsed hold is refused', lateCheckout.status === 409 && lateCheckout.json.error.code === 'hold_expired', lateCheckout.json);

  const messages = await (await fetch('http://mailpit:8025/api/v1/search?query=' + encodeURIComponent('subject:"Hold lapsed"'))).json();
  check('one lapse notice was sent', messages.messages_count === 1, messages.messages_count);

  // ---- One due reminder per due instant, and one more after a renewal. ----
  const reminded = await shortWindow(devShort, '/api/loans', {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { member_id: 'mem-tobi', unit_id: 'hedge-trimmer-1', due_date: openDates[1] },
  });
  check('loan lent for the reminder test', reminded.status === 201, reminded.json);
  const firstDueAt = reminded.json.loan.due_at;
  await new Promise((resolve) => setTimeout(resolve, 6_000));
  const firstReminders = await (await fetch('http://mailpit:8025/api/v1/search?query=' + encodeURIComponent('subject:"Due back" to:tobi@members.example'))).json();
  check('exactly one reminder for the first due time', firstReminders.messages_count === 1, firstReminders.messages_count);

  const renewedForReminder = await shortWindow(devShort, `/api/loans/${reminded.json.loan.id}/renewal`, {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { due_date: openDates[3] },
  });
  check('renewed for the reminder test', renewedForReminder.status === 200, renewedForReminder.json);
  check('renewal changed the due instant', renewedForReminder.json.loan.due_at !== firstDueAt);
  await new Promise((resolve) => setTimeout(resolve, 6_000));
  const afterRenewal = await (await fetch('http://mailpit:8025/api/v1/search?query=' + encodeURIComponent('subject:"Due back" to:tobi@members.example'))).json();
  check('one more reminder after the renewal', afterRenewal.messages_count === 2, afterRenewal.messages_count);
  const subjects = afterRenewal.messages.map((message) => message.Subject);
  check('the reminders name different due times', new Set(subjects).size === 2, subjects);

  console.log(failures === 0 ? '\nAll outage checks passed.' : `\n${failures} checks failed.`);
  process.exit(failures === 0 ? 0 : 1);
};

await main();
