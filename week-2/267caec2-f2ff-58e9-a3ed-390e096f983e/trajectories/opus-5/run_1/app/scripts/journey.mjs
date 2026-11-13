import { chromium } from '/tmp/node_modules/playwright/index.mjs';
import { PNG } from '/app/node_modules/pngjs/lib/png.js';

const BASE = 'http://127.0.0.1:4173';
let failures = 0;
const log = (label, ok, extra) => {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${extra === undefined ? '' : ` -> ${extra}`}`);
  }
};

function shot(seed) {
  const image = new PNG({ width: 900, height: 700 });
  for (let i = 0; i < 900 * 700; i += 1) {
    image.data[i * 4] = (i * seed) % 255;
    image.data[i * 4 + 1] = (i * 17) % 255;
    image.data[i * 4 + 2] = (i * 31) % 255;
    image.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(image);
}

async function signIn(page, email, password) {
  await page.goto(`${BASE}/signin`);
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(900);
}

async function signOut(page) {
  const button = page.getByRole('button', { name: 'Sign out' });
  if ((await button.count()) > 0) {
    await button.click();
    await page.waitForTimeout(600);
  }
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  console.log('DP-32 entrant journey');
  await signIn(page, 'desk@monoharbour.example', 'monoharbour-pass-26');
  log('studio home', page.url().endsWith('/studio'));
  await page.getByRole('button', { name: 'New entry' }).click();
  await page.waitForTimeout(600);
  await page.getByRole('combobox', { name: 'Category' }).selectOption({ label: 'Portfolio' });
  await page.getByRole('textbox', { name: 'Title' }).fill('Harbour Lights');
  await page.getByRole('textbox', { name: 'Case study' }).fill('A slow, typographic case study for a harbour museum.');
  await page.getByRole('textbox', { name: 'Site address' }).fill('https://harbourlights.example');
  await page.getByRole('textbox', { name: 'Credits' }).fill('Kit Okonkwo, Mono Harbour');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForTimeout(1200);
  log('draft saved message', (await page.getByRole('status', { name: 'Desk status' }).textContent()) === 'Draft saved.');

  const feeRegion = page.getByRole('region', { name: 'Fee' });
  log('fee region', (await feeRegion.count()) === 1);
  const feeText = (await feeRegion.textContent()) ?? '';
  log('fee copy', feeText.includes('Entry fee $45.00 (Early-bird)'), feeText.slice(0, 120));
  log('deadline label in fee panel', /Entries close 23:59 Asia\/Kolkata, \d{1,2} \w{3} \d{4}/.test(feeText), feeText);

  await page.setInputFiles('#entry-files', [
    { name: 'one.png', mimeType: 'image/png', buffer: shot(3) },
    { name: 'two.png', mimeType: 'image/png', buffer: shot(5) },
    { name: 'three.png', mimeType: 'image/png', buffer: shot(7) },
  ]);
  await page.waitForTimeout(5000);
  const images = page.getByRole('list', { name: 'Case-study images' }).getByRole('listitem');
  log('three images listed', (await images.count()) === 3, await images.count());
  log('image alt text', (await page.getByRole('img', { name: 'Harbour Lights — image 1' }).count()) === 1);
  log('remove button', (await page.getByRole('button', { name: 'Remove image 1' }).count()) === 1);
  const statusAfterUpload = (await page.getByRole('status', { name: 'Desk status' }).textContent()) ?? '';
  log('upload success copy', /added, 900 × 700 pixels\.$/.test(statusAfterUpload), statusAfterUpload);

  await page.getByRole('button', { name: 'Pay $45.00 and submit' }).click();
  await page.waitForTimeout(6000);
  log('status submitted', ((await page.locator('main').textContent()) ?? '').includes('Status: Submitted'));
  const receipt = page.getByRole('region', { name: 'Receipt' });
  log('receipt region', (await receipt.count()) === 1);
  const receiptText = (await receipt.textContent()) ?? '';
  log('receipt amount and tier', receiptText.includes('$45.00') && receiptText.includes('Early-bird'), receiptText.slice(0, 120));
  log('receipt invoice id', /Invoice [0-9a-f-]{36}/.test(receiptText), receiptText);

  console.log('DP-40 dialog focus');
  const secondContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const second = await secondContext.newPage();
  await signIn(second, 'hello@fieldnote.example', 'fieldnote-pass-26');
  await second.getByRole('button', { name: 'New entry' }).click();
  await second.waitForTimeout(600);
  await second.getByRole('combobox', { name: 'Category' }).selectOption({ label: 'Portfolio' });
  await second.getByRole('textbox', { name: 'Title' }).fill('Paper Trails');
  await second.getByRole('textbox', { name: 'Case study' }).fill('Editorial systems for a quarterly.');
  await second.getByRole('textbox', { name: 'Site address' }).fill('https://papertrails.example');
  await second.getByRole('button', { name: 'Save draft' }).click();
  await second.waitForTimeout(1200);
  await second.setInputFiles('#entry-files', [{ name: 'a.png', mimeType: 'image/png', buffer: shot(11) }]);
  await second.waitForTimeout(3000);
  const opener = second.getByRole('button', { name: 'Delete draft' }).first();
  await opener.click();
  await second.waitForTimeout(400);
  const dialog = second.getByRole('dialog', { name: 'Delete this draft?' });
  log('dialog opens', (await dialog.count()) === 1);
  log('focus on safe button', (await second.evaluate(() => document.activeElement?.textContent?.trim())) === 'Keep draft');
  await second.keyboard.press('Escape');
  await second.waitForTimeout(300);
  log('escape closes', (await second.getByRole('dialog').count()) === 0);
  log('focus returns', (await second.evaluate(() => document.activeElement?.textContent?.trim())) === 'Delete draft');
  await second.getByRole('button', { name: 'Pay $45.00 and submit' }).click();
  await second.waitForTimeout(6000);

  console.log('DP-34 director judging journey');
  const directorContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const director = await directorContext.newPage();
  await signIn(director, 'director@cutline.example', 'director-pass-26');
  log('director home', director.url().endsWith('/director'));
  await director.getByRole('link', { name: 'Cutline Open Call' }).click();
  await director.waitForTimeout(1200);
  await director.getByLabel('Entries close').fill('2024-01-10');
  await director.getByLabel('Early-bird ends').fill('2024-01-01');
  await director.getByRole('button', { name: 'Update dates' }).click();
  await director.waitForTimeout(1200);
  log('dates updated', (await director.getByRole('status', { name: 'Desk status' }).textContent()) === 'Dates updated.');

  await director.getByRole('link', { name: 'Portfolio', exact: true }).first().click();
  await director.waitForTimeout(1200);
  log('screening table', (await director.getByRole('table', { name: 'Entries' }).count()) === 1);
  const pass = director.getByRole('button', { name: /^Pass Entry \d+$/ });
  const passCount = await pass.count();
  for (let i = 0; i < passCount; i += 1) {
    await director.getByRole('button', { name: /^Pass Entry \d+$/ }).first().click();
    await director.waitForTimeout(1200);
  }
  log('entries screened', (await director.getByRole('button', { name: /^Pass Entry \d+$/ }).count()) === 0);

  const programs = await director.evaluate(async () => (await fetch('/api/programs')).json());
  const openProgram = programs.programs.find((item) => item.name === 'Cutline Open Call');
  const portfolio = openProgram.categories.find((item) => item.name === 'Portfolio');
  await director.goto(`${BASE}/director/programs/${openProgram.id}`);
  await director.waitForTimeout(1200);
  await director.getByRole('link', { name: 'Portfolio — Round 1' }).click();
  await director.waitForTimeout(1200);
  log('panel table', (await director.getByRole('table', { name: 'Panel' }).count()) === 1);
  await director.getByRole('combobox', { name: 'Add juror' }).selectOption({ label: 'Teo Brandt' });
  await director.getByRole('button', { name: 'Add to panel' }).click();
  await director.waitForTimeout(1200);
  await director.getByRole('combobox', { name: 'Add juror' }).selectOption({ label: 'Priya Raman' });
  await director.getByRole('button', { name: 'Add to panel' }).click();
  await director.waitForTimeout(1200);
  log('panel has two jurors', (await director.getByRole('table', { name: 'Panel' }).getByRole('row').count()) === 3);
  await director.getByLabel('Ballot deadline').fill('2030-01-01');
  await director.getByRole('button', { name: 'Open round' }).click();
  await director.waitForTimeout(2500);
  log('round opened', ((await director.locator('main').textContent()) ?? '').includes('State: open'));
  log('countdown shown', (await director.getByRole('timer', { name: 'Time remaining' }).count()) === 1);
  log('provisional label', (await director.getByText('Provisional', { exact: true }).count()) === 1);

  console.log('DP-33 juror journey');
  const jurorContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const juror = await jurorContext.newPage();
  await signIn(juror, 'teo@jury.example', 'juror-pass-26');
  log('jury home', juror.url().endsWith('/jury'));
  await juror.getByRole('link', { name: 'Portfolio — Round 1' }).click();
  await juror.waitForTimeout(1200);
  const blind = (await juror.locator('main').textContent()) ?? '';
  log('blind ballot hides studio', !blind.includes('Mono Harbour') && !blind.includes('Kit Okonkwo'), blind.slice(0, 200));
  const articles = juror.getByRole('article');
  const entryCount = await articles.count();
  log('entries on ballot', entryCount >= 1, entryCount);
  for (let i = 0; i < entryCount; i += 1) {
    const article = articles.nth(i);
    await article.getByRole('spinbutton', { name: 'Craft' }).fill(String(9 - i * 3));
    await article.getByRole('spinbutton', { name: 'Clarity' }).fill('7');
    await article.getByRole('spinbutton', { name: 'Idea' }).fill(String(9 - i * 2));
    await article.getByRole('spinbutton', { name: 'Story' }).fill('6');
    await article.getByRole('button', { name: /^Save scores for Entry \d+$/ }).click();
    await juror.waitForTimeout(1200);
  }
  log('all scored', ((await juror.locator('.ballot-bar').textContent()) ?? '').includes(`${entryCount} of ${entryCount} scored`));
  await juror.getByRole('button', { name: 'Submit final ballot' }).click();
  await juror.waitForTimeout(400);
  await juror.getByRole('button', { name: 'Submit ballot' }).click();
  await juror.waitForTimeout(1500);
  log('ballot submitted', ((await juror.locator('main').textContent()) ?? '').includes('Ballot submitted'));

  console.log('DP-36 standings shuffle');
  await director.reload({ waitUntil: 'networkidle' });
  await director.waitForTimeout(2500);
  const standings = director.getByRole('table', { name: 'Standings' });
  const rowCount = await standings.getByRole('row').count();
  if (rowCount <= 1) await director.screenshot({ path: '/tmp/shot-fail.png', fullPage: true });
  log('standings rows', rowCount > 1, `${rowCount} | ${director.url()}`);
  log('shortlist separator', (await director.getByRole('separator', { name: 'Shortlist cut' }).count()) === 1);

  await director.getByRole('button', { name: 'Close round' }).click();
  await director.waitForTimeout(400);
  log('close dialog', (await director.getByRole('dialog', { name: 'Close Round 1?' }).count()) === 1);
  await director.getByRole('dialog').getByRole('button', { name: 'Close round' }).click();
  await director.waitForTimeout(2000);
  log('round closed', ((await director.locator('main').textContent()) ?? '').includes('State: closed'));
  await director.getByRole('button', { name: 'Confirm standings' }).click();
  await director.waitForTimeout(2000);
  const confirmCopy = (await director.getByRole('status', { name: 'Desk status' }).textContent()) ?? '';
  log('confirm copy', /^Standings confirmed: \d+ above the cut, \d+ below\.$/.test(confirmCopy), confirmCopy);

  console.log('final round + publish');
  await director.goto(`${BASE}/director/programs/${openProgram.id}`);
  await director.waitForTimeout(1200);
  await director.getByRole('link', { name: 'Portfolio — Final round' }).click();
  await director.waitForTimeout(1200);
  await director.getByRole('combobox', { name: 'Add juror' }).selectOption({ label: 'Teo Brandt' });
  await director.getByRole('button', { name: 'Add to panel' }).click();
  await director.waitForTimeout(1200);
  await director.getByLabel('Ballot deadline').fill('2030-02-01');
  await director.getByRole('button', { name: 'Open round' }).click();
  await director.waitForTimeout(2500);

  await juror.goto(`${BASE}/jury`);
  await juror.waitForTimeout(1000);
  await juror.getByRole('link', { name: 'Portfolio — Final round' }).click();
  await juror.waitForTimeout(1200);
  const finalArticles = juror.getByRole('article');
  const finalCount = await finalArticles.count();
  for (let i = 0; i < finalCount; i += 1) {
    const article = finalArticles.nth(i);
    await article.getByRole('spinbutton', { name: 'Craft' }).fill(String(4 + i * 4));
    await article.getByRole('spinbutton', { name: 'Clarity' }).fill('7');
    await article.getByRole('spinbutton', { name: 'Idea' }).fill(String(3 + i * 3));
    await article.getByRole('spinbutton', { name: 'Story' }).fill('8');
    await article.getByRole('button', { name: /^Save scores for Entry \d+$/ }).click();
    await juror.waitForTimeout(1200);
  }
  await juror.getByRole('button', { name: 'Submit final ballot' }).click();
  await juror.waitForTimeout(400);
  await juror.getByRole('button', { name: 'Submit ballot' }).click();
  await juror.waitForTimeout(1500);

  await director.reload({ waitUntil: 'networkidle' });
  await director.waitForTimeout(1500);
  await director.getByRole('button', { name: 'Close round' }).click();
  await director.waitForTimeout(400);
  await director.getByRole('dialog').getByRole('button', { name: 'Close round' }).click();
  await director.waitForTimeout(2000);
  await director.getByRole('button', { name: 'Confirm standings' }).click();
  await director.waitForTimeout(2000);
  log('winner marker', (await director.getByText('Winner', { exact: true }).count()) >= 1);

  console.log('DP-35 public reveal journey');
  const visitorContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const visitor = await visitorContext.newPage();
  await visitor.goto(BASE, { waitUntil: 'networkidle' });
  await visitor.waitForTimeout(800);

  await director.goto(`${BASE}/director/categories/${portfolio.id}`);
  await director.waitForTimeout(1500);
  const embargo = new Date(Date.now() + 9000);
  const pad = (value) => String(value).padStart(2, '0');
  const local = new Date(embargo.getTime() + 5.5 * 3600 * 1000);
  const embargoText = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}+05:30`;
  await director.getByRole('textbox', { name: /^Embargo time/ }).fill(embargoText);
  await director.getByRole('button', { name: 'Publish results' }).click();
  await director.waitForTimeout(400);
  await director.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await director.waitForTimeout(1500);
  const publishCopy = (await director.getByRole('status', { name: 'Desk status' }).textContent()) ?? '';
  log('publish copy', /^Results scheduled for \d{2}:\d{2} Asia\/Kolkata, /.test(publishCopy), publishCopy);

  await visitor.getByRole('combobox', { name: 'Program' }).selectOption({ label: 'Cutline Open Call' });
  await visitor.waitForTimeout(1500);
  const embargoed = (await visitor.locator('main').textContent()) ?? '';
  log('embargo notice', /Reveals at \d{2}:\d{2} Asia\/Kolkata/.test(embargoed), embargoed.slice(0, 200));
  log('countdown on leaderboard', (await visitor.getByRole('timer', { name: 'Time remaining' }).count()) === 1);

  await visitor.waitForTimeout(16000);
  const revealed = (await visitor.locator('main').textContent()) ?? '';
  log('revealed rows', revealed.includes('Winner'), revealed.slice(0, 300));
  const announce = (await visitor.getByRole('status', { name: 'Standings updates' }).textContent()) ?? '';
  log('reveal announcement', announce.length > 0, announce);

  await visitor.getByRole('link', { name: 'Gallery' }).click();
  await visitor.waitForTimeout(1200);
  await visitor.getByRole('combobox', { name: 'Award level' }).selectOption('winner');
  await visitor.waitForTimeout(1000);
  const gallery = (await visitor.locator('main').textContent()) ?? '';
  log('new winner in gallery', gallery.includes('Harbour Lights') || gallery.includes('Paper Trails'), gallery.slice(0, 300));

  await signOut(page);
  await browser.close();
  console.log(failures === 0 ? '\nJOURNEY CHECKS PASSED' : `\n${failures} JOURNEY CHECKS FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
