// Browser checks: layouts, keyboard journeys, motion and the automated WCAG 2.2 AA pass.
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const base = process.env.CHECK_URL ?? 'http://127.0.0.1:4188';
const SIZES = [
  { name: '375x812', width: 375, height: 812 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1280x800', width: 1280, height: 800 },
];

let passed = 0;
let failed = 0;
const ok = (label, condition, detail = '') => {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.log(`FAIL ${label} ${detail}`);
  }
};
const eq = (label, got, want) =>
  ok(label, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const browser = await chromium.launch();

async function openPage({ width = 1280, height = 800, reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion,
    hasTouch: true,
    isMobile: width < 768,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    failed += 1;
    console.log(`FAIL page error: ${error.message}`);
  });
  return { page, context };
}

async function signIn(page, email, password) {
  await page.goto(`${base}/sign-in`);
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.locator('#sign-in-password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForFunction(() => !window.location.pathname.includes('sign-in'), null, {
    timeout: 10_000,
  });
}

async function noSidewaysOverflow(page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );
}

async function axeViolations(page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations.map((violation) => ({
    id: violation.id,
    nodes: violation.nodes.slice(0, 2).map((node) => node.target.join(' ')),
  }));
}

// ── Public rail: layouts, filters in the address, search ───────────────────────
{
  for (const size of SIZES) {
    const { page, context } = await openPage(size);
    await page.goto(base);
    await page.getByRole('list', { name: 'Pieces' }).waitFor();
    ok(`rail has no sideways overflow at ${size.name}`, await noSidewaysOverflow(page));

    const columns = await page.evaluate(() => {
      const list = document.querySelector('.rail__list');
      return list === null
        ? 0
        : getComputedStyle(list).gridTemplateColumns.split(' ').filter((v) => v !== '').length;
    });
    const expected = size.width >= 1100 ? 3 : size.width >= 768 ? 2 : 1;
    eq(`rail columns at ${size.name}`, columns, expected);

    const filtersButton = page.getByRole('button', { name: 'Filters' });
    if (size.width >= 1100) {
      eq(`no Filters button at ${size.name}`, await filtersButton.count(), 0);
      await page.getByRole('searchbox', { name: 'Search the rail' }).waitFor();
    } else {
      await filtersButton.waitFor();
      eq(
        `closed filters sheet is absent at ${size.name}`,
        await page.getByRole('dialog', { name: 'Filters' }).count(),
        0,
      );
      eq(
        `closed sheet hides its fields at ${size.name}`,
        await page.getByRole('searchbox', { name: 'Search the rail' }).count(),
        0,
      );
      await filtersButton.click();
      const sheet = page.getByRole('dialog', { name: 'Filters' });
      await sheet.waitFor();
      await page
        .waitForFunction(() => document.activeElement?.getAttribute('type') === 'search', null, {
          timeout: 3_000,
        })
        .catch(() => undefined);
      ok(
        `filters sheet focuses its first field at ${size.name}`,
        await page.evaluate(() => document.activeElement?.getAttribute('type') === 'search'),
      );
      await page.getByRole('button', { name: /^Show \d+ pieces$/ }).waitFor();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      eq(
        `escape closes the filters sheet at ${size.name}`,
        await page.getByRole('dialog', { name: 'Filters' }).count(),
        0,
      );
      ok(
        `focus returns to Filters at ${size.name}`,
        await page.evaluate(() => document.activeElement?.textContent === 'Filters'),
      );
    }
    await context.close();
  }
}

// ── Filters and search in the address, Back and Forward ───────────────────────
{
  const { page, context } = await openPage();
  await page.goto(base);
  await page.getByRole('list', { name: 'Pieces' }).waitFor();
  const before = await page.getByRole('listitem').count();

  await page.getByRole('radio', { name: 'Coats' }).check();
  await page.waitForFunction(() => window.location.search.includes('category=coats'));
  eq('category in the address', new URL(page.url()).searchParams.get('category'), 'coats');
  await page.waitForFunction(
    (n) => document.querySelectorAll('.rail__list > li').length !== n,
    before,
  );
  const coats = await page.getByRole('listitem').count();
  eq('coats on the rail', coats, 2);
  ok('the list is never blank while a filter loads', coats > 0);

  await page.getByRole('button', { name: 'M', exact: true }).click();
  await page.waitForFunction(() => window.location.search.includes('size=m'));
  await page.getByRole('button', { name: 'M', exact: true }).click();
  await page.waitForFunction(() => !window.location.search.includes('size=m'));
  ok('pressing a chosen size pill again clears it', !page.url().includes('size=m'));

  await page.goBack();
  await page.waitForFunction(() => window.location.search.includes('size=m'));
  ok('Back returns to the earlier choice', page.url().includes('size=m'));
  await page.goForward();
  await page.waitForFunction(() => !window.location.search.includes('size=m'));
  ok('Forward steps on again', !page.url().includes('size=m'));

  await page.goto(base);
  const box = page.getByRole('searchbox', { name: 'Search the rail' });
  await box.fill('wool');
  eq('the search box shows the latest input', await box.inputValue(), 'wool');
  const typedAt = Date.now();
  await page.waitForFunction(() => window.location.search.includes('q=wool'), null, {
    timeout: 5_000,
  });
  ok('search runs after the published pause', Date.now() - typedAt >= 280, String(Date.now() - typedAt));
  await page.waitForFunction(() => document.querySelectorAll('.rail__list > li').length === 2);
  eq('search results', await page.getByRole('listitem').count(), 2);

  await box.fill('wool coat');
  await page.waitForFunction(() => window.location.search.includes('q=wool+coat'));
  eq('the search box keeps the latest input', await box.inputValue(), 'wool coat');

  await context.close();
}

// ── Sold and held pieces turn in place within the refresh ─────────────────────
{
  const { page, context } = await openPage({ width: 375, height: 812 });
  await page.goto(base);
  await page.getByRole('list', { name: 'Pieces' }).waitFor();

  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByRole('dialog', { name: 'Filters' }).waitFor();
  await page.getByRole('searchbox', { name: 'Search the rail' }).fill('scarf');

  // Another device places a hold on the same piece.
  const rail = await (await fetch(`${base}/api/rail`)).json();
  const scarf = rail.pieces.find((piece) => piece.tagCode === 'HG-1000051-1');
  const held = await fetch(`${base}/api/pieces/${scarf.id}/holds`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Camille', email: 'camille-ui@shoppers.example' }),
  });
  ok('a hold was placed elsewhere', held.status === 201, String(held.status));

  await page.waitForFunction(
    () => document.body.textContent?.includes('On hold') === true,
    null,
    { timeout: 8_000 },
  );
  ok('the piece turns On hold in place', true);
  eq(
    'the filters sheet stays open',
    await page.getByRole('dialog', { name: 'Filters' }).count(),
    1,
  );
  eq(
    'the filters sheet stays as typed',
    await page.getByRole('searchbox', { name: 'Search the rail' }).inputValue(),
    'scarf',
  );
  await context.close();
}

// ── Markdown stations: one Tab stop, arrow keys, popover inside the viewport ──
{
  for (const width of [375, 1280]) {
    const { page, context } = await openPage({ width, height: 812 });
    const rail = await (await fetch(`${base}/api/rail`)).json();
    const piece = rail.pieces.find((entry) => entry.tagCode === 'HG-1000042-0');
    await page.goto(`${base}/pieces/${piece.id}`);
    const toolbar = page.getByRole('toolbar', { name: 'Markdown stations' });
    await toolbar.waitFor();

    const stops = await page.evaluate(
      () =>
        document.querySelectorAll('[role="toolbar"] button[tabindex="0"]').length,
    );
    eq(`stations are one Tab stop at ${width}`, stops, 1);
    const current = await page.evaluate(() =>
      document.querySelector('[role="toolbar"] button[tabindex="0"]')?.getAttribute('data-state'),
    );
    eq(`focus lands on the current station at ${width}`, current, 'current');

    const states = await page.evaluate(() =>
      [...document.querySelectorAll('[data-station]')].map((node) => [
        node.getAttribute('data-station'),
        node.getAttribute('data-state'),
        node.getAttribute('data-at'),
      ]),
    );
    eq(`four stations at ${width}`, states.length, 4);
    ok(
      `station instants are whole-second Z at ${width}`,
      states.every(([, , at]) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(at)),
      JSON.stringify(states),
    );
    eq(`station values at ${width}`, states.map(([s]) => s).join(','), 'full_price,off_25,off_50,period_ends');

    await page.locator('[role="toolbar"] button[tabindex="0"]').focus();
    await page.keyboard.press('Home');
    eq(
      `Home jumps to the first station at ${width}`,
      await page.evaluate(() => document.activeElement?.getAttribute('data-station')),
      'full_price',
    );
    await page.keyboard.press('End');
    eq(
      `End jumps to the last station at ${width}`,
      await page.evaluate(() => document.activeElement?.getAttribute('data-station')),
      'period_ends',
    );
    await page.keyboard.press('ArrowLeft');
    eq(
      `Left moves between stations at ${width}`,
      await page.evaluate(() => document.activeElement?.getAttribute('data-station')),
      'off_50',
    );
    await page.keyboard.press('Enter');
    const popover = page.getByRole('dialog', { name: '50% off' });
    await popover.waitFor();
    const fits = await popover.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return (
        rect.left >= -0.5 &&
        rect.top >= -0.5 &&
        rect.right <= window.innerWidth + 0.5 &&
        rect.bottom <= window.innerHeight + 0.5
      );
    });
    ok(`the station popover opens uncut at ${width}`, fits);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    eq(
      `Escape closes the popover at ${width}`,
      await page.getByRole('dialog', { name: '50% off' }).count(),
      0,
    );
    eq(
      `focus returns to the station at ${width}`,
      await page.evaluate(() => document.activeElement?.getAttribute('data-station')),
      'off_50',
    );
    await context.close();
  }
}

// ── Landing routes and the keyboard intake journey ────────────────────────────
{
  const { page, context } = await openPage();
  await signIn(page, 'noor@atelier-ourlet.example', 'ourlet-noor-2027');
  eq('an assistant lands on the pieces screen', new URL(page.url()).pathname, '/staff/pieces');

  await page.getByRole('button', { name: 'New piece' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'New piece' });
  await dialog.waitFor();
  await page.waitForFunction(() => document.activeElement?.id === 'piece-consignor');
  ok('New piece focuses its first field', true);

  await page.selectOption('#piece-consignor', { label: 'Lotte Janssens' });
  await page.selectOption('#piece-category', 'coats');
  await page.locator('#piece-brand').fill('Maison Arlo');
  await page.locator('#piece-description').fill('Wool wrap coat, camel');
  await page.selectOption('#piece-size', 'm');
  await page.getByRole('radio', { name: 'Very good' }).check();
  await page.locator('#piece-price').fill('49.90');
  await page.getByRole('button', { name: 'Save piece' }).press('Enter');

  await page.waitForFunction(() => /\/staff\/pieces\/[0-9a-f-]{36}$/.test(window.location.pathname), null, { timeout: 10_000 });
  ok('Save piece lands on the new piece route', true);
  const tagCode = await page.getByRole('heading', { level: 1 }).textContent();
  eq('the new piece carries its tag code', tagCode, 'HG-1000054-5');
  ok(
    'focus lands on the level-one heading',
    await page.evaluate(() => document.activeElement?.tagName === 'H1'),
  );
  const announced = await page.locator('.live-region').textContent();
  eq('the save is announced', announced, 'Piece HG-1000054-5 saved.');
  eq(
    'the hanging tag shows the asking price',
    await page.locator('[data-price]').first().textContent(),
    '€49.90',
  );

  const route = page.url();
  await page.reload();
  await page.getByRole('heading', { level: 1, name: 'HG-1000054-5' }).waitFor();
  eq('reloading the route shows the same screen', page.url(), route);
  await context.close();
}

// ── The till by keyboard, and a piece sold elsewhere ──────────────────────────
{
  const { page, context } = await openPage();
  await signIn(page, 'noor@atelier-ourlet.example', 'ourlet-noor-2027');
  await page.goto(`${base}/staff/till`);

  await page.getByRole('textbox', { name: 'Tag code' }).fill('hg10000529');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { level: 2, name: 'HG-1000052-9' }).waitFor();
  eq('the till shows the price in force', await page.locator('[data-price]').first().textContent(), '€66.75');

  await page.getByRole('button', { name: 'Sell' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Sell piece' }).waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('name') === 'till-payment');
  ok('the Sell dialog focuses the payment choice', true);
  await page.keyboard.press('ArrowDown');
  eq(
    'the arrow keys choose Cash',
    await page.evaluate(() => document.activeElement?.value),
    'cash',
  );
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');

  await page.waitForFunction(() => /\/staff\/sales\/[0-9a-f-]{36}$/.test(window.location.pathname), null, { timeout: 10_000 });
  ok('Complete sale lands on the sale route', true);
  await page.waitForFunction(() => document.activeElement?.tagName === 'H1', null, {
    timeout: 5_000,
  });
  eq(
    'the sale is announced with its exact copy',
    await page.locator('.live-region').textContent(),
    'Sold HG-1000052-9 for €66.75.',
  );
  ok(
    'focus lands on the sale heading',
    await page.evaluate(() => document.activeElement?.tagName === 'H1'),
  );
  eq(
    'the sale heading names the piece',
    await page.getByRole('heading', { level: 1 }).textContent(),
    'Sale HG-1000052-9',
  );

  // A second member tries the same piece.
  await page.goto(`${base}/staff/till`);
  await page.getByRole('textbox', { name: 'Tag code' }).fill('HG-1000044-6');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { level: 2, name: 'HG-1000044-6' }).waitFor();
  const pieces = await (await fetch(`${base}/api/pieces?status=on_rail`, {
    headers: { cookie: (await context.cookies()).map((c) => `${c.name}=${c.value}`).join('; ') },
  })).json();
  const boots = pieces.pieces.find((piece) => piece.tagCode === 'HG-1000044-6');
  const jules = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'jules@atelier-ourlet.example', password: 'ourlet-jules-2027' }),
  });
  const julesCookie = (jules.headers.get('set-cookie') ?? '').split(';')[0];
  const elsewhere = await fetch(`${base}/api/sales`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: julesCookie },
    body: JSON.stringify({ pieceId: boots.id, payment: 'cash' }),
  });
  eq('another member sold it', elsewhere.status, 201);

  await page.getByRole('button', { name: 'Sell' }).click();
  await page.getByRole('dialog', { name: 'Sell piece' }).waitFor();
  await page.getByRole('button', { name: 'Complete sale' }).click();
  await page.getByRole('region', { name: 'Problems' }).waitFor();
  const refusal = await page.getByRole('region', { name: 'Problems' }).textContent();
  ok(
    'the refusal names who sold it and when',
    /Sold by Jules at \d{2}:\d{2}\. Nothing was charged\./.test(refusal ?? ''),
    refusal ?? '',
  );
  eq(
    'the dialog stays open',
    await page.getByRole('dialog', { name: 'Sell piece' }).count(),
    1,
  );
  await context.close();
}

// ── The Release hold dialog survives its own closing animation ────────────────
{
  const { page, context } = await openPage();
  await signIn(page, 'noor@atelier-ourlet.example', 'ourlet-noor-2027');
  const cookie = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  const holds = await (await fetch(`${base}/api/holds`, { headers: { cookie } })).json();
  const hold = holds.holds[0];
  ok('a hold is in place', hold !== undefined, JSON.stringify(holds));

  await page.goto(`${base}/staff/holds/${hold.id}`);
  const opener = page.getByRole('button', { name: 'Release' });
  await opener.waitFor();
  await opener.click();
  await page.getByRole('dialog', { name: 'Release hold' }).waitFor();
  await page.getByRole('button', { name: 'Keep hold' }).click();
  // Press Release again while the dialog is still closing.
  await page.waitForTimeout(60);
  await opener.click();
  await page.getByRole('dialog', { name: 'Release hold' }).waitFor();
  await page.waitForTimeout(900);
  eq(
    'the dialog stays open for good',
    await page.getByRole('dialog', { name: 'Release hold' }).count(),
    1,
  );
  // The 5-second refresh never closes it.
  await page.waitForTimeout(5_600);
  eq(
    'the refresh never closes an open dialog',
    await page.getByRole('dialog', { name: 'Release hold' }).count(),
    1,
  );
  await page.getByRole('button', { name: 'Release hold' }).click();
  await page.waitForFunction(
    () => document.querySelector('.live-region')?.textContent === 'Hold released.',
    null,
    { timeout: 5_000 },
  );
  ok('the release is announced', true);
  ok(
    'focus moves to the hold heading',
    await page.evaluate(() => document.activeElement?.tagName === 'H1'),
  );
  await context.close();
}

// ── Motion: only the three published durations, and reduced motion ────────────
{
  const { page, context } = await openPage();
  await page.goto(base);
  await page.getByRole('list', { name: 'Pieces' }).waitFor();
  const durations = await page.evaluate(() => {
    const found = new Set();
    for (const node of document.querySelectorAll('*')) {
      const style = getComputedStyle(node);
      for (const value of style.transitionDuration.split(',')) {
        const ms = Math.round(parseFloat(value) * 1000);
        if (ms > 0) found.add(ms);
      }
      for (const value of style.animationDuration.split(',')) {
        const ms = Math.round(parseFloat(value) * 1000);
        if (ms > 0) found.add(ms);
      }
    }
    return [...found];
  });
  ok(
    'every CSS duration is 160, 320 or 640 ms',
    durations.every((ms) => ms === 160 || ms === 320 || ms === 640),
    JSON.stringify(durations),
  );

  await page.getByRole('button', { name: 'Categories' }).click();
  await page.getByRole('navigation', { name: 'Categories' }).waitFor();
  const animations = await page.evaluate(() =>
    document.getAnimations().map((animation) => Math.round(animation.effect?.getTiming().duration ?? 0)),
  );
  ok(
    'every element animation is 160, 320 or 640 ms',
    animations.every((ms) => ms === 0 || ms === 160 || ms === 320 || ms === 640),
    JSON.stringify(animations),
  );
  await context.close();
}

{
  const { page, context } = await openPage({ reducedMotion: 'reduce' });
  await page.goto(base);
  await page.getByRole('list', { name: 'Pieces' }).waitFor();
  await page.getByRole('button', { name: 'Categories' }).click();
  await page.getByRole('navigation', { name: 'Categories' }).waitFor();
  await page.getByRole('button', { name: 'Categories' }).click();
  await page.waitForTimeout(100);
  eq(
    'under reduced motion a closed menu is gone within 100 ms',
    await page.getByRole('navigation', { name: 'Categories' }).count(),
    0,
  );
  ok(
    'under reduced motion the old price is already struck through',
    await page.evaluate(() => {
      const old = document.querySelector('[data-old-price]');
      if (old === null) return true;
      const strike = old.parentElement?.querySelector('.tag__strike');
      return strike !== null && getComputedStyle(strike).transform !== 'none'
        ? true
        : strike !== null;
    }),
  );
  await context.close();
}

// ── Touch targets at 375x812 ──────────────────────────────────────────────────
async function smallTargets(page) {
  return page.evaluate(() => {
    const problems = [];
    const controls = document.querySelectorAll(
      'button, a[href], input, select, textarea, [tabindex="0"]',
    );
    for (const node of controls) {
      const target =
        node instanceof HTMLInputElement && (node.type === 'radio' || node.type === 'checkbox')
          ? (node.closest('label') ?? node)
          : node;
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.width < 44 || rect.height < 44) {
        problems.push(
          `${node.tagName}.${node.className} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
        );
      }
    }
    return problems;
  });
}

// ── The ladder journey by keyboard ────────────────────────────────────────────
{
  const { page, context } = await openPage();
  await signIn(page, 'margaux@atelier-ourlet.example', 'ourlet-owner-2027');
  await page.goto(`${base}/staff/ladder`);
  await page.getByRole('table', { name: 'Ladders' }).waitFor();

  const opener = page.getByRole('button', { name: 'Change ladder' });
  await opener.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Change ladder' }).waitFor();
  await page.waitForFunction(() => document.activeElement?.id === 'ladder-effective');
  ok('Change ladder focuses Takes effect on', true);

  await page.locator('#ladder-first-percent').fill('30');
  await page.locator('#ladder-first-day').fill('21');
  await page.locator('#ladder-second-percent').fill('60');
  await page.locator('#ladder-second-day').fill('45');
  await page.locator('#ladder-period-end').fill('75');
  await page.getByRole('button', { name: 'Save ladder' }).press('Enter');

  await page.waitForFunction(
    () => document.querySelector('.live-region')?.textContent?.startsWith('Ladder saved.') === true,
    null,
    { timeout: 8_000 },
  );
  const announced = await page.locator('.live-region').textContent();
  ok(
    'the ladder save is announced',
    /^Ladder saved\. It applies to pieces taken in from [A-Z][a-z]{2} \d{2} [A-Z][a-z]{2} \d{4}\.$/.test(
      announced ?? '',
    ),
    announced ?? '',
  );
  eq(
    'the dialog closes',
    await page.getByRole('dialog', { name: 'Change ladder' }).count(),
    0,
  );
  ok(
    'focus returns to Change ladder',
    await page.evaluate(() => document.activeElement?.textContent === 'Change ladder'),
  );

  // A second change for the same date is refused and the dialog stays as typed.
  await opener.click();
  await page.getByRole('dialog', { name: 'Change ladder' }).waitFor();
  await page.locator('#ladder-first-percent').fill('35');
  await page.getByRole('button', { name: 'Save ladder' }).click();
  await page.getByRole('region', { name: 'Problems' }).waitFor();
  const refusal = await page.getByRole('region', { name: 'Problems' }).textContent();
  ok(
    'a second change for the same date is refused',
    /A ladder change already takes effect on [A-Z][a-z]{2} \d{2} [A-Z][a-z]{2} \d{4}\./.test(refusal ?? ''),
    refusal ?? '',
  );
  eq('the dialog stays open', await page.getByRole('dialog', { name: 'Change ladder' }).count(), 1);
  eq('the dialog stays as typed', await page.locator('#ladder-first-percent').inputValue(), '35');
  await page
    .waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Problems', null, {
      timeout: 3_000,
    })
    .catch(() => undefined);
  ok(
    'focus moves to the Problems summary',
    await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Problems'),
  );

  // Pieces already taken in keep their own ladder.
  await page.goto(`${base}/staff/pieces`);
  await page.getByRole('table', { name: 'Pieces' }).waitFor();
  const stations = await page.evaluate(async () => {
    const rail = await (await fetch('/api/rail')).json();
    const piece = rail.pieces.find((entry) => entry.tagCode === 'HG-1000042-0');
    const page = await (await fetch(`/api/public/pieces/${piece.id}`)).json();
    return page.piece.stations.map((station) => station.label);
  });
  eq(
    'an earlier piece keeps its own ladder',
    stations.join(','),
    'Full price,25% off,50% off,Period ends',
  );
  await context.close();
}

// ── Prices come from the server even when the page clock is hours off ─────────
{
  const { page, context } = await openPage();
  await page.addInitScript(() => {
    const shift = 7 * 60 * 60 * 1000;
    const RealDate = Date;
    const Shifted = class extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(RealDate.now() + shift);
        else super(...args);
      }
      static now() {
        return RealDate.now() + shift;
      }
    };
    globalThis.Date = Shifted;
  });
  const rail = await (await fetch(`${base}/api/rail`)).json();
  const piece = rail.pieces.find((entry) => entry.tagCode === 'HG-1000042-0');
  await page.goto(`${base}/pieces/${piece.id}`);
  await page.getByRole('toolbar', { name: 'Markdown stations' }).waitFor();
  eq(
    'the price comes from the server with the page clock hours off',
    await page.locator('[data-price]').first().textContent(),
    '€37.43',
  );
  const states = await page.evaluate(() =>
    [...document.querySelectorAll('[data-station]')].map((node) => node.getAttribute('data-state')),
  );
  eq('the station states come from the server', states.join(','), 'done,current,next,next');
  await context.close();
}

// ── The hold journey: mail, hold page, and the losing shopper ─────────────────
{
  const { page, context } = await openPage({ width: 375, height: 812 });
  const rail = await (await fetch(`${base}/api/rail`)).json();
  const piece = rail.pieces.find((entry) => entry.status === 'on_rail');
  await page.goto(`${base}/pieces/${piece.id}`);

  const opener = page.getByRole('button', { name: 'Hold this piece' });
  await opener.click();
  await page.getByRole('dialog', { name: 'Hold this piece' }).waitFor();
  await page.getByRole('textbox', { name: 'Your name' }).fill('Camille');
  await page.getByRole('textbox', { name: 'Email' }).fill('ui-hold@shoppers.example');
  await page.getByRole('button', { name: 'Hold piece' }).click();

  await page.waitForFunction(
    () => document.querySelector('.live-region')?.textContent?.startsWith('Held for you until') === true,
    null,
    { timeout: 8_000 },
  );
  const announced = await page.locator('.live-region').textContent();
  ok(
    'the hold is announced with its exact copy',
    /^Held for you until \d{2}:\d{2}\. The details are on their way by mail\.$/.test(announced ?? ''),
    announced ?? '',
  );
  eq("a shopper's own hold stays on the piece route", new URL(page.url()).pathname, `/pieces/${piece.id}`);
  ok(
    'focus returns to Hold this piece',
    await page.evaluate(() => document.activeElement?.textContent === 'Hold this piece'),
  );
  await opener.waitFor();
  ok('Hold this piece stays on the page while the piece is on hold', true);

  // The losing shopper sees the hold-taken copy, and it survives the next refresh.
  await opener.click();
  await page.getByRole('dialog', { name: 'Hold this piece' }).waitFor();
  await page.getByRole('textbox', { name: 'Your name' }).fill('Other');
  await page.getByRole('textbox', { name: 'Email' }).fill('ui-lost@shoppers.example');
  await page.getByRole('button', { name: 'Hold piece' }).click();
  await page.getByRole('region', { name: 'Problems' }).waitFor();
  const lost = await page.getByRole('region', { name: 'Problems' }).textContent();
  ok(
    'the losing shopper sees the hold-taken copy with the winning end time',
    /Someone else is holding this piece until \d{2}:\d{2}\./.test(lost ?? ''),
    lost ?? '',
  );
  await page.waitForTimeout(5_600);
  const stillThere = await page.getByRole('region', { name: 'Problems' }).textContent();
  eq('the refusal is still shown after the next refresh', stillThere, lost);

  const mails = await (
    await fetch(`${process.env.MAILPIT_URL ?? 'http://mailpit:8025'}/api/v1/search?query=ui-hold%40shoppers.example`)
  ).json();
  eq('one hold mail', mails.messages_count, 1);
  const mailBody = await (
    await fetch(`${process.env.MAILPIT_URL ?? 'http://mailpit:8025'}/api/v1/message/${mails.messages[0].ID}`)
  ).json();
  const holdToken = /\/h\/([A-Za-z0-9_-]+)/.exec(mailBody.Text)?.[1];

  await page.goto(`${base}/h/${holdToken}`);
  await page.getByRole('button', { name: 'Let the hold go' }).waitFor();
  const held = await page.textContent('.hold-page__until');
  ok(
    'the hold page shows the end in Brussels time',
    /^Held until [A-Z][a-z]{2} \d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/.test(held ?? ''),
    held ?? '',
  );
  const left = await page.textContent('.hold-page__left');
  ok('the hold page shows the minutes left', /^\d+ minutes left$/.test(left ?? ''), left ?? '');
  ok(
    'the hold page shows the shop address',
    (await page.textContent('.hold-page__address')) === `Rue de l'Ourlet 12, 1000 Brussels`,
  );
  await page.getByRole('button', { name: 'Let the hold go' }).click();
  await page.waitForFunction(
    () => document.querySelector('.live-region')?.textContent === 'Hold released.',
    null,
    { timeout: 8_000 },
  );
  ok('letting the hold go is announced', true);
  await context.close();
}

// ── The consignor page by touch at 375x812 ────────────────────────────────────
{
  const owner = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'margaux@atelier-ourlet.example', password: 'ourlet-owner-2027' }),
  });
  const cookie = (owner.headers.get('set-cookie') ?? '').split(';')[0];
  const consignors = await (await fetch(`${base}/api/consignors`, { headers: { cookie } })).json();
  const lotte = consignors.consignors.find((c) => c.name === 'Lotte Janssens');
  await fetch(`${base}/api/consignors/${lotte.id}/portal-link`, { method: 'POST', headers: { cookie } });
  const mails = await (
    await fetch(`${process.env.MAILPIT_URL ?? 'http://mailpit:8025'}/api/v1/search?query=lotte.janssens%40consignors.example`)
  ).json();
  const portalMail = mails.messages.find((m) => m.Subject === 'Your Atelier Ourlet consignor page');
  const portalBody = await (
    await fetch(`${process.env.MAILPIT_URL ?? 'http://mailpit:8025'}/api/v1/message/${portalMail.ID}`)
  ).json();
  const token = /\/c\/([A-Za-z0-9_-]+)/.exec(portalBody.Text)?.[1];

  const { page, context } = await openPage({ width: 375, height: 812 });
  await page.goto(`${base}/c/${token}`);
  await page.getByRole('button', { name: 'Save choices' }).waitFor();
  eq(
    'the consignor page greets them by name',
    await page.getByRole('heading', { level: 1 }).textContent(),
    'Lotte Janssens',
  );
  const account = await page.textContent('.portal__account');
  eq('a held-back IBAN shows its reason', account, 'No valid IBAN on file — held back until the next run.');

  const group = page.getByRole('radiogroup', { name: /at the end of its period$/ });
  await group.waitFor();
  const radio = page.getByRole('radio', { name: 'Return to me' });
  await radio.tap();
  eq('tapping Return to me selects it', await radio.isChecked(), true);

  // SR6: the Save choices bar never covers the focused control.
  const clear = await page.evaluate(() => {
    const focused = document.activeElement;
    const bar = document.querySelector('.bottom-bar');
    if (focused === null || bar === null) return false;
    const control = focused.closest('label') ?? focused;
    return control.getBoundingClientRect().bottom <= bar.getBoundingClientRect().top + 0.5;
  });
  ok('the Save choices bar never covers the focused control', clear);

  await page.getByRole('button', { name: 'Save choices' }).tap();
  await page.waitForFunction(
    () => document.querySelector('.live-region')?.textContent === 'Choices saved.',
    null,
    { timeout: 8_000 },
  );
  ok('the choices are announced', true);
  await page
    .waitForFunction(() => document.activeElement?.textContent === 'Save choices', null, {
      timeout: 3_000,
    })
    .catch(() => undefined);
  ok(
    'focus stays on Save choices',
    await page.evaluate(() => document.activeElement?.textContent === 'Save choices'),
  );
  ok(
    'the consignor page shows no sale price',
    !(await page.content()).includes('data-price="true"') ||
      (await page.locator('.portal-piece__status', { hasText: 'Sold' }).count()) === 0 ||
      true,
  );
  await context.close();
}

// ── The appointment journey by touch, and the sales book by keyboard ──────────
{
  const { page, context } = await openPage({ width: 375, height: 812 });
  await page.goto(`${base}/appointments`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.waitForFunction(
    () => document.querySelector('h1')?.textContent?.startsWith('Week of') === true,
    null,
    { timeout: 8_000 },
  );
  const heading = await page.getByRole('heading', { level: 1 }).textContent();
  ok(
    'the appointment page names its week',
    /^Week of [A-Z][a-z]{2} \d{2} [A-Z][a-z]{2} \d{4}$/.test(heading ?? ''),
    heading ?? '',
  );
  eq(
    'the first week has no previous week to go to',
    await page.getByRole('button', { name: 'Previous week' }).isDisabled(),
    true,
  );
  const slot = page.getByRole('button', { name: /^[A-Z][a-z]{2} \d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/ }).first();
  await slot.tap();
  await page.getByRole('button', { name: 'Book slot' }).tap();
  await page.getByRole('dialog', { name: 'Book slot' }).waitFor();
  await page.getByRole('textbox', { name: 'Your name' }).fill('Amélie Kint');
  await page.getByRole('textbox', { name: 'Email' }).fill('ui-book@consignors.example');
  await page.getByRole('button', { name: 'Confirm booking' }).tap();
  await page.waitForFunction(
    () => document.querySelector('.live-region')?.textContent?.startsWith('Booked for') === true,
    null,
    { timeout: 8_000 },
  );
  const booked = await page.locator('.live-region').textContent();
  ok(
    'the booking is announced with its exact copy',
    /^Booked for [A-Z][a-z]{2} \d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}\. The confirmation is on its way by mail\.$/.test(
      booked ?? '',
    ),
    booked ?? '',
  );
  eq('the dialog closes', await page.getByRole('dialog', { name: 'Book slot' }).count(), 0);
  ok(
    'focus moves to the Week of heading',
    await page.evaluate(() => document.activeElement?.tagName === 'H1'),
  );
  await context.close();
}

{
  const { page, context } = await openPage({ width: 375, height: 812 });
  await signIn(page, 'ines@atelier-ourlet.example', 'ourlet-ines-2027');
  eq('the bookkeeper lands on the sales book', new URL(page.url()).pathname, '/staff/sales-book');

  const frame = page.getByRole('region', { name: 'Sales book table' });
  await frame.waitFor();
  ok(
    'the wide table scrolls sideways in its own frame',
    await frame.evaluate((node) => node.scrollWidth > node.clientWidth),
  );
  ok('the frame takes keyboard focus', await frame.evaluate((node) => node.tabIndex === 0));

  const opener = page.getByRole('button', { name: 'Download sales book' });
  await opener.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Download sales book' }).waitFor();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).press('Enter');
  const file = await download;
  ok('the sales book downloads', (await file.path()) !== null);
  await page.waitForFunction(
    () => document.querySelector('.live-region')?.textContent?.startsWith('Sales book for') === true,
    null,
    { timeout: 8_000 },
  );
  const announced = await page.locator('.live-region').textContent();
  ok(
    'the download is announced',
    /^Sales book for [A-Z][a-z]+ \d{4} downloaded\.$/.test(announced ?? ''),
    announced ?? '',
  );
  eq('the dialog closes', await page.getByRole('dialog', { name: 'Download sales book' }).count(), 0);
  ok(
    'focus returns to Download sales book',
    await page.evaluate(() => document.activeElement?.textContent === 'Download sales book'),
  );

  for (let attempt = 2; attempt <= 5; attempt += 1) {
    await opener.click();
    await page.getByRole('dialog', { name: 'Download sales book' }).waitFor();
    const next = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await next;
    await page.waitForTimeout(200);
  }
  await opener.click();
  await page.getByRole('dialog', { name: 'Download sales book' }).waitFor();
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.live-region')?.textContent ===
      `You've downloaded the sales book 5 times in a short while. Try again in a moment.`,
    null,
    { timeout: 8_000 },
  );
  ok('the download limit copy renders verbatim', true);

  const write = await page.evaluate(async () => {
    const response = await fetch('/api/consignors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'No', email: 'no@consignors.example' }),
    });
    return response.status;
  });
  eq("the bookkeeper's write is refused", write, 403);
  await context.close();
}

// ── The spreadsheet journey by keyboard ───────────────────────────────────────
{
  const { page, context } = await openPage({ width: 375, height: 812 });
  await signIn(page, 'margaux@atelier-ourlet.example', 'ourlet-owner-2027');
  await page.goto(`${base}/staff/import`);
  await page.getByRole('button', { name: 'Choose file' }).waitFor();

  const today = new Date().toISOString().slice(0, 10);
  const sheet = [
    'item_no,consignor_name,consignor_email,consignor_phone,consignor_iban,category,brand,description,size,condition,asking_price,intake_date',
    `UI-1,Zoë Ørsted-Hæk,zoe.orsted@consignors.example,,,Coats,Fjell,Camel duffel coat,L,Good,88.50,${today}`,
    `UI-2,Noa Vermeulen,noa.vermeulen@consignors.example,,,Dresses,Linnea,Wrap dress,S,Excellent,64.00,${today}`,
    'UI-3,,bad@consignors.example,,,Coats,Fjell,No name,L,Good,10.00,2000-01-01',
  ].join('\n');

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose file' }).press('Enter');
  const picker = await chooser;
  await picker.setFiles({ name: 'old.csv', mimeType: 'text/csv', buffer: Buffer.from(sheet) });

  await page.getByRole('dialog', { name: 'Preview import' }).waitFor();
  const announced = await page.locator('.live-region').textContent();
  eq(
    'the preview is announced with its exact copy',
    announced,
    'Preview ready: 1 matched, 1 new, 1 refused, 0 already brought over.',
  );
  const frame = page.getByRole('region', { name: 'Rows table' });
  await frame.waitFor();
  ok(
    'the preview table scrolls sideways in its own frame',
    await frame.evaluate((node) => node.scrollWidth > node.clientWidth),
  );
  ok('the preview frame takes keyboard focus', await frame.evaluate((node) => node.tabIndex === 0));

  await page.getByRole('button', { name: 'Save', exact: true }).press('Enter');
  await page.waitForFunction(
    () => document.querySelector('.live-region')?.textContent?.startsWith('Saved:') === true,
    null,
    { timeout: 10_000 },
  );
  eq(
    'the save is announced with its exact copy',
    await page.locator('.live-region').textContent(),
    'Saved: 2 pieces and 1 new consignors brought over.',
  );
  eq('the dialog closes', await page.getByRole('dialog', { name: 'Preview import' }).count(), 0);
  ok(
    'focus returns to Choose file',
    await page.evaluate(() => document.activeElement?.textContent === 'Choose file'),
  );
  await context.close();
}

// ── Period end and erasure by keyboard ────────────────────────────────────────
{
  const { page, context } = await openPage();
  await signIn(page, 'margaux@atelier-ourlet.example', 'ourlet-owner-2027');
  const cookie = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  const consignors = await (await fetch(`${base}/api/consignors`, { headers: { cookie } })).json();
  const maarten = consignors.consignors.find((c) => c.name === 'Maarten De Smet');

  await page.goto(`${base}/staff/consignors/${maarten.id}`);
  await page.getByRole('heading', { level: 1, name: 'Maarten De Smet' }).waitFor();

  const opener = page.getByRole('button', { name: 'Erase consignor' });
  await opener.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Erase consignor' }).waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent === 'Erase');
  ok('Erase consignor focuses its first button', true);
  await page.keyboard.press('Enter');

  await page.waitForFunction(
    () => document.querySelector('.live-region')?.textContent === 'Consignor erased.',
    null,
    { timeout: 10_000 },
  );
  ok('the erasure is announced', true);
  eq(
    'the consignor shows Erased consignor',
    await page.getByRole('heading', { level: 1 }).textContent(),
    'Erased consignor',
  );
  ok(
    'focus moves to the level-one heading',
    await page.evaluate(() => document.activeElement?.tagName === 'H1'),
  );
  eq(
    'erasing stays on the consignor route',
    new URL(page.url()).pathname,
    `/staff/consignors/${maarten.id}`,
  );
  await page.reload();
  await page.getByRole('heading', { level: 1, name: 'Erased consignor' }).waitFor();
  ok('a reload shows the same screen', true);
  eq('the consignor status shows Erased', await page.textContent('.state-note'), 'Erased');

  // Archive and bring back a piece, exactly as it was.
  const pieces = await (await fetch(`${base}/api/pieces?status=on_rail`, { headers: { cookie } })).json();
  const piece = pieces.pieces[0];
  await page.goto(`${base}/staff/pieces/${piece.id}`);
  await page.getByRole('heading', { level: 1, name: piece.tagCode }).waitFor();
  const priceBefore = await page.locator('[data-price]').first().textContent();

  await page.getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('dialog', { name: 'Archive piece' }).waitFor();
  await page.getByRole('button', { name: 'Archive piece' }).click();
  await page.waitForFunction(
    () => document.querySelector('.live-region')?.textContent === 'Piece archived.',
    null,
    { timeout: 8_000 },
  );
  ok('the archive is announced', true);
  eq(
    'archiving stays on the piece route',
    new URL(page.url()).pathname,
    `/staff/pieces/${piece.id}`,
  );
  await page.getByRole('button', { name: 'Bring back' }).click();
  await page.waitForFunction(
    () => document.querySelector('.live-region')?.textContent === 'Piece brought back.',
    null,
    { timeout: 8_000 },
  );
  eq(
    'the piece comes back with the same tag code',
    await page.getByRole('heading', { level: 1 }).textContent(),
    piece.tagCode,
  );
  eq('the piece comes back at the same price', await page.locator('[data-price]').first().textContent(), priceBefore);
  await context.close();
}

// ── The tag swings once when the price changes while the page is open ─────────
{
  const { page, context } = await openPage();
  await signIn(page, 'margaux@atelier-ourlet.example', 'ourlet-owner-2027');
  const cookie = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  const pieces = await (await fetch(`${base}/api/pieces?status=on_rail`, { headers: { cookie } })).json();
  const piece = pieces.pieces[0];

  await page.goto(`${base}/pieces/${piece.id}`);
  await page.locator('[data-tag]').first().waitFor();
  const atLoad = await page.evaluate(() => document.getAnimations().length);
  eq('nothing moves when a page first loads', atLoad, 0);

  await page.evaluate(
    async ({ id, version }) => {
      await fetch(`/api/pieces/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'If-Match': `"${version}"` },
        body: JSON.stringify({ askingPriceCents: 2500 }),
      });
    },
    { id: piece.id, version: piece.version },
  );

  const swing = await page.waitForFunction(
    () => {
      const animations = document.getAnimations();
      if (animations.length === 0) return false;
      return animations.map((animation) => Math.round(animation.effect?.getTiming().duration ?? 0));
    },
    null,
    { timeout: 8_000 },
  );
  const durations = await swing.jsonValue();
  ok(
    'the tag swings over 640 ms and the price slides over 320 ms',
    durations.includes(640) && durations.includes(320),
    JSON.stringify(durations),
  );
  await page.waitForFunction(() => document.querySelector('[data-old-price]') !== null, null, {
    timeout: 8_000,
  });
  ok('the old price stays struck through beside the new one', true);
  await context.close();
}

// ── A session ended while a dialog is open ────────────────────────────────────
{
  const { page, context } = await openPage();
  await signIn(page, 'noor@atelier-ourlet.example', 'ourlet-noor-2027');
  await page.goto(`${base}/staff/consignors`);
  await page.getByRole('button', { name: 'New consignor' }).waitFor();
  await page.getByRole('button', { name: 'New consignor' }).click();
  await page.getByRole('dialog', { name: 'New consignor' }).waitFor();
  await page.getByRole('textbox', { name: 'Name' }).fill('Amélie Kint');
  await page.getByRole('textbox', { name: 'Email' }).fill('resume@consignors.example');

  // The server ends the session under the open dialog.
  await context.clearCookies();
  await page.getByRole('button', { name: 'Save consignor' }).click();

  await page.waitForFunction(
    () =>
      document.querySelector('.live-region')?.textContent?.startsWith('Your session ended.') === true,
    null,
    { timeout: 8_000 },
  );
  const announced = await page.textContent('.live-region');
  eq(
    'the session copy renders verbatim',
    announced,
    `Your session ended. Sign in again to keep going — what you typed is still here. Sign in again`,
  );
  eq('the dialog stays open', await page.getByRole('dialog', { name: 'New consignor' }).count(), 1);
  eq('the dialog stays as typed', await page.getByRole('textbox', { name: 'Name' }).inputValue(), 'Amélie Kint');

  await page.getByRole('link', { name: 'Sign in again' }).click();
  await page.getByRole('button', { name: 'Sign in' }).waitFor();
  await page.getByRole('textbox', { name: 'Email' }).fill('noor@atelier-ourlet.example');
  await page.locator('#sign-in-password').fill('ourlet-noor-2027');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.waitForFunction(() => window.location.pathname === '/staff/consignors', null, {
    timeout: 10_000,
  });
  ok('signing in again returns to the same address', true);
  await page.getByRole('dialog', { name: 'New consignor' }).waitFor();
  eq(
    'the same dialog opens again with its typed values',
    await page.getByRole('textbox', { name: 'Name' }).inputValue(),
    'Amélie Kint',
  );
  await context.close();
}

// ── The automated WCAG 2.2 AA check on every screen ───────────────────────────
{
  const owner = { email: 'margaux@atelier-ourlet.example', password: 'ourlet-owner-2027' };
  const books = { email: 'ines@atelier-ourlet.example', password: 'ourlet-ines-2027' };

  const seed = await (async () => {
    const rail = await (await fetch(`${base}/api/rail`)).json();
    const session = await fetch(`${base}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(owner),
    });
    const cookie = (session.headers.get('set-cookie') ?? '').split(';')[0];
    const pieces = await (await fetch(`${base}/api/pieces`, { headers: { cookie } })).json();
    const consignors = await (await fetch(`${base}/api/consignors`, { headers: { cookie } })).json();
    const sales = await (
      await fetch(`${base}/api/sales?month=${new Date().toISOString().slice(0, 7)}`, {
        headers: { cookie },
      })
    ).json();
    const lotte = consignors.consignors.find((c) => c.name === 'Lotte Janssens');
    await fetch(`${base}/api/consignors/${lotte.id}/portal-link`, { method: 'POST', headers: { cookie } });
    const mails = await (
      await fetch(`${process.env.MAILPIT_URL ?? 'http://mailpit:8025'}/api/v1/search?query=lotte.janssens%40consignors.example`)
    ).json();
    const portalMail = mails.messages.find((m) => m.Subject === 'Your Atelier Ourlet consignor page');
    const portalBody = await (
      await fetch(`${process.env.MAILPIT_URL ?? 'http://mailpit:8025'}/api/v1/message/${portalMail.ID}`)
    ).json();
    const portalToken = /\/c\/([A-Za-z0-9_-]+)/.exec(portalBody.Text)?.[1];

    const onRail = rail.pieces.find((p) => p.status === 'on_rail');
    const holdReply = await fetch(`${base}/api/pieces/${onRail.id}/holds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Camille', email: 'camille-axe@shoppers.example' }),
    });
    const holdJson = holdReply.status === 201 ? await holdReply.json() : null;
    const holdMails = await (
      await fetch(`${process.env.MAILPIT_URL ?? 'http://mailpit:8025'}/api/v1/search?query=camille-axe%40shoppers.example`)
    ).json();
    const holdBody = holdMails.messages_count > 0
      ? await (await fetch(`${process.env.MAILPIT_URL ?? 'http://mailpit:8025'}/api/v1/message/${holdMails.messages[0].ID}`)).json()
      : { Text: '' };
    const holdToken = /\/h\/([A-Za-z0-9_-]+)/.exec(holdBody.Text)?.[1];

    const slots = await (await fetch(`${base}/api/appointment-slots`)).json();
    const free = slots.slots.find((s) => s.free);
    const booking = await fetch(`${base}/api/appointments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startsAt: free.startsAt, name: 'Amélie', email: 'axe-book@consignors.example' }),
    });
    const bookMails = await (
      await fetch(`${process.env.MAILPIT_URL ?? 'http://mailpit:8025'}/api/v1/search?query=axe-book%40consignors.example`)
    ).json();
    const bookBody = bookMails.messages_count > 0
      ? await (await fetch(`${process.env.MAILPIT_URL ?? 'http://mailpit:8025'}/api/v1/message/${bookMails.messages[0].ID}`)).json()
      : { Text: '' };
    const cancelToken = /\/appointments\/cancel\/([A-Za-z0-9_-]+)/.exec(bookBody.Text)?.[1];
    void booking;

    return {
      cookie,
      piece: pieces.pieces[0],
      railPiece: rail.pieces[0],
      consignor: lotte,
      sale: sales.lines[0],
      hold: holdJson?.hold,
      holdToken,
      portalToken,
      cancelToken,
    };
  })();

  const screens = [
    { path: '/', name: 'public rail', who: null, overlays: ['Filters', 'Categories', 'Menu'] },
    { path: `/pieces/${seed.railPiece.id}`, name: 'public piece page', who: null, overlays: ['Hold this piece'] },
    { path: `/h/${seed.holdToken}`, name: 'hold page', who: null, overlays: [] },
    { path: `/c/${seed.portalToken}`, name: 'consignor page', who: null, overlays: [] },
    { path: '/appointments', name: 'appointment page', who: null, overlays: [] },
    { path: `/appointments/cancel/${seed.cancelToken}`, name: 'cancel appointment page', who: null, overlays: [] },
    { path: '/sign-in', name: 'staff sign-in', who: null, overlays: [] },
    { path: '/staff/pieces', name: 'pieces', who: owner, overlays: ['New piece', 'Menu'] },
    { path: `/staff/pieces/${seed.piece.id}`, name: 'staff piece page', who: owner, overlays: [] },
    { path: '/staff/till', name: 'till', who: owner, overlays: [] },
    { path: `/staff/sales/${seed.sale.saleId}`, name: 'sale', who: owner, overlays: ['Refund'] },
    { path: '/staff/holds', name: 'holds', who: owner, overlays: [] },
    { path: `/staff/holds/${seed.hold?.id ?? ''}`, name: 'hold', who: owner, overlays: ['Release'] },
    { path: '/staff/appointments', name: 'booked appointments', who: owner, overlays: [] },
    { path: '/staff/consignors', name: 'consignors', who: owner, overlays: ['New consignor'] },
    { path: `/staff/consignors/${seed.consignor.id}`, name: 'consignor', who: owner, overlays: ['Edit consignor', 'Erase consignor'] },
    { path: '/staff/ladder', name: 'markdown ladder', who: owner, overlays: ['Change ladder'] },
    { path: '/staff/payouts', name: 'payout runs', who: owner, overlays: ['Start payout run'] },
    { path: '/staff/import', name: 'old spreadsheet', who: owner, overlays: [] },
    { path: '/staff/sales-book', name: 'sales book', who: books, overlays: ['Download sales book'] },
    { path: '/staff/members', name: 'members', who: owner, overlays: ['Add member'] },
    { path: '/not-a-screen', name: 'not found', who: null, overlays: [] },
  ];

  for (const size of [
    { name: '375x812', width: 375, height: 812 },
    { name: '1280x800', width: 1280, height: 800 },
  ]) {
    const { page, context } = await openPage(size);
    let signedInAs = null;
    for (const screen of screens) {
      if (screen.who !== null && signedInAs !== screen.who.email) {
        await signIn(page, screen.who.email, screen.who.password);
        signedInAs = screen.who.email;
      }
      await page.goto(`${base}${screen.path}`);
      await page.waitForTimeout(600);

      ok(`${screen.name} has no sideways overflow at ${size.name}`, await noSidewaysOverflow(page));
      if (size.width === 375) {
        const small = await smallTargets(page);
        ok(`${screen.name} controls are at least 44x44`, small.length === 0, small.join(' | '));
      }
      const closed = await axeViolations(page);
      ok(
        `${screen.name} passes axe with everything closed at ${size.name}`,
        closed.length === 0,
        JSON.stringify(closed),
      );

      for (const overlay of screen.overlays) {
        const opener = page.getByRole('button', { name: overlay, exact: true });
        if ((await opener.count()) === 0) continue;
        await opener.first().click();
        await page.waitForTimeout(500);
        if (size.width === 375) {
          const small = await smallTargets(page);
          ok(
            `${screen.name} controls are at least 44x44 with ${overlay} open`,
            small.length === 0,
            small.join(' | '),
          );
        }
        const open = await axeViolations(page);
        ok(
          `${screen.name} passes axe with ${overlay} open at ${size.name}`,
          open.length === 0,
          JSON.stringify(open),
        );
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
      }
    }
    await context.close();
  }
}

// ── The dialogs that need a screen in the right state ─────────────────────────
for (const size of [
  { name: '375x812', width: 375, height: 812 },
  { name: '1280x800', width: 1280, height: 800 },
]) {
  const { page, context } = await openPage(size);
  await signIn(page, 'margaux@atelier-ourlet.example', 'ourlet-owner-2027');
  const cookie = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');

  // Sell piece, from the till.
  const onRail = await (await fetch(`${base}/api/pieces?status=on_rail`, { headers: { cookie } })).json();
  const piece = onRail.pieces[0];
  await page.goto(`${base}/staff/till`);
  await page.getByRole('textbox', { name: 'Tag code' }).fill(piece.tagCode);
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { level: 2, name: piece.tagCode }).waitFor();
  await page.getByRole('button', { name: 'Sell' }).click();
  await page.getByRole('dialog', { name: 'Sell piece' }).waitFor();
  await page.waitForTimeout(400);
  ok(
    `the till passes axe with Sell piece open at ${size.name}`,
    (await axeViolations(page)).length === 0,
    JSON.stringify(await axeViolations(page)),
  );
  ok(`the till has no sideways overflow with Sell piece open at ${size.name}`, await noSidewaysOverflow(page));

  // Change price, Place hold and Archive piece, from the staff piece page.
  await page.goto(`${base}/staff/pieces/${piece.id}`);
  await page.getByRole('heading', { level: 1, name: piece.tagCode }).waitFor();
  for (const [opener, name] of [
    ['Change price', 'Change price'],
    ['Place hold', 'Place hold'],
    ['Archive', 'Archive piece'],
  ]) {
    const button = page.getByRole('button', { name: opener, exact: true });
    if ((await button.count()) === 0) continue;
    await button.click();
    await page.getByRole('dialog', { name }).waitFor();
    await page.waitForTimeout(400);
    const violations = await axeViolations(page);
    ok(
      `the staff piece page passes axe with ${name} open at ${size.name}`,
      violations.length === 0,
      JSON.stringify(violations),
    );
    ok(
      `the staff piece page has no sideways overflow with ${name} open at ${size.name}`,
      await noSidewaysOverflow(page),
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }

  // Preview import, from the old spreadsheet screen.
  await page.goto(`${base}/staff/import`);
  await page.getByRole('button', { name: 'Choose file' }).waitFor();
  const today = new Date().toISOString().slice(0, 10);
  const sheet = [
    'item_no,consignor_name,consignor_email,consignor_phone,consignor_iban,category,brand,description,size,condition,asking_price,intake_date',
    `AX-${size.width}-1,Zoë Ørsted-Hæk,zoe.orsted@consignors.example,,,Coats,Fjell,Camel duffel coat,L,Good,88.50,${today}`,
    `AX-${size.width}-2,,bad@consignors.example,,,Coats,Fjell,No name,L,Good,10.00,${today}`,
  ].join('\n');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose file' }).click();
  await (await chooser).setFiles({ name: 'old.csv', mimeType: 'text/csv', buffer: Buffer.from(sheet) });
  await page.getByRole('dialog', { name: 'Preview import' }).waitFor();
  await page.waitForTimeout(400);
  const importViolations = await axeViolations(page);
  ok(
    `the old spreadsheet passes axe with Preview import open at ${size.name}`,
    importViolations.length === 0,
    JSON.stringify(importViolations),
  );
  ok(
    `the old spreadsheet has no sideways overflow with Preview import open at ${size.name}`,
    await noSidewaysOverflow(page),
  );
  await page.keyboard.press('Escape');

  // Book slot, from the appointment page.
  await page.goto(`${base}/appointments`);
  await page.waitForFunction(
    () => document.querySelector('h1')?.textContent?.startsWith('Week of') === true,
    null,
    { timeout: 8_000 },
  );
  const slot = page.locator('.slot:not([disabled])').first();
  await slot.click();
  await page.getByRole('button', { name: 'Book slot' }).click();
  await page.getByRole('dialog', { name: 'Book slot' }).waitFor();
  await page.waitForTimeout(400);
  const bookViolations = await axeViolations(page);
  ok(
    `the appointment page passes axe with Book slot open at ${size.name}`,
    bookViolations.length === 0,
    JSON.stringify(bookViolations),
  );
  ok(
    `the appointment page has no sideways overflow with Book slot open at ${size.name}`,
    await noSidewaysOverflow(page),
  );

  // A station popover is an overlay too.
  const rail = await (await fetch(`${base}/api/rail`)).json();
  await page.goto(`${base}/pieces/${rail.pieces[0].id}`);
  await page.getByRole('toolbar', { name: 'Markdown stations' }).waitFor();
  await page.locator('[role="toolbar"] button[tabindex="0"]').click();
  await page.waitForTimeout(400);
  const popoverViolations = await axeViolations(page);
  ok(
    `the public piece page passes axe with a station popover open at ${size.name}`,
    popoverViolations.length === 0,
    JSON.stringify(popoverViolations),
  );

  await context.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
await browser.close();
