import { chromium } from "playwright";
const BASE = "http://localhost:4173";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await page.goto(BASE + "/signin");
await page.getByLabel("Email").fill("ana.ruiz@harbourview.test");
await page.getByLabel("Password").fill("credwell-demo-1");
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByRole("heading", { name: "Courses" }).waitFor();
await page.goto(BASE + "/courses");
await page.getByRole("link", { name: "Delirium Screening at the Bedside" }).click();
await page.getByRole("heading", { name: "Delirium Screening at the Bedside" }).waitFor();
await page.getByRole("button", { name: "Enrol" }).click();
const dialog = page.getByRole("dialog", { name: "Checkout" });
await dialog.getByRole("button", { name: /^Pay \$/ }).waitFor();
console.log("initial pay label:", await dialog.getByRole("button", { name: /^Pay \$/ }).textContent());

// Grace changes coverage while the dialog is open (external script does this).
const { execSync } = await import("node:child_process");
execSync(`curl -s -X POST http://localhost:4173/api/session -H "Content-Type: application/json" -d '{"email":"coord@harbourview.test","password":"credwell-demo-1"}' -c /tmp/grace-quote.jar > /dev/null`);
execSync(`curl -s -X PATCH http://localhost:4173/api/sponsor/coverage -b /tmp/grace-quote.jar -H "Content-Type: application/json" -d '{"coverage_percent":"60.00","effective_on":"${new Date().toISOString().slice(0, 10)}"}'`);
console.log("coverage changed to 60%");

await dialog.getByRole("button", { name: /^Pay \$/ }).click();
const alert = page.getByRole("alert");
await alert.waitFor();
console.log("alert copy:", await alert.textContent());
await page.waitForTimeout(400);
console.log("pay label now:", await dialog.getByRole("button", { name: /^Pay \$/ }).textContent());
console.log("your share row:", await dialog.getByRole("document") ? "" : "");
const moneyRows = await dialog.locator(".money-row").allTextContents();
console.log("money rows:", JSON.stringify(moneyRows));
// Pay the new share
await dialog.getByRole("button", { name: /^Pay \$/ }).click();
await page.getByRole("status", { name: "Activity status" }).waitFor();
await page.waitForTimeout(1000);
const statusText = await page.getByRole("status", { name: "Activity status" }).textContent();
console.log("status:", statusText);
const dialogGone = (await page.getByRole("dialog", { name: "Checkout" }).count()) === 0;
console.log("dialog closed:", dialogGone);
await page.getByRole("link", { name: "Continue learning" }).waitFor({ timeout: 10000 });
console.log("PASS continue learning shown");
await browser.close();
