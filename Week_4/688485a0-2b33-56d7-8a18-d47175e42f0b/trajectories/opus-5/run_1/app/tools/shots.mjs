// Screenshots of the published viewports, used while building.
import { chromium } from '/tmp/node_modules/playwright/index.mjs';

const BASE = 'http://localhost:4173';
const KEY = 'grade-7f3c';
const stamp = Date.now().toString(36);

const data = await fetch(`${BASE}/api/grading/seed`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Grading-Key': KEY },
  body: JSON.stringify({
    users: [{ email: `shot-${stamp}@example.test`, password: 'jarful-pass', name: 'Sal Shot' }],
    projects: [
      {
        name: `Pictures ${stamp}`,
        owner: `shot-${stamp}@example.test`,
        collections: [
          {
            name: 'pots',
            documents: Array.from({ length: 14 }, (_item, index) => ({
              name: `Pot ${index + 1}`,
              price: 7.5 + index,
              tags: index % 2 === 0 ? ['red'] : ['blue', 'green'],
              made: { $date: '2026-03-01T00:00:00Z' },
            })),
            saved_queries: [{ name: 'Reds', filter: { tags: 'red' }, projection: null, sort: null, limit: 0 }],
          },
        ],
      },
    ],
  }),
}).then((answer) => answer.json());

const project = data.projects[`Pictures ${stamp}`];
const pid = project.id;
const cid = project.collections.pots.id;

const browser = await chromium.launch();
const shots = [
  ['landing-1280', { width: 1280, height: 800 }, '/'],
  ['landing-375', { width: 375, height: 812 }, '/'],
  ['documents-1280', { width: 1280, height: 800 }, `/p/${pid}/c/${cid}`],
  ['documents-768', { width: 768, height: 1024 }, `/p/${pid}/c/${cid}`],
  ['documents-375', { width: 375, height: 812 }, `/p/${pid}/c/${cid}`],
  ['document-open', { width: 1280, height: 800 }, `/p/${pid}/c/${cid}`, 'open'],
  ['pipeline-1280', { width: 1280, height: 800 }, `/p/${pid}/c/${cid}/pipeline`, 'stage'],
  ['schema-1280', { width: 1280, height: 800 }, `/p/${pid}/c/${cid}/schema`],
  ['queries-1280', { width: 1280, height: 800 }, `/p/${pid}/c/${cid}/queries`],
  ['projects-1280', { width: 1280, height: 800 }, '/projects'],
  ['members-1280', { width: 1280, height: 800 }, `/p/${pid}/members`],
  ['rules-1280', { width: 1280, height: 800 }, `/p/${pid}/c/${cid}/rules`],
];

for (const [name, viewport, path, extra] of shots) {
  const page = await browser.newPage({ viewport });
  if (!path.startsWith('/p/') && path !== '/projects') {
    await page.goto(`${BASE}${path}`);
  } else {
    await page.goto(`${BASE}/signin`);
    await page.getByRole('textbox', { name: 'Email' }).fill(`shot-${stamp}@example.test`);
    await page.getByRole('textbox', { name: 'Password' }).fill('jarful-pass');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/projects/);
    await page.goto(`${BASE}${path}`);
  }
  await page.waitForTimeout(1600);
  if (extra === 'open') {
    await page.locator('[data-doc-id]').first().click();
    await page.waitForTimeout(900);
  }
  if (extra === 'stage') {
    await page.getByRole('button', { name: 'Add stage' }).click();
    await page.getByRole('textbox', { name: 'Stage 1 JSON' }).fill('{"$match":{"tags":"red"}}');
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: 'Add stage' }).click();
    await page.getByRole('textbox', { name: 'Stage 2 JSON' }).fill('{"$unwind":"$tags"}');
    await page.waitForTimeout(1200);
  }
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  console.log(name, 'scrollWidth', scrollWidth, 'clientWidth', clientWidth, scrollWidth > clientWidth ? 'SIDEWAYS SCROLL' : 'ok');
  await page.screenshot({ path: `/tmp/shots/${name}.png`, fullPage: false });
  await page.close();
}

await browser.close();
console.log('done');
