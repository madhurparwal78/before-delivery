/**
 * A browser smoke check over the published screens, attributes and controls.
 * Run against a serving app: `node tools/smoke.mjs`.
 */

import { chromium } from 'playwright';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:4173';
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
  if (condition) {
    console.log(`ok   ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL ${label} ${detail}`);
  }
}

const browser = await chromium.launch();

async function openPage(width = 1280, height = 800) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // A signed-out `GET /api/me` answers 401 by design; that is not a fault.
    if (message.type() !== 'error') return;
    if (message.text().includes('401 (Unauthorized)')) return;
    errors.push(message.text());
  });
  return { context, page, errors };
}

// ---- the story ------------------------------------------------------------
{
  const { context, page, errors } = await openPage();
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[role="region"][aria-label="Teardown story"]');

  const scene = page.locator('[role="application"][aria-label="Moped scene"]');
  check('story scene renderer', await scene.getAttribute('data-renderer'), 'webgl');
  const meshes = Number(await scene.getAttribute('data-mesh-count'));
  checkThat('story scene has at least 16 meshes', meshes >= 16, `got ${meshes}`);

  const offsetsAtZero = JSON.parse(await scene.getAttribute('data-story-offsets'));
  checkThat(
    'every story offset is 0.0 at progress 0',
    Object.values(offsetsAtZero).every((o) => o.every((v) => Number(v) === 0)),
    JSON.stringify(offsetsAtZero),
  );

  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 2));
  await page.waitForTimeout(400);
  const region = page.locator('[role="region"][aria-label="Teardown story"]');
  const progress = Number(await region.getAttribute('data-story-progress'));
  checkThat('scrolling moves story progress', progress > 0.2 && progress < 0.9, `got ${progress}`);
  const stage = Number(await region.getAttribute('data-story-stage'));
  checkThat('story stage follows progress', stage >= 2 && stage <= 6, `got ${stage}`);

  const mid = JSON.parse(await scene.getAttribute('data-story-offsets'));
  checkThat(
    'parts have moved at mid progress',
    Object.values(mid).some((o) => o.some((v) => Number(v) !== 0)),
  );

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  const back = JSON.parse(await scene.getAttribute('data-story-offsets'));
  checkThat(
    'scrolling back returns every offset to exactly 0.0',
    Object.values(back).every((o) => o.every((v) => Number(v) === 0)),
    JSON.stringify(back),
  );

  check('story captions show', await page.locator('.story-caption').first().isVisible(), true);
  check('no page errors on the story', errors, []);
  await context.close();
}

// ---- the configurator -----------------------------------------------------
{
  const { context, page, errors } = await openPage();
  await page.goto(`${BASE}/configure`, { waitUntil: 'networkidle' });

  await page.getByLabel('Registration country').selectOption('DE');
  await page.getByLabel('Plate', { exact: true }).fill('418 rtv');
  await page.getByRole('button', { name: 'Look up plate' }).click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Plate lookup"]')?.textContent?.startsWith('Found'),
    null,
    { timeout: 15_000 },
  );
  check(
    'plate lookup copy',
    await page.locator('[aria-label="Plate lookup"]').textContent(),
    'Found Rijn R50, 2017, Mofa, white plate.',
  );
  checkThat(
    'the address holds the canonical plate',
    page.url().includes('plate=418-RTV') && page.url().includes('regCountry=DE'),
    page.url(),
  );

  await page.getByLabel('Delivery country').selectOption('DE');
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Price rail"]')?.dataset.figures === 'quoted',
    null,
    { timeout: 15_000 },
  );
  check(
    'figures copy',
    await page.locator('[aria-label="Figures"]').textContent(),
    'Total €1,495.00 quoted. VAT €238.70. Range 68 km.',
  );

  const startCheckout = page.getByRole('button', { name: 'Start checkout' });
  check('checkout is closed before the rails are driven', await startCheckout.getAttribute('aria-disabled'), 'true');
  check(
    'rails-not-driven reason',
    await page.locator('[aria-label="Payment status"]').textContent(),
    'Drive the pack and hub to their stops first.',
  );

  const packRow = page.locator('.part-row[data-part-id="traction-pack"]');
  await packRow.click();
  await page.waitForTimeout(900);

  const clearance = page.locator('[role="region"][aria-label="Clearance"]');
  check('clearance part', await clearance.getAttribute('data-part'), 'traction-pack');
  check('pack rail length', await clearance.getAttribute('data-rail-mm'), '195.0');

  check(
    'seat panel fades for the pack',
    await page.locator('.part-row[data-part-id="seat"]').getAttribute('data-panel-fade'),
    '0.25',
  );
  check(
    'the frame does not fade',
    await page.locator('.part-row[data-part-id="frame"]').getAttribute('data-panel-fade'),
    '1',
  );

  const edge = await clearance.evaluate((node) => ({
    x: Number(node.dataset.leadingEdgeScreenX),
    y: Number(node.dataset.leadingEdgeScreenY),
  }));
  const handleBox = await page.locator('.rail-handle').boundingBox();
  const handleCentre = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
  checkThat(
    'the rail handle centre is within 4 px of the leading edge',
    Math.abs(handleCentre.x - edge.x) <= 4 && Math.abs(handleCentre.y - edge.y) <= 4,
    `handle ${JSON.stringify(handleCentre)} edge ${JSON.stringify(edge)}`,
  );
  checkThat('the handle is at least 44 px', handleBox.width >= 44 && handleBox.height >= 44, JSON.stringify(handleBox));

  const slider = page.getByLabel('Insertion travel');
  await slider.focus();
  await slider.press('End');
  await page.waitForTimeout(400);
  check('pack travel at the stop', await clearance.getAttribute('data-travel-mm'), '195.0');
  check('pack reaches full seat without contact', await clearance.getAttribute('data-contact'), 'false');
  check('gap at S1', await clearance.getAttribute('data-gap-s1-mm'), '30.0');
  check('gap at S2', await clearance.getAttribute('data-gap-s2-mm'), '22.9');
  check('gap at S3', await clearance.getAttribute('data-gap-s3-mm'), '28.0');
  check('smallest gap so far', await clearance.getAttribute('data-smallest-gap-mm'), '22.9');

  await slider.press('Home');
  await page.waitForTimeout(200);
  check('Home returns to the rail start', await clearance.getAttribute('data-travel-mm'), '0.0');
  await slider.press('ArrowRight');
  await page.waitForTimeout(150);
  check('ArrowRight moves 5 mm', await clearance.getAttribute('data-travel-mm'), '5.0');
  await slider.press('Shift+ArrowRight');
  await page.waitForTimeout(150);
  check('Shift+ArrowRight moves 1 mm', await clearance.getAttribute('data-travel-mm'), '6.0');
  await slider.press('End');
  await page.waitForTimeout(400);

  const hubRow = page.locator('.part-row[data-part-id="hub-motor"]');
  await hubRow.click();
  await page.waitForTimeout(900);
  check('clearance part is the hub', await clearance.getAttribute('data-part'), 'hub-motor');
  check('hub rail length', await clearance.getAttribute('data-rail-mm'), '70.0');
  const hubSlider = page.getByLabel('Insertion travel');
  await hubSlider.focus();
  await hubSlider.press('End');
  await page.waitForTimeout(500);
  check('hub gap at H3', await clearance.getAttribute('data-gap-s3-mm'), '10.9');
  check('hub smallest gap', await clearance.getAttribute('data-smallest-gap-mm'), '10.9');

  await page.waitForFunction(
    () => document.querySelector('[aria-label="Fit verdict"]')?.textContent?.startsWith('Fits'),
    null,
    { timeout: 15_000 },
  );
  check(
    'verdict copy',
    await page.locator('[aria-label="Fit verdict"]').textContent(),
    'Fits. Smallest gap 10.9 mm at Sprocket line.',
  );
  check('verdict word beside the readout', await page.locator('.verdict-word').textContent(), 'Fits');

  await page.waitForTimeout(300);
  check('checkout opens once both rails are driven', await startCheckout.getAttribute('aria-disabled'), null);

  const scene = page.locator('[role="application"][aria-label="Moped scene"]');
  await scene.focus();
  check('scene azimuth at home', await scene.getAttribute('data-azimuth-deg'), '30');
  await scene.press('ArrowRight');
  await page.waitForTimeout(150);
  check('ArrowRight changes azimuth by 15', await scene.getAttribute('data-azimuth-deg'), '45');
  await scene.press('ArrowUp');
  await page.waitForTimeout(150);
  check('ArrowUp changes elevation by 15', await scene.getAttribute('data-elevation-deg'), '30');
  for (let i = 0; i < 5; i += 1) await scene.press('ArrowUp');
  await page.waitForTimeout(200);
  check('elevation is limited to 75', await scene.getAttribute('data-elevation-deg'), '75');
  await scene.press('+');
  await page.waitForTimeout(150);
  check('+ changes zoom by 0.1', await scene.getAttribute('data-zoom'), '1.10');
  for (let i = 0; i < 12; i += 1) await scene.press('+');
  await page.waitForTimeout(200);
  check('zoom is limited to 2.0', await scene.getAttribute('data-zoom'), '2.00');
  await scene.press('Home');
  await page.waitForTimeout(200);
  check(
    'Home resets the camera',
    [
      await scene.getAttribute('data-azimuth-deg'),
      await scene.getAttribute('data-elevation-deg'),
      await scene.getAttribute('data-zoom'),
    ],
    ['30', '15', '1.00'],
  );

  const buffer = await page.evaluate(() => {
    const canvas = document.querySelector('.scene canvas');
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    return {
      width: canvas.width,
      height: canvas.height,
      wantedWidth: Math.round(rect.width * ratio),
      wantedHeight: Math.round(rect.height * ratio),
    };
  });
  checkThat(
    'the drawing buffer matches the displayed size times the ratio',
    Math.abs(buffer.width - buffer.wantedWidth) <= 1 && Math.abs(buffer.height - buffer.wantedHeight) <= 1,
    JSON.stringify(buffer),
  );

  const first = await scene.screenshot();
  await page.waitForTimeout(3000);
  const second = await scene.screenshot();
  check('the scene is identical after 3 seconds with no input', Buffer.compare(first, second), 0);

  const verdictBefore = await page.locator('[aria-label="Fit verdict"]').textContent();
  await page.getByLabel('Imperial').check();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Price rail"]')?.dataset.figures === 'quoted',
    null,
    { timeout: 15_000 },
  );
  const verdictAfter = await page.locator('[aria-label="Fit verdict"]').textContent();
  checkThat(
    'switching units keeps the verdict word',
    verdictBefore.split('.')[0] === verdictAfter.split('.')[0],
    `${verdictBefore} -> ${verdictAfter}`,
  );
  checkThat('imperial shows inches', verdictAfter.includes(' in'), verdictAfter);

  check('no page errors on the configurator', errors, []);
  await context.close();
}

// ---- published layouts ----------------------------------------------------
for (const [width, height, expectation] of [
  [375, 812, 'one column'],
  [767, 1024, 'one column'],
  [768, 1024, 'two columns'],
  [1199, 900, 'two columns'],
  [1200, 800, 'three columns'],
  [1280, 800, 'three columns'],
]) {
  const { context, page, errors } = await openPage(width, height);
  await page.goto(`${BASE}/configure`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  checkThat(`no sideways scroll at ${width}px`, overflow <= 0, `overflow ${overflow}`);

  const columns = await page.evaluate(
    () => getComputedStyle(document.querySelector('.configurator')).gridTemplateColumns.split(' ').length,
  );
  const wanted = expectation === 'one column' ? 1 : expectation === 'two columns' ? 2 : 3;
  check(`configurator layout at ${width}px`, columns, wanted);

  if (width < 768) {
    check(
      `parts sheet button shows at ${width}px`,
      await page.getByRole('button', { name: 'Parts schedule' }).isVisible(),
      true,
    );
    const closedSheetVisible = await page.evaluate(() => {
      const panel = document.querySelector('.panel--sheet');
      return panel ? !panel.hidden : false;
    });
    check(`closed parts sheet is unavailable at ${width}px`, closedSheetVisible, false);
    check(`Menu button shows at ${width}px`, await page.getByRole('button', { name: 'Menu' }).isVisible(), true);
  } else {
    check(`parts column shows at ${width}px`, await page.locator('.parts-column').isVisible(), true);
    check(`Menu button is hidden at ${width}px`, await page.getByRole('button', { name: 'Menu' }).isVisible(), false);
  }

  check(`no page errors at ${width}px`, errors, []);
  await context.close();
}

// ---- reduced motion -------------------------------------------------------
{
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const stills = await page.locator('.story-stage--stacked').count();
  check('the story shows six stacked stills under reduced motion', stills, 6);

  const stageOffsets = await page.evaluate(() =>
    [...document.querySelectorAll('.story-stage--stacked .scene')].map((node) => ({
      stage: node.dataset.storyStage,
      offsets: JSON.parse(node.dataset.storyOffsets),
    })),
  );
  check('each still carries its stage', stageOffsets.map((s) => s.stage), ['1', '2', '3', '4', '5', '6']);
  const second = stageOffsets[1].offsets;
  check('a stage-1 part is fully moved at stage 2', second['front-panel'], ['220.0', '0.0', '0.0']);
  check('a stage-2 part is fully moved at stage 2', second.footboard, ['0.0', '0.0', '-180.0']);
  check('a stage-5 part has not moved at stage 2', second['traction-pack'], ['0.0', '0.0', '0.0']);

  check('no page errors under reduced motion', errors, []);
  await context.close();
}

// ---- bikes, filters and the not-found page --------------------------------
{
  const { context, page, errors } = await openPage();

  await page.goto(`${BASE}/bikes`, { waitUntil: 'networkidle' });
  const ranges = await page.locator('.bike-table tbody tr td.mono').allTextContents();
  check('bikes are sorted by range, longest first', ranges, ['110 km', '85 km', '60 km']);

  await page.getByLabel('25 km/h', { exact: true }).check();
  await page.waitForTimeout(600);
  checkThat('the bike filter is held in the address', page.url().includes('class=25'), page.url());
  check('filtered bikes', await page.locator('.bike-table tbody tr').count(), 1);

  await page.goto(`${BASE}/nowhere`, { waitUntil: 'networkidle' });
  check('not-found heading', await page.locator('h1').textContent(), "We couldn't find that page.");

  check('no page errors on bikes', errors, []);
  await context.close();
}

console.log(`\n${checks - failures}/${checks} browser checks passed`);
await browser.close();
if (failures > 0) process.exit(1);
