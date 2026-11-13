import { chromium } from '/tmp/node_modules/playwright/index.mjs';

const BASE = 'http://localhost:4173';
const KEY = process.env.GRADING_KEY;

async function grading(path, body) {
  const response = await fetch(`${BASE}/api/grading/${path}`, {
    method: 'POST',
    headers: { 'X-Grading-Key': KEY, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json();
}

await grading('reset');
const seed = await grading('seed');

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const results = [];
const note = (label, ok, extra = '') => {
  results.push({ label, ok, extra });
  if (!ok) console.log(`FAIL ${label} ${extra}`);
};

const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const errors = [];
context.on('weberror', (error) => errors.push(error.error().message));
const page = await context.newPage();
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('response', (response) => {
  if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
});

// Landing
await page.goto(BASE);
await page.waitForTimeout(1200);
note('banner', (await page.getByRole('banner').count()) === 1);
note('home link', (await page.getByRole('link', { name: 'Halation Studio home' }).count()) === 1);
note('stage region', (await page.getByRole('region', { name: 'Follow Light stage' }).count()) === 1);
note('headline', (await page.getByRole('heading', { level: 1, name: 'Scenes that hold their shape' }).count()) === 1);
note('pill link', (await page.getByRole('link', { name: 'New Republish any version as the next one' }).count()) === 1);
note('open editor', (await page.getByRole('link', { name: 'Open editor' }).first().count()) === 1);
note('published embeds', (await page.getByRole('region', { name: 'Published embeds' }).count()) === 1);
note('layer kinds', (await page.getByRole('region', { name: 'Layer kinds' }).count()) === 1);
note('version card', (await page.getByRole('region', { name: 'Every publish gets a number' }).count()) === 1);
note('contentinfo', (await page.getByRole('contentinfo').count()) === 1);
const level = await page.getAttribute('[aria-label="Follow Light stage"]', 'data-light-level');
note('light level rose', Number(level) > 0.9, `level=${level}`);
const focus = await page.getAttribute('[aria-label="Follow Light stage"]', 'data-light-focus');
note('light focus format', /^\d\.\d{3}, \d\.\d{3}$/.test(focus ?? ''), focus ?? '');

// pointer tilt
await page.mouse.move(960, 300);
await page.waitForTimeout(300);
const focus2 = await page.getAttribute('[aria-label="Follow Light stage"]', 'data-light-focus');
note('light focus follows pointer', focus2 !== focus, `${focus} -> ${focus2}`);

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
note('no horizontal overflow (1280)', overflow <= 0, String(overflow));

// Sign in by keyboard
await page.goto(`${BASE}/signin`);
await page.getByRole('textbox', { name: 'Email' }).fill('wrong@lumenyard.test');
await page.getByRole('textbox', { name: 'Password' }).fill('nope');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForTimeout(400);
note('sign-in error', (await page.getByRole('alert').textContent()) === 'Email or password is incorrect.');

await page.getByRole('textbox', { name: 'Email' }).fill('ines@lumenyard.test');
await page.keyboard.press('Tab');
await page.keyboard.type('halation-ines-01');
await page.keyboard.press('Enter');
await page.waitForURL('**/projects', { timeout: 5000 }).catch(() => undefined);
note('landed on projects', page.url().endsWith('/projects'), page.url());
await page.waitForTimeout(800);
note('projects tablist', (await page.getByRole('tablist', { name: 'Projects' }).count()) === 1);
const card = page.getByRole('article', { name: 'Lumen hero' });
note('project card', (await card.count()) === 1);
note('layer count', (await card.getAttribute('data-layer-count')) === '4', await card.getAttribute('data-layer-count'));
const modelBay = page.getByRole('article', { name: 'Model bay' });
note('live version', (await modelBay.getAttribute('data-live-version')) === '1');
note('editor count', (await modelBay.getAttribute('data-editor-count')) === '1');

// Editor
const heroId = seed.projects['Lumen hero'].id;
await page.goto(`${BASE}/projects/${heroId}`);
await page.waitForTimeout(1500);
note('layers tree', (await page.getByRole('tree', { name: 'Layers' }).count()) === 1);
note('camera row', (await page.getByRole('treeitem', { name: 'Camera, Camera' }).count()) === 1);
note('halo row', (await page.getByRole('treeitem', { name: 'Halo cube, Primitive' }).count()) === 1);
note('stage group', (await page.getByRole('group', { name: 'Stage' }).count()) === 1);
note('breakpoint group', (await page.getByRole('radiogroup', { name: 'Breakpoint' }).count()) === 1);
note('preview switch', (await page.getByRole('switch', { name: 'Preview' }).count()) === 1);
note('scroll slider', (await page.getByRole('slider', { name: 'Scroll progress' }).count()) === 1);
note('timeline region', (await page.getByRole('region', { name: 'Timeline' }).count()) === 1);
note('playhead', (await page.getByRole('slider', { name: 'Playhead' }).count()) === 1);
note('readouts region', (await page.getByRole('region', { name: 'Readouts' }).count()) === 1);
note('save status', (await page.getByRole('status', { name: 'Save status' }).count()) === 1);
note('publish button', (await page.getByRole('button', { name: 'Publish' }).count()) === 1);
note('renderer attribute', ['webgl2', 'canvas2d'].includes(await page.getAttribute('[aria-label="Stage"]', 'data-renderer')));

await page.getByRole('treeitem', { name: 'Halo cube, Primitive' }).click();
await page.waitForTimeout(600);
note('position spin', (await page.getByRole('spinbutton', { name: 'Position X', exact: true }).count()) === 1);
const screenPoint = await page.locator('[data-readout="screen-point"]').first().textContent();
note('screen point readout', screenPoint === '806.85, 231.29 px', screenPoint ?? '');
const triangles = await page.locator('[data-readout="triangles"]').first().textContent();
note('triangles readout', triangles === 'Triangles 12', triangles ?? '');

// Arrow key nudge
const positionX = page.getByRole('spinbutton', { name: 'Position X', exact: true });
await positionX.focus();
await page.keyboard.press('ArrowUp');
await page.waitForTimeout(1600);
const after = await page.locator('[data-readout="property"][data-path="position.x"]').first().textContent();
note('arrow nudge', after === 'Position X 1.100', after ?? '');
note('focus kept after nudge', await positionX.evaluate((node) => node === document.activeElement));
const save = await page.getByRole('status', { name: 'Save status' }).textContent();
note('saved status', save === 'All changes saved', save ?? '');

// Reload keeps the change
await page.reload();
await page.waitForTimeout(1500);
await page.getByRole('treeitem', { name: 'Halo cube, Primitive' }).click();
await page.waitForTimeout(500);
const reloaded = await page.locator('[data-readout="property"][data-path="position.x"]').first().textContent();
note('change persisted', reloaded === 'Position X 1.100', reloaded ?? '');

// Breakpoint override
await page.getByRole('radio', { name: 'Tablet' }).click();
await page.waitForTimeout(600);
const tabletRotation = await page.locator('[data-readout="property"][data-path="rotation.y"]').first().textContent();
note('tablet override', tabletRotation === 'Rotation Y 30.000', tabletRotation ?? '');
note('reset button', (await page.getByRole('button', { name: 'Reset Rotation Y to inherited value' }).count()) === 1);
await page.getByRole('radio', { name: 'Mobile' }).click();
await page.waitForTimeout(600);
const mobileRotation = await page.locator('[data-readout="property"][data-path="rotation.y"]').first().textContent();
note('mobile inherits tablet', mobileRotation === 'Rotation Y 30.000 (from Tablet)', mobileRotation ?? '');

// Add layer by keyboard
await page.getByRole('radio', { name: 'Desktop' }).click();
await page.waitForTimeout(400);
const addLayer = page.getByRole('button', { name: 'Add layer' });
await addLayer.focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
note('add layer menu', (await page.getByRole('menu', { name: 'Add layer' }).count()) === 1);
await page.getByRole('menuitem', { name: 'Torus' }).click();
await page.waitForTimeout(1600);
note('torus added', (await page.getByRole('treeitem', { name: 'Torus, Primitive' }).count()) === 1);
await page.getByRole('treeitem', { name: 'Torus, Primitive' }).click();
await page.waitForTimeout(500);
const torusTriangles = await page.locator('[data-readout="triangles"]').first().textContent();
note('torus triangles', torusTriangles === 'Triangles 1536', torusTriangles ?? '');

// Field of view change
await page.getByRole('treeitem', { name: 'Camera, Camera' }).click();
await page.waitForTimeout(500);
const fov = page.getByRole('spinbutton', { name: 'Field of view', exact: true });
await fov.fill('35');
await fov.press('Enter');
await page.waitForTimeout(1400);
await page.getByRole('treeitem', { name: 'Halo cube, Primitive' }).click();
await page.waitForTimeout(600);
const fovScreen = await page.locator('[data-readout="screen-point"]').first().textContent();
note('fov readout updated', fovScreen === '861.29, 148.10 px', fovScreen ?? '');

// Publish
await page.getByRole('button', { name: 'Publish' }).click();
await page.waitForTimeout(2500);
const status = await page.getByRole('status', { name: 'Editor status' }).textContent();
note('publish status', status === 'Version 1 is live.', status ?? '');

// Embed
const embed = await context.newPage();
await embed.goto(`${BASE}/embed/${heroId}`);
await embed.waitForTimeout(1500);
const embedRegion = embed.locator('[data-version]');
note('embed version', (await embedRegion.getAttribute('data-version')) === '1');
note('embed breakpoint', (await embedRegion.getAttribute('data-breakpoint')) === 'desktop');
note('embed scene values', (await embed.locator('[data-layer-name]').count()) > 0);

const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
const phonePage = await phone.newPage();
await phonePage.goto(`${BASE}/embed/${heroId}`);
await phonePage.waitForTimeout(1200);
note('embed mobile breakpoint', (await phonePage.locator('[data-version]').getAttribute('data-breakpoint')) === 'mobile');

// Phone editor
const phoneEditor = await phone.newPage();
await phoneEditor.goto(`${BASE}/signin`);
await phoneEditor.getByRole('textbox', { name: 'Email' }).fill('ines@lumenyard.test');
await phoneEditor.getByRole('textbox', { name: 'Password' }).fill('halation-ines-01');
await phoneEditor.getByRole('button', { name: 'Sign in' }).click();
await phoneEditor.waitForTimeout(1200);
await phoneEditor.goto(`${BASE}/projects/${heroId}`);
await phoneEditor.waitForTimeout(1500);
note('phone tablist', (await phoneEditor.getByRole('tablist', { name: 'Editor panels' }).count()) === 1);
note('more actions', (await phoneEditor.getByRole('button', { name: 'More actions' }).count()) === 1);
const phoneOverflow = await phoneEditor.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
note('no horizontal overflow (390)', phoneOverflow <= 0, String(phoneOverflow));

// Timeline keyboard work (DP-29)
await page.getByRole('treeitem', { name: 'Halo cube, Primitive' }).click();
await page.waitForTimeout(600);
await page.getByRole('spinbutton', { name: 'Rotation Y', exact: true }).focus();
const playheadSlider = page.getByRole('slider', { name: 'Playhead' });
await playheadSlider.focus();
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(300);
note('playhead moves by frames', (await playheadSlider.inputValue()) === '2', await playheadSlider.inputValue());
note(
  'playhead time readout',
  (await playheadSlider.getAttribute('aria-valuetext')) === '00:00.033',
  await playheadSlider.getAttribute('aria-valuetext'),
);
note('focus stays on the playhead', await playheadSlider.evaluate((node) => node === document.activeElement));
await page.keyboard.press('k');
await page.waitForTimeout(1600);
const keyframeButton = page.getByRole('button', { name: 'Rotation Y keyframe at 00:00.033' });
note('keyframe added by K', (await keyframeButton.count()) === 1);
const keyframeStatus = await page.getByRole('status', { name: 'Editor status' }).textContent();
note('keyframe status', keyframeStatus === 'Keyframe added at 00:00.033', keyframeStatus ?? '');
await keyframeButton.focus();
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(1600);
const movedKeyframe = page.getByRole('button', { name: 'Rotation Y keyframe at 00:00.050' });
note('keyframe moved by arrow', (await movedKeyframe.count()) === 1);
note('focus follows the moved keyframe', await movedKeyframe.evaluate((node) => node === document.activeElement));

for (const size of [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
]) {
  const sized = await browser.newContext({ viewport: size });
  const sizedPage = await sized.newPage();
  await sizedPage.goto(BASE);
  await sizedPage.waitForTimeout(900);
  const value = await sizedPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  note(`landing no overflow (${size.width})`, value <= 0, String(value));

  await sizedPage.goto(`${BASE}/signin`);
  await sizedPage.getByRole('textbox', { name: 'Email' }).fill('ines@lumenyard.test');
  await sizedPage.getByRole('textbox', { name: 'Password' }).fill('halation-ines-01');
  await sizedPage.getByRole('button', { name: 'Sign in' }).click();
  await sizedPage.waitForTimeout(1500);
  const projectsOverflow = await sizedPage.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  note(`projects no overflow (${size.width})`, projectsOverflow <= 0, String(projectsOverflow));
  await sizedPage.goto(`${BASE}/projects/${heroId}`);
  await sizedPage.waitForTimeout(2000);
  const editorOverflow = await sizedPage.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  note(`editor no overflow (${size.width})`, editorOverflow <= 0, String(editorOverflow));
  const small = await sizedPage.locator('button, input[type="range"], select').evaluateAll((nodes) =>
    nodes
      .filter((node) => node.offsetParent !== null)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          label: node.getAttribute('aria-label') ?? node.textContent?.slice(0, 20),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        };
      })
      .filter((entry) => entry.w < 44 || entry.h < 44),
  );
  note(`touch targets 44 px (${size.width})`, small.length === 0, JSON.stringify(small.slice(0, 4)));
  await sized.close();
}

const unexpected = errors.filter(
  (entry) => !entry.includes('401') && !entry.includes('Unauthorized'),
);
note('no unexpected console errors', unexpected.length === 0, unexpected.slice(0, 5).join(' | '));

await browser.close();
const failed = results.filter((entry) => !entry.ok).length;
console.log(`${results.length - failed}/${results.length} UI checks passed`);
