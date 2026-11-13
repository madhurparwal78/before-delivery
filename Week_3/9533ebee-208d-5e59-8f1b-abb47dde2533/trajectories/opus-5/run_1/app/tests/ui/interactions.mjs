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
const errors = [];
async function open(actor, path = '') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${actor}: ${String(e)}`));
  page.on('console', (m) => {
    // A refused request is normal traffic, not a script error.
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) {
      errors.push(`${actor}: ${m.text()}`);
    }
  });
  await page.goto(`${BASE}/?actor=${actor}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  if (path !== '') {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
  }
  return page;
}

// ---------------------------------------------------------------- DP-09
note('the Supply form survives every refresh (DP-09)');
const rosa = await open('lp-rosa');
const supplyAmount = rosa.getByRole('textbox', { name: 'Supply amount', exact: true });
const withdrawAmount = rosa.getByRole('textbox', { name: 'Withdraw amount', exact: true });
await rosa.getByRole('combobox', { name: 'Pool', exact: true }).selectOption('QUSD');
await supplyAmount.fill('12,5');
// A half-typed withdrawal with a browser-side field error.
await withdrawAmount.fill('1,2345678');
await withdrawAmount.focus();
await rosa.keyboard.press('End');
chk('the field error shows at once', await withdrawAmount.getAttribute('aria-invalid'), 'true');
const described = await withdrawAmount.getAttribute('aria-describedby');
chk(
  'the message is the field description',
  await rosa.locator(`#${described}`).textContent(),
  'Enter at most 6 digits after the comma.',
);
await rosa.getByRole('button', { name: 'Supply', exact: true }).click();
await rosa.waitForTimeout(400);
const announced = await rosa.getByRole('status', { name: 'Announcements' }).textContent();
chk(
  'the supply is announced',
  /^Supplied 12,500000 QUSD for [\d\u202F]+ shares\.$/.test(announced),
  true,
);

chk(
  'focus stays on the pressed button on success',
  await rosa.evaluate(() => document.activeElement?.textContent),
  'Supply',
);
// Put focus and the caret where the refresh must leave them.
await withdrawAmount.focus();
await rosa.keyboard.press('End');
const shareBefore = await rosa.getByLabel('Share value', { exact: true }).textContent();
// Wait out two whole refreshes.
await rosa.waitForTimeout(11000);
chk('the typed withdrawal survives', await withdrawAmount.inputValue(), '1,2345678');
chk('its field error survives', await withdrawAmount.getAttribute('aria-invalid'), 'true');
chk(
  'the chosen pool survives',
  await rosa.getByRole('combobox', { name: 'Pool' }).inputValue(),
  'QUSD',
);
chk(
  'focus survives',
  await rosa.evaluate(() => document.activeElement?.getAttribute('aria-label')),
  'Withdraw amount',
);
chk(
  'the caret position survives',
  await rosa.evaluate(() => document.activeElement.selectionStart),
  9,
);
chk(
  'the last announcement survives',
  await rosa.getByRole('status', { name: 'Announcements' }).textContent(),
  announced,
);
chk(
  'the share value is still shown',
  (await rosa.getByLabel('Share value', { exact: true }).textContent()).length > 0,
  true,
);
void shareBefore;

// ---------------------------------------------------------------- DP-11
note('the swap preview follows the latest keystroke (DP-11)');
const petra = await open('tr-petra');
const payAmount = petra.getByRole('textbox', { name: 'Amount to pay', exact: true });
const preview = petra.getByRole('status', { name: 'Swap preview', exact: true });
chk(
  'the prompt before anything is typed',
  await preview.textContent(),
  'Type an amount to see the output.',
);
await petra.getByRole('combobox', { name: 'Pay with', exact: true }).selectOption('MBTC');
await petra.getByRole('combobox', { name: 'Receive', exact: true }).selectOption('QUSD');
await payAmount.pressSequentially('0,12345678', { delay: 40 });
await petra.waitForTimeout(700);
chk(
  'the fee follows the brief',
  (await preview.textContent()).includes(`Pool fee 0,00037038 MBTC`),
  true,
);
chk(
  'the output follows the brief',
  (await preview.textContent()).includes(`You receive 7${NN}877,529600 QUSD`),
  true,
);

note('an earlier reply never replaces a later one (DP-11)');
await payAmount.fill('');
await payAmount.pressSequentially('1,5', { delay: 30 });
await payAmount.pressSequentially('0', { delay: 10 });
await petra.waitForTimeout(900);
const latest = await preview.textContent();
chk('the preview shows the latest input only', latest.includes('You receive'), true);
const expectedOut = await petra.evaluate(async () => {
  const token = JSON.parse(window.localStorage.getItem('quillmoor.tokens'))['tr-petra'];
  const reply = await fetch(
    '/api/swap/preview?from_asset=MBTC&to_asset=QUSD&amount_in=150000000',
    {
      headers: { authorization: `Bearer ${token}` },
    },
  );
  return (await reply.json()).amount_out;
});
const shownOut = latest.split('You receive ')[1].split(' QUSD')[0];
chk(
  'it is the reply to 1,50 MBTC',
  shownOut.replace(/\u202F/g, ''),
  (BigInt(expectedOut) / 1000000n).toString() +
    ',' +
    (BigInt(expectedOut) % 1000000n).toString().padStart(6, '0'),
);

note('a firm quote and a swap (DP-14)');
await payAmount.fill('0,12345678');
await petra.waitForTimeout(600);
await petra.getByRole('button', { name: 'Get firm quote', exact: true }).click();
await petra.waitForTimeout(600);
const quoteRegion = petra.getByRole('region', { name: 'Firm quote', exact: true });
chk('the quote region fills', await quoteRegion.count(), 1);
chk('the quote fee', (await quoteRegion.textContent()).includes('0,00037038 MBTC'), true);
chk(
  'the quote output',
  (await quoteRegion.textContent()).includes(`7${NN}877,529600 QUSD`),
  true,
);
chk(
  'firm until a wall time',
  /Firm until\s*\d{2}:\d{2}:\d{2} (NST|NDT)/.test(await quoteRegion.textContent()),
  true,
);
chk(
  'the quote is announced',
  /^Quote ready\. Firm until \d{2}:\d{2}:\d{2} (NST|NDT)\.$/.test(
    await petra.getByRole('status', { name: 'Announcements' }).textContent(),
  ),
  true,
);
await petra.getByRole('button', { name: 'Swap now', exact: true }).click();
await petra.waitForTimeout(900);
const receipt = petra.getByRole('region', { name: 'Swap receipt', exact: true });
chk(
  'the receipt digits equal the quote',
  (await receipt.textContent()).includes(`7${NN}877,529600 QUSD`),
  true,
);
chk(
  'the swap is announced',
  (await petra.getByRole('status', { name: 'Announcements' }).textContent()).includes(
    `Swapped 0,12345678 MBTC for 7${NN}877,529600 QUSD.`,
  ),
  true,
);

// ---------------------------------------------------------------- DP-19
note('borrowing with the keyboard alone (DP-19)');
const sanna = await open('br-sanna', '/positions/pos-0001');
const drawAmount = sanna.getByRole('textbox', { name: 'Draw amount', exact: true });
await drawAmount.focus();
await drawAmount.pressSequentially('100,000000', { delay: 10 });
// Enter in an amount field presses that field's own button.
await sanna.keyboard.press('Enter');
await sanna.waitForTimeout(1200);
chk(
  'Enter in Draw amount drew',
  (await sanna.getByRole('status', { name: 'Announcements' }).textContent()).startsWith(
    'Drew 100,000000 QUSD.',
  ),
  true,
);
chk(
  'the announcement carries a receipt link',
  await sanna
    .getByRole('status', { name: 'Announcements' })
    .getByRole('link', { name: 'View receipt' })
    .count(),
  1,
);
chk(
  'Retry is not offered after a reply arrives',
  await sanna.getByRole('button', { name: 'Retry', exact: true }).isVisible(),
  false,
);

note('Enter in Repay amount repays (DP-19)');
const repayAmount = sanna.getByRole('textbox', { name: 'Repay amount', exact: true });
await repayAmount.focus();
await repayAmount.pressSequentially('50,000000', { delay: 10 });
await sanna.keyboard.press('Enter');
await sanna.waitForTimeout(1000);
chk(
  'the repayment is announced with the new health factor',
  /^Repaid 50,000000 QUSD\. Health factor now \d+,\d{4}\.$/.test(
    await sanna.getByRole('status', { name: 'Announcements' }).textContent(),
  ),
  true,
);
chk(
  'focus stays on the pressed control',
  await sanna.evaluate(() => document.activeElement?.getAttribute('aria-label')),
  'Repay amount',
);

// ---------------------------------------------------------------- DP-04
note('the Ledger filters live in the URL (DP-04)');
const ines = await open('stw-ines', '/ledger');
chk('the default URL carries no parameters', new URL(ines.url()).search, '');
const startLength = await ines.evaluate(() => window.history.length);
await ines.getByRole('combobox', { name: 'Ledger asset', exact: true }).selectOption('MBTC');
await ines.waitForTimeout(400);
chk('choosing an asset puts it in the URL', new URL(ines.url()).search, '?asset=MBTC');
await ines.getByRole('combobox', { name: 'Postings shown', exact: true }).selectOption('20');
await ines.waitForTimeout(400);
chk('choosing a count adds it in order', new URL(ines.url()).search, '?asset=MBTC&limit=20');
chk(
  'each choice pushed one entry',
  await ines.evaluate(() => window.history.length),
  startLength + 2,
);

note('a desk-time window joins the URL as a canonical instant (DP-04)');
const fromField = ines.getByRole('textbox', { name: 'Posted from', exact: true });
await fromField.fill('2026-11-01 01:30');
await fromField.press('Enter');
await ines.waitForTimeout(400);
chk(
  'the fold resolves to the earlier instant',
  decodeURIComponent(new URL(ines.url()).search),
  '?asset=MBTC&limit=20&from=2026-11-01T04:00:00Z',
);

note('Back and Forward restore the controls (DP-04)');
await ines.goBack();
await ines.waitForTimeout(500);
chk('Back drops the window', new URL(ines.url()).search, '?asset=MBTC&limit=20');
chk('the field is cleared with it', await fromField.inputValue(), '');
await ines.goBack();
await ines.waitForTimeout(500);
chk('Back again drops the count', new URL(ines.url()).search, '?asset=MBTC');
chk(
  'the count control follows',
  await ines.getByRole('combobox', { name: 'Postings shown' }).inputValue(),
  '50',
);
await ines.goForward();
await ines.waitForTimeout(500);
chk('Forward restores the count', new URL(ines.url()).search, '?asset=MBTC&limit=20');
chk(
  'the control follows again',
  await ines.getByRole('combobox', { name: 'Postings shown' }).inputValue(),
  '20',
);

note('a reload keeps the filter (DP-04)');
await ines.reload({ waitUntil: 'networkidle' });
await ines.waitForTimeout(800);
chk('the URL survives the reload', new URL(ines.url()).search, '?asset=MBTC&limit=20');
chk(
  'the asset control is restored',
  await ines.getByRole('combobox', { name: 'Ledger asset' }).inputValue(),
  'MBTC',
);
chk(
  'the count control is restored',
  await ines.getByRole('combobox', { name: 'Postings shown' }).inputValue(),
  '20',
);

note('an unknown value falls back without adding history (DP-04)');
await ines.goto(`${BASE}/ledger?asset=XYZ&limit=7`, { waitUntil: 'networkidle' });
await ines.waitForTimeout(700);
const afterLoad = await ines.evaluate(() => window.history.length);
chk('the URL is rewritten to the defaults', new URL(ines.url()).search, '');
chk(
  'the asset falls back to all assets',
  await ines.getByRole('combobox', { name: 'Ledger asset' }).inputValue(),
  '',
);
chk(
  'the count falls back to 50',
  await ines.getByRole('combobox', { name: 'Postings shown' }).inputValue(),
  '50',
);
await ines.waitForTimeout(300);
chk(
  'the rewrite added no history entry',
  await ines.evaluate(() => window.history.length),
  afterLoad,
);

note('a desk-time field error leaves the URL untouched (DP-04)');
await fromField.fill('2026-03-08 02:30');
await fromField.press('Enter');
await ines.waitForTimeout(400);
chk('the gap is refused', await fromField.getAttribute('aria-invalid'), 'true');
const gapMessage = await ines
  .locator(`#${await fromField.getAttribute('aria-describedby')}`)
  .textContent();
chk(
  'with the published copy',
  gapMessage,
  'That time doesn\u2019t exist in the desk time zone \u2013 the clocks skip it.',
);
chk('the URL is untouched', new URL(ines.url()).search, '');

note('the trial balance lists all three assets and nets to zero (DP-03)');
const totals = ines.getByRole('table', { name: 'Ledger totals', exact: true });
chk('the totals table is present', await totals.count(), 1);
const netCells = await totals
  .locator('tbody tr')
  .evaluateAll((rows) => rows.map((row) => row.children[3].textContent));
chk('three assets', netCells.length, 3);
chk(
  'every asset nets to zero',
  netCells.every((t) => /^0,0+$/.test(t)),
  true,
);
chk(
  'the postings table is present',
  await ines.getByRole('table', { name: 'Postings', exact: true }).count(),
  1,
);

note('no console errors');
chk('nothing was logged', errors.join(' | '), '');

await browser.close();
console.log(fails === 0 ? `\nALL ${checks} PASS` : `\n${fails} of ${checks} FAILED`);
if (fails > 0) process.exitCode = 1;
