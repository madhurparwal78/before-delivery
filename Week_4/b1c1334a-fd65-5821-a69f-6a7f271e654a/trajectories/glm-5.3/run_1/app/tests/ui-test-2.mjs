/** UI test 2: badges, narrow cards, viewer read-only, sign-out landing. */
import { chromium } from 'playwright';

const errors = [];
const browser = await chromium.launch();

// 1. Badges after an edit in another table
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (err) => errors.push('pageerror: ' + String(err)));
  await page.goto('http://127.0.0.1:4173/sign-in');
  await page.fill('#email', 'mara@harbourlane.test');
  await page.fill('#password', 'ledger-demo-2026');
  await page.click('button:has-text("Sign in")');
  await page.waitForURL('http://127.0.0.1:4173/');
  await page.locator('a.document-link').first().click();
  await page.waitForSelector('#grid');
  const priceCell = page.locator('[role="gridcell"][data-row="0"][data-col="2"]');
  await priceCell.click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const badge = await page.locator('.rail-link[data-table-id] .rail-badge').allTextContents();
  console.log('badges:', badge);
  const anyBadge = badge.some((b) => b.includes('changed'));
  console.log('badge shown for off-screen tables:', anyBadge);
  if (!anyBadge) throw new Error('no badge shown');
  await page.close();
}

// 2. Narrow layout renders record cards
{
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  page.on('pageerror', (err) => errors.push('narrow pageerror: ' + String(err)));
  await page.goto('http://127.0.0.1:4173/sign-in');
  await page.fill('#email', 'dev@harbourlane.test');
  await page.fill('#password', 'ledger-demo-2026');
  await page.click('button:has-text("Sign in")');
  await page.waitForURL('http://127.0.0.1:4173/');
  await page.locator('a.document-link').first().click();
  await page.waitForSelector('#records', { timeout: 5000 });
  const cards = await page.locator('.record-card').count();
  console.log('cards (first table = Products):', cards);
  if (cards !== 4) throw new Error('dev should see 4 product cards, saw ' + cards);
  const editButtons = await page.locator('.edit-button').count();
  console.log('edit buttons:', editButtons);
  const gridCount = await page.locator('#grid').count();
  if (gridCount !== 0) throw new Error('grid must not show at 375');
  // switch to Orders via the drawer
  await page.click('button:has-text("Switch table")');
  await page.waitForSelector('.drawer');
  await page.click('.drawer button:has-text("Orders")');
  await page.waitForTimeout(600);
  const orderCards = await page.locator('.record-card').count();
  console.log('order cards (dev own rows):', orderCards);
  if (orderCards !== 3) throw new Error('dev should see 3 order cards');
  await page.close();
}

// 3. Viewer is read-only; attempts announce the copy
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (err) => errors.push('viewer pageerror: ' + String(err)));
  await page.goto('http://127.0.0.1:4173/sign-in');
  await page.fill('#email', 'sam@harbourlane.test');
  await page.fill('#password', 'ledger-demo-2026');
  await page.click('button:has-text("Sign in")');
  await page.waitForURL('http://127.0.0.1:4173/');
  await page.locator('a.document-link').first().click();
  await page.waitForSelector('#grid');
  const readonly = await page.locator('#grid').getAttribute('aria-readonly');
  console.log('grid aria-readonly:', readonly);
  if (readonly !== 'true') throw new Error('viewer grid not readonly');
  const addRowVisible = await page.locator('#add-row').isVisible();
  console.log('add row visible:', addRowVisible);
  if (addRowVisible) throw new Error('viewer sees Add row');
  const note = await page.locator('#read-only-note').textContent();
  console.log('read-only note:', JSON.stringify(note));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const alerts = await page.locator('#grid-alerts').textContent();
  console.log('grid alerts:', JSON.stringify(alerts));
  if (!alerts.includes('You can view this document but not change it.')) throw new Error('read-only copy missing');
  // sign out lands on sign-in with focus on Email
  await page.click('button:has-text("Sign out")');
  await page.waitForURL('**/sign-in', { timeout: 5000 });
  const focused = await page.evaluate(() => document.activeElement?.id);
  const url = new URL(page.url());
  console.log('sign-in landing:', url.pathname, url.search, 'focus:', focused);
  if (focused !== 'email') throw new Error('focus not on Email');
  await page.close();
}

await browser.close();
if (errors.length > 0) throw new Error('browser errors: ' + errors.join(' | '));
console.log('UI TEST 2 OK');
