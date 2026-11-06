// Axe-core WCAG 2.2 A/AA audit across the main screens at the three widths.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const axeSource = readFileSync('/app/node_modules/axe-core/axe.min.js', 'utf8');
const B = 'http://localhost:4173';
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok ${name}`); } else { fail++; console.log(`FAIL ${name} ${extra}`); }
};
const browser = await chromium.launch();
async function auditPage(name, path, width, signedIn) {
  const ctx = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : (width === 768 ? 1024 : 800) } });
  const page = await ctx.newPage();
  if (signedIn) {
    await page.goto(`${B}/signin`, { waitUntil: 'networkidle' });
    await page.getByRole('textbox', { name: 'Email' }).fill('meera.iyer@example.test');
    await page.getByRole('textbox', { name: 'Password' }).fill('chart-paper-01');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/bookings**');
  }
  await page.goto(B + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => (await window.axe.run({})));
  const violations = results.violations.filter((v) => ['serious', 'critical', 'moderate'].includes(v.impact));
  const tags = violations.map((v) => `${v.id}(${v.nodes.length})`).join(', ');
  check(`axe: ${name} @${width}`, violations.length === 0, tags);
  for (const v of results.violations) {
    if (!violations.includes(v)) console.log(`    minor: ${v.id} ${v.help} (${v.nodes.length})`);
  }
  await ctx.close();
}
const D = '2026-11-20';
await auditPage('search', '/', 375, false);
await auditPage('search', '/', 1280, false);
await auditPage('results phone', `/trains?from=MMCT&to=NDLS&date=${D}&quota=GN&class=SL`, 375, false);
await auditPage('results tablet', `/trains?from=MMCT&to=NDLS&date=${D}&quota=GN&class=SL`, 768, false);
await auditPage('results desktop', `/trains?from=MMCT&to=NDLS&date=${D}&quota=GN&class=SL`, 1280, false);
await auditPage('signin', '/signin', 375, false);
await auditPage('register', '/register', 1280, false);
await auditPage('pnr', '/pnr', 375, false);
await auditPage('bookings', '/bookings', 1280, true);
await auditPage('booking page', `/book?train=12951&run_date=${D}&from=MMCT&to=NDLS&class=SL&quota=GN`, 375, true);
await auditPage('booking page desktop', `/book?train=12951&run_date=${D}&from=MMCT&to=NDLS&class=SL&quota=GN`, 1280, true);
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
