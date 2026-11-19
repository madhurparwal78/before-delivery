// Scratch browser check of the published screens, controls and motion.
// Playwright is a verification-only tool, not a shipped dependency: point
// PLAYWRIGHT_MODULE at an installed copy, or install it beside this project.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const KEY = process.env.GRADING_KEY;

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${label}\n  actual   ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response.json();
}

let seed = await api('/api/grading/seed', { method: 'POST', headers: { 'X-Grading-Key': KEY } });
let fernhill = seed.workspaces.fernhill.id;
const tick = (ms) => api('/api/grading/clock', { method: 'POST', headers: { 'X-Grading-Key': KEY }, body: { advanceMs: ms } });

const browser = await chromium.launch();
const errors = [];

async function openAs(person, path, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1280, height: 800 },
    reducedMotion: options.reducedMotion,
  });
  await context.addCookies([
    { name: 'fs_session', value: seed.people[person].session, url: BASE, httpOnly: true },
  ]);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${path}: ${error.message}`));

  await page.goto(`${BASE}${path}`);
  return { context, page };
}

// ---- Sign in journey ----
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`signin: ${error.message}`));
  await page.goto(`${BASE}/`);
  await page.waitForURL('**/signin');
  const form = page.getByRole('form', { name: 'Sign in' });
  check('sign in form', await form.isVisible(), true);
  await form.getByLabel('Email').fill('felix.navarro@fernhill.test');
  await form.getByLabel('Password').fill('wrong');
  await form.getByRole('button', { name: 'Sign in' }).click();
  check('sign in error', (await page.getByRole('alert').first().textContent()).trim(), 'Email or password is incorrect.');
  await form.getByLabel('Password').fill(seed.people.felix.password);
  await form.getByLabel('Password').press('Enter');
  await page.waitForURL(`**/w/${fernhill}/explorer`);
  check('lands on explorer', new URL(page.url()).pathname, `/w/${fernhill}/explorer`);
  await page.reload();
  await page.waitForSelector('[role="grid"]');
  check('reload keeps route', new URL(page.url()).pathname, `/w/${fernhill}/explorer`);
  await context.close();
}

// ---- Explorer ----
{
  const { context, page } = await openAs('felix', `/w/${fernhill}/explorer`);
  await page.waitForSelector('[role="grid"]');
  check('home link', await page.getByRole('link', { name: 'Fernsquare home' }).isVisible(), true);
  const nav = page.getByRole('navigation', { name: 'Workspace' });
  check('nav links', await nav.getByRole('link').allTextContents(), ['Explorer', 'Submit', 'Nodes', 'Stake', 'Vote']);
  check('current link', await nav.getByRole('link', { name: 'Explorer' }).getAttribute('aria-current'), 'page');
  check('submit pill', await page.getByRole('link', { name: 'Submit blob' }).isVisible(), true);

  const stats = page.getByRole('region', { name: 'Network stats' });
  check('stat trio', (await stats.innerText()).split('\n').map((line) => line.trim()).filter(Boolean), [
    '5 blocks', 'Current height', '2 × 2 shares', 'Latest square', '5 blobs', 'Included today',
  ]);
  check('mempool', await page.getByText('Mempool 2 blobs').isVisible(), true);

  const blocks = page.getByRole('table', { name: 'Blocks' });
  const rows = await blocks.locator('tbody tr').all();
  check('blocks rows', rows.length, 5);
  check('newest first', (await rows[0].locator('td').allTextContents()).map((t) => t.trim()), ['5', '10:01:15', '1', '2 × 2', 'Rejected']);
  check('namespaces table', (await page.getByRole('table', { name: 'Namespaces' }).locator('tbody tr').first().locator('td').allTextContents()).map((t) => t.trim()), ['Orchard', '00000000000000a100', '2']);
  check('showcase cards', await page.getByRole('list', { name: 'Namespace showcase' }).locator('> li').count(), 3);
  const marquee = page.getByRole('region', { name: 'Validators' });
  check('marquee paused off-screen', await marquee.getAttribute('data-motion'), 'paused');
  await marquee.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  check('marquee motion', await marquee.getAttribute('data-motion'), 'running');
  await marquee.hover();
  await page.waitForTimeout(100);
  check('marquee pauses on hover', await marquee.getAttribute('data-motion'), 'paused');
  check('light node links', await page.getByRole('region', { name: 'Light nodes' }).getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('aria-label'))), ['Open Wren', 'Open Kestrel']);
  check('hero square', await page.getByRole('grid', { name: 'Data square, block 5' }).isVisible(), true);
  check('rejection banners', await page.getByRole('alert', { name: /Block \d+ rejected/ }).count(), 2);
  check('banner copy', await page.getByRole('alert', { name: 'Block 5 rejected' }).textContent(), 'Block 5 was rejected: row 0 is not encoded correctly.');
  check('banner 4 copy', await page.getByRole('alert', { name: 'Block 4 rejected' }).textContent(), 'Block 4 was rejected: shares were withheld. Light node Wren could not fetch share (6, 5).');

  // Role: developer cannot set the producer
  const producer = page.getByRole('radiogroup', { name: 'Next block' });
  check('producer visible', await producer.isVisible(), true);
  check('producer disabled', await producer.getByRole('radio', { name: 'Withhold shares' }).isDisabled(), true);
  const described = await producer.getByRole('radio', { name: 'Withhold shares' }).getAttribute('aria-describedby');
  check('producer description', (await page.locator(`#${described}`).textContent()), 'Only the owner can change producer behaviour.');

  // Menu dialog
  await page.getByRole('button', { name: 'Menu' }).click();
  const menu = page.getByRole('dialog', { name: 'Menu' });
  check('menu links', await menu.getByRole('link').allTextContents(), ['Members', 'Ledger']);
  check('menu sign out', await menu.getByRole('button', { name: 'Sign out' }).isVisible(), true);
  await page.keyboard.press('Escape');
  check('menu closes', await menu.isVisible(), false);
  check('focus returns', await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Menu');
  await context.close();
}

// ---- Block page ----
{
  const { context, page } = await openAs('felix', `/w/${fernhill}/explorer/blocks/2`);
  await page.waitForSelector('[role="grid"]');
  check('block heading', await page.getByRole('heading', { level: 1 }).textContent(), 'Block 2');
  check('data root text', await page.getByRole('list', { name: 'Block facts' }).getByText('Data root 74394f261f82f1bf398e3de573733f5249c6eaa0b7c98ba5c3c0361e83fcbbdf').isVisible(), true);
  const rowRoots = page.getByRole('list', { name: 'Row roots' });
  check('row roots count', await rowRoots.locator('> li').count(), 8);
  check('row root data', await rowRoots.locator('> li').first().getAttribute('data-hash'), 'a0d9966f3fb0d09021d636825ee1e231dd1bdba95d2c27fe747d21f8a534f165');
  check('row root min', await rowRoots.locator('> li').first().getAttribute('data-min'), '00000000000000a100');
  check('column roots count', await page.getByRole('list', { name: 'Column roots' }).locator('> li').count(), 8);
  const legend = page.getByRole('list', { name: 'Namespace legend' });
  check('legend items', await legend.locator('> li').evaluateAll((items) => items.map((item) => [item.dataset.namespace, item.dataset.count])), [
    ['00000000000000a100', '3'],
    ['00000000000000b200', '3'],
    ['00000000000000c300', '1'],
    ['fffffffffffffffffe', '9'],
  ]);
  check('legend padding name', await legend.getByRole('listitem').last().textContent(), 'Padding 9 shares');
  check('blobs table rows', await page.getByRole('table', { name: 'Blobs in this block' }).locator('tbody tr').count(), 4);

  // Square cells and keyboard navigation
  const grid = page.getByRole('grid', { name: 'Data square, block 2' });
  check('grid rows', await grid.locator('[role="row"]').count(), 8);
  check('cells per row', await grid.locator('[role="row"]').first().locator('[role="gridcell"]').count(), 8);
  const first = grid.getByRole('gridcell', { name: 'Share 0, 0: Orchard' });
  check('cell name', await first.isVisible(), true);
  check('cell data', await first.evaluate((node) => [node.dataset.row, node.dataset.col, node.dataset.quadrant, node.dataset.namespace, node.dataset.kind, node.dataset.share.length, node.dataset.mine]), ['0', '0', 'Q0', '00000000000000a100', 'blob', 128, 'true']);
  check('parity cell', await grid.getByRole('gridcell', { name: 'Share 0, 4: Parity' }).evaluate((node) => [node.dataset.quadrant, node.dataset.namespace]), ['Q1', 'ffffffffffffffffff']);
  check('padding cell', await grid.getByRole('gridcell', { name: 'Share 1, 3: Padding' }).getAttribute('data-kind'), 'padding');
  check('tab order', await grid.locator('[tabindex="0"]').count(), 1);
  check('rows revealed', await grid.locator('[role="row"][data-revealed="true"]').count(), 8);

  await first.focus();
  await page.keyboard.press('ArrowRight');
  check('arrow right', await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Share 0, 1: Orchard');
  await page.keyboard.press('ArrowDown');
  check('arrow down', await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Share 1, 1: Harbor');
  await page.keyboard.press('End');
  check('end', await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Share 1, 7: Parity');
  await page.keyboard.press('Home');
  check('home', await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Share 1, 0: Harbor');
  await page.keyboard.press('Control+End');
  check('ctrl end', await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Share 7, 7: Parity');
  await page.keyboard.press('Control+Home');
  check('ctrl home', await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Share 0, 0: Orchard');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowLeft');
  check('edges stop', await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Share 0, 0: Orchard');

  await page.keyboard.press('Enter');
  const share = page.getByRole('dialog', { name: 'Share 0, 0' });
  check('share panel', (await share.innerText()).split('\n').map((l) => l.trim()).filter(Boolean), [
    'Share 0, 0',
    'Namespace 00000000000000a100',
    'Info byte 01',
    'Sequence length 60 bytes',
    `Data ${'6f'.repeat(50)}`,
    'Close',
  ]);
  await page.keyboard.press('Escape');
  check('panel closes to cell', await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Share 0, 0: Orchard');

  // Prove namespace
  await page.getByLabel('Namespace to prove').fill('00000000000000b200');
  await page.getByLabel('Namespace to prove').press('Enter');
  const proof = page.getByRole('region', { name: 'Namespace proof' });
  await proof.getByText('Row 0: inclusion').waitFor();
  check('proof lines', (await proof.locator('p').allTextContents()).filter((t) => t.startsWith('Row')), [
    'Row 0: inclusion, columns 3 to 3, 3 proof nodes',
    'Row 1: inclusion, columns 0 to 1, 2 proof nodes',
    "Row 2: outside this row's namespace range",
    "Row 3: outside this row's namespace range",
  ]);
  check('proof nodes list', await proof.getByRole('list', { name: 'Row 0 proof nodes' }).locator('> li').evaluateAll((items) => items.map((item) => item.dataset.hash)), [
    'f88cc191e709c55fd17d251db310293382646b0209a4d19a4db97a9d59bb4889',
    '586695226acd1200025e9256e1b90a222099dabdc0141448c3b2d19a8aa695e2',
    'cd5b55a6080cfcc3dec12ea9cc751cb120867ea543c76a263976141f23b98b00',
  ]);
  await proof.getByRole('button', { name: 'Verify row 0' }).click();
  check('verify verdict', await proof.getByText('Verified against row 0 root.').isVisible(), true);
  await proof.getByRole('button', { name: 'Verify row 1' }).click();
  check('verify row 1', await proof.getByText('Verified against row 1 root.').isVisible(), true);

  // Absence
  await page.getByLabel('Namespace to prove').fill('00000000000000b100');
  await page.getByLabel('Namespace to prove').press('Enter');
  await proof.getByText('Row 0: absence').waitFor();
  check('absence line', await proof.getByText('Row 0: absence, next leaf at column 3').isVisible(), true);
  check('next leaf hash', await proof.getByText('Next leaf hash 0ddeab3716b07d5949f65557ec01cf5c07707c340db2636024b03e7530d0e78a').isVisible(), true);

  // Square walk
  const walk = page.getByRole('list', { name: 'Square walk' });
  check('walk cards', await walk.getByRole('article').evaluateAll((items) => items.map((item) => item.getAttribute('aria-label'))), ['Lay out', 'Extend', 'Commit']);
  check('walk cards focusable', await walk.getByRole('article').evaluateAll((items) => items.every((item) => item.tabIndex === 0)), true);
  check('walk data-cells', await walk.locator('canvas').evaluateAll((items) => items.map((item) => [item.dataset.cells, item.dataset.ticks])), [['16', undefined], ['64', undefined], [undefined, '16']]);
  check('commit data root', await walk.getByRole('article', { name: 'Commit' }).locator('.stage-root').textContent(), 'Data root 74394f261f82f1bf398e3de573733f5249c6eaa0b7c98ba5c3c0361e83fcbbdf');
  await page.getByRole('button', { name: 'Download square snapshot' }).click();
  await page.getByRole('status', { name: 'Snapshot status' }).getByText('Snapshot ready.').waitFor();
  check('snapshot status', await page.getByRole('status', { name: 'Snapshot status' }).textContent(), 'Snapshot ready.');
  await context.close();
}

// ---- Square walk motion ----
{
  const { context, page } = await openAs('felix', `/w/${fernhill}/explorer/blocks/2`);
  await page.waitForSelector('.walk-card');
  const states = async () => page.locator('.walk-card').evaluateAll((cards) => cards.map((card) => card.dataset.state));
  await page.evaluate(() => {
    const section = document.querySelector('.walk-section');
    section.scrollIntoView();
  });
  await page.waitForTimeout(150);
  const early = await states();
  check('rise states early', early.length, 3);
  await page.waitForTimeout(900);
  check('rise states settled', await states(), ['shown', 'shown', 'shown']);
  // Activation by scroll third, in both directions
  const scrollToProgress = (progress) =>
    page.evaluate((value) => {
      const section = document.querySelector('.walk-section');
      const top = section.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, top + (section.offsetHeight - window.innerHeight) * value);
    }, progress);
  const activeCard = () => page.locator('.walk-card[aria-current="step"] h3').textContent();
  check('section is 2.5 viewports tall', await page.evaluate(() => document.querySelector('.walk-section').offsetHeight >= window.innerHeight * 2.5), true);
  await scrollToProgress(0.1);
  await page.waitForTimeout(120);
  check('first third active', await activeCard(), 'Lay out');
  await scrollToProgress(0.5);
  await page.waitForTimeout(120);
  check('second third active', await activeCard(), 'Extend');
  await scrollToProgress(0.9);
  await page.waitForTimeout(120);
  check('third third active', await activeCard(), 'Commit');
  await scrollToProgress(0.5);
  await page.waitForTimeout(120);
  check('back to second third', await activeCard(), 'Extend');
  await scrollToProgress(0.1);
  await page.waitForTimeout(120);
  check('back to first third', await activeCard(), 'Lay out');
  await page.locator('.walk-card').first().hover();
  await page.waitForTimeout(120);
  check('hover activates', await page.locator('.walk-card[aria-current="step"] h3').textContent(), 'Lay out');
  await context.close();
}

// ---- Reduced motion ----
{
  const { context, page } = await openAs('felix', `/w/${fernhill}/explorer/blocks/2`, { reducedMotion: 'reduce' });
  await page.waitForSelector('.walk-card');
  check('reduced walk states', await page.locator('.walk-card').evaluateAll((cards) => cards.map((card) => card.dataset.state)), ['shown', 'shown', 'shown']);
  check('reduced active card', await page.locator('.walk-card[aria-current="step"] h3').textContent(), 'Lay out');
  check('reduced rows revealed', await page.locator('[role="row"][data-revealed="true"]').count(), 8);
  check('reduced data root', await page.getByText(/^Data root 74394f26/).first().isVisible(), true);
  await context.close();
}

// ---- Submit panel ----
{
  const { context, page } = await openAs('felix', `/w/${fernhill}/submit`);
  const form = page.getByRole('form', { name: 'Submit blob' });
  await form.waitFor();
  check('available', await page.getByText(/^Available /).textContent(), 'Available 5,000.000000 FERN');
  const estimate = page.getByRole('region', { name: 'Blob estimate' });
  await form.getByLabel('Data').fill('h'.repeat(120));
  await page.waitForTimeout(250);
  check('estimate lines', (await estimate.innerText()).split('\n').map((l) => l.trim()).filter(Boolean), [
    'Size 120 bytes', 'Shares 3', 'Gas 66536', 'Fee 0.006654 FERN',
  ]);
  check('fee prefilled', await form.getByLabel('Fee (FERN)').inputValue(), '0.006654');
  await form.getByLabel('Data').fill('x'.repeat(200));
  await page.waitForTimeout(250);
  check('estimate updates', (await estimate.innerText()).split('\n').map((l) => l.trim()).filter(Boolean), [
    'Size 200 bytes', 'Shares 4', 'Gas 67048', 'Fee 0.006705 FERN',
  ]);
  check('fee follows', await form.getByLabel('Fee (FERN)').inputValue(), '0.006705');
  await form.getByLabel('Namespace').selectOption({ label: 'Harbor' });
  await form.getByRole('button', { name: 'Submit blob' }).click();
  await page.getByRole('status', { name: 'Submit blob status' }).getByText('Blob submitted.').waitFor();
  check('submit success', await page.getByRole('status', { name: 'Submit blob status' }).textContent(), 'Blob submitted. It is pending until a block includes it.');
  await page.waitForTimeout(300);
  check('your blobs shows pending', (await page.getByRole('table', { name: 'Your blobs' }).locator('tbody tr').first().locator('td').allTextContents()).at(-1), 'Pending');

  // Register namespace refusals
  const registerForm = page.getByRole('form', { name: 'Register namespace' });
  await registerForm.getByLabel('Namespace name').fill('Beacon');
  await registerForm.getByLabel('Namespace hex').fill('zz');
  await registerForm.getByRole('button', { name: 'Register namespace' }).click();
  await registerForm.getByRole('alert').getByText('Namespace must use only').waitFor();
  check('namespace alert', await registerForm.getByRole('alert').textContent(), 'Namespace must use only the characters 0-9 and a-f.');
  await registerForm.getByLabel('Namespace hex').fill('00000000000000e500');
  await registerForm.getByRole('button', { name: 'Register namespace' }).click();
  await page.getByRole('status', { name: 'Register namespace status' }).getByText('registered').waitFor();
  check('namespace registered', await page.getByRole('status', { name: 'Register namespace status' }).textContent(), 'Namespace Beacon registered.');
  await context.close();
}

// ---- Live updates across two browsers ----
{
  const felix = await openAs('felix', `/w/${fernhill}/explorer`);
  const amara = await openAs('amara', `/w/${fernhill}/explorer`);
  await felix.page.waitForSelector('[role="grid"]');
  await amara.page.waitForSelector('[role="grid"]');
  check('mempool before', await amara.page.getByText(/^Mempool /).textContent(), 'Mempool 3 blobs');
  await tick(15000);
  await felix.page.getByRole('status', { name: 'Network updates' }).getByText('Block 6 produced').waitFor({ timeout: 2000 });
  check('felix announcement', (await felix.page.getByRole('status', { name: 'Network updates' }).textContent()).trim(), 'Block 6 produced: 3 blobs, square 4 × 4.');
  await amara.page.getByRole('table', { name: 'Blocks' }).getByRole('cell', { name: '6', exact: true }).waitFor({ timeout: 2000 });
  check('amara sees block 6', (await amara.page.getByRole('table', { name: 'Blocks' }).locator('tbody tr').first().locator('td').allTextContents()).map((t) => t.trim()), ['6', '10:01:30', '3', '4 × 4', 'Sampling']);
  check('hero switched', await felix.page.getByRole('grid', { name: 'Data square, block 6' }).isVisible(), true);
  check('mempool empty', await amara.page.getByText(/^Mempool /).textContent(), 'Mempool 0 blobs');
  await felix.context.close();
  await amara.context.close();
}

// ---- Journey 1: another member's open explorer tracks the mempool live ----
{
  seed = await api('/api/grading/seed', { method: 'POST', headers: { 'X-Grading-Key': KEY } });
  fernhill = seed.workspaces.fernhill.id;
  const amara = await openAs('amara', `/w/${fernhill}/explorer`);
  await amara.page.waitForSelector('[role="grid"]');
  check('mempool starts at 2', await amara.page.getByText(/^Mempool /).textContent(), 'Mempool 2 blobs');
  const felixPage = await openAs('felix', `/w/${fernhill}/submit`);
  const form = felixPage.page.getByRole('form', { name: 'Submit blob' });
  await form.waitFor();
  await form.getByLabel('Namespace').selectOption({ label: 'Harbor' });
  await form.getByLabel('Data').fill('live blob');
  await felixPage.page.waitForTimeout(250);
  await form.getByLabel('Fee (FERN)').press('Enter');
  await felixPage.page.getByRole('status', { name: 'Submit blob status' }).getByText('Blob submitted.').waitFor();
  check('Enter submits the form', true, true);
  await amara.page.getByText('Mempool 3 blobs').waitFor({ timeout: 2000 });
  check('mempool rises without a reload', await amara.page.getByText(/^Mempool /).textContent(), 'Mempool 3 blobs');
  await amara.context.close();
  await felixPage.context.close();
}

// ---- The square scrolls inside its own frame on a phone ----
{
  const { context, page } = await openAs('felix', `/w/${fernhill}/explorer/blocks/2`, { viewport: { width: 390, height: 844 } });
  await page.waitForSelector('[role="grid"]');
  const frame = await page.evaluate(() => {
    const node = document.querySelector('.square-frame');
    return { scrollWidth: node.scrollWidth, clientWidth: node.clientWidth };
  });
  check('square overflows its frame', frame.scrollWidth > frame.clientWidth, true);
  check('page itself does not scroll sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  await page.evaluate(() => {
    document.querySelector('.square-frame').scrollLeft = 120;
  });
  check('frame scrolls', await page.evaluate(() => document.querySelector('.square-frame').scrollLeft > 0), true);
  await context.close();
}

// ---- Node page sampling ----
{
  const { context, page } = await openAs('felix', `/w/${fernhill}/nodes/${seed.lightNodes.kestrel.id}`);
  await page.getByRole('button', { name: 'Take sample' }).waitFor();
  await page.getByLabel('Block').selectOption('2');
  await page.waitForTimeout(200);
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Take sample' }).click();
    await page.waitForTimeout(250);
  }
  const samples = page.getByRole('table', { name: 'Samples' });
  check('sample rows', await samples.locator('tbody tr').evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent.trim()))), [
    ['1', '(6, 2)', 'Yes', '39.0625%'],
    ['2', '(7, 7)', 'Yes', '62.8662%'],
    ['3', '(4, 0)', 'Yes', '77.3716%'],
  ]);
  check('confidence readout', await page.getByText(/^Confidence /).textContent(), 'Confidence 77.3716%');
  const updates = await page.getByRole('status', { name: 'Sampling updates' }).textContent();
  check('sampling updates', updates.includes('Sample 3: share (4, 0) available. Confidence 77.3716%.'), true);
  check('auto-sample switch', await page.getByRole('switch', { name: 'Auto-sample' }).getAttribute('aria-checked'), 'false');
  await page.getByRole('switch', { name: 'Auto-sample' }).press(' ');
  await page.waitForTimeout(300);
  check('auto-sample toggled', await page.getByRole('switch', { name: 'Auto-sample' }).getAttribute('aria-checked'), 'true');
  await context.close();
}

// ---- Stake, vote, ledger, members ----
{
  const { context, page } = await openAs('felix', `/w/${fernhill}/stake`);
  await page.getByRole('table', { name: 'Validators' }).waitFor();
  check('balance readout', await page.getByText(/^Balance /).textContent(), 'Balance 5,000.000000 FERN');
  // 'live blob' is 9 bytes: one share, 0.006552 FERN held while it is pending.
  check('available readout holds the pending fee', await page.getByText(/^Available /).textContent(), 'Available 4,999.993448 FERN');
  check('validators rows', await page.getByRole('table', { name: 'Validators' }).locator('tbody tr').evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent.trim()))), [
    ['Alder', '4,500.000000 FERN', '5.00%', '41.67%'],
    ['Birch', '3,300.000000 FERN', '10.00%', '30.56%'],
    ['Cedar', '2,000.000000 FERN', '0.00%', '18.52%'],
    ['Dogwood', '1,000.000000 FERN', '20.00%', '9.26%'],
  ]);
  const delegate = page.getByRole('form', { name: 'Delegate', exact: true });
  check('delegate form', await delegate.isVisible(), true);
  check('undelegate form', await page.getByRole('form', { name: 'Undelegate', exact: true }).isVisible(), true);
  check('redelegate form', await page.getByRole('form', { name: 'Redelegate', exact: true }).isVisible(), true);
  check('staking fee copy', await delegate.getByText('Fee 0.008000 FERN').isVisible(), true);
  await delegate.getByLabel('Validator').selectOption({ label: 'Cedar' });
  await delegate.getByLabel('Amount (FERN)').fill('1000');
  await delegate.getByRole('button', { name: 'Delegate' }).click();
  await page.getByRole('status', { name: 'Stake status' }).getByText('Transaction sent').waitFor();
  check('delegate status', await page.getByRole('status', { name: 'Stake status' }).textContent(), 'Transaction sent. It takes effect when the next block is produced.');
  await delegate.getByLabel('Amount (FERN)').fill('99999');
  await delegate.getByRole('button', { name: 'Delegate' }).click();
  await delegate.getByRole('alert').getByText('You can delegate at most').waitFor();
  check('delegate refusal in field', (await delegate.locator('.field-error').allTextContents()).filter(Boolean).length, 1);
  await context.close();
}
{
  const { context, page } = await openAs('felix', `/w/${fernhill}/vote/3`);
  await page.getByRole('region', { name: 'Tally' }).waitFor();
  check('proposal heading', await page.getByRole('heading', { level: 1 }).textContent(), 'Proposal 3: Fund a public sampling dashboard');
  check('tally lines', (await page.getByRole('region', { name: 'Tally' }).innerText()).split('\n').map((l) => l.trim()).filter(Boolean), [
    'Tally',
    'Votes 9,500.000000 of 10,800.000000 FERN (87.96%)',
    'Yes 4,500.000000 FERN',
    'No 2,000.000000 FERN',
    'No with veto 3,000.000000 FERN (31.58%)',
    'Abstain 0.000000 FERN',
    'Yes share 47.37%',
    'Projected result Rejected',
  ]);
  const group = page.getByRole('radiogroup', { name: 'Your vote' });
  check('vote options', await group.getByRole('radio').count(), 4);
  for (const option of ['Yes', 'No', 'No with veto', 'Abstain']) {
    check(`vote option ${option}`, await group.getByRole('radio', { name: option, exact: true }).count(), 1);
  }
  await group.getByRole('radio', { name: 'No with veto' }).check();
  await page.getByRole('button', { name: 'Cast vote' }).click();
  await page.getByRole('status', { name: 'Vote status' }).getByText('Transaction sent').waitFor();
  check('vote status', await page.getByRole('status', { name: 'Vote status' }).textContent(), 'Transaction sent. It takes effect when the next block is produced.');
  await context.close();
}
{
  const { context, page } = await openAs('felix', `/w/${fernhill}/ledger`);
  await page.getByRole('table', { name: 'Ledger' }).waitFor();
  check('ledger headers', await page.getByRole('table', { name: 'Ledger' }).locator('thead th').allTextContents(), ['Time', 'Height', 'Entry', 'Amount', 'Balance after']);
  check('ledger newest first', (await page.getByRole('table', { name: 'Ledger' }).locator('tbody tr').first().locator('td').allTextContents())[2].length > 0, true);
  await context.close();
}
{
  const { context, page } = await openAs('priya', `/w/${fernhill}/members`);
  await page.getByRole('table', { name: 'Members' }).waitFor();
  check('members rows', await page.getByRole('table', { name: 'Members' }).locator('tbody tr').evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent.trim()))), [
    ['Amara Osei', 'amara.osei@fernhill.test', 'Owner'],
    ['Felix Navarro', 'felix.navarro@fernhill.test', 'Developer'],
    ['Priya Raman', 'priya.raman@fernhill.test', 'Viewer'],
  ]);
  const invite = page.getByRole('form', { name: 'Invite member' });
  check('viewer invite disabled', await invite.getByRole('button', { name: 'Send invite' }).isDisabled(), true);
  const described = await invite.getByRole('button', { name: 'Send invite' }).getAttribute('aria-describedby');
  check('viewer description', await page.locator(`#${described}`).textContent(), "Viewers can't make changes in this workspace.");
  await context.close();
}

// ---- Phone viewport ----
{
  const { context, page } = await openAs('felix', `/w/${fernhill}/explorer`, { viewport: { width: 390, height: 844 } });
  await page.waitForSelector('[role="grid"]');
  const tablist = page.getByRole('tablist', { name: 'Workspace panels' });
  check('tabs', await tablist.getByRole('tab').allTextContents(), ['Explorer', 'Submit', 'Nodes', 'Stake', 'Vote']);
  check('selected tab', await tablist.getByRole('tab', { name: 'Explorer' }).getAttribute('aria-selected'), 'true');
  check('no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  check('no nav below 768', await page.getByRole('navigation', { name: 'Workspace' }).count(), 0);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('a, button, input, select, textarea, [role="gridcell"], [role="tab"], [role="switch"]')]
      .filter((node) => node.getClientRects().length > 0)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return { tag: node.tagName, label: (node.getAttribute('aria-label') ?? node.textContent ?? '').slice(0, 24), width: Math.round(rect.width), height: Math.round(rect.height) };
      })
      .filter((item) => item.width < 44 || item.height < 44),
  );
  check('44px controls', small, []);
  await tablist.getByRole('tab', { name: 'Stake' }).click();
  await page.waitForURL(`**/w/${fernhill}/stake`);
  check('tab navigates', new URL(page.url()).pathname, `/w/${fernhill}/stake`);
  await context.close();
}

// ---- Phone blob journey ----
{
  const { context, page } = await openAs('felix', `/w/${fernhill}/explorer/blocks/2`, { viewport: { width: 390, height: 844 } });
  await page.waitForSelector('[role="grid"]');
  const blobLink = page.getByRole('table', { name: 'Blobs in this block' }).getByRole('link').nth(2);
  await blobLink.click();
  await page.waitForURL('**/blobs/**');
  const facts = page.getByRole('list', { name: 'Blob facts' });
  await facts.waitFor();
  check('blob facts', (await facts.innerText()).includes('Size 120 bytes'), true);
  check('blob fee', (await facts.innerText()).includes('Fee 0.006654 FERN'), true);
  check('share positions', await page.getByRole('list', { name: 'Share positions' }).locator('> li').allTextContents(), ['(0, 3)', '(1, 0)', '(1, 1)']);
  check('block link', await page.getByRole('link', { name: 'Block 2' }).isVisible(), true);
  check('no sideways scroll on blob', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  await page.getByRole('gridcell', { name: 'Share 0, 3: Harbor' }).tap({ force: true }).catch(async () => {
    await page.getByRole('gridcell', { name: 'Share 0, 3: Harbor' }).click();
  });
  await page.getByRole('dialog', { name: 'Share 0, 3' }).waitFor();
  check('tap opens panel', await page.getByRole('dialog', { name: 'Share 0, 3' }).isVisible(), true);
  await context.close();
}

// ---- Not found and isolation ----
{
  const { context, page } = await openAs('felix', `/w/${seed.workspaces.quarry.id}/explorer`);
  await page.getByRole('heading', { name: 'Not found' }).waitFor();
  check('other workspace is not found', await page.getByRole('heading', { name: 'Not found' }).isVisible(), true);
  check('not found pill', await page.getByRole('link').last().isVisible(), true);
  await context.close();
}


// ---- Live withholding rejection in every open context ----
{
  seed = await api('/api/grading/seed', { method: 'POST', headers: { 'X-Grading-Key': KEY } });
  fernhill = seed.workspaces.fernhill.id;
  const amara = await openAs('amara', `/w/${fernhill}/explorer`);
  const wren = await openAs('priya', `/w/${fernhill}/explorer`);
  await amara.page.waitForSelector('[role="grid"]');
  await wren.page.waitForSelector('[role="grid"]');
  const producer = amara.page.getByRole('radiogroup', { name: 'Next block' });
  check('owner producer enabled', await producer.getByRole('radio', { name: 'Withhold shares' }).isDisabled(), false);
  await producer.getByRole('radio', { name: 'Withhold shares' }).check();
  await amara.page.getByRole('status', { name: 'Producer status' }).getByText('Next block: Withhold shares.').waitFor();
  check('producer status', await amara.page.getByRole('status', { name: 'Producer status' }).textContent(), 'Next block: Withhold shares.');
  await tick(15000);
  await amara.page.getByRole('table', { name: 'Blocks' }).getByRole('cell', { name: '6', exact: true }).waitFor({ timeout: 2000 });
  check('block 6 sampling', (await amara.page.getByRole('table', { name: 'Blocks' }).locator('tbody tr').first().locator('td').allTextContents()).at(-1).trim(), 'Sampling');
  // The square reveals row by row when it arrives live
  const revealed = await amara.page.locator('[role="grid"] [role="row"][data-revealed="true"]').count();
  check('reveal is progressive or complete', revealed >= 1, true);
  await tick(6000);
  await amara.page.getByRole('alert', { name: 'Block 6 rejected' }).waitFor({ timeout: 2000 });
  await wren.page.getByRole('alert', { name: 'Block 6 rejected' }).waitFor({ timeout: 2000 });
  const copy = 'Block 6 was rejected: shares were withheld. Light node Wren could not fetch share (3, 4).';
  check('owner sees banner', await amara.page.getByRole('alert', { name: 'Block 6 rejected' }).textContent(), copy);
  check('viewer sees banner', await wren.page.getByRole('alert', { name: 'Block 6 rejected' }).textContent(), copy);
  check('rejection announced', (await wren.page.getByRole('status', { name: 'Network updates' }).textContent()).includes(copy), true);
  const grid = amara.page.getByRole('grid', { name: 'Data square, block 6' });
  check('withheld cell', await grid.getByRole('gridcell', { name: 'Share 3, 4: Withheld' }).evaluate((node) => [node.dataset.kind, node.dataset.share]), ['withheld', '']);
  await amara.context.close();
  await wren.context.close();
}

// ---- Live bad-encoding fraud proof panel ----
{
  seed = await api('/api/grading/seed', { method: 'POST', headers: { 'X-Grading-Key': KEY } });
  fernhill = seed.workspaces.fernhill.id;
  const amara = await openAs('amara', `/w/${fernhill}/explorer`);
  await amara.page.waitForSelector('[role="grid"]');
  await amara.page.getByRole('radiogroup', { name: 'Next block' }).getByRole('radio', { name: 'Bad encoding' }).check();
  await amara.page.getByRole('status', { name: 'Producer status' }).getByText('Next block: Bad encoding.').waitFor();
  await tick(15000);
  await amara.page.getByRole('table', { name: 'Blocks' }).getByRole('cell', { name: '6', exact: true }).waitFor({ timeout: 2000 });
  const block = await openAs('felix', `/w/${fernhill}/explorer/blocks/6`);
  await block.page.waitForSelector('[role="grid"]');
  check('no fraud panel yet', await block.page.getByRole('region', { name: 'Bad encoding fraud proof' }).count(), 0);
  await tick(5000);
  await block.page.getByRole('region', { name: 'Bad encoding fraud proof' }).waitFor({ timeout: 2500 });
  const panel = block.page.getByRole('region', { name: 'Bad encoding fraud proof' });
  check('fraud panel lines', (await panel.innerText()).split('\n').map((l) => l.trim()).filter(Boolean), [
    'Bad encoding fraud proof',
    'Row 0 of block 6',
    '4 of 4 shares verified against column roots',
    'Committed row root 11ff6ecf60e7971fdd14b69761c46758fe74b59cf4cad36467f73b8334f999a5',
    'Recomputed row root 285512c9cea4bb8c34ce7b2a1ce036f8e7087fa6e48cf2f7cb67dfb497d4672b',
    'Row 0 is not encoded correctly. Block 6 rejected.',
  ]);
  check('fraud banner', await block.page.getByRole('alert', { name: 'Block 6 rejected' }).textContent(), 'Block 6 was rejected: row 0 is not encoded correctly.');
  await amara.context.close();
  await block.context.close();
}

await browser.close();
check('no page errors', errors, []);
console.log(failures === 0 ? '\nALL UI CHECKS PASSED' : `\n${failures} UI CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
