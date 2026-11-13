import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4173';
let failures = 0;
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ok ${name}`);
  else { failures += 1; console.log(`  FAIL ${name} ${detail}`); }
};

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (err) => { failures += 1; console.log('  PAGE ERROR:', err.message); });

  // Steward drops the price so positions fall below 1.
  await page.goto(BASE + '/steward?actor=stw-ines', { waitUntil: 'networkidle' });
  await page.getByLabel('Asset', { exact: true }).waitFor({ timeout: 10000 });
  await page.getByLabel('Asset', { exact: true }).selectOption('MBTC');
  await page.getByLabel('Confirm large move').check();
  await page.getByLabel('New price').fill('30\u202F000');
  await page.getByRole('button', { name: 'Post price', exact: true }).click();
  await page.waitForTimeout(1500);
  const posted = await page.getByRole('status', { name: 'Announcements' }).textContent();
  check('price posted with count', posted.includes('Price posted.'), `announcement: "${posted}"`);

  // Wait out the grace (5 minutes at default; use the position state to poll).
  console.log('  waiting out the grace period...');
  let liquidatable = false;
  for (let i = 0; i < 40; i += 1) {
    await page.goto(BASE + '/liquidations?actor=lq-kestrel', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const states = await page.locator('[role="grid"] tbody tr td:nth-child(4)').allTextContents();
    if (states.some((s) => s.includes('Liquidatable now'))) { liquidatable = true; break; }
    await page.waitForTimeout(15000);
  }
  check('a position becomes liquidatable now', liquidatable);

  await page.goto(BASE + '/liquidations?actor=lq-kestrel', { waitUntil: 'networkidle' });
  await page.getByRole('grid', { name: 'Liquidation queue' }).waitFor({ timeout: 10000 });
  const rowCount = await page.locator('[role="grid"] tbody tr').count();
  check('queue grid has rows', rowCount > 0, `rows: ${rowCount}`);

  // Keyboard: move through the grid to the Action cell and open the dialog.
  const firstRow = page.locator('[role="grid"] tbody tr').first();
  await firstRow.locator('td').first().click();
  await page.keyboard.press('End');
  const cellIndex = await page.evaluate(() => document.activeElement?.getAttribute('data-cell-index') ?? 'none');
  check('End moves to the row end', cellIndex === '8', `cell: ${cellIndex}`);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Liquidate position' });
  await dialog.waitFor({ timeout: 5000 });
  check('dialog opens from the keyboard', true);
  const repayValue = await dialog.getByLabel('Repay amount').inputValue();
  check('repay prefilled with the max repay', repayValue.includes(','), `value: ${repayValue}`);

  // The Repay options menu.
  await dialog.getByRole('button', { name: 'Repay options' }).click();
  const menu = page.getByRole('menu', { name: 'Repay options' });
  await menu.waitFor({ timeout: 5000 });
  const halfValue = await menu.getByRole('menuitem', { name: 'Use half of max repay' }).textContent();
  await menu.getByRole('menuitem', { name: 'Use half of max repay' }).click();
  await page.waitForTimeout(300);
  const afterMenu = await dialog.getByLabel('Repay amount').inputValue();
  check('half of max repay fills the field', afterMenu !== repayValue, `${repayValue} -> ${afterMenu}`);

  // Escape closes the dialog and returns focus to the row button.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const dialogGone = await page.getByRole('dialog', { name: 'Liquidate position' }).count();
  check('escape closes the dialog', dialogGone === 0);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-position-id') ?? document.activeElement?.tagName ?? 'none');
  check('focus returns to the row button', focused.length > 0, `focused: ${focused}`);

  // Reopen and confirm the liquidation.
  await page.locator('[role="grid"] tbody tr').first().getByRole('button', { name: /Liquidate / }).click();
  await dialog.waitFor({ timeout: 5000 });
  await dialog.getByRole('button', { name: 'Confirm liquidation' }).click();
  await page.waitForURL('**/settlements/**', { timeout: 15000 });
  await page.getByRole('heading', { name: 'Settlement receipt' }).waitFor({ timeout: 10000 });
  const statement = page.getByRole('status', { name: 'Statement status' });
  await page.waitForTimeout(2000);
  // The receipt polls until the PDF is stored.
  let settled = false;
  for (let i = 0; i < 20; i += 1) {
    const text = await statement.textContent();
    if (text !== null && text.includes('Settled')) { settled = true; break; }
    await page.waitForTimeout(5000);
  }
  check('receipt reads Settled without a reload', settled);
  const download = await page.getByRole('button', { name: 'Download PDF statement' }).count();
  check('PDF download appears once Settled', download === 1, `buttons: ${download}`);
  const webhook = await page.getByRole('status', { name: 'Integrator webhook' }).textContent();
  check('webhook status shown', webhook !== null && (webhook.includes('delivered') || webhook.includes('queued')), `webhook: ${webhook}`);
  const legs = await page.getByRole('table', { name: 'Settlement legs' }).count();
  check('settlement legs table present', legs === 1);
} finally {
  await browser.close();
}
console.log(failures === 0 ? 'LIQUIDATION JOURNEY CHECKS PASSED' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
