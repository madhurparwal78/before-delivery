/** Browser walk-through of the published screens. Not part of the app. */
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:4173';
let failures = 0;
let checks = 0;
const consoleErrors = [];

function check(label, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.log(`FAIL ${label}${detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
}

function eq(label, actual, expected) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
}


// ---------------------------------------------------------------------------
// A finished survey for the client-review section, so this walk-through does
// not depend on any other suite having run.
// ---------------------------------------------------------------------------

class Api {
  constructor() {
    this.cookie = null;
  }
  async call(path, options = {}) {
    const headers = { ...(options.headers ?? {}) };
    if (this.cookie) headers.cookie = this.cookie;
    let body;
    if (options.raw !== undefined) body = options.raw;
    else if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const response = await fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body,
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : undefined };
  }
  signIn(email) {
    return this.call('/api/session', {
      method: 'POST',
      body: { email, password: 'chartroom-2026' },
    });
  }
}

function ingestFixes(key, path, body) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ingest-key': key },
    body: JSON.stringify(body),
  }).then(async (response) => ({
    status: response.status,
    data: await response.text().then((t) => (t ? JSON.parse(t) : undefined)),
  }));
}

async function seedFinishedSurvey() {
  const surveyor = new Api();
  const technician = new Api();
  await surveyor.signIn('ira@fathomwright.test');
  await technician.signIn('tamsin@fathomwright.test');

  const created = await surveyor.call('/api/missions', {
    method: 'POST',
    body: {
      name: 'Reviewed Reach',
      client_org_id: 'org-saltmere',
      survey_date: '2026-11-20',
      survey_area: [
        { easting: 3000, northing: 6000 },
        { easting: 3040, northing: 6000 },
        { easting: 3040, northing: 6060 },
        { easting: 3000, northing: 6060 },
      ],
      geofence: [
        { easting: 2960, northing: 5960 },
        { easting: 3080, northing: 5960 },
        { easting: 3080, northing: 6100 },
        { easting: 2960, northing: 6100 },
      ],
      planned_depth_m: 5,
      swath_ratio: 4,
      overlap_pct: 0,
      line_azimuth_deg: 0,
      planned_speed_mps: 2,
      survey_order: '1a',
    },
  });
  const seeded = created.data;
  const seededLines = (await surveyor.call(`/api/missions/${seeded.id}/lines`)).data;
  await surveyor.call(`/api/missions/${seeded.id}/assignments`, {
    method: 'POST',
    body: { assignments: seededLines.map((l) => ({ line_id: l.id, vessel_id: 'v-kittiwake' })) },
  });
  await technician.call('/api/vessels/v-kittiwake/afloat', { method: 'POST', body: {} });
  await surveyor.call(`/api/missions/${seeded.id}/transitions`, {
    method: 'POST',
    body: { to: 'Launched' },
  });

  const base = Date.now() - 300_000;
  let clock = 0;
  for (const line of seededLines) {
    await ingestFixes('ik-kittiwake-4c19', `/api/ingest/lines/${line.id}/start`, {});
    const vertical =
      Math.abs(line.end.northing - line.start.northing) >
      Math.abs(line.end.easting - line.start.easting);
    const fixes = [];
    for (let step = 0; step <= 12; step += 1) {
      const ratio = step / 12;
      clock += 10;
      fixes.push({
        t: new Date(base + clock * 1000).toISOString(),
        easting: line.start.easting + (line.end.easting - line.start.easting) * ratio,
        northing: line.start.northing + (line.end.northing - line.start.northing) * ratio,
        heading_deg: vertical ? 0 : 90,
        speed_mps: 1,
        battery_pct: 72,
        depth_m: 5,
      });
    }
    await ingestFixes('ik-kittiwake-4c19', '/api/ingest/fixes', { fixes });
    await ingestFixes('ik-kittiwake-4c19', `/api/ingest/lines/${line.id}/end`, {});
  }

  for (const line of (await surveyor.call(`/api/missions/${seeded.id}/lines`)).data) {
    const bytes = Buffer.from(`reviewed sonar ${line.label}`);
    await technician.call(`/api/lines/${line.id}/file`, {
      method: 'PUT',
      raw: bytes,
      headers: {
        'content-type': 'application/octet-stream',
        'x-line-file-name': `${line.label}.raw`,
        'x-content-sha256': createHash('sha256').update(bytes).digest('hex'),
      },
    });
  }
  await technician.call('/api/vessels/v-kittiwake/recovered', { method: 'POST', body: {} });
  await technician.call(`/api/missions/${seeded.id}/transitions`, {
    method: 'POST',
    body: { to: 'Complete' },
  });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const state = (await surveyor.call(`/api/missions/${seeded.id}`)).data?.report?.state;
    if (state === 'Ready') break;
    await new Promise((done) => setTimeout(done, 500));
  }
  return seeded;
}

await seedFinishedSurvey();

const browser = await chromium.launch({ channel: 'chromium', args: ['--no-sandbox'] });

async function openPage(viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  return { context, page };
}

async function signIn(page, email, path = '/') {
  await page.goto(`${BASE}${path}`);
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.locator('#sign-in-password').fill('chartroom-2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

console.log('--- sign-in and role landing ---');
{
  const { context, page } = await openPage();
  await page.goto(`${BASE}/fleet`);
  await page.waitForURL(/\/sign-in\?next=/);
  eq('signed-out deep link goes to sign-in with next', new URL(page.url()).searchParams.get('next'), '/fleet');
  eq(
    'sign-in heading',
    await page.getByRole('heading', { name: 'Sign in to Swathdeck' }).isVisible(),
    true,
  );

  await page.getByRole('textbox', { name: 'Email' }).fill('ira@fathomwright.test');
  await page.locator('#sign-in-password').fill('wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  const summary = page.getByRole('alert');
  await summary.waitFor();
  eq('sign-in error copy', (await summary.textContent())?.trim(), 'Email or password is incorrect.');
  eq('password cleared', await page.locator('#sign-in-password').inputValue(), '');
  eq('email kept', await page.getByRole('textbox', { name: 'Email' }).inputValue(), 'ira@fathomwright.test');
  eq('focus on the summary', await summary.evaluate((node) => node === document.activeElement), true);

  await page.locator('#sign-in-password').fill('chartroom-2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/fleet/);
  eq('landed on the fleet board', new URL(page.url()).pathname, '/fleet');

  console.log('--- top bar ---');
  const nav = page.getByRole('navigation', { name: 'Main' });
  eq('surveyor nav links', await nav.getByRole('link').allInnerTexts(), ['Fleet', 'Missions', 'New mission']);
  eq('units radiogroup', await page.getByRole('radiogroup', { name: 'Units' }).isVisible(), true);
  eq('metric checked', await page.getByRole('radio', { name: 'Metric' }).isChecked(), true);
  eq('sign out present', await page.getByRole('button', { name: 'Sign out' }).isVisible(), true);
  eq('service status region', await page.locator('[aria-label="Service status"][role="status"]').count(), 1);
  eq('session status region', await page.locator('[aria-label="Session status"][role="status"]').count(), 1);

  console.log('--- fleet board regions ---');
  await page.getByRole('region', { name: 'Fleet' }).waitFor();
  const cards = page.getByRole('region', { name: 'Fleet' }).getByRole('listitem');
  await page.waitForFunction(
    () => document.querySelectorAll('.vessel-list > li').length === 4,
    null,
    { timeout: 10000 },
  );
  eq('four vessel cards in seed order', await cards.count(), 4);
  eq(
    'seed order',
    await page.getByRole('region', { name: 'Fleet' }).locator('.vessel-open').allInnerTexts(),
    ['Kittiwake', 'Petrel', 'Shearwater', 'Gannet'],
  );
  eq('alerts region', await page.getByRole('region', { name: 'Alerts' }).isVisible(), true);
  eq(
    'alerts heading level 2',
    await page.getByRole('region', { name: 'Alerts' }).getByRole('heading', { level: 2 }).innerText(),
    'Alerts',
  );
  eq('survey chart region', await page.getByRole('region', { name: 'Survey chart' }).isVisible(), true);
  eq('coverage chart application', await page.locator('[role="application"][aria-label="Coverage chart"]').count(), 1);
  for (const name of ['Zoom in', 'Zoom out', 'Fit survey area']) {
    eq(`chart control ${name}`, await page.getByRole('button', { name }).isVisible(), true);
  }
  eq(
    'detail reads Select a vessel',
    (await page.getByRole('region', { name: 'Detail' }).innerText()).includes('Select a vessel'),
    true,
  );
  eq('fleet announcements region', await page.locator('[aria-label="Fleet announcements"][role="status"]').count(), 1);
  eq('three panes at 1280', await page.locator('.console').evaluate((node) => node.dataset.layout), 'wide');

  console.log('--- vessel detail and address ---');
  await page.getByRole('button', { name: 'Kittiwake', exact: true }).click();
  await page.waitForURL(/\/fleet\/v-kittiwake$/);
  const detail = page.getByRole('region', { name: 'Detail' });
  await detail.getByRole('list', { name: 'Recent fixes' }).waitFor();
  eq('recent fixes list', await detail.getByRole('list', { name: 'Recent fixes' }).isVisible(), true);
  eq('service interval field', await detail.getByRole('spinbutton', { name: 'Service interval' }).isVisible(), true);
  eq('save interval button', await detail.getByRole('button', { name: 'Save interval' }).isVisible(), true);
  eq('track replay slider', await detail.getByRole('slider', { name: 'Track replay' }).isVisible(), true);
  const slider = detail.getByRole('slider', { name: 'Track replay' });
  eq('slider starts at Now', await slider.getAttribute('aria-valuetext'), 'Now');
  await slider.focus();
  await page.keyboard.press('ArrowLeft');
  eq('slider steps back 10 s', await slider.getAttribute('aria-valuetext'), '10 s ago');
  await page.keyboard.press('End');
  eq('End returns to Now', await slider.getAttribute('aria-valuetext'), 'Now');

  await page.reload();
  await page.getByRole('region', { name: 'Detail' }).getByRole('list', { name: 'Recent fixes' }).waitFor();
  eq('reload keeps the detail open', new URL(page.url()).pathname, '/fleet/v-kittiwake');

  console.log('--- no horizontal overflow ---');
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 768, height: 1024 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`no sideways scroll at ${viewport.width}`, overflow <= 1, overflow);
  }

  console.log('--- sheet layouts ---');
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`${BASE}/fleet`);
  await page.waitForFunction(
    () => document.querySelectorAll('.vessel-list > li').length === 4,
    null,
    { timeout: 10000 },
  );
  eq('two panes at 768', await page.locator('.console').evaluate((node) => node.dataset.layout), 'medium');
  eq('closed sheet absent from the tree', await page.getByRole('dialog').count(), 0);
  eq('closed sheet holds nothing focusable', await page.locator('.sheet').count(), 0);
  await page.getByRole('button', { name: 'Kittiwake', exact: true }).click();
  await page.getByRole('dialog', { name: 'Kittiwake detail' }).waitFor();
  eq('sheet opens at 768', await page.getByRole('dialog', { name: 'Kittiwake detail' }).isVisible(), true);
  await page.keyboard.press('Escape');
  await page.waitForURL(/\/fleet/);
  eq('escape closes the sheet', await page.getByRole('dialog').count(), 0);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${BASE}/fleet`);
  await page.waitForFunction(
    () => document.querySelectorAll('.vessel-list > li').length === 4,
    null,
    { timeout: 10000 },
  );
  eq('one column at 375', await page.locator('.console').evaluate((node) => node.dataset.layout), 'narrow');
  const chartBox = await page.locator('[role="application"][aria-label="Coverage chart"]').boundingBox();
  check('chart at least 300 px tall', (chartBox?.height ?? 0) >= 300, chartBox);

  console.log('--- units preference ---');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE}/missions/m-calderhaven-north/plan`);
  await page.getByRole('group', { name: 'Plan summary' }).waitFor();
  const metricSummary = await page.getByRole('group', { name: 'Plan summary' }).innerText();
  check('metric swath width', metricSummary.includes('40.0 m'), metricSummary);
  await page.getByRole('radio', { name: 'Imperial' }).check();
  await page.waitForTimeout(600);
  const imperialSummary = await page.getByRole('group', { name: 'Plan summary' }).innerText();
  check('imperial swath width', imperialSummary.includes('131.2 ft'), imperialSummary);
  await page.getByRole('radio', { name: 'Metric' }).check();
  await page.waitForTimeout(400);

  await context.close();
}

console.log('--- planner ---');
{
  const { context, page } = await openPage();
  await signIn(page, 'ira@fathomwright.test', '/missions/new');
  await page.getByRole('form', { name: 'New mission' }).waitFor();

  const form = page.getByRole('form', { name: 'New mission' });
  for (const name of ['Mission name', 'Survey date', 'Survey area vertices', 'Geofence corners']) {
    eq(`field ${name}`, await form.getByRole('textbox', { name }).count(), 1);
  }
  for (const name of ['Planned depth', 'Swath ratio', 'Overlap', 'Line azimuth', 'Planned speed']) {
    eq(`spinbutton ${name}`, await form.getByRole('spinbutton', { name }).count(), 1);
  }
  eq('client combobox', await form.getByRole('combobox', { name: 'Client' }).count(), 1);
  eq(
    'survey order options',
    await form.getByRole('combobox', { name: 'Survey order' }).locator('option').allInnerTexts(),
    ['Special Order', 'Order 1a'],
  );
  eq('create button', await form.getByRole('button', { name: 'Create mission' }).count(), 1);
  eq('plan preview region', await page.locator('[aria-label="Plan preview"][role="status"]').count(), 1);
  eq('form status region', await page.locator('[aria-label="Form status"][role="status"]').count(), 1);

  console.log('--- vertex format help ---');
  const help = page.getByRole('button', { name: 'Vertex format help' });
  eq('two help buttons', await help.count(), 2);
  await help.first().click();
  const popover = page.getByRole('dialog', { name: 'Vertex format' }).first();
  await popover.waitFor();
  eq(
    'help copy',
    (await popover.innerText()).trim(),
    'One vertex per line as easting, northing in metres, for example 5000, 8000. Enter starts a new line; Ctrl+Enter creates the mission.',
  );
  const box = await popover.boundingBox();
  const size = page.viewportSize();
  check(
    'popover inside the viewport',
    box !== null && box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width + 1 && box.y + box.height <= size.height + 1,
    box,
  );
  await page.keyboard.press('Escape');
  eq('escape closes the popover', await popover.isVisible(), false);

  console.log('--- keyboard planning and the address mirror ---');
  await form.getByRole('textbox', { name: 'Mission name' }).fill('Keyboard Cut');
  await form.getByRole('textbox', { name: 'Survey date' }).fill('2026-12-01');
  const area = form.getByRole('textbox', { name: 'Survey area vertices' });
  await area.click();
  await page.keyboard.type('4000, 9000');
  await page.keyboard.press('Enter');
  await page.keyboard.type('4400, 9000');
  await page.keyboard.press('Enter');
  await page.keyboard.type('4400, 9300');
  await page.keyboard.press('Enter');
  await page.keyboard.type('4000, 9300');
  eq('Enter starts a new line in the vertex field', (await area.inputValue()).split('\n').length, 4);

  const fence = form.getByRole('textbox', { name: 'Geofence corners' });
  await fence.fill('3950, 8950\n4450, 8950\n4450, 9350\n3950, 9350');
  await form.getByRole('spinbutton', { name: 'Planned depth' }).fill('10');
  await form.getByRole('spinbutton', { name: 'Swath ratio' }).fill('4');
  await form.getByRole('spinbutton', { name: 'Overlap' }).fill('20');
  await form.getByRole('spinbutton', { name: 'Line azimuth' }).fill('0');
  await form.getByRole('spinbutton', { name: 'Planned speed' }).fill('2');
  await form.getByRole('combobox', { name: 'Survey order' }).selectOption('special');
  await page.waitForTimeout(1200);

  const preview = page.locator('[aria-label="Plan preview"]');
  eq('preview matches the derivation', (await preview.innerText()).trim(), '13 lines · 1 cross · 49 min');

  const params = new URL(page.url()).searchParams;
  eq('address mirrors the settings', {
    depth: params.get('depth'),
    ratio: params.get('ratio'),
    overlap: params.get('overlap'),
    azimuth: params.get('azimuth'),
    speed: params.get('speed'),
    order: params.get('order'),
  }, { depth: '10', ratio: '4', overlap: '20', azimuth: '0', speed: '2', order: 'special' });

  console.log('--- undo and redo a committed edit ---');
  await form.getByRole('spinbutton', { name: 'Overlap' }).fill('30');
  await form.getByRole('spinbutton', { name: 'Overlap' }).blur();
  await page.waitForTimeout(400);
  await form.getByRole('spinbutton', { name: 'Overlap' }).focus();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  eq('undo restores the value', await form.getByRole('spinbutton', { name: 'Overlap' }).inputValue(), '20');
  eq('undo announced', (await page.locator('[aria-label="Form status"]').innerText()).trim(), 'Undid Overlap: 20');
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(300);
  eq('redo reapplies the value', await form.getByRole('spinbutton', { name: 'Overlap' }).inputValue(), '30');
  eq('redo announced', (await page.locator('[aria-label="Form status"]').innerText()).trim(), 'Redid Overlap: 30');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);

  console.log('--- reloading the planner address ---');
  await page.reload();
  await page.getByRole('form', { name: 'New mission' }).waitFor();
  await page.waitForTimeout(800);
  eq('reload restores the depth', await page.getByRole('spinbutton', { name: 'Planned depth' }).inputValue(), '10');
  eq('reload restores the order', await page.getByRole('combobox', { name: 'Survey order' }).inputValue(), 'special');

  console.log('--- validation summary ---');
  await page.getByRole('textbox', { name: 'Mission name' }).fill('');
  await page.getByRole('textbox', { name: 'Survey date' }).fill('not-a-date');
  await page.getByRole('textbox', { name: 'Survey area vertices' }).fill('4000, 9000\n4400, 9000\n4400, 9300\n4000, 9300');
  await page.getByRole('textbox', { name: 'Geofence corners' }).fill('3950, 8950\n4450, 8950\n4450, 9350\n3950, 9350');
  await page.getByRole('button', { name: 'Create mission' }).click();
  const errorSummary = page.getByRole('alert');
  await errorSummary.waitFor();
  check(
    'summary heading',
    (await errorSummary.innerText()).includes('Fix these before creating the mission'),
    await errorSummary.innerText(),
  );
  const nameLink = errorSummary.getByRole('link', { name: 'Enter a mission name of up to 80 characters' });
  eq('summary link per field', await nameLink.count(), 1);
  await nameLink.click();
  eq(
    'summary link moves focus to the field',
    await page.getByRole('textbox', { name: 'Mission name' }).evaluate((node) => node === document.activeElement),
    true,
  );

  console.log('--- create a mission by keyboard ---');
  await page.getByRole('textbox', { name: 'Mission name' }).fill('Keyboard Cut');
  await page.getByRole('textbox', { name: 'Survey date' }).fill('2026-12-01');
  await page.getByRole('textbox', { name: 'Survey area vertices' }).click();
  await page.keyboard.press('Control+Enter');
  await page.waitForURL(/\/missions\/[^/]+\/plan$/, { timeout: 15000 });
  eq('landed on the line plan', /\/missions\/.+\/plan$/.test(new URL(page.url()).pathname), true);
  const planMissionId = new URL(page.url()).pathname.split('/')[2];

  console.log('--- line plan ---');
  await page.getByRole('table', { name: 'Line plan' }).waitFor();
  await page.getByRole('combobox', { name: 'Vessel for X01' }).waitFor();
  eq('mission name is the heading', await page.getByRole('heading', { level: 1 }).innerText(), 'Keyboard Cut');
  eq('plan summary group', await page.getByRole('group', { name: 'Plan summary' }).isVisible(), true);
  const rows = page.getByRole('table', { name: 'Line plan' }).locator('tbody tr');
  eq('14 rows', await rows.count(), 14);
  eq(
    'mainscheme first then crosslines',
    await rows.locator('td:nth-child(2)').allInnerTexts(),
    ['L01','L02','L03','L04','L05','L06','L07','L08','L09','L10','L11','L12','L13','X01'],
  );
  eq('save button', await page.getByRole('button', { name: 'Save assignments' }).isVisible(), true);
  eq('launch button', await page.getByRole('button', { name: 'Launch mission' }).isVisible(), true);
  eq('console link', await page.getByRole('link', { name: 'Open console' }).isVisible(), true);
  eq('plan status region', await page.locator('[aria-label="Plan status"][role="status"]').count(), 1);

  console.log('--- vessel picker by keyboard ---');
  const picker = page.getByRole('combobox', { name: 'Vessel for L01' });
  eq('picker is an ARIA combobox', await picker.getAttribute('aria-haspopup'), 'listbox');
  await picker.focus();
  await page.keyboard.press('Alt+ArrowDown');
  const listbox = page.getByRole('listbox').first();
  await listbox.waitFor();
  eq(
    'options are Unassigned then the seed order',
    await listbox.getByRole('option').allInnerTexts(),
    ['Unassigned', 'Kittiwake', 'Petrel', 'Shearwater', 'Gannet'],
  );
  const listBox = await listbox.boundingBox();
  const vp = page.viewportSize();
  check(
    'open list inside the viewport',
    listBox !== null && listBox.x >= 0 && listBox.y >= 0 && listBox.x + listBox.width <= vp.width + 1 && listBox.y + listBox.height <= vp.height + 1,
    listBox,
  );
  await page.keyboard.press('Escape');
  eq('escape closes without choosing', await picker.innerText(), 'Unassigned');
  await picker.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  eq('enter chooses a vessel', await picker.innerText(), 'Kittiwake');

  console.log('--- the last row picker opens inside the viewport ---');
  const lastPicker = page.getByRole('combobox', { name: 'Vessel for X01' });
  await lastPicker.scrollIntoViewIfNeeded();
  await lastPicker.click();
  const lastList = page.getByRole('listbox').first();
  await lastList.waitFor();
  const lastBox = await lastList.boundingBox();
  check(
    'last row list inside the viewport',
    lastBox !== null && lastBox.y >= 0 && lastBox.y + lastBox.height <= vp.height + 1,
    lastBox,
  );
  await page.keyboard.press('Escape');

  console.log('--- unsaved assignments survive a reload ---');
  await page.reload();
  await page.getByRole('table', { name: 'Line plan' }).waitFor();
  await page.waitForTimeout(500);
  eq(
    'picker change restored',
    await page.getByRole('combobox', { name: 'Vessel for L01' }).innerText(),
    'Kittiwake',
  );
  eq(
    'restore announced',
    (await page.locator('[aria-label="Plan status"]').innerText()).trim(),
    'Unsaved changes restored (1)',
  );
  check('row marked unsaved', (await page.locator('.unsaved').first().innerText()) === 'Unsaved');

  console.log('--- leaving with unsaved changes asks first ---');
  await page.getByRole('link', { name: 'Open console' }).click();
  const unsavedDialog = page.getByRole('dialog', { name: 'Unsaved assignments' });
  await unsavedDialog.waitFor();
  check(
    'dialog copy',
    (await unsavedDialog.innerText()).includes('You have 1 unsaved assignment changes.'),
    await unsavedDialog.innerText(),
  );
  eq(
    'focus starts on Stay',
    await unsavedDialog.getByRole('button', { name: 'Stay' }).evaluate((node) => node === document.activeElement),
    true,
  );
  await page.keyboard.press('Escape');
  eq('escape stays on the line plan', new URL(page.url()).pathname, `/missions/${planMissionId}/plan`);

  console.log('--- select many lines and assign them ---');
  const firstRow = page.getByRole('table', { name: 'Line plan' }).locator('tbody tr').first();
  await firstRow.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await page.waitForTimeout(150);
  check(
    'selection announced',
    /^\d+ lines selected$/.test((await page.locator('[aria-label="Plan status"]').innerText()).trim()),
    await page.locator('[aria-label="Plan status"]').innerText(),
  );
  eq('row checkbox follows the selection', await page.getByRole('checkbox', { name: 'Select L01' }).isChecked(), true);
  // Shearwater is overdue in the seed data, so the save is refused with the published copy.
  await page.getByRole('button', { name: 'Assign selected' }).click();
  let assignDialog = page.getByRole('dialog', { name: 'Assign selected lines' });
  await assignDialog.waitFor();
  await assignDialog.getByRole('combobox', { name: 'Vessel' }).click();
  await page.getByRole('option', { name: 'Shearwater' }).click();
  await assignDialog.getByRole('button', { name: 'Assign' }).click();
  await page.waitForTimeout(900);
  eq(
    'the overdue block message shows in the plan status region',
    (await page.locator('[aria-label="Plan status"]').innerText()).trim(),
    'Shearwater is overdue for thruster service (263.5 h since service, limit 250 h). Log a service before assigning or launching.',
  );

  await page.getByRole('button', { name: 'Assign selected' }).click();
  assignDialog = page.getByRole('dialog', { name: 'Assign selected lines' });
  await assignDialog.waitFor();
  await assignDialog.getByRole('combobox', { name: 'Vessel' }).click();
  await page.getByRole('option', { name: 'Gannet' }).click();
  await assignDialog.getByRole('button', { name: 'Assign' }).click();
  await page.waitForTimeout(900);
  const planStatus = (await page.locator('[aria-label="Plan status"]').innerText()).trim();
  check(
    'bulk assignment announced with the undo window',
    /^Assigned \d+ lines to Gannet — Undo available for 10 seconds$/.test(planStatus),
    planStatus,
  );
  eq('undo offered', await page.getByRole('button', { name: 'Undo' }).isVisible(), true);
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(900);
  check(
    'undo announced',
    /^Undid assignment of \d+ lines$/.test((await page.locator('[aria-label="Plan status"]').innerText()).trim()),
    await page.locator('[aria-label="Plan status"]').innerText(),
  );

  await context.close();
}

console.log('--- launch list ---');
{
  const { context, page } = await openPage({ width: 375, height: 812 });
  await signIn(page, 'tamsin@fathomwright.test');
  await page.waitForURL(/\/launch/);
  eq('technician lands on the launch list', new URL(page.url()).pathname, '/launch');
  eq('launch heading', await page.getByRole('heading', { name: 'Launch list', level: 1 }).isVisible(), true);
  eq(
    'technician nav links',
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link').allInnerTexts(),
    ['Fleet', 'Missions', 'Launch list'],
  );
  eq('launch status region', await page.locator('[aria-label="Launch status"][role="status"]').count(), 1);
  const service = page.getByRole('region', { name: 'Fleet service' });
  await service.waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll('.service-row').length === 4,
    null,
    { timeout: 15000 },
  );
  eq('log service buttons', await service.getByRole('button').count(), 4);

  console.log('--- log a thruster service from the slipway ---');
  const logButton = service.getByRole('button', { name: 'Log service for Shearwater' });
  await logButton.click();
  const serviceDialog = page.getByRole('dialog', { name: 'Log thruster service' });
  await serviceDialog.waitFor();
  eq('note field', await serviceDialog.getByRole('textbox', { name: 'Service note' }).count(), 1);
  eq('save button', await serviceDialog.getByRole('button', { name: 'Save service' }).count(), 1);
  eq('cancel button', await serviceDialog.getByRole('button', { name: 'Cancel' }).count(), 1);
  const saveBox = await serviceDialog.getByRole('button', { name: 'Save service' }).boundingBox();
  check('save button at least 44 px tall', (saveBox?.height ?? 0) >= 44, saveBox);
  await serviceDialog.getByRole('textbox', { name: 'Service note' }).fill('Bearing replaced');
  await serviceDialog.getByRole('button', { name: 'Save service' }).click();
  await page.waitForTimeout(1200);
  eq(
    'service logged copy',
    (await page.locator('[aria-label="Launch status"]').innerText()).trim(),
    'Service logged for Shearwater',
  );
  eq('dialog closed on success', await page.getByRole('dialog', { name: 'Log thruster service' }).count(), 0);

  console.log('--- dialogs keep focus inside and return it ---');
  await logButton.click();
  await page.getByRole('dialog', { name: 'Log thruster service' }).waitFor();
  await page.keyboard.press('Escape');
  eq(
    'focus returns to the opener',
    await logButton.evaluate((node) => node === document.activeElement),
    true,
  );

  console.log('--- no sideways scroll on a phone ---');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('launch list fits the phone', overflow <= 1, overflow);

  await context.close();
}

console.log('--- client reviewer ---');
{
  const { context, page } = await openPage();
  await signIn(page, 'bram@saltmere-dredging.test');
  await page.waitForURL(/\/surveys/);
  eq('reviewer lands on the surveys list', new URL(page.url()).pathname, '/surveys');
  eq('surveys heading', await page.getByRole('heading', { name: 'Your surveys' }).isVisible(), true);
  eq(
    'reviewer nav links',
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link').allInnerTexts(),
    ['Surveys'],
  );
  await page.getByRole('table', { name: 'Surveys' }).waitFor();
  const countLine = (await page.locator('[aria-label="Survey list"]').innerText()).trim();
  check('count line visible', /^Showing \d+ of \d+ surveys$/.test(countLine), countLine);

  const firstSurvey = page.getByRole('table', { name: 'Surveys' }).getByRole('link').first();
  const surveyName = await firstSurvey.innerText();
  await firstSurvey.click();
  await page.waitForURL(/\/surveys\/[^/]+$/);
  await page.getByRole('region', { name: 'Mission header' }).waitFor();
  await page.getByRole('heading', { level: 1, name: surveyName }).waitFor();
  eq('survey heading', await page.getByRole('heading', { level: 1 }).innerText(), surveyName);
  for (const name of ['Coverage', 'Open holidays', 'Lines remaining', 'Crossline agreement']) {
    eq(`header group ${name}`, await page.getByRole('group', { name }).count(), 1);
  }
  eq('coverage CSV link', await page.getByRole('link', { name: 'Download coverage CSV' }).isVisible(), true);
  eq('vessels list', await page.getByRole('list', { name: 'Vessels' }).isVisible(), true);
  eq('vessel filter', await page.getByRole('combobox', { name: 'Vessel' }).isVisible(), true);
  eq('line files table', await page.getByRole('table', { name: 'Line files' }).isVisible(), true);
  eq('no lens on the survey chart', await page.locator('[aria-label="Holiday lens"]').count(), 0);
  eq('no infill actions', await page.getByRole('button', { name: /^Queue infill/ }).count(), 0);

  const shaCell = page.getByRole('table', { name: 'Line files' }).locator('td.sha').first();
  const shaText = await shaCell.innerText();
  check('full lowercase checksum shown', /^SHA-256 [0-9a-f]{64}$/.test(shaText.trim()), shaText);

  console.log('--- filter the line files to one vessel ---');
  const filter = page.getByRole('combobox', { name: 'Vessel' });
  const vesselOptions = await filter.locator('option').allInnerTexts();
  eq('All vessels first', vesselOptions[0], 'All vessels');
  if (vesselOptions.length > 1) {
    const value = await filter.locator('option').nth(1).getAttribute('value');
    await filter.selectOption(value);
    await page.waitForTimeout(300);
    eq('filter lives in the address', new URL(page.url()).searchParams.get('vessel'), value);
    await filter.selectOption('');
    await page.waitForTimeout(300);
    eq('All vessels removes the parameter', new URL(page.url()).searchParams.get('vessel'), null);
  }

  console.log('--- an unknown vessel shows every line ---');
  const surveyId = new URL(page.url()).pathname.split('/')[2];
  await page.goto(`${BASE}/surveys/${surveyId}?vessel=v-nope`);
  await page.getByRole('table', { name: 'Line files' }).waitFor();
  await page.waitForTimeout(400);
  eq('unknown vessel copy', (await page.locator('.filter-note').innerText()).trim(), 'No such vessel on this survey');
  eq('picker reads All vessels', await page.getByRole('combobox', { name: 'Vessel' }).inputValue(), '');

  console.log('--- the report control ---');
  const reportLink = page.getByRole('link', { name: 'Download coverage report' });
  eq('report link once Ready', await reportLink.count(), 1);
  const download = await page.request.get(`${BASE}/api/missions/${surveyId}/report`);
  eq('report downloads', download.status(), 200);
  check('report checksum header on download', /^[0-9a-f]{64}$/.test(download.headers()['x-content-sha256'] ?? ''), download.headers());

  console.log('--- a guessed address shows the not-found page ---');
  await page.goto(`${BASE}/surveys/m-calderhaven-north`);
  await page.getByRole('heading', { name: 'Page not found' }).waitFor();
  eq(
    'not-found copy',
    (await page.locator('.notfound p').innerText()).trim(),
    'That page does not exist or is not shared with you.',
  );
  await page.goto(`${BASE}/fleet`);
  await page.getByRole('heading', { name: 'Page not found' }).waitFor();
  eq('a forbidden screen shows not found', await page.getByRole('heading', { name: 'Page not found' }).isVisible(), true);

  console.log('--- shared device: nothing of the reviewer is painted next ---');
  await page.goto(`${BASE}/surveys`);
  await page.getByRole('table', { name: 'Surveys' }).waitFor();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/sign-in/);
  eq('sign-out clears the screen of surveys', await page.getByRole('table', { name: 'Surveys' }).count(), 0);
  await page.getByRole('textbox', { name: 'Email' }).fill('tamsin@fathomwright.test');
  await page.locator('#sign-in-password').fill('chartroom-2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/launch/);
  const painted = await page.locator('#screen').innerText();
  check('no survey name of the previous account', !painted.includes(surveyName), painted.slice(0, 200));
  await page.goBack();
  await page.waitForTimeout(600);
  const afterBack = await page.locator('#screen').innerText();
  check('Back does not paint the previous account', !afterBack.includes(surveyName), afterBack.slice(0, 200));

  await context.close();
}

console.log('--- mission console ---');
{
  const { context, page } = await openPage();
  await signIn(page, 'ira@fathomwright.test', '/missions/m-calderhaven-north');
  await page.getByRole('region', { name: 'Mission header' }).waitFor();
  await page.getByRole('heading', { level: 1, name: 'Calderhaven North Basin' }).waitFor();
  await page.getByRole('group', { name: 'Plan summary' }).waitFor();
  eq(
    'mission name heading',
    await page.getByRole('region', { name: 'Mission header' }).getByRole('heading', { level: 1 }).innerText(),
    'Calderhaven North Basin',
  );
  for (const name of ['Coverage', 'Open holidays', 'Lines remaining', 'Crossline agreement']) {
    eq(`console group ${name}`, await page.getByRole('group', { name }).count(), 1);
  }
  eq('coverage CSV link', await page.getByRole('link', { name: 'Download coverage CSV' }).isVisible(), true);
  eq('lines table', await page.getByRole('table', { name: 'Lines' }).isVisible(), true);
  eq('plan summary', await page.getByRole('group', { name: 'Plan summary' }).isVisible(), true);
  eq('lens image', await page.locator('[role="img"][aria-label="Holiday lens"]').count(), 1);
  eq('lens readout group', await page.getByRole('group', { name: 'Lens readout' }).count(), 1);
  eq('no mission detail button at 1280', await page.getByRole('button', { name: 'Mission detail' }).count(), 0);

  console.log('--- the lens follows the keyboard ---');
  const chart = page.locator('[role="application"][aria-label="Coverage chart"]');
  await chart.focus();
  await page.waitForTimeout(300);
  const readout = page.getByRole('group', { name: 'Lens readout' });
  const before = await readout.innerText();
  check('readout shows a ground position', /E [\d.]+ N [\d.]+/.test(before), before);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  const after = await readout.innerText();
  check('an arrow press moves the lens', before !== after, { before, after });
  const easting = (text) => Number(/E ([\d.]+)/.exec(text)?.[1] ?? '0');
  check('arrow moves 10 m of ground', Math.abs(easting(after) - easting(before) - 10) < 0.5, {
    before: easting(before),
    after: easting(after),
  });
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(250);
  const shifted = await readout.innerText();
  check('shift moves 50 m', Math.abs(easting(shifted) - easting(after) - 50) < 0.5, {
    after: easting(after),
    shifted: easting(shifted),
  });

  console.log('--- a refresh never moves the lens ---');
  const held = await readout.innerText();
  await page.waitForTimeout(2600);
  eq('lens keeps its ground position across refreshes', (await readout.innerText()), held);

  console.log('--- the empty-holiday state ---');
  const holidaysList = page.getByRole('list', { name: 'Holidays' });
  if ((await holidaysList.count()) > 0) {
    const text = await holidaysList.innerText();
    check('holiday list copy', text.length > 0, text);
  }

  console.log('--- coverage as a keyboard grid ---');
  const viewAsTable = page.getByRole('button', { name: 'View as table' });
  eq('view as table has aria-pressed', await viewAsTable.getAttribute('aria-pressed'), 'false');
  await viewAsTable.click();
  const grid = page.getByRole('grid', { name: 'Coverage table' });
  await grid.waitFor();
  eq('pressed state', await viewAsTable.getAttribute('aria-pressed'), 'true');
  eq('view kept in the address', new URL(page.url()).searchParams.get('view'), 'table');
  eq('row count', await grid.getAttribute('aria-rowcount'), '60');
  eq('col count', await grid.getAttribute('aria-colcount'), '80');
  const firstCell = grid.getByRole('gridcell').first();
  eq('first cell row index', await firstCell.getAttribute('aria-rowindex'), '1');
  eq('first cell col index', await firstCell.getAttribute('aria-colindex'), '1');
  eq('one cell in the tab order', await grid.locator('[role="gridcell"][tabindex="0"]').count(), 1);
  await grid.locator('[role="gridcell"][tabindex="0"]').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  eq('arrow moves one cell', await grid.locator('[role="gridcell"][tabindex="0"]').getAttribute('aria-colindex'), '2');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const announced = (await page.locator('[aria-label="Fleet announcements"]').innerText()).trim();
  check('Enter on a plain cell announces the published copy', announced === 'No holiday under the lens', announced);
  await page.reload();
  await page.getByRole('grid', { name: 'Coverage table' }).waitFor();
  eq('the table view survives a reload', await page.getByRole('button', { name: 'View as table' }).getAttribute('aria-pressed'), 'true');

  console.log('--- the mission detail sheet at 768 ---');
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`${BASE}/missions/m-calderhaven-north`);
  await page.getByRole('heading', { level: 1, name: 'Calderhaven North Basin' }).waitFor();
  const detailButton = page.getByRole('button', { name: 'Mission detail' });
  eq('mission detail button at 768', await detailButton.count(), 1);
  eq('closed sheet is absent', await page.getByRole('dialog', { name: 'Mission detail' }).count(), 0);
  await detailButton.click();
  await page.getByRole('dialog', { name: 'Mission detail' }).waitFor();
  eq('sheet holds the lines table', await page.getByRole('dialog', { name: 'Mission detail' }).getByRole('table', { name: 'Lines' }).count(), 1);
  await page.keyboard.press('Escape');
  eq('sheet closes on escape', await page.getByRole('dialog', { name: 'Mission detail' }).count(), 0);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${BASE}/missions/m-calderhaven-north`);
  await page.getByRole('heading', { level: 1, name: 'Calderhaven North Basin' }).waitFor();
  eq('no mission detail button at 375', await page.getByRole('button', { name: 'Mission detail' }).count(), 0);
  eq('holidays list always shows at 375', await page.getByRole('list', { name: 'Holidays' }).count(), 1);

  await context.close();
}

console.log('--- mission history and flags ---');
{
  const { context, page } = await openPage();
  await signIn(page, 'ira@fathomwright.test', '/missions/m-calderhaven-north/history');
  await page.getByRole('list', { name: 'Mission events' }).waitFor();
  eq(
    'history heading',
    await page.getByRole('heading', { level: 1 }).innerText(),
    'History of Calderhaven North Basin',
  );
  eq('event kinds group', await page.getByRole('group', { name: 'Event kinds' }).isVisible(), true);
  eq(
    'kind checkboxes',
    await page.getByRole('group', { name: 'Event kinds' }).getByRole('checkbox').count(),
    11,
  );
  const historyStatus = (await page.locator('[aria-label="History status"]').innerText()).trim();
  check('history status copy', /^Showing \d+ events$/.test(historyStatus), historyStatus);
  const items = await page.getByRole('list', { name: 'Mission events' }).getByRole('listitem').allInnerTexts();
  check(
    'event line shape',
    items.length === 0 || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC · .+ · .+$/.test(items[0]),
    items[0],
  );
  await page.getByRole('checkbox', { name: 'Status' }).uncheck();
  await page.waitForTimeout(500);
  eq('unchecking a kind writes the address', new URL(page.url()).searchParams.has('kinds'), true);

  await page.goto(`${BASE}/flags`);
  await page.getByRole('heading', { name: 'Client flags' }).waitFor();
  eq('open flags list', await page.getByRole('list', { name: 'Open flags' }).count(), 1);
  eq('flags status region', await page.locator('[aria-label="Flags status"][role="status"]').count(), 1);

  await context.close();
}

await browser.close();

// Negative-path requests the walk-through makes on purpose are not app errors.
const ignorable = /favicon|Failed to load resource: the server responded with a status of 4/;
const realErrors = consoleErrors.filter((text) => !ignorable.test(text));
check('no console errors', realErrors.length === 0, realErrors.slice(0, 5));

console.log(`\n${checks - failures}/${checks} browser checks passed`);
if (failures > 0) process.exitCode = 1;
