/**
 * Hold expiry on the database clock. With HOLD_SECONDS small: a freed seat is
 * held, the hold ends while no request runs, and the next read settles it and
 * passes the seat on. Claims and releases after the end answer hold_expired.
 */

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';

let fails = 0;
let checks = 0;
function check(label: string, got: unknown, want: unknown): void {
  checks++;
  const g = JSON.stringify(got) ?? 'undefined';
  const w = JSON.stringify(want) ?? 'undefined';
  const ok = g === w;
  if (!ok) fails++;
  console.log(ok ? 'ok  ' : 'FAIL', label, '=>', g.slice(0, 180), ok ? '' : 'want ' + w.slice(0, 180));
}

async function call(method: string, path: string, options: { body?: unknown; token?: string } = {}): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = {};
  let payload: string | undefined;
  if (options.body !== undefined) {
    payload = JSON.stringify(options.body);
    headers['content-type'] = 'application/json';
  }
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  return { status: res.status, body: await res.text() };
}

async function login(email: string): Promise<string> {
  return JSON.parse((await call('POST', '/api/v2/auth/login', { body: { email, password: 'deku-demo-pw-2026' } })).body).token;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const quinn = await login('attendee3@example.com');
  const avery = await login('attendee@example.com');
  const rowan = await login('attendee2@example.com');
  const holder = JSON.parse(
    (await call('POST', '/api/v2/auth/signup', { body: { name: 'Hold Holder', email: `holder-${Date.now()}@example.com`, password: 'password123' } })).body,
  ).token;

  // Fill Clone Your Writing Voice: Quinn holds one, Rowan takes the last seat.
  check('Rowan takes the last seat', (await call('POST', '/api/v2/sessions/d1-clone-your-writing-voice/reservation', { token: rowan })).status, 201);

  // Avery waits, then blocks themselves with Hottest Takes.
  check('Avery joins the waitlist', (await call('POST', '/api/v2/sessions/d1-clone-your-writing-voice/waitlist', { token: avery })).status, 201);
  check('Avery takes Hottest Takes', (await call('POST', '/api/v2/sessions/d1-hottest-takes/reservation', { token: avery })).status, 201);

  // The holder waits behind Avery.
  check('Holder joins the waitlist', (await call('POST', '/api/v2/sessions/d1-clone-your-writing-voice/waitlist', { token: holder })).status, 201);

  // Quinn cancels: Avery is ineligible, so the holder gets the hold.
  check('Quinn cancels', (await call('DELETE', '/api/v2/sessions/d1-clone-your-writing-voice/reservation', { token: quinn })).status, 200);
  let row = JSON.parse((await call('GET', '/api/v2/sessions/d1-clone-your-writing-voice', { token: holder })).body);
  check('holder holds the seat', row.my_hold !== null, true);
  check('seat held', row.seats, { capacity: 2, reserved: 1, held: 1, left: 0 });

  // Wait past the hold period with no requests running.
  await sleep(4000);

  // The next read settles the hold and passes the seat on. Avery is still
  // ineligible, so the seat stays open for a direct reservation.
  row = JSON.parse((await call('GET', '/api/v2/sessions/d1-clone-your-writing-voice', { token: avery })).body);
  check('hold settled by the next read', row.seats, { capacity: 2, reserved: 1, held: 0, left: 1 });

  // Claiming or releasing after the end answers hold_expired.
  const lateClaim = await call('POST', '/api/v2/sessions/d1-clone-your-writing-voice/claim', { token: holder });
  check('claim after expiry refused', lateClaim.status, 409);
  check('claim hold_expired', JSON.parse(lateClaim.body).error.code, 'hold_expired');
  const lateRelease = await call('DELETE', '/api/v2/sessions/d1-clone-your-writing-voice/hold', { token: holder });
  check('release after expiry refused', lateRelease.status, 409);
  check('release hold_expired', JSON.parse(lateRelease.body).error.code, 'hold_expired');

  // Avery cancels Hottest Takes: in the same step Avery holds the seat they wait for.
  check('Avery cancels Hottest Takes', (await call('DELETE', '/api/v2/sessions/d1-hottest-takes/reservation', { token: avery })).status, 200);
  row = JSON.parse((await call('GET', '/api/v2/sessions/d1-clone-your-writing-voice', { token: avery })).body);
  check('Avery holds in the same step', row.my_hold !== null, true);
  check('off the waitlist', row.waitlist_position, null);
  check('seat held for Avery', row.seats, { capacity: 2, reserved: 1, held: 1, left: 0 });

  // Avery claims.
  check('Avery claims', (await call('POST', '/api/v2/sessions/d1-clone-your-writing-voice/claim', { token: avery })).status, 201);
  row = JSON.parse((await call('GET', '/api/v2/sessions/d1-clone-your-writing-voice')).body);
  check('claimed', row.seats, { capacity: 2, reserved: 2, held: 0, left: 0 });

  console.log(checks + ' checks, ' + (fails === 0 ? 'ALL OK' : `${fails} FAILURES`));
}

main().catch((err) => {
  console.error('ERROR', err);
  process.exitCode = 1;
});
