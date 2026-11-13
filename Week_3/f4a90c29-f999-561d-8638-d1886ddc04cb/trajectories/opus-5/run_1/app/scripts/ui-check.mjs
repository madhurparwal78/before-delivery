// Browser checks of the published screens, roles and names.
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";

const BASE = "http://127.0.0.1:4173";
const failures = [];

function check(name, got, want) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (!same) {
    failures.push(name);
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const browser = await chromium.launch();

async function openPage(width = 1280, height = 800) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    failures.push(`page error: ${error.message}`);
    console.log(`FAIL page error: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") console.log(`console: ${message.text()}`);
  });
  return { context, page };
}

async function signIn(page, email) {
  await page.goto(`${BASE}/signin`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Passcode").fill("wren-seed-2027");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/calendar/);
  await page.evaluate(() => fetch("/api/draft", { method: "DELETE" }));
  await page.reload();
  await page.waitForSelector('[role="region"][aria-label="Week grid"]');
}

// Landing page.
{
  const { context, page } = await openPage();
  await page.goto(BASE);
  check("status region present", await page.getByRole("status", { name: "Wren status" }).count(), 1);
  check(
    "headline",
    (await page.getByRole("heading", { level: 1 }).innerText()).replace(/\n/g, " "),
    "Every clock in the firm, agreeing to the second.",
  );
  check("sign in link", await page.getByRole("link", { name: "Sign in" }).count(), 1);
  check("three clocks link", await page.getByRole("link", { name: "See the three clocks" }).count(), 1);
  const panel = page.getByRole("region", { name: "Three clocks example" });
  check("example panel", await panel.count(), 1);
  const text = await panel.innerText();
  for (const want of ["Partners' weekly", "Tue 6 Oct 2026", "09:00 New York", "14:00 London", "02:00 Auckland",
    "Client readout", "11:30 New York", "16:30 London", "04:30 Auckland"]) {
    check(`example holds ${want}`, text.includes(want), true);
  }
  check("no sideways scroll", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await context.close();
}

// Sign in and the calendar at 1280x800.
{
  const { context, page } = await openPage();
  await signIn(page, "ines@sundialwren.example");
  check("skip link first", await page.getByRole("link", { name: "Skip to calendar" }).count(), 1);
  check("main navigation", await page.getByRole("navigation", { name: "Main" }).count(), 1);
  for (const name of ["Today", "Previous", "Next", "New event", "Notices"]) {
    check(`toolbar ${name}`, await page.getByRole("button", { name, exact: true }).count(), 1);
  }
  check("view radiogroup", await page.getByRole("radiogroup", { name: "View" }).count(), 1);
  for (const name of ["Day", "Week", "Month", "Custom days", "Schedule"]) {
    check(`view radio ${name}`, await page.getByRole("radio", { name, exact: true }).count(), 1);
  }
  check("mini month", await page.getByRole("region", { name: "Mini month" }).count(), 1);
  check("calendars group", await page.getByRole("group", { name: "Calendars" }).count(), 1);
  check("all-day band", await page.getByRole("group", { name: "All-day events" }).count(), 1);
  check("slots", (await page.getByRole("gridcell").count()) > 90, true);
  check("no sideways scroll", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

  // Week of 15 March 2027: Partners' weekly reads 13:00 for a London viewer.
  await page.goto(`${BASE}/calendar?view=week&date=2027-03-15&calendars=cal-dara`);
  await page.waitForSelector('[role="region"][aria-label="Week grid"]');
  check(
    "partners weekly block in London",
    await page.getByRole("button", { name: "Partners' weekly, 13:00 to 14:00" }).count(),
    1,
  );
  // The week before shows 14:00.
  await page.goto(`${BASE}/calendar?view=week&date=2027-03-08&calendars=cal-dara`);
  await page.waitForSelector('[role="region"][aria-label="Week grid"]');
  check(
    "partners weekly the week before",
    await page.getByRole("button", { name: "Partners' weekly, 14:00 to 15:00" }).count(),
    1,
  );

  // The quick dialog carries Three clocks and the published buttons.
  await page.getByRole("button", { name: "Partners' weekly, 14:00 to 15:00" }).first().click();
  const quick = page.getByRole("dialog", { name: "Partners' weekly" });
  await quick.waitFor();
  check("quick three clocks", await quick.getByRole("group", { name: "Three clocks" }).count(), 1);
  for (const city of ["New York", "London", "Auckland"]) {
    const found = await quick.getByRole("group", { name: new RegExp(`^${city} \\d\\d:\\d\\d, (inside|outside) working hours$`) }).count();
    check(`quick clock ${city}`, found, 1);
  }
  check("open event button", await quick.getByRole("button", { name: "Open event" }).count(), 1);
  check("edit button", await quick.getByRole("button", { name: "Edit" }).count(), 1);
  check("duplicate button", await quick.getByRole("button", { name: "Duplicate" }).count(), 1);
  check("address holds the event", page.url().includes("event=evt-partners-weekly%40"), true);
  await page.keyboard.press("Escape");
  await quick.waitFor({ state: "detached" });

  // The New event dialog and its published fields.
  await page.getByRole("button", { name: "New event" }).click();
  const create = page.getByRole("dialog", { name: "New event" });
  await create.waitFor();
  for (const label of ["Title", "Calendar", "Kind", "Colour", "All day", "Starts", "Ends", "Zone", "Location", "Notes", "Private", "Reminder minutes"]) {
    check(`new event field ${label}`, await create.getByLabel(label, { exact: true }).count(), 1);
  }
  check("repeat radiogroup", await create.getByRole("radiogroup", { name: "Repeat" }).count(), 1);
  check("focus in title", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Title");
  await create.getByLabel("Title", { exact: true }).fill("Half a title");
  await page.waitForTimeout(700);
  await page.reload();
  const again = page.getByRole("dialog", { name: "New event" });
  await again.waitFor();
  check("draft came back from the server", await again.getByLabel("Title", { exact: true }).inputValue(), "Half a title");
  check("draft focus in title", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Title");
  await again.getByRole("button", { name: "Cancel" }).click();

  // Month view gives a +N more control that follows the window height.
  await page.goto(`${BASE}/calendar?view=month&date=2027-03-01`);
  await page.waitForSelector('[role="region"][aria-label="Month grid"]');
  check("month grid", await page.getByRole("region", { name: "Month grid" }).count(), 1);

  // The shortcut list is one key away.
  await page.goto(`${BASE}/calendar?view=week&date=2027-03-08`);
  await page.waitForSelector('[role="region"][aria-label="Week grid"]');
  await page.keyboard.press("?");
  const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await shortcuts.waitFor();
  check("shortcut list", await shortcuts.getByRole("list", { name: "Shortcuts" }).count(), 1);
  await page.keyboard.press("Escape");
  await shortcuts.waitFor({ state: "detached" });

  // Number keys switch views.
  await page.keyboard.press("3");
  await page.waitForSelector('[role="region"][aria-label="Month grid"]');
  check("key 3 shows the month", page.url().includes("view=month"), true);
  await page.keyboard.press("2");
  await page.waitForSelector('[role="region"][aria-label="Week grid"]');
  check("key 2 shows the week", page.url().includes("view=week"), true);

  await context.close();
}

// The event page.
{
  const { context, page } = await openPage();
  await signIn(page, "dara@sundialwren.example");
  await page.goto(`${BASE}/events/evt-partners-weekly?occurrence=evt-partners-weekly@20270309T0900`);
  await page.waitForSelector("h1");
  check("event heading", await page.getByRole("heading", { level: 1 }).innerText(), "Partners' weekly");
  const answers = page.getByRole("region", { name: "Answers" });
  check("answers region", await answers.count(), 1);
  check("answer counts", (await answers.innerText()).trim(), "1 yes, 0 no, 1 maybe, 1 waiting");
  const guests = page.getByRole("list", { name: "Guests" });
  check("guest rows", await guests.locator("li > span").allInnerTexts(),
    ["Ines Okafor: Yes", "Marit Holloway: Waiting", "Tane Whitcombe: Maybe"]);
  check("guest switches", await page.getByRole("group", { name: "Guest switches" }).count(), 1);
  check("three clocks on the page", await page.getByRole("group", { name: "Three clocks" }).count(), 1);
  await context.close();
}

// Phone width shows the schedule and leaves the address alone.
{
  const { context, page } = await openPage(375, 812);
  await page.goto(`${BASE}/signin`);
  await page.getByLabel("Email").fill("ines@sundialwren.example");
  await page.getByLabel("Passcode").fill("wren-seed-2027");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/calendar/);
  await page.goto(`${BASE}/calendar?view=week&date=2027-03-08`);
  await page.waitForSelector('[role="list"][aria-label="Schedule"]');
  check("phone shows the schedule", await page.getByRole("list", { name: "Schedule" }).count(), 1);
  check("phone keeps the address", page.url().includes("view=week"), true);
  check("phone calendars button", await page.getByRole("button", { name: "Calendars" }).count(), 1);
  check("phone has no sideways scroll", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const small = await page.evaluate(() => {
    const targets = Array.from(document.querySelectorAll("button, a, input, select"));
    return targets
      .filter((node) => node.getClientRects().length > 0)
      .filter((node) => node.getBoundingClientRect().left > -500)
      .filter((node) => {
        const box = node.getBoundingClientRect();
        return box.height < 44 || box.width < 44;
      })
      .map((node) => node.getAttribute("aria-label") ?? node.textContent?.trim() ?? node.tagName)
      .slice(0, 6);
  });
  check("phone tap targets at least 44px", small, []);
  await context.close();
}

await browser.close();
console.log();
if (failures.length) {
  console.log(`${failures.length} checks failed`);
  process.exit(1);
}
console.log("every browser check passed");
