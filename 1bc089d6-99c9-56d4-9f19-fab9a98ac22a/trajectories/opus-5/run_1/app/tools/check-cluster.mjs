// Two instances against one database: one clock, one reminder, one email.
import { spawn } from 'node:child_process';

const FIRST = process.env.CHECK_BASE ?? 'http://127.0.0.1:4173';
const SECOND_PORT = 4175;
const SECOND = `http://127.0.0.1:${SECOND_PORT}`;
const MAILPIT = process.env.MAILPIT_URL ?? 'http://mailpit:8025';

let passed = 0;
const failures = [];
const check = (name, condition, detail) => {
  if (condition) passed += 1;
  else {
    failures.push(name);
    console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300));
  }
};
const eq = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });

const sleep = (millis) => new Promise((resolve) => setTimeout(resolve, millis));

async function api(base, method, path, options = {}) {
  const headers = { ...options.headers };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let json;
  try {
    json = text === '' ? undefined : JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, json, headers: response.headers };
}

const cookieOf = (response) =>
  (response.headers.getSetCookie?.() ?? []).find((line) => line.startsWith('stillhour_session='))?.split(';')[0];

const mail = {
  clear: () => fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' }),
  async to(address) {
    const body = await (await fetch(`${MAILPIT}/api/v1/messages?limit=200`)).json();
    return (body.messages ?? []).filter((message) => message.To.some((it) => it.Address === address));
  },
  async tokenFor(address) {
    const [message] = await this.to(address);
    if (!message) return null;
    const detail = await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json();
    return /token=([A-Za-z0-9_-]+)/.exec(detail.Text ?? '')?.[1] ?? null;
  },
};

const unique = () => Math.random().toString(36).slice(2, 9);

async function run() {
  const server = spawn('node', ['dist/server/index.js'], {
    env: { ...process.env, APP_PUBLIC_PORT: String(SECOND_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.resume();
  server.stderr.resume();
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        if ((await api(SECOND, 'GET', '/api/health')).status === 200) break;
      } catch {
        // still starting
      }
      await sleep(250);
    }

    // One clock for both instances.
    await api(FIRST, 'PUT', '/api/test/clock', { body: { now: '2026-11-20T09:00:00Z' } });
    await sleep(1100);
    const email = `pair-${unique()}@example.com`;
    await mail.clear();
    const saved = await api(SECOND, 'POST', '/api/plans', {
      body: {
        email,
        bedtime: '23:00',
        time_zone: 'Europe/London',
        rituals: [{ id: 'breathe', minutes: 5 }],
        note: '',
      },
      headers: { 'Idempotency-Key': `pair-${unique()}-key` },
    });
    eq('the second instance saves', saved.status, 202);
    const token = await mail.tokenFor(email);
    const verified = await api(FIRST, 'POST', '/api/session/verify', { body: { token } });
    eq('the first instance confirms it', verified.status, 200);
    const cookie = cookieOf(verified);

    const onSecond = await api(SECOND, 'GET', '/api/me/plan', { headers: { cookie } });
    eq('a session made on one instance works on the other', onSecond.status, 200);
    eq(
      'both instances agree on the next reminder',
      onSecond.json.plan.next_reminder_at,
      '2026-11-20T22:00:00.000Z',
    );

    // Both schedulers meet the same due night.
    await mail.clear();
    const together = await Promise.all([
      api(FIRST, 'PUT', '/api/test/clock', { body: { now: '2026-11-20T22:00:00Z' } }),
      api(SECOND, 'PUT', '/api/test/clock', { body: { now: '2026-11-20T22:00:00Z' } }),
    ]);
    eq('both clocks answer', together.map((answer) => answer.status), [200, 200]);
    await sleep(1500);
    const letters = await mail.to(email);
    eq('exactly one reminder from two instances', letters.length, 1);
    eq('the reminder names the local start', letters[0]?.Subject, 'Your Stillhour starts at 22:00');

    await sleep(31_000);
    eq('the running schedulers do not send a second', (await mail.to(email)).length, 1);

    await api(FIRST, 'DELETE', '/api/me', { headers: { cookie } });
    await api(FIRST, 'DELETE', '/api/test/clock');
  } finally {
    server.kill('SIGTERM');
  }
  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  if (failures.length > 0) process.exitCode = 1;
}

await run();
