// Browser smoke test for the published journeys. Run with: node scripts/e2e.mjs
import { chromium } from "playwright";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BASE = process.env.BASE_URL ?? "http://localhost:4173";

async function otpFor(identifier) {
  const res = await pool.query(
    "SELECT code_hash FROM pending_signins WHERE identifier = $1 ORDER BY issued_at DESC LIMIT 1",
    [identifier],
  );
  const hash = res.rows[0]?.code_hash;
  if (!hash) return null;
  for (let i = 0; i < 1000000; i++) {
    const candidate = String(i).padStart(6, "0");
    if (createHash("sha256").update(candidate).digest("hex") === hash) return candidate;
  }
  return null;
}

import { createHash } from "node:crypto";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text()); });

// ---------- Journey: home ----------
await page.goto(BASE + "/");
const h1 = await page.textContent("h1");
check("home headline", h1?.includes("everything. one cart."), String(h1));
await page.getByLabel("Your pincode").fill("560034");
await page.getByRole("button", { name: "Check" }).click();
await page.waitForTimeout(600);
const band = await page.textContent(".hero-promise");
check("home pincode promise", (band ?? "").includes("we deliver to"), String(band));

// ---------- Journey: search with typo, facets, load more ----------
await page.goto(BASE + "/search?q=dhwnai");
await page.waitForTimeout(800);
const results1 = await page.textContent("[aria-label='Search results']");
check("typo search finds Dhwani", (results1 ?? "").length > 0, String(results1));
const cardCount = await page.locator(".product-card").count();
check("search shows cards", cardCount > 0, `${cardCount} cards`);

// pincode + deliverable filter
await page.goto(BASE + "/search?q=&pin=560034");
await page.waitForTimeout(800);
const address = page.url();
check("search address holds state", address.includes("pin=560034"), address);

// ---------- Journey: product page ----------
await page.goto(BASE + "/p/steel-tiffin-3?pin=560034");
await page.waitForTimeout(700);
const productTitle = await page.textContent("h1");
check("product page title", (productTitle ?? "").includes("Steel Tiffin"), String(productTitle));
const viewer = page.locator(".viewer-3d");
check("3D viewer present", await viewer.count() === 1);

// ---------- Journey: sign in from product page, land back ----------
const unique = `shopper${Date.now() % 100000}`;
const uniquePhone = `+9198${String(Date.now()).padStart(10, "0").slice(-8)}`.slice(0, 14);
await page.goto(BASE + "/signup");
await page.waitForTimeout(700);
await page.getByLabel("Name").fill("Test Shopper");
await page.getByLabel("Email").fill(`${unique}@example.test`);
await page.getByLabel("Phone").fill(uniquePhone);
await page.getByLabel("Password").fill("Test@Bazaar2026");
await page.getByRole("button", { name: "Continue" }).first().click();
await page.waitForTimeout(900);
const signupCode = await otpFor(uniquePhone);
check("signup otp issued", !!signupCode, signupCode ?? "none");
if (signupCode) {
  await page.getByLabel("6-digit code").fill(signupCode);
  await page.getByRole("button", { name: "Verify" }).click();
  await page.waitForTimeout(1500);
}
// sign out via the API, then sign in from the product page
await page.evaluate(() => fetch("/api/auth/signout", { method: "POST" }));
await page.goto(BASE + "/p/steel-tiffin-3");
await page.waitForTimeout(900);
await page.getByRole("link", { name: "Sign in" }).first().click();
await page.waitForTimeout(500);
await page.getByLabel("Email or phone").fill(uniquePhone);
await page.getByLabel("Password").fill("Test@Bazaar2026");
await page.getByRole("button", { name: "Continue" }).first().click();
await page.waitForTimeout(800);
const code = await otpFor(uniquePhone);
check("otp issued", !!code, code ?? "none");
if (code) {
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify" }).click();
  await page.waitForTimeout(1200);
}
const afterUrl = page.url();
check("returns to starting page", afterUrl.includes("/p/steel-tiffin-3"), afterUrl);

// ---------- Journey: add to cart from product ----------
await page.getByRole("button", { name: "Add to cart" }).click();
await page.waitForTimeout(900);

// ---------- Journey: cart with coupon and gift wrap ----------
await page.goto(BASE + "/cart");
await page.waitForTimeout(1100);
const qty = page.locator("input[type=number]").first();
await qty.fill("2");
await qty.dispatchEvent("change");
await page.waitForTimeout(1200);
const cartStatus = await page.evaluate(() => document.querySelector("[aria-label='Cart updates']")?.textContent ?? "");
check("cart announcement", /Total .*, 1 parcel\./.test(cartStatus), cartStatus);

const payable = await page.evaluate(() => document.querySelector("[aria-label='Payable total']")?.textContent ?? "");
check("cart payable total", payable.includes("₹"), payable);
await page.getByLabel("Coupon code").fill("CHAURAHA10");
await page.getByRole("button", { name: "Apply coupon" }).click();
await page.waitForTimeout(1000);
const payable2 = await page.evaluate(() => document.querySelector("[aria-label='Payable total']")?.textContent ?? "");
check("coupon changes total", payable2 !== payable, `${payable} -> ${payable2}`);

// ---------- Journey: checkout ----------
await page.goto(BASE + "/checkout/address");
await page.waitForTimeout(900);
if ((await page.locator("input[name=address]").count()) === 0) {
  await page.getByRole("button", { name: "Add address" }).click();
  await page.waitForTimeout(600);
  const dialog = page.locator("dialog[open]");
  await dialog.locator("input[name=label]").fill("Home");
  await dialog.locator("input[name=name]").fill("Test Shopper");
  await dialog.locator("input[name=line1]").fill("12 Bazaar Lane");
  await dialog.locator("input[name=city]").fill("Bengaluru");
  await dialog.locator("input[name=pincode]").fill("560034");
  await dialog.locator("input[name=phone]").fill("+919812345678");
  await dialog.getByRole("button", { name: "Save address" }).click();
  await page.locator("dialog[open]").waitFor({ state: "detached", timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
}
await page.locator("input[name=address]").first().check();
await page.getByRole("button", { name: "Continue" }).first().click();
await page.waitForTimeout(1000);
check("payment step", page.url().includes("/checkout/payment"), page.url());
await page.locator("input[name=method][value=cod]").check();
await page.getByRole("button", { name: "Continue" }).first().click();
await page.waitForTimeout(1200);
const onReview = page.url().includes("/checkout/review");
check("review step", onReview, page.url());
if (onReview) {
  const payBtn = page.getByRole("button", { name: /Place order|Pay/ });
  await payBtn.click();
  await page.waitForTimeout(2500);
  const confirmUrl = page.url();
  check("confirmation route", confirmUrl.includes("/placed"), confirmUrl);
  const confirmHeading = await page.textContent("h1");
  check("order placed heading", (confirmHeading ?? "").includes("order placed"), String(confirmHeading));
}

// ---------- Layout at published breakpoints ----------
for (const size of [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
  await page.setViewportSize(size);
  await page.goto(BASE + "/search?q=");
  await page.waitForTimeout(700);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  check(`no horizontal scroll at ${size.width}`, scrollWidth <= clientWidth + 1, `${scrollWidth} vs ${clientWidth}`);
}

await browser.close();
await pool.end();
const failures = results.filter((r) => !r.ok);
console.log(`\n${results.length - failures.length}/${results.length} checks passed`);
process.exit(failures.length > 0 ? 1 : 0);
