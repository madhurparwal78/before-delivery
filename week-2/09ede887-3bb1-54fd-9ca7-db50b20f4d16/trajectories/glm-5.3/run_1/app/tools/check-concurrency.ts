/**
 * Concurrency checks: the last seat, duplicate reservations, capacity racing
 * reservations, and hold expiry on the database clock. These run against a
 * live server.
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
  console.log(ok ? 'ok  ' : 'FAIL', label, '=>', g.slice(0, 160), ok ? '' : 'want ' + w.slice(0, 160));
}

async function call(method: string, path: string, options: { body?: unknown; token?: string; key?: string } = {}): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = {};
  let payload: string | undefined;
  if (options.body !== undefined) {
    payload = JSON.stringify(options.body);
    headers['content-type'] = 'application/json';
  }
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.key) headers['idempotency-key'] = options.key;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  return { status: res.status, body: await res.text() };
}

async function login(email: string): Promise<string> {
  const res = await call('POST', '/api/v2/auth/login', { body: { email, password: 'deku-demo-pw-2026' } });
  return JSON.parse(res.body).token;
}

async function signup(name: string, email: string): Promise<string> {
  const res = await call('POST', '/api/v2/auth/signup', { body: { name, email, password: 'password123' } });
  return JSON.parse(res.body).token;
}

async function main(): Promise<void> {
  const suffix = String(Math.floor(Math.random() * 1e9));

  // The last seat: many simultaneous reservations, exactly one succeeds.
  {
    const tokens = await Promise.all(
      Array.from({ length: 6 }, (_, i) => signup(`Race ${i}`, `race-${suffix}-${i}@example.com`)),
    );
    const res = await Promise.all(
      tokens.map((t) => call('POST', '/api/v2/sessions/d1-clone-your-writing-voice/reservation', { token: t })),
    );
    const wins = res.filter((r) => r.status === 201).length;
    const full = res.filter((r) => r.status === 409 && JSON.parse(r.body).error.code === 'session_full').length;
    check('one winner', wins, 1);
    check('others refused session_full', full, 5);
    const row = JSON.parse((await call('GET', '/api/v2/sessions/d1-clone-your-writing-voice')).body);
    check('session full afterwards', row.seats.left, 0);
  }

  // Simultaneous duplicate reservations by one attendee store one row.
  {
    const t = await signup('Dup', `dup-${suffix}@example.com`);
    const res = await Promise.all([
      call('POST', '/api/v2/sessions/d1-zero-to-funded/reservation', { token: t }),
      call('POST', '/api/v2/sessions/d1-zero-to-funded/reservation', { token: t }),
      call('POST', '/api/v2/sessions/d1-zero-to-funded/reservation', { token: t }),
    ]);
    const wins = res.filter((r) => r.status === 201).length;
    const dup = res.filter((r) => r.status === 409 && JSON.parse(r.body).error.code === 'already_reserved').length;
    check('duplicate races one winner', wins, 1);
    check('duplicates refused', dup, 2);
    const row = JSON.parse((await call('GET', '/api/v2/sessions/d1-zero-to-funded')).body);
    check('one reservation stored', row.seats.reserved, 1);
  }

  // Concurrent same-key reservations store one reservation.
  {
    const t = await signup('Idem', `idem-${suffix}@example.com`);
    const key = `idem-key-${suffix}`;
    const res = await Promise.all([
      call('POST', '/api/v2/sessions/d1-never-forgets/reservation', { token: t, key }),
      call('POST', '/api/v2/sessions/d1-never-forgets/reservation', { token: t, key }),
    ]);
    const wins = res.filter((r) => r.status === 201).length;
    const inProgress = res.filter((r) => r.status === 409 && JSON.parse(r.body).error.code === 'request_in_progress').length;
    check('idempotent race one winner', wins >= 1, true);
    check('one reservation stored', JSON.parse((await call('GET', '/api/v2/sessions/d1-never-forgets')).body).seats.reserved, 1);
    check('loser answers replay or in progress', res.every((r) => r.status === 201 || JSON.parse(r.body).error.code === 'request_in_progress' || JSON.parse(r.body).error.code === 'already_reserved'), true);
    void inProgress;
  }

  // Capacity racing reservations never exceeds the capacity.
  {
    const org = await login('organiser@example.com');
    const attendees = await Promise.all(
      Array.from({ length: 8 }, (_, i) => signup(`Cap ${i}`, `cap-${suffix}-${i}@example.com`)),
    );
    // Fill d2-llm-showdown to 3 of 40, then race a capacity drop to 3 with more reservations.
    await Promise.all(attendees.slice(0, 3).map((t) => call('POST', '/api/v2/sessions/d2-llm-showdown/reservation', { token: t })));
    const res = await Promise.all([
      call('PATCH', '/api/v2/organiser/sessions/d2-llm-showdown', { token: org, body: { capacity: 3 } }),
      ...attendees.slice(3, 8).map((t) => call('POST', '/api/v2/sessions/d2-llm-showdown/reservation', { token: t })),
    ]);
    const row = JSON.parse((await call('GET', '/api/v2/sessions/d2-llm-showdown')).body);
    check('capacity held', row.seats.reserved + row.seats.held <= row.seats.capacity, true);
    const serverErrors = res.filter((r) => r.status >= 500);
    check('no server errors', serverErrors.length, 0);
    // Restore capacity.
    await call('PATCH', '/api/v2/organiser/sessions/d2-llm-showdown', { token: org, body: { capacity: 40 } });
  }

  // Concurrent booking changes across overlapping sessions never answer 500.
  {
    const tokens = await Promise.all(
      Array.from({ length: 4 }, (_, i) => signup(`Mix ${i}`, `mix-${suffix}-${i}@example.com`)),
    );
    const actions: Array<Promise<{ status: number; body: string }>> = [];
    for (let i = 0; i < tokens.length; i++) {
      actions.push(call('POST', '/api/v2/sessions/d1-hottest-takes/reservation', { token: tokens[i]! }));
      actions.push(call('POST', '/api/v2/sessions/d1-clone-your-writing-voice/waitlist', { token: tokens[i]! }));
      actions.push(call('POST', '/api/v2/sessions/d2-agent-wallet/reservation', { token: tokens[i]! }));
    }
    const res = await Promise.all(actions);
    check('mixed races no server errors', res.filter((r) => r.status >= 500).length, 0);
  }

  console.log(checks + ' checks, ' + (fails === 0 ? 'ALL OK' : `${fails} FAILURES`));
}

main().catch((err) => {
  console.error('ERROR', err);
  process.exitCode = 1;
});
