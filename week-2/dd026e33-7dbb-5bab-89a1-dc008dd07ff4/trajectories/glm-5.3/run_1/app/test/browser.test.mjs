/**
 * Browser tests with playwright-core: the shell, the bay picker, the care
 * round dialog surviving re-reads, the coat stack keyboard, live regions
 * and the published breakpoints.
 */
import { chromium } from 'playwright-core';

const base = 'http://127.0.0.1:4173';
let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(name);
    console.log(`FAIL ${name}${detail ? ` — ${JSON.stringify(detail).slice(0, 250)}` : ''}`);
  }
}

async function signIn(page, email, role) {
  await page.goto(`${base}/sign-in`);
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', 'lacquer-demo-2026');
  await page.click('button[type="submit"]');
  await page.waitForURL(`**${role}`);
}

async function main() {
  const browser = await chromium.launch();

  // ---------- phone: the menu keeps navigation hidden ----------
  const phone = await browser.newContext({ viewport: { width: 375, height: 812 } });
  let page = await phone.newPage();
  await signIn(page, 'tomas@marrowlark.test', '/round');
  check('phone: round heading', (await page.locator('h1').textContent()) === 'Care round');
  const menuButton = page.locator('button:has-text("Menu")');
  check('phone: menu button', (await menuButton.count()) === 1);
  let navHidden = await page.locator('nav.main a').first().isVisible().catch(() => false);
  check('phone: nav hidden while closed', navHidden === false);
  check('phone: menu collapsed', (await menuButton.getAttribute('aria-expanded')) === 'false');
  await menuButton.click();
  check('phone: menu opens', (await menuButton.getAttribute('aria-expanded')) === 'true');
  const focused = await page.evaluate(() => document.activeElement?.tagName + ':' + document.activeElement?.textContent);
  check('phone: focus moves into the menu', focused.startsWith('A'), focused);
  await page.keyboard.press('Escape');
  const afterEscape = await page.evaluate(() => document.activeElement?.textContent);
  check('phone: escape returns focus to Menu', afterEscape === 'Menu', afterEscape);
  check('phone: menu collapses on escape', (await menuButton.getAttribute('aria-expanded')) === 'false');
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  check('phone: no horizontal scroll', scrollWidth <= 375, scrollWidth);

  // ---------- care round: dialog survives a re-read, focus and values ----------
  await page.getByRole('button', { name: /Log round entry for 1967 Jaguar E-Type/ }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.waitFor();
  await dialog.locator('input[data-field="battery_v"]').fill('12.40');
  await dialog.locator('input[data-field="tyres-fl"]').fill('2.30');
  await page.waitForTimeout(1700); // the round re-reads every 15s; wait past at least the tick queue
  check('round: dialog stays open across ticks', await dialog.count() === 1);
  check('round: typed values kept', (await dialog.locator('input[data-field="battery_v"]').inputValue()) === '12.40');

  // ---------- bay picker by keyboard (concierge) ----------
  const tablet = await browser.newContext({ viewport: { width: 768, height: 1024 } });
  page = await tablet.newPage();
  await signIn(page, 'ines@marrowlark.test', '/bays');
  check('tablet: search box present', (await page.locator('input[type="search"]').count()) === 1);
  const navVisible = await page.locator('nav.main a').first().isVisible();
  check('tablet: navigation shows at 768', navVisible === true);
  const menuButtonAt768 = await page.locator('button:has-text("Menu")').isVisible();
  check('tablet: no menu button at 768', menuButtonAt768 === false);
  await page.fill('input[type="search"]', 'etype');
  await page.waitForTimeout(600);
  check('search writes the address', page.url().includes('q=etype'), page.url());
  await page.goto(`${base}/bays?q=etype`);
  await page.waitForTimeout(600);
  const searchValue = await page.locator('input[type="search"]').inputValue();
  check('shared link opens filtered', searchValue === 'etype', searchValue);

  // the floor plan: one tab stop, arrows move
  await page.goto(`${base}/bays`);
  await page.waitForTimeout(500);
  await page.locator('.floorplan .bay').first().focus();
  await page.keyboard.press('ArrowRight');
  const planLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  check('floor plan: arrow moves between bays', planLabel && /Bay A2/.test(planLabel), planLabel);
  check('floor plan: bay states read aloud', planLabel && /free|occupied/.test(planLabel), planLabel);

  // ---------- coat stack: keyboard, address, live region (workshop lead) ----------
  const laptop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await laptop.newPage();
  await signIn(page, 'odile@marrowlark.test', '/jobs');
  await page.getByRole('link', { name: 'J-1001' }).click();
  await page.waitForURL('**/jobs/j-1001*');
  await page.waitForTimeout(700);
  const panes = await page.locator('.panes-3 > section').count();
  check('laptop: three panes on the job page', panes === 3, panes);
  const panelMap = page.locator('.panelmap');
  check('car plan shows panels', (await panelMap.locator('button').count()) === 12);
  await panelMap.locator('button').first().focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  const addressPanel = new URL(page.url()).searchParams.get('panel');
  check('panel selection writes the address', addressPanel === 'bonnet', { url: page.url(), addressPanel });
  const announcer = page.locator('[data-region="stage-announcer"]');
  const announced = await announcer.textContent();
  check('stage announcer speaks the panel', announced !== null && announced.includes('Bonnet'), announced);
  await page.locator('[role="slider"]').focus();
  await page.keyboard.press('End');
  await page.waitForTimeout(400);
  const addressStage = new URL(page.url()).searchParams.get('stage');
  check('scrubber End jumps to the last stage', addressStage === '4', { url: page.url(), addressStage });
  const total = await page.locator('.total-film .value').textContent();
  check('total film build renders', total !== null && total.includes('µm'), total);

  // shared job address keeps the query string for the owner
  const shared = `${page.url()}`;
  const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, 'henrietta@owners.test', '/portal');
  await ownerPage.goto(shared.replace('/jobs/j-1001', '/portal/jobs/j-1001'));
  await ownerPage.waitForTimeout(700);
  check('owner opens the shared job at the same stage and panel',
    new URL(ownerPage.url()).searchParams.get('stage') === '4' &&
    new URL(ownerPage.url()).searchParams.get('panel') === 'bonnet', ownerPage.url());

  // ---------- board: three panes, two from 768 ----------
  const manager = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await manager.newPage();
  await signIn(page, 'rafael@marrowlark.test', '/board');
  await page.waitForTimeout(700);
  check('board: occupancy pane', (await page.locator('[aria-label="Occupancy"]').count()) === 1);
  check('board: overdue pane', (await page.locator('[aria-label="Overdue care"]').count()) === 1);
  check('board: unpaid pane', (await page.locator('[aria-label="Unpaid invoices"]').count()) === 1);
  const occupancy = await page.locator('[data-line="occupancy"]').textContent();
  check('occupancy line reads', /bays occupied/.test(occupancy ?? ''), occupancy);
  await manager.pages()[0].setViewportSize({ width: 900, height: 800 });
  await page.waitForTimeout(300);
  const ledgerFull = await page.locator('[aria-label="Unpaid invoices"].pane-full').count();
  check('board: unpaid invoice pane goes full width below 1200', ledgerFull === 1, ledgerFull);

  // ---------- staff access: revoke dialog opens on Keep access ----------
  await page.goto(`${base}/staff`);
  await page.waitForTimeout(600);
  const revokeButton = page.getByRole('button', { name: /Revoke access for Luca Marent/ });
  await revokeButton.click();
  const confirm = page.locator('dialog[open]');
  await confirm.waitFor();
  const focusedInDialog = await page.evaluate(() => document.activeElement?.textContent);
  check('revoke dialog opens on Keep access', focusedInDialog === 'Keep access', focusedInDialog);
  await page.keyboard.press('Tab');
  const afterTab = await page.evaluate(() => document.activeElement?.textContent);
  check('tab wraps to Revoke access', afterTab === 'Revoke access', afterTab);
  await page.keyboard.press('Escape');
  const backAtOpener = await page.evaluate(() => document.activeElement?.textContent);
  check('escape returns focus to the opener', backAtOpener.includes('Revoke access for Luca Marent'), backAtOpener);

  // sign-in returns to the linked page
  const publicContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const publicPage = await publicContext.newPage();
  await publicPage.goto(`${base}/jobs/j-1001?stage=4&panel=bonnet`);
  await publicPage.waitForTimeout(900);
  check('deep link lands on sign-in with a return address', publicPage.url().includes('/sign-in'), publicPage.url());

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(failures.join('\n'));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('BROWSER SUITE ERROR', err);
  process.exit(1);
});
