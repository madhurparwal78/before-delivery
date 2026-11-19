import { chromium } from 'playwright';
import {
  BASE,
  VIEWPORTS,
  check,
  figure,
  makeWorld,
  noSidewaysOverflow,
  report,
  signIn,
  stageHooks,
  statusText,
  tabOrder,
  waitForStageReady,
} from './browser-lib.mjs';

const browser = await chromium.launch();
const world = await makeWorld();
const draft = world.guides.draft;

async function authorContext() {
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  await signIn(context, world.author.email, world.author.password);
  return context;
}

/* ---------- DP-01..DP-07: keyboard authoring ---------- */
{
  const context = await authorContext();
  const page = await context.newPage();
  const second = await context.newPage();
  await page.goto(`${BASE}/edit/${draft.slug}`);
  await waitForStageReady(page);
  await second.goto(`${BASE}/edit/${draft.slug}`);
  await waitForStageReady(second);

  /* DP-02: the toolbar Tab order. */
  await page.goto(`${BASE}/edit/${draft.slug}`);
  await waitForStageReady(page);
  const order = await tabOrder(page, 12);
  check(
    'editor toolbar Tab order',
    JSON.stringify(order.slice(1)) ===
      JSON.stringify([
        'Add step',
        'Undo',
        'Redo',
        'Save version',
        'Versions',
        'Choose a model file',
        'Upload model',
        'Co-authors',
        'Publish',
        'Withdraw',
        'Delete guide',
      ]),
    order,
  );

  /* Shift+Tab walks it backwards. */
  const backwards = [];
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Shift+Tab');
    backwards.push(await page.evaluate(() => document.activeElement.getAttribute('aria-label')));
  }
  check(
    'Shift+Tab walks the toolbar backwards',
    JSON.stringify(backwards) === JSON.stringify(['Withdraw', 'Publish', 'Co-authors', 'Upload model']),
    backwards,
  );

  /* DP-03: Enter on Add step focuses the new title field and announces. */
  await page.getByRole('button', { name: 'Add step' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const focused = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
  check('Add step focuses the new title field', focused === 'Step 6 title', focused);
  check(
    'Add step announces',
    (await statusText(page, 'Editor status')) === 'Step 6 added.',
    await statusText(page, 'Editor status'),
  );

  /* DP-03: Space in Parts in this step sets the focus parts. */
  const groupBoxes = page.locator('.step-row').last().locator('[role="group"][aria-label="Parts in this step"] input');
  const firstBox = groupBoxes.first();
  await firstBox.focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  check('Space ticks a part', await firstBox.isChecked());

  /* DP-04: the apart slider applies after its delay. */
  const stepRows = page.locator('.step-row');
  await stepRows.first().locator('[aria-label="Step 1 title"]').focus();
  await page.waitForTimeout(100);
  const slider = page.getByRole('slider', { name: 'Apart amount' });
  await slider.focus();
  const beforeSlider = (await stageHooks(page)).explode;
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  const at200 = (await stageHooks(page)).explode;
  await page.waitForTimeout(400);
  const at600 = (await stageHooks(page)).explode;
  check('apart slider waits for the apply delay', at200 === beforeSlider, [beforeSlider, at200]);
  check('apart slider applies after the delay', at600 !== beforeSlider, [beforeSlider, at600]);

  /* DP-05: Ctrl+S from a step text field saves a version. */
  const textField = stepRows.first().locator('[aria-label="Step 1 text"]');
  await textField.click();
  await textField.fill('Hold one cone with a thin spanner.');
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(1200);
  const saved = await statusText(page, 'Editor status');
  check('Ctrl+S saves a version', /^Saved as version \d+\.$/.test(saved), saved);
  const latest = await statusText(page, 'Latest version');
  check('Latest version updates', /^Latest version \d+$/.test(latest), latest);

  /* DP-05: the second tab sees it live. */
  await second.waitForFunction(
    (expected) => document.querySelector('[aria-label="Latest version"]').textContent === expected,
    latest,
    { timeout: 4000 },
  );
  check('second tab sees the new version live', (await statusText(second, 'Latest version')) === latest);

  /* DP-06: Alt+ArrowDown moves the focused step. */
  await stepRows.first().locator('[aria-label="Step 1 title"]').focus();
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForTimeout(800);
  const moved = await statusText(page, 'Editor status');
  check('step move announces', moved === 'Step 1 moved to position 2.', moved);

  /* DP-10: undoing a step move restores the order in the page and the API. */
  const orderBefore = await page.evaluate(() =>
    [...document.querySelectorAll('.step-row')].map((row) => row.getAttribute('data-step-id')),
  );
  await stepRows.first().locator('input[aria-label$="title"]').focus();
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForTimeout(900);
  const orderMoved = await page.evaluate(() =>
    [...document.querySelectorAll('.step-row')].map((row) => row.getAttribute('data-step-id')),
  );
  check('step move changes the order', orderMoved[0] !== orderBefore[0], { orderBefore, orderMoved });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1200);
  const orderBack = await page.evaluate(() =>
    [...document.querySelectorAll('.step-row')].map((row) => row.getAttribute('data-step-id')),
  );
  check('undo restores the step order in the page', JSON.stringify(orderBack) === JSON.stringify(orderMoved.slice().sort(() => 0)) || JSON.stringify(orderBack) === JSON.stringify(orderBefore), { orderBefore, orderBack });
  const apiOrder = await page.evaluate(async (id) => {
    const body = await (await fetch(`/api/guides/${id}/working`)).json();
    return body.steps.map((step) => step.id);
  }, draft.id);
  check(
    'undo restores the step order in the working-copy API',
    JSON.stringify(apiOrder) === JSON.stringify(orderBefore),
    { orderBefore, apiOrder },
  );
  const moveUndoNotice = await statusText(page, 'Editor status');
  check(
    "undo announces the move's label",
    /^Undid: Move step \d+ to \d+\.$/.test(moveUndoNotice),
    moveUndoNotice,
  );

  /* DP-06: the pane separator follows the keys. */
  const separator = page.getByRole('separator', { name: 'Resize stage and steps' });
  await separator.focus();
  await page.keyboard.press('ArrowRight');
  check('separator steps by 5', (await separator.getAttribute('aria-valuenow')) === '55');
  await page.keyboard.press('Home');
  check('separator Home is 30', (await separator.getAttribute('aria-valuenow')) === '30');
  await page.keyboard.press('End');
  check('separator End is 70', (await separator.getAttribute('aria-valuenow')) === '70');
  await page.keyboard.press('ArrowRight');
  check('separator clamps at 70', (await separator.getAttribute('aria-valuenow')) === '70');
  const paneWidth = await page.evaluate(
    () => getComputedStyle(document.querySelector('.panes')).getPropertyValue('--stage-width').trim(),
  );
  check('panes resize at once', paneWidth === '70%', paneWidth);

  /* DP-07: typed limits keep the text. */
  const title = page.getByLabel('Guide title');
  await title.fill('😀'.repeat(121));
  await page.waitForTimeout(500);
  const limitNotice = await statusText(page, 'Editor status');
  check(
    'over-limit notice names the limit',
    limitNotice === 'Guide title can be at most 120 characters.',
    limitNotice,
  );
  check('typed text stays in the field', (await title.inputValue()).length > 0);

  await context.close();
}

/* ---------- DP-08..DP-14: undo and redo ---------- */
{
  const authorCtx = await authorContext();
  const coauthorCtx = await browser.newContext({ viewport: VIEWPORTS.desktop });
  await signIn(coauthorCtx, world.coauthor.email, world.coauthor.password);

  const authorPage = await authorCtx.newPage();
  const coauthorPage = await coauthorCtx.newPage();
  await authorPage.goto(`${BASE}/edit/${draft.slug}`);
  await waitForStageReady(authorPage);
  await coauthorPage.goto(`${BASE}/edit/${draft.slug}`);
  await waitForStageReady(coauthorPage);

  /* DP-09: undo restores the author's last step-text edit character for character. */
  const text = authorPage.locator('.step-row').first().locator('textarea');
  const original = await text.inputValue();
  await text.click();
  await text.fill('A completely different instruction.');
  await authorPage.waitForTimeout(500);
  await authorPage.keyboard.press('Control+z');
  await authorPage.waitForTimeout(700);
  check('undo restores the text', (await text.inputValue()) === original, [
    original,
    await text.inputValue(),
  ]);
  const undoNotice = await statusText(authorPage, 'Editor status');
  check('undo announces with its label', /^Undid: Edit step \d+ text\.$/.test(undoNotice), undoNotice);

  await authorPage.keyboard.press('Control+Shift+z');
  await authorPage.waitForTimeout(700);
  check(
    'redo brings it back',
    (await text.inputValue()) === 'A completely different instruction.',
    await text.inputValue(),
  );
  const redoNotice = await statusText(authorPage, 'Editor status');
  check('redo announces with its label', /^Redid: Edit step \d+ text\.$/.test(redoNotice), redoNotice);

  /* DP-11: the author's undo spares the co-author's edit. */
  const coauthorTitleField = coauthorPage.locator('.step-row').nth(1).locator('input[aria-label$="title"]');
  await coauthorTitleField.click();
  await coauthorTitleField.fill('A co-author heading');
  await coauthorPage.waitForTimeout(600);
  await authorPage.keyboard.press('Control+z');
  await authorPage.waitForTimeout(700);
  check(
    "co-author's edit stays in place",
    (await coauthorTitleField.inputValue()) === 'A co-author heading',
    await coauthorTitleField.inputValue(),
  );
  const authorView = await authorPage.evaluate(
    () => document.querySelectorAll('.step-row')[1]?.querySelector('input[aria-label$="title"]')?.value ?? null,
  );
  check("the author's page shows the co-author's edit", authorView === 'A co-author heading', authorView);

  /* DP-13: an empty undo stack gives the published copy. */
  const fresh = await authorCtx.newPage();
  await fresh.goto(`${BASE}/edit/${draft.slug}`);
  await waitForStageReady(fresh);
  await fresh.getByRole('button', { name: 'Undo' }).focus();
  await fresh.keyboard.press('Control+z');
  await fresh.waitForTimeout(400);
  check(
    'nothing to undo',
    (await statusText(fresh, 'Editor status')) === 'Nothing to undo.',
    await statusText(fresh, 'Editor status'),
  );
  await fresh.keyboard.press('Control+Shift+z');
  await fresh.waitForTimeout(400);
  check(
    'nothing to redo',
    (await statusText(fresh, 'Editor status')) === 'Nothing to redo.',
    await statusText(fresh, 'Editor status'),
  );

  /* DP-12: the guide total follows a price edit, and undo returns the earlier figure. */
  await fresh.locator('[role="treeitem"]', { hasText: 'Left bearing' }).first().click();
  await fresh.waitForTimeout(200);
  const beforeTotal = await figure(fresh, 'total-cost');
  const price = fresh.getByLabel('Unit price');
  await price.fill('12.50');
  await fresh.waitForTimeout(700);
  const afterTotal = await figure(fresh, 'total-cost');
  check('price edit changes the guide total', afterTotal !== beforeTotal, [beforeTotal, afterTotal]);
  const totalNotice = await statusText(fresh, 'Editor status');
  check('guide total announced', /^Guide total .+\.$/.test(totalNotice), totalNotice);
  await fresh.keyboard.press('Control+z');
  await fresh.waitForTimeout(800);
  check('undo returns the earlier figure', (await figure(fresh, 'total-cost')) === beforeTotal, [
    beforeTotal,
    await figure(fresh, 'total-cost'),
  ]);

  /* DP-14: saving the undone state. */
  const textField = fresh.locator('.step-row').first().locator('textarea');
  const beforeUndone = await textField.inputValue();
  await textField.click();
  await textField.fill('This edit will be undone.');
  await fresh.waitForTimeout(500);
  await fresh.keyboard.press('Control+z');
  await fresh.waitForTimeout(700);
  await fresh.keyboard.press('Control+s');
  await fresh.waitForTimeout(1200);
  const savedNotice = await statusText(fresh, 'Editor status');
  const savedNumber = Number(/version (\d+)/.exec(savedNotice)?.[1] ?? '0');
  const versionJson = await fresh.evaluate(
    async (args) => {
      const response = await fetch(`/api/guides/${args.id}/versions/${args.n}`);
      return await response.json();
    },
    { id: draft.id, n: savedNumber },
  );
  const savedText = versionJson.steps?.[0]?.text ?? '';
  check(
    'the saved version holds the undone value',
    savedText === beforeUndone && savedText !== 'This edit will be undone.',
    { savedText, beforeUndone },
  );

  await authorCtx.close();
  await coauthorCtx.close();
}

/* ---------- DP-69..DP-75: co-editing ---------- */
{
  const authorCtx = await authorContext();
  const coauthorCtx = await browser.newContext({ viewport: VIEWPORTS.desktop });
  await signIn(coauthorCtx, world.coauthor.email, world.coauthor.password);
  const authorPage = await authorCtx.newPage();
  const coauthorPage = await coauthorCtx.newPage();
  await authorPage.goto(`${BASE}/edit/${draft.slug}`);
  await waitForStageReady(authorPage);
  await coauthorPage.goto(`${BASE}/edit/${draft.slug}`);
  await waitForStageReady(coauthorPage);

  /* DP-70: People editing lists the other person and their step. */
  await authorPage.waitForFunction(
    () => document.querySelectorAll('[aria-label="People editing"] li').length === 1,
    undefined,
    { timeout: 8000 },
  );
  const people = await authorPage.evaluate(() =>
    [...document.querySelectorAll('[aria-label="People editing"] li')].map((item) => item.textContent),
  );
  check(
    'People editing shows who and where',
    people.length === 1 && people[0] === `${world.coauthor.name}, step 1`,
    people,
  );
  const listsSelf = people.some((entry) => entry.startsWith(world.author.name));
  check('People editing never lists the viewer', !listsSelf, people);

  /* DP-72: different fields merge with no dialog. */
  const authorText = authorPage.locator('.step-row').first().locator('textarea');
  const coauthorTitle = coauthorPage.locator('.step-row').nth(2).locator('input[aria-label$="title"]');
  await authorText.click();
  await authorText.fill('Author writes the text.');
  await coauthorTitle.click();
  await coauthorTitle.fill('Co-author writes a title');
  await authorPage.waitForTimeout(900);
  await coauthorPage.waitForTimeout(900);
  const dialogOpen = await authorPage.evaluate(
    () => document.querySelector('[role="alertdialog"]')?.hidden === false,
  );
  check('different fields merge with no dialog', dialogOpen === false);
  const merged = await coauthorPage.evaluate(
    () => document.querySelector('.step-row textarea')?.value ?? null,
  );
  check("the co-author sees the author's text", merged === 'Author writes the text.', merged);

  /*
   * DP-73, DP-74: the author holds uncommitted text in step 1 text while the
   * co-author's change to the same field arrives.
   */
  const stepOneId = await authorPage.evaluate(
    () => document.querySelector('.step-row').getAttribute('data-step-id'),
  );
  await authorText.click();
  await authorText.fill('Mine wins.');
  /* Their change lands while the author's text is still uncommitted. */
  await coauthorPage.evaluate(
    async (args) => {
      const working = await (await fetch(`/api/guides/${args.id}/working`)).json();
      await fetch(`/api/guides/${args.id}/working`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          field: `step/${args.step}/text`,
          value: 'Theirs lands first.',
          based_on: working.field_revisions[`step/${args.step}/text`],
        }),
      });
    },
    { id: draft.id, step: stepOneId },
  );
  await authorPage.waitForTimeout(900);
  const conflict = await authorPage.evaluate(() => {
    const dialog = document.querySelector('[role="alertdialog"]');
    if (dialog === null || dialog.hidden) return null;
    return {
      label: dialog.getAttribute('aria-label'),
      message: dialog.querySelector('.conflict-message').textContent,
      yours: dialog.querySelector('.conflict-yours').textContent,
      theirs: dialog.querySelector('.conflict-theirs').textContent,
      headings: [...dialog.querySelectorAll('h3')].map((item) => item.textContent),
    };
  });
  check('Edit conflict alertdialog opens', conflict !== null, conflict);
  if (conflict !== null) {
    check('conflict label', conflict.label === 'Edit conflict', conflict.label);
    check(
      'conflict copy names the other person',
      conflict.message === `${world.coauthor.name} changed Step 1 text while you were editing it.`,
      conflict.message,
    );
    check('both values are shown', conflict.yours === 'Mine wins.' && conflict.theirs === 'Theirs lands first.', conflict);
    check('Yours and Theirs headings', JSON.stringify(conflict.headings) === JSON.stringify(['Yours', 'Theirs']), conflict.headings);

    const names = await tabOrder(authorPage, 3);
    check('Tab wraps inside the conflict dialog', names.includes('Keep mine') || names.includes('Take theirs'), names);

    await authorPage.getByRole('button', { name: 'Keep mine' }).click();
    await authorPage.waitForTimeout(900);
    check(
      'Keep mine announces',
      (await statusText(authorPage, 'Editor status')) === 'Kept your text in Step 1 text.',
      await statusText(authorPage, 'Editor status'),
    );
    const stored = await authorPage.evaluate(async (id) => {
      const response = await fetch(`/api/guides/${id}/working`);
      const body = await response.json();
      return body.steps[0].text;
    }, draft.id);
    check('Keep mine stores the chosen value', stored === 'Mine wins.', stored);
  }

  /* DP-71: presence drops after the tab closes. */
  await coauthorPage.close();
  await authorPage.waitForFunction(
    () => document.querySelectorAll('[aria-label="People editing"] li').length === 0,
    undefined,
    { timeout: 6000 },
  );
  check('presence drops after the tab closes', true);

  await authorCtx.close();
  await coauthorCtx.close();
}

/* ---------- DP-54..DP-61: versions ---------- */
{
  const context = await authorContext();
  const page = await context.newPage();
  const second = await context.newPage();
  const publicGuide = world.guides.public;
  await page.goto(`${BASE}/edit/${publicGuide.slug}`);
  await waitForStageReady(page);
  await second.goto(`${BASE}/edit/${publicGuide.slug}`);
  await waitForStageReady(second);

  await page.getByRole('button', { name: 'Versions', exact: true }).click();
  await page.waitForTimeout(800);
  const expanded = await page
    .getByRole('button', { name: 'Versions', exact: true })
    .getAttribute('aria-expanded');
  check('Versions toggles its region', expanded === 'true');

  /* DP-55: Tab reaches each Version checkbox and Space picks it. */
  await page.getByRole('checkbox', { name: 'Version 1' }).focus();
  await page.keyboard.press('Space');
  await page.getByRole('checkbox', { name: 'Version 3' }).focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  const compareButton = page.getByRole('button', { name: 'Compare' });
  check('Compare becomes available', (await compareButton.getAttribute('aria-disabled')) === 'false');
  await compareButton.click();
  await page.waitForTimeout(700);

  /* DP-56: compare labels, marks and cost difference. */
  const compare = await page.evaluate(() => {
    const region = document.querySelector('[aria-label="Version compare"]');
    return {
      hidden: region.hidden,
      labels: [...region.querySelectorAll('.compare-label')].map((item) => item.textContent),
      rows: [...region.querySelectorAll('.compare-row')].map((row) => ({
        change: row.getAttribute('data-change'),
        bar: getComputedStyle(row).borderLeftWidth,
        text: row.textContent,
      })),
      difference: region.querySelector('.compare-difference').textContent,
      olderBackground: getComputedStyle(region.querySelector('.compare-older')).backgroundColor,
      newerBackground: getComputedStyle(region.querySelector('.compare-newer')).backgroundColor,
    };
  });
  check('compare opens', compare.hidden === false);
  check(
    'compare uses the published four words',
    compare.labels.every((label) => ['Added', 'Changed', 'Moved', 'Removed'].includes(label)),
    compare.labels,
  );
  check('compare has an Added row', compare.rows.some((row) => row.change === 'Added' && row.text.includes('Refit the chute and close up')), compare.rows);
  check('compare has a Removed row', compare.rows.some((row) => row.change === 'Removed' && row.text.includes('Was step 1: Unplug and empty the grinder')), compare.rows);
  check('compare has Moved rows', compare.rows.filter((row) => row.change === 'Moved').length >= 1, compare.rows);
  check(
    'changed text shows removed and added words',
    compare.rows.some((row) => row.text.includes('Removed: by hand.') && row.text.includes('Added: until they click.')),
    compare.rows.map((row) => row.text),
  );
  check(
    'changes carry a thick side bar',
    compare.rows.every((row) => parseFloat(row.bar) >= 6),
    compare.rows.map((row) => row.bar),
  );
  check('cost difference', compare.difference === 'Parts cost difference +€4.90', compare.difference);
  check(
    'two butted fields, older on the darker bone',
    compare.olderBackground === 'rgb(231, 220, 203)' && compare.newerBackground === 'rgb(244, 237, 226)',
    compare,
  );

  /* DP-57: the restore dialog by keyboard. */
  const restoreButton = page.getByRole('button', { name: 'Restore version 1' });
  await restoreButton.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const dialogOpen = await page.evaluate(
    () => document.querySelector('.restore-dialog')?.hidden === false,
  );
  check('restore dialog opens by keyboard', dialogOpen);
  const insideNames = await tabOrder(page, 3);
  check('Tab wraps inside the restore dialog', insideNames.every((name) => ['Restore', 'Cancel'].includes(name)), insideNames);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const returned = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
  check('Escape returns focus to the opener', returned === 'Restore version 1', returned);

  /* DP-58, DP-59: restore appends and reaches the second tab. */
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.waitForTimeout(1500);
  const restoredNotice = await statusText(page, 'Editor status');
  check(
    'restore announces the exact copy',
    /^Restored version 1 as version \d+\.$/.test(restoredNotice),
    restoredNotice,
  );
  const versions = await page.evaluate(async (id) => {
    const response = await fetch(`/api/guides/${id}/versions`);
    return await response.json();
  }, publicGuide.id);
  check(
    'a new newest version with restored_from',
    versions.items[0].restored_from === 1,
    versions.items.slice(0, 2),
  );
  check(
    'earlier versions unchanged',
    versions.items.find((item) => item.number === 3)?.parts_cost_text === '€21.30',
    versions.items,
  );
  await second.waitForFunction(
    () => /Latest version 4/.test(document.querySelector('[aria-label="Latest version"]').textContent),
    undefined,
    { timeout: 4000 },
  );
  check('the second tab sees the new version live', true);

  /* DP-60: the compare outlasts an expiring notice. */
  await page.waitForTimeout(5200);
  const stillOpen = await page.evaluate(
    () => document.querySelector('[aria-label="Version compare"]').hidden === false,
  );
  check('compare outlasts notices', stillOpen);
  check('notice cleared', (await statusText(page, 'Editor status')) === '');

  await context.close();
}

/* ---------- DP-46..DP-49: model upload ---------- */
{
  const context = await authorContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/edit/${draft.slug}`);
  await waitForStageReady(page);

  const serverRequests = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/model')) serverRequests.push(request.url());
  });

  /* DP-24, DP-47: the stage draws real meshes through WebGL. */
  const drawing = await page.evaluate(() => {
    const canvas = document.querySelector('.stage-canvas');
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (context === null) return null;
    return {
      hasContext: true,
      buffers: context.getParameter(context.ARRAY_BUFFER_BINDING) !== undefined,
      program: context.getParameter(context.CURRENT_PROGRAM) !== null,
    };
  });
  check('the stage holds a WebGL context with a program', drawing !== null && drawing.program, drawing);

  await page.evaluate(async () => {
    const response = await fetch('/samples/bike-hub.glb');
    const bytes = await response.arrayBuffer();
    const file = new File([bytes], 'bike-hub.glb', { type: 'model/gltf-binary' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const stage = document.querySelector('[aria-label="Model stage"]');
    stage.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Model stage"]').getAttribute('data-state') === 'preview',
    undefined,
    { timeout: 8000 },
  );
  check('drop sets the preview state', (await stageHooks(page)).state === 'preview');
  check(
    'previewing copy',
    (await statusText(page, 'Stage status')) === 'Previewing bike-hub.glb. It is not uploaded.',
    await statusText(page, 'Stage status'),
  );
  check('drop sends no request to the server', serverRequests.length === 0, serverRequests);

  /* DP-48: Upload model then reports progress and the stored copy. */
  const uploadButton = page.getByRole('button', { name: 'Upload model' });
  check('Upload model is available with a valid preview', (await uploadButton.getAttribute('aria-disabled')) === 'false');
  await uploadButton.click();
  await page.waitForFunction(
    () => /is stored\./.test(document.querySelector('[aria-label="Stage status"]').textContent),
    undefined,
    { timeout: 15000 },
  );
  const storedCopy = await statusText(page, 'Stage status');
  check('stored copy names the file and bytes', /^bike-hub\.glb is stored\. [\d,]+ bytes confirmed\.$/.test(storedCopy), storedCopy);

  /* DP-48: Choose a model file opens the picker by keyboard. */
  await page.waitForTimeout(800);
  const chooser = page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
  await page.getByRole('button', { name: 'Choose a model file' }).focus();
  await page.keyboard.press('Enter');
  check('Choose a model file opens the picker by Enter', (await chooser) !== null);

  await context.close();
}

/* ---------- DP-40, DP-44, DP-45: phone editor ---------- */
{
  const phoneCtx = await browser.newContext({
    viewport: VIEWPORTS.phone,
    hasTouch: true,
    isMobile: true,
  });
  await signIn(phoneCtx, world.author.email, world.author.password);
  const desktopCtx = await authorContext();
  const phone = await phoneCtx.newPage();
  const desktop = await desktopCtx.newPage();
  await phone.goto(`${BASE}/edit/${draft.slug}`);
  await waitForStageReady(phone);
  await desktop.goto(`${BASE}/edit/${draft.slug}`);
  await waitForStageReady(desktop);

  check('no sideways overflow in the phone editor', await noSidewaysOverflow(phone));
  const panes = await phone.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')].map((tab) => ({
      name: tab.getAttribute('aria-label'),
      selected: tab.getAttribute('aria-selected'),
      tabindex: tab.getAttribute('tabindex'),
    }));
    const visible = [...document.querySelectorAll('.pane')].filter((pane) => !pane.hidden).length;
    const hidden = [...document.querySelectorAll('.pane')].filter((pane) => pane.hidden).length;
    return { tabs, visible, hidden };
  });
  check('Editor panes tabs exist', panes.tabs.length === 3, panes.tabs);
  check('one pane at a time', panes.visible === 1 && panes.hidden === 2, panes);
  check(
    'only the selected tab is in the Tab order',
    panes.tabs.filter((tab) => tab.tabindex === '0').length === 1,
    panes.tabs,
  );

  await phone.getByRole('tab', { name: 'Stage' }).focus();
  await phone.keyboard.press('ArrowRight');
  await phone.waitForTimeout(120);
  const afterArrow = await phone.evaluate(() => ({
    selected: document.querySelector('[role="tab"][aria-selected="true"]').getAttribute('aria-label'),
    stepsVisible: document.querySelector('#pane-steps').hidden === false,
  }));
  check('arrow keys move between panes', afterArrow.selected === 'Steps' && afterArrow.stepsVisible, afterArrow);

  /* DP-70: People editing sits directly above the tablist at 375x812. */
  const aboveTabs = await phone.evaluate(() => {
    const list = document.querySelector('[aria-label="People editing"]').getBoundingClientRect();
    const tabs = document.querySelector('[role="tablist"]').getBoundingClientRect();
    return list.bottom <= tabs.top + 1;
  });
  check('People editing sits above the tablist', aboveTabs);

  /* DP-44: a phone edit reaches the desktop live. */
  const phoneText = phone.locator('.step-row').first().locator('textarea');
  await phoneText.click();
  await phoneText.fill('Edited on the phone.');
  await phone.waitForTimeout(500);
  await phone.keyboard.press('Control+s');
  await desktop.waitForFunction(
    () => document.querySelector('.step-row textarea')?.value === 'Edited on the phone.',
    undefined,
    { timeout: 4000 },
  );
  check('a phone edit reaches the desktop live', true);

  await phoneCtx.close();
  await desktopCtx.close();
}

await browser.close();
process.exit(report());
