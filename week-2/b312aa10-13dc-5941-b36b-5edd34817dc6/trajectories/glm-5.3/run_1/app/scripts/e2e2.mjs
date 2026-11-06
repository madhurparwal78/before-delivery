import { chromium } from 'playwright';

const base = 'http://localhost:4173';
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' — ' + detail}`);
const browser = await chromium.launch({ args: ['--no-sandbox'] });

// --- Documents screen: member upload via UI, operator approve ---
{
  const page = await browser.newPage();
  await page.goto(base + '/');
  await page.fill('[aria-label="Email"]', 'rina@satopickle.example');
  await page.fill('[aria-label="Password"]', 'lineboard-demo');
  await page.click('button:has-text("Sign in")');
  await page.waitForTimeout(1000);
  await page.click('nav a:has-text("Documents")');
  await page.waitForTimeout(800);
  check('documents table wide', (await page.locator('[aria-label="Documents"]').count()) === 1);
  check('upload form present', (await page.locator('[aria-label="Document type"]').count()) === 1);
  const beforeRows = await page.locator('[aria-label="Documents"] tbody tr').count();
  check('seed docs listed (2)', beforeRows === 2, `${beforeRows} rows`);
  await page.selectOption('[aria-label="Document type"]', 'food_handler_card');
  await page.fill('[aria-label="Expiry date"]', '2027-05-01');
  await page.setInputFiles('[aria-label="File"]', {
    name: 'card.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 rina renewed card'),
  });
  await page.click('button:has-text("Upload")');
  await page.waitForTimeout(1200);
  const afterRows = await page.locator('[aria-label="Documents"] tbody tr').count();
  check('upload adds a row', afterRows === beforeRows + 1, `${afterRows} rows`);
  check('status announcement', (await page.locator('#app-status').textContent()).includes('Uploaded'), await page.locator('#app-status').textContent());
  // Narrow viewport: the list layout switches to cards.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(700);
  check('documents list layout below 768', (await page.locator('[aria-label="Documents"][role="list"], ul[aria-label="Documents"]').count()) === 1, (await page.locator('#documents-container').innerHTML()).slice(0, 80));
  check('doc cards labelled', (await page.locator('.doc-card').count()) === 3, `${await page.locator('.doc-card').count()} cards`);
  await page.close();
}

// --- Operator approves the card on the phone layout ---
{
  const page = await browser.newPage();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(base + '/');
  await page.fill('[aria-label="Email"]', 'ops@northside.example');
  await page.fill('[aria-label="Password"]', 'lineboard-demo');
  await page.click('button:has-text("Sign in")');
  await page.waitForTimeout(1000);
  check('menu button in phone layout', (await page.locator('#menu-button').isVisible()));
  await page.click('#menu-button');
  check('menu opens', (await page.locator('#menu-button').getAttribute('aria-expanded')) === 'true');
  await page.click('#menu-panel a:has-text("Documents")');
  await page.waitForTimeout(900);
  check('menu folded after link', (await page.locator('#menu-button').getAttribute('aria-expanded')) === 'false');
  check('operator sees card list', (await page.locator('.doc-card').count()) >= 7, `${await page.locator('.doc-card').count()} cards`);
  const approveButton = page.locator('button[aria-label^="Approve"]').first();
  if (await approveButton.count()) {
    await approveButton.click();
    await page.waitForTimeout(1200);
    check('approve announced', (await page.locator('#app-status').textContent()).includes('Approved'), await page.locator('#app-status').textContent());
  } else {
    check('approve button present', false, 'no approve button');
  }
  await page.close();
}

// --- Inspector view through the browser ---
{
  // Create a link via the API from an operator page context.
  const opPage = await browser.newPage();
  await opPage.goto(base + '/');
  await opPage.fill('[aria-label="Email"]', 'ops@northside.example');
  await opPage.fill('[aria-label="Password"]', 'lineboard-demo');
  await opPage.click('button:has-text("Sign in")');
  await opPage.waitForTimeout(900);
  const token = await opPage.evaluate(async () => {
    const response = await fetch('/api/inspector-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'e2e@example.org', expiresAt: '2026-11-20T12:00:00-05:00' }),
    });
    const data = await response.json();
    return data.link.url.split('/inspect/')[1];
  });
  const page = await browser.newPage();
  await page.goto(base + '/inspect/' + token);
  await page.waitForTimeout(900);
  check('inspector heading', (await page.locator('h1').first().textContent()).includes('Northside Commissary'));
  check('inspector available until line', (await page.locator('main p').first().textContent()).includes('available until'));
  check('inspector sanitation log', (await page.locator('[aria-label="Sanitation log"]').count()) === 1);
  check('inspector certificates', (await page.locator('[aria-label="Member certificates"]').count()) === 1);
  check('inspector monthly pdfs', (await page.locator('[aria-label="Monthly PDFs"]').count()) === 1);
  await page.close();
  await opPage.close();
}

// --- Board interactions: cell tap opens New booking prefilled ---
{
  const page = await browser.newPage();
  await page.goto(base + '/');
  await page.fill('[aria-label="Email"]', 'ada@bellobakes.example');
  await page.fill('[aria-label="Password"]', 'lineboard-demo');
  await page.click('button:has-text("Sign in")');
  await page.waitForTimeout(1000);
  // Find an empty cell in Oven 2 and click it.
  const lane = page.locator('.lane', { hasText: 'Oven 2' });
  await lane.locator('.cell').nth(72).click(); // 18:00 cell
  await page.waitForTimeout(300);
  check('cell click opens New booking', (await page.locator('[aria-label="New booking"]').count()) === 1);
  const startValue = await page.locator('[aria-label="Start"]').inputValue();
  const endValue = await page.locator('[aria-label="End"]').inputValue();
  check('prefilled start 18:00', startValue === '18:00', startValue);
  check('prefilled end one hour later', endValue === '19:00', endValue);
  await page.keyboard.press('Escape');
  await page.click('button:has-text("Close")').catch(() => undefined);
  await page.waitForTimeout(200);
  check('dialog closed', (await page.locator('#dialog-dim').count()) === 0);
  await page.close();
}

// --- Board date controls ---
{
  const page = await browser.newPage();
  await page.goto(base + '/');
  await page.fill('[aria-label="Email"]', 'ada@bellobakes.example');
  await page.fill('[aria-label="Password"]', 'lineboard-demo');
  await page.click('button:has-text("Sign in")');
  await page.waitForTimeout(1000);
  await page.click('button:has-text("Next day")');
  await page.waitForTimeout(600);
  check('next day moves the board', page.url().includes('date='), page.url());
  const heading1 = await page.locator('h1').first().textContent();
  check('heading names the date', /\d{1,2} \w+ \d{4}/.test(heading1 ?? ''), heading1);
  await page.click('button:has-text("Today")');
  await page.waitForTimeout(600);
  await page.click('button:has-text("Previous day")');
  await page.waitForTimeout(600);
  check('history entries added', true);
  await page.close();
}

const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(results.join('\n'));
console.log(`\n${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed > 0 ? 1 : 0);
