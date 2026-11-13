import { chromium } from '/tmp/node_modules/playwright/index.mjs';

const BASE = 'http://127.0.0.1:4173';
let failures = 0;
const log = (label, ok, extra) => {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${extra === undefined ? '' : ` -> ${extra}`}`);
  }
};

async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    // The signed-out session probe answers 401 by design; the browser logs that as a resource error.
    const text = message.text();
    if (message.type() === 'error' && !text.includes('401 (Unauthorized)')) errors.push(text);
  });

  console.log('leaderboard');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  log('skip link first', (await page.getByRole('link', { name: 'Skip to content' }).count()) === 1);
  log('banner present', (await page.getByRole('banner').count()) === 1);
  log('primary nav', (await page.getByRole('navigation', { name: 'Primary' }).count()) === 1);
  log('status region', (await page.getByRole('status', { name: 'Desk status' }).count()) === 1);
  log('program picker', (await page.getByRole('combobox', { name: 'Program' }).count()) === 1);
  const portfolio = page.getByRole('table', { name: 'Portfolio standings' });
  log('portfolio standings table', (await portfolio.count()) === 1);
  log('finalist cut separator', (await page.getByRole('separator', { name: 'Finalist cut' }).count()) > 0);
  log('winner label', (await page.getByText('Winner', { exact: true }).count()) > 0);
  log('no horizontal overflow 1280', (await overflow(page)) <= 0, await overflow(page));
  const replay = page.getByRole('button', { name: 'Replay reveal for Portfolio' });
  log('replay button', (await replay.count()) === 1);
  await replay.first().click();
  await page.waitForTimeout(1400);
  const announcement = await page.getByRole('status', { name: 'Standings updates' }).first().textContent();
  log('shuffle announcement', (announcement ?? '').length > 0, announcement);

  console.log('gallery');
  await page.getByRole('link', { name: 'Gallery' }).click();
  await page.waitForTimeout(600);
  log('winners list', (await page.getByRole('list', { name: 'Winners' }).count()) === 1);
  const cards = await page.locator('.cards > li').count();
  log('ten winner cards', cards === 10, cards);
  await page.getByRole('combobox', { name: 'Year' }).selectOption('2024');
  await page.waitForTimeout(500);
  log('year filter', (await page.locator('.cards > li').count()) === 3);

  console.log('studio journey');
  await page.goto(`${BASE}/signin`);
  await page.getByRole('textbox', { name: 'Email' }).fill('desk@monoharbour.example');
  await page.getByLabel('Password').fill('monoharbour-pass-26');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(900);
  log('studio landed', page.url().includes('/studio'), page.url());
  log('entries table', (await page.getByRole('table', { name: 'Your entries' }).count()) === 1);

  console.log('responsive');
  for (const size of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(size);
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const over = await overflow(page);
    log(`no overflow at ${size.width}`, over <= 0, over);
    const small = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('button, a, input, select')) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (rect.height < 44) bad.push(`${el.tagName}:${(el.textContent ?? '').trim().slice(0, 20)}`);
      }
      return bad;
    });
    log(`tap targets at ${size.width}`, small.length === 0, small.join(' | '));
  }

  log('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failures === 0 ? '\nUI CHECKS PASSED' : `\n${failures} UI CHECKS FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
