// Checks the outage banner on an instance whose object storage is unreachable.
import { chromium } from '/tmp/node_modules/playwright/index.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4199';
const stamp = Date.now().toString(36);

const data = await fetch(`${BASE}/api/grading/seed`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Grading-Key': 'grade-7f3c' },
  body: JSON.stringify({
    users: [{ email: `banner-${stamp}@example.test`, password: 'jarful-pass', name: 'Ben Ner' }],
    projects: [
      {
        name: `Banner ${stamp}`,
        owner: `banner-${stamp}@example.test`,
        collections: [{ name: 'stuff', documents: [{ _id: 'a00000000000000000000001', a: 1 }] }],
      },
    ],
  }),
}).then((answer) => answer.json());

const project = data.projects[`Banner ${stamp}`];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`${BASE}/signin`);
await page.getByRole('textbox', { name: 'Email' }).fill(`banner-${stamp}@example.test`);
await page.getByRole('textbox', { name: 'Password' }).fill('jarful-pass');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL(/\/projects/);
await page.goto(`${BASE}/p/${project.id}/c/${project.collections.stuff.id}`);
await page.getByText('File storage is unavailable. Try again later.').waitFor({ timeout: 6000 });
console.log('ok   outage banner shows');
await page.waitForFunction(() => /matched/.test(document.querySelector('[aria-label="Query status"]')?.textContent ?? ''));
console.log('ok   queries keep working:', await page.getByRole('status', { name: 'Query status' }).textContent());
await browser.close();
