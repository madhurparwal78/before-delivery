/* Browser smoke test for Pilotlight using Playwright. */
const { chromium } = require("playwright");

const BASE = "http://localhost:4173";
let pass = 0;
let fail = 0;
function check(name, condition, detail = "") {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}  ${detail}`);
  }
}

async function signIn(page, email) {
  await page.goto(`${BASE}/signin`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("nightshift-demo-26");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForTimeout(1500);
}

(async () => {
  const browser = await chromium.launch();

  // ---------- 1280 x 800 ----------
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(BASE + "/");
  await page.waitForTimeout(1200);
  check("signin form shown", await page.getByRole("button", { name: "Sign in" }).count() === 1);
  const email = page.getByLabel("Email");
  check("Email field present", (await email.count()) === 1);

  await signIn(page, "ember@pilotlight.test");
  check("ember lands on loom", page.url().includes("/loom"), page.url());

  const nav = page.getByRole("navigation", { name: "Main" });
  check("Main navigation", (await nav.count()) === 1);
  for (const label of ["Loom", "Bookings", "Papers", "Billing"]) {
    check(`nav link ${label}`, (await page.getByRole("link", { name: label }).count()) >= 1);
  }
  check("no Members link for member", (await page.getByRole("link", { name: "Members" }).count()) === 0);

  const scrollX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("1280 no sideways page scroll", scrollX <= 0, scrollX);

  const grid = page.getByRole("grid", { name: "Station loom" });
  check("loom grid present", (await grid.count()) === 1);
  const rowCount = await grid.locator("tbody tr").count();
  check("loom rows = 10 stations", rowCount === 10, rowCount);
  const colCount = await grid.locator("tbody tr").first().locator("td").count();
  check("loom 80 columns", colCount === 80, colCount);
  const floor = page.getByRole("group", { name: "Kitchen floor plan" });
  check("floor plan group", (await floor.count()) === 1);
  const stationImg = floor.locator("[role=img]").first();
  check("floor plan station img", (await stationImg.count()) === 1);
  const legend = page.getByRole("list", { name: "Loom legend" });
  check("legend list", (await legend.count()) === 1);
  for (const item of ["Selected", "Held", "Booked", "Taken", "Conflict", "Papers"]) {
    check(`legend ${item}`, (await legend.getByRole("listitem").filter({ hasText: item }).count()) >= 1);
  }
  const rail = page.getByRole("complementary", { name: "Quote" });
  check("quote rail", (await rail.count()) === 1);
  check("quote total group", (await rail.getByRole("group", { name: "Quote total" }).count()) === 1);
  check("pack checkbox", (await page.getByRole("checkbox", { name: /Use pack hours/ }).count()) === 1);
  check("Place hold button", (await page.getByRole("button", { name: "Place hold" }).count()) === 1);
  check("Clear brush button", (await page.getByRole("button", { name: "Clear brush" }).count()) === 1);
  check("Today button", (await page.getByRole("button", { name: "Today" }).count()) === 1);
  check("Previous day", (await page.getByRole("button", { name: "Previous day" }).count()) === 1);
  check("Next day", (await page.getByRole("button", { name: "Next day" }).count()) === 1);
  check("Stations dialog button", (await page.getByRole("button", { name: "Stations" }).count()) === 1);
  check("Sign out", (await page.getByRole("button", { name: "Sign out" }).count()) === 1);
  const dateInput = page.locator("#loom-date");
  check("kitchen date field", (await dateInput.count()) === 1);
  await page.screenshot({ path: "/tmp/shot-loom-1280.png" });

  // ---------- brush and hold via mouse, on a fresh date ----------
  const todayStr = await dateInput.inputValue();
  const brushDate = new Date(Date.parse(todayStr) + 30 * 86400000).toISOString().slice(0, 10);
  await page.goto(BASE + "/loom?date=" + brushDate);
  await page.waitForTimeout(1500);
  const gridB = page.getByRole("grid", { name: "Station loom" });
  const cell = gridB.locator("tbody tr").nth(0).locator("td").nth(2);
  const cell2 = gridB.locator("tbody tr").nth(2).locator("td").nth(6);
  const box = await cell.boundingBox();
  const box2 = await cell2.boundingBox();
  await page.mouse.move(box.x + 2, box.y + 2);
  await page.mouse.down();
  await page.waitForTimeout(200);
  const selectedWhilePainting = await gridB.locator("td.selected").count();
  check("brush paints while dragging", selectedWhilePainting === 1, selectedWhilePainting);
  await page.mouse.move(box2.x + 2, box2.y + 2, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const firstHeld = gridB.locator("td.held").first();
  check("cell label held", (await firstHeld.getAttribute("aria-label"))?.includes("held") === true, await firstHeld.getAttribute("aria-label"));
  await page.screenshot({ path: "/tmp/shot-brush-1280.png" });

  // rail quote
  await page.waitForTimeout(800);
  const totalText = await rail.getByRole("group", { name: "Quote total" }).textContent();
  check("rail total counted", /\$[\d,.]+\.\d\d/.test(totalText ?? ""), totalText);
  check("quote announcement", (await rail.getByRole("status", { name: "Quote announcement" }).count()) === 1);
  const announcement = await rail.getByRole("status", { name: "Quote announcement" }).textContent();
  check("quote announcement says total", (announcement ?? "").includes("Total $"), announcement);

  // a hold is placed on pointer release
  await page.waitForTimeout(400);
  const confirmButton = page.getByRole("button", { name: "Confirm booking" });
  check("confirm button after hold", (await confirmButton.count()) === 1);
  const releaseButton = page.getByRole("button", { name: "Release hold" });
  check("release button after hold", (await releaseButton.count()) === 1);
  const progress = page.getByRole("progressbar", { name: "Hold time left" });
  check("hold countdown progressbar", (await progress.count()) === 1);
  const heldCells = await gridB.locator("td.held").count();
  check("held cells", heldCells === 15, heldCells);
  const heldLabel = grid.locator("td.held").first().getAttribute("aria-label");
  check("held cell label", ((await heldLabel) ?? "").includes("held"), heldLabel);
  await page.screenshot({ path: "/tmp/shot-hold-1280.png" });

  // confirm dialog
  await confirmButton.click();
  await page.waitForTimeout(600);
  const dialog = page.getByRole("dialog", { name: "Confirm booking" });
  check("confirm dialog", (await dialog.count()) === 1);
  check("dialog Confirm button", (await dialog.getByRole("button", { name: "Confirm" }).count()) === 1);
  check("dialog Back button", (await dialog.getByRole("button", { name: "Back" }).count()) === 1);
  check("dialog pack checkbox", (await dialog.getByRole("checkbox", { name: "Use pack hours" }).count()) === 1);
  await page.screenshot({ path: "/tmp/shot-dialog.png" });
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await page.waitForTimeout(2500);
  const loomStatus = await page.getByRole("status", { name: "Loom status" }).textContent();
  check("confirm success copy", (loomStatus ?? "").includes("confirmed. Confirmation sent to"), loomStatus);
  const bookedCells = await gridB.locator("td.booked").count();
  check("booked cells after confirm", bookedCells === 15, bookedCells);
  check("address has no hold param", !page.url().includes("hold="), page.url());
  await page.screenshot({ path: "/tmp/shot-booked-1280.png" });

  // ---------- keyboard brushing ----------
  const gridEl = grid;
  await gridEl.focus();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("ArrowRight");
  }
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press("ArrowDown");
  }
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.waitForTimeout(700);
  const kbSelected = await gridB.locator("td.selected").count();
  check("keyboard brush 9 cells", kbSelected === 9, kbSelected);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const kbSelectedAfter = await gridB.locator("td.selected").count();
  check("escape clears brush", kbSelectedAfter === 0, kbSelectedAfter);

  // address restore of sel
  await gridEl.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page.waitForTimeout(500);
  const urlNow = page.url();
  check("sel in address", urlNow.includes("sel="), urlNow);
  await page.reload();
  await page.waitForTimeout(1500);
  const selAfterReload = await page.getByRole("grid", { name: "Station loom" }).locator("td.selected").count();
  check("brush restored after reload", selAfterReload === 2, selAfterReload);

  // ---------- secondary screens ----------
  await page.getByRole("link", { name: "Bookings" }).click();
  await page.waitForTimeout(1200);
  check("bookings table", (await page.getByRole("table", { name: "Bookings" }).count()) === 1);
  const bookingRow = page.getByRole("table", { name: "Bookings" }).locator("tbody tr").first();
  await bookingRow.click();
  await page.waitForTimeout(1200);
  const regionText = await page.locator("[role=region][aria-label^='Booking']").first().textContent();
  check("booking detail region", (regionText ?? "").includes("PL-"), regionText);
  check("cancel booking button", (await page.getByRole("button", { name: "Cancel booking" }).count()) >= 1);
  await page.screenshot({ path: "/tmp/shot-bookings.png" });

  await page.getByRole("link", { name: "Papers" }).click();
  await page.waitForTimeout(1200);
  check("my documents table", (await page.getByRole("table", { name: "My documents" }).count()) === 1);
  check("upload form", (await page.getByRole("form", { name: "Upload document" }).count()) === 1);
  check("upload button", (await page.getByRole("button", { name: "Upload" }).count()) === 1);
  await page.screenshot({ path: "/tmp/shot-papers.png" });

  await page.getByRole("link", { name: "Billing" }).click();
  await page.waitForTimeout(1500);
  check("pack balance heading", (await page.getByRole("heading", { name: "Pack balance" }).count()) === 1);
  check("buy pack button", (await page.getByRole("button", { name: "Buy 20-hour pack" }).count()) === 1);
  check("pack movements table", (await page.getByRole("table", { name: "Pack movements" }).count()) === 1);
  check("invoices table", (await page.getByRole("table", { name: "Invoices" }).count()) === 1);
  await page.screenshot({ path: "/tmp/shot-billing.png" });

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForTimeout(800);
  check("signed out to signin", page.url().includes("/signin"), page.url());

  // ---------- operator ----------
  await signIn(page, "operator@nightshift.test");
  check("operator on loom", page.url().includes("/loom"), page.url());
  check("Book for member combobox", (await page.getByRole("combobox", { name: "Book for member" }).count()) === 1);
  for (const label of ["Members", "Rates", "Reports"]) {
    check(`operator nav ${label}`, (await page.getByRole("link", { name: label }).count()) >= 1);
  }
  await page.getByRole("link", { name: "Members" }).click();
  await page.waitForTimeout(1200);
  check("members table", (await page.getByRole("table", { name: "Members" }).count()) === 1);
  await page.getByRole("link", { name: "Rates" }).click();
  await page.waitForTimeout(1200);
  check("rate cards table", (await page.getByRole("table", { name: "Rate cards" }).count()) === 1);
  check("new rate card form", (await page.getByRole("form", { name: "New rate card" }).count()) === 1);
  check("save cutoff button", (await page.getByRole("button", { name: "Save cutoff" }).count()) === 1);
  await page.screenshot({ path: "/tmp/shot-rates.png" });
  await page.getByRole("link", { name: "Bookings" }).click();
  await page.waitForTimeout(1000);
  check("date field operator bookings", (await page.getByLabel("Date").count()) >= 1);
  await page.getByRole("link", { name: "Reports" }).click();
  await page.waitForTimeout(1000);
  await page.getByRole("link", { name: "Reports" }).click();
  await page.waitForTimeout(1200);
  check("reports month field", (await page.getByLabel("Month").count()) >= 1);
  check("usage table", (await page.getByRole("table", { name: "Usage by member" }).count()) === 1);
  check("occupancy table", (await page.getByRole("table", { name: "Station occupancy" }).count()) === 1);
  check("csv link", (await page.getByRole("link", { name: "Download CSV" }).count()) === 1);
  await page.screenshot({ path: "/tmp/shot-reports.png" });

  // day sheet ops on the seeded saltline booking (today+2: day not reached)
  await page.getByRole("link", { name: "Bookings" }).click();
  await page.waitForTimeout(1200);
  const seededRow = page.getByRole("table", { name: "Bookings" }).locator("tbody tr").filter({ hasText: "PL-000001" });
  if ((await seededRow.count()) > 0) {
    await seededRow.click();
    await page.waitForTimeout(1000);
    const checkInButton = page.getByRole("button", { name: "Check in" });
    if ((await checkInButton.count()) === 1) {
      await checkInButton.click();
      await page.waitForTimeout(900);
      const statusText = await page.getByRole("status", { name: "Form status" }).textContent();
      check("check-in before day refused", (statusText ?? "").includes("booking day"), statusText);
    } else {
      check("check-in button present for operator", false, "missing");
    }
  }

  // ---------- bookkeeper ----------
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForTimeout(600);
  await signIn(page, "books@ledgerline.test");
  check("bookkeeper lands on reports", page.url().includes("/reports"), page.url());
  check("bookkeeper no loom link", (await page.getByRole("link", { name: "Loom" }).count()) === 0);
  await page.getByRole("link", { name: "Bookings" }).click();
  await page.waitForTimeout(1000);
  check("bookkeeper sees bookings table", (await page.getByRole("table", { name: "Bookings" }).count()) === 1);
  check("bookkeeper no cancel", (await page.getByRole("button", { name: "Cancel booking" }).count()) === 0);

  // ---------- 768 x 1024 ----------
  const page768 = await browser.newPage({ viewport: { width: 768, height: 1024 } });
  await page768.goto(BASE + "/signin");
  await signIn(page768, "ember@pilotlight.test");
  const sx768 = await page768.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("768 no sideways page scroll", sx768 <= 0, sx768);
  await page768.screenshot({ path: "/tmp/shot-loom-768.png" });

  // ---------- 375 x 812 ----------
  const page375 = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page375.goto(BASE + "/signin");
  await signIn(page375, "ember@pilotlight.test");
  const sx375 = await page375.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("375 no sideways page scroll", sx375 <= 0, sx375);
  check("menu button at 375", (await page375.getByRole("button", { name: "Menu" }).count()) === 1);
  check("show quote at 375", (await page375.getByRole("button", { name: "Show quote" }).count()) === 1);
  await page375.getByRole("button", { name: "Show quote" }).click();
  await page375.waitForTimeout(500);
  check("quote sheet opens", (await page375.getByRole("complementary", { name: "Quote" }).count()) === 1);
  await page375.screenshot({ path: "/tmp/shot-loom-375.png" });
  await page375.goto(BASE + "/bookings");
  await page375.waitForTimeout(1200);
  const sx375b = await page375.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("375 bookings no sideways scroll", sx375b <= 0, sx375b);
  await page375.screenshot({ path: "/tmp/shot-bookings-375.png" });

  // ---------- reduced motion ----------
  const pageRM = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  await pageRM.goto(BASE + "/signin");
  await signIn(pageRM, "ember@pilotlight.test");
  const rmGrid = pageRM.getByRole("grid", { name: "Station loom" });
  const c1 = rmGrid.locator("tbody tr").nth(1).locator("td").nth(2);
  const c2 = rmGrid.locator("tbody tr").nth(1).locator("td").nth(6);
  const b1 = await c1.boundingBox();
  const b2 = await c2.boundingBox();
  await pageRM.mouse.move(b1.x + 2, b1.y + 2);
  await pageRM.mouse.down();
  await pageRM.mouse.move(b2.x + 2, b2.y + 2);
  await pageRM.mouse.up();
  await pageRM.waitForTimeout(500);
  const rmHeld = await rmGrid.locator("td.held").count();
  check("reduced-motion hold works", rmHeld === 5, rmHeld);
  const heldUntil = await pageRM.locator(".helduntil").textContent();
  check("reduced-motion held-until text", (heldUntil ?? "").includes("held until"), heldUntil);
  await pageRM.screenshot({ path: "/tmp/shot-reduced.png" });

  await browser.close();
  console.log(`\n===== BROWSER: ${pass} passed, ${fail} failed =====`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error("browser test crashed:", error);
  process.exit(2);
});
