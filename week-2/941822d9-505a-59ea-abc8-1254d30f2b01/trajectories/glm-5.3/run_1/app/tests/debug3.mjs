import { chromium } from "playwright";
const BASE = "http://localhost:4173";
const browser = await chromium.launch();
const page = await (await browser.newContext({viewport:{width:1280,height:800}})).newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("load", (p) => console.log("LOAD EVENT (full reload):", p.url()));
await page.goto(BASE + "/signin");
await page.getByLabel("Email").fill("eli.brandt@lindenvalley.test");
await page.getByLabel("Password").fill("credwell-demo-1");
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByRole("heading", { name: "Courses" }).waitFor();
console.log("courses loaded");
// click the wordmark (SPA link)
await page.evaluate(() => { window.__marker = 42; });
const next = page.getByRole("link", { name: "Delirium Screening at the Bedside" });
await next.click();
await page.getByRole("heading", { name: "Delirium Screening at the Bedside" }).waitFor();
const marker = await page.evaluate(() => window.__marker ?? "gone");
console.log("marker after SPA click:", marker);
const url1 = page.url();
// Now click the wordmark
await page.getByRole("link", { name: "Credwell" }).click();
await page.getByRole("heading", { name: "Courses" }).waitFor();
console.log("wordmark click ok, url:", page.url());
await browser.close();
