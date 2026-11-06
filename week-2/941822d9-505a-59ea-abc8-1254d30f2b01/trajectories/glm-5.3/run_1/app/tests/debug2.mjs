import { chromium } from "playwright";
const BASE = "http://localhost:4173";
const browser = await chromium.launch();
const page = await (await browser.newContext({viewport:{width:1280,height:800}})).newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE-ERR:", m.text().slice(0,200)); });
await page.goto(BASE + "/signin");
await page.getByLabel("Email").fill("ben.osei@harbourview.test");
await page.getByLabel("Password").fill("credwell-demo-1");
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByRole("heading", { name: "Courses" }).waitFor();
await page.getByRole("link", { name: "Sepsis Recognition in the First Hour" }).click();
await page.getByRole("heading", { name: "Sepsis Recognition in the First Hour" }).waitFor();
console.log("on course page, URL:", page.url());
await page.getByRole("link", { name: "Continue learning" }).click();
await page.getByRole("navigation", { name: "Course modules" }).waitFor();
console.log("module player URL:", page.url());
console.log("check buttons:", await page.getByRole("button", { name: "Check answer" }).count());
console.log("next links:", await page.getByRole("link", { name: /Next module|Go to post-evaluation/ }).count());
const btn = page.getByRole("button", { name: "Check answer" });
if (await btn.count() > 0 && await btn.first().isEnabled()) {
  await page.getByRole("radiogroup").first().getByRole("radio").nth(0).check();
  await btn.first().click();
  await page.waitForTimeout(1500);
  console.log("after click: check buttons:", await page.getByRole("button", { name: "Check answer" }).count(),
              "next links:", await page.getByRole("link", { name: /Next module|Go to post-evaluation/ }).count());
  console.log("status region:", await page.getByRole("status", { name: "Activity status" }).textContent().catch(()=>"none"));
  console.log("alert:", await page.locator(".alert-region").textContent().catch(()=>"none"));
}
await browser.close();
