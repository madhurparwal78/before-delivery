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

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
await page.goto(`${BASE}/?actor=stw-ines`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

note('the bundled fonts are loaded from our own origin (DP-64)');
const fontRequests = [];
page.on('response', (r) => {
  if (r.url().includes('/fonts/'))
    fontRequests.push(`${new URL(r.url()).origin} ${r.status()}`);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);
chk('fonts were served', fontRequests.length > 0, true);
chk(
  'every font came from this origin with 200',
  fontRequests.every((r) => r === `${BASE} 200`),
  true,
);

const families = await page.evaluate(() => {
  const figure = document.querySelector('.value.figure');
  const heading = document.querySelector('h1');
  const body = document.querySelector('.label');
  return {
    figure: getComputedStyle(figure).fontFamily,
    heading: getComputedStyle(heading).fontFamily,
    body: getComputedStyle(body).fontFamily,
    tabular: getComputedStyle(figure).fontVariantNumeric,
  };
});
chk('figures use IBM Plex Mono', families.figure.includes('IBM Plex Mono'), true);
chk('headings use Space Grotesk', families.heading.includes('Space Grotesk'), true);
chk('body text uses IBM Plex Sans', families.body.includes('IBM Plex Sans'), true);
chk('figures use tabular digits', families.tabular.includes('tabular-nums'), true);

note('the desk separators have real glyphs in the bundled mono face (DP-61)');
const glyphs = await page.evaluate(async () => {
  await document.fonts.ready;
  const measure = (text, family) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = `16px ${family}`;
    return context.measureText(text).width;
  };
  const withFont = (text) => measure(text, '"IBM Plex Mono"');
  const fallback = (text) => measure(text, 'monospace');
  return {
    // A missing glyph renders as .notdef, which is a different width from the
    // digit it should match in a monospace face.
    narrowSpaceWidth: withFont('\u202F'),
    minusWidth: withFont('\u2212'),
    digitWidth: withFont('0'),
    fallbackDigit: fallback('0'),
    loaded: document.fonts.check('16px "IBM Plex Mono"'),
  };
});
chk('the mono face is loaded', glyphs.loaded, true);
chk('the minus sign is a full-width mono glyph', glyphs.minusWidth, glyphs.digitWidth);
chk('the narrow no-break space has its own width', glyphs.narrowSpaceWidth > 0, true);
chk(
  'the narrow space is narrower than a digit',
  glyphs.narrowSpaceWidth < glyphs.digitWidth,
  true,
);

note('digits are the same width, so decimal commas line up (DP-64)');
const widths = await page.evaluate(async () => {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = '16px "IBM Plex Mono"';
  return '0123456789'.split('').map((d) => context.measureText(d).width);
});
chk('every digit has the same advance', new Set(widths).size, 1);

note('the not-found page (Screens and layout)');
await page.goto(`${BASE}/nowhere`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
chk(
  'the heading',
  await page
    .getByRole('heading', { name: 'We couldn\u2019t find that page.', exact: true })
    .count(),
  1,
);
chk(
  'a link back to the root',
  await page.locator('.worksheet-body a').first().getAttribute('href'),
  '/',
);

note('what is never served (Server boundary)');
for (const path of [
  '/package.json',
  '/package-lock.json',
  '/tsconfig.json',
  '/src/server.ts',
  '/app.js.map',
  '/.env',
  '/run.json',
]) {
  const reply = await page.request.get(`${BASE}${path}`);
  const body = await reply.text();
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }
  chk(`${path} is refused`, reply.status(), 404);
  chk(`${path} answers the problem body`, parsed?.code, 'not_found');
}
chk('the built app is served', (await page.request.get(`${BASE}/app.js`)).status(), 200);
chk('the stylesheet is served', (await page.request.get(`${BASE}/styles.css`)).status(), 200);
chk(
  'a path with no extension serves the app',
  (await page.request.get(`${BASE}/anything/here`)).status(),
  200,
);
chk(
  'no cross-origin allowance header',
  (await page.request.get(`${BASE}/api/health`)).headers()['access-control-allow-origin'],
  undefined,
);

note('the stacked layout at 375 by 812 keeps its labels (DP-62)');
const small = await browser.newContext({ viewport: { width: 375, height: 812 } });
const narrow = await small.newPage();
await narrow.goto(`${BASE}/?actor=stw-ines`, { waitUntil: 'networkidle' });
await narrow.waitForTimeout(500);
await narrow.goto(`${BASE}/ledger`, { waitUntil: 'networkidle' });
await narrow.waitForTimeout(900);
const labelled = await narrow.evaluate(() => {
  const cells = Array.from(document.querySelectorAll('.ledger-table tbody td'));
  return {
    total: cells.length,
    withLabel: cells.filter((c) => (c.getAttribute('data-label') ?? '') !== '').length,
    firstLabel: cells[0]?.getAttribute('data-label') ?? '',
  };
});
chk('every stacked cell carries its label', labelled.withLabel, labelled.total);
chk('the first label is the column name', labelled.firstLabel, 'Asset');

note('the queue keeps its grid role and keyboard model when stacked (DP-62)');
await page.goto(`${BASE}/steward`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.getByRole('combobox', { name: 'Asset', exact: true }).selectOption('MBTC');
await page.getByRole('textbox', { name: 'New price', exact: true }).fill('52\u202F000');
await page.getByRole('button', { name: 'Post price', exact: true }).click();
await page.waitForTimeout(1200);
const liq = await small.newPage();
await liq.goto(`${BASE}/?actor=lq-kestrel`, { waitUntil: 'networkidle' });
await liq.waitForTimeout(1500);
chk(
  'the grid role survives',
  await liq.getByRole('grid', { name: 'Liquidation queue' }).count(),
  1,
);
chk(
  'its rows survive',
  (await liq.getByRole('grid', { name: 'Liquidation queue' }).getByRole('row').count()) > 1,
  true,
);
chk(
  'its cells keep their labels',
  await liq.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('[role="gridcell"]'));
    return cells.length > 0 && cells.every((c) => (c.getAttribute('data-label') ?? '') !== '');
  }),
  true,
);
await liq.evaluate(() => document.querySelector('[data-row="0"][data-col="0"]')?.focus());
await liq.keyboard.press('ArrowRight');
chk(
  'the keyboard model survives',
  await liq.evaluate(() => document.activeElement?.dataset?.col),
  '1',
);
const narrowOverflow = await liq.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
chk('nothing scrolls sideways at 375', narrowOverflow, 0);

note('touch targets meet the published size (DP-63)');
const tooSmall = await page.evaluate(() => {
  const controls = Array.from(
    document.querySelectorAll('button, a.action, input, select, [role="gridcell"] button'),
  ).filter((n) => n.offsetParent !== null);
  return controls
    .map((n) => {
      const box = n.getBoundingClientRect();
      return {
        name: n.textContent?.slice(0, 24) ?? n.tagName,
        w: Math.round(box.width),
        h: Math.round(box.height),
      };
    })
    .filter((b) => b.h < 44 || b.w < 44);
});
chk('every visible control is at least 44 px', JSON.stringify(tooSmall), '[]');

note('a focused control shows a visible focus mark (DP-63)');
await page.goto(`${BASE}/steward`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
const outline = await page.evaluate(() => {
  const control = document.querySelector('button.action');
  control.focus();
  const style = getComputedStyle(control);
  return { width: style.outlineWidth, style: style.outlineStyle, offset: style.outlineOffset };
});
chk('the outline is drawn', outline.style, 'solid');
chk('it is at least 2px', parseFloat(outline.width) >= 2, true);
chk('it sits outside the edge', parseFloat(outline.offset) > 0, true);

await browser.close();
console.log(fails === 0 ? `\nALL ${checks} PASS` : `\n${fails} of ${checks} FAILED`);
if (fails > 0) process.exitCode = 1;
