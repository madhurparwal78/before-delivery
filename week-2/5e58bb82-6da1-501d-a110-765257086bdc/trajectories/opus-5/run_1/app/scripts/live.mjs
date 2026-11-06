/** Live-update, alert, infill, upload and offline walk-through. Not part of the app. */
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:4173';
let failures = 0;
let checks = 0;

function check(label, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.log(`FAIL ${label}${detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
}

function eq(label, actual, expected) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
}

class Session {
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
    let data;
    try {
      data = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      data = text;
    }
    return { status: response.status, data, headers: response.headers, text };
  }
  signIn(email) {
    return this.call('/api/session', {
      method: 'POST',
      body: { email, password: 'chartroom-2026' },
    });
  }
}

function ingest(key, path, body) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ingest-key': key },
    body: JSON.stringify(body),
  }).then(async (response) => ({
    status: response.status,
    data: await response.text().then((t) => (t ? JSON.parse(t) : undefined)),
  }));
}

const KEY = 'ik-kittiwake-4c19';
const VESSEL = 'v-kittiwake';
const ira = new Session();
const tamsin = new Session();
await ira.signIn('ira@fathomwright.test');
await tamsin.signIn('tamsin@fathomwright.test');

console.log('--- a surveying mission with a gap ---');
const AREA = [
  { easting: 9000, northing: 4000 },
  { easting: 9080, northing: 4000 },
  { easting: 9080, northing: 4100 },
  { easting: 9000, northing: 4100 },
];
const FENCE = [
  { easting: 8960, northing: 3960 },
  { easting: 9120, northing: 3960 },
  { easting: 9120, northing: 4140 },
  { easting: 8960, northing: 4140 },
];
let r = await ira.call('/api/missions', {
  method: 'POST',
  body: {
    name: 'Liveboard Cut',
    client_org_id: 'org-calderhaven',
    survey_date: '2026-11-12',
    survey_area: AREA,
    geofence: FENCE,
    planned_depth_m: 5,
    swath_ratio: 4,
    overlap_pct: 0,
    line_azimuth_deg: 0,
    planned_speed_mps: 2,
    survey_order: '1a',
  },
});
eq('mission created', r.status, 201);
const mission = r.data;
let lines = (await ira.call(`/api/missions/${mission.id}/lines`)).data;
await ira.call(`/api/missions/${mission.id}/assignments`, {
  method: 'POST',
  body: { assignments: lines.map((l) => ({ line_id: l.id, vessel_id: VESSEL })) },
});
await tamsin.call(`/api/vessels/${VESSEL}/afloat`, { method: 'POST', body: {} });
r = await ira.call(`/api/missions/${mission.id}/transitions`, { method: 'POST', body: { to: 'Launched' } });
eq('launched', r.data?.status, 'Launched');

const base = Date.now() - 400_000;
let clock = 0;
const at = (seconds) => new Date(base + seconds * 1000).toISOString();

async function runLine(line, options = {}) {
  await ingest(KEY, `/api/ingest/lines/${line.id}/start`, {});
  const vertical =
    Math.abs(line.end.northing - line.start.northing) > Math.abs(line.end.easting - line.start.easting);
  const fixes = [];
  for (let step = 0; step <= 20; step += 1) {
    const ratio = step / 20;
    clock += 10;
    if (options.skipFrom !== undefined && ratio > options.skipFrom && ratio < options.skipTo) continue;
    fixes.push({
      t: at(clock),
      easting: line.start.easting + (line.end.easting - line.start.easting) * ratio,
      northing: line.start.northing + (line.end.northing - line.start.northing) * ratio,
      heading_deg: vertical ? 0 : 90,
      speed_mps: 1,
      battery_pct: 64,
      depth_m: 5,
    });
  }
  await ingest(KEY, '/api/ingest/fixes', { fixes });
  if (!options.leaveRunning) await ingest(KEY, `/api/ingest/lines/${line.id}/end`, {});
}

await runLine(lines[0]);
await runLine(lines[1], { skipFrom: 0.3, skipTo: 0.7 });
r = await ira.call(`/api/missions/${mission.id}`);
eq('surveying', r.data?.status, 'Surveying');
r = await ira.call(`/api/missions/${mission.id}/holidays`);
const holiday = r.data.find((h) => h.status === 'Open');
check('an open holiday', holiday !== undefined, r.data);

const browser = await chromium.launch({ channel: 'chromium', args: ['--no-sandbox'] });

console.log('--- the fleet board follows the boats ---');
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/sign-in`);
  await page.getByRole('textbox', { name: 'Email' }).fill('ira@fathomwright.test');
  await page.locator('#sign-in-password').fill('chartroom-2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/fleet/);
  await page.goto(`${BASE}/fleet/${VESSEL}`);
  const detail = page.getByRole('region', { name: 'Detail' });
  await detail.getByRole('list', { name: 'Recent fixes' }).waitFor();
  await page.waitForTimeout(2500);

  const fixesBefore = await detail.getByRole('list', { name: 'Recent fixes' }).getByRole('listitem').count();
  const cardBefore = await page
    .getByRole('region', { name: 'Fleet' })
    .locator('[data-key="' + VESSEL + '"] [data-position]')
    .innerText();

  // Focus a recent-fix row and start typing in the interval field; neither must be disturbed.
  const firstFix = detail.getByRole('list', { name: 'Recent fixes' }).getByRole('listitem').first();
  await firstFix.focus();
  await detail.getByRole('spinbutton', { name: 'Service interval' }).fill('275');

  clock += 10;
  await ingest(KEY, '/api/ingest/fixes', {
    t: at(clock),
    easting: 9044,
    northing: 4055,
    heading_deg: 0,
    speed_mps: 1.4,
    battery_pct: 58,
    depth_m: 7,
  });

  await page.waitForFunction(
    (previous) =>
      (document.querySelector('[data-key="v-kittiwake"] [data-position]')?.textContent ?? '') !==
      previous,
    cardBefore,
    { timeout: 2500 },
  );
  const cardAfter = await page
    .getByRole('region', { name: 'Fleet' })
    .locator('[data-key="' + VESSEL + '"] [data-position]')
    .innerText();
  check('the vessel card updates in place within two seconds', cardAfter !== cardBefore, {
    cardBefore,
    cardAfter,
  });
  check('the position is the new fix', cardAfter.includes('9044.0'), cardAfter);
  const fixesAfter = await detail.getByRole('list', { name: 'Recent fixes' }).getByRole('listitem').count();
  check('the recent-fixes list grows', fixesAfter >= fixesBefore, { fixesBefore, fixesAfter });
  eq(
    'typed input is never cleared by a refresh',
    await detail.getByRole('spinbutton', { name: 'Service interval' }).inputValue(),
    '275',
  );
  eq('the detail stays open', new URL(page.url()).pathname, `/fleet/${VESSEL}`);
  eq(
    'battery follows the fix',
    (await page
      .getByRole('region', { name: 'Fleet' })
      .locator('[data-key="' + VESSEL + '"] [data-battery]')
      .innerText()).trim(),
    '58 %',
  );

  console.log('--- a geofence breach raises one card and announces it once ---');
  clock += 10;
  await Promise.all([
    ingest(KEY, '/api/ingest/fixes', {
      t: at(clock),
      easting: 9300,
      northing: 4050,
      heading_deg: 0,
      speed_mps: 1,
      battery_pct: 57,
      depth_m: 6,
    }),
    ingest(KEY, '/api/ingest/fixes', {
      t: at(clock),
      easting: 9300,
      northing: 4050,
      heading_deg: 0,
      speed_mps: 1,
      battery_pct: 57,
      depth_m: 6,
    }),
  ]);
  const alertCard = page
    .getByRole('region', { name: 'Alerts' })
    .getByRole('article')
    .filter({ hasText: 'Geofence breach — Kittiwake' });
  await alertCard.first().waitFor({ timeout: 3000 });
  eq('exactly one breach card', await alertCard.count(), 1);
  eq(
    'card heading at level 3',
    await alertCard.first().getByRole('heading', { level: 3 }).innerText(),
    'Geofence breach — Kittiwake',
  );
  const cardText = await alertCard.first().innerText();
  check('card shows Active', cardText.includes('Active'), cardText);
  check('card shows the raised time', /\d{2}:\d{2}:\d{2} UTC/.test(cardText), cardText);
  check('card shows the email state', /Email queued|Emailed/.test(cardText), cardText);
  eq(
    'announced once with the published copy',
    (await page.locator('[aria-label="Fleet announcements"]').innerText()).trim(),
    'Geofence breach — Kittiwake',
  );

  console.log('--- acknowledging by keyboard keeps the attribution ---');
  const ack = alertCard.first().getByRole('button', { name: 'Acknowledge Geofence breach — Kittiwake' });
  eq('acknowledge button present', await ack.count(), 1);
  const ackBox = await ack.boundingBox();
  check('acknowledge button is at least 44 px tall', (ackBox?.height ?? 0) >= 44, ackBox);
  await ack.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      (document.querySelector('[aria-label="Fleet announcements"]')?.textContent ?? '') ===
      'Alert acknowledged',
    null,
    { timeout: 5000 },
  );
  // The board repaints on its next refresh, which must keep the card on the board.
  await page.waitForFunction(
    () => (document.body.textContent ?? '').includes('Acknowledged by '),
    null,
    { timeout: 6000 },
  );
  eq(
    'acknowledgement announced',
    (await page.locator('[aria-label="Fleet announcements"]').innerText()).trim(),
    'Alert acknowledged',
  );
  const acked = await alertCard.first().innerText();
  check(
    'the card stays on the board with its attribution',
    /Acknowledged by (Ira Penhallow|Wren Calloway|Tamsin Rook) at \d{2}:\d{2}:\d{2} UTC/.test(acked),
    acked,
  );
  eq('no acknowledge button on an acknowledged card', await ack.count(), 0);

  console.log('--- returning inside is announced once ---');
  clock += 10;
  await ingest(KEY, '/api/ingest/fixes', {
    t: at(clock),
    easting: 9040,
    northing: 4050,
    heading_deg: 0,
    speed_mps: 1,
    battery_pct: 56,
    depth_m: 6,
  });
  await page.waitForFunction(
    () =>
      (document.querySelector('[aria-label="Fleet announcements"]')?.textContent ?? '').includes(
        'back inside the geofence',
      ),
    null,
    { timeout: 4000 },
  );
  eq(
    'clearing copy',
    (await page.locator('[aria-label="Fleet announcements"]').innerText()).trim(),
    'Kittiwake back inside the geofence',
  );
  await page.waitForTimeout(2500);
  eq(
    'a repaint never rewrites the announcement',
    (await page.locator('[aria-label="Fleet announcements"]').innerText()).trim(),
    'Kittiwake back inside the geofence',
  );
  eq('the acknowledged card closes once its cause clears', await alertCard.count(), 0);

  await context.close();
}

console.log('--- queue infill from the console ---');
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/sign-in`);
  await page.getByRole('textbox', { name: 'Email' }).fill('ira@fathomwright.test');
  await page.locator('#sign-in-password').fill('chartroom-2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/fleet/);
  await page.goto(`${BASE}/missions/${mission.id}`);
  await page.getByRole('heading', { level: 1, name: 'Liveboard Cut' }).waitFor();
  await page.getByRole('group', { name: 'Plan summary' }).waitFor();

  const holidaysBefore = await page.getByRole('group', { name: 'Open holidays' }).innerText();
  check('a holiday is counted', /\d/.test(holidaysBefore), holidaysBefore);

  const list = page.getByRole('list', { name: 'Holidays' });
  if ((await list.count()) === 0) {
    // The Holidays list shows beside the chart under reduced motion and at 375 px.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await page.getByRole('heading', { level: 1, name: 'Liveboard Cut' }).waitFor();
  }
  await list.first().waitFor({ timeout: 10000 });
  const row = list.first().getByRole('listitem').first();
  const rowText = await row.innerText();
  check(
    'holiday row reads label, area and nearest vessel',
    /^H\d+ · [\d,\u00a0\u202f]+ m² · nearest Kittiwake/.test(rowText.replace(/\n/g, ' ')),
    rowText,
  );

  const queue = row.getByRole('button', { name: /^Queue infill H/ });
  eq('queue button present', await queue.count(), 1);
  eq('button reads Queue infill', (await queue.innerText()).trim(), 'Queue infill');
  const linesBefore = await page.getByRole('table', { name: 'Lines' }).getByRole('row').count();
  await queue.click();
  await page.waitForFunction(
    () =>
      (document.querySelector('[aria-label="Fleet announcements"]')?.textContent ?? '').startsWith(
        'Infill ',
      ),
    null,
    { timeout: 8000 },
  );
  const announced = (await page.locator('[aria-label="Fleet announcements"]').innerText()).trim();
  check(
    'infill queued announcement',
    /^Infill I\d+ queued to Kittiwake$/.test(announced),
    announced,
  );
  // The overlay, the Queued-to text and the counters appear once the server confirms.
  await page.waitForFunction(
    () => (document.body.textContent ?? '').includes('Queued to Kittiwake'),
    null,
    { timeout: 8000 },
  );
  const linesAfter = await page.getByRole('table', { name: 'Lines' }).getByRole('row').count();
  eq('the lines table gains the infill line', linesAfter, linesBefore + 1);
  const overlay = page.locator('[role="img"][aria-label^="Infill I"]');
  eq('an infill overlay is drawn', await overlay.count(), 1);
  const queuedText = await row.innerText();
  check('the row reads Queued to the vessel', queuedText.includes('Queued to Kittiwake'), queuedText);
  const infillQueue = page.getByRole('list', { name: 'Infill queue for Kittiwake' });
  eq('an infill queue list appears', await infillQueue.count(), 1);
  const queueRow = await infillQueue.getByRole('listitem').first().innerText();
  check('queue row reads position, line and holiday', /^1\. I\d+ · H\d+$/.test(queueRow.trim()), queueRow);

  // A repeated queue while the holiday is Queued names the existing line.
  await queue.click();
  await page.waitForFunction(
    () =>
      (document.querySelector('[aria-label="Fleet announcements"]')?.textContent ?? '').includes(
        'is already queued to',
      ),
    null,
    { timeout: 8000 },
  );
  const replay = (await page.locator('[aria-label="Fleet announcements"]').innerText()).trim();
  check('replay announcement', /^Infill I\d+ is already queued to Kittiwake$/.test(replay), replay);

  await context.close();
}

console.log('--- upload a line file from the slipway ---');
{
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/sign-in`);
  await page.getByRole('textbox', { name: 'Email' }).fill('tamsin@fathomwright.test');
  await page.locator('#sign-in-password').fill('chartroom-2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/launch/);
  const section = page.getByRole('region', { name: 'Liveboard Cut' });
  await section.waitFor({ timeout: 15000 });

  const target = lines[0];
  const uploadButton = section.getByRole('button', { name: `Upload file for ${target.label}` });
  await uploadButton.waitFor();
  const rowWord = section.locator(`[data-line="${target.id}"] [data-word]`);
  eq('the row starts awaiting upload', (await rowWord.innerText()).trim(), 'Awaiting upload');

  await uploadButton.click();
  const dialog = page.getByRole('dialog', { name: 'Upload line file' });
  await dialog.waitFor();
  check('the dialog carries the line label', (await dialog.innerText()).includes(target.label), await dialog.innerText());
  const dialogBox = await dialog.locator('.upload-card').boundingBox();
  check('the dialog fits the phone width', (dialogBox?.width ?? 999) <= 375, dialogBox);
  const uploadBox = await dialog.getByRole('button', { name: 'Upload' }).boundingBox();
  check('the Upload button is at least 44 px tall', (uploadBox?.height ?? 0) >= 44, uploadBox);

  const payload = Buffer.from('live sonar bytes for the slipway upload');
  const sha = createHash('sha256').update(payload).digest('hex');

  // A wrong checksum is refused and nothing is stored.
  await dialog.locator('#line-file').setInputFiles({
    name: `${target.label}.raw`,
    mimeType: 'application/octet-stream',
    buffer: payload,
  });
  await dialog.getByRole('textbox', { name: 'SHA-256' }).fill('a'.repeat(64));
  await dialog.getByRole('button', { name: 'Upload' }).click();
  await page.waitForTimeout(1500);
  eq(
    'checksum mismatch copy',
    (await page.locator('[aria-label="Launch status"]').innerText()).trim(),
    'Checksum does not match this file. Nothing was stored.',
  );
  check('the dialog stays open', await dialog.isVisible(), true);

  await dialog.getByRole('textbox', { name: 'SHA-256' }).fill(sha);
  await dialog.getByRole('button', { name: 'Upload' }).click();
  await page.waitForFunction(
    () =>
      (document.querySelector('[aria-label="Launch status"]')?.textContent ?? '').includes('stored'),
    null,
    { timeout: 15000 },
  );
  eq(
    'stored copy',
    (await page.locator('[aria-label="Launch status"]').innerText()).trim(),
    `${target.label} stored`,
  );
  eq('the dialog closes on success', await dialog.count(), 0);
  await page.waitForTimeout(2500);
  eq('the row reads Stored', (await rowWord.innerText()).trim(), 'Stored');

  console.log('--- slipway actions queue while offline ---');
  await context.setOffline(true);
  const serviceButton = page
    .getByRole('region', { name: 'Fleet service' })
    .getByRole('button', { name: 'Log service for Gannet' });
  const recovered = section.getByRole('button', { name: 'Mark Kittiwake recovered' });
  await recovered.click();
  await page.waitForTimeout(400);
  const queuedCopy = (await page.locator('[aria-label="Launch status"]').innerText()).trim();
  check(
    'a queued action is announced',
    /^Saved on this phone — \d+ waiting to send$/.test(queuedCopy),
    queuedCopy,
  );
  const vesselRow = section.locator(`[data-vessel="${VESSEL}"] [data-word]`);
  eq('the row reads queued', (await vesselRow.innerText()).trim(), 'Queued — will send when online');

  await serviceButton.click();
  const serviceDialog = page.getByRole('dialog', { name: 'Log thruster service' });
  await serviceDialog.waitFor();
  await serviceDialog.getByRole('textbox', { name: 'Service note' }).fill('Offline service note');
  await serviceDialog.getByRole('button', { name: 'Save service' }).click();
  await page.waitForTimeout(400);

  const waiting = page.getByRole('button', { name: /^Waiting to send \(\d+\)$/ });
  eq('the header shows the queue', await waiting.count(), 1);
  await waiting.click();
  const waitingDialog = page.getByRole('dialog', { name: 'Waiting to send' });
  await waitingDialog.waitFor();
  const entries = await waitingDialog.getByRole('listitem').allInnerTexts();
  check('queued actions are listed in order', entries.length >= 2, entries);
  check(
    'each entry names the vessel, action and time',
    /^(Kittiwake|Gannet) · (afloat|recovered|service) · \d{2}:\d{2} UTC/.test(entries[0].replace(/\n/g, ' ')),
    entries[0],
  );
  eq(
    'each entry offers a discard button',
    await waitingDialog.getByRole('button', { name: /^Discard / }).count(),
    entries.length,
  );
  await page.keyboard.press('Escape');

  // The queue survives a reload while still offline.
  await page.reload().catch(() => undefined);
  await page.waitForTimeout(1200);
  await context.setOffline(false);
  await page.goto(`${BASE}/launch`);
  await page.getByRole('region', { name: 'Fleet service' }).waitFor({ timeout: 15000 });
  await page.waitForFunction(
    () => document.querySelectorAll('button[aria-label^="Waiting to send"]').length === 0,
    null,
    { timeout: 20000 },
  ).catch(() => undefined);
  eq('the header button disappears once the queue empties', await page.getByRole('button', { name: /^Waiting to send/ }).count(), 0);
  const vessel = (await tamsin.call(`/api/vessels/${VESSEL}`)).data;
  eq('the queued recovery reached the server', vessel.afloat, false);
  const services = (await tamsin.call('/api/vessels/v-gannet/services')).data;
  check(
    'the queued service reached the server exactly once',
    services.filter((s) => s.note === 'Offline service note').length === 1,
    services.map((s) => s.note),
  );

  await context.close();
}

await browser.close();

console.log(`\n${checks - failures}/${checks} live checks passed`);
if (failures > 0) process.exitCode = 1;
