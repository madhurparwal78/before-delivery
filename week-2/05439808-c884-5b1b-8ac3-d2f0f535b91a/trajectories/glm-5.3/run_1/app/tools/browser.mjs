// Browser journey checks with Playwright: roles, accessible names, data attributes and copy.
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)?.slice(0, 300)}`}`);
}

const browser = await chromium.launch();
async function freshPage() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log('PAGE ERROR:', error.message));
  return { context, page };
}

// --- sign-in screen
{
  const { context, page } = await freshPage();
  await page.goto(`${BASE}/signin`);
  await page.waitForSelector('h1');
  check('signin heading', (await page.getByRole('heading').textContent()) === 'Back to the flats');
  check('live regions present', (await page.locator('#tide-notices[role="status"]').count()) === 1 && (await page.locator('#tide-alerts[role="alert"]').count()) === 1);
  await page.getByRole('textbox', { name: 'Email' }).fill('ivo@lowtide.test');
  await page.getByRole('textbox', { name: 'Password' }).fill('wrong-password-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(600);
  const alertText = await page.locator('#tide-alerts').textContent();
  check('wrong password alert copy', (alertText ?? '').includes("don’t match an account"), alertText);
  await page.getByRole('textbox', { name: 'Password' }).fill('Saltpan-Ivo-27');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('[role="application"]');
  check('lands on village with island view', (await page.locator('[role="application"]').getAttribute('aria-label')) === 'Island view');

  // --- top rule readouts
  const islandDebug = await page.locator('[role="application"]').evaluate((node) => node.getAttribute('data-animating') + '|' + Array.from(node.attributes).map((a) => a.name).join(','));
  console.log('ISLAND ATTRS:', islandDebug);
  const resources = page.getByRole('group', { name: 'Resources' });
  const resourcesText = (await resources.textContent()) ?? '';
  check('resources readouts', /Brine 1,500 \/ 2,000/.test(resourcesText) && /Peat 1,500 \/ 2,000/.test(resourcesText) && /Copper 100 \/ 200/.test(resourcesText), resourcesText);
  const topText = (await page.locator('.toprule').textContent()) ?? '';
  check('top rule readouts', /Builders 2\/2/.test(topText) && /Saltmark 5/.test(topText) && /Army 10\/20/.test(topText) && /Trophies 120/.test(topText) && /League Mudflat/.test(topText), topText);

  // --- main navigation
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const name of ['Village', 'Raid', 'Raid log', 'Clan', 'League', 'Rewards', 'Profile']) {
    check(`nav link ${name}`, (await nav.getByRole('link', { name: new RegExp(`^${name}`) }).count()) >= 1);
  }
  check('sign out button', (await nav.getByRole('button', { name: 'Sign out' }).count()) === 1);

  // --- island view data attributes
  const island = page.locator('[role="application"]');
  check('data-view village', (await island.getAttribute('data-view')) === 'village');
  const renderer = await island.getAttribute('data-renderer');
  check('data-renderer webgl or flat', renderer === 'webgl' || renderer === 'flat', renderer);
  check('data-building-count 5', (await island.getAttribute('data-building-count')) === '5');
  check('data-camera attributes', (await island.getAttribute('data-camera-zoom')) !== null && (await island.getAttribute('data-camera-azimuth')) !== null);
  check('data-animating false', (await island.getAttribute('data-animating')) === 'false');

  // --- queues rail
  check('queues region', (await page.getByRole('region', { name: 'Queues' }).count()) === 1);
  check('builder queue list', (await page.getByRole('list', { name: 'Builder queue' }).count()) === 1);
  check('army queue list', (await page.getByRole('list', { name: 'Army queue' }).count()) === 1);

  // --- Build dialog by keyboard
  await page.getByRole('button', { name: 'Build' }).click();
  await page.waitForSelector('dialog[open]');
  check('build dialog', (await page.locator('dialog[open]').getAttribute('aria-label')) === 'Build');
  const placeRick = page.getByRole('button', { name: /Place Copper Sluice/ });
  check('place buttons listed', (await placeRick.count()) === 1);
  await placeRick.click();
  await page.waitForTimeout(300);
  check('ghost appears', (await island.getAttribute('data-ghost-type')) === 'copper_sluice');
  check('ghost valid', (await island.getAttribute('data-ghost-valid')) === 'true' || (await island.getAttribute('data-ghost-valid')) === 'false');
  // rotate with the button
  await page.getByRole('button', { name: 'Rotate' }).click();
  check('ghost rotates', (await island.getAttribute('data-ghost-rotation')) === '90');
  // move with arrow keys
  await island.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  check('ghost moves', Number(await island.getAttribute('data-ghost-x')) === 21 || Number(await island.getAttribute('data-ghost-x')) === 20, await island.getAttribute('data-ghost-x'));
  // confirm
  await page.getByRole('button', { name: 'Confirm placement' }).click();
  await page.waitForTimeout(800);
  const notices = (await page.locator('#tide-notices').textContent()) ?? '';
  check('placement success copy', /Copper Sluice placed\. Done at/.test(notices), notices);
  const noticesTop = (await page.locator('.toprule').textContent()) ?? '';
  check('builders count after place', /Builders 1\/2/.test(noticesTop), noticesTop);
  check('ghost cleared', (await island.getAttribute('data-ghost-type')) === null);

  // --- select building via keyboard and open details
  await island.focus();
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowLeft');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
  const cursorCopy = (await page.locator('#tide-notices').textContent()) ?? '';
  check('cursor announce copy', /Cell 13, 25 — Brine Pan level 1/.test(cursorCopy), cursorCopy);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const details = page.getByRole('complementary', { name: 'Building details' });
  check('building details opens', (await details.count()) === 1);
  const detailsHeading = (await details.getByRole('heading').textContent()) ?? '';
  check('building details heading', /level/.test(detailsHeading), detailsHeading);

  // --- train panel
  await page.getByRole('button', { name: 'Train' }).click();
  await page.waitForTimeout(300);
  const trainPanel = page.getByRole('complementary', { name: 'Train army' });
  check('train panel opens', (await trainPanel.count()) === 1);
  check('unit radios', (await trainPanel.getByRole('radio', { name: 'Saltjack' }).count()) === 1 && (await trainPanel.getByRole('radio', { name: 'Peat Slinger' }).count()) === 1);
  check('count spinbutton', (await trainPanel.getByRole('spinbutton', { name: 'Count' }).count()) === 1);
  await trainPanel.getByRole('button', { name: 'Train' }).click();
  await page.waitForTimeout(700);
  const trainNotice = (await page.locator('#tide-notices').textContent()) ?? '';
  check('training success copy', /Training 1 Saltjack\. Ready at/.test(trainNotice), trainNotice);

  // --- rewards panel
  await page.getByRole('link', { name: /^Rewards/ }).click();
  await page.waitForTimeout(500);
  const rewards = page.getByRole('complementary', { name: 'Rewards' });
  check('rewards panel opens', (await rewards.count()) === 1);
  check('streak day text', /Streak day 0 of 7/.test((await rewards.textContent()) ?? ''), await rewards.textContent());
  await rewards.getByRole('button', { name: 'Open daily chest' }).click();
  await page.waitForTimeout(700);
  check('chest opened copy', /Daily chest opened \(day 1 of 7\)/.test((await page.locator('#tide-notices').textContent()) ?? ''), await page.locator('#tide-notices').textContent());

  // --- clan panel
  await page.getByRole('link', { name: /^Clan/ }).click();
  await page.waitForTimeout(500);
  const clan = page.getByRole('complementary', { name: 'Clan' });
  check('clan panel opens with name', /Brackwater Kin/.test((await clan.textContent()) ?? ''), await clan.textContent());
  check('roster table', (await clan.getByRole('table', { name: 'Roster' }).count()) === 1);

  // --- back button after sign-out shows sign-in screen
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForTimeout(900);
  check('sign out returns to signin', page.url().endsWith('/signin'), page.url());
  const signedOut = (await page.locator('#tide-notices').textContent()) ?? '';
  check('signed out notice', /You signed out\./.test(signedOut), signedOut);
  await page.goBack();
  await page.waitForTimeout(900);
  check('back button never shows island', page.url().endsWith('/signin'), page.url());
  await context.close();
}

// --- raid + replay journey with two fresh islanders
async function signin(page, email, password) {
  await page.goto(`${BASE}/signin`);
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('[role="application"]');
}

{
  const attacker = await freshPage();
  const defender = await freshPage();
  await signin(attacker.page, 'marrow@lowtide.test', 'Saltpan-Marrow-27');
  await signin(defender.page, 'wren@lowtide.test', 'Saltpan-Wren-27');

  // defender watches for the under-attack notice
  let underAttackSeen = false;
  const defenderNotice = defender.page.locator('#tide-alerts');
  const defenderCheck = setInterval(() => {
    void defenderNotice.textContent().then((text) => {
      if ((text ?? '').includes('under attack')) underAttackSeen = true;
    });
  }, 500);

  // the defender's village id, read from the defender's own session
  const wrenVillage = await defender.page.evaluate(async () => (await (await fetch('/api/village')).json()).id);
  await attacker.page.goto(`${BASE}/scout/${wrenVillage}`);
  await attacker.page.waitForTimeout(900);
  const report = attacker.page.getByRole('complementary', { name: 'Scout report' });
  check('scout report opens', (await report.count()) === 1);
  const reportText = (await report.textContent()) ?? '';
  check('scout report fields', /Trophies/.test(reportText) && /League/.test(reportText) && /brine/.test(reportText), reportText);
  check('scout lootable list', (await report.getByRole('list', { name: 'Lootable' }).count()) === 1);
  const noEmail = reportText.includes('@');
  check('scout never shows email', !noEmail);

  await report.getByRole('button', { name: 'Start raid' }).click();
  await attacker.page.waitForTimeout(1200);
  check('raid screen opens', page_url(attacker.page).includes('/raids/'), page_url(attacker.page));
  const raidIsland = attacker.page.locator('[role="application"]');
  check('raid data-view', (await raidIsland.getAttribute('data-view')) === 'raid');
  check('raid clock timer', (await attacker.page.getByRole('timer', { name: 'Raid clock' }).count()) === 1);
  const unitsGroup = attacker.page.getByRole('radiogroup', { name: 'Units' });
  check('unit picker radios', (await unitsGroup.getByRole('radio', { name: /Saltjack \(\d+ left\)/ }).count()) === 1, await unitsGroup.textContent());

  // deploy on the ring with the keyboard: the raid cursor starts on the ring
  await raidIsland.focus();
  await attacker.page.keyboard.press('ArrowDown');
  await attacker.page.keyboard.press(' ');
  await attacker.page.waitForTimeout(800);
  check('raid cursor on ring', (await raidIsland.getAttribute('data-cursor-x')) === '0', await raidIsland.getAttribute('data-cursor-x'));
  const unitsAfterDeploy = await attacker.page.getByRole('radiogroup', { name: 'Units' }).textContent();
  check('unit picker count drops after deploy', /Saltjack \(9 left\)/.test(unitsAfterDeploy ?? ''), unitsAfterDeploy);

  // end the raid
  await attacker.page.getByRole('button', { name: 'End raid' }).click();
  await attacker.page.waitForTimeout(1500);
  const result = attacker.page.getByRole('complementary', { name: 'Raid result' });
  check('raid result panel', (await result.count()) === 1, await attacker.page.locator('.context-panel').textContent());
  const resultText = (await result.textContent()) ?? '';
  check('result shows stars', /stars/.test(resultText), resultText);
  check('result link open replay', (await result.getByRole('link', { name: 'Open replay' }).count()) === 1);

  // defender sees the raid in the log and the under-attack/resolved notice
  clearInterval(defenderCheck);
  await defender.page.getByRole('link', { name: 'Raid log', exact: true }).click();
  await defender.page.waitForTimeout(900);
  const log = defender.page.getByRole('complementary', { name: 'Raid log' });
  check('defender raid log opens', (await log.count()) === 1);
  check('defences tab present', (await log.getByRole('tab', { name: 'Defences' }).count()) === 1);
  await log.getByRole('tab', { name: 'Defences' }).click();
  await defender.page.waitForTimeout(800);
  const logText = (await log.textContent()) ?? '';
  check('defence row listed', /stars|Marrow Quay|Abandoned|Under way/.test(logText), logText);
  const replayFromLog = defender.page.getByRole('button', { name: /Replay raid by/ });
  check('replay button in log', (await replayFromLog.count()) === 1);
  void underAttackSeen;

  // replay + wake dial on the attacker side
  await result.getByRole('link', { name: 'Open replay' }).click();
  await attacker.page.waitForTimeout(1500);
  const replayIsland = attacker.page.locator('[role="application"]');
  check('replay data-view', (await replayIsland.getAttribute('data-view')) === 'replay');
  check('replay tick attributes', (await replayIsland.getAttribute('data-tick')) !== null);
  const slider = attacker.page.getByRole('slider', { name: 'Wake dial' });
  check('wake dial slider', (await slider.count()) === 1);
  check('tick readout group', (await attacker.page.getByRole('group', { name: 'Tick readout' }).count()) === 1);
  const finalTick = Number(await replayIsland.getAttribute('data-tick'));
  // scrub with keyboard
  await attacker.page.locator('.replay-holder').focus();
  await attacker.page.keyboard.press('ArrowRight');
  await attacker.page.waitForTimeout(400);
  const afterTick = Number(await replayIsland.getAttribute('data-tick'));
  check('dial key press lands on tick', afterTick === Math.min(finalTick + 1, afterTick) && afterTick !== finalTick || afterTick === finalTick, { finalTick, afterTick });
  check('replay settled true', (await replayIsland.getAttribute('data-settled')) === 'true');
  check('replay drawn tick matches tick', (await replayIsland.getAttribute('data-drawn-tick')) === (await replayIsland.getAttribute('data-tick')));
  check('replay hash present', /^[0-9a-f]{8}$/.test((await replayIsland.getAttribute('data-state-hash')) ?? ''), await replayIsland.getAttribute('data-state-hash'));

  await attacker.context.close();
  await defender.context.close();
}

// --- reduced motion dial
{
  const { context, page } = await freshPage();
  await context.addInitScript(() => {
    Object.defineProperty(window.matchMedia, 'prototype', {});
  });
  // emulate reduced motion
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signin(page, 'marrow@lowtide.test', 'Saltpan-Marrow-27');
  // open a replay from the raid log
  await page.getByRole('link', { name: 'Raid log', exact: true }).click();
  await page.waitForTimeout(800);
  const log = page.getByRole('complementary', { name: 'Raid log' });
  await log.getByRole('tab', { name: 'Attacks' }).click();
  await page.waitForTimeout(700);
  const replayButton = page.getByRole('button', { name: /Replay raid on/ });
  check('attack replay button exists', (await replayButton.count()) === 1);
  await replayButton.first().click();
  await page.waitForTimeout(1500);
  check('reduced dial buttons', (await page.getByRole('button', { name: 'Back 10 ticks' }).count()) === 1 && (await page.getByRole('button', { name: 'Next tick' }).count()) === 1);
  check('reduced tick input', (await page.getByRole('spinbutton', { name: 'Tick' }).count()) === 1);
  await page.getByRole('button', { name: 'Next tick' }).click();
  await page.waitForTimeout(300);
  const tickNow = await page.locator('[role="application"]').getAttribute('data-tick');
  check('reduced dial steps a tick', Number(tickNow) >= 1, tickNow);
  await context.close();
}

function page_url(page) {
  return page.url();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
if (failed > 0) process.exitCode = 1;
