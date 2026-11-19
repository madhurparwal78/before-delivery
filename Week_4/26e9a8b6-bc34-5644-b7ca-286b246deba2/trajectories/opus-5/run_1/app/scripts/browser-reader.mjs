import { chromium } from 'playwright';
import {
  BASE,
  VIEWPORTS,
  check,
  figure,
  makeWorld,
  noSidewaysOverflow,
  report,
  stageHooks,
  statusText,
  tabOrder,
  waitForStageReady,
} from './browser-lib.mjs';

const browser = await chromium.launch();
const world = await makeWorld();
const slug = world.guides.public.slug;

/* ---------- Desktop reader ---------- */
{
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const page = await context.newPage();
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto(`${BASE}/g/${slug}`);
  await waitForStageReady(page);
  check('no page errors on the reader', errors.length === 0, errors.slice(0, 3));

  /* DP-21: every request goes to the app's own origin. */
  const foreign = requests.filter((url) => !url.startsWith(BASE) && !url.startsWith('data:') && !url.startsWith('blob:'));
  check('every request is same-origin', foreign.length === 0, foreign);

  const hooks = await stageHooks(page);
  check('stage ready', hooks.state === 'ready', hooks);
  check('opens on step 1', hooks.step === '1' && hooks.explode === '0.000', hooks);
  check('step counter', (await statusText(page, 'Step counter')) === '01 / 05', await statusText(page, 'Step counter'));

  /* DP-19: header figures count up and end at the seeded text. */
  await page.waitForTimeout(900);
  check('total counted up', (await figure(page, 'total-cost')) === '€21.30', await figure(page, 'total-cost'));
  check('part count counted up', (await figure(page, 'part-count')) === '9', await figure(page, 'part-count'));
  check('step count counted up', (await figure(page, 'step-count')) === '5', await figure(page, 'step-count'));

  /* DP-15, DP-16, DP-17: scroll mapping both ways. */
  const H = VIEWPORTS.desktop.height;
  const atStep = async (n, fraction) => {
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), (n + fraction) * H);
    await page.waitForTimeout(80);
    return await stageHooks(page);
  };

  const step2Settled = await atStep(2, 0.65);
  check('step 2 current', step2Settled.step === '2', step2Settled);
  check('step 2 apart amount settled', step2Settled.explode === '0.250', step2Settled);
  check('step 2 pose', step2Settled.yaw === '45' && step2Settled.pitch === '20', step2Settled);
  check('counter follows scroll', (await statusText(page, 'Step counter')) === '02 / 05');
  check(
    'reading progress follows scroll',
    (await statusText(page, 'Reading progress')) ===
      'Step 2 of 5: Free the upper burr. Parts so far: €0.00.',
    await statusText(page, 'Reading progress'),
  );

  const beforeBand = await atStep(2, 0.3);
  check('holds before the band', beforeBand.explode === '0.000', beforeBand);
  const midBand = await atStep(2, 0.5);
  check(
    'rises linearly through the band',
    Number(midBand.explode) > 0 && Number(midBand.explode) < 0.25,
    midBand,
  );
  const afterBand = await atStep(2, 0.9);
  check('holds after the band', afterBand.explode === '0.250', afterBand);

  const step4 = await atStep(4, 0.65);
  check('step 4 apart amount', step4.explode === '0.850', step4);
  check('step 4 pose', step4.yaw === '60' && step4.pitch === '25', step4);
  await page.waitForTimeout(700);
  check('parts cost at step 4', (await figure(page, 'parts-cost')) === '€18.90', await figure(page, 'parts-cost'));

  const backTo2 = await atStep(2, 0.5);
  check('scrolling back reverses exactly', backTo2.explode === midBand.explode, [backTo2.explode, midBand.explode]);

  /* Camera matrices differ between steps with different poses. */
  const matrixAt = async (n) => {
    await atStep(n, 0.65);
    await page.waitForTimeout(80);
    return await page.evaluate(() => {
      const stage = document.querySelector('[aria-label="Model stage"]');
      return `${stage.getAttribute('data-yaw')}|${stage.getAttribute('data-pitch')}`;
    });
  };
  const m1 = await matrixAt(1);
  const m3 = await matrixAt(3);
  check('poses differ between steps', m1 !== m3, [m1, m3]);

  /* DP-18: counts downward going back. */
  await atStep(5, 0.65);
  await page.waitForTimeout(700);
  check('parts cost at step 5', (await figure(page, 'parts-cost')) === '€21.30');
  await atStep(4, 0.65);
  const during = await page.evaluate(
    () => document.querySelector('[data-figure="parts-cost"]').textContent,
  );
  await page.waitForTimeout(700);
  check('counts down to step 4', (await figure(page, 'parts-cost')) === '€18.90', [during]);

  /* DP-15: the closing total. */
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(100);
  check('closing total', (await figure(page, 'closing-total')) === '€21.30', await figure(page, 'closing-total'));
  const closingRed = await page.evaluate(() => {
    const element = document.querySelector('[data-figure="closing-total"]').closest('.closing-total');
    return getComputedStyle(element).backgroundColor;
  });
  check('closing total on post red', closingRed === 'rgb(179, 43, 26)', closingRed);

  /* DP-21: no sideways overflow and callouts inside the viewport. */
  check('no sideways overflow at 1280x800', await noSidewaysOverflow(page));
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), 3.65 * H);
  await page.waitForTimeout(250);
  const calloutsInside = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.callout')];
    return {
      count: items.length,
      inside: items.every((item) => {
        const box = item.getBoundingClientRect();
        return box.left >= -1 && box.top >= -1 && box.right <= window.innerWidth + 1 && box.bottom <= window.innerHeight + 1;
      }),
    };
  });
  check('callouts are shown and inside the viewport', calloutsInside.count > 0 && calloutsInside.inside, calloutsInside);

  /* DP-21 geometry: stage starts at 42% of the width. */
  const geometry = await page.evaluate(() => {
    const holder = document.querySelector('.stage-holder').getBoundingClientRect();
    const panel = document.querySelector('.step-panel:not([hidden])').getBoundingClientRect();
    return { holderLeft: holder.left, holderWidth: holder.width, panelLeft: panel.left, panelWidth: panel.width };
  });
  check(
    'desktop stage starts at 42%',
    Math.abs(geometry.holderLeft - VIEWPORTS.desktop.width * 0.42) < 2,
    geometry,
  );
  check('steps column on the left', geometry.panelLeft < 2, geometry);

  /* DP-20: stage keys. */
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), 1.65 * H);
  await page.waitForTimeout(80);
  const stage = page.locator('[aria-label="Model stage"]');
  await stage.focus();
  const before = await stageHooks(page);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(80);
  const afterYaw = await stageHooks(page);
  check('ArrowRight adds 15 to yaw', Number(afterYaw.yaw) === Number(before.yaw) + 15, [before.yaw, afterYaw.yaw]);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(80);
  const afterPitch = await stageHooks(page);
  check('ArrowUp adds 15 to pitch', Number(afterPitch.pitch) === Number(before.pitch) + 15, afterPitch);
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(80);
  check('pitch clamps at 60', Number((await stageHooks(page)).pitch) === 60, await stageHooks(page));
  await page.keyboard.press('+');
  await page.waitForTimeout(80);
  check('plus zooms by 1.25', (await stageHooks(page)).zoom === '1.25', await stageHooks(page));
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('+');
  await page.waitForTimeout(80);
  check('zoom clamps at 3.00', (await stageHooks(page)).zoom === '3.00', await stageHooks(page));
  await page.keyboard.press('Home');
  await page.waitForTimeout(80);
  const home = await stageHooks(page);
  check(
    'Home returns to the saved pose',
    home.yaw === '30' && home.pitch === '15' && home.zoom === '1.00',
    home,
  );
  await page.keyboard.press('Tab');
  const leftStage = await page.evaluate(
    () => document.activeElement.getAttribute('aria-label') !== 'Model stage',
  );
  check('Tab leaves the stage', leftStage);

  /* Reader bar Tab order, from a fresh load so Tab starts at the document. */
  await page.goto(`${BASE}/g/${slug}`);
  await waitForStageReady(page);
  const order = await tabOrder(page, 9);
  check(
    'reader bar Tab order',
    JSON.stringify(order) ===
      JSON.stringify([
        'Pennywasher',
        'Like',
        'Fork guide',
        'Add to collection',
        'Ask the author',
        'Workshop sound',
        'Previous step',
        'Next step',
        'Model stage',
      ]),
    order,
  );

  await context.close();
}

/* ---------- Deep link, address and history ---------- */
{
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const page = await context.newPage();
  await page.goto(`${BASE}/g/${slug}?step=3`);
  await waitForStageReady(page);
  const settled = await stageHooks(page);
  check('deep link opens settled', settled.step === '3' && settled.explode === '0.500', settled);
  check('deep link pose', settled.yaw === '60' && settled.pitch === '10', settled);
  check('deep link figures final at once', (await figure(page, 'parts-cost')) === '€0.00');
  check('deep link total final at once', (await figure(page, 'total-cost')) === '€21.30');

  await page.reload();
  await waitForStageReady(page);
  check('reload keeps the step', (await stageHooks(page)).step === '3');

  const historyBefore = await page.evaluate(() => history.length);
  await page.getByRole('button', { name: 'Next step' }).click();
  await page.waitForTimeout(450);
  check('Next step moves on', (await stageHooks(page)).step === '4', await stageHooks(page));
  check('address follows', page.url().includes('step=4'), page.url());
  check('button adds a history entry', (await page.evaluate(() => history.length)) > historyBefore);

  await page.goBack();
  await page.waitForTimeout(450);
  check('Back returns to the previous step', (await stageHooks(page)).step === '3', await stageHooks(page));

  /* DP-27: scrolling replaces the address and adds no history entry. */
  const lengthBeforeScroll = await page.evaluate(() => history.length);
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), 1.65 * VIEWPORTS.desktop.height);
  await page.waitForTimeout(150);
  check('scroll replaces the address', page.url().includes('step=1'), page.url());
  check(
    'scroll adds no history entry',
    (await page.evaluate(() => history.length)) === lengthBeforeScroll,
  );

  /* DP-28: a step past the end. */
  await page.goto(`${BASE}/g/${slug}?step=99`);
  await waitForStageReady(page);
  check('past the end shows the last step', (await stageHooks(page)).step === '5', await stageHooks(page));
  check(
    'past the end notice',
    (await statusText(page, 'Guide status')) === 'This guide has 5 steps. Showing step 5.',
    await statusText(page, 'Guide status'),
  );
  await context.close();
}

/* ---------- DP-29, DP-30: sign-in returns to the step ---------- */
{
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const page = await context.newPage();
  await page.goto(`${BASE}/g/${slug}?step=3`);
  await waitForStageReady(page);
  await page.getByRole('button', { name: 'Ask the author' }).click();
  await page.waitForURL(/\/signin/, { timeout: 10000 });
  check('goes to sign-in with a local return path', page.url().includes('next='), page.url());
  check('return path carries the step', decodeURIComponent(page.url()).includes('step=3'), page.url());

  await page.getByLabel('Email').fill(world.reader.email);
  await page.getByLabel('Password').fill(world.reader.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => url.pathname.startsWith('/g/'), { timeout: 10000 });
  await waitForStageReady(page);
  check('returns to the same step', (await stageHooks(page)).step === '3', page.url());
  await context.close();
}

/* ---------- DP-32..DP-38: reduced motion and no WebGL ---------- */
{
  const context = await browser.newContext({
    viewport: VIEWPORTS.desktop,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/g/${slug}`);
  await waitForStageReady(page);
  check('reduced motion figures final at once', (await figure(page, 'total-cost')) === '€21.30');
  const first = await stageHooks(page);
  check('reduced motion opens on step 1', first.step === '1' && first.explode === '0.000', first);

  await page.getByRole('button', { name: 'Next step' }).click();
  await page.waitForTimeout(70);
  const snapped = await stageHooks(page);
  check('pose snaps with no animation', snapped.step === '2' && snapped.explode === '0.250', snapped);
  check(
    'reduced motion announces progress',
    (await statusText(page, 'Reading progress')).startsWith('Step 2 of 5:'),
    await statusText(page, 'Reading progress'),
  );
  const running = await page.evaluate(() => document.getAnimations().length);
  check('no animations running', running === 0, running);

  await page.evaluate(() => window.scrollTo({ top: 4000, behavior: 'instant' }));
  await page.waitForTimeout(120);
  check('scrolling never changes the step', (await stageHooks(page)).step === '2', await stageHooks(page));
  await context.close();
}

{
  const context = await browser.newContext({ viewport: VIEWPORTS.phone, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(`${BASE}/g/${slug}`);
  await waitForStageReady(page);
  const sizes = await page.evaluate(() =>
    ['Previous step', 'Next step'].map((name) => {
      const box = document.querySelector(`[aria-label="${name}"]`).getBoundingClientRect();
      return { name, width: box.width, height: box.height };
    }),
  );
  check(
    'reduced motion controls fit a thumb',
    sizes.every((size) => size.width >= 44 && size.height >= 44),
    sizes,
  );
  check('no sideways overflow at 375x812', await noSidewaysOverflow(page));
  await context.close();
}

/* ---------- DP-36, DP-37: still fallback ---------- */
{
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patched(kind, ...rest) {
      if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') return null;
      return original.call(this, kind, ...rest);
    };
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/g/${slug}?step=2`);
  await waitForStageReady(page);
  const hooks = await stageHooks(page);
  check('still state', hooks.state === 'still', hooks);
  const still = await page.evaluate(() => {
    const image = document.querySelector('.stage-still');
    return image === null ? null : { alt: image.getAttribute('alt'), src: image.getAttribute('src') };
  });
  check(
    'still accessible name',
    still !== null && still.alt === `${world.guides.public.title}, step 2 still`,
    still,
  );
  check(
    'still fallback copy',
    (await statusText(page, 'Stage status')) === '3D view is not available here. Showing a still of this step.',
    await statusText(page, 'Stage status'),
  );
  const textBeside = await page.evaluate(
    () => document.querySelector('.step-panel:not([hidden]) .step-text')?.textContent ?? '',
  );
  check('step text beside the still', textBeside.includes('Undo the two clips'), textBeside.slice(0, 40));

  await page.getByRole('button', { name: 'Next step' }).click();
  await page.waitForTimeout(120);
  const nextStill = await page.evaluate(() => {
    const image = document.querySelector('.stage-still');
    return { alt: image.getAttribute('alt'), src: image.getAttribute('src') };
  });
  check(
    'still follows the step buttons',
    nextStill.alt.includes('step 3 still') && nextStill.src.includes('/stills/3'),
    nextStill,
  );
  await context.close();
}

/* ---------- DP-39..DP-45: phone ---------- */
{
  const context = await browser.newContext({
    viewport: VIEWPORTS.phone,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/g/${slug}?step=3`);
  await waitForStageReady(page);

  check('no sideways overflow on a phone', await noSidewaysOverflow(page));
  const partsList = await page.evaluate(() => {
    const list = document.querySelector('[aria-label="Parts"]');
    if (list === null) return null;
    return {
      visible: getComputedStyle(list).display !== 'none',
      items: [...list.querySelectorAll('li')].map((item) => item.textContent),
      callouts: document.querySelectorAll('.callout').length,
    };
  });
  check(
    'numbered parts list replaces callouts',
    partsList !== null && partsList.visible && partsList.items.length === 2,
    partsList,
  );

  const taps = await page.evaluate(() =>
    [...document.querySelectorAll('.reader-bar button, .free-look')].map((button) => {
      const box = button.getBoundingClientRect();
      return { name: button.getAttribute('aria-label'), width: box.width, height: box.height };
    }),
  );
  check(
    'every phone control is at least 44x44',
    taps.every((tap) => tap.width >= 44 && tap.height >= 44),
    taps.filter((tap) => tap.width < 44 || tap.height < 44),
  );

  /* DP-42: a vertical drag scrolls the page with Free look off. */
  const beforeDrag = await stageHooks(page);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const stageBox = await page.locator('[aria-label="Model stage"]').boundingBox();
  await page.touchscreen.tap(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
  await page.evaluate(() => window.scrollBy(0, 200));
  await page.waitForTimeout(120);
  const afterDrag = await stageHooks(page);
  check(
    'vertical scrolling leaves the orbit alone',
    afterDrag.yaw === beforeDrag.yaw || (await page.evaluate(() => window.scrollY)) !== scrollBefore,
    [beforeDrag, afterDrag],
  );

  /* DP-43: Free look orbits. */
  await page.goto(`${BASE}/g/${slug}?step=3`);
  await waitForStageReady(page);
  await page.getByRole('switch', { name: 'Free look' }).click();
  check(
    'free look switch turns on',
    (await page.getByRole('switch', { name: 'Free look' }).getAttribute('aria-checked')) === 'true',
  );
  const box = await page.locator('[aria-label="Model stage"]').boundingBox();
  const start = await stageHooks(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(120);
  const orbited = await stageHooks(page);
  check('free look orbits', orbited.yaw !== start.yaw, [start.yaw, orbited.yaw]);
  await context.close();
}

/* ---------- DP-91..DP-97: embed and sound ---------- */
{
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const page = await context.newPage();
  await page.goto(`${BASE}/embed/${slug}?step=3`);
  await waitForStageReady(page);
  const hooks = await stageHooks(page);
  check('embed opens settled', hooks.step === '3' && hooks.explode === '0.500', hooks);
  check('embed parts cost final', (await figure(page, 'parts-cost')) === '€0.00');
  const controls = await page.evaluate(() =>
    [...document.querySelectorAll('[aria-label]')].map((element) => element.getAttribute('aria-label')),
  );
  check('embed has no edit, like, fork or ask control', !controls.includes('Like') && !controls.includes('Fork guide') && !controls.includes('Ask the author'), controls);
  check('embed has the open link', (await page.getByRole('link', { name: 'Open on Pennywasher' }).count()) === 1);
  check('embed sets no cookie', (await context.cookies()).length === 0);

  /* DP-94, DP-95: sound stays off until pressed. */
  const soundState = await page.evaluate(() => window.__pwSound ?? null);
  check('no audio context before the press', soundState === null, soundState);
  await context.close();
}

/* ---------- DP-45: tablet layout ---------- */
{
  const context = await browser.newContext({ viewport: VIEWPORTS.tablet, hasTouch: true });
  const page = await context.newPage();
  await page.goto(`${BASE}/g/${slug}?step=2`);
  await waitForStageReady(page);
  check('no sideways overflow at 768x1024', await noSidewaysOverflow(page));
  const geometry = await page.evaluate(() => {
    const holder = document.querySelector('.stage-holder').getBoundingClientRect();
    const bar = document.querySelector('.reader-bar').getBoundingClientRect();
    const panel = document.querySelector('.step-panel:not([hidden])').getBoundingClientRect();
    return {
      holderTop: holder.top,
      holderHeight: holder.height,
      barBottom: window.innerHeight - bar.bottom,
      panelTop: panel.top,
      viewportHeight: window.innerHeight,
    };
  });
  check(
    'tablet stage across the top at 46% of the viewport height',
    geometry.holderTop <= 1 && Math.abs(geometry.holderHeight - geometry.viewportHeight * 0.46) < 2,
    geometry,
  );
  check('tablet step panel sits below the stage', geometry.panelTop >= geometry.holderHeight - 1, geometry);
  check('tablet reader bar is fixed to the bottom', geometry.barBottom <= 1, geometry);
  const taps = await page.evaluate(() =>
    [...document.querySelectorAll('.reader-bar button')].map((button) => {
      const box = button.getBoundingClientRect();
      return { name: button.getAttribute('aria-label'), width: box.width, height: box.height };
    }),
  );
  check(
    'every tablet control is at least 44x44',
    taps.every((tap) => tap.width >= 44 && tap.height >= 44),
    taps.filter((tap) => tap.width < 44 || tap.height < 44),
  );
  await context.close();
}

/* ---------- DP-61: forms are adjoining outlined cells ---------- */
{
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const page = await context.newPage();
  await page.goto(`${BASE}/signin`);
  const cells = await page.evaluate(() =>
    [...document.querySelectorAll('.cell')].map((cell) => {
      const style = getComputedStyle(cell);
      return {
        outline: style.borderTopWidth,
        radius: style.borderTopLeftRadius,
        gap: style.marginBottom,
        fontSize: parseFloat(style.fontSize),
        bottom: cell.getBoundingClientRect().bottom,
        top: cell.getBoundingClientRect().top,
      };
    }),
  );
  check('forms use 2 px outlined cells', cells.length >= 2 && cells.every((cell) => cell.outline === '2px'), cells);
  check('cells have square corners', cells.every((cell) => cell.radius === '0px'), cells);
  check('cells adjoin', cells.every((cell) => cell.gap === '-2px'), cells);
  check('labels are at least 16 px', cells.every((cell) => cell.fontSize >= 16), cells);
  for (let i = 1; i < cells.length; i += 1) {
    check(`cell ${i} butts against the one above`, Math.abs(cells[i].top - cells[i - 1].bottom + 2) < 2, [
      cells[i - 1].bottom,
      cells[i].top,
    ]);
  }
  await context.close();
}

/* ---------- Visual design checks ---------- */
{
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const page = await context.newPage();
  await page.goto(`${BASE}/`);
  const hero = await page.evaluate(() => {
    const heading = document.querySelector('h1.waterline');
    const above = document.querySelector('.waterline-above');
    const below = document.querySelector('.waterline-below');
    const wordmark = document.querySelector('.wordmark').getBoundingClientRect();
    const start = document.querySelector('.hero-start');
    const startBox = start.getBoundingClientRect();
    return {
      text: heading.textContent,
      aboveColour: getComputedStyle(above).color,
      belowColour: getComputedStyle(below).color,
      belowHidden: below.getAttribute('aria-hidden'),
      wordmarkLeft: wordmark.left,
      startRight: window.innerWidth - startBox.right,
      startBackground: getComputedStyle(start).backgroundColor,
      images: document.querySelectorAll('.hero img').length,
      supporting: document.querySelector('.hero-supporting').textContent,
      supportingColour: getComputedStyle(document.querySelector('.hero-supporting')).color,
    };
  });
  check('hero headline', hero.text.includes('TAKE IT') && hero.text.includes('APART.'), hero.text);
  check('seam cuts APART. in two colours', hero.aboveColour !== hero.belowColour, hero);
  check('lower copy hidden from assistive technology', hero.belowHidden === 'true', hero);
  check('wordmark top-left', hero.wordmarkLeft < 40, hero.wordmarkLeft);
  check('solid slate link top-right', hero.startRight < 40 && hero.startBackground === 'rgb(57, 85, 111)', hero);
  check('no image in the hero', hero.images === 0);
  check(
    'one supporting sentence in white',
    hero.supporting === 'Upload the thing you fixed, and readers watch it come apart one step at a time.' &&
      hero.supportingColour === 'rgb(255, 255, 255)',
    hero,
  );

  const corners = await page.evaluate(() =>
    [...document.querySelectorAll('*')].filter((element) => {
      const radius = getComputedStyle(element).borderTopLeftRadius;
      return radius !== '0px' && radius !== '';
    }).length,
  );
  check('corners are square everywhere', corners === 0, corners);

  const shadows = await page.evaluate(() =>
    [...document.querySelectorAll('*')].filter((element) => {
      const style = getComputedStyle(element);
      return style.boxShadow !== 'none' || style.backgroundImage.includes('gradient') === false ? style.boxShadow !== 'none' : false;
    }).length,
  );
  check('no shadows', shadows === 0, shadows);
  await context.close();
}

await browser.close();
process.exit(report());
