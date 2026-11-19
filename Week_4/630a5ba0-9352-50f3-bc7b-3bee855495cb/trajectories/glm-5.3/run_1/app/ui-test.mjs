import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4173';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// 1. Sign in page
await page.goto(BASE + '/signin');
console.log('title:', await page.title());
await page.fill('#signin-email', 'wren@harbourlane.test');
await page.fill('#signin-password', 'daybook-demo-2026');
await page.click('button:has-text("Sign in")');
await page.waitForURL(BASE + '/', { timeout: 8000 }).catch(() => console.log('URL still:', page.url()));
await page.waitForSelector('.ritual-rail', { timeout: 8000 });
console.log('on daybook:', page.url());

// 2. Board contents
const dayHeadings = await page.locator('.day-column h2').allTextContents();
console.log('day headings:', dayHeadings.slice(0, 3).join(' | '));
const totals = await page.locator('.day-column .total .mono').allTextContents();
console.log('totals:', totals.join(' | '));
const backlogTitles = await page.locator('.backlog .card-list .card .title').allTextContents();
console.log('backlog:', backlogTitles.join(' | '));
const banner = await page.locator('.subscription-banner').allTextContents();
console.log('banner:', banner.join(' | ') || '(none)');

// 3. Banner text and nav
console.log('nav links:', await page.locator('nav[aria-label="Main"] a').allTextContents());
const statusRegion = await page.locator('[role="status"]').count();
console.log('status region count:', statusRegion);

// 4. Screenshot for reference
await page.screenshot({ path: '/tmp/daybook-1280.png', fullPage: true });

// 5. Add a task
await page.fill('#add-task', 'Check the harbour lights');
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
const after = await page.locator('.backlog .card-list .card .title').allTextContents();
console.log('backlog after add:', after.join(' | '));

// 6. Suggestions
await page.fill('#add-task', 'prop');
await page.waitForTimeout(600);
const suggestions = await page.locator('.suggestions button').allTextContents();
console.log('suggestions:', suggestions.join(' | '));
await page.keyboard.press('Escape');

console.log('PAGE ERRORS:', errors.length === 0 ? 'none' : errors.slice(0, 5));
await browser.close();
