// Takes the database and the mail service away and brings them back, through TCP proxies.
import { spawn } from 'node:child_process';
import net from 'node:net';
import { chromium } from 'playwright';

const PORT = 4174;
const BASE = `http://127.0.0.1:${PORT}`;
const MAILPIT = process.env.MAILPIT_URL ?? 'http://mailpit:8025';
const DB_PROXY = 55_432;
const MAIL_PROXY = 51_025;

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

function proxy(listenPort, host, port) {
  const sockets = new Set();
  const server = net.createServer((incoming) => {
    const outgoing = net.connect(port, host);
    sockets.add(incoming);
    sockets.add(outgoing);
    incoming.pipe(outgoing);
    outgoing.pipe(incoming);
    const bye = () => {
      incoming.destroy();
      outgoing.destroy();
      sockets.delete(incoming);
      sockets.delete(outgoing);
    };
    incoming.on('error', bye);
    outgoing.on('error', bye);
    incoming.on('close', bye);
    outgoing.on('close', bye);
  });
  return {
    open: () => new Promise((resolve) => server.listen(listenPort, '127.0.0.1', resolve)),
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        sockets.clear();
        server.close(() => resolve());
      }),
  };
}

const sleep = (millis) => new Promise((resolve) => setTimeout(resolve, millis));

async function api(method, path, options = {}) {
  const headers = { ...options.headers };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const started = Date.now();
  const response = await fetch(`${BASE}${path}`, {
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
  return { status: response.status, json, text, millis: Date.now() - started };
}

const mailTo = async (address) => {
  const body = await (await fetch(`${MAILPIT}/api/v1/messages?limit=200`)).json();
  return (body.messages ?? []).filter((message) => message.To.some((it) => it.Address === address));
};

const unique = () => Math.random().toString(36).slice(2, 9);
const plan = (email) => ({
  email,
  bedtime: '23:00',
  time_zone: 'Europe/London',
  rituals: [{ id: 'breathe', minutes: 5 }],
  note: 'Kept on the page.',
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const answer = await api('GET', '/api/health');
      if (answer.status === 200) return;
    } catch {
      // not listening yet
    }
    await sleep(250);
  }
  throw new Error('the server never became healthy');
}

/** A visitor who arrives while the database is down still gets the whole story. */
async function visitorDuringOutage() {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const problems = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Begin in silence' }).click({ timeout: 20_000 });
  await page.waitForTimeout(800);

  check('the story loads with the database down', (await page.getByRole('heading', { level: 1 }).count()) === 1);
  for (const heading of ['The hour nobody plans.', 'Build your hour.', 'Plan your Stillhour.']) {
    check(`chapter present during the outage: ${heading}`, (await page.getByRole('region', { name: heading }).count()) === 1);
  }
  eq(
    'the live count rests',
    await page.locator('#live-count').textContent(),
    'Tonight, people everywhere are keeping a Stillhour.',
  );

  const note = 'Everything stays on the page.';
  await page.getByRole('button', { name: 'Add Breathe to my hour' }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Add Breathe to my hour' }).click();
  await page.getByRole('textbox', { name: 'Email' }).fill('mira@example.com');
  await page.getByRole('textbox', { name: 'A note for tonight' }).fill(note);
  await page.getByRole('button', { name: 'Save my hour' }).click();
  const status = page.getByRole('status', { name: 'Planner status' });
  await status.filter({ hasText: 'unavailable' }).waitFor({ timeout: 10_000 });
  eq(
    'the planner announces the unavailable message',
    await status.textContent(),
    'Saving is unavailable right now. Your choices are still on this page; try again in a minute.',
  );
  eq('the email is kept', await page.getByRole('textbox', { name: 'Email' }).inputValue(), 'mira@example.com');
  eq('the note is kept', await page.getByRole('textbox', { name: 'A note for tonight' }).inputValue(), note);
  eq('the rituals are kept', await page.getByRole('checkbox', { name: 'Breathe' }).isChecked(), true);
  eq('no page errors during the outage', problems, []);
  await browser.close();
}

async function run() {
  const database = proxy(DB_PROXY, 'postgres', 5432);
  const mail = proxy(MAIL_PROXY, 'mailpit', 1025);
  await database.open();
  await mail.open();

  const url = new URL(process.env.DATABASE_URL);
  const server = spawn('node', ['dist/server/index.js'], {
    env: {
      ...process.env,
      APP_PUBLIC_PORT: String(PORT),
      DATABASE_URL: `postgresql://${url.username}:${url.password}@127.0.0.1:${DB_PROXY}${url.pathname}`,
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(MAIL_PROXY),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (chunk) => (log += chunk));
  server.stderr.on('data', (chunk) => (log += chunk));

  try {
    await waitForHealth();

    // ---- the mail service goes away ----
    const queuedEmail = `queued-${unique()}@example.com`;
    await mail.close();
    const queued = await api('POST', '/api/plans', {
      body: plan(queuedEmail),
      headers: { 'Idempotency-Key': `queued-${unique()}-key` },
    });
    eq('a save with mail down is queued', [queued.status, queued.json], [202, { status: 'confirmation_queued' }]);
    check('a queued save still answers quickly', queued.millis < 2000, queued.millis);
    eq('nothing is delivered while mail is down', (await mailTo(queuedEmail)).length, 0);
    const stillSignIn = await api('POST', '/api/session/request', { body: { email: queuedEmail } });
    eq('sign-in requests still answer', [stillSignIn.status, stillSignIn.json], [202, { status: 'link_sent' }]);

    await mail.open();
    for (let attempt = 0; attempt < 30 && (await mailTo(queuedEmail)).length < 2; attempt += 1) await sleep(1000);
    const delivered = await mailTo(queuedEmail);
    eq('every queued email arrives once when mail returns', delivered.length, 2);
    eq(
      'the queued confirmation is there',
      delivered.filter((message) => message.Subject === 'Confirm your Stillhour').length,
      1,
    );
    await sleep(2000);
    eq('nothing is sent twice', (await mailTo(queuedEmail)).length, 2);

    // ---- the database goes away ----
    await database.close();
    await sleep(300);
    const health = await api('GET', '/api/health');
    eq('health still answers with the database down', [health.status, health.json], [200, { status: 'ok' }]);
    check('health answers at once', health.millis < 1000, health.millis);

    const story = await fetch(`${BASE}/`);
    eq('the story is still served', story.status, 200);
    const asset = await fetch(`${BASE}/media/one-still-hour.vtt`);
    eq('assets are still served', asset.status, 200);

    const downEmail = `down-${unique()}@example.com`;
    const refused = await api('POST', '/api/plans', {
      body: plan(downEmail),
      headers: { 'Idempotency-Key': `down-${unique()}-key` },
    });
    eq('saving answers unavailable', [refused.status, refused.json.error.code], [503, 'unavailable']);
    eq(
      'the unavailable copy',
      refused.json.error.message,
      'Saving is unavailable right now. Your choices are still on this page; try again in a minute.',
    );
    check('the unavailable answer is quick', refused.millis < 2500, refused.millis);

    for (const [method, path] of [
      ['GET', '/api/tonight'],
      ['GET', '/api/me/plan'],
      ['POST', '/api/session/request'],
      ['POST', '/api/session/verify'],
      ['GET', '/api/share/anything'],
    ]) {
      const answer = await api(method, path, { body: method === 'POST' ? { email: downEmail, token: 'x' } : undefined });
      eq(`${method} ${path} answers unavailable`, [answer.status, answer.json?.error?.code], [503, 'unavailable']);
    }

    await visitorDuringOutage();

    // ---- and comes back ----
    await database.open();
    await sleep(300);
    const again = await api('POST', '/api/plans', {
      body: plan(`back-${unique()}@example.com`),
      headers: { 'Idempotency-Key': `back-${unique()}-key` },
    });
    eq('saving works again without a restart', again.status, 202);
    const tonight = await api('GET', '/api/tonight');
    eq('the live count answers again', tonight.status, 200);

    check('no stack trace reached the browser', !refused.text.includes('at '), refused.text);
    check('the log never prints the password', !log.includes(url.password), log.slice(0, 400));
  } finally {
    server.kill('SIGTERM');
    await database.close();
    await mail.close();
  }

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  if (failures.length > 0) process.exitCode = 1;
}

await run();
