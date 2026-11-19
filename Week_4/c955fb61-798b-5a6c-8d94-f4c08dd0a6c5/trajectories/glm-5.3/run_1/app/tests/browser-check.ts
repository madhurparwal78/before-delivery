// Browser checks for the published screens and interactions.

import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4173';

function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`);
  if (!ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (error) => {
    console.log('PAGE ERROR', error.message);
    process.exitCode = 1;
  });

  // Landing page.
  await page.goto(BASE + '/');
  await page.waitForSelector('.landing-hero');
  const hero = await page.textContent('h1');
  check('landing hero', hero !== null && hero.includes('Move one task.'));
  check('landing start link', (await page.locator('a[href="/signup"]').count()) === 1);
  check('landing demo region', (await page.locator('[aria-label="Demo plan"]').count()) === 1);

  // Sign in as Asha.
  await page.goto(BASE + '/signin');
  await page.fill('input[name="email"]', 'asha@slackwater.test');
  await page.fill('input[name="password"]', 'asha-plans-2027');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#new-project');
  const projectLinks = await page.$$eval('ul.projects-list a', (nodes) => nodes.map((n) => n.textContent));
  check('projects list sorted', JSON.stringify(projectLinks) === JSON.stringify(['Link examples', 'Office move', 'Spring launch']), JSON.stringify(projectLinks));

  // Open Spring launch.
  await page.click('text=Spring launch');
  await page.waitForSelector('#project-finish');
  const finish = await page.textContent('#project-finish');
  check('finish text', finish === 'Finishes Tue 16 Mar 2027', String(finish));
  const critical = await page.textContent('#critical-count');
  check('critical count', critical === '2 critical tasks', String(critical));

  // Focus the first bar: the bars are the chart's only tab stop after the toolbar.
  for (let i = 0; i < 12; i += 1) {
    const tag = await page.evaluate(() => document.activeElement?.getAttribute('data-item-id'));
    if (tag !== null) break;
    await page.keyboard.press('Tab');
  }
  const focusedBar = await page.evaluate(() => document.activeElement?.getAttribute('data-item-id'));
  check('bar focused', focusedBar !== null, String(focusedBar));

  // Knock-on: nudge Draft brief three ArrowRight presses, each after its own answer.
  const expectedStarts = ['Tue 2 Mar 2027', 'Wed 3 Mar 2027', 'Thu 4 Mar 2027'];
  for (const expected of expectedStarts) {
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(
      (text) => (document.getElementById('schedule-updates')?.textContent ?? '').includes(text),
      expected,
      { timeout: 8000 },
    );
    await page.waitForTimeout(400);
  }
  const schedule = await page.textContent('#schedule-updates');
  check(
    'nudge announcement',
    schedule === 'Draft brief now starts Thu 4 Mar 2027 and ends Mon 8 Mar 2027. 4 dependent tasks moved. Project finishes Wed 17 Mar 2027.',
    String(schedule),
  );
  const finishAfter = await page.textContent('#project-finish');
  check('finish after nudge', finishAfter === 'Finishes Wed 17 Mar 2027', String(finishAfter));

  // Move back.
  const backStarts = ['Wed 3 Mar 2027', 'Tue 2 Mar 2027', 'Mon 1 Mar 2027'];
  for (const expected of backStarts) {
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(
      (text) => (document.getElementById('schedule-updates')?.textContent ?? '').includes(text),
      expected,
      { timeout: 8000 },
    );
    await page.waitForTimeout(400);
  }
  const finishBack = await page.textContent('#project-finish');
  check('finish restored', finishBack === 'Finishes Tue 16 Mar 2027', String(finishBack));

  // List view by keyboard.
  await page.click('#tab-list');
  await page.waitForSelector('table.grid');
  const headers = await page.$$eval('th', (nodes) => nodes.map((n) => n.textContent));
  check(
    'list headers',
    JSON.stringify(headers) === JSON.stringify(['Row', 'Name', 'Start', 'End', 'Duration', 'Predecessors', 'Assignees', '% complete', 'Variance']),
    JSON.stringify(headers),
  );

  // Add task from the grid: the active cell starts on row 1's Name; move to the Add task row.
  const rows = page.locator('tr[data-item-id]');
  const addRow = page.locator('tr[data-add-row]');
  await addRow.locator('td').nth(1).click();
  await page.keyboard.type('Extra task');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (document.getElementById('schedule-updates')?.textContent ?? '').includes('added as row'), { timeout: 8000 });
  const added = await page.textContent('#schedule-updates');
  check('added announcement', added !== null && added.startsWith('Extra task added as row'), String(added));

  // Delete it again through Task details.
  await page.locator('tr[data-item-id]').last().locator('td').nth(6).click();
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog[aria-label="Task details"]');
  await page.click('#delete-task');
  await page.waitForFunction(() => (document.getElementById('schedule-updates')?.textContent ?? '').includes('deleted'), { timeout: 8000 });
  const deleted = await page.textContent('#schedule-updates');
  check('delete announcement', deleted === 'Extra task deleted.', String(deleted));

  // Workload view.
  await page.click('#tab-workload');
  await page.waitForSelector('table.workload-grid');
  const dayCells = await page.$$eval('.workload-grid td[data-date]', (nodes) => nodes.length);
  check('workload cells', dayCells > 0, String(dayCells));

  // Export CSV and PDF.
  await page.click('#tab-gantt');
  await page.click('#export-button');
  await page.click('text=Export CSV');
  await page.waitForFunction(() => (document.getElementById('export-status')?.textContent ?? '').endsWith('is ready to download.'), { timeout: 8000 });
  await page.click('#export-button');
  await page.click('text=Export PDF');
  await page.waitForFunction(() => (document.getElementById('export-status')?.textContent ?? '').includes('.pdf is ready to download.'), { timeout: 8000 });
  const exportStatus = await page.textContent('#export-status');
  check('export ready', exportStatus !== null && exportStatus.includes('.pdf is ready to download.'), String(exportStatus));
  const exportLinks = await page.$$eval('#exports-region a', (nodes) => nodes.map((n) => n.textContent));
  check('exports listed', exportLinks.length >= 2, String(exportLinks.length));

  await browser.close();
}

void main();
