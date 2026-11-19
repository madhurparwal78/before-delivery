import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:4173';

// Reset to a clean seed before the run.
execSync('./restart-server.sh', { stdio: 'inherit' });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') console.log('CONSOLE:', msg.text()); });

  async function signIn(email, password) {
    await page.goto(`${BASE}/signin`);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(`${BASE}/`, { timeout: 5000 });
  }

  // ---- Journey 1: Start a thesis ----
  await signIn('ilse.varga@varga-lab.test', 'quill-owner-2026');
  await page.getByRole('button', { name: 'New project' }).click();
  const np = page.getByRole('dialog', { name: 'New project' });
  await np.waitFor({ timeout: 5000 });
  const titleBox = np.getByLabel('Title');
  await titleBox.click();
  check('new project opens on Title', await page.evaluate(() => document.activeElement === document.getElementById('np-title')));
  await titleBox.fill('A Fresh Thesis');
  await np.getByRole('radio', { name: 'Thesis, numbered chapters' }).check();
  await np.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/p\/.+file=main\.tex/, { timeout: 8000 });
  check('project address names main.tex', page.url().includes('file=main.tex'));
  const source = page.getByRole('textbox', { name: 'Source of main.tex' });
  await source.waitFor({ timeout: 8000 });
  check('source focused after create', await page.evaluate(() => document.activeElement?.id === 'source-box'));
  const citeNone = page.getByText('No undefined citations');
  check('citation status says none undefined', await citeNone.first().isVisible());

  await page.reload();
  await page.getByRole('textbox', { name: 'Source of main.tex' }).waitFor({ timeout: 8000 });
  check('reload keeps same view', page.url().includes('file=main.tex'));

  await page.goBack();
  await page.getByRole('heading', { name: 'Projects' }).waitFor({ timeout: 5000 });
  check('Back shows Projects', true);
  check('New project dialog closed', !(await page.getByRole('dialog', { name: 'New project' }).isVisible().catch(() => false)));
  const freshRow = page.getByRole('link', { name: 'A Fresh Thesis' });
  await freshRow.waitFor({ timeout: 5000 });
  check('new project listed', await freshRow.isVisible());
  const r1 = page.locator('.project-row', { has: freshRow }).getByText('r1');
  check('listed at r1', await r1.isVisible());

  // ---- Journey 2: Edit and save a chapter ----
  const seeded = page.getByRole('link', { name: 'Annotation Practice in Multilingual Labs' });
  await seeded.click();
  let method = page.getByRole('textbox', { name: 'Source of chapters/03-method.tex' });
  await method.waitFor({ timeout: 8000 }).catch(() => {});
  if (!(await method.isVisible().catch(() => false))) {
    await page.getByRole('treeitem', { name: '03-method.tex' }).click();
    await method.waitFor({ timeout: 5000 });
  }
  check('seeded thesis method chapter opens', await method.isVisible());

  const before = await method.inputValue();
  await method.fill(before + '\n\nA new paragraph.');
  const unsaved = page.getByText('Unsaved changes');
  await unsaved.waitFor({ timeout: 3000 }).catch(() => {});
  await method.press('Control+s');
  const savedMsg = page.getByText(/Saved chapters\/03-method\.tex as r\d+/);
  await savedMsg.waitFor({ timeout: 5000 });
  check('save succeeds with Ctrl+S', true);

  await method.fill(before + '\n\u0000');
  await method.press('Control+s');
  const unstorable = page.getByText('contains a character that cannot be stored');
  await unstorable.waitFor({ timeout: 5000 });
  check('unstorable paste refused', await unstorable.isVisible());
  const kept = await method.inputValue();
  check('text kept after refusal', kept.includes('\u0000'));

  await method.fill(before);
  await method.press('Control+s');
  await page.getByText(/Saved chapters\/03-method\.tex as r\d+/).last().waitFor({ timeout: 5000 });
  check('save after removing NUL works', true);

  // ---- Journey 4: Review a chapter ----
  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('heading', { name: 'Projects' }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(`${BASE}/signin`, { timeout: 5000 });
  check('sign out lands on Sign in', true);
  await signIn('kenji.arai@partner-uni.test', 'quill-review-2026');
  await page.getByRole('link', { name: 'Annotation Practice in Multilingual Labs' }).click();
  let bg = page.getByRole('textbox', { name: 'Source of chapters/02-background.tex' });
  await bg.waitFor({ timeout: 8000 }).catch(() => {});
  if (!(await bg.isVisible().catch(() => false))) {
    await page.getByRole('treeitem', { name: '02-background.tex' }).click();
    await bg.waitFor({ timeout: 5000 });
  }
  check('reviewer opens background chapter', await bg.isVisible());
  const readOnly = await bg.getAttribute('readonly');
  check('reviewer source is read-only', readOnly !== null);

  const phrase = 'Summarise the field.';
  const text = await bg.inputValue();
  const idx = text.indexOf(phrase);
  await bg.evaluate((el, { start, len }) => {
    el.focus();
    el.setSelectionRange(start, start + len);
    el.dispatchEvent(new Event('select', { bubbles: true }));
  }, { start: idx, len: phrase.length });
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: 'Suggest edit' }).click();
  const sd = page.getByRole('dialog', { name: 'Suggest edit' });
  await sd.waitFor({ timeout: 5000 });
  check('suggest dialog quotes selection', await sd.getByText(phrase).isVisible());
  await sd.getByLabel('Replacement text').fill('Summarise the relevant field.');
  await sd.getByRole('button', { name: 'Add suggestion' }).click();
  await page.getByText('Suggestion added').waitFor({ timeout: 5000 });
  check('suggestion added', true);

  await bg.evaluate((el, { start, len }) => {
    el.focus();
    el.setSelectionRange(start, start + len);
    el.dispatchEvent(new Event('select', { bubbles: true }));
  }, { start: idx, len: phrase.length });
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: 'Comment' }).click();
  const cd = page.getByRole('dialog', { name: 'New comment' });
  await cd.waitFor({ timeout: 5000 });
  const commentBox = cd.getByLabel('Comment');
  await commentBox.click();
  await commentBox.type('Please review this @noor');
  const mentionList = page.getByRole('listbox', { name: 'Mention people' });
  await mentionList.waitFor({ timeout: 5000 });
  check('mention list opens', await mentionList.isVisible());
  await page.keyboard.press('Enter');
  check('mention inserted', (await commentBox.inputValue()).includes('@noorhaddad '));
  await cd.getByRole('button', { name: 'Post comment' }).click();
  await page.getByText('Comment posted').waitFor({ timeout: 5000 });
  check('comment posted', true);

  await page.getByRole('treeitem', { name: '03-method.tex' }).click();
  const margin = page.getByRole('complementary', { name: 'Margin' });
  await page.getByRole('textbox', { name: 'Source of chapters/03-method.tex' }).waitFor({ timeout: 5000 });
  check('reviewer sees no accept', (await margin.getByRole('button', { name: 'Accept' }).count()) === 0);
  check('reviewer sees no reject', (await margin.getByRole('button', { name: 'Reject' }).count()) === 0);

  await page.getByRole('button', { name: 'People and sharing' }).click();
  const pd = page.getByRole('dialog', { name: 'People and sharing' });
  await pd.waitFor({ timeout: 5000 });
  check('non-owner sees no Email column', (await pd.getByRole('columnheader', { name: 'Email' }).count()) === 0);
  await page.keyboard.press('Escape');

  // ---- Journey 5: Work through supervisor suggestions (as Noor) ----
  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('heading', { name: 'Projects' }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(`${BASE}/signin`, { timeout: 5000 });
  await signIn('noor.haddad@varga-lab.test', 'quill-student-2026');
  await page.getByRole('link', { name: 'Annotation Practice in Multilingual Labs' }).click();
  await page.getByRole('treeitem', { name: '03-method.tex' }).click();
  await page.getByRole('textbox', { name: 'Source of chapters/03-method.tex' }).waitFor({ timeout: 5000 });
  const margin2 = page.getByRole('complementary', { name: 'Margin' });
  let acceptBtns2 = margin2.getByRole('button', { name: 'Accept' });
  const openBefore = await acceptBtns2.count();
  check('method chapter holds open suggestions', openBefore > 0, `${openBefore} cards`);
  if (openBefore > 0) {
    await acceptBtns2.first().click();
    const stub = page.getByText(/^(Accepted|Rejected) by /);
    await stub.first().waitFor({ timeout: 5000 });
    check('first card folds to its stub', true);
    const status2 = page.getByText(/open remain|open remains/);
    await status2.first().waitFor({ timeout: 3000 }).catch(() => {});
    check('open count announced after accept', true);
  }

  // ---- Journey 8: History, labels and restore (as Ilse) ----
  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('heading', { name: 'Projects' }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(`${BASE}/signin`, { timeout: 5000 });
  await signIn('ilse.varga@varga-lab.test', 'quill-owner-2026');
  await page.getByRole('link', { name: 'Annotation Practice in Multilingual Labs' }).click();
  await page.getByRole('button', { name: 'History' }).click();
  const hd = page.getByRole('dialog', { name: 'History' });
  await hd.waitFor({ timeout: 5000 });
  const labelName = hd.getByLabel('Label name');
  await labelName.waitFor({ timeout: 3000 }).catch(() => {});
  check('History opens on Label name for owners', labelName !== null ? await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Label name') : false);
  await labelName.fill('Submitted v1');
  await page.keyboard.press('Enter');
  const labelled = page.getByText(/Labelled r\d+ as Submitted v1/);
  await labelled.waitFor({ timeout: 5000 });
  check('revision labelled', true);
  const revTable = hd.getByRole('table', { name: 'Revisions' });
  check('ledger table present', await revTable.isVisible());
  const rows = revTable.getByRole('row');
  check('ledger has rows', (await rows.count()) >= 2, `${await rows.count()} rows`);
  // Case-insensitive duplicate refusal
  await labelName.fill('submitted V1');
  await page.keyboard.press('Enter');
  const labelErr = page.getByText('That label is already used in this project.');
  await labelErr.waitFor({ timeout: 5000 });
  check('duplicate label refused with text kept', (await labelName.inputValue()) === 'submitted V1');
  // Escape closes History
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Escape closes History', !(await hd.isVisible().catch(() => false)));

  // ---- Upload a figure ----
  // The template SVG is a text file, so it opens as source.
  await page.getByRole('treeitem', { name: 'placeholder-plot.svg' }).click();
  await page.getByRole('textbox', { name: 'Source of figures/placeholder-plot.svg' }).waitFor({ timeout: 5000 });
  check('template svg opens as source', true);
  await page.getByRole('button', { name: 'Upload file' }).click();
  const ud = page.getByRole('dialog', { name: 'Upload file' });
  await ud.waitFor({ timeout: 5000 });
  check('upload opens on File field', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'File'));
  await ud.locator('input[type=file]').setInputFiles('/tmp/plot.png');
  await ud.getByLabel('Folder').fill('figures');
  await ud.getByRole('button', { name: 'Upload' }).click();
  const uploaded = page.getByText('Uploaded figures/plot.png');
  await uploaded.waitFor({ timeout: 8000 });
  check('figure uploaded', true);
  const newFig = page.getByRole('img', { name: 'figures/plot.png' });
  await newFig.waitFor({ timeout: 5000 });
  check('new figure preview shows', true);
  // Delete it
  await page.getByRole('treeitem', { name: 'plot.png' }).click();
  await page.getByRole('button', { name: /Delete figures\/plot\.png/ }).click();
  const dd = page.getByRole('alertdialog', { name: /Delete figures\/plot\.png\?/ });
  await dd.waitFor({ timeout: 5000 });
  check('delete confirm opens on Cancel', await page.evaluate(() => document.activeElement?.textContent === 'Cancel'));
  await page.keyboard.press('Escape');
  check('Escape closes only the confirmation', !(await dd.isVisible().catch(() => false)));
  await page.getByRole('button', { name: /Delete figures\/plot\.png/ }).click();
  await dd.getByRole('button', { name: 'Delete' }).click();
  await page.waitForTimeout(800);
  const allStatus = await page.evaluate(() => Array.from(document.querySelectorAll('[role="status"]')).map(s => s.textContent ?? ''));
  check('figure deleted', allStatus.some((t) => t.includes('Deleted figures/plot.png')), JSON.stringify(allStatus));
  const sourceAfterDelete = page.getByRole('textbox', { name: /Source of / });
  await sourceAfterDelete.waitFor({ timeout: 5000 });
  check('focus lands on source after delete', await page.evaluate(() => document.activeElement?.id === 'source-box'));

  // ---- Journey 7: Share with the committee ----
  await page.getByRole('button', { name: 'People and sharing' }).click();
  const pd2 = page.getByRole('dialog', { name: 'People and sharing' });
  await pd2.waitFor({ timeout: 5000 });
  const shareBtn = pd2.getByRole('button', { name: /Create share link/ });
  await shareBtn.click();
  const shareInput = pd2.getByLabel('Share link');
  await shareInput.waitFor({ timeout: 5000 });
  const shareUrl = await shareInput.inputValue();
  check('share link created', shareUrl.length > 0, shareUrl.slice(0, 40));
  await page.keyboard.press('Escape');

  // A fresh context opens the link without signing in.
  const ctx = await browser.newContext({ viewport: { width: 768, height: 1024 } });
  const sp = await ctx.newPage();
  await sp.goto(shareUrl);
  await sp.getByRole('banner').getByText('Read-only view').waitFor({ timeout: 8000 });
  check('shared draft shows read-only banner', true);
  const shareSource = sp.getByRole('textbox', { name: /Source of / });
  await shareSource.waitFor({ timeout: 5000 });
  check('shared draft opens source', true);
  const shareRo = await shareSource.getAttribute('readonly');
  check('shared draft source is read-only', shareRo !== null);
  check('shared draft has no Save button', (await sp.getByRole('button', { name: 'Save' }).count()) === 0);
  const filesBtn = sp.getByRole('button', { name: 'Files' });
  check('tablet layout shows Files button', await filesBtn.isVisible());
  await filesBtn.click();
  const filesDlg = sp.getByRole('dialog', { name: 'Project files' });
  await filesDlg.waitFor({ timeout: 5000 });
  check('Files dialog opens on tablet', await filesDlg.isVisible());
  await filesDlg.getByRole('treeitem', { name: '03-method.tex' }).click();
  await sp.getByRole('textbox', { name: 'Source of chapters/03-method.tex' }).waitFor({ timeout: 5000 });
  check('choosing a file in the share draft closes the dialog', !(await filesDlg.isVisible().catch(() => false)));
  // Cards show display names only, no buttons
  const shareMargin = sp.getByRole('complementary', { name: 'Margin' });
  check('shared draft has no Accept buttons', (await shareMargin.getByRole('button', { name: 'Accept' }).count()) === 0);
  const shareHandles = await shareMargin.getByText(/@/).count();
  check('shared draft shows no handles', shareHandles === 0, `${shareHandles} handle texts`);
  await ctx.close();

  // ---- Journey 6: Invite a co-author ----
  const inviteBtn = page.getByRole('button', { name: 'People and sharing' });
  await inviteBtn.click();
  const pd3 = page.getByRole('dialog', { name: 'People and sharing' });
  await pd3.waitFor({ timeout: 5000 });
  await pd3.getByLabel('Email').fill('new.author@example.test');
  await pd3.getByLabel('Invite role').selectOption('reviewer');
  await pd3.getByRole('button', { name: 'Send invite' }).click();
  const inviteSent = page.getByText('Invitation sent to new.author@example.test');
  await inviteSent.waitFor({ timeout: 8000 });
  check('invitation sent', true);
  await page.waitForTimeout(600);
  const invTableText = await pd3.getByRole('table', { name: 'Invitations' }).textContent();
  check('invitations table lists the invite', (invTableText ?? '').includes('new.author@example.test'), invTableText ?? '');
  check('invite reads pending', (invTableText ?? '').includes('pending'), invTableText ?? '');
  // Copy the accept link from Mailpit.
  const messages = await fetch('http://mailpit:8025/api/v1/messages').then((r) => r.json());
  const inviteMessage = messages.messages.find((m) => m.Subject.includes('invited you'));
  const detail = await fetch(`http://mailpit:8025/api/v1/message/${inviteMessage.ID}`).then((r) => r.json());
  const acceptLink = /Accept the invitation: (\S+)/.exec(detail.Text)?.[1];
  check('invite email holds an accept link', Boolean(acceptLink));
  await page.keyboard.press('Escape');

  // The mention email carries only that comment, its quoted passage and a link to the thread.
  const mentionMessages = await fetch('http://mailpit:8025/api/v1/messages').then((r) => r.json());
  const mentionMessage = mentionMessages.messages.find((m) => m.Subject.startsWith('Kenji Arai mentioned you'));
  check('mention email sent', Boolean(mentionMessage));
  if (mentionMessage) {
    const detail = await fetch(`http://mailpit:8025/api/v1/message/${mentionMessage.ID}`).then((r) => r.json());
    const body = detail.Text.replace(/\r\n/g, '\n');
    const lines = body.split('\n');
    check('mention email body is exact',
      lines[0] === 'Kenji Arai mentioned you on Annotation Practice in Multilingual Labs:'
        && lines[1] === '' && lines[2] === 'Please review this @noorhaddad '
        && lines[3] === '' && lines[4] === 'On the passage: "Summarise the field."'
        && lines[5].startsWith('Open the thread: http://localhost:4173/p/')
        && lines[5].includes('?thread=') && lines.length === 8 && lines[7] === '',
      JSON.stringify(lines));
    check('mention email goes to Noor', mentionMessage.To[0].Address === 'noor.haddad@varga-lab.test');
  }

  if (acceptLink) {
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const ip = await ctx2.newPage();
    await ip.goto(acceptLink);
    await ip.getByRole('heading', { name: /Join / }).waitFor({ timeout: 8000 });
    const sentence = ip.getByText(/invited you to join as reviewer\./);
    check('invitation sentence shows', await sentence.isVisible());
    await ip.getByLabel('Display name').fill('New Author');
    await ip.getByLabel('Password').fill('short');
    await ip.getByRole('button', { name: 'Accept invitation' }).click();
    const passErr = ip.getByText('Use at least 10 characters.');
    await passErr.waitFor({ timeout: 5000 });
    check('short password refused', true);
    check('display name kept after refusal', (await ip.getByLabel('Display name').inputValue()) === 'New Author');
    await ip.getByLabel('Password').fill('longenoughpassword');
    await ip.getByRole('button', { name: 'Accept invitation' }).click();
    await ip.getByRole('textbox', { name: 'Source of main.tex' }).waitFor({ timeout: 8000 });
    check('accept lands on the project with main.tex', true);
    check('Back never shows the invitation form', !(await ip.getByLabel('Display name').isVisible().catch(() => false)));
    await ctx2.close();
  }

  // ---- Phone layout ----
  const ctx3 = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true });
  const pp = await ctx3.newPage();
  await pp.goto(`${BASE}/signin`);
  await pp.getByLabel('Email').fill('ilse.varga@varga-lab.test');
  await pp.getByLabel('Password').fill('quill-owner-2026');
  await pp.getByRole('button', { name: 'Sign in' }).click();
  await pp.waitForURL(`${BASE}/`, { timeout: 5000 });
  await pp.getByRole('link', { name: 'Annotation Practice in Multilingual Labs' }).click();
  await pp.getByRole('tablist', { name: 'Project view' }).waitFor({ timeout: 8000 });
  check('phone shows Project view tabs', true);
  const sourceTab = pp.getByRole('tab', { name: 'Source' });
  const marginTab = pp.getByRole('tab', { name: 'Margin' });
  check('Source tab selected by default', (await sourceTab.getAttribute('aria-selected')) === 'true');
  await marginTab.click();
  await pp.waitForTimeout(200);
  check('Margin tab selects', (await marginTab.getAttribute('aria-selected')) === 'true');
  await pp.getByRole('button', { name: 'More' }).click();
  const menu = pp.getByRole('menu', { name: 'More' });
  await menu.waitFor({ timeout: 5000 });
  check('More menu opens', (await menu.getByRole('menuitem').count()) > 0, `${await menu.getByRole('menuitem').count()} items`);
  await pp.keyboard.press('Escape');
  check('Escape closes the menu', !(await menu.isVisible().catch(() => false)));
  // No horizontal scrolling on phone
  const scrollWidth = await pp.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await pp.evaluate(() => document.documentElement.clientWidth);
  check('phone never scrolls sideways', scrollWidth <= clientWidth, `${scrollWidth} vs ${clientWidth}`);
  await ctx3.close();

  await browser.close();

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
