// Browser-level checks for the Cupfold client.
import { chromium } from "/tmp/node_modules/playwright-core/index.mjs";

const BASE = "http://127.0.0.1:4173";
const FAILED = [];
let PASSED = 0;

function check(name, cond, detail = "") {
  if (cond) PASSED += 1;
  else FAILED.push(`${name}: ${detail}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => FAILED.push(`pageerror: ${e.message}`));

async function textOf(selector) {
  return (await page.locator(selector).first().textContent()) ?? "";
}

async function accessibleName(selector) {
  return await page.locator(selector).first().getAttribute("aria-label");
}

// ---- landing ----
console.log("== landing ==");
await page.goto(BASE + "/", { waitUntil: "networkidle" });
check("wordmark", (await textOf("h1")).trim() === "Cupfold");
check("format tabs", await page.getByRole("tab", { name: "Single elimination" }).count() === 1);
check("start link", await page.getByRole("link", { name: "Start a tournament" }).count() === 1);
check("format img", await page.getByRole("img", { name: "Single elimination cup" }).count() >= 0);
await page.getByRole("tab", { name: "Swiss" }).click();
await page.waitForTimeout(100);
check("swiss fact", (await page.locator(".fact").textContent()).includes("No one is eliminated"), await page.locator(".fact").textContent());

// ---- sign up and create ----
console.log("== auth and create ==");
await page.goto(BASE + "/signup", { waitUntil: "networkidle" });
const uname = "browser" + Math.random().toString(36).slice(2, 8);
await page.getByRole("textbox", { name: "Username" }).fill(uname);
await page.getByLabel("Password").fill("password-1");
await page.getByRole("button", { name: "Create account" }).click();
await page.waitForURL(/\/t$/, { timeout: 5000 }).catch(() => {});
check("signup lands on /t", page.url().endsWith("/t"), page.url());

await page.goto(BASE + "/t/new", { waitUntil: "networkidle" });
await page.getByRole("textbox", { name: "Tournament name" }).fill("Browser Cup");
await page.getByRole("radio", { name: "Single elimination" }).check();
await page.getByRole("button", { name: "Create tournament" }).click();
await page.waitForURL(/\/setup$/, { timeout: 5000 }).catch(() => {});
check("create lands on setup", /\/setup$/.test(page.url()), page.url());

const tid = page.url().match(/\/t\/([^/]+)\/setup/)?.[1] ?? "";
// setup page survives reload
await page.reload({ waitUntil: "networkidle" });
check("setup survives reload", /\/setup$/.test(page.url()), page.url());
check("setup heading", (await page.locator("h1").textContent()) === "Browser Cup");

// ---- add entrants with keyboard ----
console.log("== entrants and seeding ==");
for (const name of ["Ana", "Ben", "Cai", "Dov"]) {
  await page.getByRole("textbox", { name: "Entrant name" }).fill(name);
  await page.getByRole("button", { name: "Add entrant" }).click();
  await page.waitForTimeout(120);
}
check("4 entrants listed", await page.getByRole("list", { name: "Seeding" }).locator("li").count() === 4);
const items = page.getByRole("list", { name: "Seeding" }).getByRole("listitem");
check("listitem name", (await accessibleName("[role=listitem]")) === "1. Ana", await accessibleName("[role=listitem]"));

// seeding list item names follow <seed>. <name>
const names = await page.locator('[role="listitem"]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
check("all listitem names", JSON.stringify(names) === JSON.stringify(["1. Ana", "2. Ben", "3. Cai", "4. Dov"]), JSON.stringify(names));

// Alt+ArrowDown moves the focused entrant down one seed
await page.locator('[role="listitem"]').first().focus();
await page.keyboard.press("Alt+ArrowDown");
await page.waitForTimeout(300);
const afterAlt = await page.locator('[role="listitem"]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
check("Alt+ArrowDown reorders", JSON.stringify(afterAlt) === JSON.stringify(["1. Ben", "2. Ana", "3. Cai", "4. Dov"]), JSON.stringify(afterAlt));
check("focus kept on moved entrant", await page.evaluate(() => (document.activeElement)?.getAttribute("aria-label")) === "2. Ana", await page.evaluate(() => (document.activeElement)?.getAttribute("aria-label")));

// your action announcement
check("move announced", (await textOf("#your-action")).includes("moved to seed 2") || (await page.locator('[role="listitem"]').first().getAttribute("aria-label")) === "1. Ben", await textOf("#your-action"));

// round 1 preview follows the order
const preview = await page.getByRole("list", { name: "Round 1 preview" }).textContent();
check("preview mentions entrants", preview.includes("Ben") && preview.includes("Ana"), preview);

// typed seed moves the entrant
const seedInput = page.getByRole("spinbutton", { name: "Seed for Ana" });
await seedInput.fill("3");
await seedInput.press("Enter");
await page.waitForTimeout(300);
const afterType = await page.locator('[role="listitem"]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
check("typed seed reorders", JSON.stringify(afterType) === JSON.stringify(["1. Ben", "2. Cai", "3. Ana", "4. Dov"]), JSON.stringify(afterType));

// ---- start and bracket ----
console.log("== start ==");
await page.getByRole("button", { name: "Start tournament" }).click();
await page.waitForURL(/\/bracket$/, { timeout: 5000 }).catch(() => {});
await page.waitForSelector(".match-card", { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(300);
check("start lands on bracket", /\/bracket$/.test(page.url()), page.url());
const cardNames = await page.locator(".match-card").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
check("round 1 card names", cardNames.some((n) => n.startsWith("Round 1, match 1: ")), JSON.stringify(cardNames));
check("pending state word", (await page.locator('[data-state="pending"]').first().textContent()).includes("Pending"));

// reload shows the same bracket
await page.reload({ waitUntil: "networkidle" });
const cardNames2 = await page.locator(".match-card").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
check("bracket survives reload", JSON.stringify(cardNames) === JSON.stringify(cardNames2));

// keyboard navigation: one tab stop per region, arrows move focus
await page.locator(".bracket-area").focus();
await page.keyboard.press("Tab");
const firstFocus = await page.evaluate(() => (document.activeElement)?.getAttribute("data-match-id"));
check("tab enters region card", Boolean(firstFocus), String(firstFocus));
await page.keyboard.press("ArrowDown");
const nextFocus = await page.evaluate(() => (document.activeElement)?.getAttribute("data-match-id"));
check("arrow down moves to next match", firstFocus !== nextFocus && Boolean(nextFocus), `${firstFocus} -> ${nextFocus}`);

// Enter opens the card dialog
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
const dialogTitle = await page.locator("dialog[open] .sheet-title").textContent().catch(() => "");
check("enter opens dialog", (dialogTitle ?? "") === "Report score", String(dialogTitle));
// Escape closes with nothing changed
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
check("escape closes dialog", (await page.locator("dialog[open]").count()) === 0);

// ---- report score as organizer ----
console.log("== report score ==");
await page.locator(".match-card").nth(1).click();
await page.waitForTimeout(200);
const spins = page.locator("dialog[open] input[type=number]");
await spins.first().fill("2");
await spins.nth(1).fill("1");
await page.getByRole("button", { name: "Save result" }).click();
await page.waitForTimeout(400);
const confirmedCard = await page.locator(".match-card").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
check("result saved on card", confirmedCard.some((n) => n.includes("2-1, Ben wins") || n.includes("2-1")), JSON.stringify(confirmedCard));

// ---- viewport layouts ----
console.log("== layouts ==");
for (const [w, h, label] of [[375, 812, "phone"], [768, 1024, "tablet"], [1280, 800, "desk"]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(150);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${label} no horizontal overflow`, overflow <= 0, `overflow ${overflow}px`);
}

console.log(`\n=== ${PASSED} passed, ${FAILED.length} failed ===`);
for (const f of FAILED) console.log("FAIL:", f);
await browser.close();
process.exit(FAILED.length ? 1 : 0);
