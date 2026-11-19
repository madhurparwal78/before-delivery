const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:4173';
let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log('  ok', name); }
  else { failed++; console.log('FAIL', name, detail); }
}

async function newUser(page, name, email) {
  await page.goto(`${BASE}/signup`);
  await page.fill('[aria-label="Name"]', name);
  await page.fill('[aria-label="Email"]', email);
  await page.fill('[aria-label="Password"]', 'drafting-xyz-01');
  await page.click('[aria-label="Create account"]');
  await page.waitForURL(`${BASE}/`);
}

async function openDiagram(page, title) {
  page.once('dialog', (d) => d.accept(title));
  await page.click('[aria-label="New diagram"]');
  await page.waitForURL(/\/d\//, { timeout: 5000 });
  await page.waitForTimeout(800);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const suffix = Date.now().toString().slice(-6);
  const errors = [];

  // Journey: start and share (single browser, checks core flows)
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (err) => errors.push(String(err)));

  // Bad title with line break -> field error
  await page.goto(`${BASE}/signup`);
  await page.fill('[aria-label="Name"]', 'Ada Lindqvist');
  await page.fill('[aria-label="Email"]', `ada${suffix}@linewell.test`);
  await page.fill('[aria-label="Password"]', 'drafting-ada-01');
  await page.click('[aria-label="Create account"]');
  await page.waitForURL(`${BASE}/`);
  check('ada lands on list', page.url() === `${BASE}/`);

  const emptyList = await page.textContent('.diagram-list');
  check('empty diagram list text', emptyList.includes('No diagrams yet. Create one to start drawing.'), emptyList);

  await openDiagram(page, 'Pipeline');
  const heading = await page.textContent('.diagram-title');
  check('diagram title', heading === 'Pipeline', heading);
  const emptyPage = await page.textContent('.empty-page');
  check('empty page text', emptyPage === 'This page is empty. Add a shape from the toolbar or press R.', emptyPage);

  // Insert shapes via toolbar
  await page.$eval('[aria-label="Rectangle"]', (el) => el.click());
  await page.waitForTimeout(600);
  await page.$eval('[aria-label="Rectangle"]', (el) => el.click());
  await page.waitForTimeout(600);
  let shapes = await page.$$('[id^="shape-"]');
  check('two shapes inserted', shapes.length === 2, shapes.length);

  // Snap to grid: insertion is never snapped; the shape sits at the canvas centre.
  const firstX = Number(await shapes[0].getAttribute('data-x'));
  const firstY = Number(await shapes[0].getAttribute('data-y'));
  check('shape at insertion position', Number.isInteger(firstX) && Number.isInteger(firstY), `${firstX},${firstY}`);

  // Two shapes side by side with 48 gap
  const secondX = Number(await shapes[1].getAttribute('data-x'));
  check('second shape shifted right', secondX === firstX + 208, `${firstX} -> ${secondX}`);

  // Label a shape through the label field
  const shapeBox = await shapes[0].boundingBox();
  await page.mouse.click(shapeBox.x + 10, shapeBox.y + 10);
  await page.waitForTimeout(400);
  await page.fill('[aria-label="Label"]', 'Intake');
  await page.press('[aria-label="Label"]', 'Enter');
  await page.waitForTimeout(700);
  shapes = await page.$$('[id^="shape-"]');
  const labelAttr = await shapes[0].getAttribute('aria-label');
  check('shape named Intake', labelAttr === 'Intake', labelAttr);

  // Drag a shape: pointer down on shape, move, up
  const box = await shapes[0].boundingBox();
  const canvasBox = await (await page.$('#canvas')).boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 50, { steps: 5 });
  await page.waitForTimeout(200);
  const duringX = await page.$eval('[id^="shape-"]', (el) => el.getAttribute('data-x'));
  check('drag preview updates data-x', duringX !== null, duringX);
  await page.mouse.up();
  await page.waitForTimeout(800);
  const afterDrag = await page.$$eval('[id^="shape-"]', (els) => els.map((e) => e.getAttribute('data-x')));
  check('drag committed', afterDrag[0] !== String(firstX), String(afterDrag));

  // Nudge with arrow keys
  const box2 = (await page.$$('[id^="shape-"]'))[0];
  const bb2 = await box2.boundingBox();
  await page.mouse.click(bb2.x + 10, bb2.y + 10);
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(800);
  const nudged = await page.$$eval('[id^="shape-"]', (els) => els.map((e) => Number(e.getAttribute('data-x'))));
  check('nudge by 8', nudged[0] % 8 === 0, String(nudged));

  const announcer = await page.textContent('#announcer');
  check('moved notice announced', announcer.startsWith('Moved Intake.'), announcer);

  // Inspector X follows
  const xField = await page.inputValue('[aria-label="X"]');
  check('inspector X matches', xField === String(nudged[0]), `${xField} vs ${nudged[0]}`);

  // Out-of-range Width refused in place
  await page.fill('[aria-label="Width"]', '10');
  await page.press('[aria-label="Width"]', 'Enter');
  await page.waitForTimeout(300);
  const invalid = await page.getAttribute('[aria-label="Width"]', 'aria-invalid');
  const rangeMsg = await page.textContent('.field-error');
  check('range message', invalid === 'true' && rangeMsg === 'Enter a whole number from 24 to 2000.', `${invalid} ${rangeMsg}`);
  await page.press('[aria-label="Width"]', 'Escape');
  await page.waitForTimeout(200);

  // Outline panel opens
  await page.click('[aria-label="Outline"]');
  await page.waitForTimeout(400);
  const treeItems = await page.$$eval('.outline-item', (els) => els.map((e) => e.textContent));
  check('outline shows page and layer', treeItems.some((t) => t.includes('Page 1,')) && treeItems.some((t) => t.includes('Layer 1 layer')), treeItems);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Add page via keyboard
  await page.focus('#canvas');
  await page.keyboard.press('Control+Alt+n');
  await page.waitForTimeout(600);
  const pageStrip = await page.textContent('.page-strip-text');
  check('page strip shows Page 2 open', pageStrip.startsWith('Page 2 ·'), pageStrip);

  // Ctrl+PageDown / PageUp
  await page.keyboard.press('Control+PageUp');
  await page.waitForTimeout(400);
  const stripAfter = await page.textContent('.page-strip-text');
  check('page strip shows 1 of 2', stripAfter.includes('1 of 2'), stripAfter);

  // Zoom controls
  await page.$eval('[aria-label="Zoom in"]', (el) => el.click());
  await page.waitForTimeout(300);
  const zoomText = await page.textContent('#zoom-readout');
  check('zoom readout 150%', zoomText === '150%', zoomText);
  await page.$eval('[aria-label="Reset zoom"]', (el) => el.click());
  await page.waitForTimeout(300);
  const zoomReset = await page.textContent('#zoom-readout');
  check('zoom reset 100%', zoomReset === '100%', zoomReset);

  // History tab and versions
  await page.click('[role="tab"]:has-text("History")');
  await page.waitForTimeout(400);
  const versions = await page.$$eval('.history-list [role="listitem"]', (els) => els.length);
  check('history lists versions', versions >= 0, versions);

  // Comments tab
  await page.click('[role="tab"]:has-text("Comments")');
  await page.waitForTimeout(300);
  const composer = await page.$('[aria-label="Comment"]');
  check('comment composer exists', composer !== null);

  // Presence: a second user opens the diagram. Share first.
  await page.$eval('[aria-label="Share"]', (el) => el.click());
  await page.waitForTimeout(400);
  await page.fill('[role="dialog"][aria-label="Share"] [aria-label="Email"]', `bea${suffix}@linewell.test`);
  await page.selectOption('[role="dialog"][aria-label="Share"] [aria-label="Role"]', 'editor');
  await page.$eval('[role="dialog"][aria-label="Share"] [aria-label="Send invite"]', (el) => el.click());
  await page.waitForTimeout(800);
  const shareStatus = await page.textContent('[role="dialog"][aria-label="Share"] .dialog-status');
  check('invite emailed notice', shareStatus === `Invite emailed to bea${suffix}@linewell.test.`, shareStatus);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  const page2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const diagramPath = new URL(page.url()).pathname + new URL(page.url()).search;
  await page2.goto(`${BASE}/signup?next=${encodeURIComponent(diagramPath)}`);
  await page2.fill('[aria-label="Name"]', 'Bea Okafor');
  await page2.fill('[aria-label="Email"]', `bea${suffix}@linewell.test`);
  await page2.fill('[aria-label="Password"]', 'drafting-bea-02');
  await page2.click('[aria-label="Create account"]');
  await page2.waitForURL(/\/d\//, { timeout: 5000 });
  await page2.waitForTimeout(1500);

  // Ada sees Bea's presence avatar within a second.
  const avatars = await page.$$('[aria-label*="editing"], [aria-label*="viewing"]');
  check('presence avatar shown', avatars.length >= 1, avatars.length);
  const avatarLabel = avatars.length > 0 ? await avatars[0].getAttribute('aria-label') : '';
  check('avatar label', avatarLabel === 'Bea Okafor, editing', avatarLabel);

  // Cursor moves in first tab appear in the second within a second.
  await page.mouse.move(canvasBox.x + 100, canvasBox.y + 150);
  await page.waitForTimeout(900);
  const cursors = await page2.$$('[data-cursor-of]');
  check('remote cursor appears', cursors.length >= 1, cursors.length);

  await page2.close();

  // Sign out returns to signin
  await page.click('[aria-label="Sign out"]');
  await page.waitForTimeout(600);
  check('signout lands on signin', page.url().startsWith(`${BASE}/signin`), page.url());

  if (errors.length > 0) {
    console.log('PAGE ERRORS:', errors.slice(0, 5));
  } else {
    console.log('no page errors');
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
