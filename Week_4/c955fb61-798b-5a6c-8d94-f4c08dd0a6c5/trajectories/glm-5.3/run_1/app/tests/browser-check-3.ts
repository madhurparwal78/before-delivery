// Third browser pass: Task details, conflicts, presence selection, reorder and grouping.

import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4173';

function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`);
  if (!ok) process.exitCode = 1;
}

async function signIn(page: import('playwright').Page, email: string, password: string): Promise<void> {
  await page.goto(BASE + '/signin');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('#new-project');
}

async function openSpring(page: import('playwright').Page): Promise<void> {
  await page.click('text=Spring launch');
  await page.waitForSelector('#project-finish');
}

async function main(): Promise<void> {
  const browser = await chromium.launch();

  // --- Task details from Enter on a bar.
  const owner = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  owner.on('pageerror', (error) => {
    console.log('OWNER PAGE ERROR', error.message);
    process.exitCode = 1;
  });
  await signIn(owner, 'asha@slackwater.test', 'asha-plans-2027');
  await openSpring(owner);
  await owner.locator('.bar[aria-label^="Draft brief"]').click();
  await owner.keyboard.press('Enter');
  await owner.waitForSelector('dialog[aria-label="Task details"]');
  const nameValue = await owner.inputValue('dialog input[name="name"]');
  check('details opens with the name', nameValue === 'Draft brief', nameValue);
  const startValue = await owner.inputValue('dialog input[name="start"]');
  check('details shows the chosen start', startValue === '2027-03-01', startValue);
  const percentValue = await owner.inputValue('dialog input[name="percent"]');
  check('details shows the percent', percentValue === '20', percentValue);

  // Edit the percent and save.
  await owner.fill('dialog input[name="percent"]', '40');
  await owner.click('text=Save task');
  await owner.waitForFunction(() => (document.getElementById('schedule-updates')?.textContent ?? '').includes('saved'), { timeout: 8000 });
  const saved = await owner.textContent('#schedule-updates');
  check('save task announcement', saved === 'Draft brief saved.', String(saved));
  const groupPercent = await owner.textContent('#tab-gantt');
  void groupPercent;

  // --- Presence selection: another person's focused bar carries their name.
  const editor = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  editor.on('pageerror', (error) => {
    console.log('EDITOR PAGE ERROR', error.message);
    process.exitCode = 1;
  });
  await signIn(editor, 'ben@slackwater.test', 'ben-plans-2027');
  await openSpring(editor);
  await editor.locator('.bar[aria-label^="Design pages"]').click();
  await editor.waitForTimeout(2500);
  const selectedBy = await owner.getAttribute('.bar[aria-label^="Design pages"]', 'data-selected-by');
  check('selection carries the name', selectedBy === 'Ben Ode', String(selectedBy));

  // --- Task details keeps unsaved text through a pushed change.
  await owner.locator('.bar[aria-label^="Review brief"]').click();
  await owner.keyboard.press('Enter');
  await owner.waitForSelector('dialog[aria-label="Task details"]');
  await owner.fill('dialog input[name="name"]', 'Review the brief again');
  const reviewStartBefore = await owner.getAttribute('.bar[aria-label^="Review brief"]', 'data-start');
  await editor.locator('.bar[aria-label^="Review brief"]').click();
  await editor.keyboard.press('ArrowRight');
  await owner.waitForFunction(
    (previous) => document.querySelector('.bar[aria-label^="Review brief"]')?.getAttribute('data-start') !== previous,
    reviewStartBefore,
    { timeout: 8000 },
  );
  const keptName = await owner.inputValue('dialog input[name="name"]');
  check('dialog keeps its unsaved text', keptName === 'Review the brief again', keptName);

  // Save: the version moved underneath, so the first save is refused with the conflict notice.
  await owner.click('text=Save task');
  await owner.waitForFunction(() => (document.querySelector('#task-alert')?.textContent ?? '') !== '', { timeout: 8000 });
  const conflict = await owner.textContent('#task-alert');
  check(
    'conflict notice names who changed it',
    conflict === 'Ben Ode changed Review brief first. Your change was not saved.',
    String(conflict),
  );
  // The dialog takes the current values, so a second save succeeds.
  await owner.click('text=Save task');
  await owner.waitForFunction(() => document.querySelector('dialog[aria-label="Task details"]') === null, { timeout: 8000 });
  const afterConflict = await owner.textContent('#schedule-updates');
  check('second save succeeds', afterConflict === 'Review brief saved.', String(afterConflict));

  // --- Reorder and grouping in the list view.
  await owner.click('#tab-list');
  await owner.waitForSelector('table.grid');
  await owner.locator('tr[data-item-id]', { hasText: 'Draft brief' }).locator('td').nth(1).click();
  await owner.keyboard.press('Alt+ArrowDown');
  await owner.waitForFunction(() => (document.getElementById('schedule-updates')?.textContent ?? '').includes('moved to row'), { timeout: 8000 });
  const reorder = await owner.textContent('#schedule-updates');
  check('reorder announcement', reorder === 'Draft brief moved to row 3.', String(reorder));
  await owner.keyboard.press('Alt+ArrowUp');
  await owner.waitForFunction(() => (document.getElementById('schedule-updates')?.textContent ?? '') === 'Draft brief moved to row 2.', { timeout: 8000 });
  const back = await owner.textContent('#schedule-updates');
  check('reorder back announcement', back === 'Draft brief moved to row 2.', String(back));

  // Alt+ArrowRight does nothing (already in a group), Alt+ArrowLeft takes it out.
  await owner.keyboard.press('Alt+ArrowRight');
  await owner.waitForTimeout(1200);
  await owner.keyboard.press('Alt+ArrowLeft');
  await owner.waitForFunction(() => (document.getElementById('schedule-updates')?.textContent ?? '').includes('no longer in a group'), { timeout: 8000 });
  const outGroup = await owner.textContent('#schedule-updates');
  check('group out announcement', outGroup === 'Draft brief is no longer in a group.', String(outGroup));
  const rowNumbers = await owner.$$eval('tr[data-item-id] td:first-child', (nodes) => nodes.map((n) => n.textContent));
  check('rows renumbered without gaps', JSON.stringify(rowNumbers) === JSON.stringify(['1', '2', '3', '4', '5', '6']), JSON.stringify(rowNumbers));

  // --- Predecessors cell. Draft brief is now row 4 after the reorder above.
  await owner.locator('tr[data-item-id]', { hasText: 'Review brief' }).locator('td').nth(5).click();
  await owner.keyboard.type('4FS+1');
  await owner.keyboard.press('Enter');
  await owner.waitForFunction(() => (document.getElementById('page-alert')?.textContent ?? '') !== '' || (document.getElementById('schedule-updates')?.textContent ?? '').includes('Predecessors'), { timeout: 8000 });
  const pred = await owner.textContent('#schedule-updates');
  check('predecessors announcement', pred === 'Predecessors of Review brief set to 4FS+1.', String(pred));

  // A bad predecessor entry is refused with the first published message.
  await owner.locator('tr[data-item-id]', { hasText: 'Review brief' }).locator('td').nth(5).click();
  await owner.keyboard.type('99FS');
  await owner.keyboard.press('Enter');
  await owner.waitForFunction(() => (document.getElementById('page-alert')?.textContent ?? '') !== '', { timeout: 8000 });
  const badPred = await owner.textContent('#page-alert');
  check('bad predecessor message', badPred === 'There is no row 99.', String(badPred));

  await browser.close();
}

void main();
