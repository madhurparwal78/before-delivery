/* Races, lapses, allowances, outages and multiple instances. */
import sharp from 'sharp';
import { query, pool, withClient } from '../src/server/db.js';

const PRIMARY = 'http://127.0.0.1:4173';
const PEER = process.env.PEER ?? 'http://127.0.0.1:4183';
const FAST = process.env.FAST ?? 'http://127.0.0.1:4184';
const KB_DOWN = process.env.KB_DOWN ?? 'http://127.0.0.1:4185';
const MAIL_DOWN = process.env.MAIL_DOWN ?? 'http://127.0.0.1:4186';

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
  options: {
    session?: Session;
    body?: unknown;
    headers?: Record<string, string>;
    raw?: Buffer;
    contentType?: string;
  } = {},
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

async function hoofJpeg(): Promise<Buffer> {
  return await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 140, g: 120, b: 95 } } })
    .jpeg()
    .toBuffer();
}

function multipart(hoof: string, phase: string, bytes: Buffer): { body: Buffer; contentType: string } {
  const boundary = '----races';
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
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
  const owners = {
    ada: await signIn(PRIMARY, 'owner.ada@clinchline.test'),
    bram: await signIn(PRIMARY, 'owner.bram@clinchline.test'),
    cleo: await signIn(PRIMARY, 'owner.cleo@clinchline.test'),
    dev: await signIn(PRIMARY, 'owner.dev@clinchline.test'),
  };
  const practice = await call(PRIMARY, 'GET', '/api/practice', { session: farrier });
  const today = practice.body.today as string;
  const barns = await call(PRIMARY, 'GET', '/api/barns', { session: farrier });
  const cedar = barns.body.find((barn: any) => barn.name === 'Cedar Hollow Stables');
  const horses = await call(PRIMARY, 'GET', '/api/horses', { session: farrier });
  const byName = new Map<string, any>(horses.body.map((horse: any) => [horse.name, horse]));

  const larkspur = barns.body.find((barn: any) => barn.name === 'Larkspur Farm');

  const makeDay = async (slotCount: number, startTime = '23:00', barnId = cedar.id): Promise<any> => {
    const created = await call(PRIMARY, 'POST', '/api/barn-days', {
      session: farrier,
      body: { barn_id: barnId, business_date: today, start_time: startTime, slot_count: slotCount, slot_minutes: 15 },
    });
    await call(PRIMARY, 'POST', `/api/barn-days/${created.body.id}/publish`, { session: farrier, body: {} });
    return (await call(PRIMARY, 'GET', `/api/barn-days/${created.body.id}`, { session: farrier })).body;
  };

  console.log('\n== several owners race for the last slot ==');
  {
    const day = await makeDay(1);
    const racers = [
      { session: owners.ada, horse: byName.get('Juniper') },
      { session: owners.bram, horse: byName.get('Saffron') },
      { session: owners.cleo, horse: byName.get('Tamarack') },
      { session: owners.dev, horse: byName.get('Fern') },
    ];
    const before = await withClient((db) =>
      query<{ value: number }>(db, `SELECT value FROM counters WHERE name = 'booking_number'`),
    );
    const since = new Date();
    const results = await Promise.all(
      racers.map((racer) =>
        call(PRIMARY, 'POST', `/api/barn-days/${day.id}/bookings`, {
          session: racer.session,
          body: { slot_id: day.slots[0].id, horse_id: racer.horse.id, card_token: 'tok_approve_4242' },
        }),
      ),
    );
    const won = results.filter((result) => result.status === 201);
    const lost = results.filter((result) => result.status !== 201);
    check('exactly one hold succeeds', won.length === 1, results.map((r) => [r.status, r.body.error]));
    check('every other claim is refused with day_full',
      lost.every((result) => result.status === 409 && result.body.error === 'day_full'),
      lost.map((r) => r.body));
    check('no rejection names the winning horse or owner',
      lost.every((result) => Object.keys(result.body).join(',') === 'error'), lost.map((r) => r.body));

    const after = await withClient((db) =>
      query<{ value: number }>(db, `SELECT value FROM counters WHERE name = 'booking_number'`),
    );
    check('only the successful hold took a booking number',
      Number(after[0]?.value ?? 0) - Number(before[0]?.value ?? 0) === 1,
      { before: before[0]?.value, after: after[0]?.value });

    // Only payments this race could have made are counted, so other suites' dunning
    // retries do not muddy the figure.
    const authorisations = await withClient((db) =>
      query<{ count: number }>(
        db,
        `SELECT COUNT(*)::int AS count FROM payments p
         WHERE p.created_at >= $1
           AND (p.booking_id IS NULL OR p.booking_id IN (SELECT id FROM bookings WHERE barn_day_id = $2))`,
        [since, day.id],
      ),
    );
    check('only the winner authorised a card', (authorisations[0]?.count ?? 0) === 1, authorisations[0]);

    const full = await call(PRIMARY, 'GET', `/api/barn-days/${day.id}`, { session: farrier });
    check('the day reads full with one booked slot',
      full.body.status === 'full' && full.body.booked_count === 1, full.body.status);

    const joins = await Promise.all(
      lost.map((_, index) =>
        call(PRIMARY, 'POST', `/api/barn-days/${day.id}/waitlist`, {
          session: (racers[index + 1] as { session: Session }).session,
          body: { horse_id: (racers[index + 1] as { horse: any }).horse.id, card_token: 'tok_approve_4242' },
        }),
      ),
    );
    const positions = joins
      .filter((join) => join.status === 201)
      .map((join) => join.body.position as number)
      .sort((left, right) => left - right);
    check('waitlist positions are the contiguous integers from 1',
      positions.join(',') === positions.map((_, index) => index + 1).join(','), positions);
  }

  console.log('\n== a hold lapses at its stored instant, with no job ==');
  if (await reachable(FAST)) {
    const day = await makeDay(2);
    // The fast-clock instance stamps a 15-second hold; the primary honours it.
    const hold = await call(FAST, 'POST', `/api/barn-days/${day.id}/bookings`, {
      session: await signIn(FAST, 'owner.ada@clinchline.test'),
      body: { slot_id: day.slots[0].id, horse_id: byName.get('Pilot').id, card_token: 'tok_approve_4242' },
    });
    check('the fast instance stamps a short hold', hold.status === 201, hold.body);
    const paymentId = hold.body.payment_id as string;

    const whileHeld = await call(PRIMARY, 'GET', `/api/barn-days/${day.id}`, { session: farrier });
    check('the slot reads taken while the hold is live',
      whileHeld.body.slots[0].state === 'taken', whileHeld.body.slots[0]);

    await withClient((db) =>
      query(db, 'UPDATE bookings SET hold_expires_at = now() - interval \'1 second\' WHERE id = $1', [
        hold.body.id,
      ]),
    );

    const afterLapse = await call(PRIMARY, 'GET', `/api/barn-days/${day.id}`, { session: farrier });
    check('the slot reopens on the next read', afterLapse.body.slots[0].state === 'open', afterLapse.body.slots[0]);
    check('the day stops reading full', afterLapse.body.status === 'published' && afterLapse.body.booked_count === 0);

    const payment = await call(PRIMARY, 'GET', `/api/payments/${paymentId}`, { session: farrier });
    check('the deposit reads voided', payment.body.status === 'voided', payment.body);

    const lateConfirm = await call(PRIMARY, 'POST', `/api/bookings/${hold.body.id}/confirm`, {
      session: owners.ada,
      body: {},
    });
    check('a late confirm answers hold_expired',
      lateConfirm.status === 409 && lateConfirm.body.error === 'hold_expired', lateConfirm.body);

    const audit = await withClient((db) =>
      query<{ action: string; actor_type: string; entity_type: string }>(
        db,
        `SELECT action, actor_type, entity_type FROM audit_log WHERE entity_id IN ($1,$2) ORDER BY at`,
        [hold.body.id, paymentId],
      ),
    );
    const lapseEntries = audit.filter((entry) => entry.actor_type === 'system');
    check('the lapse wrote one booking entry and one payment entry with a system actor',
      lapseEntries.length === 2 &&
        lapseEntries.some((entry) => entry.entity_type === 'booking') &&
        lapseEntries.some((entry) => entry.entity_type === 'payment'),
      audit);
  } else {
    console.log('  (the fast-clock instance is not running)');
  }

  console.log('\n== a stranger cannot beat position 1 after a lapse ==');
  {
    const day = await makeDay(1);
    const hold = await call(PRIMARY, 'POST', `/api/barn-days/${day.id}/bookings`, {
      session: owners.ada,
      body: { slot_id: day.slots[0].id, horse_id: byName.get('Juniper').id, card_token: 'tok_approve_4242' },
    });
    await call(PRIMARY, 'POST', `/api/bookings/${hold.body.id}/confirm`, { session: owners.ada, body: {} });
    await call(PRIMARY, 'POST', `/api/barn-days/${day.id}/waitlist`, {
      session: owners.bram,
      body: { horse_id: byName.get('Saffron').id, card_token: 'tok_approve_4242' },
    });
    await call(PRIMARY, 'POST', `/api/bookings/${hold.body.id}/cancel`, { session: owners.ada, body: {} });

    const stranger = await call(PRIMARY, 'POST', `/api/barn-days/${day.id}/bookings`, {
      session: owners.cleo,
      body: { horse_id: byName.get('Tamarack').id, slot_id: day.slots[0].id, card_token: 'tok_approve_4242' },
    });
    check('the stranger is refused',
      stranger.status === 409 && (stranger.body.error === 'day_full' || stranger.body.error === 'slot_taken'),
      stranger.body);
    const bramBookings = await call(PRIMARY, 'GET', '/api/my/bookings', { session: owners.bram });
    const offer = bramBookings.body.find((booking: any) => booking.barn_day_id === day.id);
    check('position 1 holds the freed slot as an offer',
      offer !== undefined && offer.offer === true && offer.status === 'held', offer);
  }

  console.log('\n== simultaneous starts, closes and marks ==');
  {
    const day = await makeDay(2);
    for (const entry of [
      { session: owners.ada, horse: byName.get('Juniper') },
      { session: owners.bram, horse: byName.get('Quarry') },
    ]) {
      const hold = await call(PRIMARY, 'POST', `/api/barn-days/${day.id}/bookings`, {
        session: entry.session,
        body: { slot_id: day.slots[entry === undefined ? 0 : 0].id, horse_id: entry.horse.id, card_token: 'tok_approve_4242' },
      });
      if (hold.status !== 201) continue;
      await call(PRIMARY, 'POST', `/api/bookings/${hold.body.id}/confirm`, { session: entry.session, body: {} });
      break;
    }
    const second = await call(PRIMARY, 'POST', `/api/barn-days/${day.id}/bookings`, {
      session: owners.bram,
      body: { slot_id: day.slots[1].id, horse_id: byName.get('Quarry').id, card_token: 'tok_approve_4242' },
    });
    if (second.status === 201) {
      await call(PRIMARY, 'POST', `/api/bookings/${second.body.id}/confirm`, { session: owners.bram, body: {} });
    }

    const bases = (await reachable(PEER)) ? [PRIMARY, PEER, PRIMARY, PEER] : [PRIMARY, PRIMARY, PRIMARY];
    const peerSession = (await reachable(PEER)) ? await signIn(PEER, 'farrier@clinchline.test') : farrier;
    const starts = await Promise.all(
      bases.map((base, index) =>
        call(base, 'POST', `/api/barn-days/${day.id}/start`, {
          session: base === PEER ? peerSession : farrier,
          body: {},
        }),
      ),
    );
    const winners = starts.filter((start) => start.status === 200);
    check('exactly one start answers 200', winners.length === 1, starts.map((s) => [s.status, s.body.error]));
    check('the others answer illegal_transition from in_progress',
      starts
        .filter((start) => start.status !== 200)
        .every((start) => start.body.error === 'illegal_transition' && start.body.from === 'in_progress'),
      starts.map((s) => s.body));

    const allocation = await call(PRIMARY, 'GET', `/api/barn-days/${day.id}/allocation`, { session: farrier });
    const total = allocation.body.shares.reduce((sum: number, share: any) => sum + share.share_cents, 0);
    check('one set of shares is stored and adds up to the fee', total === 4500, allocation.body.shares);

    // One visit, two closes with different keys.
    const rows = await call(PRIMARY, 'GET', `/api/barn-days/${day.id}/bookings`, { session: farrier });
    const firstRow = rows.body.find((row: any) => row.status === 'confirmed');
    if (firstRow !== undefined) {
      const visit = await call(PRIMARY, 'POST', `/api/bookings/${firstRow.booking_id}/visit`, {
        session: farrier,
        body: {},
      });
      const upload = multipart('LF', 'after', await hoofJpeg());
      const stored = await call(PRIMARY, 'POST', `/api/visits/${visit.body.id}/photos`, {
        session: farrier,
        raw: upload.body,
        contentType: upload.contentType,
      });
      check('the after photo is stored', stored.status === 201, stored.body);

      // Two first saves of one hoof's marks.
      const saves = await Promise.all([
        call(PRIMARY, 'PUT', `/api/visits/${visit.body.id}/hooves/LF/marks`, {
          session: farrier,
          body: { version: null, hoof_wall: { x1: 10, y1: 250, x2: 200, y2: 40 }, pastern: { x1: 200, y1: 200, x2: 380, y2: 20 } },
        }),
        call(PRIMARY, 'PUT', `/api/visits/${visit.body.id}/hooves/LF/marks`, {
          session: await signIn(PRIMARY, 'apprentice@clinchline.test'),
          body: { version: null, hoof_wall: { x1: 20, y1: 260, x2: 210, y2: 50 }, pastern: { x1: 210, y1: 210, x2: 390, y2: 30 } },
        }),
      ]);
      const okSaves = saves.filter((save) => save.status === 200);
      const staleSaves = saves.filter((save) => save.status === 412);
      check('of two first saves exactly one answers 200', okSaves.length === 1, saves.map((s) => s.status));
      check('the loser answers 412 with the winner\'s marks',
        staleSaves.length === 1 && staleSaves[0]?.body.current?.version === 1, staleSaves.map((s) => s.body));

      const closes = await Promise.all([
        call(PRIMARY, 'POST', `/api/visits/${visit.body.id}/close`, {
          session: farrier,
          headers: { 'idempotency-key': key() },
          body: { work: ['trim'] },
        }),
        call(PRIMARY, 'POST', `/api/visits/${visit.body.id}/close`, {
          session: farrier,
          headers: { 'idempotency-key': key() },
          body: { work: ['trim'] },
        }),
      ]);
      check('exactly one close answers 200', closes.filter((close) => close.status === 200).length === 1,
        closes.map((c) => [c.status, c.body.error]));
      const invoiceRows = await withClient((db) =>
        query<{ count: number }>(
          db,
          `SELECT COUNT(*)::int AS count FROM invoices WHERE visit_id = $1 AND kind = 'visit'`,
          [visit.body.id],
        ),
      );
      check('the visit has exactly one invoice', (invoiceRows[0]?.count ?? 0) === 1, invoiceRows[0]);
      const emails = await withClient((db) =>
        query<{ count: number }>(
          db,
          `SELECT COUNT(*)::int AS count FROM email_outbox WHERE dedupe_key LIKE 'visit_summary:%'
             AND dedupe_key IN (SELECT 'visit_summary:' || id FROM invoices WHERE visit_id = $1)`,
          [visit.body.id],
        ),
      );
      check('one visit summary email is queued', (emails[0]?.count ?? 0) === 1, emails[0]);
    }
  }

  console.log('\n== the photo quota under simultaneous sessions ==');
  {
    const day = await makeDay(1);
    const hold = await call(PRIMARY, 'POST', `/api/barn-days/${day.id}/bookings`, {
      session: owners.cleo,
      body: { slot_id: day.slots[0].id, horse_id: byName.get('Wicket').id, card_token: 'tok_approve_4242' },
    });
    await call(PRIMARY, 'POST', `/api/bookings/${hold.body.id}/confirm`, { session: owners.cleo, body: {} });
    await call(PRIMARY, 'POST', `/api/barn-days/${day.id}/start`, { session: farrier, body: {} });
    const visit = await call(PRIMARY, 'POST', `/api/bookings/${hold.body.id}/visit`, { session: farrier, body: {} });

    const sessions = await Promise.all(
      Array.from({ length: 7 }, (_, index) =>
        call(PRIMARY, 'POST', `/api/visits/${visit.body.id}/uploads`, {
          session: farrier,
          body: { hoof: (['LF', 'RF', 'LH', 'RH'] as const)[index % 4], phase: index < 4 ? 'after' : 'before', size_bytes: 8000000 },
        }),
      ),
    );
    const created = sessions.filter((session) => session.status === 201).length;
    const refused = sessions.filter(
      (session) => session.status === 409 && session.body.error === 'visit_quota_exceeded',
    ).length;
    check('six 8,000,000-byte sessions are created and one is refused',
      created === 6 && refused === 1, sessions.map((s) => [s.status, s.body.error]));
    check('the refusal names the bytes left',
      sessions.some((session) => typeof session.body.remaining_bytes === 'number'),
      sessions.map((s) => s.body.remaining_bytes));
  }

  console.log('\n== allowances and their headers ==');
  {
    const probe = await call(PRIMARY, 'PUT', '/api/my/card', {
      session: owners.ada,
      body: { card_token: 'tok_approve_4242' },
    });
    check('a payment-bucket route reports its allowance',
      probe.headers.get('ratelimit-limit') !== null &&
        probe.headers.get('ratelimit-remaining') !== null &&
        probe.headers.get('ratelimit-reset') !== null,
      {
        limit: probe.headers.get('ratelimit-limit'),
        remaining: probe.headers.get('ratelimit-remaining'),
        reset: probe.headers.get('ratelimit-reset'),
      });

    let limited: { status: number; body: any; headers: Headers } | null = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await call(PRIMARY, 'PUT', '/api/my/card', {
        session: owners.ada,
        body: { card_token: 'tok_approve_4242' },
      });
      if (response.status === 429) {
        limited = response;
        break;
      }
    }
    check('the allowance refuses with 429 once spent', limited !== null, limited?.status);
    if (limited !== null) {
      check('the refusal names its bucket and scope',
        limited.body.error === 'rate_limited' && limited.body.bucket === 'payment' && limited.body.scope === 'user',
        limited.body);
      check('it carries Retry-After', Number(limited.headers.get('retry-after')) >= 1,
        limited.headers.get('retry-after'));
    }
  }

  console.log('\n== the vet-link guess limit, shared across instances ==');
  {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await call(PRIMARY, 'GET', `/api/vet/miss-${attempt}-${Date.now()}`);
    }
    const blocked = await call(PRIMARY, 'GET', `/api/vet/another-${Date.now()}`);
    check('the eleventh read answers 429', blocked.status === 429 && blocked.body.error === 'rate_limited',
      blocked.body);
    check('it carries Retry-After', Number(blocked.headers.get('retry-after')) >= 1,
      blocked.headers.get('retry-after'));
    if (await reachable(PEER)) {
      const onPeer = await call(PEER, 'GET', `/api/vet/peer-${Date.now()}`);
      check('the limit holds on another instance too', onPeer.status === 429, onPeer.body);
    }
    await withClient((db) => query(db, 'DELETE FROM vet_link_misses'));
  }

  console.log('\n== a session reaches every instance ==');
  if (await reachable(PEER)) {
    const onPeer = await call(PEER, 'GET', '/api/me', { session: farrier });
    check('a cookie from the primary works on the peer',
      onPeer.status === 200 && onPeer.body.role === 'farrier', onPeer.body);
    const peerHorses = await call(PEER, 'GET', '/api/horses', { session: owners.ada });
    check('each caller gets only their own records',
      peerHorses.body.length === 2 && peerHorses.body.every((horse: any) => ['Juniper', 'Pilot'].includes(horse.name)),
      peerHorses.body.map((horse: any) => horse.name));
  }

  console.log('\n== closing a visit with billing unreachable ==');
  if (await reachable(KB_DOWN)) {
    const day = await makeDay(1, '22:45', larkspur.id);
    const hold = await call(PRIMARY, 'POST', `/api/barn-days/${day.id}/bookings`, {
      session: owners.dev,
      body: { slot_id: day.slots[0].id, horse_id: byName.get('Maple').id, card_token: 'tok_approve_4242' },
    });
    const kbSession = await signIn(KB_DOWN, 'farrier@clinchline.test');
    if (hold.status !== 201) {
      console.log('  (no slot was free for the billing-down walk)', hold.body);
    } else {
      await call(PRIMARY, 'POST', `/api/bookings/${hold.body.id}/confirm`, { session: owners.dev, body: {} });
      await call(PRIMARY, 'POST', `/api/barn-days/${day.id}/start`, { session: farrier, body: {} });
      const visit = await call(PRIMARY, 'POST', `/api/bookings/${hold.body.id}/visit`, { session: farrier, body: {} });
      const photo = multipart('LF', 'after', await hoofJpeg());
      await call(PRIMARY, 'POST', `/api/visits/${visit.body.id}/photos`, {
        session: farrier,
        raw: photo.body,
        contentType: photo.contentType,
      });

      // The close runs on the instance that cannot reach Kill Bill.
      const closed = await call(KB_DOWN, 'POST', `/api/visits/${visit.body.id}/close`, {
        session: kbSession,
        headers: { 'idempotency-key': key() },
        body: { work: ['trim'] },
      });
      check('the close still answers 200 with billing down',
        closed.status === 200 && closed.body.status === 'invoice_pending', { status: closed.status, body: closed.body?.status });
      check('its invoice reads pending with no Kill Bill id',
        closed.body.invoice?.status === 'pending' && closed.body.invoice?.killbill_invoice_id === null,
        closed.body.invoice);

      const payAttempt = await call(PRIMARY, 'POST', `/api/invoices/${closed.body.invoice.id}/payments`, {
        session: owners.dev,
        headers: { 'idempotency-key': key() },
        body: { card_token: 'tok_approve_4242' },
      });
      check('a payment on a pending invoice answers invoice_pending',
        payAttempt.status === 409 && payAttempt.body.error === 'invoice_pending', payAttempt.body);

      const atTen = await call(PRIMARY, 'GET', `/api/visits/${visit.body.id}`, { session: farrier });
      check('within the first seconds the visit still reads invoice_pending',
        atTen.body.status === 'invoice_pending', atTen.body.status);

      // After the hold-off, the reconciler on a reachable instance finishes it.
      let reconciled: any = null;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await sleep(1500);
        const refreshed = await call(PRIMARY, 'GET', `/api/visits/${visit.body.id}`, { session: farrier });
        if (refreshed.body.status === 'invoiced') {
          reconciled = refreshed.body;
          break;
        }
      }
      check('the pending invoice reaches billing on its own within the published delay',
        reconciled !== null, reconciled?.status);
      if (reconciled !== null) {
        check('it is in Kill Bill exactly once with an unpaid balance',
          reconciled.invoice.status === 'unpaid' && typeof reconciled.invoice.killbill_invoice_id === 'string',
          reconciled.invoice);
        const count = await withClient((db) =>
          query<{ count: number }>(
            db,
            `SELECT COUNT(*)::int AS count FROM invoices WHERE visit_id = $1`,
            [visit.body.id],
          ),
        );
        check('no second invoice was made', (count[0]?.count ?? 0) === 1, count[0]);
      }
    }
  } else {
    console.log('  (the billing-down instance is not running)');
  }

  console.log('\n== an email queued where Mailpit is unreachable ==');
  if (await reachable(MAIL_DOWN)) {
    const day = await makeDay(1);
    const mailSession = await signIn(MAIL_DOWN, 'owner.bram@clinchline.test');
    const hold = await call(MAIL_DOWN, 'POST', `/api/barn-days/${day.id}/bookings`, {
      session: mailSession,
      body: { slot_id: day.slots[0].id, horse_id: byName.get('Saffron').id, card_token: 'tok_approve_4242' },
    });
    if (hold.status === 201) {
      const confirmed = await call(MAIL_DOWN, 'POST', `/api/bookings/${hold.body.id}/confirm`, {
        session: mailSession,
        body: {},
      });
      check('the confirmation succeeds with mail down', confirmed.status === 200, confirmed.body);
      let delivered = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await sleep(1500);
        const rows = await withClient((db) =>
          query<{ status: string }>(db, `SELECT status FROM email_outbox WHERE dedupe_key = $1`, [
            `booking_confirmed:${hold.body.id}`,
          ]),
        );
        if (rows[0]?.status === 'sent') {
          delivered = true;
          break;
        }
      }
      check('the queued email is delivered once after the hold-off', delivered);
    } else {
      console.log('  (no slot was free for the mail-down walk)', hold.body);
    }
  } else {
    console.log('  (the mail-down instance is not running)');
  }

  console.log('\n== the import is applied whole ==');
  {
    const header = 'owner_name,owner_email,owner_phone,horse_name,barn_name,stall,cycle_weeks';
    // A fresh owner and stalls per run, so the suite can be walked again.
    const run = Date.now().toString(36).slice(-4);
    const email = `noor.${run}@clinchline.test`;
    const stallA = `A${run}`;
    const stallB = `B${run}`;
    const bad = [
      header,
      `Noor Vale,not-an-email,+1 303 555 0150,Ash${run},Cedar Hollow Stables,${stallA},6`,
      `Noor Vale,${email},+1 303 555 0150,Birch${run},Nowhere Barn,${stallB},9`,
    ].join('\n');
    const refused = await call(PRIMARY, 'POST', '/api/imports', {
      session: farrier,
      raw: Buffer.from(bad),
      contentType: 'text/csv',
      headers: { 'idempotency-key': key() },
    });
    check('a bad file answers import_invalid',
      refused.status === 422 && refused.body.error === 'import_invalid', refused.body);
    check('each bad cell is named by line, column and code',
      JSON.stringify(refused.body.errors) ===
        JSON.stringify([
          { line: 2, column: 'owner_email', code: 'invalid_email' },
          { line: 3, column: 'barn_name', code: 'unknown_barn' },
          { line: 3, column: 'cycle_weeks', code: 'cycle_out_of_range' },
        ]),
      refused.body.errors);
    const nothing = await withClient((db) =>
      query<{ count: number }>(db, 'SELECT COUNT(*)::int AS count FROM users WHERE email = $1', [email]),
    );
    check('nothing was written', (nothing[0]?.count ?? 0) === 0, nothing[0]);

    const good = [
      header,
      `Noor Vale,${email},+1 303 555 0150,Ash${run},Cedar Hollow Stables,${stallA},6`,
      `Noor Vale,${email},+1 303 555 0150,Birch${run},Larkspur Farm,${stallB},7`,
    ].join('\r\n');
    const first = await call(PRIMARY, 'POST', '/api/imports', {
      session: farrier,
      raw: Buffer.from(good),
      contentType: 'text/csv',
      headers: { 'idempotency-key': key() },
    });
    check('a good file creates the owner and horses',
      first.status === 201 && first.body.created_owners === 1 && first.body.created_horses === 2,
      first.body);

    // Two simultaneous imports of one file with different keys.
    const again = await Promise.all([
      call(PRIMARY, 'POST', '/api/imports', {
        session: farrier,
        raw: Buffer.from(good),
        contentType: 'text/csv',
        headers: { 'idempotency-key': key() },
      }),
      call(PRIMARY, 'POST', '/api/imports', {
        session: farrier,
        raw: Buffer.from(good),
        contentType: 'text/csv',
        headers: { 'idempotency-key': key() },
      }),
    ]);
    check('both simultaneous re-imports answer 201',
      again.every((response) => response.status === 201), again.map((r) => [r.status, r.body.error]));
    check('they create nothing new',
      again.every((response) => response.body.created_owners === 0 && response.body.created_horses === 0),
      again.map((r) => r.body));
    const duplicates = await withClient((db) =>
      query<{ count: number }>(
        db,
        `SELECT COUNT(*)::int AS count FROM horses h JOIN users u ON u.id = h.owner_id
         WHERE u.email = $1`,
        [email],
      ),
    );
    check('no duplicate owner or horse exists', (duplicates[0]?.count ?? 0) === 2, duplicates[0]);

    const mismatch = [
      header,
      `Different Name,${email},+1 303 555 0150,Ash${run},Cedar Hollow Stables,${stallA},6`,
    ].join('\n');
    const nameClash = await call(PRIMARY, 'POST', '/api/imports', {
      session: farrier,
      raw: Buffer.from(mismatch),
      contentType: 'text/csv',
      headers: { 'idempotency-key': key() },
    });
    check('a changed owner name is refused with owner_name_mismatch',
      nameClash.status === 422 &&
        nameClash.body.errors?.[0]?.code === 'owner_name_mismatch' &&
        nameClash.body.errors?.[0]?.column === 'owner_name',
      nameClash.body.errors);

    const badHeader = await call(PRIMARY, 'POST', '/api/imports', {
      session: farrier,
      raw: Buffer.from('a,b,c\n1,2,3'),
      contentType: 'text/csv',
      headers: { 'idempotency-key': key() },
    });
    check('a wrong header answers one bad_header error on line 1',
      badHeader.status === 422 &&
        JSON.stringify(badHeader.body.errors) ===
          JSON.stringify([{ line: 1, column: 'header', code: 'bad_header' }]),
      badHeader.body.errors);

    const newOwner = await signIn(PRIMARY, email);
    const asNoor = await call(PRIMARY, 'GET', '/api/horses', { session: newOwner });
    check('the imported owner can sign in with the default password',
      asNoor.status === 200 && asNoor.body.length === 2, asNoor.body);
  }

  console.log('\n== the audit log refuses an edit ==');
  {
    let refused = false;
    try {
      await withClient((db) => query(db, `UPDATE audit_log SET action = 'tampered' WHERE true`));
    } catch {
      refused = true;
    }
    check('the database refuses an update to the audit log', refused);
    let deleteRefused = false;
    try {
      await withClient((db) => query(db, 'DELETE FROM audit_log WHERE true'));
    } catch {
      deleteRefused = true;
    }
    check('and refuses a delete', deleteRefused);
  }

  console.log(`\nfailures: ${failures}`);
  await pool.end();
  if (failures > 0) process.exitCode = 1;
}

await main();
