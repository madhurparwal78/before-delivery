// Browser checks of the published layouts, the keyboard model, overlap lanes,
// midnight, the month count, reduced motion and the address.
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";

const BASE = "http://127.0.0.1:4173";
const failures = [];

function check(name, got, want) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures.push(name);
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const browser = await chromium.launch();

async function screen(email, path, options = {}) {
  const context = await browser.newContext({
    viewport: { width: options.width ?? 1280, height: options.height ?? 800 },
    reducedMotion: options.reducedMotion ?? "no-preference",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    failures.push(`page error: ${error.message}`);
    console.log(`FAIL page error: ${error.message}`);
  });
  await page.goto(`${BASE}/signin`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Passcode").fill("wren-seed-2027");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/calendar/);
  await page.evaluate(() => fetch("/api/draft", { method: "DELETE" }));
  await page.goto(`${BASE}${path}`);
  return { context, page };
}

async function api(page, method, path, body, headers) {
  return page.evaluate(
    async ([method, path, body, headers]) => {
      const init = { method, headers: { ...(headers ?? {}) } };
      if (body) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }
      const response = await fetch(path, init);
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    [method, path, body ?? null, headers ?? null],
  );
}

// Three overlapping meetings share a day column by the published lane rule.
{
  const { context, page } = await screen("ines@sundialwren.example", "/calendar?view=day&date=2027-07-05&calendars=cal-ines");
  const rows = [
    ["Long one", "2027-07-05T09:00", "2027-07-05T12:00"],
    ["Middle one", "2027-07-05T09:30", "2027-07-05T11:00"],
    ["Short one", "2027-07-05T10:00", "2027-07-05T10:30"],
    ["After it all", "2027-07-05T12:00", "2027-07-05T13:00"],
  ];
  for (const [title, start, end] of rows) {
    await api(page, "POST", "/api/events", {
      calendar_id: "cal-ines", title, kind: "event", all_day: false,
      start_local: start, end_local: end, zone: "Europe/London",
    });
  }
  await page.goto(`${BASE}/calendar?view=day&date=2027-07-05&calendars=cal-ines`);
  await page.waitForSelector('[role="region"][aria-label="Day grid"]');
  const boxes = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".day-column .event-block")).map((node) => {
      const box = node.getBoundingClientRect();
      const column = node.parentElement.getBoundingClientRect();
      return {
        name: node.getAttribute("aria-label"),
        left: Math.round(box.left - column.left),
        width: Math.round(box.width),
        columnWidth: Math.round(column.width),
        top: Math.round(box.top),
        height: Math.round(box.height),
      };
    }),
  );
  const group = boxes.filter((box) => box.name.startsWith("Long") || box.name.startsWith("Middle") || box.name.startsWith("Short"));
  check("three in the overlapping group", group.length, 3);
  const lanes = 3;
  const lane = group[0].columnWidth / lanes;
  check("each is one lane wide", group.every((box) => Math.abs(box.width - lane) <= 2), true);
  const longOne = group.find((box) => box.name.startsWith("Long"));
  const middle = group.find((box) => box.name.startsWith("Middle"));
  const short = group.find((box) => box.name.startsWith("Short"));
  check("longest first takes lane 0", Math.abs(longOne.left - 0) <= 2, true);
  check("then the next longest", Math.abs(middle.left - lane) <= 2, true);
  check("then the shortest", Math.abs(short.left - 2 * lane) <= 2, true);
  const after = boxes.find((box) => box.name.startsWith("After it all"));
  check("a shared endpoint is no overlap", Math.abs(after.width - group[0].columnWidth) <= 2, true);
  check("height follows the minutes", Math.round(longOne.height / middle.height * 10) / 10, 2);
  await context.close();
}

// A timed event crossing midnight shows one block on each of its two days.
{
  const { context, page } = await screen("ines@sundialwren.example", "/calendar?view=week&date=2027-07-05&calendars=cal-ines");
  await api(page, "POST", "/api/events", {
    calendar_id: "cal-ines", title: "Night call", kind: "event", all_day: false,
    start_local: "2027-07-07T23:00", end_local: "2027-07-08T01:00", zone: "Europe/London",
  });
  await page.goto(`${BASE}/calendar?view=week&date=2027-07-05&calendars=cal-ines`);
  await page.waitForSelector('[role="region"][aria-label="Week grid"]');
  const blocks = await page.getByRole("button", { name: "Night call, 23:00 to 01:00" }).count();
  check("a block on each of its two days", blocks, 2);
  const cut = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.event-block[aria-label^="Night call"]')).map((node) => ({
      top: Math.round(parseFloat(node.style.top)),
      height: Math.round(parseFloat(node.style.height)),
    })),
  );
  check("each piece is cut at midnight", cut.some((piece) => piece.top === 0), true);
  await context.close();
}

// An all-day event and a 24-hour event sit in the top band.
{
  const { context, page } = await screen("marit@sundialwren.example", "/calendar?view=week&date=2027-03-08&calendars=cal-firm");
  await page.waitForSelector('[role="group"][aria-label="All-day events"]');
  const band = page.getByRole("group", { name: "All-day events" });
  check("the all-day event is in the band", await band.getByRole("button", { name: "London offsite, all day" }).count(), 1);
  await context.close();
}

// Each month cell shows what fits plus the exact +N more, and both follow the
// window height with no reload.
{
  const { context, page } = await screen("ines@sundialwren.example", "/calendar?view=month&date=2027-07-01&calendars=cal-ines");
  for (let index = 0; index < 8; index += 1) {
    await api(page, "POST", "/api/events", {
      calendar_id: "cal-ines", title: `Crowded ${index}`, kind: "event", all_day: false,
      start_local: `2027-07-14T0${index + 1}:00`, end_local: `2027-07-14T0${index + 1}:30`,
      zone: "Europe/London",
    });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE}/calendar?view=month&date=2027-07-01&calendars=cal-ines`);
  await page.waitForSelector('[role="region"][aria-label="Month grid"]');
  await page.waitForTimeout(300);
  const read = async () =>
    page.evaluate(() => {
      const cell = document.querySelector('.month-cell[data-date="2027-07-14"]');
      const chips = cell.querySelectorAll(".month-chip").length;
      const more = cell.querySelector(".more");
      return { chips, more: more ? Number(more.textContent.replace(/[^0-9]/g, "")) : 0 };
    });
  const tall = await read();
  check("shown chips plus n equals the day's events", tall.chips + tall.more, 8);
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.waitForTimeout(500);
  const short = await read();
  check("shown chips plus n still equals them", short.chips + short.more, 8);
  check("a shorter window shows fewer", short.chips < tall.chips, true);
  check("and raises the count", short.more > tall.more, true);
  await context.close();
}

// The address holds the view, date, calendars and open event through Back and
// Forward and a reload.
{
  const { context, page } = await screen("dara@sundialwren.example", "/calendar?view=week&date=2027-03-08&calendars=cal-dara");
  await page.waitForSelector('[role="region"][aria-label="Week grid"]');
  await page.getByRole("button", { name: "Partners' weekly, 09:00 to 10:00" }).first().click();
  await page.getByRole("dialog", { name: "Partners' weekly" }).waitFor();
  check("the open event is in the address", page.url().includes("event=evt-partners-weekly%40"), true);
  await page.reload();
  await page.getByRole("dialog", { name: "Partners' weekly" }).waitFor();
  check("a reload reopens the dialog", await page.getByRole("dialog", { name: "Partners' weekly" }).count(), 1);
  await page.goBack();
  await page.waitForTimeout(400);
  check("Back closes it", await page.getByRole("dialog", { name: "Partners' weekly" }).count(), 0);
  await page.goForward();
  await page.waitForTimeout(400);
  check("Forward reopens it", await page.getByRole("dialog", { name: "Partners' weekly" }).count(), 1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check("Escape returns focus to the block",
    await page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
    "Partners' weekly, 09:00 to 10:00");
  await context.close();
}

// A focused event moves by Alt with arrow keys, keeps focus and is announced.
{
  const { context, page } = await screen("ines@sundialwren.example", "/calendar?view=week&date=2027-03-08&calendars=cal-ines");
  await page.waitForSelector('[role="region"][aria-label="Week grid"]');
  const block = page.getByRole("button", { name: "Northgate board review, 15:00 to 16:00" });
  await block.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await page.waitForTimeout(900);
  check("Alt+Down moved it by fifteen minutes",
    await page.getByRole("button", { name: "Northgate board review, 15:15 to 16:15" }).count(), 1);
  check("focus stayed on the event",
    await page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
    "Northgate board review, 15:15 to 16:15");
  check("the move was announced",
    (await page.getByRole("status", { name: "Wren status" }).innerText()).startsWith("Moved Northgate board review to 15:15"),
    true);
  await page.keyboard.press("Alt+Shift+ArrowDown");
  await page.waitForTimeout(900);
  check("Alt+Shift+Down resized it",
    await page.getByRole("button", { name: "Northgate board review, 15:15 to 16:30" }).count(), 1);
  await context.close();
}

// Personal settings reach another open tab, and hold the grid.
{
  const first = await screen("rafe@sundialwren.example", "/calendar?view=custom&date=2027-03-08");
  const second = await screen("rafe@sundialwren.example", "/settings");
  await first.page.waitForSelector('[role="region"][aria-label="Custom days grid"]');
  const days = async () =>
    first.page.evaluate(() => document.querySelectorAll(".grid-head .day-head").length);
  check("custom days starts at four", await days(), 4);
  await second.page.getByLabel("Custom days").fill("6");
  await second.page.getByLabel("Second zone").selectOption({ label: "Auckland" });
  await second.page.getByRole("button", { name: "Save settings" }).click();
  await second.page.waitForTimeout(1200);
  check("the other tab follows", await days(), 6);
  check("the second zone labels are drawn",
    await first.page.getByRole("group", { name: "Second zone Auckland" }).count(), 1);
  await second.page.getByLabel("Hide weekends").check();
  await second.page.getByRole("button", { name: "Save settings" }).click();
  await second.page.waitForTimeout(1200);
  const names = await first.page.evaluate(() =>
    Array.from(document.querySelectorAll(".grid-head .day-name")).map((node) => node.textContent));
  check("hidden weekends leave them out", names.includes("Sat") || names.includes("Sun"), false);
  await first.context.close();
  await second.context.close();
}

// Reduced motion shows the same three times and announces them.
{
  const { context, page } = await screen("dara@sundialwren.example", "/calendar?view=week&date=2027-03-08&calendars=cal-dara", {
    reducedMotion: "reduce",
  });
  await page.waitForSelector('[role="region"][aria-label="Week grid"]');
  const block = page.getByRole("button", { name: "Partners' weekly, 09:00 to 10:00" }).first();
  await block.waitFor();
  const box = await block.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 26, { steps: 4 });
  await page.waitForTimeout(300);
  const ribbon = page.locator("#overlays .three-clocks");
  check("the ribbon is there without sliding", await ribbon.count(), 1);
  check("no numeral rolls", await ribbon.locator(".digit.rolling").count(), 0);
  const announced = await page.getByRole("status", { name: "Wren status" }).innerText();
  check("the three-clock line is announced",
    /^New York \d\d:\d\d (inside|outside) working hours, London \d\d:\d\d (inside|outside) working hours, Auckland \d\d:\d\d (inside|outside) working hours\.$/.test(announced.trim()),
    true);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await context.close();
}

// The published layouts at the three widths, with no sideways scroll.
for (const [width, height, wanted] of [[375, 812, "Schedule"], [768, 1024, "Week grid"], [1280, 800, "Week grid"]]) {
  const { context, page } = await screen("ines@sundialwren.example", "/calendar", { width, height });
  await page.waitForTimeout(600);
  if (wanted === "Schedule") {
    check(`${width} shows the schedule`, await page.getByRole("list", { name: "Schedule" }).count(), 1);
    check(`${width} offers only Schedule and Day`,
      await page.getByRole("radiogroup", { name: "View" }).getByRole("radio").allInnerTexts(), ["Schedule", "Day"]);
  } else {
    check(`${width} shows the week`, await page.getByRole("region", { name: "Week grid" }).count(), 1);
  }
  check(`${width} has no sideways scroll`,
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  if (width === 1280) {
    const edge = await page.evaluate(() => {
      const rail = document.querySelector(".rail").getBoundingClientRect();
      const main = document.querySelector(".calendar-main").getBoundingClientRect();
      return { railEnd: Math.round(rail.right), mainStart: Math.round(main.left), width: window.innerWidth };
    });
    check("the rail and grid share one edge", Math.abs(edge.railEnd - edge.mainStart) <= 1, true);
    check("that edge is about 22% in", Math.abs(edge.mainStart / edge.width - 0.22) < 0.03, true);
  }
  await context.close();
}

// Nth and last weekday repeats land on the right dates.
{
  const { context, page } = await screen("ines@sundialwren.example", "/calendar?view=month&date=2027-08-01&calendars=cal-ines");
  await api(page, "POST", "/api/events", {
    calendar_id: "cal-ines", title: "Second Tuesday", kind: "event", all_day: false,
    start_local: "2027-08-10T09:00", end_local: "2027-08-10T10:00", zone: "Europe/London",
    rrule: "FREQ=MONTHLY;BYDAY=2TU;COUNT=3",
  });
  await api(page, "POST", "/api/events", {
    calendar_id: "cal-ines", title: "Last Friday", kind: "event", all_day: false,
    start_local: "2027-08-27T09:00", end_local: "2027-08-27T10:00", zone: "Europe/London",
    rrule: "FREQ=MONTHLY;BYDAY=-1FR;UNTIL=20271031",
  });
  const second = await api(page, "GET", "/api/occurrences?from=2027-08-01&to=2027-12-01&calendars=cal-ines");
  const dates = (title) =>
    second.body.occurrences.filter((o) => o.title === title).map((o) => o.start_local.slice(0, 10));
  check("the second Tuesday of each month", dates("Second Tuesday"), ["2027-08-10", "2027-09-14", "2027-10-12"]);
  check("the last Friday of each month", dates("Last Friday"), ["2027-08-27", "2027-09-24", "2027-10-29"]);
  await context.close();
}

// Find a time lists the earliest common slots with their three city times.
{
  const { context, page } = await screen("dara@sundialwren.example", "/find");
  await page.waitForSelector('[role="list"][aria-label="Slots"]');
  await page.getByLabel("From").fill("2027-06-07");
  await page.getByLabel("To").fill("2027-06-07");
  await page.getByRole("group", { name: "People" }).getByLabel("Ines Okafor").check();
  await page.waitForTimeout(900);
  const slots = page.getByRole("list", { name: "Slots" });
  const first = await slots.locator("li").first().innerText();
  check("the earliest slot is offered", /^Book Mon 7 Jun 2027 \d\d:\d\d/.test(first), true);
  check("it carries its three city times",
    /New York/.test(first) && /London/.test(first) && /Auckland/.test(first), true);
  const busy = page.getByRole("region", { name: "Busy blocks" });
  check("busy blocks are drawn per person", (await busy.getByRole("group").count()) >= 2, true);
  await context.close();
}

await browser.close();
console.log();
if (failures.length) {
  console.log(`${failures.length} checks failed`);
  process.exit(1);
}
console.log("every layout check passed");
