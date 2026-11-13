import { chromium } from "/app/node_modules/@playwright/test/index.mjs";

const BASE = "http://127.0.0.1:4173";
let pass = 0, fail = 0;
const failures = [];

function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok: ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : "")); console.log(`  FAIL: ${name} ${extra}`); }
}

const browser = await chromium.launch();
const run = Math.floor(Math.random() * 1000000);

// ---------- currency grading route
{
  console.log("\n[grading] Currency table");
  const page = await (await browser.newContext()).newPage();
  const ctx = page.context();
  const res = await ctx.request.post(`${BASE}/api/grading/currency`, {
    data: { EUR: 1000000, USD: 1080000, JPY: 161500000, KWD: 332000 }
  });
  check("currency route answers 200 with the table", res.ok(), String(res.status()));
  const bad = await ctx.request.post(`${BASE}/api/grading/currency`, { data: { EUR: 1000000, USD: 1080000, JPY: 161500000, KWD: -1 } });
  check("negative rate answers 422", bad.status() === 422, String(bad.status()));
  const missing = await ctx.request.post(`${BASE}/api/grading/currency`, { data: { EUR: 1000000 } });
  check("missing codes answer 422", missing.status() === 422, String(missing.status()));
  const q = await ctx.request.get(`${BASE}/api/currency`);
  const table = await q.json();
  check("currency table published", table.KWD === 332000, JSON.stringify(table));
  await page.close();
}

// ---------- clock grading route with due processing
{
  console.log("\n[grading] Server clock and due processing");
  const context = await browser.newContext();
  const page = await context.newPage();
  const ctx = page.context();
  // set the clock far in the past, create a hold, then advance past its expiry
  const setRes = await ctx.request.post(`${BASE}/api/grading/clock`, { data: { set: "2027-03-01T09:00:00.000Z" } });
  check("clock set answers 200 with the instant", setRes.ok() && (await setRes.json()).now === "2027-03-01T09:00:00.000Z", JSON.stringify(await setRes.json()));
  const q = await ctx.request.post(`${BASE}/api/quotes`, {
    data: { property: "HRB-GULL", in: "2027-03-10", out: "2027-03-13", currency: "EUR", adults: 2 }
  });
  const quote = await q.json();
  const h = await ctx.request.post(`${BASE}/api/holds`, { data: { quote_id: quote.id } });
  const hold = await h.json();
  check("hold created under the moved clock", h.ok() && hold.expires_at.startsWith("2027-03-01"), JSON.stringify(hold.expires_at));
  // a search sees one room fewer while the hold is live
  const beforeUrl = BASE + "/api/properties/HRB-GULL?in=2027-03-10&out=2027-03-13&adults=2&cur=EUR";
  const before = await (await ctx.request.get(beforeUrl)).json();
  check("hold reduces rooms left", before.room_types[0].left === 4, JSON.stringify(before.room_types));
  // advance the clock past the hold expiry
  const adv = await ctx.request.post(`${BASE}/api/grading/clock`, { data: { advance_ms: 900000 } });
  check("clock advance answers 200", adv.ok(), String(adv.status()));
  const after = await (await ctx.request.get(beforeUrl)).json();
  check("expired hold returns rooms to sale", after.room_types[0].left === 5, JSON.stringify(after.room_types));
  await page.close();
  await context.close();
}

// ---------- manager rate edit reaches an open checkout live
{
  console.log("\n[live] Manager edit reaches an open checkout");
  const context = await browser.newContext();
  const traveller = await context.newPage();
  // traveller holds a room for March 2027
  await traveller.goto(`${BASE}/search?dest=harrowmere&in=2027-03-20&out=2027-03-23&adults=2&lang=en&cur=EUR`, { waitUntil: "networkidle" });
  await traveller.waitForSelector("article");
  await traveller.locator("article a.name").first().click();
  await traveller.waitForSelector("[data-role='nightstrip'] button", { timeout: 12000 });
  const propertyCode = new URL(traveller.url()).pathname.split("/")[2] ?? "";
  const before = Number(await traveller.locator(".price-reserve [data-minor]").first().getAttribute("data-minor"));
  await traveller.locator("[data-focus-key='reserve']").click();
  await traveller.waitForURL("**/checkout/**", { timeout: 12000 });
  await traveller.locator("[data-focus-key='reserve']").click();
  await traveller.waitForSelector(".holdband:not([hidden])", { timeout: 10000 });
  // the operator can edit any property, so the booked property always matches
  const managerCtx = await browser.newContext();
  const manager = await managerCtx.newPage();
  await managerCtx.request.post(`${BASE}/api/signin`, { data: { username: "founder", password: "kipwell-founder-01" } });
  const propRes = await managerCtx.request.get(BASE + "/api/properties/" + propertyCode + "?in=2027-03-20&out=2027-03-23&adults=2&cur=EUR");
  const propData = await propRes.json();
  const roomType = propData.recommendation.rooms[0].room_type;
  const edit = await managerCtx.request.patch(`${BASE}/api/manage/${propertyCode}/nights`, {
    data: {
      room_types: [roomType],
      from: "2027-03-20", to: "2027-03-22",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      rate_minor: 60000 + (run % 100000),
      season_name: "Live edit " + run
    }
  });
  check("manager rate edit applies", edit.ok(), `${edit.status()} ${await edit.text()}`);
  // the checkout should show the price-changed dialog live
  let dialogSeen = false;
  for (let i = 0; i < 24; i++) {
    await traveller.waitForTimeout(500);
    if ((await traveller.locator("dialog[open] h2").count()) > 0) {
      const title = await traveller.locator("dialog[open] h2").first().textContent();
      if (title.includes("price changed")) { dialogSeen = true; break; }
    }
  }
  check("price-changed dialog appears live", dialogSeen);
  if (dialogSeen) {
    const accept = traveller.locator("dialog[open] button", { hasText: "Accept" }).first();
    if (await accept.count()) {
      await accept.click();
      await traveller.waitForTimeout(1200);
      const after = Number(await traveller.locator(".price-reserve [data-minor]").first().getAttribute("data-minor"));
      check("accepting the new price re-quotes", after !== before, `${before} -> ${after}`);
    }
  }
  await managerCtx.close();
  await context.close();
}

// ---------- find and invoice
{
  console.log("\n[booking] Find and invoice");
  const context = await browser.newContext();
  const ctx = context.request;
  const q = await ctx.post(`${BASE}/api/quotes`, {
    data: { property: "HRB-NETT", in: "2027-03-01", out: "2027-03-04", currency: "EUR", adults: 2 }
  });
  const quote = await q.json();
  const h = await ctx.post(`${BASE}/api/holds`, { data: { quote_id: quote.id } });
  const hold = await h.json();
  const b = await ctx.post(`${BASE}/api/bookings`, {
    headers: { "Idempotency-Key": "find-" + run },
    data: { hold_id: hold.id, quote_id: quote.id, given_name: "Finda", surname: "Booking", card_number: "9000 0000 0000 0002", expiry: "12/29", security_code: "123" }
  });
  const booking = await b.json();
  const page = await context.newPage();
  await page.goto(`${BASE}/find`, { waitUntil: "networkidle" });
  await page.locator("[data-field='code']").fill(booking.code);
  await page.locator("[data-field='surname']").fill("booking");
  await page.locator("button", { hasText: "Find booking" }).click();
  await page.waitForURL("**/bookings/**", { timeout: 10000 });
  check("find by code and surname opens the booking", page.url().includes(booking.code), page.url());
  // the invoice page shows the code, guest and price lines
  const inv = await page.request.get(`${BASE}/bookings/${booking.code}/invoice`);
  check("invoice page answers 200", inv.ok(), String(inv.status()));
  const html = await inv.text();
  check("invoice shows the code", html.includes(booking.code), booking.code);
  check("invoice shows the guest", html.includes("Finda") && html.includes("Booking"));
  check("invoice shows price lines", html.includes("plan_rate") && html.includes("night_total"));
  check("invoice shows the card ending", html.includes("0002"));
  await context.close();
}

// ---------- statement CSV for a closed month
{
  console.log("\n[statement] Closed month statement");
  const context = await browser.newContext();
  const ctx = context.request;
  await ctx.post(`${BASE}/api/signin`, { data: { username: "mara", password: "kipwell-mara-01" } });
  // a completed stay checking out in a past month produces a stay line
  await ctx.post(`${BASE}/api/grading/seed`, {
    data: {
      bookings: [
        {
          guest: null, given_name: "Past", surname: "Guest", property: "HRB-QUAY",
          in: "2026-09-10", out: "2026-09-13", currency: "EUR", state: "completed",
          rooms: [{ room_type: "HRB-QUAY-DBL", plan: "refundable", breakfast: false, adults: 2, ages: [] }]
        }
      ]
    }
  });
  const stmtRes = await ctx.get(`${BASE}/api/manage/HRB-QUAY/statements/2026-09`);
  const stmt = await stmtRes.json();
  check("statement shows the month", stmtRes.ok() && stmt.month === "2026-09", String(stmtRes.status()));
  check("statement has a stay line", stmt.lines.length >= 1 && stmt.lines[0].kind === "stay", JSON.stringify(stmt.lines).slice(0, 120));
  check("statement downloadable for a closed month", stmt.downloadable === true, String(stmt.downloadable));
  check("commission is 9 percent", stmt.lines[0].commission_minor === Math.round(stmt.lines[0].base_minor * 9 / 100), `${stmt.lines[0].base_minor} -> ${stmt.lines[0].commission_minor}`);
  const csvRes = await ctx.get(`${BASE}/api/manage/HRB-QUAY/statements/2026-09.csv`);
  const csv = await csvRes.text();
  check("statement CSV downloads", csvRes.ok(), String(csvRes.status()));
  check("statement CSV header", csv.startsWith("code,kind,base_minor,commission_minor"), csv.slice(0, 50));
  check("statement CSV total row", csv.trimEnd().split("\n").pop().startsWith("total,"), csv.trimEnd().split("\n").pop());
  await context.close();
}

// ---------- back and forward through searches
{
  console.log("\n[history] Back and forward through searches");
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/search?dest=harrowmere&in=2027-03-01&out=2027-03-04&adults=2&lang=en&cur=EUR`, { waitUntil: "networkidle" });
  await page.waitForSelector("article");
  // change the sort (pushes an entry)
  await page.locator("select[aria-label='Sort by']").selectOption("price_asc");
  await page.waitForTimeout(900);
  const firstSorted = await page.locator("article").first().getAttribute("aria-label");
  // filter by stars (pushes another entry)
  await page.locator("input[aria-label='3 stars']").first().check();
  await page.waitForTimeout(900);
  const urlAfterFilter = page.url();
  // go back twice
  await page.goBack();
  await page.waitForTimeout(900);
  const urlBack1 = page.url();
  await page.goBack();
  await page.waitForTimeout(900);
  const urlBack2 = page.url();
  check("back restores the earlier search URL", urlBack2 !== urlBack1 && urlBack2.includes("sort=rank") || urlBack2 === urlAfterFilter.replace("stars=3&", ""), `${urlBack2}`);
  // forward restores
  await page.goForward();
  await page.waitForTimeout(900);
  const rowsNow = await page.locator("article").count();
  check("forward restores results", rowsNow > 0, String(rowsNow));
  await context.close();
}

await browser.close();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (failures.length) {
  console.log("Failures:");
  for (const f of failures) console.log(" - " + f);
  process.exit(1);
}
