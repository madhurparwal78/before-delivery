/**
 * Outage and recovery.
 *
 * Starts a second app instance on the same database, behind a toggleable proxy
 * to the registry, and checks that the shop still opens with the provider down,
 * shows the published banner, keeps a kit deposit blocked, lets hand entry and
 * a fit trial work, and recovers without a restart or a reload.
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PROXY_PORT = 4999;
const APP_PORT = 4174;
const APP = `http://127.0.0.1:${APP_PORT}`;
const UPSTREAM = process.env.WIREMOCK_URL ?? 'http://wiremock:8080';

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

/** The proxy drops every connection while `down` is true. */
let down = false;
const proxy = createServer((req, res) => {
  if (down) {
    req.socket.destroy();
    return;
  }
  const upstream = new URL(req.url, UPSTREAM);
  fetch(upstream, { headers: { accept: 'application/json' } })
    .then(async (answer) => {
      res.writeHead(answer.status, { 'content-type': 'application/json' });
      res.end(await answer.text());
    })
    .catch(() => {
      res.writeHead(502).end('{}');
    });
});
await new Promise((resolve) => proxy.listen(PROXY_PORT, '127.0.0.1', resolve));
console.log(`[proxy] listening on ${PROXY_PORT}`);

const app = spawn('node', ['dist/server/server/index.js'], {
  env: {
    ...process.env,
    APP_PUBLIC_PORT: String(APP_PORT),
    WIREMOCK_URL: `http://127.0.0.1:${PROXY_PORT}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
app.stdout.on('data', (d) => process.stdout.write(`[app] ${d}`));
app.stderr.on('data', (d) => process.stderr.write(`[app] ${d}`));

const waitFor = async (predicate, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timed out waiting for ${label}`);
};

await waitFor(
  async () => (await fetch(`${APP}/api/health`)).ok,
  30_000,
  'the second instance to listen',
);

// A session cookie issued by one instance is accepted by the other.
const signIn = await fetch(`${APP}/api/auth/sign-in`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'rider.nl@ommezwaai.example', password: 'Feeler-2026!' }),
});
const cookie = signIn.headers.getSetCookie().join('; ');
check('the second instance signs a rider in', signIn.status, 200);

const onMain = await fetch('http://127.0.0.1:4173/api/me', { headers: { cookie } });
check('a session from one instance is accepted by the other', onMain.status, 200);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(
  `${APP}/configure?plate=FGH-12-K&regCountry=NL&pack=P-1500&hub=H-1000&class=25&units=metric&fulfilment=posted&country=NL`,
  { waitUntil: 'networkidle' },
);
await page.waitForFunction(
  () => document.querySelector('[aria-label="Plate lookup"]')?.textContent?.startsWith('Found'),
  null,
  { timeout: 15_000 },
);
check('the plate is found while the registry is up', true, true);

// ---- the registry goes down ----------------------------------------------
down = true;
console.log('[proxy] registry down');

// The banner appears within 10 seconds of the provider going down.
await page.waitForFunction(
  () =>
    document
      .querySelector('[role="alert"][aria-label="Provider outage"]')
      ?.textContent?.includes('Plate registry unreachable'),
  null,
  { timeout: 10_000 },
);
check(
  'the registry banner shows',
  (await page.locator('[role="alert"][aria-label="Provider outage"]').textContent()).trim(),
  'Plate registry unreachable. Your fit stays unconfirmed until it answers.',
);
check('the shop still opens with the registry down', await page.locator('.configurator').isVisible(), true);

// Change the pack while the registry is down: the re-quote cannot be made, so
// the figures must read `not current` and checkout must stay shut.
await page.getByLabel('Pack').selectOption('P-1100');
await page.waitForFunction(
  () => document.querySelector('[aria-label="Price rail"]')?.dataset.figures === 'not current',
  null,
  { timeout: 15_000 },
);
check(
  'a failed re-quote reads not current',
  await page.locator('[aria-label="Figures"]').textContent(),
  'Figures could not be refreshed. Nothing here is a current quote.',
);
check(
  'the status word beside each figure reads not current',
  await page.locator('[aria-label="Price rail"] .status-word').first().textContent(),
  'not current',
);
check(
  'checkout stays shut while the figures are not current',
  await page.getByRole('button', { name: 'Start checkout' }).getAttribute('aria-disabled'),
  'true',
);

// A kit deposit stays blocked: the gate refuses before any Kill Bill call.
const orderCreate = await fetch(`${APP}/api/orders`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({
    kind: 'kit',
    config: {
      donor: { plate: 'FGH-12-K', country: 'NL' },
      packId: 'P-1500',
      hubId: 'H-1000',
      roadClass: 25,
      fulfilment: 'posted',
      country: 'NL',
    },
    plan: { name: 'A', street: 'B', postcode: 'C', city: 'D' },
    expectedTotalCents: 149500,
  }),
});
const createBody = await orderCreate.json();
check('plate-based order creation answers registry_unreachable', [orderCreate.status, createBody.error], [503, 'registry_unreachable']);

// Hand entry and its fit trial still work.
const handFit = await fetch(`${APP}/api/fit-checks`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
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
  }),
});
const handBody = await handFit.json();
check('a hand-entered fit trial still works', handFit.status, 200);
check('the hand-entered verdict is unconfirmed', [handBody.verdict, handBody.confirmed], ['fits', false]);
checkThat('the hand-entered sentence says so', handBody.sentence.endsWith(' Donor unconfirmed.'), handBody.sentence);

const statusDown = await (await fetch(`${APP}/api/status`)).json();
check('status reports the registry down', statusDown.registry, 'down');
check('status still reports Kill Bill up', statusDown.killbill, 'up');

// Health answers with a provider down.
const health = await fetch(`${APP}/api/health`);
check('health answers with a provider down', [health.status, (await health.json()).status], [200, 'ok']);

// ---- the registry comes back ---------------------------------------------
// Clear the stale found copy so the recovery re-read has to produce it again.
await page.evaluate(() => {
  document.querySelector('[aria-label="Plate lookup"]').textContent = '';
});
down = false;
console.log('[proxy] registry up');

// The banner clears without a reload, and the open plate address is re-read.
await page.waitForFunction(
  () => {
    const banner = document.querySelector('[role="alert"][aria-label="Provider outage"]');
    return !banner || banner.hidden || !banner.textContent.includes('Plate registry');
  },
  null,
  { timeout: 10_000 },
);
check('the registry banner clears without a reload', true, true);

// The open plate address is re-read within the same 10 seconds, with no reload.
await page.waitForFunction(
  () => document.querySelector('[aria-label="Plate lookup"]')?.textContent?.startsWith('Found'),
  null,
  { timeout: 10_000 },
);
check(
  'the open plate address is re-read and announced',
  await page.locator('[aria-label="Plate lookup"]').textContent(),
  'Found Kade K50, 2019, snorfiets, blue plate.',
);
await page.waitForFunction(
  () => document.querySelector('[aria-label="Price rail"]')?.dataset.figures === 'quoted',
  null,
  { timeout: 10_000 },
);
check('the figures are current again', await page.locator('[aria-label="Price rail"]').getAttribute('data-figures'), 'quoted');

const statusUp = await (await fetch(`${APP}/api/status`)).json();
check('status reports the registry up again', statusUp.registry, 'up');

// ---- the server boundary -------------------------------------------------
const crossOrigin = await fetch(`${APP}/api/orders`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://evil.example', cookie },
  body: JSON.stringify({}),
});
check('a cross-origin state change is refused', [crossOrigin.status, (await crossOrigin.json()).error], [403, 'cross_origin']);

const tooLarge = await fetch(`${APP}/api/quotes`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ padding: 'x'.repeat(70_000) }),
});
check('a body over 65,536 bytes is refused', [tooLarge.status, (await tooLarge.json()).error], [413, 'payload_too_large']);

const exact = 'y'.repeat(65_536 - 16);
const atLimit = await fetch(`${APP}/api/quotes`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ padding: exact }).slice(0, 65_536),
});
checkThat('a body at the limit is not refused for size', atLimit.status !== 413, `status ${atLimit.status}`);

for (const path of ['/src/server/index.ts', '/package.json', '/.env', '/tsconfig.json', '/run.json']) {
  const answer = await fetch(`${APP}${path}`);
  const body = await answer.text();
  checkThat(
    `${path} is not served as a source file`,
    !body.includes('KILLBILL_API_SECRET') && !body.includes('import {'),
    `${answer.status} ${body.slice(0, 60)}`,
  );
}

const secretLeak = await (await fetch(`${APP}/api/status`)).text();
checkThat('the callback secret never reaches the browser', !/[0-9a-f]{64}/.test(secretLeak), secretLeak);

const wrongSecret = await fetch(`${APP}/api/killbill/notifications/not-the-secret`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ objectType: 'PAYMENT', objectId: 'x' }),
});
check('a wrong callback secret answers like any unknown route', [wrongSecret.status, (await wrongSecret.json()).error], [404, 'not_found']);

check('no page errors through the outage', errors, []);

await browser.close();
app.kill('SIGTERM');
proxy.close();

console.log(`\n${checks - failures}/${checks} outage checks passed`);
if (failures > 0) process.exit(1);
