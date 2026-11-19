/** Browser checks: buyer stage observables, keyboard walkround, owner car file. */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const base = 'http://127.0.0.1:4173';
let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass += 1; console.log(`ok   ${name}`); }
  else { fail += 1; console.log(`FAIL ${name} ${extra}`); }
};

const run = async () => {
  // Reset the database so seeded state is exact; the serve instance reseeds.
  execFileSync('node', ['scripts/reset-db.mjs'], { stdio: 'ignore' });
  console.log('db reset; waiting for serve to reseed');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // Wait until the serve instance has reseeded after the reset.
  for (let i = 0; i < 60; i++) {
    const ok = await fetch(base + '/api/link/seed-buyer-dev-91ae57f3').then(r => r.ok).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // ---- buyer page
  await page.goto(`${base}/l/seed-buyer-dev-91ae57f3`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const stage = page.locator('[data-role="walkround-stage"]');
  check('stage present', await stage.count() === 1);
  const renderer = await stage.getAttribute('data-renderer');
  check('stage renderer webgl or svg', renderer === 'webgl' || renderer === 'svg', String(renderer));
  const mode = await stage.getAttribute('data-mode');
  check('stage mode scroll', mode === 'scroll', String(mode));
  const beat = await stage.getAttribute('data-beat');
  check('beat 0 at load', beat === '0', String(beat));
  const panelAttr = await stage.getAttribute('data-panel');
  check('hero panel set', panelAttr === 'os-sill', String(panelAttr));
  const anchor = await stage.getAttribute('data-anchor');
  check('hero anchor 0.720,0.400', anchor === '0.720,0.400', String(anchor));
  const listing = await stage.getAttribute('data-listing');
  check('listing live', listing === 'live', String(listing));
  const frameCount1 = Number(await stage.getAttribute('data-frame-count'));
  check('frame count starts', frameCount1 >= 1);

  const statements = page.locator('.stat-walk');
  check('WALK ROUND IT FIRST statement', (await statements.textContent())?.trim() === 'WALK ROUND IT FIRST');
  check('THEN MAKE YOUR OFFER statement', await page.locator('.stat-offer').textContent() === 'THEN MAKE YOUR OFFER');
  const asking = await page.locator('[data-role="asking"]').textContent();
  check('asking price shown', asking === '£16,950', String(asking));
  const countText = await page.locator('[data-role="seen-count"]').textContent();
  check('seen count 4 of 9', countText?.includes('4 of 9 seen'), String(countText));

  // ---- scroll to first beat: seen write (Dev has findings 1-4 seen already, so the write happens on Rowan)
  const pageR = await ctx.newPage();
  await pageR.goto(`${base}/l/seed-buyer-rowan-7f3c9a1e`, { waitUntil: 'networkidle' });
  await pageR.waitForTimeout(600);
  const beforeText = await pageR.locator('[data-role="seen-count"]').textContent();
  await pageR.evaluate(() => { window.scrollTo(0, 720 + Math.floor(720 * 0.65)); });
  await pageR.waitForTimeout(2000);
  const afterText = await pageR.locator('[data-role="seen-count"]').textContent();
  check('scroll crossing writes a seen record', beforeText === '0 of 9 seen' && afterText === '1 of 9 seen', `${beforeText} -> ${afterText}`);
  await pageR.close();
  await page.evaluate(() => { window.scrollTo(0, 720 + 100); });
  await page.waitForTimeout(700);
  const beatAfter = await stage.getAttribute('data-beat');
  check('beat advances on scroll', Number(beatAfter) >= 1, String(beatAfter));

  // ---- idle: no frames drawn
  const framesA = Number(await stage.getAttribute('data-frame-count'));
  await page.waitForTimeout(700);
  const framesB = Number(await stage.getAttribute('data-frame-count'));
  check('no idle frames', framesA === framesB, `${framesA} -> ${framesB}`);

  // ---- pills work by keyboard
  const pills = page.locator('[data-role="read-pill"]');
  const pillCount = await pills.count();
  check('read pills present for unseen', pillCount >= 1, String(pillCount));
  if (pillCount > 0) {
    await pills.first().focus();
    const firstId = await page.locator('.finding-card[data-seen="false"]').first().getAttribute('data-finding');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    const card = page.locator(`[data-finding="${firstId}"]`);
    check('pill marks card seen', (await card.getAttribute('data-seen')) === 'true');
  }

  // ---- walkround fully by pills
  while (true) {
    const remaining = await page.locator('[data-role="read-pill"]').count();
    if (remaining === 0) break;
    await page.locator('[data-role="read-pill"]').first().click();
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(600);
  const finalCount = await page.locator('[data-role="seen-count"]').textContent();
  check('all findings seen by pills', finalCount?.includes('9 of 9 seen'), String(finalCount));

  // ---- make an offer through the dialog
  const makeOffer = page.locator('[data-role="make-offer"]');
  if (await makeOffer.count() > 0) {
    await makeOffer.click();
    await page.waitForTimeout(300);
    const dialog = page.locator('[data-role="offer-dialog"]');
    check('offer dialog opens', await dialog.isVisible());
    await page.locator('[data-role="offer-amount"]').fill('15100');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1800);
    const offerStatus = await page.locator('[data-role="offer-status"]').textContent();
    check('offer status line', offerStatus?.includes('Open') && offerStatus?.includes('left'), String(offerStatus));
  }

  // ---- header link focus
  await page.locator('nav[aria-label="Car file"] [data-nav="offer"]').click();
  await page.waitForTimeout(500);
  const focused = await page.evaluate(() => document.activeElement?.id);
  check('offer link focuses heading', focused === 'offer-heading', String(focused));

  // ---- page errors
  check('no page errors on buyer page', errors.length === 0, errors.slice(0, 3).join(' | '));

  // ---- owner sign-in page
  const page2 = await ctx.newPage();
  await page2.goto(`${base}/owner`, { waitUntil: 'networkidle' });
  await page2.fill('#passphrase', 'bonnet-up-at-dawn');
  await page2.click('[data-role="sign-in-button"]');
  await page2.waitForURL('**/owner/cars**', { timeout: 8000 }).catch(() => {});
  check('sign-in lands on garage', page2.url().includes('/owner/cars'), page2.url());
  await page2.waitForTimeout(900);
  const garage = await page2.locator('[data-role="garage"]').textContent();
  check('garage lists car 1', garage?.includes('1998 Calder Merrow GT') ?? false, String(garage)?.slice(0, 80));

  // open the car file
  await page2.locator('[data-role="garage"] a').first().click();
  await page2.waitForTimeout(1200);
  check('car file route', page2.url().includes('/owner/cars/'), page2.url());
  const headings = await page2.locator('h2').allTextContents();
  check('car file has all nine sections', [
    'Panels and readings', 'Findings', 'Evidence', 'Test record', 'Publish', 'People', 'Viewings', 'Offers', 'Alerts',
  ].every(h => headings.includes(h)), headings.join(','));
  const standing = await page2.locator('[data-role="section-nav"]').textContent();
  check('standing lines present', standing?.includes('Read: 11 of 11') && standing?.includes('Findings: 9'), String(standing)?.slice(0, 100));

  // panels table
  const rows = await page2.locator('[data-role="panel-list"] input[data-panel-id]').count();
  check('panel readings inputs', rows === 11, String(rows));
  const plasticLabel = await page2.locator('[data-role="panel-list"]').textContent();
  check('plastic panels show Not gauged', plasticLabel?.includes('Not gauged') ?? false);

  // stage preview
  const preview = page2.locator('[data-role="stage-preview"]');
  const previewPanel = await preview.getAttribute('data-panel');
  check('stage preview rests on hero', previewPanel === 'os-sill', String(previewPanel));
  const previewAdvisories = await preview.getAttribute('data-open-advisories');
  check('preview advisory ticks value', previewAdvisories === '1', String(previewAdvisories));

  // ---- phone viewport: dock and one Seen count
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(700);
  const dock = page.locator('[data-role="dock"]');
  check('dock visible at 375px', await dock.isVisible());
  const dockCount = await page.locator('[data-role="dock-count"]').textContent();
  check('dock holds seen count at phone width', dockCount?.includes('seen') ?? false, String(dockCount));
  const statusCount = await page.locator('[data-role="seen-count"]').textContent();
  check('one seen count at phone width', (statusCount?.trim() ?? '') === '', String(statusCount));

  // horizontal overflow check at all three viewports
  for (const [w, h] of [[375, 812], [768, 1024], [1280, 800]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`no horizontal overflow at ${w}x${h}`, overflow <= 0, `diff ${overflow}`);
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((err) => { console.error(err); process.exit(1); });
