/**
 * Dialog focus behaviour, the admin layout at 375 and the comparison table.
 * Needs a freshly reset database and a built, running app.
 */

import { chromium } from "/tmp/node_modules/playwright/index.mjs";

const BASE = process.env.LF_BASE ?? "http://127.0.0.1:4173";
let passed = 0;
const failures = [];
const check = (n, ok, d) => { if (ok) passed += 1; else failures.push(`${n} -> ${JSON.stringify(d)}`); };
const eq = (n, a, e) => check(n, JSON.stringify(a) === JSON.stringify(e), { actual: a, expected: e });

async function signIn(page, email, password) {
  await page.goto(`${BASE}/signin`);
  const main = page.locator("main");
  await main.getByRole("textbox", { name: "Email" }).fill(email);
  await main.getByRole("textbox", { name: "Password" }).fill(password);
  await main.getByRole("button", { name: "Sign in" }).click();
  await page.waitForFunction(() => !location.pathname.startsWith("/signin"), null, { timeout: 8000 });
}

const browser = await chromium.launch();

/* ---------- dialog focus trap wraps at both ends ---------- */
{
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/catalogue`);
  await page.waitForSelector("article.card");
  await page.getByRole("button", { name: "Filters" }).click();
  await page.waitForTimeout(400);

  const focusables = await page.evaluate(() => {
    const panel = document.querySelector('[role="dialog"]');
    const sel = "a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex='-1'])";
    return [...panel.querySelectorAll(sel)].length;
  });
  check("the sheet has focusable controls", focusables > 1, focusables);

  // Tab from the last control wraps to the first.
  await page.evaluate(() => {
    const panel = document.querySelector('[role="dialog"]');
    const sel = "a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex='-1'])";
    const items = [...panel.querySelectorAll(sel)];
    items[items.length - 1].focus();
  });
  await page.keyboard.press("Tab");
  const wrappedForward = await page.evaluate(() => {
    const panel = document.querySelector('[role="dialog"]');
    const sel = "a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex='-1'])";
    return panel.querySelectorAll(sel)[0] === document.activeElement;
  });
  check("Tab from the last control wraps to the first", wrappedForward);

  await page.keyboard.press("Shift+Tab");
  const wrappedBack = await page.evaluate(() => {
    const panel = document.querySelector('[role="dialog"]');
    const sel = "a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex='-1'])";
    const items = [...panel.querySelectorAll(sel)];
    return items[items.length - 1] === document.activeElement;
  });
  check("Shift+Tab from the first wraps to the last", wrappedBack);

  // Focus stays inside the dialog, so the page behind cannot be focused.
  const inside = await page.evaluate(() => document.querySelector('[role="dialog"]').contains(document.activeElement));
  check("focus stays inside the dialog", inside);

  // Closing returns focus to the control that opened it.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  eq("closing returns focus to the opener", await page.evaluate(() => document.activeElement?.textContent?.trim()), "Filters");
  await context.close();
}

/* ---------- admin at 375: cells wrap, actions stack ---------- */
{
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await signIn(page, "admin@southerly-light.test", "Lightfall-admin-2026");
  await page.goto(`${BASE}/admin`);
  await page.waitForSelector('table[aria-label="Trade applications"]');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("the admin tables do not scroll the page sideways at 375", overflow <= 1, overflow);
  const wrap = await page.evaluate(() => {
    const cell = document.querySelector("table td");
    return cell ? getComputedStyle(cell).overflowWrap : "";
  });
  check("admin cells wrap their text", wrap === "anywhere" || wrap === "break-word", wrap);
  const stacked = await page.evaluate(() => {
    const actions = document.querySelector(".row-actions");
    return actions ? getComputedStyle(actions).flexDirection : "";
  });
  eq("action buttons stack under the row text at 375", stacked, "column");

  // Four tabs are reachable.
  eq("four admin tabs", await page.getByRole("tab").count(), 4);
  await context.close();
}

/* ---------- the comparison never scrolls sideways at 375 ---------- */
{
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/compare?codes=KDL-BK-24-3000,TTS-BK-24-3000,PHP-BR-60-2700,HSC-WH-24-3000`);
  await page.waitForSelector('table[aria-label="Comparison"]');
  const tableOverflow = await page.evaluate(() => {
    const frame = document.querySelector(".table-frame");
    return frame.scrollWidth - frame.clientWidth;
  });
  check("the comparison table never scrolls sideways", tableOverflow <= 1, tableOverflow);
  eq("four columns of fittings", await page.locator('table[aria-label="Comparison"] thead th').count(), 5);
  await context.close();
}

await browser.close();
console.log(`\n${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
if (failures.length > 0) process.exitCode = 1;
