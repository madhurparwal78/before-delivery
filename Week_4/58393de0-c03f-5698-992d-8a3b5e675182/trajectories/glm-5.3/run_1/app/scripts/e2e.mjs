// Browser E2E: verifies the landing page renders, roster works, Glancet
// opens, editors load, and hidden state elements appear.
import { chromium } from 'playwright-core';

const BASE = 'http://127.0.0.1:4173';
let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${extra}`); }
}

async function main() {
  const browser = await chromium.launch({
    executablePath: '/tmp/pw/chromium_headless_shell-1255/chrome-headless-shell-linux-arm64/chrome-headless-shell',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => { console.log('PAGE ERROR:', e.message); failures++; });

  // Seed first
  await fetch(`${BASE}/api/grading/seed`, { method: 'POST', headers: { 'X-Grading-Token': 'qy-grading-local' } });
  const seed = await (await fetch(`${BASE}/api/grading/seed`, { method: 'POST', headers: { 'X-Grading-Token': 'qy-grading-local' } })).json();

  // 1. Landing page
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const h1 = await page.textContent('h1');
  check('landing h1', h1 === 'Make a thing you can hold by Friday.', String(h1));
  const nav = await page.locator('nav[aria-label="Main"]').count();
  check('landing nav Main', nav === 1);
  const explore = await page.locator('text=Explore 3D Workshop').count();
  check('landing explore links', explore >= 1);
  const starters = await page.locator('text=Desk Name Tag').count();
  check('landing starter cards', starters >= 1);
  const footer = await page.locator('footer[role="contentinfo"]').count();
  check('landing footer', footer === 1);
  const buildPreview = await page.locator('[aria-label="Pause build preview"], [aria-label="Play build preview"]').count();
  check('landing build preview controls', buildPreview >= 1);
  const statsRegion = await page.locator('[aria-label="Classroom stats"]').count();
  check('landing stats region', statsRegion === 1);

  // 2. Sign in as educator via grading session
  await page.goto(`${BASE}/api/grading/session?user=${seed.educator.id}&token=qy-grading-local`, { waitUntil: 'networkidle' });
  check('educator redirected to dashboard', page.url().includes('/dashboard'), page.url());
  const classroomLink = await page.locator('text=Robotics Lab').count();
  check('dashboard lists classroom', classroomLink >= 1);

  // 3. Classroom page
  await page.goto(`${BASE}/classrooms/${seed.classroom.id}`, { waitUntil: 'networkidle' });
  const rosterItems = await page.locator('[role="list"][aria-label="Classroom roster"] li').count();
  check('roster has 2 tiles', rosterItems === 2, String(rosterItems));
  const watchBtn = await page.locator('[aria-label="Watch Tiny Turtle live"]').count();
  check('watch button named', watchBtn === 1);
  const sortSelect = await page.locator('#sort-roster').inputValue();
  check('sort preselected', sortSelect === 'Nickname (A–Z)', sortSelect);

  // 4. Glancet opens
  await page.locator('[aria-label="Watch Tiny Turtle live"]').click();
  await page.waitForTimeout(400);
  const glancet = await page.locator('[aria-label="Glancet: Tiny Turtle"]').count();
  check('glancet dialog opens', glancet === 1);
  const glancetState = await page.locator('#qy-glancet-state').getAttribute('data-revision');
  check('glancet hidden state revision', glancetState === '3', String(glancetState));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const glancetClosed = await page.locator('[aria-label="Glancet: Tiny Turtle"]').count();
  check('glancet closes on Escape', glancetClosed === 0);

  // 5. Join code dialog
  await page.locator('button:has-text("Show join code")').first().click();
  await page.waitForTimeout(200);
  const codeBoxes = await page.locator('.code-boxes .cb').count();
  check('join code boxes', codeBoxes === 6, String(codeBoxes));
  const codeText = (await page.locator('.code-boxes').getAttribute('aria-label')) ?? '';
  check('join code aria label', codeText.length === 6, codeText);
  await page.keyboard.press('Escape');

  // 6. Editor (student's Gear Box)
  const gearProject = seed.projects.find((p) => p.name === 'Gear Box' && p.ownerId === seed.students[0].id);
  await page.goto(`${BASE}/editor/${gearProject.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const scene = await page.locator('#qy-scene').count();
  check('scene hidden state present', scene === 1);
  const meshCount = await page.locator('#qy-scene').getAttribute('data-mesh-count');
  check('seed gear box mesh count 1', meshCount === '1', String(meshCount));
  const volume = await page.locator('#qy-scene [data-object-id]').getAttribute('data-volume');
  check('gear box volume 27979', volume === '27979', String(volume));
  const exportEl = await page.locator('#qy-export').count();
  check('export hidden state present', exportEl === 1);

  // 7. Add a shape via keyboard
  await page.locator('[aria-label="3D workplane"]').focus();
  await page.keyboard.press('b');
  await page.waitForTimeout(200);
  const meshCount2 = await page.locator('#qy-scene').getAttribute('data-mesh-count');
  check('box added via B', meshCount2 === '2', String(meshCount2));
  const selected = await page.locator('#qy-scene').getAttribute('data-selected');
  check('new shape selected', (selected ?? '').length > 0, String(selected));

  // 8. Undo removes it
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  const meshCount3 = await page.locator('#qy-scene').getAttribute('data-mesh-count');
  check('undo removes box', meshCount3 === '1', String(meshCount3));

  // 9. Status region
  const status = await page.locator('#qy-status[role="status"]').count();
  check('status region present', status === 1);

  // 10. Circuit Bench with the seed Night Light
  const nightProject = seed.projects.find((p) => p.name === 'Night Light' && p.ownerId === seed.students[0].id);
  await page.goto(`${BASE}/editor/${nightProject.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const circuitHidden = await page.locator('#qy-circuit').count();
  check('circuit hidden state present', circuitHidden === 1);
  const circuitSim = await page.locator('#qy-circuit').getAttribute('data-sim');
  check('circuit sim stopped', circuitSim === 'stopped', String(circuitSim));
  const components = await page.locator('#qy-circuit [data-component]').count();
  check('circuit components 3', components === 3, String(components));
  const ledComponent = await page.locator('#qy-circuit [data-component="LED-1"]').getAttribute('data-status');
  check('seed LED off while stopped', ledComponent === 'off', String(ledComponent));

  // Start the simulation: LED should light at 19.7 mA
  await page.locator('button:has-text("Start Simulation")').click();
  await page.waitForTimeout(400);
  const ledAfter = await page.locator('#qy-circuit [data-component="LED-1"]').getAttribute('data-status');
  check('LED lit after sim', ledAfter === 'lit', String(ledAfter));
  const ledCurrent = await page.locator('#qy-circuit [data-component="LED-1"]').getAttribute('data-current-ma');
  check('LED current 19.7', ledCurrent === '19.7', String(ledCurrent));
  const ledBrightness = await page.locator('#qy-circuit [data-component="LED-1"]').getAttribute('data-brightness');
  check('LED brightness 0.99', ledBrightness === '0.99', String(ledBrightness));
  const resistorCurrent = await page.locator('#qy-circuit [data-component="R-1"]').getAttribute('data-current-ma');
  check('resistor current 19.7', resistorCurrent === '19.7', String(resistorCurrent));

  // Change resistance: readouts update in place
  await page.locator('#R-1-ohms').fill('1000');
  await page.waitForTimeout(400);
  const ledAfterChange = await page.locator('#qy-circuit [data-component="LED-1"]').getAttribute('data-current-ma');
  check('LED current updates to 6.8', ledAfterChange === '6.8', String(ledAfterChange));

  // 11. Block Lab with the seed Sphere Tower
  const towerProject = seed.projects.find((p) => p.name === 'Sphere Tower' && p.ownerId === seed.students[0].id);
  await page.goto(`${BASE}/editor/${towerProject.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const blocksScene = await page.locator('#qy-blocks-scene').count();
  check('blocks hidden state present', blocksScene === 1);
  const sphereCount = await page.locator('#qy-blocks-scene').getAttribute('data-sphere-count');
  check('seed tower 3 spheres', sphereCount === '3', String(sphereCount));
  const blockMeshCount = await page.locator('#qy-blocks-scene').getAttribute('data-mesh-count');
  check('seed tower 3 meshes', blockMeshCount === '3', String(blockMeshCount));
  const blockState = await page.locator('#qy-blocks-scene').getAttribute('data-state');
  check('blocks state done', blockState === 'done', String(blockState));

  // Run the program: steps advance
  await page.locator('button:has-text("Play")').click();
  await page.waitForTimeout(300);
  const stateRunning = await page.locator('#qy-blocks-scene').getAttribute('data-state');
  check('blocks running during play', stateRunning === 'running', String(stateRunning));
  const stepEarly = await page.locator('#qy-blocks-scene').getAttribute('data-step');
  check('step counts early', Number(stepEarly) < 6, String(stepEarly));
  await page.waitForTimeout(3000);
  const stateDone = await page.locator('#qy-blocks-scene').getAttribute('data-state');
  check('blocks done after play', stateDone === 'done', String(stateDone));
  const stepFinal = await page.locator('#qy-blocks-scene').getAttribute('data-step');
  check('final step 6', stepFinal === '6', String(stepFinal));
  const spheresFinal = await page.locator('#qy-blocks-scene').getAttribute('data-sphere-count');
  check('3 spheres after run', spheresFinal === '3', String(spheresFinal));

  // 12. Phone width: shapes bottom sheet exists (same signed-in session)
  const mainCookies = await context.cookies();
  const phoneCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await phoneCtx.addCookies(mainCookies);
  const phonePage = await phoneCtx.newPage();
  await phonePage.goto(`${BASE}/editor/${gearProject.id}`, { waitUntil: 'networkidle' });
  await phonePage.waitForTimeout(400);
  const shapesBtn = await phonePage.locator('button[aria-label="Shapes"]').count();
  check('phone Shapes button', shapesBtn === 1);
  const horizontalScroll = await phonePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check('phone no horizontal scroll', !horizontalScroll);
  await phonePage.close();

  // 13. Medium width spot-check on the classroom page
  const tabletCtx = await browser.newContext({ viewport: { width: 768, height: 1024 } });
  await tabletCtx.addCookies(mainCookies);
  const tabletPage = await tabletCtx.newPage();
  await tabletPage.goto(`${BASE}/api/grading/session?user=${seed.educator.id}&token=qy-grading-local`, { waitUntil: 'networkidle' });
  await tabletPage.goto(`${BASE}/classrooms/${seed.classroom.id}`, { waitUntil: 'networkidle' });
  await tabletPage.waitForTimeout(300);
  const tabletScroll = await tabletPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check('tablet no horizontal scroll', !tabletScroll);
  await tabletPage.close();

  await browser.close();
  console.log(failures === 0 ? '\nE2E PASS' : `\n${failures} E2E FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
