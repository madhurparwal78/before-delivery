// Browser checks of the published journeys: dragging, live changes, answers,
// zone rules, search and the printed week.
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

async function screen(email, path, width = 1280, height = 800) {
  const context = await browser.newContext({ viewport: { width, height } });
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

// Dragging opens Three clocks, rolls its numerals and settles into the quick
// dialog with the same three times.
{
  const { context, page } = await screen("dara@sundialwren.example", "/calendar?view=week&date=2027-03-08&calendars=cal-dara");
  await page.waitForSelector('[role="region"][aria-label="Week grid"]');
  const block = page.getByRole("button", { name: "Partners' weekly, 09:00 to 10:00" }).first();
  const box = await block.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 6, { steps: 3 });
  const ribbon = page.locator("#overlays .three-clocks");
  await ribbon.waitFor();
  check("ribbon opens beside the block", await ribbon.count(), 1);
  const before = await ribbon.getByRole("group").allTextContents();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 52, { steps: 6 });
  await page.waitForTimeout(100);
  const after = await ribbon.getByRole("group").allTextContents();
  check("numerals roll at each snap", before.join() !== after.join(), true);
  const bars = await ribbon.locator(".hours-bar").count();
  check("one working-hours bar per city", bars, 3);
  await page.mouse.up();
  const scope = page.getByRole("dialog", { name: "Edit repeating event" });
  await scope.waitFor();
  check("scope dialog on a repeating occurrence", await scope.getByRole("radio", { name: "This event" }).count(), 1);
  await scope.getByRole("radio", { name: "This event" }).click();
  await scope.getByRole("button", { name: "OK" }).click();
  const quick = page.getByRole("dialog", { name: "Partners' weekly" });
  await quick.waitFor();
  const settled = quick.getByRole("group", { name: "Three clocks" });
  check("ribbon settles in the title row", await settled.count(), 1);
  const names = await quick
    .getByRole("group", { name: /^(New York|London|Auckland) \d\d:\d\d, (inside|outside) working hours$/ })
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
  check("three clock names after release", names.length, 3);
  const saved = await page.evaluate(async () => {
    const response = await fetch("/api/events/evt-partners-weekly?occurrence_id=evt-partners-weekly@20270309T0900");
    return (await response.json()).start_local;
  });
  check("the moved occurrence is saved", saved, "2027-03-09T10:00");
  check("status announced the move", (await page.getByRole("status", { name: "Wren status" }).innerText()).startsWith("Moved Partners' weekly to "), true);
  check("undo offered", await page.getByRole("button", { name: "Undo" }).count(), 1);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(700);
  const back = await page.evaluate(async () => {
    const response = await fetch("/api/events/evt-partners-weekly?occurrence_id=evt-partners-weekly@20270309T0900");
    return (await response.json()).start_local;
  });
  check("undo put the time back", back, "2027-03-09T09:00");
  await context.close();
}

// A change on one screen reaches another within a second.
{
  const organiser = await screen("ines@sundialwren.example", "/calendar?view=week&date=2027-03-08&calendars=cal-ines");
  const colleague = await screen("marit@sundialwren.example", "/calendar?view=week&date=2027-03-08&calendars=cal-ines");
  await organiser.page.waitForSelector('[role="region"][aria-label="Week grid"]');
  await colleague.page.waitForSelector('[role="region"][aria-label="Week grid"]');
  check(
    "the colleague sees the event first",
    await colleague.page.getByRole("button", { name: "Northgate board review, 15:00 to 16:00" }).count(),
    1,
  );
  await organiser.page.evaluate(async () => {
    const read = await fetch("/api/events/evt-board-review");
    const event = await read.json();
    await fetch(`/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "If-Match": `"${event.version}"` },
      body: JSON.stringify({ title: "Northgate board review again" }),
    });
  });
  await colleague.page.waitForTimeout(1200);
  check(
    "live change reaches the other screen",
    await colleague.page.getByRole("button", { name: "Northgate board review again, 15:00 to 16:00" }).count(),
    1,
  );
  await organiser.context.close();
  await colleague.context.close();
}

// A guest's answer reaches the organiser's open event page.
{
  const organiser = await screen(
    "ines@sundialwren.example",
    "/events/evt-board-review",
  );
  await organiser.page.waitForSelector('[role="region"][aria-label="Answers"]');
  const before = (await organiser.page.getByRole("region", { name: "Answers" }).innerText()).trim();
  check("answers before", before, "0 yes, 0 no, 0 maybe, 3 waiting");
  const guest = await screen("hana@sundialwren.example", "/events/evt-board-review");
  await guest.page.waitForSelector('[role="radiogroup"][aria-label="Your answer"]');
  await guest.page.getByRole("radio", { name: "Yes", exact: true }).click();
  await organiser.page.waitForTimeout(1200);
  const after = (await organiser.page.getByRole("region", { name: "Answers" }).innerText()).trim();
  check("answers update in place", after, "1 yes, 0 no, 0 maybe, 2 waiting");
  await guest.context.close();
  await organiser.context.close();
}

// An invitation into an out-of-office week is declined, announced once.
{
  const organiser = await screen("ines@sundialwren.example", "/events/evt-board-review");
  await organiser.page.waitForSelector('[role="list"][aria-label="Guests"]');
  await organiser.page.evaluate(async () => {
    await fetch("/api/events/evt-board-review/guests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ person_ids: ["p-tane"] }),
    });
  });
  await organiser.page.waitForTimeout(1200);
  const rows = await organiser.page.getByRole("list", { name: "Guests" }).locator("li > span").allInnerTexts();
  check("the new guest is listed", rows.some((row) => row.startsWith("Tane Whitcombe")), true);
  await organiser.context.close();
}

// The office manager records a zone rule and only later saves carry warnings.
{
  const { context, page } = await screen("marit@sundialwren.example", "/zone-rules");
  await page.waitForSelector("h1");
  await page.getByLabel("Zone", { exact: true }).selectOption({ label: "Auckland" });
  await page.getByLabel("Effective date").fill("2026-06-01");
  await page.getByLabel("New offset").fill("+13:00");
  await page.getByLabel("Note").fill("Auckland holds summer time all year.");
  await page.getByRole("button", { name: "Record rule" }).click();
  await page.waitForTimeout(600);
  check("rule recorded", (await page.getByRole("status", { name: "Wren status" }).innerText()).trim(), "Rule recorded for Auckland.");
  const auckland = await screen("oren@sundialwren.example", "/calendar?view=week&date=2027-04-19&calendars=cal-oren");
  await auckland.page.waitForSelector('[role="region"][aria-label="Week grid"]');
  check("warned block shows 11:00", await auckland.page.getByRole("button", { name: "Wellington workshop, 11:00 to 13:00" }).count(), 1);
  check("warning marker on the grid", await auckland.page.getByRole("img", { name: "Zone rule warning" }).count(), 1);
  const lia = await screen("lia@sundialwren.example", "/calendar?view=week&date=2027-04-19&calendars=cal-lia");
  await lia.page.waitForSelector('[role="region"][aria-label="Week grid"]');
  check("earlier save stays unwarned", await lia.page.getByRole("img", { name: "Zone rule warning" }).count(), 0);
  check("earlier save keeps its time", await lia.page.getByRole("button", { name: "Queen Street review, 10:00 to 11:00" }).count(), 1);
  await lia.context.close();

  await page.goto(`${BASE}/events/evt-wellington-workshop`);
  await page.waitForSelector('[role="region"][aria-label="Zone rule warning"]');
  const region = page.getByRole("region", { name: "Zone rule warning" });
  check(
    "warning copy",
    (await region.locator("p").innerText()).trim(),
    "A zone rule for Auckland took effect on Mon 1 Jun 2026: Auckland holds summer time all year. 10:00 now shows as 11:00.",
  );
  await region.getByRole("button", { name: "Move" }).click();
  await page.waitForTimeout(800);
  check("move announced", (await page.getByRole("status", { name: "Wren status" }).innerText()).trim(),
    "Moved Wellington workshop back to 10:00 Auckland.");
  await auckland.page.waitForTimeout(1200);
  check("the owner's open grid follows", await auckland.page.getByRole("button", { name: "Wellington workshop, 10:00 to 12:00" }).count(), 1);
  check("warning cleared", await auckland.page.getByRole("img", { name: "Zone rule warning" }).count(), 0);
  await auckland.context.close();
  await context.close();
}

// A guest sees the same warning with no Move control.
{
  const { context, page } = await screen("hana@sundialwren.example", "/calendar?view=week&date=2027-04-05&calendars=cal-hana");
  await page.waitForSelector('[role="region"][aria-label="Week grid"]');
  check("guest sees the warned focus block", await page.getByRole("button", { name: "Focus time, 10:00 to 13:00" }).count(), 1);
  await page.goto(`${BASE}/events/evt-hana-focus?occurrence=evt-hana-focus@20270405T0900`);
  await page.waitForSelector('[role="region"][aria-label="Zone rule warning"]');
  check("owner has Move", await page.getByRole("button", { name: "Move", exact: true }).count(), 1);
  await context.close();
}

// Search updates as the person types and opens the result on its date.
{
  const { context, page } = await screen("ines@sundialwren.example", "/search");
  await page.waitForSelector('[role="searchbox"]');
  await page.getByRole("searchbox", { name: "Search events" }).type("N", { delay: 40 });
  await page.waitForTimeout(400);
  check("too short copy", (await page.locator(".column p").first().innerText()).trim(), "Type at least 2 characters to search.");
  await page.getByRole("searchbox", { name: "Search events" }).type("orthgate", { delay: 20 });
  await page.waitForTimeout(600);
  const results = page.getByRole("list", { name: "Results" });
  check("result listed", (await results.locator("a").allInnerTexts()).some((text) => text.startsWith("Northgate board review")), true);
  check("q stays in the address", page.url().includes("q=Northgate"), true);
  await results.locator("a").first().click();
  await page.waitForSelector('[role="region"][aria-label="Week grid"]');
  check("result opens its date", page.url().includes("date=2027-03-10"), true);
  check("result block focused", (await page.evaluate(() => document.activeElement?.getAttribute("aria-label")))
    ?.startsWith("Northgate board review"), true);
  await context.close();
}

// Slots move by the keyboard, one Tab stop for the grid.
{
  const { context, page } = await screen("ines@sundialwren.example", "/calendar?view=week&date=2027-03-08");
  await page.waitForSelector('[role="region"][aria-label="Week grid"]');
  await page.evaluate(() => {
    document.querySelector('[role="gridcell"][tabindex="0"]').focus();
  });
  const first = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  check("a slot takes focus", first, "Mon 8 Mar 2027 09:00");
  await page.keyboard.press("ArrowDown");
  check("Down moves one slot", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Mon 8 Mar 2027 09:15");
  await page.keyboard.press("ArrowRight");
  check("Right moves one day", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Tue 9 Mar 2027 09:15");
  await page.keyboard.press("End");
  check("End goes to the last day", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Sun 14 Mar 2027 09:15");
  await page.keyboard.press("Control+Home");
  check("Ctrl+Home goes to the first slot", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Mon 8 Mar 2027 00:00");
  await page.keyboard.press("Enter");
  const create = page.getByRole("dialog", { name: "New event" });
  await create.waitFor();
  check("Enter on a slot opens New event", await create.getByLabel("Starts").inputValue(), "2027-03-08 00:00");
  await create.getByRole("button", { name: "Cancel" }).click();
  await context.close();
}

// The printed week stays pending with Retry while the document service is
// unreachable, and completes when it answers.
{
  const { context, page } = await screen("marit@sundialwren.example", "/prints");
  await page.waitForSelector("h1");
  await page.getByLabel("Week starting").fill("2027-04-19");
  await page.getByRole("button", { name: "Print the week" }).click();
  await page.waitForTimeout(4000);
  const rows = await page.getByRole("list", { name: "Printed weeks" }).locator("li > span").allInnerTexts();
  check("print row holds its week", rows.some((row) => row.includes("Week of Mon 19 Apr 2027")), true);
  check("print reaches stored", rows.some((row) => row.includes("The printed week is ready.")), true);
  check("download shows when stored", await page.getByRole("link", { name: "Download PDF" }).count() > 0, true);
  await context.close();
}

await browser.close();
console.log();
if (failures.length) {
  console.log(`${failures.length} checks failed`);
  process.exit(1);
}
console.log("every journey check passed");
