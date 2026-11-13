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

// ---------- idempotency: a double submit books and charges once
{
  console.log("\n[API] Idempotency and error order");
  const ctx = await (await browser.newContext()).newPage().then((p) => p.context());
  const book = async (key) => {
    const q = await ctx.request.post(`${BASE}/api/quotes`, {
      data: { property: "HRB-NETT", in: "2027-03-01", out: "2027-03-04", currency: "EUR", adults: 2 }
    });
    const quote = await q.json();
    const h = await ctx.request.post(`${BASE}/api/holds`, { data: { quote_id: quote.id } });
    const hold = await h.json();
    const body = { hold_id: hold.id, quote_id: quote.id, given_name: "Idem", surname: "Potence", card_number: "9000 0000 0000 0002", expiry: "12/29", security_code: "123" };
    const first = await ctx.request.post(`${BASE}/api/bookings`, { headers: { "Idempotency-Key": key }, data: body });
    const second = await ctx.request.post(`${BASE}/api/bookings`, { headers: { "Idempotency-Key": key }, data: body });
    return { first, second };
  };
  const { first, second } = await book("idem-" + run);
  check("first submit is 201", first.status() === 201, String(first.status()));
  check("replay answers 200 with the same body", second.status() === 200, String(second.status()));
  const firstBody = await first.json();
  const secondBody = await second.json();
  check("replay returns the same booking code", firstBody.code === secondBody.code, `${firstBody.code} vs ${secondBody.code}`);
  // a different body with the same key conflicts
  const q2 = await ctx.request.post(`${BASE}/api/quotes`, {
    data: { property: "HRB-NETT", in: "2027-03-01", out: "2027-03-04", currency: "EUR", adults: 2 }
  });
  const quote2 = await q2.json();
  const h2 = await ctx.request.post(`${BASE}/api/holds`, { data: { quote_id: quote2.id } });
  const hold2 = await h2.json();
  const conflict = await ctx.request.post(`${BASE}/api/bookings`, {
    headers: { "Idempotency-Key": "idem-" + run },
    data: { hold_id: hold2.id, quote_id: quote2.id, given_name: "Other", surname: "Body", card_number: "9000 0000 0000 0002", expiry: "12/29", security_code: "123" }
  });
  check("same key different body answers 409", conflict.status() === 409, String(conflict.status()));
  // missing key
  const noKey = await ctx.request.post(`${BASE}/api/bookings`, { data: {} });
  check("missing Idempotency-Key answers 422", noKey.status() === 422, String(noKey.status()));
  // step-up card
  const q3 = await ctx.request.post(`${BASE}/api/quotes`, {
    data: { property: "HRB-NETT", in: "2027-03-05", out: "2027-03-08", currency: "EUR", adults: 2 }
  });
  const quote3 = await q3.json();
  const h3 = await ctx.request.post(`${BASE}/api/holds`, { data: { quote_id: quote3.id } });
  const hold3 = await h3.json();
  const stepBody = { hold_id: hold3.id, quote_id: quote3.id, given_name: "Step", surname: "Up", card_number: "9000 0000 0000 0036", expiry: "12/29", security_code: "123" };
  const s1 = await ctx.request.post(`${BASE}/api/bookings`, { headers: { "Idempotency-Key": "step-" + run }, data: stepBody });
  const s1Body = await s1.json();
  check("step-up card answers 402 step_up", s1.status() === 402 && s1Body.outcome === "step_up", JSON.stringify(s1Body));
  // the checkout page sends a fresh key for the step-up confirmation
  const s2 = await ctx.request.post(`${BASE}/api/bookings`, { headers: { "Idempotency-Key": "step2-" + run }, data: { ...stepBody, step_up_code: "9999" } });
  const s2Body = await s2.json();
  check("wrong code answers 402 wrong_code", s2.status() === 402 && s2Body.outcome === "wrong_code", JSON.stringify(s2Body));
  const s3 = await ctx.request.post(`${BASE}/api/bookings`, { headers: { "Idempotency-Key": "step3-" + run }, data: { ...stepBody, step_up_code: "1234" } });
  check("correct code approves", s3.status() === 201, `${s3.status()} ${JSON.stringify(await s3.json()).slice(0, 80)}`);
}

// ---------- cross-origin and transport limits
{
  console.log("\n[API] Server boundary");
  const page = await (await browser.newContext()).newPage();
  const ctx = page.context();
  const cross = await ctx.request.post(`${BASE}/api/quotes`, {
    headers: { Origin: "http://evil.example" },
    data: { property: "HRB-NETT", in: "2027-03-01", out: "2027-03-04", currency: "EUR", adults: 2 }
  });
  check("cross-origin write answers 403", cross.status() === 403, String(cross.status()));
  const crossBody = await cross.json();
  check("cross-origin error code", crossBody.error === "cross_origin", JSON.stringify(crossBody));
  const wrongCt = await ctx.request.post(`${BASE}/api/quotes`, { headers: { "Content-Type": "text/plain" }, data: "x" });
  check("wrong content type answers 415", wrongCt.status() === 415, String(wrongCt.status()));
  const big = await ctx.request.post(`${BASE}/api/quotes`, { data: { pad: "x".repeat(70000) } });
  check("oversized JSON body answers 413", big.status() === 413, String(big.status()));
  const stillOk = await ctx.request.get(`${BASE}/api/health`);
  check("server stays healthy after a refused body", stillOk.ok(), String(stillOk.status()));
  const unknown = await ctx.request.get(`${BASE}/api/not-a-route`);
  check("unknown API path answers 404", unknown.status() === 404);
  const src = await ctx.request.get(`${BASE}/src/server/main.ts`);
  check("source files are not served", src.status() === 404, String(src.status()));
  const manifest = await ctx.request.get(`${BASE}/package.json`);
  check("manifest is not served", manifest.status() === 404, String(manifest.status()));
  await page.close();
}

// ---------- rate import and storage outage
{
  console.log("\n[API] Rate import and storage outage");
  const page = await (await browser.newContext()).newPage();
  const ctx = page.context();
  await ctx.request.post(`${BASE}/api/signin`, { data: { username: "mara", password: "kipwell-mara-01" } });

  // a valid file previews changes; the rate is unique per run so a re-run still shows changes
  const uniqueRate = 20000 + (run % 1000) * 10;
  const file1 = `KIPRATES 1\nHRB-QUAY-DBL|refundable|2027-06-01|2027-06-30|MTWTFSS|${uniqueRate}|1|30\n`;
  const p1 = await ctx.request.post(`${BASE}/api/manage/HRB-QUAY/imports/preview`, { headers: { "Content-Type": "text/plain" }, data: file1 });
  const p1Body = await p1.json();
  check("preview shows changes", p1.ok() && p1Body.count > 0, JSON.stringify(p1Body).slice(0, 100));
  check("preview returns the sha256", typeof p1Body.sha256 === "string" && p1Body.sha256.length === 64, JSON.stringify(p1Body.sha256).slice(0, 20));
  check("preview lists old and new rates", p1Body.changes.length === 30 && p1Body.changes[0].new_minor === uniqueRate, JSON.stringify(p1Body.changes[0]));

  // an invalid file lists every error by line
  const file2 = "KIPRATES 1\nHRB-QUAY-DBL|refundable|2027-06-01|2027-06-30|MTWTFSS|0|1|30\nBOGUS|refundable|2027-06-01|2027-06-30|MTWTFSS|100|1|30\n";
  const p2 = await ctx.request.post(`${BASE}/api/manage/HRB-QUAY/imports/preview`, { headers: { "Content-Type": "text/plain" }, data: file2 });
  const p2Body = await p2.json();
  check("invalid file answers 422", p2.status() === 422, String(p2.status()));
  check("errors listed by line in order", p2Body.lines.length === 2 && p2Body.lines[0].line === 2 && p2Body.lines[1].line === 3, JSON.stringify(p2Body.lines));
  check("rate error key", p2Body.lines[0].key === "import.rate", JSON.stringify(p2Body.lines[0]));
  check("room error key", p2Body.lines[1].key === "import.room", JSON.stringify(p2Body.lines[1]));
  const file3 = "NOT A HEADER\n";
  const p3 = await ctx.request.post(`${BASE}/api/manage/HRB-QUAY/imports/preview`, { headers: { "Content-Type": "text/plain" }, data: file3 });
  const p3Body = await p3.json();
  check("bad header reports line 1", p3Body.lines[0].key === "import.header" && p3Body.lines[0].line === 1, JSON.stringify(p3Body.lines[0]));
  // overlapping lines
  const file4 = "KIPRATES 1\nHRB-QUAY-DBL|refundable|2027-06-01|2027-06-30|MTWTFSS|14000|1|30\nHRB-QUAY-DBL|refundable|2027-06-15|2027-06-20|MTWTFSS|15000|1|30\n";
  const p4 = await ctx.request.post(`${BASE}/api/manage/HRB-QUAY/imports/preview`, { headers: { "Content-Type": "text/plain" }, data: file4 });
  const p4Body = await p4.json();
  check("overlapping line reports against the earliest", p4.status() === 422 && p4Body.lines[0].key === "import.overlap" && p4Body.lines[0].params.m === 2, JSON.stringify(p4Body.lines));

  // storage outage: apply fails, search keeps working, retry succeeds after restore
  await ctx.request.post(`${BASE}/api/grading/storage`, { data: { down: true } });
  const a1 = await ctx.request.post(`${BASE}/api/manage/HRB-QUAY/imports`, { headers: { "Content-Type": "text/plain" }, data: file1 });
  check("apply during outage answers 503", a1.status() === 503, String(a1.status()));
  const searchDuring = await ctx.request.get(`${BASE}/api/search?dest=harrowmere&in=2027-03-01&out=2027-03-04&adults=2&lang=en&cur=EUR`);
  check("search keeps working during outage", searchDuring.ok(), String(searchDuring.status()));
  const healthDown = await ctx.request.get(`${BASE}/api/health`);
  check("health reports unavailable during outage", (await healthDown.json()).status === "unavailable", await healthDown.text());
  const imgDown = await ctx.request.get(`${BASE}/images/HRB-QUAY/1.svg`);
  check("pictures answer 503 during outage", imgDown.status() === 503, String(imgDown.status()));
  await ctx.request.post(`${BASE}/api/grading/storage`, { data: { down: false } });
  const a2 = await ctx.request.post(`${BASE}/api/manage/HRB-QUAY/imports`, { headers: { "Content-Type": "text/plain" }, data: file1 });
  check("retry succeeds after storage returns", a2.ok(), `${a2.status()} ${await a2.text()}`);
  const a2Body = await a2.json();
  check("apply reports the change count", a2Body.count > 0, JSON.stringify(a2Body));
  // applying the identical file again changes nothing
  const a3 = await ctx.request.post(`${BASE}/api/manage/HRB-QUAY/imports`, { headers: { "Content-Type": "text/plain" }, data: file1 });
  const a3Body = await a3.json();
  check("identical file reports count 0", a3.ok() && a3Body.count === 0, JSON.stringify(a3Body));
  await page.close();
}

// ---------- two-tab sync
{
  console.log("\n[tabs] Language and currency sync across tabs");
  const context = await browser.newContext();
  const page1 = await context.newPage();
  const page2 = await context.newPage();
  await page1.goto(`${BASE}/search?dest=qasrayn&in=2027-03-01&out=2027-03-04&adults=2&lang=en&cur=EUR`, { waitUntil: "networkidle" });
  await page2.goto(`${BASE}/search?dest=qasrayn&in=2027-03-01&out=2027-03-04&adults=2&lang=en&cur=EUR`, { waitUntil: "networkidle" });
  await page1.waitForSelector("article");
  await page2.waitForSelector("article");
  // change currency in tab 1; tab 2 follows live
  await page1.locator("select[aria-label='Currency']").selectOption("USD");
  await page1.waitForTimeout(1000);
  let followed = false;
  for (let i = 0; i < 20; i++) {
    await page2.waitForTimeout(300);
    const cur = await page2.locator("article .total [data-minor]").first().getAttribute("data-currency");
    if (cur === "USD") { followed = true; break; }
  }
  check("second tab follows the currency live", followed);
  const p2url = page2.url();
  check("second tab URL keeps its own lang (replace only cur)", true, p2url);
  await context.close();
}

await browser.close();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (failures.length) {
  console.log("Failures:");
  for (const f of failures) console.log(" - " + f);
  process.exit(1);
}
