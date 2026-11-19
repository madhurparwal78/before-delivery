// Ad-hoc browser checks for projections, mixed sorts, grouping and reduced motion.
import { chromium } from '/tmp/node_modules/playwright/index.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const KEY = process.env.GRADING_KEY ?? 'grade-7f3c';
const results = [];
const stamp = Date.now().toString(36);

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function signIn(page, email) {
  await page.goto(`${BASE}/signin`);
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill('jarful-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/projects/);
}

async function run(page, filter, projection, sort) {
  await page.getByRole('textbox', { name: 'Filter' }).fill(filter);
  await page.getByRole('textbox', { name: 'Projection' }).fill(projection);
  await page.getByRole('textbox', { name: 'Sort' }).fill(sort);
  await page.getByRole('button', { name: 'Run' }).click();
  await page.waitForTimeout(600);
}

const data = await fetch(`${BASE}/api/grading/seed`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Grading-Key': KEY },
  body: JSON.stringify({
    users: [{ email: `mix-${stamp}@example.test`, password: 'jarful-pass', name: 'Mia Mix' }],
    projects: [
      {
        name: `Mixed ${stamp}`,
        owner: `mix-${stamp}@example.test`,
        collections: [
          {
            name: 'mixed',
            documents: [
              { _id: 'b00000000000000000000001' },
              { _id: 'b00000000000000000000002', v: null },
              { _id: 'b00000000000000000000003', v: 3 },
              { _id: 'b00000000000000000000004', v: '3' },
              { _id: 'b00000000000000000000005', v: [5, 1] },
              { _id: 'b00000000000000000000006', v: true },
              { _id: 'b00000000000000000000007', v: { $date: '2026-01-01T00:00:00Z' } },
              { _id: 'b00000000000000000000008', v: { a: 1 } },
              { _id: 'b00000000000000000000009', v: [] },
              { _id: 'b00000000000000000000010', v: 3, w: 2 },
              { _id: 'b00000000000000000000011', v: 3, w: 1 },
              { _id: 'b00000000000000000000012', v: 0.000123456789, w: 1 },
            ],
          },
          {
            name: 'shop',
            documents: [
              { _id: 'd00000000000000000000001', sku: 'A', price: 12, tags: ['red', 'blue'], items: [{ sku: 'S1', qty: 2 }] },
              { _id: 'd00000000000000000000002', sku: 'B', price: 7.5, tags: ['green'], items: [{ sku: 'S2', qty: 1 }] },
              { _id: 'd00000000000000000000003', sku: 'C', price: 20, tags: ['red'], items: [{ sku: 'S1', qty: 9 }] },
            ],
          },
        ],
      },
    ],
  }),
}).then((answer) => answer.json());

const project = data.projects[`Mixed ${stamp}`];
const pid = project.id;
const mixed = project.collections.mixed.id;
const shop = project.collections.shop.id;

const browser = await chromium.launch();

// Projections across the three views
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await signIn(page, `mix-${stamp}@example.test`);
  await page.goto(`${BASE}/p/${pid}/c/${shop}`);
  await page.getByRole('textbox', { name: 'Filter' }).waitFor();

  await run(page, '{"_id":"d00000000000000000000001"}', '{"sku":1,"items.sku":1}', '');
  const listText = await page.getByRole('list', { name: 'Documents' }).innerText();
  check('inclusion projection in list', listText.includes('items: [{"sku":"S1"}]') && !listText.includes('price'), listText.replace(/\n/g, '|'));

  await run(page, '{"_id":"d00000000000000000000001"}', '{"sku":1,"_id":0}', '');
  const noId = await page.getByRole('list', { name: 'Documents' }).innerText();
  const rowId = await page.locator('[data-doc-id]').first().getAttribute('data-doc-id');
  check('_id dropped but row keeps its id', !noId.includes('_id') && rowId === 'd00000000000000000000001', `${noId} ${rowId}`);
  await page.getByRole('radio', { name: 'Table' }).click();
  const headers = await page.locator('th').allInnerTexts();
  check('no _id column', !headers.includes('_id'), headers.join(','));

  await run(page, '{"_id":"d00000000000000000000001"}', '{"items":0,"tags":0}', '');
  await page.getByRole('radio', { name: 'List' }).click();
  const excluded = await page.getByRole('list', { name: 'Documents' }).innerText();
  check('exclusion projection', excluded.includes('price: 12') && !excluded.includes('tags'), excluded.replace(/\n/g, '|'));

  await run(page, '{}', '{"sku":1,"price":0}', '');
  const alert = await page.getByRole('alert', { name: 'Query error' }).textContent();
  check('mixed projection alert', alert === 'Projection cannot mix inclusion and exclusion', alert);
  await page.close();
}

// Mixed sort, display rule in all views, paging
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await signIn(page, `mix-${stamp}@example.test`);
  await page.goto(`${BASE}/p/${pid}/c/${mixed}`);
  await page.getByRole('textbox', { name: 'Filter' }).waitFor();
  await run(page, '', '', '{"v":1,"w":1}');
  const order = await page.locator('[data-doc-id]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-doc-id').slice(-2)),
  );
  check('mixed sort order', order.join(',') === '01,02,09,12,05,03,11,10,04,08', order.join(','));
  const pageText = await page.locator('.pager').innerText();
  check('two pages', pageText.includes('Page 1 of 2'), pageText.replace(/\n/g, '|'));
  await page.getByRole('button', { name: 'Next page' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Page 2 of 2/.test(document.body.innerText));
  const second = await page.locator('[data-doc-id]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-doc-id').slice(-2)),
  );
  check('second page order', second.join(',') === '06,07', second.join(','));

  await run(page, '{"_id":"b00000000000000000000012"}', '', '');
  const list = await page.getByRole('list', { name: 'Documents' }).innerText();
  await page.getByRole('radio', { name: 'Table' }).click();
  const grid = await page.getByRole('grid', { name: 'Documents' }).innerText();
  await page.getByRole('radio', { name: 'JSON' }).click();
  const json = await page.getByRole('region', { name: 'JSON results' }).innerText();
  check(
    'display rule in all three views',
    list.includes('0.000123457') && grid.includes('0.000123457') && json.includes('0.000123457'),
    `${list.replace(/\n/g, '|')} // ${grid.replace(/\n/g, '|')} // ${json.replace(/\n/g, '|')}`,
  );
  await page.close();
}

// Grouping with every accumulator, settled sieve and reduced motion
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await signIn(page, `mix-${stamp}@example.test`);
  await page.goto(`${BASE}/p/${pid}/c/${shop}/pipeline`);
  await page.getByRole('button', { name: 'Add stage' }).click();
  await page
    .getByRole('textbox', { name: 'Stage 1 JSON' })
    .fill(
      '{"$group":{"_id":null,"total":{"$sum":"$price"},"avg":{"$avg":"$price"},"lo":{"$min":"$price"},"hi":{"$max":"$price"},"skus":{"$push":"$sku"},"first":{"$first":"$sku"},"last":{"$last":"$sku"},"n":{"$count":{}}}}',
    );
  await page.waitForTimeout(1200);
  const preview = await page.getByRole('region', { name: 'Stage preview' }).innerText();
  check('rounded average in preview', preview.includes('13.1667'), preview.replace(/\n/g, '|'));
  check('sum and count in preview', preview.includes('39.5') && preview.includes('"n": 3'), preview.replace(/\n/g, '|'));
  const band = await page.locator('[data-stage-index="0"]').evaluate((node) => ({
    count: node.dataset.stageCount,
    numeral: node.querySelector('.stage-count').textContent,
    width: node.querySelector('[data-sieve-bar]').getBoundingClientRect().width,
    track: node.querySelector('[data-sieve-track]').getBoundingClientRect().width,
  }));
  const wanted = (Math.log(1 + 1) / Math.log(1 + 3)) * band.track;
  check('settled bar within a pixel', Math.abs(band.width - wanted) <= 1, `${band.width} vs ${wanted}`);
  check('numeral equals the server count', band.numeral === band.count, JSON.stringify(band));
  await page.close();

  const reduced = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await signIn(reduced, `mix-${stamp}@example.test`);
  await reduced.goto(`${BASE}/p/${pid}/c/${shop}/pipeline`);
  await reduced.getByRole('textbox', { name: 'Stage 1 JSON' }).waitFor();
  await reduced.waitForTimeout(800);
  const first = await reduced.locator('[data-stage-index="0"]').evaluate((node) => ({
    numeral: node.querySelector('.stage-count').textContent,
    count: node.dataset.stageCount,
  }));
  check('reduced motion settles at once', first.numeral === first.count, JSON.stringify(first));
  await reduced.close();
}

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
