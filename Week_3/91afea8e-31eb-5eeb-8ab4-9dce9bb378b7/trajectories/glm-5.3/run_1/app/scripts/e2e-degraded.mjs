// DP-12: the degraded banner shows on the search page and listings stay saveable.
import { chromium } from "playwright";
import { Pool } from "pg";
import { createHash } from "node:crypto";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
async function otpFor(identifier) {
  const res = await pool.query("SELECT code_hash FROM pending_signins WHERE identifier = $1 ORDER BY issued_at DESC LIMIT 1", [identifier]);
  const hash = res.rows[0]?.code_hash;
  for (let i = 0; i < 1000000; i++) {
    const c = String(i).padStart(6, "0");
    if (createHash("sha256").update(c).digest("hex") === hash) return c;
  }
  return null;
}

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await page.goto("http://localhost:4299/search?q=tiffin");
await page.waitForTimeout(2000);
const banner = await page.evaluate(() => document.querySelector(".banner-degraded")?.textContent ?? "");
check("degraded banner shows", banner.includes("Search is running in basic mode. Typo matching and filters are off for now."), banner);
const cards = await page.locator(".product-card").count();
check("results still render in basic mode", cards > 0, `${cards} cards`);

// listings stay saveable while search is degraded: sign in as a seller and save stock
await page.goto("http://localhost:4299/signin");
await page.waitForTimeout(700);
await page.getByLabel("Email or phone").fill("sabarmati@example.test");
await page.getByLabel("Password").fill("Sabarmati@Seller2026");
await page.getByRole("button", { name: "Continue" }).first().click();
await page.waitForTimeout(900);
const code = await otpFor("sabarmati@example.test");
check("seller otp issued", !!code, code ?? "none");
if (code) {
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify" }).click();
  await page.waitForTimeout(1500);
  check("seller lands on shipments", page.url().includes("/seller/shipments"), page.url());
  await page.goto("http://localhost:4299/seller/stock");
  await page.waitForTimeout(900);
  const rows = await page.locator("table[aria-label='Low stock'] tbody tr").count();
  check("low stock board loads", rows > 0, `${rows} rows`);
  if (rows > 0) {
    const save = page.getByRole("button", { name: /^Save stock for/ }).first();
    await save.click();
    await page.waitForTimeout(900);
    const status = await page.evaluate(() => document.querySelector("[aria-label='Save status']")?.textContent ?? "");
    check("stock save announced", /^Stock saved: .+ units\.$/.test(status), status);
  }
}

await browser.close();
await pool.end();
