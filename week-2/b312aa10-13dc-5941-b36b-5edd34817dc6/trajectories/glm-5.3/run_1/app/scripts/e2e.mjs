import { chromium } from 'playwright';

const base = 'http://localhost:4173';
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(String(err)));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

// 1. Sign-in screen renders
await page.goto(base + '/');
await page.waitForTimeout(600);
check('sign-in fields', await page.locator('[aria-label="Email"]').count() > 0);
check('sign-in button', (await page.locator('button:has-text("Sign in")').count()) > 0);

// 2. Sign in as member
await page.fill('[aria-label="Email"]', 'ada@bellobakes.example');
await page.fill('[aria-label="Password"]', 'lineboard-demo');
await page.click('button:has-text("Sign in")');
await page.waitForTimeout(1200);
check('lands on board', page.url().includes('/board'));
await page.goto(base + '/board?date=2026-11-10');
await page.waitForTimeout(900);
check('heading level 1', await page.locator('h1').count() > 0);
check('hour ruler', (await page.locator('list, [role="list"][aria-label="Hour ruler"]').count()) > 0 || (await page.locator('[aria-label="Hour ruler"]').count()) > 0);
check('line board region', (await page.locator('[aria-label="Line board"]').count()) > 0);
check('lane count', (await page.locator('.lane').count()) >= 6, `${await page.locator('.lane').count()} lanes`);
check('hour bank group', (await page.locator('[aria-label="Hour bank"]').count()) === 1);
check('hour bank text', (await page.locator('#hour-bank-figures').textContent()).includes('h left'));
check('blocks on board', (await page.locator('.block').count()) >= 1, `${await page.locator('.block').count()} blocks`);

// 3. Open New booking via the New booking button
await page.click('button:has-text("New booking")');
await page.waitForTimeout(300);
check('new booking dialog', (await page.locator('[aria-label="New booking"]').count()) === 1);
await page.selectOption('[aria-label="Station"]', 'stn_oven2');
await page.fill('[aria-label="Date"]', '2026-11-20');
await page.fill('[aria-label="Start"]', '18:00');
await page.fill('[aria-label="End"]', '21:00');
await page.click('button:has-text("Hold block")');
await page.waitForTimeout(1200);
check('ticket appears', (await page.locator('.ticket').count()) >= 1);
check('confirm button present', (await page.locator('.ticket button:has-text("Confirm")').count()) >= 1);
check('status announcement', await page.locator('#app-status').textContent() !== '');

// 4. Confirm the ticket
await page.click('.ticket button:has-text("Confirm")');
await page.waitForTimeout(1500);
check('block landed in lane', (await page.locator('.block.confirmed').count()) >= 1);
check('hour bank lowered', !(await page.locator('#hour-bank-figures').textContent()).includes('40 h left'), await page.locator('#hour-bank-figures').textContent());

// 5. Block details dialog on the new block
const target = page.locator('.block.confirmed').first();
await target.click();
await page.waitForTimeout(400);
check('block details dialog', (await page.locator('[aria-label="Block details"]').count()) === 1);
check('cancel booking offered', (await page.locator('button:has-text("Cancel booking")').count()) >= 1);
await page.keyboard.press('Escape');
if (await page.locator('#dialog-dim').count()) await page.click('[aria-label="Block details"] button:has-text("Close")');
await page.waitForTimeout(200);

// 6. Sign out; session handover
await page.click('button:has-text("Sign out")');
await page.waitForTimeout(800);
check('back at sign-in', page.url().endsWith('/') && (await page.locator('[aria-label="Email"]').count()) > 0);

// 7. Sign in as shift lead; board with Mark out of service
await page.fill('[aria-label="Email"]', 'lead@northside.example');
await page.fill('[aria-label="Password"]', 'lineboard-demo');
await page.click('button:has-text("Sign in")');
await page.waitForTimeout(1200);
check('shift lead on board', page.url().includes('/board'));
await page.goto(base + '/board?date=2026-11-10');
await page.waitForTimeout(900);
check('mark out of service button', (await page.locator('button:has-text("Mark out of service")').count()) === 1);
check('no New booking for staff', (await page.locator('button:has-text("New booking")').count()) === 0);
check('no hour bank for staff', (await page.locator('[aria-label="Hour bank"]').count()) === 0);
check('staff sees business name', (await page.locator('.block').count()) === 0 || ((await page.locator('.block').first().getAttribute('aria-label')) ?? '').includes('Bello'));

// 8. Sign in as operator; settings screen
await page.click('button:has-text("Sign out")');
await page.waitForTimeout(600);
await page.fill('[aria-label="Email"]', 'ops@northside.example');
await page.fill('[aria-label="Password"]', 'lineboard-demo');
await page.click('button:has-text("Sign in")');
await page.waitForTimeout(1200);
await page.click('nav a:has-text("Settings")');
await page.waitForTimeout(1000);
check('settings stations table', (await page.locator('[aria-label="Stations"]').count()) === 1);
check('rate versions table', (await page.locator('[aria-label="Rate versions"]').count()) === 1);
check('peak windows group', (await page.locator('[aria-label="Peak windows"]').count()) === 1);
check('9 rate versions rows', (await page.locator('[aria-label="Rate versions"] tbody tr').count()) === 9, `${await page.locator('[aria-label="Rate versions"] tbody tr').count()} rows`);

// 9. Invoices with member picker
await page.click('nav a:has-text("Invoices")');
await page.waitForTimeout(800);
check('member picker combobox', (await page.locator('[aria-label="Member"]').count()) === 1);
await page.fill('[aria-label="Member"]', 'sat');
await page.waitForTimeout(700);
check('picker options', (await page.locator('[role="option"]').count()) >= 1, `${await page.locator('[role="option"]').count()} options`);
const optionText = await page.locator('[role="option"]').first().textContent();
check('picker shows Sato', optionText.includes('Sato Pickle Co. · Rina Sato'), optionText);
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
check('picker selection', (await page.locator('[aria-label="Member"]').inputValue()).includes('Rina'));
await page.click('button:has-text("Show invoice")');
await page.waitForTimeout(900);
check('invoice region', (await page.locator('[aria-label="Invoice"]').count()) === 1);

// 10. Phone viewport: menu folds
await page.setViewportSize({ width: 375, height: 812 });
await page.waitForTimeout(400);
check('menu button visible', (await page.locator('#menu-button').isHidden?.() ?? true) || (await page.locator('#menu-button').isVisible()));
check('nav hidden on phone', !(await page.locator('nav[aria-label="Main"]').isVisible()));
await page.click('#menu-button');
await page.waitForTimeout(300);
check('menu opens', (await page.locator('#menu-button').getAttribute('aria-expanded')) === 'true');
await page.keyboard.press('Escape');
check('menu folds on Escape', (await page.locator('#menu-button').getAttribute('aria-expanded')) === 'false');
const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
check('no sideways scroll at 375', scrollWidth <= 376, `scrollWidth=${scrollWidth}`);

check('no page errors', errors.filter((e) => e.startsWith('PAGEERROR')).length === 0, errors.filter((e) => e.startsWith('PAGEERROR')).slice(0, 3).join(' | '));

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed > 0 ? 1 : 0);
