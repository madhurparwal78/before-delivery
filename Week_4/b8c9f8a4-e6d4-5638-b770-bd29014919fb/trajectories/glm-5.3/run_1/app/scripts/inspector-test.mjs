/** Inspector capture browser checks: queue, offline behaviour, sync states. */
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:4173';
let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass += 1; console.log(`ok   ${name}`); }
  else { fail += 1; console.log(`FAIL ${name} ${extra}`); }
};

const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`${base}/l/seed-inspector-tam-2b81d4c6`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  check('inspector page loads', (await page.locator('h1').first().textContent()) === 'Inspector capture');
  const panelRows = await page.locator('[data-role="panel-list"] li').count();
  check('owner readings listed', panelRows === 13, String(panelRows));
  const sillRow = await page.locator('[data-role="panel-list"] li').nth(3).textContent();
  check('owner figure on sill row', sillRow?.includes('428 microns') ?? false, String(sillRow));

  // Queue a reading.
  await page.locator('[data-role="panel"]').selectOption('os-sill');
  await page.locator('#capture-microns').fill('431');
  await page.locator('[data-role="queue-reading"]').click();
  await page.waitForTimeout(300);
  const queued = await page.locator('[data-role="queue"] li').allTextContents();
  check('reading queued', queued.some(q => q.includes('Queued')), JSON.stringify(queued));

  // Queue a finding with the pin.
  await page.locator('[data-role="panel"]').selectOption('os-sill');
  await page.locator('#capture-note').fill('Sill reading taken beside the owner mark.');
  await page.locator('[data-role="queue-finding"]').click();
  await page.waitForTimeout(300);
  const queued2 = await page.locator('[data-role="queue"] li').allTextContents();
  check('finding queued', queued2.some(q => q.includes('finding') && q.includes('Queued')), JSON.stringify(queued2));

  // Send now: all rows go Synced.
  await page.locator('[data-role="send-now"]').click();
  await page.waitForTimeout(2000);
  const synced = await page.locator('[data-role="queue"] li').allTextContents();
  check('all rows synced', synced.every(q => q.includes('Synced')), JSON.stringify(synced));

  // Offline queue: block the API and queue two rows.
  await ctx.route('**/api/link/*/capture', (route) => route.abort());
  await page.locator('[data-role="panel"]').selectOption('ns-door');
  await page.locator('#capture-microns').fill('140');
  await page.locator('[data-role="queue-reading"]').click();

  await page.locator('#capture-note').fill('Door edge noted.');
  await page.locator('[data-role="queue-finding"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-role="send-now"]').click();
  await page.waitForTimeout(1800);
  const offlineRows = await page.locator('[data-role="queue"] li').allTextContents();
  check('no signal keeps rows queued', offlineRows.some(q => q.includes('Queued')), JSON.stringify(offlineRows));
  const status = await page.locator('[data-role="capture-status"]').textContent();
  check('outage copy shown', status?.includes('No signal. Items stay queued on this device.') ?? false, String(status));

  // Reload offline: the queue survives from the device.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const afterReload = await page.locator('[data-role="queue"] li').allTextContents();
  check('queue survives reload', afterReload.some(q => q.includes('Queued')), JSON.stringify(afterReload));

  // Reconnect: rows sync.
  await ctx.unroute('**/api/link/*/capture');
  await page.locator('[data-role="send-now"]').click();
  await page.waitForTimeout(2500);
  const reconnected = await page.locator('[data-role="queue"] li').allTextContents();
  check('rows sync after reconnect', reconnected.every(q => q.includes('Synced')), JSON.stringify(reconnected));

  check('no inspector page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((err) => { console.error(err); process.exit(1); });
