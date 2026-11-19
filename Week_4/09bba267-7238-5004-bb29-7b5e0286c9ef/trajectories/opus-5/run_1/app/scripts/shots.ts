import { chromium } from '@playwright/test';

const base = process.env.APP_PUBLIC_URL ?? 'http://127.0.0.1:4173';

async function run(): Promise<void> {
  const browser = await chromium.launch();
  const shots: [string, string, { width: number; height: number }][] = [
    ['/', 'programme', { width: 1280, height: 800 }],
    ['/p/lantern-and-tide?section=ST&seat=ST-C-12&tier=all', 'seatmap-desktop', { width: 1280, height: 800 }],
    ['/p/lantern-and-tide?section=CI&seat=CI-C-12&tier=all', 'seatmap-tablet', { width: 768, height: 1024 }],
    ['/p/lantern-and-tide?section=BA&seat=BA-C-12&tier=all', 'seatmap-phone', { width: 375, height: 812 }],
    ['/tickets', 'tickets', { width: 1280, height: 800 }],
    ['/owner', 'owner', { width: 1280, height: 800 }],
  ];
  for (const [path, name, viewport] of shots) {
    const page = await browser.newPage({ viewport });
    await page.goto(`${base}${path}`);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `/tmp/shot-${name}.png`, fullPage: false });
    await page.close();
    console.log(`/tmp/shot-${name}.png`);
  }

  const phone = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await phone.goto(`${base}/p/lantern-and-tide?section=ST&seat=ST-E-8&tier=all`);
  await phone.locator('[role="gridcell"][data-seat="ST-E-8"]').click();
  await phone.getByRole('button', { name: 'Hold selected seats' }).click();
  await phone.getByRole('button', { name: 'Checkout' }).click();
  await phone.waitForTimeout(600);
  await phone.screenshot({ path: '/tmp/shot-checkout-phone.png' });
  console.log('/tmp/shot-checkout-phone.png');
  await phone.close();
  await browser.close();
}

void run();
