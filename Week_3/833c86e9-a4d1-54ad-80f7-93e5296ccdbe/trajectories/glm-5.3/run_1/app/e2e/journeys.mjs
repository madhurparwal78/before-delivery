import { chromium } from "/app/node_modules/@playwright/test/index.mjs";

const BASE = "http://127.0.0.1:4173";
let pass = 0, fail = 0;
const failures = [];

function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok: ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : "")); console.log(`  FAIL: ${name} ${extra}`); }
}

const browser = await chromium.launch();

async function newPage(viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => failures.push("pageerror: " + e.message));
  return page;
}

// ---------- Journey 1: keyboard search
{
  console.log("\n[1] Keyboard search journey");
  const page = await newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".hero-word");
  await page.keyboard.press("Tab");
  let found = false;
  for (let i = 0; i < 14; i++) {
    const label = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    if (label === "Destination") { found = true; break; }
    await page.keyboard.press("Tab");
  }
  check("destination combobox reachable by Tab", found);
  await page.keyboard.type("har");
  await page.waitForTimeout(500);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const comboVal = await page.evaluate(() => document.activeElement?.value);
  check("combobox filled with destination", comboVal === "Harrowmere Bay", comboVal);

  for (let i = 0; i < 14; i++) {
    const label = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent);
    if (label === "Dates") break;
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Enter");
  await page.waitForSelector("dialog[open] .day button", { timeout: 8000 });
  const dayLabel = await page.locator("dialog[open] .day button").first().getAttribute("aria-label");
  check("date picker day label", dayLabel.includes("available") && dayLabel.includes("minimum stay"), dayLabel);
  // page forward to March 2027 with the next-month button
  for (let i = 0; i < 17; i++) {
    const nextBtn = page.locator('dialog[open] button[data-focus-key="dp-next"]').last();
    if (await nextBtn.count() === 0) break;
    await nextBtn.click();
    await page.waitForTimeout(250);
    if (await page.locator('dialog[open] button[data-date="2027-03-01"]').count() > 0) break;
  }
  await page.locator('dialog[open] button[data-date="2027-03-01"]').click();
  await page.waitForTimeout(500);
  await page.locator('dialog[open] button[data-date="2027-03-04"]').click();
  await page.waitForTimeout(300);
  check("date picker closed after range", (await page.locator("dialog[open]").count()) === 0);

  for (let i = 0; i < 16; i++) {
    const label = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent);
    if (label === "Search") break;
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Enter");
  await page.waitForSelector("article", { timeout: 12000 });
  const announcement = await page.locator("[data-status='search-announcements']").textContent();
  check("result count announced", announcement.includes("7 properties"), announcement);
  const rows = await page.locator("article").count();
  check("result rows present", rows === 5, String(rows));
  const firstRow = page.locator("article").first();
  const label = await firstRow.getAttribute("aria-label");
  check("row label format", label.includes("stars") && label.includes("score") && label.includes("kilometres") && label.includes("total"), label);

  await firstRow.locator("a.name").focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector("h1", { timeout: 10000 });
  check("property page opened from row", /\/properties\/HRB-/.test(page.url()), page.url());
  await page.close();
}

// ---------- Journey 3: quote, hold and pay
{
  console.log("\n[3] Quote, hold and pay journey");
  const page = await newPage();
  await page.goto(`${BASE}/search?dest=harrowmere&in=2027-03-01&out=2027-03-04&adults=2&lang=en&cur=EUR`, { waitUntil: "networkidle" });
  await page.waitForSelector("article");
  await page.locator("article").nth(4).locator("a.name").click();
  await page.waitForSelector("[data-role='nightstrip'] button", { timeout: 12000 });
  const nights = await page.locator("[data-role='nightstrip'] button").count();
  check("Night Strip has 3 nights", nights === 3, String(nights));
  const state = await page.locator("[data-role='nightstrip'] button").first().getAttribute("data-state");
  check("first night state is discount", state === "discount", String(state));
  await page.locator("[data-role='nightstrip'] button").first().click();
  const lines = await page.locator(".price-lines li").count();
  check("price lines expand", lines >= 5, String(lines));
  const lineCur = await page.locator(".price-lines li").evaluateAll((els) => els.map((el) => el.dataset.currency));
  check("price lines in EUR", lineCur.every((c) => c === "EUR"), lineCur.join(","));
  await page.locator("[data-focus-key='reserve']").click();
  await page.waitForURL("**/checkout/**", { timeout: 12000 });
  check("checkout page opened", page.url().includes("/checkout/"), page.url());
  await page.locator("[data-focus-key='reserve']").click();
  await page.waitForSelector(".holdband:not([hidden])", { timeout: 10000 });
  const timer = await page.locator("[role='timer']").textContent();
  check("hold timer shows mm:ss", /^\d{2}:\d{2}$/.test(timer), timer);
  await page.locator("[data-field='given_name']").fill("Ada");
  await page.locator("[data-field='surname']").fill("Lind");
  await page.locator("[data-field='card_number']").fill("9000 0000 0000 0010");
  await page.locator("[data-field='expiry']").fill("12/29");
  await page.locator("[data-field='security_code']").fill("123");
  await page.locator("[data-focus-key='pay']").click();
  await page.waitForSelector(".problems", { timeout: 8000 });
  const problems = await page.locator(".problems li a").allTextContents();
  check("declined card shows problem", problems.some((p) => p.toLowerCase().includes("declined")), problems.join("|"));
  await page.locator("[data-field='card_number']").fill("9000 0000 0000 0002");
  await page.locator("[data-focus-key='pay']").click();
  await page.waitForURL("**/bookings/**", { timeout: 12000 });
  check("booking page after pay", page.url().includes("/bookings/KW-"), page.url());
  const heading = await page.locator("h1").textContent();
  check("booking heading shows code", heading.includes("KW-"), heading);
  const ledgerRows = await page.locator("table[aria-label] tbody tr").count();
  check("ledger has charge pair", ledgerRows === 2, String(ledgerRows));
  const balance = await page.locator("table").first().getAttribute("data-balance-minor");
  check("ledger balance is zero", balance === "0", String(balance));
  const deadline = await page.locator("[data-deadline-utc]").first().getAttribute("data-deadline-utc");
  check("deadline has UTC instant", deadline && deadline.endsWith("Z"), String(deadline));
  await page.close();
}

// ---------- Journey 4: Arabic and dinars
{
  console.log("\n[4] Arabic and dinars");
  const page = await newPage();
  await page.goto(`${BASE}/search?dest=qasrayn&in=2027-03-01&out=2027-03-04&adults=2&lang=en&cur=EUR`, { waitUntil: "networkidle" });
  await page.waitForSelector("article");
  await page.locator("select[aria-label='Currency']").selectOption("KWD");
  await page.waitForTimeout(1800);
  const dataCur = await page.locator("article .total [data-minor]").first().getAttribute("data-currency");
  check("total data-currency KWD", dataCur === "KWD", String(dataCur));
  await page.locator("select[aria-label='Language']").selectOption("ar");
  await page.waitForTimeout(1800);
  const dir = await page.evaluate(() => document.documentElement.dir);
  check("Arabic sets dir=rtl", dir === "rtl", dir);
  const heading = await page.locator("h2").first().textContent();
  check("Arabic results heading", heading === "النتائج", heading);
  const url = page.url();
  check("URL carries lang and cur", url.includes("lang=ar") && url.includes("cur=KWD"), url);
  await page.locator("article a.name").first().click();
  await page.waitForSelector("[data-role='nightstrip'] button", { timeout: 12000 });
  const amounts = await page.locator("[data-role='nightstrip'] [data-minor]").evaluateAll((els) => els.map((el) => Number(el.dataset.minor)));
  const sum = amounts.reduce((a, b) => a + b, 0);
  const totalMinor = Number(await page.locator(".price-reserve [data-minor]").first().getAttribute("data-minor"));
  check("KWD nights add up exactly", sum === totalMinor, `${amounts.join("+")} = ${sum} vs ${totalMinor}`);
  await page.close();
}

// ---------- Journey 6: cancel one room
{
  console.log("\n[6] Cancel one room");
  const page = await newPage();
  const ctx = page.context();
  const apiBook = async () => {
    const q = await ctx.request.post(`${BASE}/api/quotes`, {
      data: {
        property: "HRB-QUAY", in: "2027-03-10", out: "2027-03-13", currency: "EUR", adults: 4,
        rooms: [
          { room_type: "HRB-QUAY-DBL", plan: "refundable", breakfast: false, adults: 2, ages: [] },
          { room_type: "HRB-QUAY-DBL", plan: "refundable", breakfast: false, adults: 2, ages: [] }
        ]
      }
    });
    const quote = await q.json();
    const h = await ctx.request.post(`${BASE}/api/holds`, { data: { quote_id: quote.id } });
    const hold = await h.json();
    const b = await ctx.request.post(`${BASE}/api/bookings`, {
      headers: { "Idempotency-Key": "e2e-" + Date.now() },
      data: { hold_id: hold.id, quote_id: quote.id, given_name: "Sam", surname: "Reed", card_number: "9000 0000 0000 0002", expiry: "12/29", security_code: "123" }
    });
    return (await b.json());
  };
  const booking = await apiBook();
  await page.goto(`${BASE}/bookings/${booking.code}`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-focus-key='cancel-room-1']");
  await page.locator("[data-focus-key='cancel-room-1']").click();
  await page.waitForSelector("dialog[open]");
  const refundText = await page.locator("dialog[open] p").first().textContent();
  check("cancel dialog shows refund", refundText.includes("Refund"), refundText);
  await page.locator("dialog[open] button.primary").click();
  await page.waitForSelector(".toast", { timeout: 8000 });
  const toast = await page.locator(".toast").last().textContent();
  check("cancelled toast with refund", toast.includes("Cancelled"), toast);
  await page.waitForTimeout(800);
  const cancelledCount = await page.locator("li").filter({ hasText: "cancelled" }).count();
  check("room shows cancelled", cancelledCount >= 1, String(cancelledCount));
  const balance = await page.locator("table").first().getAttribute("data-balance-minor");
  check("ledger balanced after refund", balance === "0", String(balance));
  const ledgerRows = await page.locator("table tbody tr").count();
  check("ledger grew by refund pair", ledgerRows === 4, String(ledgerRows));
  await page.close();
}

await browser.close();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (failures.length) {
  console.log("Failures:");
  for (const f of failures) console.log(" - " + f);
  process.exit(1);
}
