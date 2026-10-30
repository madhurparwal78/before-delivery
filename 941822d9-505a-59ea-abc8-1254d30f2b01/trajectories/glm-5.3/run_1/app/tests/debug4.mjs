import { chromium } from "playwright";
const BASE = "http://localhost:4173";
const browser = await chromium.launch();
const page = await (await browser.newContext({viewport:{width:1280,height:800}})).newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("load", (p) => console.log("LOAD EVENT:", p.url()));
await page.goto(BASE + "/signin");
await page.getByLabel("Email").fill("ben.osei@harbourview.test");
await page.getByLabel("Password").fill("credwell-demo-1");
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByRole("heading", { name: "Courses" }).waitFor();
await page.getByRole("link", { name: "Sepsis Recognition in the First Hour" }).click();
await page.getByRole("heading", { name: "Sepsis Recognition in the First Hour" }).waitFor();
await page.evaluate(() => { window.__marker = 42; });
await page.getByRole("link", { name: "Continue learning" }).click();
await page.getByRole("navigation", { name: "Course modules" }).waitFor();
console.log("player URL:", page.url());
console.log("marker:", await page.evaluate(() => window.__marker ?? "gone"));
const next = page.getByRole("link", { name: /Next module|Go to post-evaluation/ }).first();
console.log("next count:", await page.getByRole("link", { name: /Next module|Go to post-evaluation/ }).count());
try {
  await next.click({ timeout: 8000 });
  console.log("click ok");
} catch (e) {
  console.log("click failed:", e.message.split("\n")[0]);
}
await page.waitForTimeout(1000);
console.log("URL after:", page.url());
console.log("marker after:", await page.evaluate(() => window.__marker ?? "gone"));
await browser.close();
