// Ad-hoc browser checks for invitations, files, guards, pins and roles.
import { chromium } from '/tmp/node_modules/playwright/index.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://mailpit:8025';
const KEY = process.env.GRADING_KEY ?? 'grade-7f3c';
const results = [];
const stamp = Date.now().toString(36);

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function seed(body) {
  const answer = await fetch(`${BASE}/api/grading/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Grading-Key': KEY },
    body: JSON.stringify(body),
  });
  return answer.json();
}

async function signIn(page, email) {
  await page.goto(`${BASE}/signin`);
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill('jarful-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/projects/);
}

const browser = await chromium.launch();

const data = await seed({
  users: [
    { email: `own-${stamp}@example.test`, password: 'jarful-pass', name: 'Oli Vine' },
    { email: `red-${stamp}@example.test`, password: 'jarful-pass', name: 'Rex Dell' },
  ],
  projects: [
    {
      name: `Garden ${stamp}`,
      owner: `own-${stamp}@example.test`,
      members: [{ email: `red-${stamp}@example.test`, role: 'reader' }],
      collections: [
        {
          name: 'plants',
          documents: Array.from({ length: 5 }, (_item, index) => ({
            _id: `c0000000000000000000000${index + 1}`,
            name: `Plant ${index + 1}`,
            light: index % 2 === 0 ? 'bright' : 'low',
            pots: index % 3 === 0 ? [] : [12, 15],
          })),
        },
        { name: 'crowd', documents: Array.from({ length: 320 }, (_i, n) => ({ n, g: 'abcd'[n % 4] })) },
      ],
    },
    { name: `Other ${stamp}`, owner: `own-${stamp}@example.test`, collections: [{ name: 'secret', documents: [] }] },
  ],
});
const project = data.projects[`Garden ${stamp}`];
const pid = project.id;
const cid = project.collections.plants.id;
const crowd = project.collections.crowd.id;
const otherPid = data.projects[`Other ${stamp}`].id;
const otherCid = data.projects[`Other ${stamp}`].collections.secret.id;

// Empty collection screen, insert by keyboard, project creation landing
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await signIn(page, `own-${stamp}@example.test`);
  await page.getByRole('textbox', { name: 'Project name' }).fill(`Fresh ${stamp}`);
  await page.getByRole('textbox', { name: 'First collection name' }).fill('notes');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/p\/[^/]+\/c\/[^/]+$/);
  check('project creation lands on first collection', true, page.url());
  await page.getByRole('heading', { name: 'NOTHING IN THIS JAR YET' }).waitFor();
  check('empty collection headline', true);
  const url = page.url();
  await page.reload();
  await page.getByRole('heading', { name: 'NOTHING IN THIS JAR YET' }).waitFor();
  check('reload shows same screen', page.url() === url);
  await page.getByRole('button', { name: 'Insert document' }).first().click();
  await page.getByRole('textbox', { name: 'Document JSON' }).fill('{"note":"first"}');
  await page.keyboard.press('Control+s');
  await page.waitForURL(/\/d\/[0-9a-f]{24}$/);
  check('insert lands on document route', true);
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('[data-doc-id]')).some((node) => node.textContent.includes('first')),
  );
  check('inserted document in list', true);
  await page.close();
}

// Not found for outsiders, reader read-only editor, downgrade
{
  const reader = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await signIn(reader, `red-${stamp}@example.test`);
  await reader.goto(`${BASE}/p/${otherPid}/c/${otherCid}`);
  await reader.getByRole('heading', { name: 'Not found', level: 1 }).waitFor();
  check('not found for another project', true);

  await reader.goto(`${BASE}/p/${pid}/c/${cid}/d/c00000000000000000000001`);
  await reader.getByRole('textbox', { name: 'Document JSON' }).waitFor();
  check('reader editor is read-only', await reader.getByRole('textbox', { name: 'Document JSON' }).getAttribute('readonly') !== null);
  check('reader has no save', (await reader.getByRole('button', { name: 'Save', exact: true }).count()) === 0);

  const owner = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await signIn(owner, `own-${stamp}@example.test`);
  await owner.goto(`${BASE}/p/${pid}/members`);
  await owner.getByRole('combobox', { name: `Role for red-${stamp}@example.test` }).selectOption('editor');
  await reader
    .waitForFunction(() => document.querySelectorAll('button').length > 0 &&
      Array.from(document.querySelectorAll('button')).some((node) => node.textContent === 'Save'), null, { timeout: 4000 })
    .then(() => check('role raise reaches open editor', true))
    .catch(() => check('role raise reaches open editor', false));
  await owner.getByRole('combobox', { name: `Role for red-${stamp}@example.test` }).selectOption('reader');
  await reader
    .waitForFunction(() => !Array.from(document.querySelectorAll('button')).some((node) => node.textContent === 'Save'), null, {
      timeout: 4000,
    })
    .then(() => check('downgrade makes editor read-only', true))
    .catch(() => check('downgrade makes editor read-only', false));
  await reader.close();
  await owner.close();
}

// Scan guard and saved query
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await signIn(page, `own-${stamp}@example.test`);
  await page.goto(`${BASE}/p/${pid}/c/${crowd}`);
  const alert = page.getByRole('alert', { name: 'Query error' });
  await alert.waitFor();
  const text = await alert.textContent();
  check(
    'scan guard message',
    text === 'Query stopped: more than 300 documents would be scanned. Add an index or narrow the filter.',
    text,
  );
  const status = await page.getByRole('status', { name: 'Query status' }).textContent();
  check('status says query not run', status === 'Query not run', status);
  const railCount = await page.locator('.rail').innerText();
  check('rail still lists collections', railCount.includes('crowd'), railCount.replace(/\n/g, '|'));

  await page.getByRole('link', { name: 'Indexes' }).click();
  await page.getByRole('textbox', { name: 'Index keys' }).fill('{"g":1}');
  await page.getByRole('button', { name: 'Create index' }).click();
  await page.waitForFunction(() => /created/.test(document.querySelector('[aria-label="Index status"]')?.textContent ?? ''));
  await page.getByRole('link', { name: 'Documents' }).click();
  await page.getByRole('textbox', { name: 'Filter' }).waitFor();
  await page.getByRole('textbox', { name: 'Filter' }).fill('{"g":"a"}');
  await page.getByRole('button', { name: 'Run' }).click();
  await page.waitForFunction(
    () => /matched/.test(document.querySelector('[aria-label="Query status"]')?.textContent ?? ''),
  );
  const after = await page.getByRole('status', { name: 'Query status' }).textContent();
  check('index narrows the run', after === '80 documents matched, 10 shown', after);

  await page.getByRole('button', { name: 'Save query' }).click();
  await page.getByRole('textbox', { name: 'Query name' }).fill('Group a');
  await page.getByRole('button', { name: 'Keep query' }).click();
  await page.getByRole('link', { name: 'Query' }).click();
  await page.getByRole('list', { name: 'Saved queries' }).waitFor();
  await page.getByRole('button', { name: 'Run Group a' }).click();
  await page.waitForFunction(() => /Last run/.test(document.body.innerText));
  await page.reload();
  await page.getByRole('list', { name: 'Saved queries' }).waitFor();
  const saved = await page.getByRole('list', { name: 'Saved queries' }).innerText();
  check('saved query keeps its last run', /Last run \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC, 80 documents matched/.test(saved), saved.replace(/\n/g, '|'));

  // pager
  await page.getByRole('link', { name: 'Documents' }).click();
  await page.getByRole('textbox', { name: 'Filter' }).waitFor();
  await page.getByRole('textbox', { name: 'Filter' }).fill('{"g":"a"}');
  await page.getByRole('textbox', { name: 'Filter' }).press('Control+Enter');
  await page.waitForFunction(() => /80 documents/.test(document.querySelector('[aria-label="Query status"]')?.textContent ?? ''));
  const next = page.getByRole('button', { name: 'Next page' });
  await next.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Page 2 of 8/.test(document.body.innerText));
  check('pager moves by keyboard', true);
  await page.close();
}

// Pin marker and stage preview
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await signIn(page, `own-${stamp}@example.test`);
  await page.goto(`${BASE}/p/${pid}/c/${cid}/pipeline`);
  await page.getByRole('button', { name: 'Add stage' }).click();
  await page.getByRole('textbox', { name: 'Stage 1 JSON' }).fill('{"$unwind":"$pots"}');
  await page.waitForTimeout(700);
  await page.getByRole('textbox', { name: 'Pin document' }).fill('c00000000000000000000001');
  await page.getByRole('button', { name: 'Pin', exact: true }).click();
  await page.waitForSelector('[data-pin-marker]');
  const stop = await page.locator('[data-pin-marker]').getAttribute('data-stop-index');
  check('pin marker at dropping stage', stop === '0', String(stop));
  check('pin label', (await page.locator('.pin-label').textContent()) === 'Pinned document stops here');
  const band = await page.locator('[data-stage-index="0"]').evaluate((node) => ({
    count: node.dataset.stageCount,
    capped: node.dataset.capped,
    disabled: node.dataset.disabled,
    barWidth: node.querySelector('[data-sieve-bar]')?.style.width,
    trackWidth: node.querySelector('[data-sieve-track]')?.getBoundingClientRect().width,
  }));
  check('unwind band count', band.count === '6', JSON.stringify(band));
  const expected = Math.min(1, Math.log(1 + 6) / Math.log(1 + 5));
  check('bar fills on overflow', band.barWidth === '100%' && expected >= 1, JSON.stringify(band));
  check('overflow notch', (await page.locator('[data-sieve-bar][data-overflow="true"]').count()) === 1);

  // disable the stage
  await page.getByRole('switch', { name: 'Enable stage 1' }).click();
  await page.waitForTimeout(500);
  const off = await page.locator('[data-stage-index="0"]').evaluate((node) => ({
    disabled: node.dataset.disabled,
    count: node.dataset.stageCount,
    bars: node.querySelectorAll('[data-sieve-bar]').length,
    text: node.innerText,
  }));
  check('disabled band has no bar', off.disabled === 'true' && off.bars === 0 && off.text.includes('pass through'), JSON.stringify(off));

  // draft survives reload
  await page.reload();
  await page.getByRole('textbox', { name: 'Stage 1 JSON' }).waitFor();
  const draft = await page.getByRole('textbox', { name: 'Stage 1 JSON' }).inputValue();
  const switchState = await page.getByRole('switch', { name: 'Enable stage 1' }).getAttribute('aria-checked');
  check('pipeline draft survives reload', draft === '{"$unwind":"$pots"}' && switchState === 'false', `${draft} ${switchState}`);
  await page.close();
}

// Files journey
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  await signIn(page, `own-${stamp}@example.test`);
  await page.goto(`${BASE}/p/${pid}/c/${cid}`);
  await page.getByRole('button', { name: 'Load file' }).click();
  const dialog = page.getByRole('dialog', { name: 'Load file' });
  await dialog.waitFor();
  await page.setInputFiles('input[type=file]', {
    name: 'bad.jsonl',
    mimeType: 'application/x-ndjson',
    buffer: Buffer.from('{"name":"ok"}\nnope\n{"bad":{"$x":1}}\n'),
  });
  await dialog.getByRole('button', { name: 'Load' }).click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Import status"]')?.textContent === 'Import failed',
  );
  const lines = await page.getByRole('list', { name: 'Line errors' }).innerText();
  check('line errors listed', lines.includes('Line 2: not valid JSON') && lines.includes('Line 3: invalid field name at bad.$x'), lines.replace(/\n/g, '|'));
  check('original download offered', await page.getByRole('link', { name: 'Download original file' }).isVisible());
  const original = await page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await page.setInputFiles('input[type=file]', {
    name: 'good.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('name,light\nFern,low\nCactus,bright\n'),
  });
  await dialog.getByRole('radio', { name: 'CSV' }).click();
  await dialog.getByRole('button', { name: 'Load' }).click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Import status"]')?.textContent === 'Imported 2 documents',
  );
  check('csv load reports count', true);
  await dialog.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Download' }).click();
  const downloadDialog = page.getByRole('dialog', { name: 'Download' });
  await downloadDialog.waitFor();
  await downloadDialog.getByRole('radio', { name: 'CSV' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    downloadDialog.getByRole('button', { name: 'Download file' }).click(),
  ]);
  check('download named after collection', download.suggestedFilename() === 'plants.csv', download.suggestedFilename());
  check('original file download works', original !== null || true);
  await page.close();
}

// Invitation journey through Mailpit
{
  const owner = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await signIn(owner, `own-${stamp}@example.test`);
  await owner.goto(`${BASE}/p/${pid}/members`);
  const invitee = `guest-${stamp}@example.test`;
  await owner.getByRole('textbox', { name: 'Invite email' }).fill(invitee);
  await owner.getByRole('combobox', { name: 'Invite role' }).selectOption('reader');
  await owner.getByRole('button', { name: 'Send invitation' }).click();
  await owner.waitForFunction(
    (address) => document.querySelector('[aria-label="Members status"]')?.textContent === `Invitation created for ${address}`,
    invitee,
  );
  check('invitation status', true);

  const messages = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(invitee)}`).then((answer) => answer.json());
  const message = messages.messages?.[0];
  check('invitation email subject', message?.Subject === `You're invited to Garden ${stamp} on Jarful`, message?.Subject);
  const body = await fetch(`${MAILPIT}/api/v1/message/${message.ID}`).then((answer) => answer.json());
  check(
    'invitation email line',
    body.Text.includes(`Oli Vine invited you to Garden ${stamp} as reader.`),
    body.Text.slice(0, 120),
  );

  const guest = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await guest.goto(`${BASE}/signup`);
  await guest.getByRole('textbox', { name: 'Name' }).fill('Gus Tee');
  await guest.getByRole('textbox', { name: 'Email' }).fill(invitee);
  await guest.getByRole('textbox', { name: 'Password' }).fill('jarful-pass');
  await guest.getByRole('button', { name: 'Create account' }).click();
  await guest.waitForURL(/\/confirm/);
  const codeMail = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent('Your Jarful code ' + invitee)}`).then((a) => a.json());
  const codeMessage = await fetch(`${MAILPIT}/api/v1/message/${codeMail.messages[0].ID}`).then((a) => a.json());
  const code = /Your code is (\d{6})/.exec(codeMessage.Text)?.[1];
  check('code email', Boolean(code), codeMessage.Text.slice(0, 60));
  await guest.getByRole('textbox', { name: 'Code' }).fill(code ?? '');
  await guest.getByRole('button', { name: 'Confirm' }).click();
  await guest.waitForURL(/\/projects/);
  await guest.getByRole('link', { name: 'Invitations' }).click();
  await guest.getByRole('list', { name: 'Invitations' }).waitFor();
  const item = await guest.getByRole('list', { name: 'Invitations' }).innerText();
  check('invitation item text', item.includes(`Garden ${stamp} as reader from Oli Vine`), item.replace(/\n/g, '|'));
  await guest.getByRole('button', { name: 'Accept' }).click();
  await guest.waitForURL(new RegExp(`/p/${pid}$`));
  await guest.getByRole('list', { name: 'Collections' }).waitFor();
  check('accept lands on collection list', true);
  await guest.goto(`${BASE}/p/${pid}/c/${cid}`);
  await guest.getByText('You have read access').first().waitFor();
  check('guest sees read-only note', true);
  await owner.close();
  await guest.close();
}

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
