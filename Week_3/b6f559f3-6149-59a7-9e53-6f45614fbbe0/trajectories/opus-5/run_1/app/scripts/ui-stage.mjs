import { chromium } from '/tmp/node_modules/playwright/index.mjs';

const BASE = 'http://localhost:4173';
const KEY = process.env.GRADING_KEY;

const results = [];
const note = (label, ok, extra = '') => {
  results.push({ label, ok });
  if (!ok) console.log(`FAIL ${label} ${extra}`);
};

const grading = async (path) =>
  (await fetch(`${BASE}/api/grading/${path}`, { method: 'POST', headers: { 'X-Grading-Key': KEY } })).json();

await grading('reset');
const seed = await grading('seed');
const hero = seed.projects['Lumen hero'];
const phoneKit = seed.projects['Phone kit'];

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

await page.goto(`${BASE}/signin`);
await page.getByRole('textbox', { name: 'Email' }).fill('ines@lumenyard.test');
await page.getByRole('textbox', { name: 'Password' }).fill('halation-ines-01');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForTimeout(1500);

// DP-13 gizmo drag
await page.goto(`${BASE}/projects/${hero.id}`);
await page.waitForTimeout(2200);
await page.getByRole('treeitem', { name: 'Halo cube, Primitive' }).click();
await page.waitForTimeout(700);
const before = await page.locator('[data-readout="property"][data-path="position.x"]').first().textContent();
const moveX = page.getByRole('button', { name: 'Move along X' });
note('gizmo buttons', (await moveX.count()) === 1);
const box = await moveX.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(1800);
const after = await page.locator('[data-readout="property"][data-path="position.x"]').first().textContent();
note('gizmo drag moves 0.01 per pixel', after === 'Position X 1.500', `${before} -> ${after}`);

const rotateY = page.getByRole('button', { name: 'Rotate around Y' });
const rotateBox = await rotateY.boundingBox();
await page.mouse.move(rotateBox.x + rotateBox.width / 2, rotateBox.y + rotateBox.height / 2);
await page.mouse.down();
await page.keyboard.down('Shift');
await page.mouse.move(rotateBox.x + rotateBox.width / 2 + 60, rotateBox.y + rotateBox.height / 2, {
  steps: 5,
});
await page.keyboard.up('Shift');
await page.mouse.up();
await page.waitForTimeout(1800);
const rotation = await page.locator('[data-readout="property"][data-path="rotation.y"]').first().textContent();
note('shift rotate snaps to 15°', rotation === 'Rotation Y 75.000', rotation ?? '');

// DP-26 cursor tilt from the keyboard
await page.getByRole('switch', { name: 'Preview' }).click();
await page.waitForTimeout(400);
const stage = page.getByRole('group', { name: 'Stage' });
await stage.focus();
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(900);
const tiltTarget = await page.locator('[data-readout="tilt-target"]').first().textContent();
note('tilt target from the keyboard', tiltTarget === 'Tilt target 0.000, 4.800', tiltTarget ?? '');
const tiltY = await page.locator('[data-readout="tilt-y"]').first().textContent();
note('tilt counts toward the target', tiltY !== 'Tilt Y 0.000', tiltY ?? '');
await page.keyboard.press('Escape');
await page.waitForTimeout(1600);
const tiltBack = await page.locator('[data-readout="tilt-y"]').first().textContent();
note('tilt eases back when the pointer leaves', tiltBack === 'Tilt Y 0.000', tiltBack ?? '');

// DP-27 scroll orbit from the slider
await page.goto(`${BASE}/projects/${seed.projects['Orbit study'].id}`);
await page.waitForTimeout(2200);
await page.getByRole('treeitem', { name: 'Probe, Primitive' }).click();
await page.waitForTimeout(600);
const azimuthStart = await page.locator('[data-readout="camera-azimuth"]').first().textContent();
note('azimuth at rest', azimuthStart === 'Camera azimuth 0.000°', azimuthStart ?? '');
await page.getByRole('slider', { name: 'Scroll progress' }).fill('100');
await page.waitForTimeout(800);
const azimuthEnd = await page.locator('[data-readout="camera-azimuth"]').first().textContent();
note('azimuth follows the slider', azimuthEnd === 'Camera azimuth 90.000°', azimuthEnd ?? '');
const orbitPoint = await page.locator('[data-readout="screen-point"]').first().textContent();
note('orbited screen point', orbitPoint === '720.00, 211.99 px', orbitPoint ?? '');

// DP-43 drag reorder by pointer
await page.goto(`${BASE}/projects/${phoneKit.id}`);
await page.waitForTimeout(2200);
const names = async () =>
  page.locator('[data-layer-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
const orderBefore = await names();
const dragHandle = page.getByRole('button', { name: 'Drag Caption' });
const handleBox = await dragHandle.boundingBox();
const baseRow = page.locator('[data-layer-id]').last();
const baseBox = await baseRow.boundingBox();
await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
await page.mouse.down();
await page.mouse.move(baseBox.x + baseBox.width / 2, baseBox.y + baseBox.height - 4, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(1800);
const orderAfter = await names();
note(
  'drag handle reorders rows',
  orderAfter[orderAfter.length - 1] === 'Caption, Text' && JSON.stringify(orderBefore) !== JSON.stringify(orderAfter),
  JSON.stringify(orderAfter),
);

// Undo and redo through the header
await page.getByRole('button', { name: 'Undo' }).click();
await page.waitForTimeout(1800);
const undone = await names();
note('undo restores the order', JSON.stringify(undone) === JSON.stringify(orderBefore), JSON.stringify(undone));
const undoStatus = await page.getByRole('status', { name: 'Editor status' }).textContent();
note('undo status', undoStatus === 'Undone', undoStatus ?? '');
await page.getByRole('button', { name: 'Redo' }).click();
await page.waitForTimeout(1800);
const redone = await names();
note('redo reapplies', JSON.stringify(redone) === JSON.stringify(orderAfter), JSON.stringify(redone));
await page.getByRole('button', { name: 'Undo' }).click();
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Undo' }).click();
await page.waitForTimeout(1500);
const nothing = await page.getByRole('status', { name: 'Editor status' }).textContent();
note('nothing to undo', nothing === 'Nothing to undo', nothing ?? '');

// Variables and presets
await page.goto(`${BASE}/projects/${seed.projects['Variable room'].id}`);
await page.waitForTimeout(2200);
note('variables tablist', (await page.getByRole('tablist', { name: 'Variables and presets' }).count()) === 1);
note('vector fields', (await page.getByRole('spinbutton', { name: 'spin y' }).count()) === 1);
await page.getByRole('tab', { name: 'Presets' }).click();
await page.waitForTimeout(400);
note('apply preset button', (await page.getByRole('button', { name: 'Apply Lively' }).count()) === 1);
await page.getByRole('button', { name: 'Apply Lively' }).click();
await page.waitForTimeout(1800);
const presetStatus = await page.getByRole('status', { name: 'Editor status' }).textContent();
note('preset status', presetStatus === 'Applied Lively.', presetStatus ?? '');
await page.getByRole('tab', { name: 'Variables' }).click();
await page.waitForTimeout(600);
const spinY = await page.getByRole('spinbutton', { name: 'spin y' }).inputValue();
note('preset changed the variable', spinY === '90', spinY);

note('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((entry) => !entry.ok).length;
console.log(`${results.length - failed}/${results.length} stage checks passed`);
