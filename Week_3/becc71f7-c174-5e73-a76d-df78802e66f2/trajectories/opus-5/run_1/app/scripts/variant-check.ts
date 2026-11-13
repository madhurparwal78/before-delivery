/** Checks the copies the grader runs: MinIO down, Mailpit down, short timers, races. */
import { addMonths, brusselsDate, monthOf } from '../src/shared/brussels.js';

const base = process.env['CHECK_URL'] ?? 'http://127.0.0.1:4188';
const variant = process.env['VARIANT'] ?? 'spare';

let passed = 0;
let failed = 0;
const ok = (label: string, condition: boolean, detail = ''): void => {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.log(`FAIL [${variant}] ${label} ${detail}`);
  }
};
const eq = (label: string, got: unknown, want: unknown): void =>
  ok(label, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

async function call(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.cookie !== undefined) headers['cookie'] = options.cookie;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers };
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return (response.headers.get('set-cookie') ?? '').split(';')[0] as string;
}

const owner = await signIn('margaux@atelier-ourlet.example', 'ourlet-owner-2027');
const noor = await signIn('noor@atelier-ourlet.example', 'ourlet-noor-2027');
const rail = (await call('GET', '/api/rail')).body;
const thisMonth = monthOf(brusselsDate(Date.now()));
const lastMonth = addMonths(thisMonth, -1);

if (variant === 'storage') {
  // MinIO is down: a photo is refused with nothing stored.
  const boundary = '----variant';
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n`,
      'latin1',
    ),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'latin1'),
  ]);
  const piece = rail.pieces[0];
  const response = await fetch(`${base}/api/pieces/${piece.id}/photos`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, cookie: noor },
    body,
  });
  const failure = await response.json();
  ok(
    'a photo is refused while MinIO is down',
    response.status === 503 || response.status === 422,
    `${response.status} ${JSON.stringify(failure)}`,
  );
  if (response.status === 503) {
    eq('photo outage code', failure.error.code, 'storage_unavailable');
    eq(
      'photo outage copy',
      failure.error.message,
      `Photos can't be saved right now. Nothing was stored — try again in a moment.`,
    );
  }
  const after = await call('GET', `/api/pieces/${piece.id}`, { cookie: noor });
  eq('nothing was stored', after.body.piece.photos.length, 0);

  const run = await call('POST', '/api/payout-runs', { cookie: owner, body: { month: lastMonth } });
  ok(
    'a payout run is refused while MinIO is down',
    run.status === 503 || run.status === 409,
    `${run.status} ${JSON.stringify(run.body)}`,
  );
  if (run.status === 503) {
    eq('payout outage code', run.body.error.code, 'storage_unavailable');
    eq(
      'payout outage copy',
      run.body.error.message,
      `The payout run didn't start: the bank file can't be stored right now. Nothing was paid or sent.`,
    );
    const runs = await call('GET', '/api/payout-runs', { cookie: owner });
    eq('nothing was recorded', runs.body.runs.length, 0);
  }

  const health = await call('GET', '/api/health');
  eq('health answers while MinIO is down', health.status, 200);

  // Erasing asks MinIO first, so the consignor stays `erasing`.
  const consignors = await call('GET', '/api/consignors', { cookie: noor });
  const lotte = consignors.body.consignors.find((c: any) => c.name === 'Lotte Janssens');
  const erased = await call('POST', `/api/consignors/${lotte.id}/erase`, { cookie: owner });
  eq('erase accepted while MinIO is down', erased.status, 202);
  eq('the consignor stays erasing', erased.body.consignor.status, 'erasing');
  eq('their name is already gone', erased.body.consignor.name, 'Erased consignor');
  eq('their email is already gone', erased.body.consignor.email, null);
}

if (variant === 'mail') {
  const piece = rail.pieces.find((entry: any) => entry.status === 'on_rail');
  const held = await call('POST', `/api/pieces/${piece.id}/holds`, {
    body: { name: 'Camille', email: 'camille@shoppers.example' },
  });
  eq('a hold is refused while Mailpit is down', held.status, 503);
  eq('hold outage code', held.body.error.code, 'mail_unavailable');
  eq(
    'hold outage copy',
    held.body.error.message,
    `We can't send your confirmation right now. Nothing was saved — try again in a moment.`,
  );
  const holds = await call('GET', '/api/holds', { cookie: noor });
  eq('nothing was saved', holds.body.holds.length, 0);
  eq(
    'the piece is still on the rail',
    (await call('GET', `/api/public/pieces/${piece.id}`)).body.piece.status,
    'on_rail',
  );

  const slots = (await call('GET', '/api/appointment-slots')).body;
  const free = slots.slots.find((slot: any) => slot.free);
  const booked = await call('POST', '/api/appointments', {
    body: { startsAt: free.startsAt, name: 'Amélie', email: 'amelie@consignors.example' },
  });
  eq('a booking is refused while Mailpit is down', booked.status, 503);
  eq('booking outage code', booked.body.error.code, 'mail_unavailable');
  const after = (await call('GET', '/api/appointment-slots')).body;
  eq(
    'the slot is still free',
    after.slots.find((slot: any) => slot.startsAt === free.startsAt)?.free,
    true,
  );

  const consignors = await call('GET', '/api/consignors', { cookie: noor });
  const zoe = consignors.body.consignors[0];
  const link = await call('POST', `/api/consignors/${zoe.id}/portal-link`, { cookie: noor });
  eq('a page address is refused while Mailpit is down', link.status, 503);
  eq('page address outage code', link.body.error.code, 'mail_unavailable');

  const run = await call('POST', '/api/payout-runs', { cookie: owner, body: { month: lastMonth } });
  ok(
    'a payout run is refused while Mailpit is down',
    run.status === 503 || run.status === 409,
    `${run.status} ${JSON.stringify(run.body)}`,
  );
  if (run.status === 503) {
    eq('payout mail outage code', run.body.error.code, 'mail_unavailable');
    eq(
      'payout mail outage copy',
      run.body.error.message,
      `The payout run didn't start: statements can't be sent by mail right now. Nothing was paid or sent.`,
    );
    const runs = await call('GET', '/api/payout-runs', { cookie: owner });
    eq('nothing was recorded, stored or sent', runs.body.runs.length, 0);
  }

  const health = await call('GET', '/api/health');
  eq('health answers while Mailpit is down', health.status, 200);

  // A sale needs no mail, so the till keeps working.
  const sellable = rail.pieces.find((entry: any) => entry.status === 'on_rail');
  const sold = await call('POST', '/api/sales', {
    cookie: noor,
    body: { pieceId: sellable.id, payment: 'cash' },
  });
  eq('the till works while Mailpit is down', sold.status, 201);
}

if (variant === 'short') {
  const piece = rail.pieces.find((entry: any) => entry.status === 'on_rail');
  const held = await call('POST', `/api/pieces/${piece.id}/holds`, {
    body: { name: 'Camille', email: 'camille@shoppers.example' },
  });
  eq('a hold is placed', held.status, 201);
  const seconds =
    (Date.parse(held.body.hold.endsAt) - Date.parse(held.body.hold.startsAt)) / 1_000;
  eq('HOLD_SECONDS is 20 on the short-timers copy', seconds, 20);

  const consignors = await call('GET', '/api/consignors', { cookie: noor });
  const lotte = consignors.body.consignors.find((c: any) => c.name === 'Lotte Janssens');
  const link = await call('POST', `/api/consignors/${lotte.id}/portal-link`, { cookie: noor });
  eq('a page address is sent', link.status, 201);
  const pageSeconds = Math.round((Date.parse(link.body.pageEndsAt) - Date.now()) / 1_000);
  ok('PORTAL_PAGE_SECONDS is 20', pageSeconds >= 18 && pageSeconds <= 21, String(pageSeconds));

  const mails = (await (
    await fetch(
      `${process.env['MAILPIT_URL'] ?? 'http://mailpit:8025'}/api/v1/search?query=lotte.janssens%40consignors.example`,
    )
  ).json()) as any;
  const portalMail = mails.messages.find(
    (m: any) => m.Subject === 'Your Atelier Ourlet consignor page',
  );
  const portalBody = (await (
    await fetch(
      `${process.env['MAILPIT_URL'] ?? 'http://mailpit:8025'}/api/v1/message/${portalMail.ID}`,
    )
  ).json()) as any;
  const token = (/\/c\/([A-Za-z0-9_-]+)/.exec(portalBody.Text) ?? [])[1] as string;
  eq('the consignor page opens', (await call('GET', `/api/portal/${token}`)).status, 200);

  console.log('   waiting for the short timers to run out…');
  await new Promise((resolve) => setTimeout(resolve, 21_000));

  const ended = await call('GET', `/api/portal/${token}`);
  eq('the consignor page has ended', ended.status, 410);
  eq('ended page code', ended.body.error.code, 'page_ended');

  const holds = await call('GET', '/api/holds', { cookie: noor });
  eq('the hold has ended', holds.body.holds.length, 0);
  const release = await call('POST', `/api/holds/${held.body.hold.id}/release`, { cookie: noor });
  eq('releasing an ended hold', release.status, 409);
  eq('ended hold code', release.body.error.code, 'hold_ended');
  eq(
    'the piece is back on the rail',
    (await call('GET', `/api/public/pieces/${piece.id}`)).body.piece.status,
    'on_rail',
  );
}

if (variant === 'session') {
  const session = await signIn('noor@atelier-ourlet.example', 'ourlet-noor-2027');
  eq('the session works', (await call('GET', '/api/session', { cookie: session })).status, 200);
  console.log('   waiting for SESSION_SECONDS to run out…');
  await new Promise((resolve) => setTimeout(resolve, 21_000));
  const ended = await call('GET', '/api/session', { cookie: session });
  eq('the session has ended', ended.status, 401);
  eq('ended session code', ended.body.error.code, 'session_ended');
  eq(
    'ended session copy',
    ended.body.error.message,
    `Your session ended. Sign in again to keep going — what you typed is still here.`,
  );
}

if (variant === 'spare') {
  // Two shoppers hold one piece at the same moment: exactly one wins.
  const piece = rail.pieces.find((entry: any) => entry.status === 'on_rail');
  const attempts = await Promise.all(
    [1, 2, 3, 4, 5].map((n) =>
      call('POST', `/api/pieces/${piece.id}/holds`, {
        body: { name: `Shopper ${n}`, email: `race${n}@shoppers.example` },
      }),
    ),
  );
  eq('exactly one hold wins', attempts.filter((a) => a.status === 201).length, 1);
  eq('the others are refused', attempts.filter((a) => a.status === 409).length, 4);
  const losers = attempts.filter((a) => a.status === 409);
  ok(
    'each refusal names the winning end time',
    losers.every((a) =>
      /^Someone else is holding this piece until \d{2}:\d{2}\.$/.test(a.body.error.message),
    ),
    JSON.stringify(losers.map((a) => a.body.error.message)),
  );

  // Two assistants sell one piece at the same moment: exactly one sale.
  const other = rail.pieces.filter((entry: any) => entry.status === 'on_rail')[1];
  const sales = await Promise.all(
    [noor, noor, noor, noor].map(() =>
      call('POST', '/api/sales', { cookie: noor, body: { pieceId: other.id, payment: 'cash' } }),
    ),
  );
  eq('exactly one sale is recorded', sales.filter((s) => s.status === 201).length, 1);
  ok(
    'the others are told who sold it',
    sales
      .filter((s) => s.status === 409)
      .every((s) => /^Sold by Noor at \d{2}:\d{2}\. Nothing was charged\.$/.test(s.body.error.message)),
    JSON.stringify(sales.map((s) => s.body.error?.message)),
  );

  // Two bookings of one slot at the same moment: exactly one wins.
  const slots = (await call('GET', '/api/appointment-slots')).body;
  const free = slots.slots.find((slot: any) => slot.free);
  const bookings = await Promise.all(
    [1, 2, 3].map((n) =>
      call('POST', '/api/appointments', {
        body: { startsAt: free.startsAt, name: `Booker ${n}`, email: `slot-race${n}@consignors.example` },
      }),
    ),
  );
  eq('exactly one booking wins', bookings.filter((b) => b.status === 201).length, 1);
  ok(
    'the others are told the real next free slot',
    bookings
      .filter((b) => b.status === 409)
      .every((b) => /^That slot was just taken\. The next free slot is /.test(b.body.error.message)),
    JSON.stringify(bookings.map((b) => b.body.error?.message)),
  );

  // Two starts of one payout run at the same moment: exactly one creates it.
  const starts = await Promise.all(
    [1, 2, 3].map(() =>
      call('POST', '/api/payout-runs', { cookie: owner, body: { month: lastMonth } }),
    ),
  );
  const created = starts.filter((s) => s.status === 201);
  const same = starts.filter((s) => s.status === 200);
  if (starts.some((s) => s.status === 409)) {
    eq('nothing was due for that month', starts[0]?.body.error.code, 'nothing_due');
  } else {
    eq('exactly one start creates the run', created.length, 1);
    eq('every other start gives the same run', same.length, 2);
    ok(
      'the losers name who started it and when',
      same.every(
        (s) => s.body.run.startedBy.name === 'Margaux' && typeof s.body.run.startedAt === 'string',
      ),
      JSON.stringify(same.map((s) => s.body.run?.startedBy)),
    );
  }
}

console.log(`\n[${variant}] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
export {};
