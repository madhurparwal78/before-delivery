import { chromium } from '/tmp/node_modules/playwright/index.mjs';

const BASE = 'http://localhost:4173';
const KEY = process.env.GRADING_KEY;
const MAILPIT = 'http://mailpit:8025';

const results = [];
const note = (label, ok, extra = '') => {
  results.push({ label, ok });
  if (!ok) console.log(`FAIL ${label} ${extra}`);
};

const grading = async (path) =>
  (await fetch(`${BASE}/api/grading/${path}`, { method: 'POST', headers: { 'X-Grading-Key': KEY } })).json();

await grading('reset');
await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' }).catch(() => undefined);
const seed = await grading('seed');
const hero = seed.projects['Lumen hero'];

const browser = await chromium.launch({ args: ['--no-sandbox'] });

async function signedIn(email, password) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/signin`);
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/projects', { timeout: 8000 }).catch(() => undefined);
  return { context, page };
}

const owner = await signedIn('ines@lumenyard.test', 'halation-ines-01');
const editor = await signedIn('mara@lumenyard.test', 'halation-mara-01');
const viewer = await signedIn('tomas@lumenyard.test', 'halation-tomas-01');

await owner.page.goto(`${BASE}/projects/${hero.id}`);
await editor.page.goto(`${BASE}/projects/${hero.id}`);
await owner.page.waitForTimeout(2500);
await editor.page.waitForTimeout(2500);

// DP-37 presence
const presence = await owner.page.getByRole('img', { name: 'Mara Lindqvist is here' }).count();
note('presence avatar', presence === 1);

// DP-38 locks: the editor edits a layer, the owner is refused
await editor.page.getByRole('treeitem', { name: 'Swing, Model' }).click();
await editor.page.waitForTimeout(600);
const editorPosition = editor.page.getByRole('spinbutton', { name: 'Position X', exact: true });
await editorPosition.focus();
await editor.page.keyboard.press('ArrowUp');
await editor.page.waitForTimeout(1800);
await owner.page.waitForTimeout(1500);
const held = await owner.page.getByText('Held by Mara Lindqvist').count();
note('held by shown to owner', held === 1);

await owner.page.getByRole('treeitem', { name: 'Swing, Model' }).click();
await owner.page.waitForTimeout(500);
const ownerPosition = owner.page.getByRole('spinbutton', { name: 'Position X', exact: true });
await ownerPosition.focus();
await owner.page.keyboard.press('ArrowUp');
await owner.page.waitForTimeout(1800);
const refusal = await owner.page.getByRole('alert').first().textContent().catch(() => '');
note('owner refused while held', refusal === 'Mara Lindqvist is editing this layer.', refusal ?? '');

// Live change reaches the owner
const editorHalo = editor.page.getByRole('treeitem', { name: 'Halo cube, Primitive' });
await editorHalo.click();
await editor.page.waitForTimeout(600);
const editorRotation = editor.page.getByRole('spinbutton', { name: 'Rotation Y', exact: true });
await editorRotation.fill('60');
await editorRotation.press('Enter');
await editor.page.waitForTimeout(2000);
await owner.page.getByRole('treeitem', { name: 'Halo cube, Primitive' }).click();
await owner.page.waitForTimeout(1500);
const ownerRotation = await owner.page
  .locator('[data-readout="property"][data-path="rotation.y"]')
  .first()
  .textContent();
note('live change reached the owner', ownerRotation === 'Rotation Y 60.000', ownerRotation ?? '');

// DP-39 viewer sees edit controls unavailable
await viewer.page.goto(`${BASE}/projects/${hero.id}`);
await viewer.page.waitForTimeout(2500);
await viewer.page.getByRole('treeitem', { name: 'Halo cube, Primitive' }).click();
await viewer.page.waitForTimeout(800);
const viewerField = viewer.page.getByRole('spinbutton', { name: 'Position X', exact: true });
note('viewer field disabled', (await viewerField.getAttribute('aria-disabled')) === 'true');
note(
  'viewer refusal tooltip',
  (await viewerField.getAttribute('title')) === "Viewers can't edit this project.",
  (await viewerField.getAttribute('title')) ?? '',
);
note(
  'viewer can scrub',
  (await viewer.page.getByRole('slider', { name: 'Playhead' }).getAttribute('aria-disabled')) === null,
);
note(
  'viewer publish disabled',
  (await viewer.page.getByRole('button', { name: 'Publish' }).getAttribute('aria-disabled')) === 'true',
);

// DP-06 / DP-37 invite flow through the mail
await owner.page.getByRole('button', { name: 'Members' }).click();
await owner.page.waitForTimeout(600);
await owner.page.getByRole('button', { name: 'Invite people' }).click();
await owner.page.waitForTimeout(400);
await owner.page.getByRole('textbox', { name: 'Email' }).fill('newcomer@lumenyard.test');
await owner.page.getByRole('radio', { name: 'Viewer' }).click();
await owner.page.getByRole('button', { name: 'Send invite' }).click();
await owner.page.waitForTimeout(1500);
const membersStatus = await owner.page.getByRole('status', { name: 'Members status' }).textContent();
note('invite status', membersStatus === 'Invite sent to newcomer@lumenyard.test.', membersStatus ?? '');
await owner.page.keyboard.press('Escape');

const mail = await (await fetch(`${MAILPIT}/api/v1/messages?limit=100`)).json();
const inviteMail = mail.messages.find((message) => message.To?.[0]?.Address === 'newcomer@lumenyard.test');
note('invite mail arrived', inviteMail !== undefined);
let token = null;
if (inviteMail) {
  const full = await (await fetch(`${MAILPIT}/api/v1/message/${inviteMail.ID}`)).json();
  token = /\/invite\/([a-f0-9]+)/.exec(full.Text ?? '')?.[1] ?? null;
}
if (token) {
  const guest = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guestPage = await guest.newPage();
  await guestPage.goto(`${BASE}/invite/${token}`);
  await guestPage.waitForTimeout(900);
  note(
    'invite heading',
    (await guestPage.getByRole('heading', { name: 'Join Lumen hero as Viewer' }).count()) === 1,
  );
  await guestPage.getByRole('textbox', { name: 'Your name' }).fill('Nora Vale');
  await guestPage.getByRole('textbox', { name: 'Choose a password' }).fill('short');
  await guestPage.getByRole('button', { name: 'Accept invite' }).click();
  await guestPage.waitForTimeout(900);
  const shortPassword = await guestPage.getByRole('alert').textContent();
  note('short password refused', shortPassword === 'Choose a password of at least 10 characters.', shortPassword ?? '');
  await guestPage.getByRole('textbox', { name: 'Choose a password' }).fill('halation-nora-01');
  await guestPage.getByRole('button', { name: 'Accept invite' }).click();
  await guestPage.waitForTimeout(2500);
  note('invite accepted opens the project', guestPage.url().includes(`/projects/${hero.id}`), guestPage.url());
  await guest.close();
}

// DP-41 embed swaps version live
const embedContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const embedPage = await embedContext.newPage();
await owner.page.getByRole('button', { name: 'Publish' }).click();
await owner.page.waitForTimeout(3000);
await embedPage.goto(`${BASE}/embed/${hero.id}`);
await embedPage.waitForTimeout(2000);
note('embed shows version 1', (await embedPage.locator('[data-version]').getAttribute('data-version')) === '1');
await owner.page.getByRole('button', { name: 'Publish' }).click();
await owner.page.waitForTimeout(2500);
const ownerStatus = await owner.page.getByRole('status', { name: 'Editor status' }).textContent();
const swapped = await embedPage
  .locator('[data-version="2"]')
  .waitFor({ timeout: 4000 })
  .then(() => true)
  .catch(() => false);
note('embed switches version within 2 s', swapped, `status=${ownerStatus}`);

// DP-27 scroll orbit in the embed
const orbit = seed.projects['Orbit study'];
await fetch(`${BASE}/api/projects/${orbit.id}/versions`, {
  method: 'POST',
  headers: {
    cookie: `hs_session=${seed.people['ines@lumenyard.test'].session}`,
    'content-type': 'application/json',
    'Idempotency-Key': 'orbit-1',
  },
  body: '{}',
});
const orbitEmbed = await embedContext.newPage();
await orbitEmbed.goto(`${BASE}/embed/${orbit.id}`);
await orbitEmbed.waitForTimeout(1500);
const before = await orbitEmbed.locator('[data-version]').getAttribute('data-scroll-progress');
await orbitEmbed.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await orbitEmbed.waitForTimeout(900);
const after = await orbitEmbed.locator('[data-version]').getAttribute('data-scroll-progress');
note('scroll progress tracks the page', Number(before) === 0 && Number(after) > 99, `${before} -> ${after}`);

// DP-43 phone layer editing
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const phonePage = await phone.newPage();
await phonePage.goto(`${BASE}/signin`);
await phonePage.getByRole('textbox', { name: 'Email' }).fill('ines@lumenyard.test');
await phonePage.getByRole('textbox', { name: 'Password' }).fill('halation-ines-01');
await phonePage.getByRole('button', { name: 'Sign in' }).click();
await phonePage.waitForTimeout(1500);
await phonePage.goto(`${BASE}/projects/${seed.projects['Phone kit'].id}`);
await phonePage.waitForTimeout(2200);
await phonePage.getByRole('tab', { name: 'Layers' }).tap();
await phonePage.waitForTimeout(500);
const orderBefore = await phonePage
  .locator('[data-layer-id]')
  .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
await phonePage.getByRole('button', { name: 'Actions for Base' }).tap();
await phonePage.waitForTimeout(400);
await phonePage.getByRole('menuitem', { name: 'Move up' }).tap();
await phonePage.waitForTimeout(2000);
const orderAfter = await phonePage
  .locator('[data-layer-id]')
  .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
note('row menu reorders', JSON.stringify(orderBefore) !== JSON.stringify(orderAfter), JSON.stringify(orderAfter));
await phonePage.getByRole('button', { name: 'Actions for Glow' }).tap();
await phonePage.waitForTimeout(400);
await phonePage.getByRole('menuitem', { name: 'Duplicate' }).tap();
await phonePage.waitForTimeout(2000);
note('duplicate adds a row', (await phonePage.locator('[data-layer-id]').count()) === 5, String(await phonePage.locator('[data-layer-id]').count()));
const touchTargets = await phonePage.locator('button').evaluateAll((nodes) =>
  nodes
    .filter((node) => node.offsetParent !== null)
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return { label: node.getAttribute('aria-label') ?? node.textContent, w: rect.width, h: rect.height };
    })
    .filter((entry) => entry.w < 44 || entry.h < 44),
);
note('touch targets at least 44 px', touchTargets.length === 0, JSON.stringify(touchTargets.slice(0, 4)));

// DP-44 trash and restore
await phonePage.goto(`${BASE}/projects`);
await phonePage.waitForTimeout(1500);
await phonePage.getByRole('button', { name: 'Move Phone kit to trash' }).tap();
await phonePage.waitForTimeout(1600);
await phonePage.getByRole('tab', { name: 'Trash' }).tap();
await phonePage.waitForTimeout(1400);
note('trash lists the project', (await phonePage.getByRole('listitem', { name: 'Phone kit' }).count()) === 1);
await phonePage.getByRole('button', { name: 'Restore Phone kit' }).tap();
await phonePage.waitForTimeout(1600);
await phonePage.getByRole('tab', { name: 'Active' }).tap();
await phonePage.waitForTimeout(1500);
const restoredCard = phonePage.getByRole('article', { name: 'Phone kit' });
note('restored with layers', (await restoredCard.getAttribute('data-layer-count')) === '5', await restoredCard.getAttribute('data-layer-count'));

await browser.close();
const failed = results.filter((entry) => !entry.ok).length;
console.log(`${results.length - failed}/${results.length} collaboration checks passed`);
