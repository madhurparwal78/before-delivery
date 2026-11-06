// Flat-plan fallback, touch gestures and session-end live bound checks.
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:4173';
const results = [];
function check(name, ok, detail) { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)?.slice(0, 200)}`}`); }

async function signin(page, email, password) {
  await page.goto(`${BASE}/signin`);
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('[role="application"]');
}

// --- flat plan fallback (WebGL disabled)
{
  const browser = await chromium.launch({ args: ['--disable-webgl', '--disable-webgl2'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await signin(page, 'ivo@lowtide.test', 'Saltpan-Ivo-27');
  const island = page.locator('[role="application"]');
  check('flat renderer', (await island.getAttribute('data-renderer')) === 'flat', await island.getAttribute('data-renderer'));
  const notices = (await page.locator('#tide-notices').textContent()) ?? '';
  check('flat plan notice', /3D view unavailable — showing the flat plan\./.test(notices), notices);
  // azimuth stays 0 and controls still work
  await island.focus();
  await page.keyboard.press('e');
  check('flat azimuth stays 0', (await island.getAttribute('data-camera-azimuth')) === '0', await island.getAttribute('data-camera-azimuth'));
  await page.keyboard.press('ArrowLeft');
  check('flat cursor moves', Number(await island.getAttribute('data-cursor-x')) === 19, await island.getAttribute('data-cursor-x'));
  await page.mouse.wheel(0, -400);
  const zoom = Number(await island.getAttribute('data-camera-zoom'));
  check('flat zoom works', zoom > 1, zoom);
  await browser.close();
}

// --- touch gestures
{
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await signin(page, 'wren@lowtide.test', 'Saltpan-Wren-27');
  const island = page.locator('[role="application"]');
  const canvas = page.locator('[role="application"] canvas');
  const panBefore = await island.getAttribute('data-camera-pan-x');
  await canvas.tap({ position: { x: 180, y: 400 } });
  await page.touchscreen.tap(180, 400);
  // one-finger drag pans
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: 400 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 220, y: 430 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(400);
  const panAfter = await island.getAttribute('data-camera-pan-x');
  check('one-finger drag pans the camera', panBefore !== panAfter, { panBefore, panAfter });
  // two-finger pinch zooms
  const zoomBefore = Number(await island.getAttribute('data-camera-zoom'));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 380 }, { x: 210, y: 420 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 120, y: 360 }, { x: 240, y: 440 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(400);
  const zoomAfter = Number(await island.getAttribute('data-camera-zoom'));
  check('pinch zooms', Math.abs(zoomAfter - zoomBefore) > 0.001, { zoomBefore, zoomAfter });
  await browser.close();
}

// --- session ended elsewhere within the live bound
{
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await signin(page, 'tamsin@lowtide.test', 'Saltpan-Tamsin-27');
  const otherContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const other = await otherContext.newPage();
  await signin(other, 'tamsin@lowtide.test', 'Saltpan-Tamsin-27');
  // sign out in the second tab
  await other.getByRole('button', { name: 'Sign out' }).click();
  const started = Date.now();
  await page.waitForURL('**/signin', { timeout: 5000 });
  const elapsed = Date.now() - started;
  check('session ended alert within live bound', elapsed < 3200, `${elapsed}ms`);
  const alertText = (await page.locator('#tide-alerts').textContent()) ?? '';
  check('session ended copy', /Your session ended\. Sign in again\./.test(alertText), alertText);
  await browser.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} extra browser checks passed`);
if (failed > 0) process.exitCode = 1;
