// Second browser pass: drag with snapping, phone timeline, two browsers, holidays, links.

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

  // --- Drag Review brief 64px right: lands Sat 6 Mar, snaps to Mon 8 Mar.
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (error) => {
    console.log('PAGE ERROR', error.message);
    process.exitCode = 1;
  });
  await signIn(page, 'asha@slackwater.test', 'asha-plans-2027');
  await openSpring(page);
  const reviewBar = page.locator('.bar[aria-label="Review brief"]');
  const box = await reviewBar.boundingBox();
  if (box !== null) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 32, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(box.x + box.width / 2 + 64, box.y + box.height / 2, { steps: 4 });
    const tip = await page.textContent('#drag-tip');
    check('drag tip', tip === 'Mon 8 Mar 2027 - Tue 9 Mar 2027', String(tip));
    await page.mouse.up();
    await page.waitForFunction(() => (document.getElementById('schedule-updates')?.textContent ?? '').includes('now starts'), { timeout: 8000 });
    const schedule = await page.textContent('#schedule-updates');
    check(
      'drag move announcement',
      schedule === 'Review brief now starts Mon 8 Mar 2027 and ends Tue 9 Mar 2027. No dependent tasks moved. Project finishes Tue 16 Mar 2027.',
      String(schedule),
    );
  } else {
    check('review bar found', false);
  }

  // --- Escape cancels a drag.
  const box2 = await reviewBar.boundingBox();
  if (box2 !== null) {
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.mouse.down();
    await page.mouse.move(box2.x + box2.width / 2 + 32, box2.y + box2.height / 2, { steps: 4 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    const still = await page.getAttribute('.bar[aria-label="Review brief"]', 'data-start');
    check('escape cancels drag', still === '2027-03-08', String(still));
  }

  // --- Resize with the end handle across the holiday.
  const box3 = await reviewBar.boundingBox();
  if (box3 !== null) {
    await page.mouse.move(box3.x + box3.width - 4, box3.y + box3.height / 2);
    await page.mouse.down();
    await page.mouse.move(box3.x + box3.width + 60, box3.y + box3.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(() => (document.getElementById('schedule-updates')?.textContent ?? '').includes('now lasts'), { timeout: 8000 });
    const resize = await page.textContent('#schedule-updates');
    check(
      'resize announcement',
      resize === 'Review brief now lasts 3 working days and ends Thu 11 Mar 2027. 2 dependent tasks moved. Project finishes Wed 17 Mar 2027.',
      String(resize),
    );
  } else {
    check('review bar for resize', false);
  }

  // --- Holidays dialog by keyboard.
  await page.click('#holidays-button');
  await page.waitForSelector('dialog[aria-label="Holidays"]');
  await page.fill('dialog input[name="date"]', '2027-03-15');
  await page.fill('dialog input[name="name"]', 'Quiet day');
  await page.click('text=Add holiday');
  await page.waitForFunction(() => (document.getElementById('schedule-updates')?.textContent ?? '').includes('Holiday Quiet day'), { timeout: 8000 });
  const holiday = await page.textContent('#schedule-updates');
  check(
    'holiday announcement',
    holiday === 'Holiday Quiet day added. 2 tasks moved. Project finishes Thu 18 Mar 2027.',
    String(holiday),
  );
  const designStart = await page.getAttribute('.bar[aria-label="Design pages"]', 'data-start');
  check('holiday marked in header', designStart === '2027-03-12', String(designStart));
  await page.keyboard.press('Escape');

  // --- Add link dialog with L.
  await page.locator('.bar[aria-label^="Draft brief"]').click();
  await page.keyboard.press('l');
  await page.waitForSelector('dialog[aria-label="Add link"]');
  const heading = await page.textContent('dialog h2');
  check('link dialog heading', heading === 'Link from Draft brief', String(heading));
  // Draft brief -> Write copy already exists: choosing it shows the duplicate alert.
  await page.fill('dialog input[name="successor"]', 'Write copy');
  await page.keyboard.press('Enter');
  await page.click('dialog button[type="submit"]');
  await page.waitForFunction(() => (document.querySelector('#link-alert')?.textContent ?? '') !== '', { timeout: 8000 });
  const linkAlert = await page.textContent('#link-alert');
  check('duplicate link refused', linkAlert === 'Those tasks are already linked.', String(linkAlert));
  await page.keyboard.press('Escape');

  // --- Two browsers: a live update appears without a reload.
  const viewer = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  viewer.on('pageerror', (error) => {
    console.log('VIEWER PAGE ERROR', error.message);
    process.exitCode = 1;
  });
  await signIn(viewer, 'devi@slackwater.test', 'devi-plans-2027');
  await openSpring(viewer);
  const peopleBefore = await viewer.textContent('#people-here');
  check('people here lists both', (peopleBefore ?? '').includes('Devi Shah (you)') && (peopleBefore ?? '').includes('Asha Rao'), String(peopleBefore));

  // Asha moves Design pages by keyboard; Devi's chart must update live.
  const designBar = page.locator('.bar[aria-label="Design pages"]');
  const beforeStart = await viewer.getAttribute('.bar[aria-label="Design pages"]', 'data-start');
  await designBar.click();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => (document.getElementById('schedule-updates')?.textContent ?? '').includes('Design pages'), { timeout: 8000 });
  await viewer.waitForFunction(
    (previous) => document.querySelector('.bar[aria-label="Design pages"]')?.getAttribute('data-start') !== previous,
    beforeStart,
    { timeout: 5000 },
  );
  const viewerStart = await viewer.getAttribute('.bar[aria-label="Design pages"]', 'data-start');
  check('live update in second browser', viewerStart !== null && viewerStart !== beforeStart, `${beforeStart} -> ${viewerStart}`);
  const viewerUpdate = await viewer.textContent('#project-updates');
  check('project updates announcement', viewerUpdate === 'Asha Rao changed Design pages.', String(viewerUpdate));

  // The viewer cannot change anything.
  await viewer.locator('.bar[aria-label="Design pages"]').click({ force: true });
  await viewer.keyboard.press('ArrowRight');
  await viewer.waitForFunction(() => (document.getElementById('schedule-updates')?.textContent ?? '') === 'You can view this project but not change it.', { timeout: 4000 });
  const readOnly = await viewer.textContent('#schedule-updates');
  check('viewer read-only message', readOnly === 'You can view this project but not change it.', String(readOnly));

  // --- Phone timeline.
  const phone = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await signIn(phone, 'ben@slackwater.test', 'ben-plans-2027');
  await openSpring(phone);
  await phone.waitForSelector('.timeline-card');
  const cards = await phone.$$eval('.timeline-card', (nodes) => nodes.length);
  check('phone timeline cards', cards >= 6, String(cards));
  const hasUpdate = await phone.locator('button:text("Update progress for Draft brief")').count();
  check('phone update button', hasUpdate === 1, String(hasUpdate));
  const sideways = await phone.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check('phone never scrolls sideways', sideways === false, String(sideways));

  // Update progress on the phone.
  await phone.click('text=Update progress for Draft brief');
  await phone.waitForSelector('dialog[aria-label="Update progress"]');
  const sliderValue = await phone.getAttribute('dialog input[type="range"]', 'value');
  check('slider starts at task percent', sliderValue === '20', String(sliderValue));
  await phone.keyboard.press('ArrowRight');
  await phone.keyboard.press('ArrowRight');
  const output = await phone.textContent('dialog output');
  check('slider steps by 5', output === '30%', String(output));
  await phone.click('text=Save progress');
  await phone.waitForFunction(() => (document.getElementById('schedule-updates')?.textContent ?? '').includes('% complete'), { timeout: 8000 });
  const progress = await phone.textContent('#schedule-updates');
  check('progress announcement', progress === 'Draft brief is 30% complete.', String(progress));

  await browser.close();
}

void main();
