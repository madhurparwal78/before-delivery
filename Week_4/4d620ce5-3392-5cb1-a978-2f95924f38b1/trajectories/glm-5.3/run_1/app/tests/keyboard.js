/* Keyboard and a11y checks: grid arrows, tab order, reduced motion, viewports. */
const { chromium } = require("playwright-core");
const BASE = "http://127.0.0.1:4173";
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "  ok:" : "FAIL:"} ${name} ${detail}`);
}
(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

  // 1280x800 keyboard flow
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.fill('input[aria-label="Username"]', "avery.lund");
  await page.fill('input[aria-label="Passcode"]', "saltmarsh-planner-1");
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('[role="grid"]');
  await page.locator("[role='gridcell']:not(.empty)").first().focus();
  const before = await page.evaluate(() => document.activeElement.dataset.registration);
  await page.keyboard.press("ArrowDown");
  const after = await page.evaluate(() => document.activeElement.dataset.registration);
  check("ArrowDown moves a row", before !== after, `${before} -> ${after}`);
  await page.keyboard.press("ArrowRight");
  const right = await page.evaluate(() => document.activeElement.dataset.directive);
  check("ArrowRight moves a column", !!right);
  await page.keyboard.press("Enter");
  await page.waitForSelector('[aria-label^="Thread "]');
  check("Enter opens the drawer", true);
  await page.keyboard.press("Escape");
  check("Escape closes the drawer", (await page.locator("#drawer").isVisible()) === false);

  // page does not scroll sideways at 1280
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check("no horizontal overflow at 1280", !overflow);

  // grid is a single tab stop
  await page.locator("[role='gridcell']:not(.empty)").first().focus();
  await page.keyboard.press("Tab");
  const tagAfterTab = await page.evaluate(() => document.activeElement.tagName);
  check("Tab leaves the grid (single tab stop)", tagAfterTab !== "TD", tagAfterTab);

  // 768x1024
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(300);
  const overflow768 = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check("no horizontal overflow at 768", !overflow768);
  const directivesBtn = await page.locator('button:has-text("Directives")').count();
  check("Directives button at 768", directivesBtn === 1);

  // 375x812
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
  const overflow375 = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check("no horizontal overflow at 375", !overflow375);
  const menuBtn = await page.locator('button:has-text("Menu")').count();
  check("Menu button at 375", menuBtn === 1);
  const picker = await page.locator('select[aria-label="Directive"]').count();
  check("Directive picker at 375", picker === 1);
  // drawer opens full screen at 375
  await page.locator("[role='gridcell']:not(.empty)").first().click();
  await page.waitForSelector('[aria-label^="Thread "]');
  const drawerWidth = await page.locator("#drawer").evaluate(node => node.getBoundingClientRect().width);
  check("drawer covers the width at 375", drawerWidth >= 370, String(drawerWidth));
  // focus trap: tab cycles inside the drawer
  const firstFocus = await page.evaluate(() => document.activeElement.tagName);
  for (let i = 0; i < 30; i += 1) await page.keyboard.press("Tab");
  const stillInside = await page.evaluate(() =>
    !!document.querySelector("#drawer").contains(document.activeElement));
  check("focus trapped in the full-screen drawer", stillInside);
  await page.keyboard.press("Escape");
  await page.close();

  // reduced motion: no splice busy state
  const page2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page2.emulateMedia({ reducedMotion: "reduce" });
  await page2.goto(BASE, { waitUntil: "networkidle" });
  await page2.fill('input[aria-label="Username"]', "avery.lund");
  await page2.fill('input[aria-label="Passcode"]', "saltmarsh-planner-1");
  await page2.click('button:has-text("Sign in")');
  await page2.waitForSelector('[role="grid"]');
  const busy = await page2.locator('[role="grid"]').getAttribute("aria-busy");
  check("grid not busy under reduced motion", busy === "false" || busy === null, String(busy));
  await page2.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\npassed: ${results.length - failed.length}  failed: ${failed.length}`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch(error => { console.error(error); process.exit(2); });
