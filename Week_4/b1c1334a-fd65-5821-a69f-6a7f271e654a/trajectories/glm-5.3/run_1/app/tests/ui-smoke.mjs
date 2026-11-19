/** Browser smoke test: the workspace loads, cells render, editing commits. */
import { chromium } from 'playwright';

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('http://127.0.0.1:4173/sign-in');
  await page.fill('#email', 'mara@harbourlane.test');
  await page.fill('#password', 'ledger-demo-2026');
  await page.click('button:has-text("Sign in")');
  await page.waitForURL('http://127.0.0.1:4173/', { timeout: 5000 });
  console.log('signed in, on documents list');

  const firstDoc = page.locator('a.document-link').first();
  await firstDoc.click();
  await page.waitForSelector('#grid', { timeout: 5000 });
  console.log('workspace grid rendered');

  const cells = await page.locator('[role="gridcell"]').count();
  console.log('grid cells:', cells);
  if (cells < 20) throw new Error('grid did not render rows');

  const rail = await page.locator('.rail-link').allTextContents();
  console.log('rail:', rail.slice(0, 4));

  // type into the first cell to open the editor, then commit with Enter
  const firstCell = page.locator('[role="gridcell"][data-row="0"][data-col="0"]');
  await firstCell.click();
  await page.keyboard.press('Enter');
  const editorVisible = await page.locator('.cell-editor').count();
  console.log('editor open:', editorVisible === 1);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Oak Shelf Bracket 2');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  const after = await page.locator('[role="gridcell"][data-row="0"][data-col="0"]').textContent();
  console.log('cell after edit:', JSON.stringify(after));
  if (after !== 'Oak Shelf Bracket 2') throw new Error('cell write did not commit');

  const status = await page.locator('#status-text').textContent();
  console.log('status bar:', JSON.stringify(status));
  const markers = await page.locator('[data-recalc-depth]').count();
  console.log('recalc markers:', markers);
  const railCounts = await page.locator('.rail-count').allTextContents();
  console.log('rail counts after edit:', railCounts);
  const revision = await page.locator('#workspace').getAttribute('data-doc-revision');
  console.log('doc revision:', revision);

  // undo via the button
  await page.click('#undo-button');
  await page.waitForTimeout(700);
  const undone = await page.locator('[role="gridcell"][data-row="0"][data-col="0"]').textContent();
  console.log('cell after undo:', JSON.stringify(undone));
  if (undone !== 'Oak Shelf Bracket') throw new Error('undo did not restore');

  // rail navigation to the summary
  await page.locator('.rail-link', { hasText: 'Orders by Region' }).click();
  await page.waitForTimeout(400);
  const summaryCells = await page.locator('[role="gridcell"]').allTextContents();
  console.log('summary cells:', summaryCells.slice(0, 8));

  console.log('console errors:', errors);
  await browser.close();
  if (errors.length > 0) throw new Error('browser errors: ' + errors.join(' | '));
  console.log('UI SMOKE OK');
};

run().catch((err) => {
  console.error('UI SMOKE FAILED:', err);
  process.exit(1);
});
