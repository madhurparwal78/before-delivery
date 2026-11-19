// Accessibility checks at the three published sizes for the three views.

import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const BASE = 'http://127.0.0.1:4173';
const SIZES: [string, number, number][] = [
  ['phone 375x812', 375, 812],
  ['tablet 768x1024', 768, 1024],
  ['desktop 1280x800', 1280, 800],
];

function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`);
  if (!ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  for (const [sizeName, width, height] of SIZES) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await page.goto(BASE + '/signin');
    await page.fill('input[name="email"]', 'asha@slackwater.test');
    await page.fill('input[name="password"]', 'asha-plans-2027');
    await page.click('button[type="submit"]');
    await page.waitForSelector('#new-project');
    await page.click('text=Spring launch');
    await page.waitForSelector('#project-finish');

    for (const view of ['gantt', 'list', 'workload'] as const) {
      await page.click(`#tab-${view}`);
      await page.waitForTimeout(400);
      const results = await new AxeBuilder({ page }).analyze();
      const violations = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      check(
        `axe ${view} ${sizeName}`,
        violations.length === 0,
        violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 2).join('; ')}`).join(' | '),
      );
    }
    await page.close();
    await context.close();
  }
  await browser.close();
}

void main();
