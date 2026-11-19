const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

  const suffix = Date.now().toString().slice(-6);

  // Sign up
  await page.goto('http://127.0.0.1:4173/signup');
  await page.fill('[aria-label="Name"]', 'Ada Lindqvist');
  await page.fill('[aria-label="Email"]', `ada${suffix}@linewell.test`);
  await page.fill('[aria-label="Password"]', 'drafting-ada-01');
  await page.click('[aria-label="Create account"]');
  await page.waitForURL('http://127.0.0.1:4173/');
  console.log('signed up, at list page:', page.url());

  // Create a diagram via the New diagram button (uses prompt)
  page.once('dialog', (dialog) => dialog.accept('Pipeline'));
  await page.click('[aria-label="New diagram"]');
  await page.waitForURL(/\/d\//, { timeout: 5000 });
  console.log('created diagram:', page.url());

  // Check workspace markup
  const canvas = await page.$('#canvas');
  console.log('canvas exists:', canvas !== null);
  const heading = await page.$('.diagram-title');
  console.log('title:', await heading?.textContent());
  const emptyText = await page.textContent('.empty-page');
  console.log('empty page text:', JSON.stringify(emptyText));
  const announcer = await page.$('#announcer');
  console.log('announcer exists:', announcer !== null);

  // Insert a rectangle with R
  await page.click('#canvas');
  await page.keyboard.press('r');
  await page.waitForTimeout(600);
  const shapes = await page.$$('[id^="shape-"]');
  console.log('shapes after R:', shapes.length);
  if (shapes.length > 0) {
    const attrs = await shapes[0].getAttribute('data-x');
    console.log('first shape data-x:', attrs);
    const role = await shapes[0].getAttribute('role');
    const roledesc = await shapes[0].getAttribute('aria-roledescription');
    const label = await shapes[0].getAttribute('aria-label');
    console.log('shape role/roledesc/label:', role, roledesc, label);
  }

  // Nudge with arrow and check announcement
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(800);
  const announcerText = await page.textContent('#announcer');
  console.log('announcer after nudge:', JSON.stringify(announcerText));

  // Inspector shows values
  const x = await page.inputValue('[aria-label="X"]');
  console.log('inspector X:', x);

  // Sign out via top bar
  await page.click('[aria-label="Sign out"]');
  await page.waitForTimeout(500);
  console.log('after signout url:', page.url());

  if (errors.length > 0) {
    console.log('PAGE ERRORS:');
    for (const e of errors) console.log('  ', e.slice(0, 300));
  } else {
    console.log('no page errors');
  }
  await browser.close();
})().catch((err) => { console.error('TEST FAILED', err); process.exit(1); });
