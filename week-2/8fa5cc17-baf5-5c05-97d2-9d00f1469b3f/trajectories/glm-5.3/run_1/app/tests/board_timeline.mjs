// Development test: the timeline, the board and the collections. Not shipped.
import { chromium } from "playwright-core";

const failures = [];
function check(name, got, want) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures.push(name);
    console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
await page.goto("http://localhost:4173/today");
await page.fill('[aria-label="Email"]', "tamsin@oakgall.test");
await page.fill('[aria-label="Password"]', "commonplace-1847");
await page.click('button:has-text("Sign in")');
await page.waitForTimeout(1800);

// write two notes on two days so the timeline has content
await page.click(".add-block");
await page.waitForTimeout(600);
await page.keyboard.type("A thought for the timeline.");
await page.waitForTimeout(1000);

// the timeline
await page.goto("http://localhost:4173/timeline");
await page.waitForTimeout(1200);
check("timeline region", await page.locator('[aria-label="Daily timeline"]').count(), 1);
const dayCount = await page.locator(".timeline-day").count();
check("timeline has day columns", dayCount >= 1, true);
const heatBands = await page.locator("[data-heat]").count();
check("heat bands present", heatBands >= 1, true);
const heatAttrs = await page.evaluate(() => Array.from(document.querySelectorAll("[data-heat]")).map((el) => el.getAttribute("data-heat")));
const captions = await page.evaluate(() => Array.from(document.querySelectorAll(".heat-caption")).map((el) => el.textContent));
check("heat band equals its caption", heatAttrs.every((v, i) => captions[i].startsWith(`${v} `)), true);
const heatValues = heatAttrs.map(Number);
const firstWithBlocks = heatValues.findIndex((v) => v > 0);
check("a day has blocks", firstWithBlocks !== -1, true);
check("movable handle naming", (await page.locator('.day-block-handle[aria-label^="Move "]').count()) > 0, true);
if (dayCount > 1) check("no-note column", (await page.locator(".no-note").count()) > 0, true);
else check("single-day timeline has no empty columns", (await page.locator(".no-note").count()), 0);

// the collection page and the board
await page.goto("http://localhost:4173/collections");
await page.waitForTimeout(500);
await page.goto("http://localhost:4173/timeline");
await page.waitForTimeout(300);
const collections = await page.evaluate(async () => (await (await fetch("/api/collections")).json()).collections);
const cid = collections[0].id;
await page.goto(`http://localhost:4173/collections/${cid}`);
await page.waitForTimeout(900);
check("collection heading", (await page.textContent("h1")).includes("Advisor reading"), true);
check("never-share marked", (await page.textContent("main")).includes("Never shared"), true);
check("board button", await page.locator('button:has-text("Board")').count(), 1);
check("share button", await page.locator('button:has-text("Share collection")').count(), 1);

await page.click('button:has-text("Board")');
await page.waitForTimeout(1000);
check("board viewport", await page.locator("[data-board-viewport]").count(), 1);
check("board cards", await page.locator("[data-board-card]").count(), 3);
const transform = await page.getAttribute("[data-board-viewport]", "data-board-transform");
check("board transform format", /^\d\.\d{4},-?\d+\.\d{4},-?\d+\.\d{4}$/.test(transform) || /^\d\.\d{4},0\.0000,0\.0000$/.test(transform), true);
const arrows = await page.locator("[data-board-arrow]").count();
check("board arrows drawn", arrows > 0, true);
const cardLabels = await page.evaluate(() => Array.from(document.querySelectorAll("[data-board-card]")).map((b) => b.getAttribute("aria-label")));
check("card label format", cardLabels.every((l) => /, x -?\d+, y -?\d+$/.test(l)), true);

// keyboard nudge: focus a card, nudge right, the announcement follows
const card = page.locator("[data-board-card]").first();
await card.focus();
const beforeX = Number((await card.getAttribute("aria-label")).match(/x (-?\d+)/)[1]);
await page.keyboard.press("Shift+ArrowRight");
await page.waitForTimeout(1200);
const afterLabel = await page.locator("[data-board-card]").first().getAttribute("aria-label");
const afterX = Number(afterLabel.match(/x (-?\d+)/)[1]);
check("nudge moves 40 units", afterX - beforeX, 40);
const announced = await page.textContent("#announcements");
check("move announced", announced.includes("Moved"), true);

// the transform reacts to the wheel
const transformBefore = await page.getAttribute("[data-board-viewport]", "data-board-transform");
await page.mouse.move(640, 400);
await page.mouse.wheel(0, -240);
await page.waitForTimeout(400);
const transformAfter = await page.getAttribute("[data-board-viewport]", "data-board-transform");
check("wheel zooms the transform", transformBefore !== transformAfter, true);

await browser.close();
console.log(failures.length === 0 ? "\nALL OK" : `\n${failures.length} FAILURES`);
process.exit(failures.length === 0 ? 0 : 1);
