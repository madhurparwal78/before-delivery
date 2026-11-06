/**
 * Journey checks: first contact in the pixels, and the keyboard-only
 * configurator-to-deposit flow at every published viewport.
 */

import { chromium } from 'playwright';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:4173';
/** The flat fill of the primary action buttons. */
const ACCENT = { r: 0xc2, g: 0x45, b: 0x1e };

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks += 1;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
  } else {
    console.log(`ok   ${label} = ${a}`);
  }
}

function checkThat(label, condition, detail = '') {
  checks += 1;
  if (condition) console.log(`ok   ${label}`);
  else {
    failures += 1;
    console.error(`FAIL ${label} ${detail}`);
  }
}

/** Count pixels within 12 levels per channel of the accent, in a 40x40 box. */
async function accentPixelsAt(page, point) {
  return page.evaluate(
    async ({ point, accent }) => {
      const canvas = document.querySelector('.scene canvas');
      const rect = canvas.getBoundingClientRect();
      const ratio = canvas.width / rect.width;
      const cx = Math.round((point.x - rect.left) * ratio);
      const cy = Math.round((point.y - rect.top) * ratio);
      const half = Math.round(20 * ratio);

      // Re-read through a 2D copy, which preserves the drawn bytes.
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      copy.getContext('2d').drawImage(canvas, 0, 0);

      const x0 = Math.max(0, cx - half);
      const y0 = Math.max(0, cy - half);
      const w = Math.min(canvas.width - x0, half * 2);
      const h = Math.min(canvas.height - y0, half * 2);
      if (w <= 0 || h <= 0) return { matching: 0, total: 0 };

      const data = copy.getContext('2d').getImageData(x0, y0, w, h).data;
      let matching = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (
          Math.abs(data[i] - accent.r) <= 12 &&
          Math.abs(data[i + 1] - accent.g) <= 12 &&
          Math.abs(data[i + 2] - accent.b) <= 12
        ) {
          matching += 1;
        }
      }
      return { matching, total: (w * h) };
    },
    { point, accent: ACCENT },
  );
}

const browser = await chromium.launch();

// ---- first contact: the fouling edge in the pixels ------------------------
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // R50's sprocket line is 106.9 and the H-3600 shaft is 112.0, so the hub
  // fouls at the swingarm arm.
  await page.goto(
    `${BASE}/configure?plate=418-RTV&regCountry=DE&pack=P-1500&hub=H-3600&class=45&units=metric&fulfilment=posted&country=DE`,
    { waitUntil: 'networkidle' },
  );
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Price rail"]')?.dataset.figures === 'quoted',
    null,
    { timeout: 15_000 },
  );

  const clearance = page.locator('[role="region"][aria-label="Clearance"]');
  await page.locator('.part-row[data-part-id="hub-motor"]').click();
  await page.waitForTimeout(900);

  check('hub rail before contact', await clearance.getAttribute('data-contact'), 'false');
  const edgeBefore = await clearance.evaluate((n) => ({
    x: Number(n.dataset.leadingEdgeScreenX),
    y: Number(n.dataset.leadingEdgeScreenY),
  }));
  const before = await accentPixelsAt(page, edgeBefore);
  check('no accent pixels before contact', before.matching, 0);

  // Drive to the stop.
  const slider = page.getByLabel('Insertion travel');
  await slider.focus();
  await slider.press('End');
  await page.waitForTimeout(600);

  check('the part stops at the fouling station travel', await clearance.getAttribute('data-travel-mm'), '45.0');
  check('contact is reported', await clearance.getAttribute('data-contact'), 'true');
  check('the fouling feature is named', await clearance.getAttribute('data-fouling-feature'), 'Swingarm arm');

  const foulX = Number(await clearance.getAttribute('data-fouling-screen-x'));
  const foulY = Number(await clearance.getAttribute('data-fouling-screen-y'));
  const edgeAfter = await clearance.evaluate((n) => ({
    x: Number(n.dataset.leadingEdgeScreenX),
    y: Number(n.dataset.leadingEdgeScreenY),
  }));
  checkThat(
    'the leading edge lies within 4 px of the fouling point',
    Math.abs(foulX - edgeAfter.x) <= 4 && Math.abs(foulY - edgeAfter.y) <= 4,
    `foul ${foulX},${foulY} edge ${edgeAfter.x},${edgeAfter.y}`,
  );

  const after = await accentPixelsAt(page, { x: foulX, y: foulY });
  checkThat(
    'at least 12 accent pixels at the published fouling point',
    after.matching >= 12,
    `matching ${after.matching} of ${after.total}`,
  );

  await page.waitForFunction(
    () => document.querySelector('[aria-label="Fit verdict"]')?.textContent?.startsWith('Fouls'),
    null,
    { timeout: 15_000 },
  );
  check(
    'fouls copy',
    await page.locator('[aria-label="Fit verdict"]').textContent(),
    'Fouls. Hub motor stops at 45.0 mm on Swingarm arm.',
  );
  check('verdict word', await page.locator('.verdict-word').textContent(), 'Fouls');

  check('no page errors at first contact', errors, []);
  await context.close();
}

// ---- too tight on a revision B frame -------------------------------------
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(
    `${BASE}/configure?plate=DBR-45-T&regCountry=NL&pack=P-2100&hub=H-1000&class=45&units=metric&fulfilment=posted&country=NL`,
    { waitUntil: 'networkidle' },
  );
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Fit verdict"]')?.textContent?.length > 0,
    null,
    { timeout: 15_000 },
  );
  check(
    'revision B is too tight at the footboard rib',
    await page.locator('[aria-label="Fit verdict"]').textContent(),
    'Too tight. Gap 0.0 mm at Footboard rib; the minimum is 3.0 mm.',
  );

  // The part still passes the station: it reaches full seat.
  await page.locator('.part-row[data-part-id="traction-pack"]').click();
  await page.waitForTimeout(900);
  const clearance = page.locator('[role="region"][aria-label="Clearance"]');
  await page.getByLabel('Insertion travel').focus();
  await page.getByLabel('Insertion travel').press('End');
  await page.waitForTimeout(400);
  check('a zero gap is not contact', await clearance.getAttribute('data-contact'), 'false');
  check('the pack reaches full seat', await clearance.getAttribute('data-travel-mm'), '210.0');
  check('the zero gap is published', await clearance.getAttribute('data-gap-s2-mm'), '0.0');
  await context.close();
}

// ---- the keyboard-only deposit flow --------------------------------------
for (const [width, height] of [
  [375, 812],
  [768, 1024],
  [1280, 800],
]) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Sign in first, so checkout opens rather than sending the rider away.
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.getByLabel('Email').fill('rider.nl@ommezwaai.example');
  await page.getByLabel('Password').fill('Feeler-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/orders', { timeout: 15_000 });
  check(`sign-in lands on /orders at ${width}px`, new URL(page.url()).pathname, '/orders');

  await page.goto(
    `${BASE}/configure?plate=FGH-12-K&regCountry=NL&pack=P-1500&hub=H-1000&class=25&units=metric&fulfilment=posted&country=NL`,
    { waitUntil: 'networkidle' },
  );
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Price rail"]')?.dataset.figures === 'quoted',
    null,
    { timeout: 15_000 },
  );

  // Drive both rails with the keyboard alone. Below 768 px the rows live in
  // the parts sheet, so the flow opens it, walks to the row and selects there.
  const narrow = width < 768;
  for (const partId of ['traction-pack', 'hub-motor']) {
    if (narrow) {
      const sheetButton = page.getByRole('button', { name: 'Parts schedule' });
      await sheetButton.focus();
      await page.keyboard.press('Enter');
      await page.waitForSelector('[role="dialog"][aria-label="Parts schedule"]:not([hidden])');
      const inSheet = await page.evaluate(() =>
        document
          .querySelector('[role="dialog"][aria-label="Parts schedule"]')
          .contains(document.activeElement),
      );
      check(`the parts sheet takes focus at ${width}px`, inSheet, true);

      // Walk the roving list to the wanted row, then select it.
      const index = await page.evaluate(
        (id) => [...document.querySelectorAll('.part-row')].findIndex((n) => n.dataset.partId === id),
        partId,
      );
      await page.keyboard.press('Home');
      for (let i = 0; i < index; i += 1) await page.keyboard.press('ArrowDown');
      const onRow = await page.evaluate(
        (id) => document.activeElement?.dataset.partId === id,
        partId,
      );
      check(`roving focus reaches ${partId} at ${width}px`, onRow, true);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(900);

      // Selecting in the sheet closes it and moves focus to the slider.
      const onSlider = await page.evaluate(
        () => document.activeElement?.getAttribute('aria-label') === 'Insertion travel',
      );
      check(`focus moves to the slider at ${width}px`, onSlider, true);
    } else {
      await page.evaluate((id) => {
        document.querySelector(`.part-row[data-part-id="${id}"]`).focus();
      }, partId);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(900);
      await page.getByLabel('Insertion travel').focus();
    }
    await page.keyboard.press('End');
    await page.waitForTimeout(500);
  }

  const startCheckout = page.getByRole('button', { name: 'Start checkout' });
  await page.waitForTimeout(400);
  check(`checkout opens after both rails at ${width}px`, await startCheckout.getAttribute('aria-disabled'), null);

  await startCheckout.focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('[role="dialog"][aria-label="Checkout"]:not([hidden])');

  // Focus is held inside the dialog.
  const focusedInside = await page.evaluate(() =>
    document.querySelector('[role="dialog"][aria-label="Checkout"]').contains(document.activeElement),
  );
  check(`checkout takes focus at ${width}px`, focusedInside, true);

  await page.getByLabel('Name').fill('Anouk Veerman');
  await page.getByLabel('Street').fill('Kadeweg 12');
  await page.getByLabel('Postcode').fill('1011AB');
  await page.getByLabel('City').fill('Amsterdam');

  // Enter activates Next, twice, to reach Deposit.
  await page.getByLabel('City').press('Enter');
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  const payButton = page.getByRole('button', { name: 'Pay deposit' });
  check(`the deposit step shows at ${width}px`, await payButton.isVisible(), true);

  await payButton.focus();
  await page.keyboard.press('Enter');

  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  const orderUrl = page.url();
  checkThat(`the deposit lands on the order's own page at ${width}px`, /\/orders\/[0-9a-f-]{36}$/.test(orderUrl), orderUrl);

  // The deposit reads pending, then paid once the provider confirms.
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Order state"]')?.textContent === 'deposit pending',
    null,
    { timeout: 10_000 },
  ).catch(() => undefined);

  await page.waitForFunction(
    () => document.querySelector('[aria-label="Order state"]')?.textContent === 'deposit confirmed',
    null,
    { timeout: 25_000 },
  );
  check(`the deposit turns paid at ${width}px`, await page.locator('[aria-label="Order state"]').textContent(), 'deposit confirmed');

  // Reloading the order address shows the same screen.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  check(
    `reloading the order shows the same screen at ${width}px`,
    await page.locator('[aria-label="Order state"]').textContent(),
    'deposit confirmed',
  );

  check(`no page errors in the deposit flow at ${width}px`, errors, []);
  await context.close();
}

console.log(`\n${checks - failures}/${checks} journey checks passed`);
await browser.close();
if (failures > 0) process.exit(1);
