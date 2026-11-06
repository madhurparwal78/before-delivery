// Frontend journey tests with Playwright against the running app.
// usage: node scripts/test-frontend.mjs
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:4173";
let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}  ${detail}`);
  }
}

const browser = await chromium.launch();

async function signIn(page, email) {
  page.on("pageerror", (e) => console.log(`  [pageerror:${email}]`, e.message));
  await page.goto(`${BASE}/`);
  await page.waitForLoadState("networkidle");
  if (await page.getByRole("button", { name: "Sign in" }).isVisible().catch(() => false)) {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Passcode").fill("lumen-pass-2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForSelector("#primary-nav a", { state: "attached", timeout: 10000 });
    await page.waitForTimeout(300);
  }
}

async function signedOut(page) {
  const res = await page.request.get(`${BASE}/api/me`);
  return res.status() !== 200;
}

// --- Sign in ---------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.waitForSelector('form[aria-label="Sign in"]', { timeout: 5000 });
  check("sign-in form present", true);
  check("skip link first", (await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("a,button,input,select,[tabindex]"));
    return els[0]?.getAttribute("href") === "#main" || els[0]?.textContent?.includes("Skip to main content");
  })));
  await page.getByLabel("Email").fill("ines@halden.example");
  await page.getByLabel("Passcode").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForSelector('text=That email and passcode do not match.');
  check("wrong passcode alert", true);
  await page.getByLabel("Passcode").fill("lumen-pass-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForSelector('nav[aria-label="Primary"]');
  check("member home is Run", page.url().includes("/run"));
  check("primary nav shows Run", await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Run" }).isVisible());
  const navLinks = await page.locator('#primary-nav a').allTextContents();
  check("member nav excludes Finance/Admin", !navLinks.includes("Finance") && !navLinks.includes("Admin"), navLinks.join(","));
  await ctx.close();
}

// --- Run screen: catalogue, form generation, meter, queue ------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await signIn(page, "ines@halden.example");
  await page.waitForSelector('nav[aria-label="Catalogue"]');
  check("catalogue rail present", true);
  check("Image heading", await page.locator('nav[aria-label="Catalogue"] h3', { hasText: "Image" }).count() > 0);
  const blockedMarks = await page.locator('nav[aria-label="Catalogue"] .blocked-mark').count();
  check("no model blocked for campaigns playground in the seed", blockedMarks === 0, blockedMarks);

  // choose Halftone XL: form generated from schema
  await page.locator('nav[aria-label="Catalogue"] button', { hasText: "Halftone XL" }).click();
  await page.waitForSelector('form[aria-label="Run Halftone XL"]');
  check("run form labelled", true);
  const widthSel = await page.locator('select[data-field="width"]').count();
  const heightSel = await page.locator('select[data-field="height"]').count();
  const numImages = await page.locator('input[data-field="num_images"]').count();
  const prompt = await page.locator('[data-field="prompt"]').count();
  check("schema-generated fields", widthSel === 1 && heightSel === 1 && numImages === 1 && prompt === 1);
  const estimateText = await page.locator(".form-actions .num").textContent();
  check("estimate shown", /Estimated .*credits for 1\.048576 megapixels/.test(estimateText ?? ""), estimateText);
  // focus moved to the first field
  check("focus on first field", await page.evaluate(() => document.activeElement?.dataset?.field === "prompt"));

  // run it
  await page.locator('[data-field="prompt"]').fill("Test poster");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.locator("#notice-region", { hasText: /queued — .* credits reserved/ }).waitFor({ timeout: 10000 });
  check("run success notice", true);
  await page.waitForFunction(() => {
    const el = document.querySelector('[role="meter"][aria-label="Settled"]');
    return el && Number(el.getAttribute("aria-valuenow")) > 0;
  }, undefined, { timeout: 30000 });
  check("job settles and the settled segment grows", true);

  // meter segments exist
  const meters = await page.locator('.credit-meter [role="meter"]').count();
  check("three meter segments", meters === 3, meters);
  const settled = await page.locator('[role="meter"][aria-label="Settled"]');
  const settledNow = await settled.getAttribute("aria-valuenow");
  check("settled segment carries value", Number(settledNow) > 0, settledNow);
  await page.waitForFunction(() => document.querySelectorAll(".credit-meter .notch").length === 0, undefined, { timeout: 15000 });
  const notches = await page.locator(".credit-meter .notch").count();
  check("no notches when idle", notches === 0, notches);

  // lineage strip shows the output
  await page.waitForSelector('.lineage-strip .lineage-node', { timeout: 20000 });
  check("lineage node appears", true);

  // queue lanes
  await page.waitForSelector('section[aria-label="Queue"]');
  const lanes = await page.locator('section[aria-label="Queue"] ul').count();
  check("four lanes", lanes === 4, lanes);
  await ctx.close();
}

// --- Jobs screen -----------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await signIn(page, "ines@halden.example");
  await page.goto(`${BASE}/jobs`);
  await page.waitForSelector('table[aria-label="Jobs"]');
  check("jobs table present", true);
  const statusCombo = await page.locator('select[aria-label="Status"]').count();
  check("status filter", statusCombo === 1);
  const exportLink = await page.getByRole("link", { name: "Export CSV" }).count();
  check("export csv link", exportLink === 1);
  // job detail dialog
  await page.locator('table[aria-label="Jobs"] tbody tr').first().click();
  await page.waitForSelector('[role="dialog"]');
  check("job dialog opens", true);
  const closeCount = await page.getByRole("button", { name: "Close" }).count();
  check("close button", closeCount >= 1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check("escape closes dialog", (await page.locator('[role="dialog"]').count()) === 0);
  await ctx.close();
}

// --- Library + deletion + tombstone ---------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await signIn(page, "sol@halden.example");
  await page.goto(`${BASE}/library`);
  await page.waitForSelector('input[aria-label="Search media"]');
  check("library search box", true);
  await page.fill('input[aria-label="Search media"]', "poster");
  await page.waitForTimeout(600);
  const cards = await page.locator('ul[aria-label="Results"] .asset-card').count();
  check("search finds the poster", cards >= 1, cards);
  await page.locator('ul[aria-label="Results"] .asset-card').first().click();
  await page.waitForSelector('[role="dialog"]');
  check("asset dialog", true);
  const del = await page.getByRole("button", { name: "Delete", exact: true }).count();
  check("compliance sees Delete", del === 1);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForSelector('[role="alertdialog"]');
  check("delete alert dialog", true);
  const keepFocused = await page.evaluate(() => document.activeElement?.textContent === "Keep");
  check("focus starts on Keep", keepFocused);
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await page.locator("#notice-region", { hasText: /deleted from storage, search and lineage/ }).waitFor({ timeout: 10000 });
  check("delete notice", true);
  const focusInSearch = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Search media");
  check("focus returns to search box", focusInSearch);
  await ctx.close();
}

// --- Webhooks (member adds endpoint, sees secret dialog) --------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await signIn(page, "ines@halden.example");
  await page.goto(`${BASE}/webhooks`);
  await page.waitForSelector('form[aria-label="Add endpoint"]');
  await page.getByLabel("Endpoint URL").fill("http://main:18077/hook");
  await page.getByRole("button", { name: "Add endpoint" }).click();
  await page.waitForSelector('[role="dialog"][aria-label="Signing secret"]');
  check("signing secret dialog", true);
  const secret = await page.locator('[role="dialog"] .num').textContent();
  check("secret whsec format", /^whsec_[0-9a-f]{32}$/.test(secret?.trim() ?? ""), secret);
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForSelector('table[aria-label="Endpoints"]');
  check("endpoints table", true);
  await ctx.close();
}

// --- Finance (June tops up Campaigns) ---------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await signIn(page, "june@halden.example");
  await page.waitForTimeout(1200);
  check("finance home", page.url().includes("/finance"), page.url());
  await page.waitForSelector('form[aria-label="Top up credits"]');
  const teamSel = page.getByRole("combobox", { name: "Team" }).first();
  await teamSel.selectOption({ label: "Campaigns" });
  await page.getByRole("spinbutton", { name: "Credits" }).fill("500");
  await page.getByRole("button", { name: "Top up" }).click();
  const feedback = page.locator("#notice-region, #alert-region").filter({ hasText: /Added 500 credits to Campaigns|pending|declined|not match|failed/ });
  await feedback.waitFor({ timeout: 45000 });
  const feedbackText = await feedback.first().textContent();
  check("top-up success notice", /Added 500 credits to Campaigns|pending/.test(feedbackText ?? ""), feedbackText);
  await page.waitForSelector('table[aria-label="Top-ups"] tr', { timeout: 10000 });
  const paid = await page.locator('table[aria-label="Top-ups"] td', { hasText: "Paid" }).count();
  check("top-up shows Paid", paid >= 1, paid);
  await page.waitForSelector('table[aria-label="Ledger"]');
  check("ledger table present", true);
  const exportLedger = await page.getByRole("link", { name: "Export ledger CSV" }).count();
  check("ledger export link", exportLedger === 1);
  // schedule a rate
  await page.waitForSelector('form[aria-label="Schedule rate change"]');
  check("rate schedule form", true);
  await page.waitForSelector('table[aria-label="Rate schedule"]');
  const rows = await page.locator('table[aria-label="Rate schedule"] tbody tr').count();
  check("rate schedule rows", rows >= 1, rows);
  await ctx.close();
}

// --- Admin (Rafael saves policy) --------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await signIn(page, "rafael@halden.example");
  await page.waitForTimeout(1200);
  check("admin home", page.url().includes("/admin"), page.url());
  await page.waitForSelector('form[aria-label="Org policy"]');
  check("org policy form", true);
  const teamCombos = await page.locator('fieldset[aria-label="Campaigns"] select').count();
  check("campaigns group has model combos", teamCombos >= 8, teamCombos);
  // block Halftone XL playground for Campaigns, restrict payloads
  await page.locator('fieldset[aria-label="Campaigns"] select[aria-label="Halftone XL playground"]').selectOption("Blocked");
  await page.locator('fieldset[aria-label="Campaigns"] select[aria-label="Payload visibility"]').selectOption("Restricted");
  await page.getByRole("button", { name: "Save policy" }).click();
  await page.locator("#notice-region", { hasText: /Policy saved as version \d+/ }).waitFor({ timeout: 10000 });
  check("policy saved notice", true);
  await page.waitForSelector('ul[aria-label="Policy versions"]');
  const versions = await page.locator('ul[aria-label="Policy versions"] li').count();
  check("policy versions list", versions >= 2, versions);
  await ctx.close();
}

// --- Responsive layout -------------------------------------------------------
for (const viewport of [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
]) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await signIn(page, "ines@halden.example");
  await page.waitForTimeout(800);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check(`no horizontal scroll at ${viewport.width}`, !overflow);
  const menu = await page.getByRole("button", { name: "Menu" }).count();
  const catalogueBtn = await page.getByRole("button", { name: "Catalogue" }).count();
  check(`menu and catalogue buttons at ${viewport.width}`, menu >= 1 && catalogueBtn >= 1, `menu=${menu} cat=${catalogueBtn}`);
  if (viewport.width < 600) {
    await page.getByRole("button", { name: "Menu" }).click();
    const navVisible = await page.locator("#primary-nav.open a").first().isVisible();
    check(`menu opens primary nav at ${viewport.width}`, navVisible);
  }
  // tap targets: every visible button/input/select at least 44 tall? check a sample
  const smallTargets = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll("button, input, select")) {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.height < 43) bad.push(`${el.getAttribute("aria-label") ?? el.textContent}:${Math.round(r.height)}`);
    }
    return bad;
  });
  check(`tap targets >=44px at ${viewport.width}`, smallTargets.length === 0, smallTargets.slice(0, 6).join(" | "));
  await ctx.close();
}

// --- Reduced motion ----------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await signIn(page, "ines@halden.example");
  await page.waitForSelector(".credit-meter");
  const transition = await page.evaluate(() => getComputedStyle(document.querySelector(".meter-seg")).transitionDuration);
  check("reduced motion: no transitions", transition === "0s", transition);
  await ctx.close();
}

await browser.close();
console.log();
console.log(`passed ${passed}, failed ${failed}`);
process.exit(failed === 0 ? 0 : 1);
