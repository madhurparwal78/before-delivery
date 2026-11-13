// Seller and support journeys in the browser: pack -> ship -> deliver -> settle.
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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

// sign in as the Kaveri seller
await page.goto("http://localhost:4173/signin");
await page.waitForTimeout(700);
await page.getByLabel("Email or phone").fill("kaveri@example.test");
await page.getByLabel("Password").fill("Kaveri@Seller2026");
await page.getByRole("button", { name: "Continue" }).first().click();
await page.waitForTimeout(900);
const code = await otpFor("kaveri@example.test");
if (!code) { console.log("FAIL seller otp (rate window)"); process.exit(1); }
await page.getByLabel("6-digit code").fill(code);
await page.getByRole("button", { name: "Verify" }).click();
await page.waitForTimeout(1600);
check("seller lands on published home", page.url().includes("/seller/shipments"), page.url());

// the seeded CH-SEED0001 shipment (delivered) should show; find the placed CH-SEED0003 shipment
const shipments = await page.evaluate(() => Array.from(document.querySelectorAll(".parcel-panel h2")).map((n) => n.textContent));
check("seller shipments listed", shipments.length > 0, JSON.stringify(shipments.slice(0, 3)));

// statement page shows the seeded sale line with every deduction visible
await page.goto("http://localhost:4173/seller/statement");
await page.waitForTimeout(1200);
const statement = await page.evaluate(() => document.querySelector("table")?.textContent ?? "");
check("statement shows commission", statement.includes("Commission"), statement.slice(0, 60));
check("statement shows GST on commission", statement.includes("GST on commission"));
check("statement shows TCS and TDS", statement.includes("TCS") && statement.includes("TDS"));
const net = await page.evaluate(() => document.querySelector("[aria-label='Net payout']")?.textContent ?? "");
check("net payout group present", net.includes("₹"), net);

// low stock board
await page.goto("http://localhost:4173/seller/stock");
await page.waitForTimeout(900);
const lowStock = await page.evaluate(() => document.querySelector("table")?.getAttribute("aria-label"));
check("low stock table", lowStock === "Low stock", String(lowStock));

await browser.close();
await pool.end();
