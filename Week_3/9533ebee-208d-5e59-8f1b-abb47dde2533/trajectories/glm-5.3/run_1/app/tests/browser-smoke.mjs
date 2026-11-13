import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4173';
let failures = 0;
const ok = (name) => console.log(`  ok ${name}`);
const fail = (name, detail) => { failures += 1; console.log(`  FAIL ${name}: ${detail}`); };

async function check(page, name, fn) {
  try {
    await fn();
    ok(name);
  } catch (err) {
    fail(name, err.message);
  }
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (err) => { failures += 1; console.log('  PAGE ERROR:', err.message); });
  page.on('console', (msg) => { if (msg.type() === 'error') console.log('  console error:', msg.text().slice(0, 200)); });

  await check(page, 'home page loads with shell', async () => {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.getByLabel('Acting as').waitFor({ timeout: 10000 });
  });

  await check(page, 'acting as chooser lists members', async () => {
    const options = await page.locator('#acting-as option').allTextContents();
    if (options.length < 12) throw new Error(`expected >=12 options, got ${options.length}`);
    if (!options.some((t) => t.includes('Ines Varga (Risk steward)'))) throw new Error('ines missing');
  });

  await check(page, 'selecting the steward opens the Steward view', async () => {
    await page.getByLabel('Acting as').selectOption({ label: 'Ines Varga (Risk steward)' });
    await page.waitForURL('**/steward', { timeout: 10000 });
    await page.getByLabel('New price').waitFor({ timeout: 10000 });
  });

  await check(page, 'nav shows only steward sections', async () => {
    const links = await page.locator('nav[aria-label="Sections"] a').allTextContents();
    const names = links.map((t) => t.replace(/[0-9]/g, '').trim());
    for (const expected of ['Steward', 'Ledger', 'Liquidations']) {
      if (!names.includes(expected)) throw new Error(`missing ${expected}: ${names.join(',')}`);
    }
    for (const unexpected of ['Supply', 'Trade', 'Borrow']) {
      if (names.includes(unexpected)) throw new Error(`unexpected ${unexpected}`);
    }
  });

  await check(page, 'pool column shows three pools with figures', async () => {
    await page.getByRole('article', { name: 'QUSD pool' }).waitFor({ timeout: 10000 });
    const qusd = page.getByRole('article', { name: 'QUSD pool' });
    const liquidity = await qusd.getByText('Available liquidity').locator('..').textContent();
    if (!liquidity.includes('1\u202F798')) throw new Error(`QUSD liquidity: ${liquidity}`);
    const util = await qusd.getByText('Utilization').locator('..').textContent();
    if (!util.includes('10,05%')) throw new Error(`util: ${util}`);
  });

  await check(page, 'price rail shows prices and durations', async () => {
    const rail = page.getByRole('complementary', { name: 'Posted prices' });
    await rail.waitFor({ timeout: 10000 });
    const text = await rail.textContent();
    for (const expected of ['$1,00000000', 'Manual post', 'Grace period', '5:00', '60:00']) {
      if (!text.includes(expected)) throw new Error(`missing "${expected}" in rail`);
    }
  });

  await check(page, 'wallet region lists three assets', async () => {
    const wallet = page.getByRole('region', { name: 'Wallet' });
    await wallet.waitFor({ timeout: 10000 });
    const text = await wallet.textContent();
    for (const asset of ['QUSD', 'MBTC', 'METH']) {
      if (!text.includes(asset)) throw new Error(`missing ${asset}`);
    }
  });

  await check(page, 'steward posts a price and hears the count', async () => {
    await page.getByLabel('Asset', { exact: true }).selectOption('MBTC');
    await page.getByLabel('New price').fill('52\u202F000');
    await page.getByRole('button', { name: 'Post price', exact: true }).click();
    await page.waitForTimeout(1200);
    const text = await page.getByRole('status', { name: 'Announcements' }).textContent();
    if (!text.includes('Price posted. 3 positions now below health factor 1.')) throw new Error(`announcement: "${text}"`);
  });

  await check(page, 'steward restores the price', async () => {
    await page.getByLabel('Confirm large move').check();
    await page.getByLabel('New price').fill('64\u202F000');
    await page.getByRole('button', { name: 'Post price', exact: true }).click();
    await page.waitForTimeout(1500);
  });

  await check(page, 'liquidation queue shows crossed positions', async () => {
    await page.getByRole('link', { name: 'Liquidations' }).first().click();
    await page.waitForTimeout(800);
    const grid = await page.getByRole('grid', { name: 'Liquidation queue' }).count();
    const empty = await page.getByText('No positions are below health factor 1.').count();
    if (grid === 0 && empty === 0) throw new Error('neither grid nor empty copy');
    if (grid > 0) {
      const rows = await page.locator('[role="grid"] tbody tr').count();
      if (rows < 1) throw new Error(`grid present but no rows`);
    }
  });

  await check(page, 'ledger view shows zero nets', async () => {
    await page.getByRole('link', { name: 'Ledger' }).first().click();
    await page.getByRole('table', { name: 'Ledger totals' }).waitFor({ timeout: 10000 });
    const nets = await page.getByRole('table', { name: 'Ledger totals' }).locator('tbody td:nth-child(4)').allTextContents();
    for (const net of nets) {
      const cleaned = net.replace(/\u202F/g, '').replace(/\u2212/g, '-').replace(',', '.');
      if (Number.parseFloat(cleaned) !== 0) throw new Error(`net not zero: ${net}`);
    }
  });

  await check(page, 'ledger filter pushes URL state', async () => {
    await page.getByLabel('Ledger asset').selectOption('MBTC');
    await page.waitForTimeout(400);
    if (!page.url().includes('asset=MBTC')) throw new Error(`url: ${page.url()}`);
    await page.getByLabel('Postings shown').selectOption('20');
    await page.waitForTimeout(400);
    if (!page.url().includes('limit=20')) throw new Error(`url: ${page.url()}`);
  });

  await check(page, 'borrower draws with desk format and repays all', async () => {
    await page.getByLabel('Acting as').selectOption({ label: 'Sanna Lindqvist (Borrower)' });
    await page.waitForURL('**/borrow', { timeout: 10000 });
    await page.getByRole('link', { name: 'Position pos-0001' }).waitFor({ timeout: 10000 });
    await page.getByRole('link', { name: 'Position pos-0001' }).click();
    await page.waitForURL('**/positions/pos-0001', { timeout: 10000 });
    await page.getByLabel('Draw amount').waitFor({ timeout: 10000 });
    await page.getByLabel('Draw amount').fill('0,5');
    await page.getByRole('button', { name: 'Draw', exact: true }).click();
    await page.waitForTimeout(1500);
    const text = await page.getByRole('status', { name: 'Announcements' }).textContent();
    if (!text.includes('Drew 0,500000 QUSD')) throw new Error(`draw announcement: "${text}"`);
    await page.getByLabel('Repay amount').fill('0,5');
    await page.getByRole('button', { name: 'Repay', exact: true }).click();
    await page.waitForTimeout(1800);
    const repayText = await page.getByRole('status', { name: 'Announcements' }).textContent();
    if (!repayText.includes('Repaid 0,500000 QUSD')) throw new Error(`repay announcement: "${repayText}"`);
    const state = await page.getByRole('status', { name: 'Position state' }).textContent();
    if (state.trim() !== 'Healthy') throw new Error(`state: "${state}"`);
  });

  await check(page, 'trader preview follows keystrokes and quote works', async () => {
    await page.getByLabel('Acting as').selectOption({ label: 'Petra Novak (Trader)' });
    await page.waitForURL('**/trade', { timeout: 10000 });
    await page.getByLabel('Amount to pay').waitFor({ timeout: 10000 });
    const preview = page.getByRole('status', { name: 'Swap preview' });
    await page.getByLabel('Pay with').selectOption('MBTC');
    await page.getByLabel('Receive').selectOption('QUSD');
    await page.getByLabel('Amount to pay').fill('0,12345678');
    await page.waitForTimeout(900);
    const text = await preview.textContent();
    if (!text.includes('0,00037038 MBTC')) throw new Error(`preview: "${text}"`);
    if (!text.includes('7\u202F877,529600 QUSD')) throw new Error(`preview out: "${text}"`);
    await page.getByRole('button', { name: 'Get firm quote', exact: true }).click();
    const quote = page.getByRole('region', { name: 'Firm quote' });
    await quote.waitFor({ timeout: 10000 });
    const quoteText = await quote.textContent();
    if (!quoteText.includes('Firm until')) throw new Error(`quote: "${quoteText}"`);
    await page.getByRole('button', { name: 'Swap now', exact: true }).click();
    const receipt = page.getByRole('region', { name: 'Swap receipt' });
    await receipt.waitFor({ timeout: 10000 });
    const receiptText = await receipt.textContent();
    if (!receiptText.includes('7\u202F877,529600 QUSD')) throw new Error(`receipt: "${receiptText}"`);
  });

  await check(page, 'supply view survives refresh with typed values', async () => {
    await page.getByLabel('Acting as').selectOption({ label: 'Rosa Aldana (Liquidity provider)' });
    await page.waitForURL('**/supply', { timeout: 10000 });
    await page.getByLabel('Withdraw amount').waitFor({ timeout: 10000 });
    await page.getByLabel('Withdraw amount').fill('12,3x');
    const error = await page.locator('#withdraw-amount-error').textContent().catch(() => '');
    if (error !== 'Enter digits with a comma before the decimals.') throw new Error(`field error: "${error}"`);
    const before = await page.getByLabel('Withdraw amount').inputValue();
    await page.waitForTimeout(6000);
    const after = await page.getByLabel('Withdraw amount').inputValue();
    if (before !== after) throw new Error(`value changed on refresh: "${before}" -> "${after}"`);
    const errorAfter = await page.locator('#withdraw-amount-error').textContent().catch(() => '');
    if (errorAfter !== 'Enter digits with a comma before the decimals.') throw new Error(`error lost: "${errorAfter}"`);
  });

  await check(page, 'liquidator queue grid has roving tab stop', async () => {
    await page.getByLabel('Acting as').selectOption({ label: 'Kestrel Keepers (Liquidator)' });
    await page.waitForURL('**/liquidations', { timeout: 10000 });
    await page.getByRole('link', { name: 'Liquidations' }).first().click();
    await page.waitForTimeout(800);
    const grid = await page.getByRole('grid', { name: 'Liquidation queue' }).count();
    if (grid === 0) {
      const empty = await page.getByText('No positions are below health factor 1.').count();
      if (empty > 0) return; // empty queue: the published copy is correct
      throw new Error('no grid and no empty copy');
    }
    const first = page.locator('[role="grid"] tbody tr').first().locator('td').first();
    await first.click();
    await page.keyboard.press('ArrowRight');
    const active = await page.evaluate(() => document.activeElement?.getAttribute('data-cell-index') ?? 'none');
    if (active !== '1') throw new Error(`roving tab: ${active}`);
  });

  await check(page, 'position page shows health factor plumb line', async () => {
    await page.goto(BASE + '/positions/pos-0002?actor=lq-kestrel', { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Position pos-0002' }).waitFor({ timeout: 10000 });
    await page.getByRole('img', { name: /Health factor/ }).waitFor({ timeout: 10000 });
    const state = await page.getByRole('status', { name: 'Position state' }).textContent();
    const labels = ['Healthy', 'Margin warning', 'Liquidatable in grace', 'Liquidatable now', 'Partially liquidated'];
    if (!labels.includes(state.trim())) throw new Error(`state: "${state}"`);
  });

  await check(page, 'not-found view shows the published heading', async () => {
    await page.goto(BASE + '/nowhere/at/all', { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'We couldn\u2019t find that page.' }).waitFor({ timeout: 10000 });
  });

  await check(page, '375px viewport has no sideways scroll', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE + '/ledger', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    if (overflow) throw new Error('horizontal overflow at 375px');
  });

  await check(page, '768px viewport has no sideways scroll', async () => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(BASE + '/steward?actor=stw-ines', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    if (overflow) throw new Error('horizontal overflow at 768px');
  });

  await check(page, 'shock ruler responds to arrow keys', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/steward?actor=stw-ines', { waitUntil: 'networkidle' });
    const slider = page.getByRole('slider', { name: 'Price shock' });
    await slider.waitFor({ timeout: 10000 });
    await slider.focus();
    await page.keyboard.press('ArrowLeft');
    const value = await slider.getAttribute('aria-valuetext');
    if (!value.includes('\u22120,5%')) throw new Error(`value text: "${value}"`);
    await page.keyboard.press('Shift+ArrowLeft');
    const value2 = await slider.getAttribute('aria-valuetext');
    if (!value2.includes('\u22125,5%')) throw new Error(`shift value: "${value2}"`);
    await page.keyboard.press('End');
    const value3 = await slider.getAttribute('aria-valuetext');
    if (!value3.includes('+60,0%')) throw new Error(`end value: "${value3}"`);
    await page.keyboard.press('Home');
    const value4 = await slider.getAttribute('aria-valuetext');
    if (!value4.includes('\u221260,0%')) throw new Error(`home value: "${value4}"`);
    await page.waitForTimeout(800);
    const readText = await page.getByRole('status', { name: 'Shock reading' }).textContent();
    if (!readText.includes('at risk at \u221260,0% shock.')) throw new Error(`reading: "${readText}"`);
  });
} finally {
  await browser.close();
}
console.log(failures === 0 ? 'ALL BROWSER CHECKS PASSED' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
