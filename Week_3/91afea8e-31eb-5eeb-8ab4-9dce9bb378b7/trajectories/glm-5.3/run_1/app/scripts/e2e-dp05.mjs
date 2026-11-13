// DP-05: changing a password ends every other session, the current one stays signed in.
import { chromium } from "playwright";
import { Pool } from "pg";
import { createHash } from "node:crypto";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function otpFor(identifier) {
  const res = await pool.query("SELECT code_hash FROM pending_signins WHERE identifier = $1 ORDER BY issued_at DESC LIMIT 1", [identifier]);
  const hash = res.rows[0]?.code_hash;
  for (let i = 0; i < 1000000; i++) {
    const c = String(i).padStart(6, "0");
    if (createHash("sha256").update(c).digest("hex") === hash) return c;
  }
  return null;
}

function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const phone = `+9198${String(Date.now()).slice(-8)}`;
const browser = await chromium.launch();

// session 1
const c1 = await browser.newContext();
const p1 = await c1.newPage();
await p1.goto("http://localhost:4173/signup");
await p1.waitForTimeout(700);
await p1.getByLabel("Name").fill("Two Sessions");
await p1.getByLabel("Email").fill(`tw${Date.now()}@example.test`);
await p1.getByLabel("Phone").fill(phone);
await p1.getByLabel("Password").fill("First@Bazaar2026");
await p1.getByRole("button", { name: "Continue" }).first().click();
await p1.waitForTimeout(900);
const code1 = await otpFor(phone);
await p1.getByLabel("6-digit code").fill(code1);
await p1.getByRole("button", { name: "Verify" }).click();
await p1.waitForTimeout(1500);
const me1 = await p1.evaluate(() => fetch("/api/me").then((r) => r.status));
check("session 1 signed in", me1 === 200, String(me1));

// session 2 in a second context
const c2 = await browser.newContext();
const p2 = await c2.newPage();
await p2.goto("http://localhost:4173/signin");
await p2.waitForTimeout(700);
await p2.getByLabel("Email or phone").fill(phone);
await p2.getByLabel("Password").fill("First@Bazaar2026");
await p2.getByRole("button", { name: "Continue" }).first().click();
await p2.waitForTimeout(900);
const code2 = await otpFor(phone);
await p2.getByLabel("6-digit code").fill(code2);
await p2.getByRole("button", { name: "Verify" }).click();
await p2.waitForTimeout(1500);
const me2 = await p2.evaluate(() => fetch("/api/me").then((r) => r.status));
check("session 2 signed in", me2 === 200, String(me2));

// change the password from session 1 through the account page
await p1.goto("http://localhost:4173/account");
await p1.waitForTimeout(900);
await p1.getByLabel("Current password").fill("First@Bazaar2026");
await p1.getByLabel("New password").fill("Second@Bazaar2026");
await p1.getByRole("button", { name: "Change password" }).click();
await p1.waitForTimeout(1200);
const statusText = await p1.evaluate(() => document.querySelector("[aria-label='Sign-in status']")?.textContent ?? "");
check("password changed copy", statusText === "Password changed. Other devices are signed out.", statusText);

const me1b = await p1.evaluate(() => fetch("/api/me").then((r) => r.status));
check("current session stays signed in", me1b === 200, String(me1b));
const me2b = await p2.evaluate(() => fetch("/api/me").then((r) => r.status));
check("other session answers 401", me2b === 401, String(me2b));

await browser.close();
await pool.end();
