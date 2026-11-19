import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4173';
let failures = 0;

async function check(name, condition, detail = ''): Promise<void> {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name} ${detail}`);
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // Marketing page
  await page.goto(BASE + '/');
  await page.waitForSelector('.hero h1');
  await check('marketing headline', (await page.textContent('.hero h1'))?.includes('Think in branches.'));
  await check('marketing lead', (await page.textContent('.hero .lead'))?.includes('One outline for plans, drafts and lists.'));
  const pill = await page.locator('a[data-name="Start your outline"]').count();
  check('start your outline pills', pill >= 3, `found ${pill}`);
  await check('signin pill with @', (await page.locator('.hero .pill-outline').count()) >= 1);
  await check('shortcut strip', (await page.textContent('.shortcut-strip'))?.includes('Every move has a key'));
  await check('feature heading', (await page.textContent('#views h2'))?.includes('One list, four ways to see it'));
  await check('quotes', (await page.textContent('.quotes'))?.includes('Ines Varga'));
  await check('role cards', (await page.textContent('#roles'))?.includes('Outline owner'));
  await check('download tiles', (await page.textContent('#downloads'))?.includes('OPML'));
  await check('closing', (await page.textContent('.closing h2'))?.includes('Your next plan already has branches.'));
  await check('footer', (await page.textContent('.footer'))?.includes('Pellwick & Ash'));

  // Hero typing
  await page.waitForTimeout(11000);
  const demoText = await page.textContent('#hero-demo-list');
  check('hero typed list', (demoText ?? '').includes('Saturday crew'), demoText ?? '');

  // Nest it
  const nestButton = page.locator('#nest-button');
  const disabled = await nestButton.getAttribute('aria-disabled');
  check('nest enabled after typing', disabled === 'false', `aria-disabled=${disabled}`);
  await nestButton.click();
  await page.waitForTimeout(600);
  const childCount = await page.locator('#hero-demo-list li.child').count();
  check('nest children', childCount === 5, `children=${childCount}`);

  // Feature views
  await page.locator('#next-view-button').click();
  await page.waitForTimeout(300);
  const board = await page.locator('.board-column').count();
  check('feature board view', board === 3, `columns=${board}`);

  // Viewport overflow tests
  for (const [w, h] of [[375, 812], [768, 1024], [1280, 800]]) {
    await page.setViewportSize({ width: w, height: h });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    check(`no horizontal overflow ${w}x${h} marketing`, !overflow);
  }

  // Sign-in page
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(BASE + '/signin');
  await page.waitForSelector('input#signin-email');
  for (const [w, h] of [[375, 812], [768, 1024], [1280, 800]]) {
    await page.setViewportSize({ width: w, height: h });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    check(`no horizontal overflow ${w}x${h} signin`, !overflow);
  }

  // Sign in as Wren
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.fill('input#signin-email', 'wren@pellwick.test');
  await page.fill('input#signin-password', 'wren-branches-26');
  await page.click('#signin-button');
  await page.waitForSelector('[role="tree"]', { timeout: 10000 });
  check('outline tree rendered', (await page.locator('[role="treeitem"]').count()) >= 10);
  const title = await page.textContent('.outline-title');
  check('home title', title?.trim() === 'Home', `title=${title}`);

  // treeitem attributes
  const firstRow = page.locator('[role="treeitem"]').first();
  const attrs = await firstRow.evaluate((node) => ({
    level: node.getAttribute('aria-level'),
    depth: node.getAttribute('data-depth'),
    id: node.getAttribute('data-bullet-id'),
    completed: node.getAttribute('data-completed'),
    collapsed: node.getAttribute('data-collapsed'),
  }));
  check('tree attrs', attrs.level === '1' && attrs.depth === '0' && attrs.id !== null && attrs.completed === 'false', JSON.stringify(attrs));

  // Keyboard: Enter adds a sibling
  const textbox = page.locator('[data-text-id]').first();
  await textbox.click();
  const before = await page.locator('[data-text-id]').count();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const after = await page.locator('[data-text-id]').count();
  check('enter adds bullet', after === before + 1, `before=${before} after=${after}`);

  // Undo removes it
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  const undone = await page.locator('[data-text-id]').count();
  check('undo removes new bullet', undone === before, `count=${undone}`);
  const status = await page.textContent('#status-announcements');
  check('undo announced', (status ?? '').includes('Undid new bullet'), status ?? '');

  // Move with Ctrl+ArrowUp on Tomatoes
  async function rowByExactText(text) {
    const rows = await page.locator('[data-row-id]').all();
    for (const row of rows) {
      const value = await row.locator('input').inputValue().catch(() => '');
      if (value === text) return row;
    }
    return null;
  }
  const tomatoRow = await rowByExactText('Tomatoes #seedlings');
  await tomatoRow?.locator('input').click();
  await page.keyboard.press('Control+ArrowUp');
  await page.waitForTimeout(700);
  const announceMove = await page.textContent('#status-announcements');
  check('move announced', (announceMove ?? '').includes('Moved to position 4 of 4 under Site prep'), announceMove ?? '');

  // Indent refusal at first
  const gardenRow = await rowByExactText('Community garden build');
  await gardenRow?.locator('input').click();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);
  const problem = await page.textContent('#alert-problems');
  check('indent refusal announced', (problem ?? '').includes("Can't indent"), problem ?? '');

  // Zoom in
  await page.keyboard.press('Alt+ArrowRight');
  await page.waitForTimeout(600);
  const url = page.url();
  check('zoom URL', /\/b\/[a-f0-9-]+/.test(url), url);
  const h1 = await page.inputValue('[data-title-input]').catch(() => '');
  check('zoom title', h1.includes('Community garden build'), h1);
  const crumb = await page.textContent('.crumbs');
  check('breadcrumb crumb', (crumb ?? '').includes('Home'));

  // Board view
  await page.getByRole('button', { name: 'Show as board' }).click();
  await page.waitForSelector('.board-column', { timeout: 8000 });
  const columns = await page.locator('.board-column').count();
  check('board columns', columns === 3, `columns=${columns}`);
  const colText = await page.textContent('.board');
  check('board column names', (colText ?? '').includes('Site prep #soil') && (colText ?? '').includes('Volunteers'));

  await page.getByRole('button', { name: 'Show as list' }).click();
  await page.waitForSelector('[role="treeitem"]', { timeout: 8000 });
  check('back to list', (await page.locator('[role="treeitem"]').count()) > 0);

  // Zoom out with Alt+ArrowLeft
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForTimeout(800);
  const afterZoomOut = page.url();
  check('zoom out URL', afterZoomOut === BASE + '/' || afterZoomOut.endsWith('/'), afterZoomOut);

  // Search
  await page.fill('[data-search]', '#soil');
  await page.waitForTimeout(700);
  const matchCount = await page.textContent('[data-match-count]');
  check('search count', (matchCount ?? '').includes('3 matching bullets'), matchCount ?? '');
  await page.fill('[data-search]', '');
  await page.waitForTimeout(700);
  const fullCount = await page.locator('[role="treeitem"]').count();
  check('search cleared', fullCount >= 10, `count=${fullCount}`);

  // Hide completed
  await page.click('[role="switch"]');
  await page.waitForTimeout(500);
  const hiddenAnnounce = await page.textContent('#status-announcements');
  check('hide completed announced', (hiddenAnnounce ?? '').includes('3 completed bullets hidden'), hiddenAnnounce ?? '');
  await page.click('[role="switch"]');

  // Outline viewport overflow
  for (const [w, h] of [[375, 812], [768, 1024], [1280, 800]]) {
    await page.setViewportSize({ width: w, height: h });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    check(`no horizontal overflow ${w}x${h} outline`, !overflow);
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await browser.close();
  console.log(failures === 0 ? 'ALL TESTS PASSED' : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
