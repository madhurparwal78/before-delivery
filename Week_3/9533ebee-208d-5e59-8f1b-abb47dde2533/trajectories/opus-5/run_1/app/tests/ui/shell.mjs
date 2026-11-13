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
const NN = '\u202F';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(String(error)));

note('the app loads and lands on the role home (DP-01)');
await page.goto(`${BASE}/?actor=stw-ines`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
chk('the steward lands on the Steward view', new URL(page.url()).pathname, '/steward');
chk('the actor parameter is removed from the URL', new URL(page.url()).search, '');
chk('the brand is shown', await page.locator('.brand').textContent(), 'Quillmoor Reserve');

note('the published controls and regions exist (DP-01)');
chk(
  'Acting as combobox',
  await page.getByRole('combobox', { name: 'Acting as', exact: true }).count(),
  1,
);
chk(
  'Sections navigation',
  await page.getByRole('navigation', { name: 'Sections', exact: true }).count(),
  1,
);
chk(
  'Announcements status',
  await page.getByRole('status', { name: 'Announcements', exact: true }).count(),
  1,
);
chk(
  'Problems alert',
  await page.getByRole('alert', { name: 'Problems', exact: true }).count(),
  1,
);
chk(
  'Wallet region',
  await page.getByRole('region', { name: 'Wallet', exact: true }).count(),
  1,
);
chk(
  'Posted prices complementary',
  await page.getByRole('complementary', { name: 'Posted prices', exact: true }).count(),
  1,
);
for (const asset of ['QUSD', 'MBTC', 'METH']) {
  chk(
    `${asset} pool article`,
    await page.getByRole('article', { name: `${asset} pool`, exact: true }).count(),
    1,
  );
  chk(
    `${asset} price group`,
    await page.getByRole('group', { name: `${asset} price`, exact: true }).count(),
    1,
  );
}

note('the role-filtered navigation (DP-01)');
const links = await page
  .getByRole('navigation', { name: 'Sections' })
  .getByRole('link')
  .allTextContents();
chk(
  'the steward sees Steward, Ledger and Liquidations',
  links.map((t) => t.replace(/\d+$/, '')).join(','),
  'Steward,Ledger,Liquidations',
);

note('pool cards show the server figures in desk format (DP-07, DP-61, DP-64)');
// Debts grow by accrual from the moment of seeding, so the card is compared
// against what the server reports right now.
const api = async (path) => {
  const token = await page.evaluate(() => {
    const store = JSON.parse(window.localStorage.getItem('quillmoor.tokens') ?? '{}');
    return store['stw-ines'];
  });
  const reply = await fetch(`${BASE}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return reply.json();
};
const deskAmount = (units, decimals) => {
  const scale = 10n ** BigInt(decimals);
  const whole = (BigInt(units) < 0n ? -BigInt(units) : BigInt(units)) / scale;
  const frac = ((BigInt(units) < 0n ? -BigInt(units) : BigInt(units)) % scale)
    .toString()
    .padStart(decimals, '0');
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, NN);
  return `${BigInt(units) < 0n ? '\u2212' : ''}${grouped},${frac}`;
};
const livePools = await api('/api/pools');
const qusdPool = livePools.pools.find((p) => p.asset === 'QUSD');
const qusd = page.getByRole('article', { name: 'QUSD pool' });
const unitsOfDesk = (text, decimals) => {
  const clean = text.replace(/\u202F/g, '').replace('\u2212', '-');
  const [w, f = ''] = clean.split(',');
  const sign = w.startsWith('-') ? -1n : 1n;
  return (
    sign *
    (BigInt(w.replace('-', '')) * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, '0')))
  );
};
const near = (label, shownText, apiUnits, decimals, tolerance) => {
  const shown = unitsOfDesk(shownText, decimals);
  const diff =
    shown - BigInt(apiUnits) < 0n ? BigInt(apiUnits) - shown : shown - BigInt(apiUnits);
  chk(label, diff <= tolerance, true);
};
// One second of QUSD accrual on 201 000 at 0,44% is about 8 minor units.
near(
  'Available liquidity matches the server',
  await qusd.getByLabel('Available liquidity', { exact: true }).textContent(),
  qusdPool.available_liquidity,
  6,
  2000n,
);
near(
  'Total borrowed matches the server',
  await qusd.getByLabel('Total borrowed', { exact: true }).textContent(),
  qusdPool.total_borrowed,
  6,
  2000n,
);
chk(
  'the figure is a well-formed desk amount',
  /^[\d\u202F]+,\d{6}$/.test(
    await qusd.getByLabel('Total borrowed', { exact: true }).textContent(),
  ),
  true,
);
chk(
  'available liquidity grew from the seeded figure',
  BigInt(qusdPool.available_liquidity) > 1798000000000n,
  true,
);
chk(
  'Utilization',
  await qusd.getByLabel('Utilization', { exact: true }).textContent(),
  '10,05%',
);
chk(
  'Share price has 12 decimals',
  /^\d+,\d{12}$/.test(await qusd.getByLabel('Share price', { exact: true }).textContent()),
  true,
);
chk(
  'Borrow rate',
  await qusd.getByLabel('Borrow rate', { exact: true }).textContent(),
  '0,44%',
);
chk(
  'Supply rate',
  await qusd.getByLabel('Supply rate', { exact: true }).textContent(),
  '0,03%',
);

note('the price rail (DP-61)');
const mbtcPrice = page.getByRole('group', { name: 'MBTC price' });
chk('the posted price', (await mbtcPrice.textContent()).includes(`$64${NN}000,00000000`), true);
chk('the source line', (await mbtcPrice.textContent()).includes('Manual post'), true);
chk('the age line', /Posted \d+ seconds ago/.test(await mbtcPrice.textContent()), true);
const rail = page.getByRole('complementary', { name: 'Posted prices' });
chk(
  'Grace period',
  await rail.getByLabel('Grace period', { exact: true }).textContent(),
  '5:00',
);
chk(
  'Quote lifetime',
  await rail.getByLabel('Quote lifetime', { exact: true }).textContent(),
  '0:30',
);
chk(
  'Staleness limit',
  await rail.getByLabel('Staleness limit', { exact: true }).textContent(),
  '60:00',
);
chk(
  'no stale banner while markets are open',
  await page.getByRole('alert', { name: 'Price feed', exact: true }).count(),
  0,
);

note('the steward controls (DP-30)');
chk(
  'Asset combobox',
  await page.getByRole('combobox', { name: 'Asset', exact: true }).count(),
  1,
);
chk(
  'New price textbox',
  await page.getByRole('textbox', { name: 'New price', exact: true }).count(),
  1,
);
chk(
  'Confirm large move checkbox',
  await page.getByRole('checkbox', { name: 'Confirm large move', exact: true }).count(),
  1,
);
chk(
  'Post price button',
  await page.getByRole('button', { name: 'Post price', exact: true }).count(),
  1,
);
for (const label of [
  'Loan-to-value (%)',
  'Liquidation threshold (%)',
  'Liquidation bonus (%)',
  'Reserve factor (%)',
]) {
  chk(
    `${label} textbox`,
    await page.getByRole('textbox', { name: label, exact: true }).count(),
    1,
  );
}
chk(
  'Save risk parameters button',
  await page.getByRole('button', { name: 'Save risk parameters', exact: true }).count(),
  1,
);
chk(
  'Member name textbox',
  await page.getByRole('textbox', { name: 'Member name', exact: true }).count(),
  1,
);
chk(
  'Member email textbox',
  await page.getByRole('textbox', { name: 'Member email', exact: true }).count(),
  1,
);
chk(
  'Member role combobox',
  await page.getByRole('combobox', { name: 'Member role', exact: true }).count(),
  1,
);
chk(
  'Add member button',
  await page.getByRole('button', { name: 'Add member', exact: true }).count(),
  1,
);
chk(
  'Member combobox',
  await page.getByRole('combobox', { name: 'Member', exact: true }).count(),
  1,
);
chk(
  'Transfer asset combobox',
  await page.getByRole('combobox', { name: 'Transfer asset', exact: true }).count(),
  1,
);
chk(
  'Transfer amount textbox',
  await page.getByRole('textbox', { name: 'Transfer amount', exact: true }).count(),
  1,
);
chk(
  'Record transfer button',
  await page.getByRole('button', { name: 'Record transfer', exact: true }).count(),
  1,
);

note('the risk form loads the asset values (DP-28)');
chk(
  'loan-to-value for MBTC',
  await page.getByRole('textbox', { name: 'Loan-to-value (%)' }).inputValue(),
  '70,00',
);
chk(
  'liquidation threshold',
  await page.getByRole('textbox', { name: 'Liquidation threshold (%)' }).inputValue(),
  '75,00',
);
chk(
  'liquidation bonus',
  await page.getByRole('textbox', { name: 'Liquidation bonus (%)' }).inputValue(),
  '5,00',
);
chk(
  'reserve factor',
  await page.getByRole('textbox', { name: 'Reserve factor (%)' }).inputValue(),
  '10,00',
);

note('the shock ruler (DP-46, DP-47)');
const ruler = page.getByRole('region', { name: 'Shock ruler', exact: true });
chk('Shock ruler region', await ruler.count(), 1);
chk(
  'Price shock slider',
  await page.getByRole('slider', { name: 'Price shock', exact: true }).count(),
  1,
);
chk(
  'Shock handle',
  await page.getByRole('img', { name: 'Shock handle', exact: true }).count(),
  1,
);
chk(
  'tick canvas',
  await page
    .getByRole('img', { name: 'Liquidation prices of open positions', exact: true })
    .count(),
  1,
);
chk(
  'Position ticks list',
  await page.getByRole('list', { name: 'Position ticks', exact: true }).count(),
  1,
);
chk(
  'Shock reading status',
  await page.getByRole('status', { name: 'Shock reading', exact: true }).count(),
  1,
);
chk(
  'Post this price button',
  await page.getByRole('button', { name: 'Post this price', exact: true }).count(),
  1,
);
const slider = page.getByRole('slider', { name: 'Price shock' });
chk(
  'slider range',
  `${await slider.getAttribute('min')}..${await slider.getAttribute('max')} step ${await slider.getAttribute('step')}`,
  '-60..60 step 0.5',
);
chk('starts at zero', await slider.inputValue(), '0');
chk(
  'shocked price at 0%',
  await ruler.getByLabel('Shocked price', { exact: true }).textContent(),
  `$64${NN}000,00000000`,
);
chk(
  'positions at risk at 0%',
  await ruler.getByLabel('Positions at risk', { exact: true }).textContent(),
  '0',
);
chk(
  'collateral exposed at 0%',
  await ruler.getByLabel('Collateral exposed', { exact: true }).textContent(),
  `0,00000000 MBTC`,
);
chk(
  'four MBTC ticks are listed',
  await page.getByRole('list', { name: 'Position ticks' }).getByRole('listitem').count(),
  4,
);

note('the ruler reading at −15% matches the brief (DP-46)');
await slider.focus();
for (let i = 0; i < 30; i += 1) await page.keyboard.press('ArrowLeft');
chk('the slider reads −15', await slider.inputValue(), '-15');
chk(
  'shocked price',
  await ruler.getByLabel('Shocked price', { exact: true }).textContent(),
  `$54${NN}400,00000000`,
);
chk(
  'positions at risk',
  await ruler.getByLabel('Positions at risk', { exact: true }).textContent(),
  '2',
);
chk(
  'collateral exposed',
  await ruler.getByLabel('Collateral exposed', { exact: true }).textContent(),
  `2,00000000 MBTC`,
);
const tickTexts = await page
  .getByRole('list', { name: 'Position ticks' })
  .getByRole('listitem')
  .allTextContents();
chk(
  'pos-0002 is at risk',
  tickTexts.some((t) => t.startsWith('pos-0002') && t.endsWith('at risk')),
  true,
);
chk(
  'pos-0004 is at risk',
  tickTexts.some((t) => t.startsWith('pos-0004') && t.endsWith('at risk')),
  true,
);
chk(
  'pos-0001 is clear',
  tickTexts.some((t) => t.startsWith('pos-0001') && t.endsWith('clear')),
  true,
);
chk(
  'pos-0003 is clear',
  tickTexts.some((t) => t.startsWith('pos-0003') && t.endsWith('clear')),
  true,
);
const livePositions = await api('/api/positions?collateral_asset=MBTC');
const liqOf = (id) =>
  livePositions.positions.find((p) => p.position_id === id).liquidation_price;
const deskPrice = (apiPrice) => {
  const [w, f] = apiPrice.split('.');
  return `$${w.replace(/\B(?=(\d{3})+(?!\d))/g, NN)},${f}`;
};
chk(
  'the tick list is shaped as published',
  /^pos-\d+: \$[\d\u202F]+,\d{8}, (at risk|clear)$/.test(
    tickTexts.find((t) => t.startsWith('pos-0002')),
  ),
  true,
);
chk(
  'the tick price is the server liquidation price to the dollar',
  tickTexts
    .find((t) => t.startsWith('pos-0002'))
    .replace('pos-0002: ', '')
    .split(',')[0],
  deskPrice(liqOf('pos-0002')).split(',')[0],
);

note('the value text and the settled announcement (DP-47)');
chk(
  'slider value text',
  await slider.getAttribute('aria-valuetext'),
  `\u221215,0% \u00B7 $54${NN}400,00000000`,
);
await page.waitForTimeout(700);
chk(
  'the reading is announced after the pause',
  await page.getByRole('status', { name: 'Shock reading' }).textContent(),
  '2 positions at risk at \u221215,0% shock.',
);

note('the at-risk rule holds at every step, equal prices being clear (DP-46)');
for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowRight');
chk('the slider reads −12.5', await slider.inputValue(), '-12.5');
chk(
  'value text',
  await slider.getAttribute('aria-valuetext'),
  `\u221212,5% \u00B7 $56${NN}000,00000000`,
);
// A position is at risk when the shocked price is strictly below its
// liquidation price; one that equals it is clear.
const priceUnits = (apiPrice) => {
  const [w, f] = apiPrice.split('.');
  return BigInt(w) * 100000000n + BigInt(f.padEnd(8, '0'));
};
const mbtcPriceUnits = priceUnits(livePools.pools.find((p) => p.asset === 'MBTC').price);
for (const tenths of [-250, -150, -125, -100, 0, 125]) {
  await page.keyboard.press('Home');
  const steps = (tenths - -600) / 5;
  for (let i = 0; i < steps; i += 1) await page.keyboard.press('ArrowRight');
  const shocked = (mbtcPriceUnits * (1000n + BigInt(tenths))) / 1000n;
  const expected = livePositions.positions.filter(
    (p) => BigInt(p.debt) > 0n && shocked < priceUnits(p.liquidation_price),
  );
  const shown = await ruler.getByLabel('Positions at risk', { exact: true }).textContent();
  chk(`at ${tenths / 10}% the count follows the rule`, shown, String(expected.length));
  const exposed = expected.reduce((sum, p) => sum + BigInt(p.collateral_amount), 0n);
  chk(
    `at ${tenths / 10}% the exposure follows the rule`,
    await ruler.getByLabel('Collateral exposed', { exact: true }).textContent(),
    `${deskAmount(exposed, 8)} MBTC`,
  );
}

note('keyboard control of the ruler (DP-47)');
// Start from a known step, since the previous block left the handle elsewhere.
await page.keyboard.press('Home');
for (let i = 0; i < 85; i += 1) await page.keyboard.press('ArrowRight');
chk('the handle is at −17.5', await slider.inputValue(), '-17.5');
await page.keyboard.press('Shift+ArrowLeft');
chk('Shift with an arrow moves five percent', await slider.inputValue(), '-22.5');
await page.keyboard.press('Shift+ArrowRight');
chk('and back the other way', await slider.inputValue(), '-17.5');
await page.keyboard.press('ArrowUp');
chk('Arrow Up moves a half percent up', await slider.inputValue(), '-17');
await page.keyboard.press('ArrowDown');
chk('Arrow Down moves a half percent down', await slider.inputValue(), '-17.5');
await page.keyboard.press('Home');
chk('Home jumps to −60%', await slider.inputValue(), '-60');
await page.keyboard.press('End');
chk('End jumps to +60%', await slider.inputValue(), '60');
chk(
  'focus stays on the slider',
  await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
  'Price shock',
);

note('no console errors');
chk('the page logged no errors', consoleErrors.join(' | '), '');

await browser.close();
console.log(fails === 0 ? `\nALL ${checks} PASS` : `\n${fails} of ${checks} FAILED`);
if (fails > 0) process.exitCode = 1;
