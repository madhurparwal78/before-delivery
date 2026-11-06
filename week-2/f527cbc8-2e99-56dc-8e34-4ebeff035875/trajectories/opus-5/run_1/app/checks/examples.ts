/* The brief's published worked examples, walked against a running server. */
import sharp from 'sharp';
import { query, pool, withClient } from '../src/server/db.js';

const PRIMARY = 'http://127.0.0.1:4173';
const KB_DOWN = process.env.KB_DOWN ?? 'http://127.0.0.1:4185';

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400));
  }
}

interface Session {
  cookie: string;
}

async function call(
  base: string,
  method: string,
  path: string,
  options: { session?: Session; body?: unknown; headers?: Record<string, string>; raw?: Buffer; contentType?: string } = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers: Record<string, string> = { origin: base, ...(options.headers ?? {}) };
  if (options.session !== undefined) headers.cookie = options.session.cookie;
  let payload: BodyInit | undefined;
  if (options.raw !== undefined) {
    payload = options.raw as unknown as BodyInit;
    if (options.contentType !== undefined) headers['content-type'] = options.contentType;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }
  const response = await fetch(`${base}${path}`, { method, headers, body: payload });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers };
}

async function signIn(base: string, email: string): Promise<Session> {
  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ email, password: 'hoofcare-2026' }),
  });
  const cookie = (response.headers.getSetCookie()[0] ?? '').split(';')[0] as string;
  await response.text();
  return { cookie };
}

const key = (): string => `k-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function hoofJpeg(): Promise<Buffer> {
  return await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 140, g: 120, b: 95 } } })
    .jpeg()
    .toBuffer();
}

function multipart(hoof: string, phase: string, bytes: Buffer): { body: Buffer; contentType: string } {
  const boundary = '----examples';
  return {
    body: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="hoof"\r\n\r\n${hoof}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="phase"\r\n\r\n${phase}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function reachable(base: string): Promise<boolean> {
  try {
    const response = await fetch(`${base}/healthz`);
    await response.text();
    return response.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const farrier = await signIn(PRIMARY, 'farrier@clinchline.test');
  const practice = await call(PRIMARY, 'GET', '/api/practice', { session: farrier });
  const today = practice.body.today as string;
  const barns = await call(PRIMARY, 'GET', '/api/barns', { session: farrier });
  const cedar = barns.body.find((barn: any) => barn.name === 'Cedar Hollow Stables');
  const horses = await call(PRIMARY, 'GET', '/api/horses', { session: farrier });
  const cedarHorses = horses.body.filter((horse: any) => horse.barn.name === 'Cedar Hollow Stables');
  const sessions = new Map<string, Session>();
  for (const horse of cedarHorses) {
    if (!sessions.has(horse.owner.email)) {
      sessions.set(horse.owner.email, await signIn(PRIMARY, horse.owner.email));
    }
  }

  console.log('\n== 4500 cents across 7 horses ==');
  const seven = cedarHorses.slice(0, 7);
  check('seven horses are available at Cedar Hollow', seven.length === 7, seven.length);

  const created = await call(PRIMARY, 'POST', '/api/barn-days', {
    session: farrier,
    body: { barn_id: cedar.id, business_date: today, start_time: '19:00', slot_count: 7, slot_minutes: 15 },
  });
  const dayId = created.body.id as string;
  await call(PRIMARY, 'POST', `/api/barn-days/${dayId}/publish`, { session: farrier, body: {} });
  const day = await call(PRIMARY, 'GET', `/api/barn-days/${dayId}`, { session: farrier });

  const booked: { horse: any; bookingId: string; number: number }[] = [];
  for (let index = 0; index < seven.length; index += 1) {
    const horse = seven[index] as any;
    const owner = sessions.get(horse.owner.email) as Session;
    const hold = await call(PRIMARY, 'POST', `/api/barn-days/${dayId}/bookings`, {
      session: owner,
      body: { slot_id: day.body.slots[index].id, horse_id: horse.id, card_token: 'tok_approve_4242' },
    });
    if (hold.status !== 201) {
      check(`hold for ${horse.name}`, false, hold.body);
      continue;
    }
    await call(PRIMARY, 'POST', `/api/bookings/${hold.body.id}/confirm`, { session: owner, body: {} });
    booked.push({ horse, bookingId: hold.body.id as string, number: hold.body.number as number });
  }
  check('all seven horses are confirmed', booked.length === 7, booked.length);

  await call(PRIMARY, 'POST', `/api/barn-days/${dayId}/start`, { session: farrier, body: {} });
  const allocation = await call(PRIMARY, 'GET', `/api/barn-days/${dayId}/allocation`, { session: farrier });
  const shares = allocation.body.shares.map((share: any) => share.share_cents);
  check('the six lowest booking numbers get 643 and the seventh 642',
    shares.join(',') === '643,643,643,643,643,643,642', shares);
  check('they add up to the fee', shares.reduce((sum: number, value: number) => sum + value, 0) === 4500);

  console.log('\n== excusing b2 with b1 billed ==');
  const ordered = [...booked].sort((left, right) => left.number - right.number);
  const b1 = ordered[0] as { bookingId: string; horse: any };
  const b2 = ordered[1] as { bookingId: string; horse: any };

  // b1 is worked and closed, so its share is billed and never changes again.
  const visit = await call(PRIMARY, 'POST', `/api/bookings/${b1.bookingId}/visit`, { session: farrier, body: {} });
  const photo = multipart('LF', 'after', await hoofJpeg());
  await call(PRIMARY, 'POST', `/api/visits/${visit.body.id}/photos`, {
    session: farrier,
    raw: photo.body,
    contentType: photo.contentType,
  });
  const closed = await call(PRIMARY, 'POST', `/api/visits/${visit.body.id}/close`, {
    session: farrier,
    headers: { 'idempotency-key': key() },
    body: { work: ['trim'] },
  });
  check('b1 is invoiced with its 643 trip share',
    closed.body.invoice.items.some((item: any) => item.amount_cents === 643), closed.body.invoice.items);

  const excused = await call(PRIMARY, 'POST', `/api/bookings/${b2.bookingId}/excuse`, {
    session: farrier,
    body: {},
  });
  check('the excuse succeeds', excused.status === 200, excused.body);
  const after = excused.body.allocation.shares
    .slice()
    .sort((left: any, right: any) => left.number - right.number)
    .map((share: any) => share.share_cents);
  check('the pool of 3857 over b3 to b7 gives 772, 772, 771, 771, 771',
    after.join(',') === '643,0,772,772,771,771,771', after);
  check('the shares still add up to the fee',
    after.reduce((sum: number, value: number) => sum + value, 0) === 4500, after);
  const adjustments = excused.body.allocation.adjustments.map((adjustment: any) => adjustment.delta_cents);
  check('six adjustments are appended: -643, +129, +129, +128, +128, +129',
    adjustments.join(',') === '-643,129,129,128,128,129', adjustments);

  console.log('\n== then excusing b5 with b3 billed ==');
  const b3 = ordered[2] as { bookingId: string };
  const b5 = ordered[4] as { bookingId: string };
  const visit3 = await call(PRIMARY, 'POST', `/api/bookings/${b3.bookingId}/visit`, { session: farrier, body: {} });
  const photo3 = multipart('LF', 'after', await hoofJpeg());
  await call(PRIMARY, 'POST', `/api/visits/${visit3.body.id}/photos`, {
    session: farrier,
    raw: photo3.body,
    contentType: photo3.contentType,
  });
  await call(PRIMARY, 'POST', `/api/visits/${visit3.body.id}/close`, {
    session: farrier,
    headers: { 'idempotency-key': key() },
    body: { work: ['trim'] },
  });
  const second = await call(PRIMARY, 'POST', `/api/bookings/${b5.bookingId}/excuse`, {
    session: farrier,
    body: {},
  });
  const finalShares = second.body.allocation.shares
    .slice()
    .sort((left: any, right: any) => left.number - right.number)
    .map((share: any) => share.share_cents);
  check('the final shares read 643, 0, 772, 1029, 0, 1028, 1028',
    finalShares.join(',') === '643,0,772,1029,0,1028,1028', finalShares);
  const lastFour = second.body.allocation.adjustments
    .slice(-4)
    .map((adjustment: any) => `${adjustment.seq}:${adjustment.delta_cents}`);
  check('adjustments 7 to 10 are b4 +257, b5 -771, b6 +257, b7 +257',
    lastFour.join(',') === '7:257,8:-771,9:257,10:257', lastFour);

  console.log('\n== a late cancel gets a trip-only invoice ==');
  {
    const lateDay = await call(PRIMARY, 'POST', '/api/barn-days', {
      session: farrier,
      body: { barn_id: cedar.id, business_date: today, start_time: '19:30', slot_count: 2, slot_minutes: 15 },
    });
    const lateDayId = lateDay.body.id as string;
    await call(PRIMARY, 'POST', `/api/barn-days/${lateDayId}/publish`, { session: farrier, body: {} });
    const slots = (await call(PRIMARY, 'GET', `/api/barn-days/${lateDayId}`, { session: farrier })).body.slots;
    const horse = cedarHorses[0] as any;
    const owner = sessions.get(horse.owner.email) as Session;
    const hold = await call(PRIMARY, 'POST', `/api/barn-days/${lateDayId}/bookings`, {
      session: owner,
      body: { slot_id: slots[0].id, horse_id: horse.id, card_token: 'tok_approve_4242' },
    });
    await call(PRIMARY, 'POST', `/api/bookings/${hold.body.id}/confirm`, { session: owner, body: {} });

    // The day is today, so its cutoff has passed: the cancellation is late.
    const preview = await call(PRIMARY, 'GET', `/api/bookings/${hold.body.id}/cancellation-preview`, {
      session: owner,
    });
    check('the preview says the cutoff has passed', preview.body.late === true, preview.body);
    check('it says the deposit is kept', preview.body.deposit_outcome === 'keep', preview.body);

    const cancelled = await call(PRIMARY, 'POST', `/api/bookings/${hold.body.id}/cancel`, {
      session: owner,
      body: {},
    });
    check('the booking is cancelled late with a trip share',
      cancelled.body.booking.status === 'cancelled_late' && cancelled.body.trip_share_applies === true,
      cancelled.body);
    check('the deposit is kept, not refunded',
      cancelled.body.deposit_outcome === 'keep' && cancelled.body.refunded_cents === 0, cancelled.body);

    await call(PRIMARY, 'POST', `/api/barn-days/${lateDayId}/start`, { session: farrier, body: {} });
    const lateAllocation = await call(PRIMARY, 'GET', `/api/barn-days/${lateDayId}/allocation`, {
      session: farrier,
    });
    check('the late-cancelled horse still counts toward the fee',
      lateAllocation.body.shares.length === 1 && lateAllocation.body.shares[0].share_cents === 4500,
      lateAllocation.body.shares);

    const dayClosed = await call(PRIMARY, 'POST', `/api/barn-days/${lateDayId}/close`, {
      session: farrier,
      body: {},
    });
    check('the day closes with nothing open', dayClosed.status === 200, dayClosed.body);

    const invoices = await call(PRIMARY, 'GET', '/api/invoices', { session: farrier });
    const tripOnly = invoices.body.find(
      (invoice: any) => invoice.kind === 'trip' && invoice.business_date === today && invoice.items[0].description.includes('cancelled late'),
    );
    check('a trip-only invoice names the late cancellation', tripOnly !== undefined, tripOnly?.items?.[0]);
    if (tripOnly !== undefined) {
      check('the kept deposit is credited up to the share',
        tripOnly.items.length === 2 && tripOnly.items[1].amount_cents === -2500 && tripOnly.total_cents === 2000,
        tripOnly.items);
    }
  }

  console.log('\n== a waitlist offer whose card declines passes on ==');
  {
    const offerDay = await call(PRIMARY, 'POST', '/api/barn-days', {
      session: farrier,
      body: { barn_id: cedar.id, business_date: today, start_time: '19:45', slot_count: 1, slot_minutes: 15 },
    });
    const offerDayId = offerDay.body.id as string;
    await call(PRIMARY, 'POST', `/api/barn-days/${offerDayId}/publish`, { session: farrier, body: {} });
    const slot = (await call(PRIMARY, 'GET', `/api/barn-days/${offerDayId}`, { session: farrier })).body.slots[0];

    const holder = cedarHorses[0] as any;
    const holderSession = sessions.get(holder.owner.email) as Session;
    const hold = await call(PRIMARY, 'POST', `/api/barn-days/${offerDayId}/bookings`, {
      session: holderSession,
      body: { slot_id: slot.id, horse_id: holder.id, card_token: 'tok_approve_4242' },
    });
    await call(PRIMARY, 'POST', `/api/bookings/${hold.body.id}/confirm`, { session: holderSession, body: {} });

    // Position 1 joins with a card that declines and position 2 with one that approves.
    // They must be different owners, because a join replaces that owner's card on file.
    const first = cedarHorses.find((horse: any) => horse.owner.email !== holder.owner.email) as any;
    const second = cedarHorses.find(
      (horse: any) =>
        horse.owner.email !== holder.owner.email && horse.owner.email !== first.owner.email,
    ) as any;
    check('the two waiting horses have different owners',
      first.owner.email !== second.owner.email, [first.owner.email, second.owner.email]);
    const firstSession = sessions.get(first.owner.email) as Session;
    const secondSession = sessions.get(second.owner.email) as Session;
    const joinOne = await call(PRIMARY, 'POST', `/api/barn-days/${offerDayId}/waitlist`, {
      session: firstSession,
      body: { horse_id: first.id, card_token: 'tok_decline_0002' },
    });
    const joinTwo = await call(PRIMARY, 'POST', `/api/barn-days/${offerDayId}/waitlist`, {
      session: secondSession,
      body: { horse_id: second.id, card_token: 'tok_approve_4242' },
    });
    check('two horses wait, in join order',
      joinOne.body.position === 1 && joinTwo.body.position === 2, [joinOne.body, joinTwo.body]);

    await call(PRIMARY, 'POST', `/api/bookings/${hold.body.id}/cancel`, { session: holderSession, body: {} });

    const waitlist = await call(PRIMARY, 'GET', `/api/barn-days/${offerDayId}/waitlist`, { session: farrier });
    check('the declined entry left the waitlist', waitlist.body.length === 0, waitlist.body);
    const secondBookings = await call(PRIMARY, 'GET', '/api/my/bookings', { session: secondSession });
    const offered = secondBookings.body.find(
      (booking: any) =>
        booking.barn_day_id === offerDayId && booking.offer === true && booking.horse.id === second.id,
    );
    check('position 2 holds the freed slot', offered !== undefined, secondBookings.body);
    const firstBookings = await call(PRIMARY, 'GET', '/api/my/bookings', { session: firstSession });
    check('the declined horse holds nothing',
      !firstBookings.body.some(
        (booking: any) => booking.barn_day_id === offerDayId && booking.horse.id === first.id,
      ),
      firstBookings.body);
    const lapsedEmail = await withClient((db) =>
      query<{ subject: string }>(
        db,
        `SELECT subject FROM email_outbox WHERE dedupe_key LIKE 'offer_declined:%' ORDER BY created_at DESC LIMIT 1`,
      ),
    );
    check('the declined owner gets the offer-lapsed email',
      (lapsedEmail[0]?.subject ?? '').startsWith('Slot offer lapsed:'), lapsedEmail[0]);
  }

  console.log('\n== cancelling a day refunds every captured deposit ==');
  {
    const doomed = await call(PRIMARY, 'POST', '/api/barn-days', {
      session: farrier,
      body: { barn_id: cedar.id, business_date: today, start_time: '20:00', slot_count: 1, slot_minutes: 15 },
    });
    const doomedId = doomed.body.id as string;
    await call(PRIMARY, 'POST', `/api/barn-days/${doomedId}/publish`, { session: farrier, body: {} });
    const slot = (await call(PRIMARY, 'GET', `/api/barn-days/${doomedId}`, { session: farrier })).body.slots[0];
    const horse = cedarHorses[0] as any;
    const owner = sessions.get(horse.owner.email) as Session;
    const hold = await call(PRIMARY, 'POST', `/api/barn-days/${doomedId}/bookings`, {
      session: owner,
      body: { slot_id: slot.id, horse_id: horse.id, card_token: 'tok_approve_4242' },
    });
    const confirmed = await call(PRIMARY, 'POST', `/api/bookings/${hold.body.id}/confirm`, {
      session: owner,
      body: {},
    });
    check('the deposit is captured on confirmation', confirmed.status === 200, confirmed.body);

    const cancelledDay = await call(PRIMARY, 'POST', `/api/barn-days/${doomedId}/cancel`, {
      session: farrier,
      body: {},
    });
    check('the day is cancelled', cancelledDay.body.status === 'cancelled', cancelledDay.body);
    const payment = await call(PRIMARY, 'GET', `/api/payments/${confirmed.body.payment_id}`, {
      session: farrier,
    });
    check('its deposit is refunded in full',
      payment.body.status === 'refunded' && payment.body.refunded_cents === 2500, payment.body);
    const booking = await call(PRIMARY, 'GET', '/api/my/bookings', { session: owner });
    check('the booking reads cancelled in time',
      booking.body.find((entry: any) => entry.id === hold.body.id)?.status === 'cancelled_in_time',
      booking.body.find((entry: any) => entry.id === hold.body.id)?.status);
    const email = await withClient((db) =>
      query<{ subject: string; body: string }>(
        db,
        `SELECT subject, body FROM email_outbox WHERE dedupe_key = $1`,
        [`cancelled:${hold.body.id}`],
      ),
    );
    check('the owner is told no trip share applies and the deposit is refunded',
      (email[0]?.body ?? '').includes('No trip share applies.') &&
        (email[0]?.body ?? '').includes('Your $25.00 deposit will be refunded.'),
      email[0]);
  }

  console.log('\n== a vet link expires on its stored instant ==');
  if (await reachable(KB_DOWN)) {
    // That instance issues links with a twenty-second life.
    const kbSession = await signIn(KB_DOWN, 'farrier@clinchline.test');
    const juniper = horses.body.find((horse: any) => horse.name === 'Juniper');
    const issued = await call(KB_DOWN, 'POST', `/api/horses/${juniper.id}/vet-links`, {
      session: kbSession,
      body: { vet_name: 'Dr Wren Ash', vet_email: 'vet.expiry@clinchline.test' },
    });
    check('a short-lived link is issued', issued.status === 201, issued.body);
    const token = String(issued.body.url).replace('/vet/', '');
    const live = await call(PRIMARY, 'GET', `/api/vet/${token}`);
    check('it reads while live', live.status === 200, live.status);
    await sleep(21000);
    const expired = await call(PRIMARY, 'GET', `/api/vet/${token}`);
    check('after its expiry it answers 404 on another instance', expired.status === 404, expired.status);
    const views = await call(PRIMARY, 'GET', `/api/vet-links/${issued.body.id}/views`, { session: farrier });
    check('the expired read is logged with outcome expired',
      views.body[0]?.outcome === 'expired' && views.body[0]?.previous_date === null, views.body[0]);
    const list = await call(PRIMARY, 'GET', `/api/horses/${juniper.id}/vet-links`, { session: farrier });
    check('the link reads expired in the list',
      list.body.find((entry: any) => entry.id === issued.body.id)?.status === 'expired',
      list.body.find((entry: any) => entry.id === issued.body.id)?.status);
  } else {
    console.log('  (the short-lived-link instance is not running)');
  }

  console.log('\n== the audit log attributes every change ==');
  {
    const entries = await call(PRIMARY, 'GET', `/api/audit?entity_type=booking&entity_id=${b2.bookingId}`, {
      session: farrier,
    });
    const actions = entries.body.map((entry: any) => entry.action);
    check('the excused booking records hold, confirm and excuse',
      actions.includes('hold') && actions.includes('confirm') && actions.includes('excuse'), actions);
    check('each entry is attributed and carries its request id',
      entries.body.every((entry: any) => entry.actor.type !== undefined && entry.request_id !== null),
      entries.body[0]);

    // A token's actor stands for token:<id>.
    const token = await call(PRIMARY, 'POST', '/api/tokens', {
      session: farrier,
      body: { name: 'examples-billing', scope: 'billing' },
    });
    const payments = await call(PRIMARY, 'GET', '/api/payments', { session: farrier });
    const captured = payments.body.find((payment: any) => payment.status === 'captured');
    if (captured !== undefined) {
      const refund = await fetch(`${PRIMARY}/api/payments/${captured.id}/refund`, {
        method: 'POST',
        headers: {
          origin: PRIMARY,
          'content-type': 'application/json',
          authorization: `Bearer ${token.body.token}`,
          'idempotency-key': key(),
        },
        body: JSON.stringify({ amount_cents: 1 }),
      });
      const refundBody = await refund.json();
      check('a billing token may refund', refund.status === 200, refundBody);
      const audit = await call(PRIMARY, 'GET', `/api/audit?entity_type=payment&entity_id=${captured.id}`, {
        session: farrier,
      });
      const byToken = audit.body.find((entry: any) => entry.actor.type === 'token');
      check("the refund is attributed to the token's id",
        byToken !== undefined && byToken.actor.id === token.body.id, audit.body.map((e: any) => e.actor));
    }
    await call(PRIMARY, 'DELETE', `/api/tokens/${token.body.id}`, { session: farrier });
  }

  console.log(`\nfailures: ${failures}`);
  await pool.end();
  if (failures > 0) process.exitCode = 1;
}

await main();
