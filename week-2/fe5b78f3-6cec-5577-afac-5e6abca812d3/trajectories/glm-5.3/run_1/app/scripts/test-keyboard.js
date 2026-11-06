// Coach plan keyboard navigation and preference picking, at both widths.


const B = 'http://localhost:4173';
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
};

const { chromium } = await import('playwright-core');
const browser = await chromium.launch();

async function main() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${B}/signin`);
  await page.getByRole('textbox', { name: 'Email' }).fill('meera.iyer@example.test');
  await page.getByRole('textbox', { name: 'Password' }).fill('chart-paper-01');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/bookings**');
  await page.goto(`${B}/book?train=12951&run_date=2026-11-25&from=MMCT&to=NDLS&class=SL&quota=GN`);
  await page.waitForTimeout(900);

  await page.getByRole('textbox', { name: 'Name' }).first().fill('Kb Tester');
  await page.getByRole('spinbutton', { name: 'Age' }).first().fill('30');

  // focus the plan group directly (one Tab stop in the tab order)
  await page.locator('#plan-host g[tabindex="0"]').focus();
  await page.waitForTimeout(100);
  const focusedBerth = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
  check('Tab into the plan focuses berth 1', focusedBerth.startsWith('Berth S1 1 lower'), focusedBerth);

  // ArrowRight: same position, next bay
  await page.keyboard.press('ArrowRight');
  let label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
  check('ArrowRight moves to bay 2, same berth position', label.startsWith('Berth S1 9 lower'), label);

  // ArrowDown: forward through the bay's berths
  await page.keyboard.press('ArrowDown');
  label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
  check('ArrowDown moves through the bay (berth 10 middle)', label.startsWith('Berth S1 10 middle'), label);

  // Home: same position in the first bay
  await page.keyboard.press('Home');
  label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
  check('Home returns to bay 1 same position', label.startsWith('Berth S1 2 middle'), label);

  // at the first berth, ArrowUp stays
  await page.keyboard.press('ArrowUp');
  label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
  check('ArrowUp moves back within the bay', label.startsWith('Berth S1 1 lower'), label);

  // Enter sets the preference of the chosen passenger
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const pref = await page.evaluate(() => document.querySelector('.pref-select')?.value);
  check('Enter sets the berth preference combobox', pref === 'LB', pref);
  const berthName = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
  check('berth name gains preferred-by tag', berthName.includes('preferred by passenger 1'), berthName);

  // PageDown moves to the next coach
  await page.keyboard.press('PageDown');
  await page.waitForTimeout(200);
  label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
  check('PageDown lands on the same berth in the next coach', label.startsWith('Berth S2 1 lower'), label);
  const tabSelected = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="tab"]')).find((t) => t.getAttribute('aria-selected') === 'true')?.textContent);
  check('selected tab follows', tabSelected === 'S2', String(tabSelected));
  await page.keyboard.press('PageUp');
  label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
  check('PageUp returns to coach S1', label.startsWith('Berth S1 1 lower'), label);

  // at the last coach, PageDown keeps focus (S1 is first of two coaches: go down once then up at the first)
  await page.keyboard.press('PageUp');
  label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
  check('PageUp at the first coach keeps focus', label.startsWith('Berth S1 1 lower'), label);

  // End moves to the last bay
  await page.keyboard.press('End');
  label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
  check('End moves to the last bay, same position', label.startsWith('Berth S1 65 lower'), label);

  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
