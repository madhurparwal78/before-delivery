// Responsive layout checks: phone, tablet and laptop sizes.
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:4173';
const browser = await chromium.launch();
const results = [];
function check(name, ok, detail) { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${detail}`}`); }

for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width === 375 });
  const page = await context.newPage();
  await page.goto(`${BASE}/signin`);
  await page.getByRole('textbox', { name: 'Email' }).fill('ivo@lowtide.test');
  await page.getByRole('textbox', { name: 'Password' }).fill('Saltpan-Ivo-27');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('[role="application"]');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${viewport.width}x${viewport.height} no horizontal overflow`, overflow <= 0, `overflow ${overflow}px`);
  if (viewport.width >= 768) {
    const clear = await page.evaluate(() => {
      const center = { left: innerWidth * 0.375, top: innerHeight * 0.375, right: innerWidth * 0.625, bottom: innerHeight * 0.625 };
      const blockers = [];
      for (const el of document.querySelectorAll('.toprule, .queues-rail, .context-panel, .bottom-left, .bottom-right')) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const overlaps = rect.left < center.right && rect.right > center.left && rect.top < center.bottom && rect.bottom > center.top;
        if (overlaps) blockers.push(el.className);
      }
      return blockers;
    });
    check(`${viewport.width}x${viewport.height} centre box clear`, clear.length === 0, JSON.stringify(clear));
  }
  // tap targets at least 44px (sampled on nav buttons)
  const smallTargets = await page.evaluate(() => {
    const small = [];
    for (const el of document.querySelectorAll('button, a')) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && (rect.width < 44 || rect.height < 44)) small.push({ name: el.getAttribute('aria-label') ?? el.textContent, w: rect.width, h: rect.height });
    }
    return small;
  });
  check(`${viewport.width}x${viewport.height} 44px targets`, smallTargets.length === 0, JSON.stringify(smallTargets.slice(0, 5)));
  await context.close();
}
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} responsive checks passed`);
if (failed > 0) process.exitCode = 1;
