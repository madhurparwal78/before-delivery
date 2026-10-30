// Save reference screenshots of the app into .browser_screenshots/
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:4173';
const OUT = '.browser_screenshots';
const browser = await chromium.launch();

const shots = [
  ['home', '/', 1280, 800, null],
  ['pricing', '/pricing', 1280, 800, null],
  ['pricing-monthly', '/pricing', 1280, 800, async (page) => {
    await page.getByRole('switch', { name: 'Yearly billing' }).click();
  }],
  ['examples', '/examples', 1280, 800, null],
  ['enterprise-contact', '/enterprise-contact', 1280, 800, null],
  ['team-plan', '/team-plan', 1280, 800, null],
  ['not-found', '/no-such-page', 1280, 800, null],
  ['login', '/login', 1280, 800, null],
  ['home-phone', '/', 375, 812, null],
  ['pricing-phone', '/pricing', 375, 812, null],
];

for (const [name, path, w, h, act] of shots) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${path}`);
  await page.waitForTimeout(600);
  if (act) await act(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  await ctx.close();
  console.log(`shot ${name}`);
}

// signed-in studio pages
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill('creator@example.com');
  await page.getByLabel('Password').fill('deku-demo-pw-2026');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/studio');
  await page.getByLabel('Prompt').fill('Neon reflections on a wet dance floor, slow camera push');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/studio-composer.png` });
  await page.goto(`${BASE}/studio/projects`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/studio-projects.png` });
  const projLink = page.locator('.proj-grid a', { hasText: 'Music video' }).first();
  await projLink.click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/studio-project.png` });
  await page.goto(`${BASE}/studio/credits`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/studio-credits.png` });
  await ctx.close();
  console.log('shot studio pages');
}
await browser.close();
console.log('done');
