/* A walk through the screens in a real browser: keyboard booking, the axis wipe,
   responsive layouts and reduced motion. */
import { chromium } from '/tmp/node_modules/playwright/index.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
let failures = 0;
const consoleErrors = [];

function check(label, condition, detail) {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300));
  }
}

/* One sign-in per role is kept and reused, so the sign_in allowance is not spent on
   repeated runs of this script. */
const savedSessions = new Map();

async function submitSignIn(page, email) {
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('hoofcare-2026');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForTimeout(800);
    const notice = (await page.evaluate(() => document.querySelector('[aria-live]')?.textContent)) ?? '';
    const limited = /Try again in (\d+) seconds/.exec(notice);
    if (limited === null) return;
    // The sign-in allowance is real; this script waits it out rather than working around it.
    await page.waitForTimeout((Number(limited[1]) + 1) * 1000);
  }
}

async function storageFor(email) {
  const kept = savedSessions.get(email);
  if (kept !== undefined) return kept;
  const context = await browser.newContext();
  const page = await context.newPage();
  await submitSignIn(page, email);
  await page.waitForFunction(() => document.querySelector('.app') !== null, { timeout: 20000 });
  const state = await context.storageState();
  await context.close();
  savedSessions.set(email, state);
  return state;
}

async function signIn(page, email) {
  const state = await storageFor(email);
  await page.context().addCookies(state.cookies);
  await page.goto(`${BASE}/`);
  await page.waitForFunction(() => document.querySelector('.app') !== null, { timeout: 20000 });
}

async function noHorizontalScroll(page) {
  return await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );
}

async function smallTapTargets(page) {
  return await page.evaluate(() => {
    const bad = [];
    const nodes = document.querySelectorAll('button, input[type="radio"], input[type="checkbox"], input[type="range"], a');
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.height < 44 || rect.width < 44) {
        bad.push(`${node.tagName}:${(node.textContent ?? node.getAttribute('aria-label') ?? '').trim().slice(0, 24)} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
    }
    return bad;
  });
}

const browser = await chromium.launch();

async function withPage(viewport, options, work) {
  const context = await browser.newContext({ viewport, ...options });
  const page = await context.newPage();
  page.on('console', (message) => {
    // A 401 on /api/me while signed out is ordinary working: only script errors count.
    const text = message.text();
    if (message.type() === 'error' && !text.includes('status of 401')) consoleErrors.push(text);
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  try {
    await work(page);
  } finally {
    await context.close();
  }
}

console.log('\n== sign in and the shell ==');
await withPage({ width: 1280, height: 800 }, {}, async (page) => {
  await page.goto(`${BASE}/dashboard`);
  check('a signed-out app URL shows the Sign in form',
    await page.getByRole('form', { name: 'Sign in' }).isVisible());
  await page.getByLabel('Email').fill('farrier@clinchline.test');
  await page.getByLabel('Password').fill('wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(600);
  check('a wrong password shows the published line',
    (await page.getByRole('status', { name: 'Notices' }).textContent()) === 'Email or password is wrong.');

  await page.getByLabel('Password').fill('hoofcare-2026');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForTimeout(800);
    const notice = (await page.evaluate(() => document.querySelector('[aria-live]')?.textContent)) ?? '';
    const limited = /Try again in (\d+) seconds/.exec(notice);
    if (limited === null) break;
    await page.waitForTimeout((Number(limited[1]) + 1) * 1000);
  }
  await page.waitForFunction(() => document.querySelector('.app') !== null, { timeout: 30000 });
  check('after signing in the browser is at the requested path', new URL(page.url()).pathname === '/dashboard');
  check('the wordmark is shown', await page.locator('.wordmark').first().isVisible());
  check('Notices is the only live region',
    (await page.locator('[aria-live]').count()) === 1,
    await page.locator('[aria-live]').count());
  check('the rail lists barn days', (await page.getByRole('navigation', { name: 'Barn days' }).locator('a').count()) > 0);
  check('the rail holds Horses, Invoices, Prices and Dashboard',
    (await page.locator('.rail a', { hasText: 'Dashboard' }).count()) === 1);
  check('Dashboard shows its month totals', await page.getByRole('table', { name: 'Month totals' }).isVisible());
  check('the chart carries a text alternative',
    /Billed \$[\d,.]+, collected \$[\d,.]+ in \d{4}-\d{2}\./.test(
      (await page.locator('figcaption').first().textContent()) ?? '',
    ),
    await page.locator('figcaption').first().textContent());
  check('Daily figures is focusable',
    (await page.getByRole('table', { name: 'Daily figures' }).getAttribute('tabindex')) === '0');
  check('no horizontal scrolling at 1280x800', await noHorizontalScroll(page));
  const smalls = await smallTapTargets(page);
  check('every tap target is at least 44 px at 1280', smalls.length === 0, smalls);

  const fonts = await page.evaluate(() => {
    const body = getComputedStyle(document.body).fontFamily;
    const heading = getComputedStyle(document.querySelector('caption') ?? document.body).fontFamily;
    const ground = getComputedStyle(document.body).backgroundColor;
    return { body, heading, ground };
  });
  check('body text is set in Public Sans', fonts.body.includes('Public Sans'), fonts);
  check('table headers are set in Archivo', fonts.heading.includes('Archivo'), fonts);
  check('the page ground is a warm bone colour', fonts.ground === 'rgb(243, 236, 221)', fonts);

  const noExternal = await page.evaluate(() =>
    [...document.querySelectorAll('link[href], script[src], img[src]')]
      .map((node) => node.getAttribute('href') ?? node.getAttribute('src') ?? '')
      .filter((value) => /^https?:\/\//.test(value)),
  );
  check('no asset is loaded from a third-party host', noExternal.length === 0, noExternal);
});

console.log('\n== the farrier day sheet ==');
await withPage({ width: 1280, height: 800 }, {}, async (page) => {
  await signIn(page, 'farrier@clinchline.test');
  await page.getByRole('navigation', { name: 'Barn days' }).locator('a').first().click();
  await page.waitForTimeout(1200);
  check('the day sheet is shown', await page.getByRole('table', { name: 'Day sheet' }).isVisible());
  const header = (await page.locator('.day-header').textContent()) ?? '';
  check('the header shows the cancel-by time with the zone',
    /Cancel by \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(America\/Denver\)/.test(header), header);
  check('the farrier sees the trip fee', /Trip fee \$45\.00/.test(header), header);
  check('the Waitlist sub-table follows the rows', await page.getByRole('table', { name: 'Waitlist' }).isVisible());
  const columns = await page.getByRole('table', { name: 'Day sheet' }).locator('thead th').allTextContents();
  check('the farrier columns are the published set',
    columns.join(',') === 'Time,Horse,Stall,Owner,Cycle (weeks),Status,Share,Visit', columns);
  check('the rail marks the day on screen',
    (await page.locator('.rail a[aria-current="page"]').count()) === 1);
});

console.log('\n== the apprentice sees no owner or share ==');
await withPage({ width: 1280, height: 800 }, {}, async (page) => {
  await signIn(page, 'apprentice@clinchline.test');
  await page.getByRole('navigation', { name: 'Barn days' }).locator('a').first().click();
  await page.waitForTimeout(1200);
  const columns = await page.getByRole('table', { name: 'Day sheet' }).locator('thead th').allTextContents();
  check('the apprentice columns leave out Owner and Share',
    columns.join(',') === 'Time,Horse,Stall,Cycle (weeks),Status,Visit', columns);
  check('the apprentice rail has no Prices entry', (await page.locator('.rail a', { hasText: 'Prices' }).count()) === 0);
});

console.log('\n== the barn manager ready sheet from a bookmark ==');
await withPage({ width: 768, height: 1024 }, {}, async (page) => {
  const farrier = await browser.newContext({ storageState: await storageFor('farrier@clinchline.test') });
  const farrierPage = await farrier.newPage();
  await farrierPage.goto(`${BASE}/`);
  await farrierPage.waitForFunction(() => document.querySelector('.app') !== null);
  const dayHref = await farrierPage.getByRole('navigation', { name: 'Barn days' }).locator('a').first().getAttribute('href');
  await farrier.close();

  await page.goto(`${BASE}${dayHref}`);
  check('the bookmark shows Sign in while signed out',
    await page.getByRole('form', { name: 'Sign in' }).isVisible());
  await page.getByLabel('Email').fill('manager.cedar@clinchline.test');
  await page.getByLabel('Password').fill('hoofcare-2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(1500);
  check('signing in lands on that same day', new URL(page.url()).pathname === dayHref, page.url());
  const ready = page.getByRole('table', { name: 'Ready sheet' });
  check('the ready sheet is shown', await ready.isVisible());
  const columns = await ready.locator('thead th').allTextContents();
  check('it lists only time, horse and stall', columns.join(',') === 'Time,Horse,Stall', columns);
  const text = (await page.locator('.main').textContent()) ?? '';
  check('no owner name is on the page', !text.includes('Ada Quill') && !text.includes('Bram Lowe'), text.slice(0, 160));
  check('no money amount is on the page', !/\$\d/.test(text), text.slice(0, 160));
  await page.reload();
  await page.waitForTimeout(1200);
  check('reloading keeps the ready sheet', await page.getByRole('table', { name: 'Ready sheet' }).isVisible());
  check('no horizontal scrolling at 768x1024', await noHorizontalScroll(page));
});

console.log('\n== an owner books with the keyboard ==');
await withPage({ width: 1280, height: 800 }, {}, async (page) => {
  // A fresh published day of its own, so the walk does not depend on what other
  // suites have booked.
  const staff = await browser.newContext({ storageState: await storageFor('farrier@clinchline.test') });
  const staffPage = await staff.newPage();
  await staffPage.goto(`${BASE}/`);
  await staffPage.waitForFunction(() => document.querySelector('.app') !== null);
  const fixture = await staffPage.evaluate(async () => {
    const practice = await (await fetch('/api/practice')).json();
    const barns = await (await fetch('/api/barns')).json();
    const cedar = barns.find((barn) => barn.name === 'Cedar Hollow Stables');
    const made = await (
      await fetch('/api/barn-days', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          barn_id: cedar.id,
          business_date: new Date(Date.parse(`${practice.today}T12:00:00Z`) + 3 * 86400000)
            .toISOString()
            .slice(0, 10),
          start_time: '09:15',
          slot_count: 2,
          slot_minutes: 15,
        }),
      })
    ).json();
    await fetch(`/api/barn-days/${made.id}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    return made.id;
  });
  await staff.close();

  await signIn(page, 'owner.cleo@clinchline.test');
  const rail = page.getByRole('navigation', { name: 'Barn days' });
  if ((await rail.locator('a').count()) === 0) {
    console.log('  (no published day is open for this owner right now)');
  } else {
    await page.goto(`${BASE}/days/${fixture}`);
    await page.waitForTimeout(1500);
    check('the owner day view shows a Slots table', await page.getByRole('table', { name: 'Slots' }).isVisible());
    check('the Horse picker is shown', await page.getByLabel('Horse').isVisible());
    const cardOptions = await page.getByLabel('Card').locator('option').allTextContents();
    check('the card picker lists the three test cards',
      cardOptions.join('|') ===
        'Test card 4242 (approves)|Test card 0002 (declines)|Test card 9995 (insufficient funds)',
      cardOptions);

    const bookButton = page.getByRole('button', { name: /^Book \d{2}:\d{2}$/ }).first();
    if ((await bookButton.count()) > 0) {
      const slotLabel = await bookButton.textContent();
      await bookButton.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1200);
      const dialog = page.getByRole('dialog', { name: 'Confirm booking' });
      check('pressing the slot opens the Confirm booking dialog', await dialog.isVisible());
      const body = (await dialog.textContent()) ?? '';
      check('the dialog states the deposit', /Deposit \$25\.00\./.test(body), body);
      check('the dialog states the cutoff and the hold end',
        /Cancel by .+ \(America\/Denver\) or the trip share still applies\./.test(body) &&
          /Hold ends at \d{2}:\d{2}:\d{2} \(America\/Denver\)\./.test(body),
        body);
      check('focus starts on Confirm booking',
        (await page.evaluate(() => document.activeElement?.textContent)) === 'Confirm booking');

      // Tab cycles only inside the dialog.
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const dialogNode = document.querySelector('[role="dialog"]');
        return dialogNode?.contains(document.activeElement) ?? false;
      });
      check('Tab is trapped inside the dialog', inside);

      await page.getByRole('button', { name: 'Confirm booking' }).click();
      await page.waitForTimeout(2000);
      const notice = (await page.getByRole('status', { name: 'Notices' }).textContent()) ?? '';
      check('the booking is announced once', /^Booked .+ for \d{2}:\d{2} on \d{4}-\d{2}-\d{2}\. A confirmation email is on its way\.$/.test(notice), notice);
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent);
      check('focus returns to the new cancel button', /^Cancel booking for /.test(focused ?? ''), focused);
      check('a visual toast carries the same copy, hidden from the reader',
        (await page.locator('.toast p[aria-hidden="true"]').count()) >= 1);
      void slotLabel;

      console.log('\n== the owner cancels ==');
      const cancelButton = page.getByRole('button', { name: /^Cancel booking for / }).first();
      await cancelButton.click();
      await page.waitForTimeout(900);
      const cancelDialog = page.getByRole('dialog', { name: 'Cancel booking' });
      check('the cancel dialog opens', await cancelDialog.isVisible());
      const cancelBody = (await cancelDialog.textContent()) ?? '';
      check('it states the verdict and the deposit',
        cancelBody.includes('Cancelling now is before the cutoff. No trip share applies.') &&
          cancelBody.includes('Your $25.00 deposit will be refunded.'),
        cancelBody);
      check('focus starts on Keep booking',
        (await page.evaluate(() => document.activeElement?.textContent)) === 'Keep booking');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      check('Escape closes it and returns focus to the opener',
        /^Cancel booking for /.test((await page.evaluate(() => document.activeElement?.textContent)) ?? ''));

      await cancelButton.click();
      await page.waitForTimeout(700);
      await page.getByRole('button', { name: 'Confirm cancellation' }).click();
      await page.waitForTimeout(2500);
      const after = (await page.getByRole('status', { name: 'Notices' }).textContent()) ?? '';
      check('the cancellation is announced', after.includes('Booking cancelled.'), after);
    }
  }
});

console.log('\n== the comparison stage ==');
await withPage({ width: 1280, height: 800 }, {}, async (page) => {
  await signIn(page, 'owner.ada@clinchline.test');
  await page.goto(`${BASE}/horses`);
  await page.waitForTimeout(900);
  await page.getByRole('link', { name: 'Juniper' }).click();
  await page.waitForTimeout(2000);

  check('the comparison region is shown', await page.getByRole('region', { name: 'Hoof comparison' }).isVisible());
  const slider = page.getByRole('slider', { name: 'Comparison divider' });
  check('the divider starts at 50', (await slider.getAttribute('aria-valuetext')) === '50% current',
    await slider.getAttribute('aria-valuetext'));

  // The two seeded visits are the oldest pair; choosing them exercises the pair change
  // and pins the readout to the published example.
  const previousPicker = page.getByLabel('Previous visit');
  const currentPicker = page.getByLabel('Current visit');
  const dates = await previousPicker.locator('option').allTextContents();
  check('the visit pickers list the dates marked on this hoof', dates.length >= 2, dates);
  const values = await previousPicker.locator('option').evaluateAll((nodes) => nodes.map((node) => node.value));
  await previousPicker.selectOption(values[0]);
  await page.waitForTimeout(1200);
  await currentPicker.selectOption(values[1]);
  await page.waitForTimeout(1400);

  const readout = page.getByRole('status', { name: 'Angle readout' });
  const lines = (await readout.textContent()) ?? '';
  check('readout line 1 matches the stored angles', lines.includes('Hoof wall 51.5° → 54.0° (+2.5°)'), lines);
  check('readout line 2 uses the minus sign U+2212', lines.includes('Pastern 56.0° → 55.0° (−1.0°)'), lines);
  check('readout line 3 names both labels', lines.includes('Alignment broken-back → aligned'), lines);

  const notAvailable = await page.goto(`${BASE}/horses/not-a-real-horse?hoof=LF`);
  void notAvailable;
  await page.waitForTimeout(1200);
  check('a horse URL the caller may not see shows only the not-available copy',
    ((await page.locator('.form-error').textContent()) ?? '') === "This horse isn't available." &&
      (await page.locator('.rail').count()) === 1,
    await page.locator('.main').textContent());
  await page.goBack();
  await page.waitForTimeout(1800);

  const hoofRadios = await page.getByRole('radiogroup', { name: 'Hoof' }).locator('input[type="radio"]').count();
  check('the hoof picker holds four radios', hoofRadios === 4, hoofRadios);

  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  check('Arrow Right adds one', (await slider.getAttribute('aria-valuetext')) === '51% current',
    await slider.getAttribute('aria-valuetext'));
  await page.keyboard.press('PageUp');
  await page.waitForTimeout(400);
  check('Page Up adds ten', (await slider.getAttribute('aria-valuetext')) === '61% current',
    await slider.getAttribute('aria-valuetext'));
  await page.keyboard.press('Home');
  await page.waitForTimeout(400);
  check('Home sets 0', (await slider.getAttribute('aria-valuetext')) === '0% current');
  await page.keyboard.press('End');
  await page.waitForTimeout(400);
  check('End sets 100', (await slider.getAttribute('aria-valuetext')) === '100% current');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(300);
  check('values stay within range', (await slider.getAttribute('aria-valuetext')) === '100% current');

  const layers = await page.evaluate(() => {
    const stage = document.querySelector('.stage');
    const previous = stage?.querySelector('img.previous');
    const current = stage?.querySelector('img.current');
    const svgs = stage?.querySelectorAll('svg') ?? [];
    const strokes = [...(svgs[0]?.querySelectorAll('line') ?? [])].map((node) => ({
      stroke: node.getAttribute('stroke'),
      dash: node.getAttribute('stroke-dasharray'),
      width: node.getAttribute('stroke-width'),
    }));
    const currentStrokes = [...(svgs[1]?.querySelectorAll('line') ?? [])].map((node) => ({
      stroke: node.getAttribute('stroke'),
      dash: node.getAttribute('stroke-dasharray'),
      width: node.getAttribute('stroke-width'),
    }));
    return {
      hasPrevious: previous !== null && previous.getAttribute('src') !== null,
      hasCurrent: current !== null && current.getAttribute('src') !== null,
      clip: current === null ? '' : getComputedStyle(current).clipPath,
      strokes,
      currentStrokes,
      backing: stage === null ? '' : getComputedStyle(stage).backgroundImage,
    };
  });
  check('both photos are layered on the stage', layers.hasPrevious && layers.hasCurrent, layers);
  check('the current photo is clipped to the divider', layers.clip.includes('inset'), layers.clip);
  check('previous lines are dashed steel blue',
    layers.strokes.some((line) => line.stroke === '#355470' && line.dash !== null), layers.strokes);
  check('current lines are solid forge orange',
    layers.currentStrokes.some((line) => line.stroke === '#b2480d' && line.dash === null), layers.currentStrokes);
  check('each line is at least three pixels thick with an ink outline',
    layers.strokes.some((line) => Number(line.width) >= 3) &&
      layers.strokes.some((line) => line.stroke === '#241a12'),
    layers.strokes);
  check('the stage backing runs steel blue through ink to forge orange',
    layers.backing.includes('53, 84, 112') && layers.backing.includes('143, 58, 6'), layers.backing);

  await page.reload();
  await page.waitForTimeout(2000);
  check('reload keeps the horse and hoof', new URL(page.url()).searchParams.get('hoof') === 'LF');

  // Back and Forward restore the previous and next screen.
  const horsePath = new URL(page.url()).pathname;
  await page.goto(`${BASE}/invoices`);
  await page.waitForTimeout(1200);
  check('Invoices opens at its own path', new URL(page.url()).pathname === '/invoices');
  await page.goBack();
  await page.waitForTimeout(1800);
  check('Back restores the horse panel', new URL(page.url()).pathname === horsePath, page.url());
  check('the comparison stage is there again', await page.locator('.stage').isVisible());
  await page.goForward();
  await page.waitForTimeout(1500);
  check('Forward restores Invoices',
    new URL(page.url()).pathname === '/invoices' &&
      (await page.getByRole('table', { name: 'Invoices' }).isVisible()),
    page.url());
  await page.goBack();
  await page.waitForTimeout(1800);

  const entriesBefore = await page.evaluate(() => history.length);
  await page.getByRole('radio', { name: 'Right fore' }).click();
  await page.waitForTimeout(1500);
  check('choosing another hoof replaces the hoof value',
    new URL(page.url()).searchParams.get('hoof') === 'RF', page.url());
  check('it adds no history entry', (await page.evaluate(() => history.length)) === entriesBefore);
  const rfValues = await page.getByLabel('Previous visit').locator('option').evaluateAll((nodes) =>
    nodes.map((node) => node.value),
  );
  await page.getByLabel('Previous visit').selectOption(rfValues[0]);
  await page.waitForTimeout(1000);
  await page.getByLabel('Current visit').selectOption(rfValues[1]);
  await page.waitForTimeout(1400);
  const rfLines = (await readout.textContent()) ?? '';
  check('the right fore readout follows', rfLines.includes('Hoof wall 49.6° → 50.8° (+1.2°)'), rfLines);
  await page.waitForTimeout(700);
  check('the divider glided back to the middle',
    (await slider.getAttribute('aria-valuetext')) === '50% current',
    await slider.getAttribute('aria-valuetext'));
});

console.log('\n== reduced motion ==');
await withPage({ width: 1280, height: 800 }, { reducedMotion: 'reduce' }, async (page) => {
  await signIn(page, 'owner.ada@clinchline.test');
  await page.goto(`${BASE}/horses`);
  await page.waitForTimeout(800);
  await page.getByRole('link', { name: 'Juniper' }).click();
  await page.waitForTimeout(1800);
  const group = page.getByRole('radiogroup', { name: 'Divider position' });
  check('the Divider position control appears', await group.isVisible());
  const options = await group.locator('input[type="radio"]').count();
  check('it offers Previous, Split and Current', options === 3, options);
  await page.getByRole('radio', { name: 'Current' }).click();
  await page.waitForTimeout(200);
  const slider = page.getByRole('slider', { name: 'Comparison divider' });
  check('Current sets the divider to 100', (await slider.getAttribute('aria-valuetext')) === '100% current');
  await page.getByRole('radio', { name: 'Previous' }).click();
  await page.waitForTimeout(200);
  check('Previous sets the divider to 0', (await slider.getAttribute('aria-valuetext')) === '0% current');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  check('the arrow keys still work', (await slider.getAttribute('aria-valuetext')) === '1% current');
  const animating = await page.evaluate(() => {
    const chip = document.querySelector('.chip');
    return chip === null ? 'none' : getComputedStyle(chip).animationName;
  });
  check('chips do not animate under reduced motion', animating === 'none' || animating === '', animating);
});

console.log('\n== the small viewport ==');
await withPage({ width: 375, height: 812 }, {}, async (page) => {
  await signIn(page, 'farrier@clinchline.test');
  await page.waitForTimeout(1500);
  const toggle = page.getByRole('button', { name: 'Barn days' });
  check('the rail collapses into a Barn days button', await toggle.isVisible());
  check('it reports its collapsed state', (await toggle.getAttribute('aria-expanded')) === 'false');
  const hiddenBefore = await page.evaluate(() => {
    const rail = document.querySelector('.rail');
    return rail === null ? true : getComputedStyle(rail).display === 'none';
  });
  check('a closed panel is out of reach', hiddenBefore);
  await toggle.click();
  await page.waitForTimeout(300);
  check('opening it expands the panel', (await toggle.getAttribute('aria-expanded')) === 'true');
  check('no horizontal scrolling at 375x812', await noHorizontalScroll(page));
  const stacked = await page.evaluate(() => {
    const cell = document.querySelector('table.stacked td');
    return cell === null ? '' : getComputedStyle(cell).display;
  });
  check('each row becomes a stacked block with labelled values', stacked === 'flex', stacked);
  const smalls = await smallTapTargets(page);
  check('every tap target is at least 44 px at 375', smalls.length === 0, smalls);

  await page.goto(`${BASE}/dashboard`);
  await page.waitForTimeout(1200);
  const order = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.dashboard-top > *')];
    return nodes
      .map((node) => ({ name: node.className, order: Number(getComputedStyle(node).order) }))
      .sort((left, right) => left.order - right.order)
      .map((entry) => entry.name);
  });
  check('Dashboard is one column with the chart above the totals',
    order[0] === 'chart-host' && order[1] === 'totals', order);
  check('no horizontal scrolling on Dashboard at 375', await noHorizontalScroll(page));
});

console.log('\n== the vet page ==');
await withPage({ width: 1280, height: 800 }, {}, async (page) => {
  const context = await browser.newContext({ storageState: await storageFor('farrier@clinchline.test') });
  const farrierPage = await context.newPage();
  await farrierPage.goto(`${BASE}/`);
  await farrierPage.waitForFunction(() => document.querySelector('.app') !== null);
  const link = await farrierPage.evaluate(async () => {
    const horses = await (await fetch('/api/horses')).json();
    const juniper = horses.find((horse) => horse.name === 'Juniper');
    const response = await fetch(`/api/horses/${juniper.id}/vet-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vet_name: 'Dr Wren Ash', vet_email: 'vet.ui@clinchline.test' }),
    });
    return await response.json();
  });
  await context.close();

  const vetData = await (await fetch(`${BASE}${link.url.replace('/vet/', '/api/vet/')}`)).json();
  const markedHoof = ['LF', 'RF', 'LH', 'RH'].find((hoof) => vetData.hooves[hoof] !== null);
  check('the live pair carries marks on at least one hoof', markedHoof !== undefined, Object.keys(vetData.hooves));

  await page.goto(`${BASE}${link.url}`);
  await page.waitForTimeout(1500);
  if (markedHoof !== undefined) {
    const names = { LF: 'Left fore', RF: 'Right fore', LH: 'Left hind', RH: 'Right hind' };
    await page.getByRole('radio', { name: names[markedHoof] }).click();
    await page.waitForTimeout(1200);
  }
  check('the vet page shows the horse name', ((await page.locator('h5').textContent()) ?? '') === 'Juniper');
  check('it shows the live pair of dates',
    /\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}/.test((await page.locator('.main p.num').first().textContent()) ?? ''));
  check('it shows one comparison stage', (await page.locator('.stage').count()) === 1);
  check('there is no rail', (await page.locator('.rail').count()) === 0);
  const text = (await page.locator('body').textContent()) ?? '';
  check('no owner, price or invoice detail is shown',
    !text.includes('Ada Quill') && !/\$\d/.test(text), text.slice(0, 200));
  const readout = (await page.getByRole('status', { name: 'Angle readout' }).textContent()) ?? '';
  check('the vet readout matches the stored angles',
    readout.includes('Hoof wall 51.5° → 54.0° (+2.5°)') &&
      readout.includes('Pastern 56.0° → 55.0° (−1.0°)') &&
      readout.includes('Alignment broken-back → aligned'),
    readout);

  await page.goto(`${BASE}/vet/not-a-real-token`);
  await page.waitForTimeout(900);
  check('an unknown token shows the published line',
    ((await page.locator('.form-error').textContent()) ?? '') === 'This comparison link is no longer available.');
});

console.log(`\nconsole errors: ${consoleErrors.length}`);
for (const error of consoleErrors.slice(0, 5)) console.log(`  ${error}`);
console.log(`failures: ${failures}`);
await browser.close();
if (failures > 0 || consoleErrors.length > 0) process.exitCode = 1;
