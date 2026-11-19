const { chromium } = require('playwright-core');
const { spawn, execSync } = require('child_process');

const BASE = 'http://127.0.0.1:4173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log('  ok', name); }
  else { failed++; console.log('FAIL', name, detail); }
}

function stopServer() {
  try {
    execSync(
      `for pid in $(ls /proc | grep -E '^[0-9]+$'); do ` +
      `cmd=$(cat /proc/$pid/cmdline 2>/dev/null | tr '\\0' ' '); ` +
      `case "$cmd" in *"dist/server.cjs"*) kill $pid 2>/dev/null;; esac; done`,
      { shell: '/bin/bash', stdio: 'ignore' });
  } catch { /* already stopped */ }
}

function startServer() {
  spawn('node', ['dist/server.cjs'], { cwd: '/app', stdio: 'ignore' });
}

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch { /* not yet */ }
    await sleep(250);
  }
  return false;
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  const suffix = Date.now().toString().slice(-6);
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto(`${BASE}/signup`);
  await page.fill('[aria-label="Name"]', 'Ada Lindqvist');
  await page.fill('[aria-label="Email"]', `ada${suffix}@linewell.test`);
  await page.fill('[aria-label="Password"]', 'drafting-ada-01');
  await page.click('[aria-label="Create account"]');
  await page.waitForURL(`${BASE}/`);
  page.once('dialog', (d) => d.accept('Pipeline'));
  await page.$eval('[aria-label="New diagram"]', (el) => el.click());
  await page.waitForURL(/\/d\//, { timeout: 5000 });
  await page.waitForTimeout(1000);

  await page.$eval('[aria-label="Rectangle"]', (el) => el.click());
  await page.waitForTimeout(700);
  const shape = (await page.$$('[id^="shape-"]'))[0];
  const bb = await shape.boundingBox();
  await page.mouse.click(bb.x + 10, bb.y + 10);
  await page.waitForTimeout(400);
  const beforeX = Number(await page.$eval('[id^="shape-"]', (el) => el.getAttribute('data-x')));

  stopServer();
  await sleep(400);

  await page.keyboard.press('ArrowRight');
  await sleep(3600);
  const banner1 = await page.textContent('[aria-label="Connection"]');
  check('offline banner 1 change', banner1 === 'Offline. 1 change waiting to save.', banner1);

  await page.keyboard.press('ArrowRight');
  await sleep(700);
  const banner2 = await page.textContent('[aria-label="Connection"]');
  check('offline banner 2 changes', banner2 === 'Offline. 2 changes waiting to save.', banner2);

  startServer();
  await waitForServer();
  let banner3 = '';
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    banner3 = await page.textContent('[aria-label="Connection"]');
    if (banner3 === 'All changes saved.') break;
  }
  check('saved banner after replay', banner3 === 'All changes saved.', banner3);

  const doc = await page.evaluate(async () => {
    const res = await fetch(location.pathname.replace('/d/', '/api/diagrams/') + '/document');
    return res.json();
  });
  const afterX = doc.pages[0].shapes[0].x;
  check('offline edits applied once', afterX === beforeX + 16, `${beforeX} -> ${afterX}`);
  const domX = Number(await page.$eval('[id^="shape-"]', (el) => el.getAttribute('data-x')));
  check('canvas shows replayed x', domX === afterX, String(domX));

  // Session end mid-edit: sign out from a second page in the same context.
  const other = await ctx.newPage();
  await other.goto(`${BASE}/`);
  await other.$eval('[aria-label="Sign out"]', (el) => el.click());
  await other.waitForTimeout(1500);
  await other.close();

  const banner4 = await page.textContent('[aria-label="Connection"]');
  check('session-ended banner', banner4.startsWith('Your session ended. Sign in to keep your changes.'), banner4);
  const dialog = await page.$('[role="dialog"][aria-label="Sign in to continue"]');
  check('sign in dialog opened', dialog !== null);

  // Keep editing under the ended session: the canvas keeps taking shape edits
  // while the dialog is open, so the nudge must queue.
  await page.$eval('#canvas', (el) => el.focus());
  await page.keyboard.press('ArrowRight');
  await sleep(800);
  const banner5 = await page.textContent('[aria-label="Connection"]');
  check('session-ended counts queue', banner5.endsWith('1 change waiting to save.'), banner5);

  await page.fill('[role="dialog"][aria-label="Sign in to continue"] [aria-label="Password"]', 'drafting-ada-01');
  await page.$eval('[role="dialog"][aria-label="Sign in to continue"] [aria-label="Sign in"]', (el) => el.click());
  let banner6 = '';
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    banner6 = await page.textContent('[aria-label="Connection"]');
    if (banner6 === 'All changes saved.') break;
  }
  check('saved banner after re-signin', banner6 === 'All changes saved.', banner6);
  const dialogAfter = await page.$('[role="dialog"][aria-label="Sign in to continue"]');
  check('dialog closed after sign-in', dialogAfter === null);
  check('stayed on the diagram', /\/d\//.test(page.url()), page.url());

  if (errors.length > 0) {
    console.log('PAGE ERRORS:', errors.slice(0, 5));
  } else {
    console.log('no page errors');
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
