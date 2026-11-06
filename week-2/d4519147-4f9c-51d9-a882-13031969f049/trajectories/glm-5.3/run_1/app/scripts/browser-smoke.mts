// Browser smoke test: sign in, open the editor, place and move a shape,
// save, and check the boundary tally announcements.

import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4173';

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail = ''): void => {
    console.log(cond ? `ok    ${name}` : `FAIL  ${name} ${detail}`);
    if (!cond) failures.push(name);
  };

  page.on('pageerror', (err) => {
    console.log('PAGE ERROR:', err.message);
  });

  await page.goto(`${BASE}/`);
  await page.waitForURL(/\/signin/);
  check('signed-out redirect to signin', page.url().includes('/signin?next='));

  await page.fill('#signin-email', 'ravi.sato@harborlane.test');
  await page.fill('#signin-password', 'Harbor-Net-2026!a');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/$/);
  check('lands on diagrams', true);

  // Open the seeded diagram: the list link.
  await page.getByRole('link', { name: 'Harbor Lane CDE scope' }).first().click();
  await page.waitForURL(/\/d\//);
  await page.waitForSelector('.canvas-svg');
  check('editor opens', true);

  // Switch to the Account data flows page tab.
  await page.getByRole('tab', { name: 'Account data flows' }).click();
  await page.waitForTimeout(600);

  // Zone tallies are visible.
  const tally = await page.locator('[aria-label="Cardholder Data Environment tally"]').first().textContent();
  check('cde tally shows 3 systems 5 crossings', tally === '3 systems · 5 crossings', String(tally));

  // Crossing markers with direction.
  const enteringCount = await page.locator('[aria-label="Crossing on Cardholder Data Environment, entering"]').count();
  const leavingCount = await page.locator('[aria-label="Crossing on Cardholder Data Environment, leaving"]').count();
  check('cde crossing markers 3 in 2 out', enteringCount === 3 && leavingCount === 2, `${enteringCount} in ${leavingCount} out`);

  // The zone header tallies as accessible group names.
  const groupLabel = await page.locator('[role="group"]').first().getAttribute('aria-label');
  check('tally group name', groupLabel !== null && groupLabel.includes('tally'), String(groupLabel));

  // Canvas items in reading order with Tab.
  await page.locator('.canvas-svg').click({ position: { x: 400, y: 300 } });
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  check('tab reaches first canvas item (connected zone)', focused?.startsWith('Zone Connected-to'), String(focused));

  // Save state shows Saved.
  const saveState = await page.getByRole('status', { name: 'Save state' }).textContent();
  check('save state Saved', saveState === 'Saved', String(saveState));

  // Move a shape with the arrow keys: focus Fraud screening and press Up.
  const fraud = page.locator('[aria-label="Fraud screening, API service"]');
  await fraud.focus();
  await fraud.press('ArrowUp');
  await page.waitForTimeout(300);
  const saveState2 = await page.getByRole('status', { name: 'Save state' }).textContent();
  check('edit marks Unsaved changes', saveState2 === 'Unsaved changes', String(saveState2));

  // Autosave fires within 1-2 seconds of the last edit.
  await page.waitForTimeout(2500);
  const saveState3 = await page.getByRole('status', { name: 'Save state' }).textContent();
  check('autosave saved', saveState3 === 'Saved', String(saveState3));

  // Undo restores the position before anything else, in this tab.
  await fraud.focus();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  const fraudY2 = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[role="button"]'));
    const fraud = items.find((i) => i.getAttribute('aria-label')?.startsWith('Fraud screening'));
    const rect = (fraud as SVGElement).querySelector('rect');
    return rect?.getAttribute('y');
  });
  check('undo restores position (y 600)', fraudY2 === '600', String(fraudY2));
  await page.waitForTimeout(2200);

  // Move fraud into the CDE with the arrow keys.
  await fraud.focus();
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press('ArrowUp');
  }
  await page.waitForTimeout(1800);
  const announcement = await page.locator('#announcements').textContent();
  check('boundary announcement', announcement !== null && announcement.includes('moved into'), String(announcement));

  // The zone tally updated.
  const tallyAfter = await page.locator('[aria-label="Cardholder Data Environment tally"]').first().textContent();
  check('tally now 4 systems', tallyAfter === '4 systems · 4 crossings', String(tallyAfter));

  // Reload: derived values from the server agree.
  await page.reload();
  await page.waitForSelector('.canvas-svg');
  await page.getByRole('tab', { name: 'Account data flows' }).click();
  await page.waitForTimeout(600);
  const tallyReloaded = await page.locator('[aria-label="Cardholder Data Environment tally"]').first().textContent();
  check('tally survives reload', tallyReloaded === '4 systems · 4 crossings', String(tallyReloaded));

  // The moved shape also survives the reload.
  const fraudReloadedY = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[role="button"]'));
    const fraud = items.find((i) => i.getAttribute('aria-label')?.startsWith('Fraud screening'));
    const rect = (fraud as SVGElement).querySelector('rect');
    return rect?.getAttribute('y');
  });
  check('shape position saved (y 456)', fraudReloadedY === '456', String(fraudReloadedY));

  // Restore the seed position for later runs.
  const fraud2 = page.locator('[aria-label="Fraud screening, API service"]');
  await fraud2.focus();
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press('ArrowDown');
  }
  await page.waitForTimeout(2200);

  // Layouts: 375 width has the bottom toolbar, 1280 has the inspector pane.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
  const bottomToolbar = await page.locator('[aria-label="Editor tools"]').count();
  check('375 bottom toolbar', bottomToolbar === 1);
  const importAtNarrow = await page.getByRole('button', { name: 'Import' }).count();
  check('375 hides Import', importAtNarrow === 0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  const inspectorPane = await page.locator('.inspector-pane').count();
  check('1280 inspector pane', inspectorPane === 1);

  // No horizontal overflow.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('no horizontal overflow at 1280', !overflow);

  console.log();
  if (failures.length > 0) {
    console.log(`${failures.length} failures: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('browser checks passed');
  await browser.close();
}

void main();
