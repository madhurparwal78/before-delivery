// Ad-hoc browser checks over the journeys, run while building.
import { chromium } from '/tmp/node_modules/playwright/index.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const KEY = process.env.GRADING_KEY ?? 'grade-7f3c';
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function seed() {
  const stamp = Date.now().toString(36);
  const body = {
    users: [
      { email: `owner-${stamp}@example.test`, password: 'jarful-pass', name: 'Ola Finch' },
      { email: `editor-${stamp}@example.test`, password: 'jarful-pass', name: 'Edd Marsh' },
      { email: `reader-${stamp}@example.test`, password: 'jarful-pass', name: 'Rae Dove' },
    ],
    projects: [
      {
        name: `Shop ${stamp}`,
        owner: `owner-${stamp}@example.test`,
        members: [
          { email: `editor-${stamp}@example.test`, role: 'editor' },
          { email: `reader-${stamp}@example.test`, role: 'reader' },
        ],
        collections: [
          {
            name: 'pots',
            documents: [
              { _id: 'e00000000000000000000001', sku: 'POT-1', price: 12, tags: ['red', 'blue'], items: [{ sku: 'S1', qty: 2 }] },
              { _id: 'e00000000000000000000002', sku: 'POT-2', price: 7.5, tags: ['green'], items: [{ sku: 'S2', qty: 1 }] },
              { _id: 'e00000000000000000000003', sku: 'POT-3', price: 20, tags: ['red'], items: [{ sku: 'S1', qty: 9 }] },
            ],
            saved_queries: [{ name: 'Red pots', filter: { tags: 'red' }, projection: null, sort: null, limit: 0 }],
          },
        ],
      },
    ],
  };
  const answer = await fetch(`${BASE}/api/grading/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Grading-Key': KEY },
    body: JSON.stringify(body),
  });
  const data = await answer.json();
  return { stamp, data };
}

async function signIn(page, email) {
  await page.goto(`${BASE}/signin`);
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill('jarful-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/projects/);
}

const browser = await chromium.launch();
const { stamp, data } = await seed();
const project = data.projects[`Shop ${stamp}`];
const pid = project.id;
const cid = project.collections.pots.id;

// Landing
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(BASE);
  await page.getByRole('heading', { name: 'JARFUL', level: 1 }).waitFor();
  const region = page.getByRole('region', { name: 'Stage Sieve sample' });
  await region.waitFor();
  await page.waitForTimeout(1200);
  const counts = await region.locator('[data-stage-index]').evaluateAll((nodes) =>
    nodes.map((node) => ({ index: node.dataset.stageIndex, count: node.dataset.stageCount, numeral: node.querySelector('.stage-count').textContent })),
  );
  check('hero sample counts', JSON.stringify(counts.map((c) => c.count)) === '["413","620","5","5"]', JSON.stringify(counts));
  check('hero numerals settle', counts.every((c) => c.count === c.numeral), JSON.stringify(counts.map((c) => c.numeral)));
  check('start a project link', await page.getByRole('link', { name: 'Start a project' }).isVisible());
  check('landing has no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}

// Owner workspace
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await signIn(page, `owner-${stamp}@example.test`);
  check('projects heading', await page.getByRole('heading', { name: 'YOUR JARS' }).isVisible());
  await page.goto(`${BASE}/p/${pid}/c/${cid}`);
  const status = page.getByRole('status', { name: 'Query status' });
  await page.waitForFunction(() => {
    const node = document.querySelector('[aria-label="Query status"]');
    return node && /matched|No documents/.test(node.textContent);
  });
  check('empty run status', (await status.textContent()) === '3 documents matched, 3 shown', await status.textContent());
  const plan = page.getByRole('status', { name: 'Query plan' });
  check('plan readout', (await plan.textContent()).includes('Full scan') && (await plan.textContent()).includes('Examined 3 documents, returned 3'), await plan.textContent());

  // array filter with Ctrl+Enter
  await page.getByRole('textbox', { name: 'Filter' }).fill('{"items.qty":{"$gt":5}}');
  await page.getByRole('textbox', { name: 'Filter' }).press('Control+Enter');
  await page.waitForFunction(() => (document.querySelector('[aria-label="Query status"]')?.textContent ?? '').startsWith('1 document'));
  check('array filter count', (await status.textContent()) === '1 document matched, 1 shown', await status.textContent());

  // views
  await page.getByRole('radio', { name: 'List' }).focus();
  await page.keyboard.press('ArrowRight');
  check('table view after arrow', await page.getByRole('grid', { name: 'Documents' }).isVisible());
  const cell = page.locator('td[tabindex="0"]');
  await cell.focus();
  await page.keyboard.press('ArrowRight');
  const focused = await page.evaluate(() => document.activeElement.getAttribute('data-field-path'));
  check('grid arrow moves cell', focused === 'items', String(focused));
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/d\/e00000000000000000000003/);
  const editor = page.getByRole('region', { name: 'Document editor' });
  check('editor opened by Enter', await editor.getByRole('textbox', { name: 'Document JSON' }).isVisible());
  await page.waitForFunction(() => (document.querySelector('[aria-label="Document JSON"]')?.value ?? '').includes('_id'));
  const text = await editor.getByRole('textbox', { name: 'Document JSON' }).inputValue();
  check('editor shows stored document', text.startsWith('{\n  "_id": "e00000000000000000000003"'), text.slice(0, 40));

  // save with Ctrl+S
  await editor.getByRole('textbox', { name: 'Document JSON' }).fill(text.replace('"price": 20', '"price": 21'));
  await editor.getByRole('textbox', { name: 'Document JSON' }).press('Control+s');
  await page.waitForFunction(() => (document.querySelector('[aria-label="Save status"]')?.textContent ?? '') === 'Saved');
  check('ctrl+s saves', true);
  await editor.getByRole('button', { name: 'Close' }).click();
  await page.waitForURL(new RegExp(`/p/${pid}/c/${cid}$`));

  // separators
  const separator = page.getByRole('separator', { name: 'Resize query pane' });
  await separator.focus();
  await page.keyboard.press('ArrowDown');
  check('separator steps by 5', (await separator.getAttribute('aria-valuenow')) === '35', await separator.getAttribute('aria-valuenow'));
  await page.keyboard.press('Home');
  check('separator Home is 20', (await separator.getAttribute('aria-valuenow')) === '20');

  // indexes
  await page.getByRole('link', { name: 'Indexes' }).click();
  await page.getByRole('textbox', { name: 'Index keys' }).fill('{"sku":1}');
  await page.getByRole('checkbox', { name: 'Unique' }).check();
  await page.getByRole('button', { name: 'Create index' }).click();
  await page.waitForFunction(() => /Index sku_1 created/.test((document.querySelector('[aria-label="Index status"]')?.textContent ?? '')));
  check('index created status', true);

  await page.getByRole('link', { name: 'Documents' }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Query status"]'));
  await page.getByRole('textbox', { name: 'Filter' }).fill('{"sku":"POT-1"}');
  await page.getByRole('button', { name: 'Run' }).click();
  await page.waitForFunction(() => document.querySelector('[data-plan-kind]')?.dataset.planKind === 'index');
  check('plan uses index', (await page.locator('[data-plan-kind]').getAttribute('data-plan-index')) === 'sku_1');

  // schema
  await page.getByRole('link', { name: 'Schema' }).click();
  await page.getByRole('list', { name: 'Schema fields' }).waitFor();
  const rows = await page.locator('[data-field-path][data-present]').evaluateAll((nodes) =>
    nodes.map((node) => [node.dataset.fieldPath, node.dataset.present]),
  );
  check('schema rows', JSON.stringify(rows).includes('["price","100"]'), JSON.stringify(rows));

  // rules
  await page.getByRole('link', { name: 'Rules' }).click();
  await page.getByRole('textbox', { name: 'Validator JSON' }).fill('{"required":["sku"],"properties":{"price":{"bsonType":"number","minimum":5}}}');
  await page.getByRole('button', { name: 'Save rules' }).click();
  await page.waitForFunction(() => (document.querySelector('[aria-label="Rules status"]')?.textContent ?? '') === 'Rules saved');
  check('rules saved', true);

  // pipeline by keyboard
  await page.getByRole('link', { name: 'Pipeline' }).click();
  await page.getByRole('button', { name: 'Add stage' }).click();
  await page.keyboard.insertText('');
  let stageText = page.getByRole('textbox', { name: 'Stage 1 JSON' });
  await stageText.fill('{"$match":{"tags":"red"}}');
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Add stage' }).click();
  await page.getByRole('textbox', { name: 'Stage 2 JSON' }).fill('{"$unwind":"$items"}');
  await page.waitForTimeout(700);
  const cards = await page.locator('[data-stage-index]').evaluateAll((nodes) => nodes.map((n) => n.dataset.stageCount));
  check('stage counts', JSON.stringify(cards) === '["2","2"]', JSON.stringify(cards));
  const stage1 = page.getByRole('group', { name: 'Stage 1: $match' });
  await stage1.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForFunction(() => /Stage moved to position 2 of 2/.test((document.querySelector('[aria-label="Pipeline status"]')?.textContent ?? '')));
  check('alt+arrow moves stage', true);
  const group2 = page.getByRole('group', { name: 'Stage 2: $match' });
  await group2.focus();
  await page.keyboard.press('Delete');
  const dialog = page.getByRole('dialog', { name: 'Delete stage 2 ($match)?' });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await page.waitForFunction(() => /Stage 2 deleted/.test((document.querySelector('[aria-label="Pipeline status"]')?.textContent ?? '')));
  check('stage deleted via dialog', true);
  check('workspace has no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}

// Reader view and live updates
{
  const readerPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await signIn(readerPage, `reader-${stamp}@example.test`);
  await readerPage.goto(`${BASE}/p/${pid}/c/${cid}`);
  await readerPage.waitForFunction(() => /matched/.test((document.querySelector('[aria-label="Query status"]')?.textContent ?? '')));
  check('reader note', await readerPage.getByText('You have read access').first().isVisible());
  check('reader has no insert', (await readerPage.getByRole('button', { name: 'Insert document' }).count()) === 0);

  const editorPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await signIn(editorPage, `editor-${stamp}@example.test`);
  await editorPage.goto(`${BASE}/p/${pid}/c/${cid}`);
  await editorPage.waitForFunction(() => /matched/.test((document.querySelector('[aria-label="Query status"]')?.textContent ?? '')));
  await editorPage.getByRole('button', { name: 'Insert document' }).click();
  const area = editorPage.getByRole('textbox', { name: 'Document JSON' });
  await area.fill('{"sku":"POT-9","price":9,"tags":["red"]}');
  await editorPage.getByRole('button', { name: 'Save', exact: true }).click();
  await editorPage.waitForFunction(() => (document.querySelector('[aria-label="Save status"]')?.textContent ?? '') === 'Saved');
  check('editor insert saved', true);

  await readerPage.waitForFunction(
    () => (document.querySelector('[aria-label="Query status"]')?.textContent ?? '') === '4 documents matched, 4 shown',
    null,
    { timeout: 4000 },
  ).then(() => check('live results update', true)).catch(async () =>
    check('live results update', false, await readerPage.getByRole('status', { name: 'Query status' }).textContent()),
  );

  // duplicate notice via unique index
  await editorPage.getByRole('button', { name: 'Insert document' }).click();
  await editorPage.getByRole('textbox', { name: 'Document JSON' }).fill('{"sku":"POT-1","price":12}');
  await editorPage.getByRole('button', { name: 'Save', exact: true }).click();
  await editorPage.waitForFunction(() => /Duplicate value/.test((document.querySelector('[aria-label="Save status"]')?.textContent ?? '')));
  const dup = await editorPage.getByRole('status', { name: 'Save status' }).textContent();
  check('duplicate notice', dup.includes('Duplicate value "POT-1" for unique index sku_1'), dup);

  // validation notice
  await editorPage.getByRole('textbox', { name: 'Document JSON' }).fill('{"sku":"POT-7","price":1}');
  await editorPage.getByRole('button', { name: 'Save', exact: true }).click();
  await editorPage.waitForFunction(() => /validation/.test((document.querySelector('[aria-label="Save status"]')?.textContent ?? '')));
  const bad = await editorPage.getByRole('status', { name: 'Save status' }).textContent();
  check('validation notice', bad.includes('Document failed validation at price: must be at least 5'), bad);

  await readerPage.close();
  await editorPage.close();
}

// Clash journey
{
  const first = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const second = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await signIn(first, `owner-${stamp}@example.test`);
  await signIn(second, `editor-${stamp}@example.test`);
  const url = `${BASE}/p/${pid}/c/${cid}/d/e00000000000000000000002`;
  await first.goto(url);
  await second.goto(url);
  await first.getByRole('textbox', { name: 'Document JSON' }).waitFor();
  await second.getByRole('textbox', { name: 'Document JSON' }).waitFor();
  await first.waitForFunction(() => (document.querySelector('[aria-label="Document JSON"]')?.value ?? '').includes('_id'));
  await second.waitForFunction(() => (document.querySelector('[aria-label="Document JSON"]')?.value ?? '').includes('_id'));
  const firstText = await first.getByRole('textbox', { name: 'Document JSON' }).inputValue();
  await first.getByRole('textbox', { name: 'Document JSON' }).fill(firstText.replace('"price": 7.5', '"price": 8'));
  await first.getByRole('textbox', { name: 'Document JSON' }).press('Control+s');
  await first.waitForFunction(() => (document.querySelector('[aria-label="Save status"]')?.textContent ?? '') === 'Saved');
  const secondText = await second.getByRole('textbox', { name: 'Document JSON' }).inputValue();
  await second.getByRole('textbox', { name: 'Document JSON' }).fill(secondText.replace('"price": 7.5', '"price": 99'));
  await second.getByRole('textbox', { name: 'Document JSON' }).press('Control+s');
  await second.getByText('This document was changed by someone else.').waitFor();
  check('clash alert', true);
  await second.getByRole('button', { name: 'Reload' }).click();
  await second.waitForFunction(() => (document.querySelector('[aria-label="Document JSON"]')?.value ?? '').includes('"price": 8'));
  check('reload shows first text', true);
  const reloaded = await second.getByRole('textbox', { name: 'Document JSON' }).inputValue();
  await second.getByRole('textbox', { name: 'Document JSON' }).fill(reloaded.replace('"price": 8', '"price": 42'));
  await second.getByRole('textbox', { name: 'Document JSON' }).press('Control+s');
  await second.waitForFunction(() => (document.querySelector('[aria-label="Save status"]')?.textContent ?? '') === 'Saved');
  check('second save wins after reload', true);
  await first.close();
  await second.close();
}

// Phone layout
{
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  await signIn(page, `editor-${stamp}@example.test`);
  await page.goto(`${BASE}/p/${pid}/c/${cid}`);
  await page.getByRole('tab', { name: 'Query' }).waitFor();
  check('phone tabs', (await page.getByRole('tab').count()) === 3);
  check('query tab selected first', (await page.getByRole('tab', { name: 'Query' }).getAttribute('aria-selected')) === 'true');
  await page.getByRole('tab', { name: 'Query' }).focus();
  await page.keyboard.press('ArrowRight');
  check('arrow selects results tab', (await page.getByRole('tab', { name: 'Results' }).getAttribute('aria-selected')) === 'true');
  const hiddenPanels = await page.locator('[role="tabpanel"]').count();
  check('one tab panel present', hiddenPanels === 1, String(hiddenPanels));
  await page.getByRole('list', { name: 'Documents' }).waitFor();
  await page.locator('[data-doc-id]').first().tap();
  const dialog = page.getByRole('dialog', { name: 'Document' });
  await dialog.waitFor();
  check('phone editor dialog', true);
  await page.waitForFunction(() => (document.querySelector('[aria-label="Document JSON"]')?.value ?? '').includes('_id'));
  const value = await dialog.getByRole('textbox', { name: 'Document JSON' }).inputValue();
  await dialog.getByRole('textbox', { name: 'Document JSON' }).fill(value.replace(/}$/, ',"touched":true}'));
  await dialog.getByRole('button', { name: 'Save', exact: true }).tap();
  await page.waitForFunction(() => (document.querySelector('[aria-label="Save status"]')?.textContent ?? '') === 'Saved');
  check('phone touch save', true);
  await dialog.getByRole('button', { name: 'Close' }).tap();
  await page.getByRole('button', { name: 'Collections' }).tap();
  await page.getByRole('dialog', { name: 'Collections' }).waitFor();
  check('collections drawer', true);
  await page.keyboard.press('Escape');
  check('drawer closes on escape', (await page.getByRole('dialog', { name: 'Collections' }).count()) === 0);
  await page.close();
}

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
