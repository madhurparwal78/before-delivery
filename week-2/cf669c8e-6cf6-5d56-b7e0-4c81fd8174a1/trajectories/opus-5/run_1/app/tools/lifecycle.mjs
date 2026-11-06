/**
 * Order and ride lifecycle over the API: the switch to workshop fitting, the
 * withdrawal, a test-ride hold with its server-clock expiry, and the refusals
 * each of them publishes.
 */

import { spawn } from 'node:child_process';

const MAIN = 'http://127.0.0.1:4173';
/** A short-hold instance, to watch a hold expire on the server's clock. */
const HOLD_PORT = 4175;
const HOLD_APP = `http://127.0.0.1:${HOLD_PORT}`;
const HOLD_SECONDS = 3;

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks += 1;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
  } else {
    console.log(`ok   ${label} = ${a}`);
  }
}

function checkThat(label, condition, detail = '') {
  checks += 1;
  if (condition) console.log(`ok   ${label}`);
  else {
    failures += 1;
    console.error(`FAIL ${label} ${detail}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signIn(base, email, password) {
  const answer = await fetch(`${base}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!answer.ok) throw new Error(`sign-in failed: ${answer.status}`);
  return answer.headers.getSetCookie().join('; ');
}

function callerFor(base, cookie) {
  return async (method, path, body, key) => {
    const headers = { cookie };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (key) headers['idempotency-key'] = key;
    const answer = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await answer.text();
    return { status: answer.status, body: text ? JSON.parse(text) : null };
  };
}

/** Wait until a stage reads `paid`, which only a believed notification does. */
async function waitForDepositConfirmed(call, orderId) {
  for (let i = 0; i < 60; i += 1) {
    const { body } = await call('GET', `/api/orders/${orderId}`);
    if (body.state === 'deposit confirmed') return body;
    await sleep(500);
  }
  throw new Error('the deposit never reached deposit confirmed');
}

async function makePaidDepositOrder(call, config, expectedTotalCents) {
  const created = await call('POST', '/api/orders', {
    kind: 'kit',
    config,
    plan: { name: 'Anouk Veerman', street: 'Kadeweg 12', postcode: '1011AB', city: 'Amsterdam' },
    expectedTotalCents,
  });
  if (created.status !== 201) throw new Error(`order creation failed: ${JSON.stringify(created)}`);
  await call('POST', `/api/orders/${created.body.id}/payments`, { stage: 'deposit' }, crypto.randomUUID());
  return waitForDepositConfirmed(call, created.body.id);
}

const DE_POSTED = {
  donor: { plate: '418-RTV', country: 'DE' },
  packId: 'P-1500',
  hubId: 'H-1000',
  roadClass: 25,
  fulfilment: 'posted',
  country: 'DE',
};

const riderCookie = await signIn(MAIN, 'rider.de@ommezwaai.example', 'Feeler-2026!');
const rider = callerFor(MAIN, riderCookie);
const fitterCookie = await signIn(MAIN, 'fitter@ommezwaai.example', 'Werkbank-2026!');
const fitter = callerFor(MAIN, fitterCookie);

// ---- the switch to workshop fitting --------------------------------------
console.log('--- switch to workshop fitting ---');
{
  const order = await makePaidDepositOrder(rider, DE_POSTED, 149500);
  check('the deposit is confirmed', order.state, 'deposit confirmed');
  check('the deposit amount', order.schedule[0].amountCents, 29900);

  const key = crypto.randomUUID();
  const switched = await rider('POST', `/api/orders/${order.id}/switch-to-workshop`, {}, key);
  check('the switch is accepted', switched.status, 200);

  const after = switched.body;
  check('the POST line became FIT in place', after.lines[4].code, 'FIT');
  check('the FIT line keeps its position and takes the FIT price', [after.lines[4].name, after.lines[4].grossCents], ['Workshop fitting', 28900]);
  check('the line id is unchanged', after.lines[4].id, order.lines[4].id);
  check('the new total', after.totalCents, 174500);
  check('the new VAT', after.vatCents, 30285);
  check('every VAT-bearing line moved to 21 percent', after.lines.slice(0, 5).map((l) => l.vatRatePct), [21, 21, 21, 21, 21]);
  check('the confirmed stage amount never changed', after.schedule[0].amountCents, 29900);
  check('the deposit VAT correction', after.schedule[0].vatCorrectedCents, 414);
  check('the deposit VAT at the new rate', after.schedule[0].vatCents, 5188);
  check(
    'the deposit allocation VAT at the new rate',
    after.schedule[0].allocations.map((a) => a.vatCents),
    [1454, 2218, 1211, 170, 135],
  );
  check(
    'the unpaid balance is re-spread',
    after.schedule.slice(1).map((s) => s.amountCents),
    [48200, 48200, 48200],
  );
  check(
    'instalment 1 is re-allocated',
    after.schedule[1].allocations.map((a) => a.grossCents),
    [11574, 17650, 9640, 1353, 7983],
  );
  check('the fulfilment is now workshop', after.config.fulfilment, 'workshop');

  // A repeat of the same key replays, and a second switch is illegal.
  const replay = await rider('POST', `/api/orders/${order.id}/switch-to-workshop`, {}, key);
  check('a repeat of the key replays the stored answer', replay.status, 200);
  const again = await rider('POST', `/api/orders/${order.id}/switch-to-workshop`, {}, crypto.randomUUID());
  check('a second switch is illegal', [again.status, again.body.error], [409, 'illegal_transition']);

  // `quote_locked` still applies to PATCH after `quoted`.
  const patched = await rider('PATCH', `/api/orders/${order.id}`, {
    planVersion: after.planVersion,
    config: { country: 'NL' },
  });
  check('config changes are locked after quoted', [patched.status, patched.body.error], [409, 'quote_locked']);
}

// ---- withdrawal -----------------------------------------------------------
console.log('--- withdrawal ---');
{
  const order = await makePaidDepositOrder(rider, DE_POSTED, 149500);
  checkThat('withdrawal is open before fitting', order.withdrawalOpen === true, JSON.stringify(order.withdrawalOpen));

  const withdrawn = await rider('POST', `/api/orders/${order.id}/withdraw`, {}, crypto.randomUUID());
  check('the withdrawal is accepted', withdrawn.status, 200);
  check('the state is withdrawn at once', withdrawn.body.state, 'withdrawn');
  check('every line with collected money gets one refund', withdrawn.body.refunds.length, 5);
  check(
    'the refunds total the collected money',
    withdrawn.body.refunds.reduce((sum, r) => sum + r.amountCents, 0),
    29900,
  );
  check('each refund is pending until confirmed', [...new Set(withdrawn.body.refunds.map((r) => r.status))], ['pending']);

  // Wait for every draw to be believed.
  let settled = null;
  for (let i = 0; i < 60; i += 1) {
    const { body } = await rider('GET', `/api/orders/${order.id}`);
    if (body.refunds.every((r) => r.status !== 'pending')) {
      settled = body;
      break;
    }
    await sleep(500);
  }
  checkThat('every withdrawal refund settles', settled !== null, 'still pending');
  check('each refund returned', [...new Set(settled.refunds.map((r) => r.status))], ['returned']);
  check('the order is flagged partly refunded', settled.partlyRefunded, true);
  check('nothing is left collected', settled.lines.map((l) => l.collectedCents), [0, 0, 0, 0, 0]);

  // A second withdrawal, and a payment, are both illegal now.
  const again = await rider('POST', `/api/orders/${order.id}/withdraw`, {}, crypto.randomUUID());
  check('a second withdrawal is illegal', [again.status, again.body.error], [409, 'illegal_transition']);
  const pay = await rider('POST', `/api/orders/${order.id}/payments`, { stage: 'instalment-1' }, crypto.randomUUID());
  check('no payment can be taken on a withdrawn order', [pay.status, pay.body.error], [409, 'illegal_transition']);
}

// ---- the published payment refusal order ---------------------------------
console.log('--- payment refusals ---');
{
  const order = await makePaidDepositOrder(rider, DE_POSTED, 149500);

  const repeat = await rider('POST', `/api/orders/${order.id}/payments`, { stage: 'deposit' }, crypto.randomUUID());
  check('a confirmed stage answers stage_already_paid', [repeat.status, repeat.body.error], [409, 'stage_already_paid']);

  const ahead = await rider('POST', `/api/orders/${order.id}/payments`, { stage: 'instalment-2' }, crypto.randomUUID());
  check('paying out of order answers stage_out_of_order', [ahead.status, ahead.body.error], [409, 'stage_out_of_order']);

  // A hand-entered donor can never take a deposit.
  const hand = await rider('POST', '/api/orders', {
    kind: 'kit',
    config: {
      donor: {
        manual: {
          model: 'R50',
          country: 'DE',
          firstAdmissionYear: 2017,
          roadClass: 25,
          plateColour: 'white',
          registeredMassKg: '74.0',
        },
      },
      packId: 'P-1500',
      hubId: 'H-1000',
      roadClass: 25,
      fulfilment: 'posted',
      country: 'DE',
    },
    plan: { name: 'A', street: 'B', postcode: 'C', city: 'D' },
    expectedTotalCents: 149500,
  });
  check('a hand-entered order is created', hand.status, 201);
  const handDeposit = await rider('POST', `/api/orders/${hand.body.id}/payments`, { stage: 'deposit' }, crypto.randomUUID());
  check('a hand-entered donor gets donor_unconfirmed', [handDeposit.status, handDeposit.body.error], [409, 'donor_unconfirmed']);

  // A failing verdict gets fit_not_passed, which comes after donor_unconfirmed.
  const fouls = await rider('POST', '/api/orders', {
    kind: 'kit',
    config: { ...DE_POSTED, hubId: 'H-3600', roadClass: 45 },
    plan: { name: 'A', street: 'B', postcode: 'C', city: 'D' },
    expectedTotalCents: 0,
  });
  check('a differing total is refused with quote_changed', [fouls.status, fouls.body.error], [409, 'quote_changed']);

  const quote = await fetch(`${MAIN}/api/quotes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...DE_POSTED, hubId: 'H-3600', roadClass: 45 }),
  }).then((r) => r.json());
  check('the fouling quote verdict', quote.fit.verdict, 'fouls');
  const foulOrder = await rider('POST', '/api/orders', {
    kind: 'kit',
    config: { ...DE_POSTED, hubId: 'H-3600', roadClass: 45 },
    plan: { name: 'A', street: 'B', postcode: 'C', city: 'D' },
    expectedTotalCents: quote.totalCents,
  });
  check('a fouling order can still be created', foulOrder.status, 201);
  const foulDeposit = await rider('POST', `/api/orders/${foulOrder.body.id}/payments`, { stage: 'deposit' }, crypto.randomUUID());
  check('a failing verdict gets fit_not_passed', [foulDeposit.status, foulDeposit.body.error], [409, 'fit_not_passed']);

  // A missing idempotency key is a validation failure.
  const noKey = await fetch(`${MAIN}/api/orders/${order.id}/payments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: riderCookie },
    body: JSON.stringify({ stage: 'instalment-1' }),
  });
  check('a missing idempotency key is refused', [noKey.status, (await noKey.json()).errors.idempotencyKey], [422, 'Required.']);

  // The same key with a different body conflicts.
  const sharedKey = crypto.randomUUID();
  await rider('POST', `/api/orders/${order.id}/payments`, { stage: 'instalment-1' }, sharedKey);
  const conflict = await rider('POST', `/api/orders/${order.id}/payments`, { stage: 'instalment-2' }, sharedKey);
  check('the same key with a different body conflicts', [conflict.status, conflict.body.error], [409, 'idempotency_conflict']);

  // Another rider's order behaves exactly like a missing one.
  const otherCookie = await signIn(MAIN, 'rider.be@ommezwaai.example', 'Feeler-2026!');
  const other = callerFor(MAIN, otherCookie);
  const foreign = await other('GET', `/api/orders/${order.id}`);
  const missing = await other('GET', `/api/orders/${crypto.randomUUID()}`);
  check('another rider gets the same answer as a missing order', [foreign.status, foreign.body.error], [missing.status, missing.body.error]);
  check("and that answer is not_found", [foreign.status, foreign.body.error], [404, 'not_found']);

  // A rider at the desk gets 403.
  const deskAsRider = await other('GET', '/api/desk/orders');
  check('a rider at the desk gets forbidden', [deskAsRider.status, deskAsRider.body.error], [403, 'forbidden']);
}

// ---- one transaction per key ---------------------------------------------
console.log('--- one transaction per key ---');
{
  const created = await rider('POST', '/api/orders', {
    kind: 'kit',
    config: DE_POSTED,
    plan: { name: 'A', street: 'B', postcode: 'C', city: 'D' },
    expectedTotalCents: 149500,
  });
  const key = crypto.randomUUID();
  // Concurrent repeats of one key must make one transaction.
  const answers = await Promise.all(
    [0, 1, 2, 3].map(() =>
      rider('POST', `/api/orders/${created.body.id}/payments`, { stage: 'deposit' }, key),
    ),
  );
  check('every concurrent repeat answers 202', answers.map((a) => a.status), [202, 202, 202, 202]);
  const desk = await fitter('GET', `/api/desk/orders/${created.body.id}`);
  check('one key made one payment', desk.body.payments.length, 1);
  const transactionIds = new Set(desk.body.payments.map((p) => p.killbillTransactionId));
  check('one Kill Bill transaction', transactionIds.size, 1);
}

// ---- the refund amount cap, including in parallel ------------------------
console.log('--- refund cap ---');
{
  const order = await makePaidDepositOrder(rider, DE_POSTED, 149500);
  const packLine = order.lines.find((l) => l.code === 'P-1500');
  check('the pack line has collected the deposit allocation', packLine.collectedCents, 12780);

  const over = await fitter(
    'POST',
    `/api/desk/orders/${order.id}/refunds`,
    { lineId: packLine.id, amountCents: 12781 },
    crypto.randomUUID(),
  );
  check(
    'more than the line has collected is refused',
    [over.status, over.body.errors.amountCents],
    [422, 'That is more than this line has collected.'],
  );

  const exact = await fitter(
    'POST',
    `/api/desk/orders/${order.id}/refunds`,
    { lineId: packLine.id, amountCents: 12780 },
    crypto.randomUUID(),
  );
  check('exactly what the line has collected is allowed', exact.status, 202);

  // A second refund cannot draw on money already in flight or returned.
  const second = await fitter(
    'POST',
    `/api/desk/orders/${order.id}/refunds`,
    { lineId: packLine.id, amountCents: 1 },
    crypto.randomUUID(),
  );
  check(
    'a second refund cannot exceed what is left',
    [second.status, second.body.errors.amountCents],
    [422, 'That is more than this line has collected.'],
  );

  // A payment is refused while a refund is pending, and the other way round.
  const whilePending = await rider(
    'POST',
    `/api/orders/${order.id}/payments`,
    { stage: 'instalment-1' },
    crypto.randomUUID(),
  );
  checkThat(
    'a payment during a refund is refused',
    whilePending.status === 409 && ['refund_in_flight', 'payment_in_flight'].includes(whilePending.body.error),
    JSON.stringify(whilePending.body),
  );
}

// ---- a test-ride hold and its server-clock expiry ------------------------
console.log('--- test-ride hold and expiry ---');
{
  const app = spawn('node', ['dist/server/server/index.js'], {
    env: {
      ...process.env,
      APP_PUBLIC_PORT: String(HOLD_PORT),
      HOLD_SECONDS: String(HOLD_SECONDS),
      // Share the main instance's callback, since both instances share the
      // database and so behave as one shop.
      KILLBILL_CALLBACK_ORIGIN: 'http://main:4173',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  app.stderr.on('data', (d) => process.stderr.write(`[hold-app] ${d}`));

  for (let i = 0; i < 40; i += 1) {
    const ok = await fetch(`${HOLD_APP}/api/health`).then((r) => r.ok).catch(() => false);
    if (ok) break;
    await sleep(400);
  }

  const cookie = await signIn(HOLD_APP, 'rider.nl@ommezwaai.example', 'Feeler-2026!');
  const call = callerFor(HOLD_APP, cookie);

  const slots = await (await fetch(`${HOLD_APP}/api/bikes/BK-DIJK-45/slots`)).json();
  const free = slots.slots.filter((s) => s.status === 'free');
  checkThat('the bike has seeded free slots', free.length > 0, `${slots.slots.length} slots`);

  // Hold the first free slot that is not today, so the same-day cutoff is open.
  const today = (await (await fetch(`${HOLD_APP}/api/status`)).json()).serverNow.slice(0, 10);
  const slot = free.find((s) => s.localDate > today);
  const held = await call('POST', '/api/test-rides/holds', { slotId: slot.id });
  check('the hold is taken', held.status, 201);
  check('the ride is held', held.body.state, 'held');
  checkThat(
    'the countdown comes from the server',
    held.body.remainingSeconds > 0 && held.body.remainingSeconds <= HOLD_SECONDS,
    `${held.body.remainingSeconds}`,
  );

  // A rider has at most one live hold, whichever slot the next claim names.
  const other = free.find((s) => s.localDate > today && s.id !== slot.id);
  const secondHold = await call('POST', '/api/test-rides/holds', { slotId: other.id });
  check('a second hold is refused', [secondHold.status, secondHold.body.error], [409, 'hold_exists']);

  // Of simultaneous claims on one slot by other riders, exactly one wins.
  const beCookie = await signIn(HOLD_APP, 'rider.be@ommezwaai.example', 'Feeler-2026!');
  const deCookie = await signIn(HOLD_APP, 'rider.de@ommezwaai.example', 'Feeler-2026!');
  const racers = [callerFor(HOLD_APP, beCookie), callerFor(HOLD_APP, deCookie)];
  const race = await Promise.all(racers.map((c) => c('POST', '/api/test-rides/holds', { slotId: other.id })));
  const winners = race.filter((r) => r.status === 201);
  const losers = race.filter((r) => r.status === 409 && r.body.error === 'slot_gone');
  check('exactly one simultaneous claim wins the slot', [winners.length, losers.length], [1, 1]);

  // The hold expires on the server's clock, with no client involved.
  await sleep((HOLD_SECONDS + 2) * 1000);
  const expired = await call('GET', `/api/test-rides/${held.body.id}`);
  check('the hold expired on the server clock', expired.body.state, 'expired');
  const confirmLate = await call('POST', `/api/test-rides/${held.body.id}/confirm`, {});
  check('confirming after expiry is refused', [confirmLate.status, confirmLate.body.error], [409, 'hold_expired']);

  const slotsAfter = await (await fetch(`${HOLD_APP}/api/bikes/BK-DIJK-45/slots`)).json();
  const freedAgain = slotsAfter.slots.find((s) => s.id === slot.id);
  check('the slot is free again', freedAgain.status, 'free');

  // A fresh hold on the freed slot can be confirmed, and sends one mail.
  const again = await call('POST', '/api/test-rides/holds', { slotId: slot.id });
  check('the freed slot can be held again', again.status, 201);
  const confirmed = await call('POST', `/api/test-rides/${again.body.id}/confirm`, {});
  check('the hold confirms', [confirmed.status, confirmed.body.state], [200, 'confirmed']);
  const repeatConfirm = await call('POST', `/api/test-rides/${again.body.id}/confirm`, {});
  check('repeating confirm returns the same ride', [repeatConfirm.status, repeatConfirm.body.state], [200, 'confirmed']);

  app.kill('SIGTERM');
}

console.log(`\n${checks - failures}/${checks} lifecycle checks passed`);
if (failures > 0) process.exit(1);
