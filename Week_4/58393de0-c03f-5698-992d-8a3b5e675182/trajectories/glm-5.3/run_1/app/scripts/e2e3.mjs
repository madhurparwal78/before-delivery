// E2E round 3: Glancet expand/shrink/F6/scroll-under, reduced motion, SVG
// export, workplane tool, align dialog, wiring by keyboard, and switch.
import { chromium } from 'playwright-core';

const BASE = 'http://127.0.0.1:4173';
const TOKEN = 'qy-grading-local';
let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${extra}`); }
}

async function main() {
  await fetch(`${BASE}/api/grading/seed`, { method: 'POST', headers: { 'X-Grading-Token': TOKEN } });
  const seed = await (await fetch(`${BASE}/api/grading/seed`, { method: 'POST', headers: { 'X-Grading-Token': TOKEN } })).json();
  const browser = await chromium.launch({
    executablePath: '/tmp/pw/chromium_headless_shell-1255/chrome-headless-shell-linux-arm64/chrome-headless-shell',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });

  // ---------- Glancet docking rules ----------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const edu = await ctx.newPage();
  edu.on('pageerror', (e) => { console.log('PAGE ERROR:', e.message); failures++; });
  await edu.goto(`${BASE}/api/grading/session?user=${seed.educator.id}&token=${TOKEN}`, { waitUntil: 'domcontentloaded' });
  await edu.goto(`${BASE}/classrooms/${seed.classroom.id}`, { waitUntil: 'domcontentloaded' });
  await edu.waitForSelector('[role="list"][aria-label="Classroom roster"] li');

  await edu.locator('[aria-label="Watch Tiny Turtle live"]').click();
  await edu.waitForTimeout(400);
  const box = await edu.locator('[aria-label="Glancet: Tiny Turtle"]').boundingBox();
  check('glancet docked 360x203', box && Math.round(box.width) === 360 && Math.round(box.height) === 203, JSON.stringify(box));
  const nearBottom = box && (800 - (box.y + box.height)) <= 30;
  const nearRight = box && (1280 - (box.x + box.width)) <= 30;
  check('glancet 24px from bottom and right', nearBottom && nearRight, `${nearBottom} ${nearRight}`);

  // Roster scrolls under the docked viewer; it keeps its place.
  await edu.evaluate(() => window.scrollTo(0, 300));
  await edu.waitForTimeout(200);
  const boxAfterScroll = await edu.locator('[aria-label="Glancet: Tiny Turtle"]').boundingBox();
  check('glancet stays in viewport while roster scrolls', boxAfterScroll && Math.abs(boxAfterScroll.y - (box?.y ?? 0)) < 2, JSON.stringify(boxAfterScroll));

  // Expand makes it modal and larger; shrink returns to the corner.
  await edu.locator('[aria-label="Expand viewer"]').click();
  await edu.waitForTimeout(400);
  const expanded = await edu.locator('[aria-label="Glancet: Tiny Turtle"]').boundingBox();
  check('expanded wider', expanded && expanded.width > 600, JSON.stringify(expanded));
  await edu.locator('[aria-label="Expand viewer"]').click();
  await edu.waitForTimeout(400);
  const shrunk = await edu.locator('[aria-label="Glancet: Tiny Turtle"]').boundingBox();
  check('shrink returns to corner', shrunk && Math.round(shrunk.width) === 360, JSON.stringify(shrunk));

  // F6 moves focus between viewer and opener tile.
  await edu.evaluate(() => window.scrollTo(0, 0));
  await edu.locator('[aria-label="Watch Blue Fox live"]').click();
  await edu.waitForTimeout(400);
  const focusInViewer = await edu.evaluate(() => document.querySelector('[aria-label^="Glancet:"]')?.contains(document.activeElement) === true);
  check('focus inside viewer after open', focusInViewer);
  await edu.keyboard.press('F6');
  const focusOnTile = await edu.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  check('F6 to opener tile', focusOnTile === 'Watch Blue Fox live', String(focusOnTile));
  await edu.keyboard.press('F6');
  const focusBack = await edu.evaluate(() => document.querySelector('[aria-label^="Glancet:"]')?.contains(document.activeElement) === true);
  check('F6 back to viewer', focusBack);

  // Close viewer keeps scroll position.
  await edu.evaluate(() => window.scrollTo(0, 250));
  const scrollBefore = await edu.evaluate(() => window.scrollY);
  await edu.keyboard.press('Escape');
  await edu.waitForTimeout(400);
  const scrollAfter = await edu.evaluate(() => window.scrollY);
  check('scroll unchanged after close', Math.abs(scrollAfter - scrollBefore) < 2, `${scrollBefore} -> ${scrollAfter}`);
  const focusAfterClose = await edu.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  check('focus returns to Watch button', focusAfterClose === 'Watch Blue Fox live', String(focusAfterClose));

  // ---------- Student editor interactions ----------
  const sctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const student = await sctx.newPage();
  student.on('pageerror', (e) => { console.log('STUDENT PAGE ERROR:', e.message); failures++; });
  await student.goto(`${BASE}/api/grading/session?user=${seed.students[0].id}&token=${TOKEN}`, { waitUntil: 'domcontentloaded' });
  await student.goto(`${BASE}/editor/new?kind=3d`, { waitUntil: 'domcontentloaded' });
  await student.waitForSelector('[aria-label="3D workplane"]');

  // Workplane tool on the box's right face via Enter
  await student.locator('[aria-label="3D workplane"]').focus();
  await student.keyboard.press('b');
  await student.waitForTimeout(200);
  await student.keyboard.press('w');
  await student.waitForTimeout(200);
  const statusW = await student.locator('#qy-status').textContent();
  check('workplane tool asks for face', (statusW ?? '').includes('Pick a face'), String(statusW));
  await student.keyboard.press('Enter');
  await student.waitForTimeout(300);
  const sceneWp = await student.locator('#qy-scene').getAttribute('data-workplane-normal');
  const sceneOrigin = await student.locator('#qy-scene').getAttribute('data-workplane-origin');
  check('Enter picks top face', sceneWp === '0,0,1' && sceneOrigin === '0,0,20', `${sceneWp} ${sceneOrigin}`);

  // Reset workplane
  await student.locator('button[aria-label="Reset workplane"]').click();
  await student.waitForTimeout(200);
  const resetOrigin = await student.locator('#qy-scene').getAttribute('data-workplane-origin');
  check('reset workplane to ground', resetOrigin === '0,0,0', String(resetOrigin));

  // Align dialog with two shapes
  await student.keyboard.press('c');
  await student.waitForTimeout(150);
  await student.keyboard.press('ArrowRight');
  await student.waitForTimeout(150);
  await student.keyboard.press('Control+a');
  await student.waitForTimeout(150);
  await student.keyboard.press('l');
  await student.waitForTimeout(300);
  const alignDialog = await student.locator('div[role="dialog"][aria-label="Align"]').count();
  check('L opens Align dialog', alignDialog === 1, String(alignDialog));
  await student.locator('button:has-text("Align centers on Y")').click();
  await student.waitForTimeout(300);
  const objs = student.locator('#qy-scene [data-object-id]');
  const boxY = await objs.nth(0).getAttribute('data-y');
  const cylY = await objs.nth(1).getAttribute('data-y');
  check('aligned centers on Y', boxY === cylY, `${boxY} vs ${cylY}`);
  const alignStatus = await student.locator('#qy-status').textContent();
  check('status announces align', (alignStatus ?? '').includes('Aligned 2 shapes on Y'), String(alignStatus));
  const focusBackToCanvas = await student.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  check('align closes back to opener', focusBackToCanvas === 'Reset workplane', String(focusBackToCanvas));

  // SVG export
  await student.locator('#export-btn').click();
  await student.waitForTimeout(300);
  await student.locator('.dialog input[name="exp-format"][value="svg"]').check();
  await student.waitForTimeout(200);
  const sizeSvg = await student.locator('.dialog p[aria-live="polite"]').first().textContent();
  check('3d svg size line', (sizeSvg ?? '').startsWith('Size: 40 × 30 × 20 mm') || (sizeSvg ?? '').startsWith('Size:'), String(sizeSvg));
  const dl = student.waitForEvent('download', { timeout: 15000 });
  await student.locator('.dialog button:has-text("Download")').click();
  const dlInfo = await dl;
  check('svg download starts', dlInfo.suggestedFilename().endsWith('.svg'), dlInfo.suggestedFilename());
  await student.waitForTimeout(500);
  const svgFormat = await student.locator('#qy-export').getAttribute('data-format');
  check('hidden state svg format', svgFormat === 'svg', String(svgFormat));
  const svgTris = await student.locator('#qy-export').getAttribute('data-triangle-count');
  check('svg triangle count empty', (svgTris ?? '') === '', String(svgTris));

  // Circuit wiring by keyboard + switch + burnt LED reset
  const cctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const cpage = await cctx.newPage();
  await cpage.goto(`${BASE}/api/grading/session?user=${seed.students[0].id}&token=${TOKEN}`, { waitUntil: 'domcontentloaded' });
  await cpage.goto(`${BASE}/editor/new?kind=circuit`, { waitUntil: 'domcontentloaded' });
  await cpage.waitForSelector('button[aria-label="Battery"]');
  await cpage.locator('button[aria-label="Battery"]').click();
  await cpage.locator('button[aria-label="LED"]').click();
  await cpage.waitForTimeout(300);
  const groups = cpage.locator('[role="group"]');
  check('components listed as groups', await groups.count() === 2, String(await groups.count()));

  // Wire BAT-1+ to LED-1+ by keyboard
  await cpage.locator('[aria-label="BAT-1 + terminal"]').focus();
  await cpage.keyboard.press('Enter');
  await cpage.waitForTimeout(150);
  const wiringStatus = await cpage.locator('#qy-status').textContent();
  check('status announces wiring start', (wiringStatus ?? '').includes('Wiring from BAT-1 +'), String(wiringStatus));
  await cpage.locator('[aria-label="LED-1 + terminal"]').focus();
  await cpage.keyboard.press('Enter');
  await cpage.waitForTimeout(300);
  const wireRow = await cpage.locator('[aria-label="Wires"] [role="listitem"]').count();
  check('wire row listed', wireRow === 1, String(wireRow));

  // Duplicate wire refused
  await cpage.locator('[aria-label="BAT-1 + terminal"]').focus();
  await cpage.keyboard.press('Enter');
  await cpage.locator('[aria-label="LED-1 + terminal"]').focus();
  await cpage.keyboard.press('Enter');
  await cpage.waitForTimeout(200);
  const dupStatus = await cpage.locator('#qy-status').textContent();
  check('duplicate wire refused', (dupStatus ?? '').includes('already wired') || (dupStatus ?? '').includes('Those terminals'), String(dupStatus));
  const wireCount = await cpage.locator('[aria-label="Wires"] [role="listitem"]').count();
  check('no duplicate wire row', wireCount === 1, String(wireCount));

  // Complete the circuit and run: LED burns out (9V straight into the LED)
  await cpage.locator('[aria-label="LED-1 − terminal"]').focus();
  await cpage.keyboard.press('Enter');
  await cpage.locator('[aria-label="BAT-1 − terminal"]').focus();
  await cpage.keyboard.press('Enter');
  await cpage.waitForTimeout(200);
  await cpage.locator('button:has-text("Start Simulation")').click();
  await cpage.waitForTimeout(500);
  const ledStatus = await cpage.locator('#qy-circuit [data-component="LED-1"]').getAttribute('data-status');
  check('straight LED burns out', ledStatus === 'broken', String(ledStatus));
  const burnStatus = await cpage.locator('#qy-status').textContent();
  check('status announces burnout', (burnStatus ?? '').includes('burnt out at 280.0 mA'), String(burnStatus));

  // Reset the LED
  await cpage.locator('button:has-text("Stop Simulation")').click();
  await cpage.waitForTimeout(200);
  await cpage.locator('[aria-label="Reset LED-1"]').click();
  await cpage.waitForTimeout(200);
  const resetStatus = await cpage.locator('#qy-status').textContent();
  check('status announces LED reset', (resetStatus ?? '').includes('LED-1 reset'), String(resetStatus));
  const afterResetStopped = await cpage.locator('#qy-circuit [data-component="LED-1"]').getAttribute('data-status');
  check('reset LED off while stopped', afterResetStopped === 'off', String(afterResetStopped));

  // Switch + shorted battery
  const cctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const cpage2 = await cctx2.newPage();
  await cpage2.goto(`${BASE}/api/grading/session?user=${seed.students[0].id}&token=${TOKEN}`, { waitUntil: 'domcontentloaded' });
  await cpage2.goto(`${BASE}/editor/new?kind=circuit`, { waitUntil: 'domcontentloaded' });
  await cpage2.locator('button[aria-label="Battery"]').click();
  await cpage2.locator('button[aria-label="Switch"]').click();
  await cpage2.waitForTimeout(300);
  const switchState = await cpage2.locator('#qy-circuit [data-component="SW-1"]').getAttribute('data-status');
  check('switch starts open', switchState === 'open', String(switchState));
  await cpage2.locator('#sw-SW-1').check();
  await cpage2.waitForTimeout(200);
  const switchClosed = await cpage2.locator('#qy-circuit [data-component="SW-1"]').getAttribute('data-status');
  check('switch closed by Space', switchClosed === 'closed', String(switchClosed));
  // wire battery + to switch +, switch - to battery -
  await cpage2.locator('[aria-label="BAT-1 + terminal"]').focus();
  await cpage2.keyboard.press('Enter');
  await cpage2.locator('[aria-label="SW-1 + terminal"]').focus();
  await cpage2.keyboard.press('Enter');
  await cpage2.locator('[aria-label="SW-1 − terminal"]').focus();
  await cpage2.keyboard.press('Enter');
  await cpage2.locator('[aria-label="BAT-1 − terminal"]').focus();
  await cpage2.keyboard.press('Enter');
  await cpage2.waitForTimeout(200);
  await cpage2.locator('button:has-text("Start Simulation")').click();
  await cpage2.waitForTimeout(500);
  const batStatus = await cpage2.locator('#qy-circuit [data-component="BAT-1"]').getAttribute('data-status');
  check('battery shorted through closed switch', batStatus === 'shorted', String(batStatus));
  const shortStatus = await cpage2.locator('#qy-status').textContent();
  check('status announces short', (shortStatus ?? '').includes('is short-circuited'), String(shortStatus));
  void shortStatus;
  const batteryCurrent = await cpage2.locator('#qy-circuit [data-component="BAT-1"]').getAttribute('data-current-ma');
  check('shorted battery current 0.0', batteryCurrent === '0.0', String(batteryCurrent));

  // ---------- Reduced motion ----------
  const rctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const rpage = await rctx.newPage();
  rpage.on('pageerror', (e) => { console.log('RM PAGE ERROR:', e.message); failures++; });
  await rpage.goto(`${BASE}/api/grading/session?user=${seed.educator.id}&token=${TOKEN}`, { waitUntil: 'domcontentloaded' });
  await rpage.goto(BASE, { waitUntil: 'domcontentloaded' });
  await rpage.waitForTimeout(1200);
  const posterPlaying = await rpage.locator('.poster-card .stage').getAttribute('data-playing');
  check('reduced motion: poster paused', posterPlaying === 'false', String(posterPlaying));
  const starterPause = await rpage.locator('button[aria-label="Pause starter previews"]').getAttribute('aria-pressed');
  check('reduced motion: starter toggle pressed', starterPause === 'true', String(starterPause));

  await rpage.goto(`${BASE}/classrooms/${seed.classroom.id}`, { waitUntil: 'domcontentloaded' });
  await rpage.waitForSelector('[role="list"][aria-label="Classroom roster"] li');
  await rpage.locator('[aria-label="Watch Tiny Turtle live"]').click();
  await rpage.waitForTimeout(400);
  const turntablePressed = await rpage.locator('[aria-label="Pause turntable"]').getAttribute('aria-pressed');
  check('reduced motion: turntable starts paused', turntablePressed === 'true', String(turntablePressed));
  const glancetPlaying = await rpage.locator('[aria-label^="Glancet:"]').getAttribute('data-playing');
  check('reduced motion: glancet data-playing false', glancetPlaying === 'false', String(glancetPlaying));

  // Reduced motion: Block Lab Play runs at once
  await rpage.goto(`${BASE}/editor/new?kind=blocks`, { waitUntil: 'domcontentloaded' });
  await rpage.waitForSelector('button[aria-label="Repeat"]');
  await rpage.locator('button[aria-label="Repeat"]').click();
  await rpage.waitForTimeout(150);
  // Move the insertion point into the repeat body, then add the two blocks.
  await rpage.locator('[data-block-name="repeat"]').first().focus();
  await rpage.keyboard.press('ArrowRight');
  await rpage.waitForTimeout(150);
  await rpage.locator('button[aria-label="Add Sphere"]').click();
  await rpage.locator('button[aria-label="Move Z by"]').click();
  await rpage.waitForTimeout(200);
  await rpage.locator('button:has-text("Play")').click();
  await rpage.waitForTimeout(400);
  const rmState = await rpage.locator('#qy-blocks-scene').getAttribute('data-state');
  const rmSpheres = await rpage.locator('#qy-blocks-scene').getAttribute('data-sphere-count');
  check('reduced motion: blocks run at once', rmState === 'done' && rmSpheres === '3', `${rmState} ${rmSpheres}`);

  await browser.close();
  console.log(failures === 0 ? '\nE2E3 PASS' : `\n${failures} E2E3 FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
