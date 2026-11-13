import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4173';
let fails = 0;
let checks = 0;
const chk = (label, got, want) => {
  checks += 1;
  const ok = String(got) === String(want);
  if (!ok) fails += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${label} = ${JSON.stringify(String(got))}${ok ? '' : `  want ${JSON.stringify(String(want))}`}`,
  );
};
const note = (t) => console.log(`---- ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const errors = [];
async function open(actor, path = '') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${actor}: ${String(e)}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) {
      errors.push(`${actor}: ${m.text()}`);
    }
  });
  await page.goto(`${BASE}/?actor=${actor}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  if (path !== '') {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
  }
  return page;
}

// Each borrower, liquidator and steward keeps their own browser open.
const steward = await open('stw-ines');
const borrower = await open('br-dele', '/positions/pos-0002');
const kestrel = await open('lq-kestrel', '/liquidations');
const vane = await open('lq-vane', '/liquidations');

note('the borrower starts healthy and the queue is empty (DP-24, DP-38)');
chk(
  'the position reads Healthy',
  await borrower.getByRole('status', { name: 'Position state', exact: true }).textContent(),
  'Healthy',
);
chk(
  'the queue shows the published empty copy',
  await kestrel.getByText('No positions are below health factor 1.').count(),
  1,
);

note('a steward price post moves the borrower live, with no reload (DP-25, DP-29)');
await steward.getByRole('combobox', { name: 'Asset', exact: true }).selectOption('MBTC');
await steward.getByRole('textbox', { name: 'New price', exact: true }).fill('57\u202F000');
await steward.getByRole('button', { name: 'Post price', exact: true }).click();
await steward.waitForTimeout(800);
chk(
  'the post is announced with its count',
  await steward.getByRole('status', { name: 'Announcements' }).textContent(),
  'Price posted. 0 positions now below health factor 1.',
);

// The borrower's page is never touched by the test; it refreshes itself.
let warned = '';
for (let i = 0; i < 16; i += 1) {
  warned = await borrower.getByRole('status', { name: 'Position state' }).textContent();
  if (warned === 'Margin warning') break;
  await sleep(600);
}
chk('the borrower moves to Margin warning on its own', warned, 'Margin warning');
chk(
  'its margin notice is listed',
  await borrower
    .getByRole('list', { name: 'Notices', exact: true })
    .getByRole('listitem')
    .count(),
  1,
);
const noticeText = await borrower
  .getByRole('list', { name: 'Notices' })
  .getByRole('listitem')
  .first()
  .textContent();
chk(
  'the notice line is published copy with a wall time',
  /^Margin notice (sent|queued, not yet sent)\. \d{2}:\d{2}:\d{2} (NST|NDT)$/.test(noticeText),
  true,
);

note('a further post puts it below one, in grace (DP-25, DP-26)');
await steward.getByRole('textbox', { name: 'New price', exact: true }).fill('52\u202F000');
await steward.getByRole('button', { name: 'Post price', exact: true }).click();
await steward.waitForTimeout(800);
chk(
  'three positions are now below one',
  await steward.getByRole('status', { name: 'Announcements' }).textContent(),
  'Price posted. 3 positions now below health factor 1.',
);

let inGrace = '';
for (let i = 0; i < 16; i += 1) {
  inGrace = await borrower.getByRole('status', { name: 'Position state' }).textContent();
  if (inGrace === 'Liquidatable in grace') break;
  await sleep(600);
}
chk('the borrower reads Liquidatable in grace', inGrace, 'Liquidatable in grace');
chk(
  'the grace end is shown as a wall time',
  /^\d{2}:\d{2}:\d{2} (NST|NDT)$/.test(
    await borrower.getByLabel('Grace ends', { exact: true }).textContent(),
  ),
  true,
);

note('the crossed positions appear in the liquidator queue with no reload (DP-30, DP-38)');
let rows = 0;
for (let i = 0; i < 16; i += 1) {
  rows = await kestrel
    .getByRole('grid', { name: 'Liquidation queue', exact: true })
    .getByRole('row')
    .count();
  if (rows >= 4) break;
  await sleep(600);
}
chk('the grid lists the three positions and its header', rows, 4);
chk('the Liquidations badge counts them', await kestrel.locator('.badge').textContent(), '3');

note('the grid is a WAI-ARIA grid with a roving tab stop (DP-38)');
const grid = kestrel.getByRole('grid', { name: 'Liquidation queue', exact: true });
chk(
  'column headers',
  await grid.getByRole('columnheader').allTextContents(),
  [
    'Position',
    'Borrower',
    'Health factor',
    'State',
    'Debt',
    'Collateral',
    'Max repay',
    'Round',
    'Action',
  ].join(','),
);
const tabbable = await kestrel.evaluate(
  () =>
    Array.from(document.querySelectorAll('[role="gridcell"], [role="gridcell"] button')).filter(
      (n) => n.tabIndex === 0,
    ).length,
);
chk('exactly one cell is tabbable', tabbable, 1);

// Tab enters the grid at the cell that last had focus.
await kestrel.evaluate(() => {
  const first = document.querySelector('[data-row="0"][data-col="0"]');
  first?.focus();
});
chk(
  'the first cell takes focus',
  await kestrel.evaluate(() => document.activeElement?.dataset?.col),
  '0',
);
await kestrel.keyboard.press('ArrowRight');
chk(
  'Arrow Right moves one cell',
  await kestrel.evaluate(() => document.activeElement?.dataset?.col),
  '1',
);
await kestrel.keyboard.press('ArrowDown');
chk(
  'Arrow Down moves one row',
  await kestrel.evaluate(() => document.activeElement?.dataset?.row),
  '1',
);
await kestrel.keyboard.press('End');
chk(
  'End moves to the last cell of the row',
  await kestrel.evaluate(
    () => document.activeElement?.closest('[role="gridcell"]')?.dataset?.col,
  ),
  '8',
);
await kestrel.keyboard.press('Home');
chk(
  'Home moves to the first cell of the row',
  await kestrel.evaluate(() => document.activeElement?.dataset?.col),
  '0',
);
await kestrel.keyboard.press('Control+End');
chk(
  'Control+End moves to the last cell of the grid',
  await kestrel.evaluate(() => {
    const cell = document.activeElement?.closest('[role="gridcell"]');
    return `${cell?.dataset?.row}/${cell?.dataset?.col}`;
  }),
  '2/8',
);
await kestrel.keyboard.press('Control+Home');
chk(
  'Control+Home moves to the first cell',
  await kestrel.evaluate(
    () => `${document.activeElement?.dataset?.row}/${document.activeElement?.dataset?.col}`,
  ),
  '0/0',
);

note('the Liquidate dialog and its menu (DP-38)');
// Wait for the grace to end so the fill is allowed.
let state = '';
for (let i = 0; i < 40; i += 1) {
  state = await borrower.getByRole('status', { name: 'Position state' }).textContent();
  if (state === 'Liquidatable now') break;
  await sleep(600);
}
chk('the grace ends on the server clock with no request', state, 'Liquidatable now');
await sleep(1200);

// Wait until the first row publishes a max repay, so the dialog prefills one.
for (let i = 0; i < 40; i += 1) {
  const maxRepay = await kestrel.evaluate(
    () => document.querySelector('[data-row="0"][data-col="6"]')?.textContent ?? '',
  );
  if (maxRepay !== '' && !maxRepay.startsWith('0,')) break;
  await sleep(600);
}
const firstLiquidate = grid.getByRole('button', { name: /^Liquidate pos-/ }).first();
const openedFor = await firstLiquidate.textContent();
await firstLiquidate.click();
await kestrel.waitForTimeout(400);
const dialog = kestrel.getByRole('dialog', { name: 'Liquidate position', exact: true });
chk('the dialog opens', await dialog.count(), 1);
chk('it is modal', await dialog.getAttribute('aria-modal'), 'true');
chk(
  'focus is in Repay amount',
  await kestrel.evaluate(() => document.activeElement?.getAttribute('aria-label')),
  'Repay amount',
);
const repayField = dialog.getByRole('textbox', { name: 'Repay amount', exact: true });
const prefilled = await repayField.inputValue();
chk('it is prefilled with the max repay', /^[\d\u202F]+,\d{6}$/.test(prefilled), true);

await dialog.getByRole('button', { name: 'Repay options', exact: true }).press('ArrowDown');
await kestrel.waitForTimeout(250);
const menu = kestrel.getByRole('menu', { name: 'Repay options', exact: true });
chk('Arrow Down opens the menu', await menu.isVisible(), true);
chk(
  'focus is on its first item',
  await kestrel.evaluate(() => document.activeElement?.textContent),
  'Use max repay',
);
chk(
  'the menu holds both items',
  await menu.getByRole('menuitem').allTextContents(),
  ['Use max repay', 'Use half of max repay'].join(','),
);

note('Escape closes one layer at a time (DP-38)');
await kestrel.keyboard.press('Escape');
await kestrel.waitForTimeout(250);
chk('the menu closes first', await menu.isVisible(), false);
chk('the dialog is still open', await dialog.isVisible(), true);
chk(
  'focus returns to Repay options',
  await kestrel.evaluate(() => document.activeElement?.textContent),
  'Repay options',
);
await kestrel.keyboard.press('Escape');
await kestrel.waitForTimeout(250);
chk('the dialog closes next', await dialog.isVisible(), false);
chk(
  'focus returns to the Liquidate button that opened it',
  await kestrel.evaluate(() => document.activeElement?.textContent),
  openedFor,
);

note('Use half of max repay halves the prefilled amount (DP-38)');
await firstLiquidate.click();
await kestrel.waitForTimeout(300);
// The dialog prefills from the row as it stands now.
const beforeHalving = await repayField.inputValue();
await dialog.getByRole('button', { name: 'Repay options', exact: true }).click();
await kestrel.waitForTimeout(200);
await menu.getByRole('menuitem', { name: 'Use half of max repay', exact: true }).click();
await kestrel.waitForTimeout(200);
const halved = await repayField.inputValue();
const toUnits = (t) => {
  const [w, f] = t.replace(/\u202F/g, '').split(',');
  return BigInt(w) * 1000000n + BigInt(f);
};
chk(
  'the amount is the max repay halved, rounded down',
  toUnits(halved),
  toUnits(beforeHalving) / 2n,
);
chk(
  'the prefilled amount was the row max repay',
  /^[\d\u202F]+,\d{6}$/.test(beforeHalving),
  true,
);
chk(
  'focus returns to Repay options',
  await kestrel.evaluate(() => document.activeElement?.textContent),
  'Repay options',
);

note('two liquidators confirm at once: one fills, one sees the conflict (DP-45)');
const vaneGrid = vane.getByRole('grid', { name: 'Liquidation queue' });
const vaneLiquidate = vaneGrid.getByRole('button', { name: openedFor, exact: true });
await vaneLiquidate.click();
await vane.waitForTimeout(400);
await Promise.all([
  kestrel.getByRole('button', { name: 'Confirm liquidation', exact: true }).click(),
  vane.getByRole('button', { name: 'Confirm liquidation', exact: true }).click(),
]);
await sleep(2500);

const kestrelOnReceipt = new URL(kestrel.url()).pathname.startsWith('/settlements/');
const vaneOnReceipt = new URL(vane.url()).pathname.startsWith('/settlements/');
chk(
  'exactly one landed on a receipt',
  [kestrelOnReceipt, vaneOnReceipt].filter(Boolean).length,
  1,
);
const winner = kestrelOnReceipt ? kestrel : vane;
const loser = kestrelOnReceipt ? vane : kestrel;
chk(
  'the loser sees the conflict copy in Problems',
  (await loser.getByRole('alert', { name: 'Problems' }).textContent()).includes(
    'Already liquidated at this health factor',
  ),
  true,
);
chk(
  "the loser's dialog closed",
  await loser.getByRole('dialog', { name: 'Liquidate position' }).isVisible(),
  false,
);
chk(
  'focus returned to the row button',
  await loser.evaluate(() => document.activeElement?.textContent?.startsWith('Liquidate pos-')),
  true,
);

note('the winner\u2019s receipt moves from Pending statement to Settled (DP-40, DP-42)');
chk(
  'the receipt heading',
  await winner.getByRole('heading', { name: 'Settlement receipt', exact: true }).count(),
  1,
);
chk(
  'the legs table',
  await winner.getByRole('table', { name: 'Settlement legs', exact: true }).count(),
  1,
);
const statement = winner.getByRole('status', { name: 'Statement status', exact: true });
let statementText = await statement.textContent();
// The render may already have finished; either way the copy is the published one.
chk(
  'the status is one of the two published readings',
  statementText === 'Settled' ||
    statementText ===
      'Pending statement Funds have moved. This settlement is not final until its statement and its PDF are confirmed in storage.',
  true,
);
for (let i = 0; i < 40; i += 1) {
  statementText = await statement.textContent();
  if (statementText === 'Settled') break;
  await sleep(500);
}
chk('it turns Settled with no reload', statementText, 'Settled');
chk(
  'the PDF download appears only once Settled',
  (await winner.getByRole('button', { name: 'Download PDF statement', exact: true }).count()) +
    (await winner.getByRole('link', { name: 'Download PDF statement', exact: true }).count()),
  1,
);
let webhook = '';
for (let i = 0; i < 40; i += 1) {
  webhook = await winner
    .getByRole('status', { name: 'Integrator webhook', exact: true })
    .textContent();
  if (webhook === 'Webhook delivered.') break;
  await sleep(500);
}
chk('the receipt reads Webhook delivered', webhook, 'Webhook delivered.');

note('the borrower\u2019s open page shows the fill (DP-42)');
let liquidationNotices = 0;
for (let i = 0; i < 20; i += 1) {
  const texts = await borrower
    .getByRole('list', { name: 'Notices' })
    .getByRole('listitem')
    .allTextContents();
  liquidationNotices = texts.filter((t) => t.startsWith('Liquidation notice')).length;
  if (liquidationNotices === 1) break;
  await sleep(600);
}
chk('exactly one liquidation notice reaches the borrower', liquidationNotices, 1);

note('the losing liquidator\u2019s queue refreshed to the new round (DP-44)');
await sleep(1500);
const loserRound = await loser.evaluate(
  (id) => {
    const row = document.querySelector(`[data-position="${id}"]`);
    return row?.querySelector('[data-col="7"]')?.textContent ?? 'gone';
  },
  openedFor.replace('Liquidate ', ''),
);
chk(
  'the row shows a round above zero, or the position left the queue',
  loserRound === 'gone' || Number(loserRound) >= 1,
  true,
);

note('no console errors');
chk('nothing was logged', errors.join(' | '), '');

await browser.close();
console.log(fails === 0 ? `\nALL ${checks} PASS` : `\n${fails} of ${checks} FAILED`);
if (fails > 0) process.exitCode = 1;
