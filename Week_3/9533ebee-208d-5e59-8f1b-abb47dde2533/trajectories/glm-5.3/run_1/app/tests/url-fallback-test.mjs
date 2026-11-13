import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:4173';
let failures = 0;
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ok ${name}`);
  else { failures += 1; console.log(`  FAIL ${name} ${detail}`); }
};
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE + '/ledger?actor=stw-ines', { waitUntil: 'networkidle' });
await page.getByRole('table', { name: 'Ledger totals' }).waitFor({ timeout: 10000 });

// Unknown asset falls back with a replace (history length unchanged).
await page.goto(BASE + '/ledger?asset=XYZ&limit=7&actor=stw-ines', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
check('unknown values fall back to defaults', page.url().endsWith('/ledger'), `url: ${page.url()}`);
const assetValue = await page.getByLabel('Ledger asset').inputValue();
check('asset control back to All assets', assetValue === '', `value: "${assetValue}"`);
const limitValue = await page.getByLabel('Postings shown').inputValue();
check('limit control back to 50', limitValue === '50', `value: "${limitValue}"`);

// A malformed from falls back too.
await page.goto(BASE + '/ledger?from=not-a-time&actor=stw-ines', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
check('malformed from dropped', !page.url().includes('from='), `url: ${page.url()}`);

// A valid from is kept and canonical.
await page.goto(BASE + '/ledger?from=2026-11-01T04:00:00Z&actor=stw-ines', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
check('valid from kept', page.url().includes('from=2026-11-01T04%3A00%3A00Z') || page.url().includes('from=2026-11-01T04:00:00Z'), `url: ${page.url()}`);

// Selecting filters pushes exactly one entry each.
await page.goto(BASE + '/ledger?actor=stw-ines', { waitUntil: 'networkidle' });
await page.getByRole('table', { name: 'Ledger totals' }).waitFor({ timeout: 10000 });
const before = await page.evaluate(() => history.length);
await page.getByLabel('Ledger asset').selectOption('MBTC');
await page.waitForTimeout(400);
await page.getByLabel('Postings shown').selectOption('200');
await page.waitForTimeout(400);
const after = await page.evaluate(() => history.length);
check('each filter pushes one entry', after === before + 2, `history ${before} -> ${after}`);
await page.goBack();
await page.waitForTimeout(600);
check('back restores previous filter', page.url().includes('asset=MBTC') && !page.url().includes('limit=200'), `url: ${page.url()}`);
const assetNow = await page.getByLabel('Ledger asset').inputValue();
check('control restored on back', assetNow === 'MBTC', `value: ${assetNow}`);

await browser.close();
console.log(failures === 0 ? 'URL STATE CHECKS PASSED' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
