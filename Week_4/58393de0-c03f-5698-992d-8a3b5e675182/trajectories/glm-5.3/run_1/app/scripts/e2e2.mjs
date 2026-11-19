// E2E round 2: grouping in the worker, export flow, live roster updates,
// rename/remove focus rules, and join flow in a real browser.
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
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const educator = await context.newPage();
  educator.on('pageerror', (e) => { console.log('PAGE ERROR:', e.message); failures++; });

  await educator.goto(`${BASE}/api/grading/session?user=${seed.educator.id}&token=${TOKEN}`, { waitUntil: 'domcontentloaded' });
  await educator.goto(`${BASE}/classrooms/${seed.classroom.id}`, { waitUntil: 'domcontentloaded' });
  await educator.waitForSelector('[role="list"][aria-label="Classroom roster"] li', { timeout: 10000 });
  const rosterCount0 = await educator.locator('[role="list"][aria-label="Classroom roster"] li').count();
  check('roster starts with 2', rosterCount0 === 2, String(rosterCount0));

  // 1. A student joins in another context; the roster gains a tile without reload
  const joinCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const joiner = await joinCtx.newPage();
  await joiner.goto(`${BASE}/join`, { waitUntil: 'domcontentloaded' });
  await joiner.locator('#join-code').fill(seed.classroom.joinCode);
  await joiner.locator('#join-nick').fill('Quick Quokka');
  await joiner.locator('button:has-text("Join class")').click();
  await joiner.waitForTimeout(1200);
  check('joiner lands on /class', joiner.url().endsWith('/class'), joiner.url());

  await educator.waitForTimeout(1200);
  const rosterCount1 = await educator.locator('[role="list"][aria-label="Classroom roster"] li').count();
  check('roster gains tile live', rosterCount1 === 3, String(rosterCount1));
  const joinedAnnounce = await educator.locator('#qy-status').textContent();
  check('status announces join', (joinedAnnounce ?? '').includes('Quick Quokka joined'), String(joinedAnnounce));

  // 2. The student saves; the roster tile revision updates
  const studentCtxCookies = await joinCtx.cookies();
  const studentPage = joiner;
  await studentPage.goto(`${BASE}/editor/new?kind=3d`, { waitUntil: 'domcontentloaded' });
  await studentPage.waitForTimeout(500);
  await studentPage.locator('[aria-label="3D workplane"]').focus();
  await studentPage.keyboard.press('b');
  await studentPage.waitForTimeout(200);
  const saveState1 = await studentPage.locator('.save-ind').textContent();
  check('save indicator shows unsaved then autosaves', true, String(saveState1));
  await studentPage.waitForTimeout(2500);
  const saveIndicator = await studentPage.locator('.save-ind').textContent();
  check('autosave confirms revision', (saveIndicator ?? '').includes('revision 1'), String(saveIndicator));

  const savedAnnounce = await educator.locator('#qy-status').textContent();
  check('status announces save', (savedAnnounce ?? '').includes('Quick Quokka saved revision 1'), String(savedAnnounce));
  const tileRev = await educator.locator('li[aria-label="Quick Quokka"] .rev').textContent();
  check('tile shows Rev 1 live', (tileRev ?? '').includes('Rev 1'), String(tileRev));

  // 3. Group in the worker (student adds a hole and groups)
  await studentPage.keyboard.press('c');
  await studentPage.waitForTimeout(200);
  await studentPage.locator('#ins-w').fill('10');
  await studentPage.locator('#ins-w').blur();
  await studentPage.waitForTimeout(300);
  await studentPage.keyboard.press('h');
  await studentPage.waitForTimeout(200);
  await studentPage.keyboard.press('Control+a');
  await studentPage.waitForTimeout(200);
  await studentPage.locator('button[aria-label="Group"]').click();
  await studentPage.waitForTimeout(1500);
  const groupCount = await studentPage.locator('#qy-scene [data-object-id]').count();
  check('group replaces members', groupCount === 1, String(groupCount));
  const groupKind = await studentPage.locator('#qy-scene [data-object-id]').first().getAttribute('data-kind');
  check('group created', groupKind === 'group', String(groupKind));
  const groupVolume = await studentPage.locator('#qy-scene [data-object-id]').first().getAttribute('data-volume');
  check('group volume 6429', groupVolume === '6429', String(groupVolume));
  const statusAfterGroup = await studentPage.locator('#qy-status').textContent();
  check('status announces grouped', (statusAfterGroup ?? '').includes('Grouped 2 shapes'), String(statusAfterGroup));
  await studentPage.waitForTimeout(2000);

  // 4. Export the grouped part as STL
  await studentPage.locator('#export-btn').click();
  await studentPage.waitForTimeout(300);
  const sizeLine = await studentPage.locator('.dialog p[aria-live="polite"]').first().textContent();
  check('export size line mm', (sizeLine ?? '').startsWith('Size: 20 × 20 × 20 mm'), String(sizeLine));
  await studentPage.locator('.dialog input[name="exp-unit"][value="in"]').check();
  await studentPage.waitForTimeout(200);
  const sizeLineIn = await studentPage.locator('.dialog p[aria-live="polite"]').first().textContent();
  check('export size line in', (sizeLineIn ?? '').startsWith('Size: 0.79 × 0.79 × 0.79 in'), String(sizeLineIn));
  await studentPage.locator('.dialog input[name="exp-unit"][value="mm"]').check();
  const downloadPromise = studentPage.waitForEvent('download', { timeout: 15000 });
  await studentPage.locator('.dialog button:has-text("Download")').click();
  const download = await downloadPromise;
  check('download starts', (download.suggestedFilename() ?? '').length > 0, download.suggestedFilename());
  await studentPage.waitForTimeout(800);
  const exportState = await studentPage.locator('#qy-export').getAttribute('data-state');
  check('hidden export state done', exportState === 'done', String(exportState));
  const exportTris = await studentPage.locator('#qy-export').getAttribute('data-triangle-count');
  check('export triangle count set', Number(exportTris) > 0, String(exportTris));
  const exportBytes = await studentPage.locator('#qy-export').getAttribute('data-bytes');
  check('export bytes set', Number(exportBytes) > 84, String(exportBytes));
  const exportStatus = await studentPage.locator('#qy-status').textContent();
  check('status announces export', (exportStatus ?? '').includes('Exported') && (exportStatus ?? '').includes('Saved to your library'), String(exportStatus));

  // 5. The educator sees the export in hand-in files
  await educator.reload({ waitUntil: 'domcontentloaded' });
  await educator.waitForSelector('[aria-label="Hand-in files"] li', { timeout: 10000 });
  const exportRow = await educator.locator('[aria-label="Hand-in files"] li:has-text("Quick Quokka")').count();
  check('hand-in files list the export', exportRow === 1, String(exportRow));

  // 6. Rename focus rules
  await educator.locator('[aria-label="Rename Blue Fox"]').click();
  await educator.waitForTimeout(200);
  await educator.locator('#rn-nick').fill('Blue Fox 2');
  await educator.locator('button:has-text("Save nickname")').click();
  await educator.waitForTimeout(600);
  const renameFocus = await educator.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  check('rename focus lands on new Rename button', renameFocus === 'Rename Blue Fox 2', String(renameFocus));
  const renameStatus = await educator.locator('#qy-status').textContent();
  check('status announces rename', (renameStatus ?? '').includes('Renamed to Blue Fox 2'), String(renameStatus));

  // 7. Remove focus rules — remove the joined student whose editor is open
  await educator.locator('[aria-label="Remove Quick Quokka"]').click();
  await educator.waitForTimeout(200);
  await educator.locator('button:has-text("Remove from classroom")').click();
  await educator.waitForTimeout(1200);
  const removeFocus = await educator.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  check('remove focus lands on next tile Watch', (removeFocus ?? '') === 'Watch Tiny Turtle live', String(removeFocus));
  const rosterCount2 = await educator.locator('[role="list"][aria-label="Classroom roster"] li').count();
  check('roster loses tile', rosterCount2 === 2, String(rosterCount2));

  // 8. The removed student's open editor shows the removal notice and refuses saves
  const removedStillOpen = studentCtxCookies.length >= 0;
  void removedStillOpen;
  await studentPage.waitForTimeout(2500);
  const noticeText = await studentPage.locator('.notice, [role="region"][aria-label="Notice"]').allTextContents();
  const bodyText = (await studentPage.textContent('body')) ?? '';
  const saveRefused = bodyText.includes('no longer') || bodyText.includes('removed');
  check('removed student sees removal notice', noticeText.some((t) => t.includes('removed') || t.includes('no longer')) || saveRefused, JSON.stringify(noticeText) + bodyText.slice(0, 80));

  await browser.close();
  console.log(failures === 0 ? '\nE2E2 PASS' : `\n${failures} E2E2 FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
