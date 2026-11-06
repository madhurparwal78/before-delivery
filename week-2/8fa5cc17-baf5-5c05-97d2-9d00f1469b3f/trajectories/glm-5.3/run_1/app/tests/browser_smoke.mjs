// Development browser smoke test for the workspace client. Not shipped.
import { chromium } from "playwright-core";

const failures = [];
function check(name, got, want) {
  if (got !== want) {
    failures.push(name);
    console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE ERROR:", m.text());
});

// a signed-out visit redirects to sign-in with the return address
await page.goto("http://localhost:4173/o/notaobject");
await page.waitForTimeout(800);
check("redirected to sign-in", page.url().startsWith("http://localhost:4173/sign-in?return="), true);
check("return address kept", decodeURIComponent(page.url()).includes("/o/notaobject"), true);
await checkText(page, "h1", "Sign in to Quire");

// sign in
await page.fill('[aria-label="Email"]', "tamsin@oakgall.test");
await page.fill('[aria-label="Password"]', "commonplace-1847");
await page.click('button:has-text("Sign in")');
await page.waitForTimeout(1500);
check("landed on the requested page", page.url(), "http://localhost:4173/o/notaobject");
await checkText(page, "h1", "We can't find that note.");

// the library rail
await checkText(page, 'nav[aria-label="Library"] button', "Today");
const railText = await page.textContent('nav[aria-label="Library"]');
check("rail lists types", railText.includes("Source") && railText.includes("Person") && railText.includes("Concept") && railText.includes("Daily note"), true);
check("rail lists collection", railText.includes("Advisor reading — autumn"), true);

// go to Today
await page.click('nav[aria-label="Library"] button:has-text("Today")');
await page.waitForTimeout(1000);
const heading = await page.textContent("main h1");
check("today heading format", /\w+ \d{1,2} \w+ \d{4}/.test(heading.trim()), true);
check("empty prompt", (await page.textContent("#blocks")).includes("Nothing written today"), true);

// type a line
await page.click(".add-block");
await page.waitForTimeout(600);
const box = page.locator("textarea.block-input");
check("block textbox appears", await box.count(), 1);
await page.keyboard.type("A first line for today.");
await page.waitForTimeout(900);
check("save status", (await page.textContent("#save-status")).trim(), "Saved");
const typed = await page.evaluate(() => {
  const box = document.querySelector("textarea.block-input");
  const render = document.querySelector(".block-render");
  return (box?.value ?? render?.textContent ?? "").trim();
});
check("block text kept", typed.includes("A first line for today."), true);

// the command palette
await page.keyboard.press("Control+k");
await page.waitForTimeout(300);
check("palette opens", await page.locator('[aria-label="Command palette"]').count(), 1);
await page.fill('[aria-label="Search Quire"]', "gtt");
await page.waitForTimeout(400);
const options = await page.locator('[role="option"]').allTextContents();
check("palette fuzzy command", options.length > 0 && options[0].includes("Go to Today"), true);
const status = await page.textContent('[aria-label="Palette status"]');
check("palette status counts", /1 command, 0 notes/.test(status), true);
await page.keyboard.press("Enter");
await page.waitForTimeout(800);
check("palette opened today", (await page.textContent("main h1")).length > 0, true);

// quote a block: type (( to open the picker
await page.click(".add-block");
await page.waitForTimeout(500);
await page.keyboard.type("Quote this: ");
await page.keyboard.type("(");
await page.keyboard.type("(");
await page.waitForTimeout(600);
check("picker opens", await page.locator('[aria-label="Quote a block"]').count(), 1);
await page.fill('[aria-label="Search blocks"]', "margin");
await page.waitForTimeout(600);
const pickerStatus = await page.textContent('[aria-label="Picker results"]');
check("picker status", /matching blocks?/.test(pickerStatus), true);
const firstOption = await page.textContent('[role="option"]');
check("picker option shape", firstOption.includes("The Gathered Margin") || firstOption.includes("Chapter three argument"), true);
await page.keyboard.press("Enter");
await page.waitForTimeout(1200);
check("quote figure appears", await page.locator("figure.quote-block").count(), 1);
const chipLabel = await page.getAttribute("figure.quote-block .origin-chip-link", "aria-label");
check("origin chip label", chipLabel.startsWith("Quoted from"), true);
const announcements = await page.textContent("#announcements");
check("quote announced", announcements.includes("Quoted from"), true);

// backlink count on the origin via the API
const backlinks = await page.evaluate(async () => {
  const res = await fetch("/api/objects");
  const body = await res.json();
  const origin = body.objects.find((o) => o.title === "The Gathered Margin");
  return origin ? origin.backlinks : -1;
});
check("backlink count grew", backlinks, 2);

// undo the quote through the server
await page.keyboard.press("Control+z");
await page.waitForTimeout(1000);
const undoAnnounced = await page.textContent("#announcements");
check("undo announced", undoAnnounced.includes("Undid quote"), true);
check("quote removed", await page.locator("figure.quote-block").count(), 0);
const backlinksAfter = await page.evaluate(async () => {
  const res = await fetch("/api/objects");
  const body = await res.json();
  const origin = body.objects.find((o) => o.title === "The Gathered Margin");
  return origin ? origin.backlinks : -1;
});
check("backlink count restored", backlinksAfter, 1);

// graph page renders with WebGL
await page.goto("http://localhost:4173/graph");
await page.waitForTimeout(2500);
check("graph canvas", await page.locator("canvas.graph-canvas").count(), 1);
check("graph node labels", await page.locator(".graph-node-label").count() > 0, true);

// settings
await page.goto("http://localhost:4173/settings");
await page.waitForTimeout(800);
check("home clock combobox", await page.locator('select[aria-label="Home clock"]').count(), 1);
const headings = await page.locator("h2").allTextContents();
check("sessions heading", headings.some((x) => x.includes("Device sessions")), true);

await browser.close();
console.log(failures.length === 0 ? "\nALL OK" : `\n${failures.length} FAILURES`);
process.exit(failures.length === 0 ? 0 : 1);

async function checkText(page, sel, want) {
  const got = await page.textContent(sel);
  check(`text of ${sel}`, (got ?? "").trim(), want);
}

async function checkTextContains(page, sel, want) {
  const got = await page.textContent(sel);
  check(`${sel} contains`, (got ?? "").includes(want), true);
}
