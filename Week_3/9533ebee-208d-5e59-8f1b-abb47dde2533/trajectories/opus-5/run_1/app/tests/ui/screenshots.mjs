import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4173';
const browser = await chromium.launch();

const shots = [
  ['steward-1280', 'stw-ines', '/steward', 1280, 800],
  ['ledger-1280', 'stw-ines', '/ledger', 1280, 800],
  ['supply-1280', 'lp-rosa', '/supply', 1280, 800],
  ['trade-1280', 'tr-petra', '/trade', 1280, 800],
  ['borrow-1280', 'br-sanna', '/borrow', 1280, 800],
  ['position-1280', 'br-sanna', '/positions/pos-0001', 1280, 800],
  ['liquidations-1280', 'lq-kestrel', '/liquidations', 1280, 800],
  ['steward-768', 'stw-ines', '/steward', 768, 1024],
  ['position-375', 'br-sanna', '/positions/pos-0001', 375, 812],
  ['liquidations-375', 'lq-kestrel', '/liquidations', 375, 812],
  ['ledger-375', 'stw-ines', '/ledger', 375, 812],
];

for (const [name, actor, path, width, height] of shots) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.goto(`${BASE}/?actor=${actor}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  // Nothing may scroll sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  await page.screenshot({ path: `/app/.tmp/shots/${name}.png`, fullPage: true });
  console.log(`${name}: horizontal overflow ${overflow}px`);
  await context.close();
}

await browser.close();
