/* Browser smoke test: sign in, board renders, drawer opens, journeys' public controls. */
const { chromium } = require("playwright-core");

const BASE = "http://127.0.0.1:4173";
const results = [];

function check(name, condition, detail = "") {
  results.push({ name, ok: !!condition, detail });
  console.log(`${condition ? "  ok:" : "FAIL:"} ${name} ${detail}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", error => console.log("PAGE ERROR:", error.message));
  page.on("console", message => {
    if (message.type() === "error") console.log("CONSOLE:", message.text());
  });

  await page.goto(BASE, { waitUntil: "networkidle" });
  const signInForm = page.locator('form[aria-label="Sign in"]');
  check("sign-in form", await signInForm.count() === 1);

  await page.fill('input[aria-label="Username"]', "avery.lund");
  await page.fill('input[aria-label="Passcode"]', "saltmarsh-planner-1");
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('[role="grid"]', { timeout: 10000 });

  const banner = await page.locator('[role="banner"]').textContent();
  check("banner shows Tailboard and user", banner.includes("Tailboard") && banner.includes("Avery Lund"));
  check("role label", banner.includes("Compliance planner"));

  const nav = await page.locator('nav[aria-label="Sections"]').textContent();
  check("section links", nav.includes("Board") && nav.includes("Packs")
    && nav.includes("People") && nav.includes("Audit"));

  check("New directive button for planner",
    await page.locator('button:has-text("New directive")').count() === 1);
  check("no Import history for planner",
    await page.locator('button:has-text("Import history")').count() === 0);

  const counts = await page.locator('[aria-label="Fleet counts"]').textContent();
  check("fleet counts region", /Open\s*20/.test(counts) && /Overdue\s*5/.test(counts)
    && /Complied\s*4/.test(counts) && /Deferred\s*1/.test(counts), counts);

  const rail = await page.locator('nav[aria-label="Directives"]').textContent();
  check("rail lists directives", rail.includes("EASA") && rail.includes("2026-0142")
    && rail.includes("UK CAA") && rail.includes("ATR") && rail.includes("Embraer"));
  check("rail shows tags", rail.includes("R1"));

  const cells = await page.locator("[role='gridcell']").count();
  check("grid has cells", cells > 30, String(cells));
  const nonEmpty = await page.locator("[role='gridcell']:not(.empty)").count();
  const glyphs = await page.locator("[role='gridcell'] [role='img']").count();
  check("cells carry glyph img role", glyphs === nonEmpty, `${glyphs}/${nonEmpty}`);
  const meters = await page.locator("[role='gridcell'] meter").count();
  check("cells carry limit meters", meters > 40, String(meters));

  // open a thread drawer by clicking a non-empty cell
  await page.locator("[role='gridcell']:not(.empty)").first().click();
  await page.waitForSelector('[aria-label^="Thread "]', { timeout: 5000 });
  const drawerText = await page.locator("#drawer").textContent();
  check("drawer shows work card region", drawerText.includes("Work card"));
  check("drawer shows sign-off chain", drawerText.includes("Sign-off chain"));
  check("drawer shows revision history", drawerText.includes("Revision history"));
  check("drawer close button", await page.locator('button:has-text("Close thread panel")').count() === 1);

  await page.keyboard.press("Escape");
  check("escape closes drawer", await page.locator("#drawer").isVisible() === false);

  // director header actions menu
  await page.locator('button:has-text("Directive actions")').first().click();
  await page.waitForSelector('[role="menu"]', { timeout: 3000 });
  const menuText = await page.locator('[role="menu"]').textContent();
  check("menu offers Export CSV", menuText.includes("Export CSV"));
  check("menu offers Ingest revision for planner", menuText.includes("Ingest revision"));
  check("menu offers Withdraw for planner", menuText.includes("Withdraw directive"));
  await page.keyboard.press("Escape");

  // new directive dialog fields
  await page.click('button:has-text("New directive")');
  await page.waitForSelector('.dialog[role="dialog"]', { timeout: 3000 });
  for (const label of ["Authority", "Directive number", "Title", "Effective date",
    "Calendar limit in days", "Flight-hours limit", "Method of compliance"]) {
    check(`dialog field ${label}`, await page.locator(`[aria-label="${label}"]`).count() === 1);
  }
  check("applicability group", await page.locator('[role="group"][aria-label="Applicability"]').count() === 1);
  check("document input labelled", await page.locator('input[aria-label="Directive document"]').count() === 1);
  await page.keyboard.press("Escape");

  // packs screen
  await page.click('a:has-text("Packs")');
  await page.waitForSelector('table[aria-label="Compliance packs"]', { timeout: 5000 });
  check("packs table renders", true);
  await page.click('a:has-text("People")');
  await page.waitForSelector('table[aria-label="People"] tbody tr', { timeout: 5000 });
  const peopleText = await page.locator('table[aria-label="People"]').textContent();
  check("people table lists seeded staff", peopleText.includes("Avery Lund")
    && peopleText.includes("Ines Varga") && peopleText.includes("Casey Moreau"));
  check("planner sees no erase buttons",
    await page.locator('button:has-text("Erase")').count() === 0);
  await page.click('a:has-text("Audit")');
  await page.waitForSelector('table[aria-label="Audit trail"]', { timeout: 5000 });
  check("audit table renders", true);

  // back to board, check search
  await page.click('a:has-text("Board")');
  await page.waitForSelector('[role="grid"]', { timeout: 5000 });
  await page.waitForTimeout(400);
  await page.fill('input[aria-label="Search fleet"]', "G-FNAA");
  await page.waitForTimeout(600);
  await page.waitForSelector('[aria-label="Search results"]', { timeout: 5000 });
  const searchResults = await page.locator('[aria-label="Search results"]').textContent();
  check("search finds tail", searchResults.includes("G-FNAA"), searchResults);

  // auditor role read-only check
  await page.click('button:has-text("Sign out")');
  await page.waitForSelector('form[aria-label="Sign in"]', { timeout: 5000 });
  await page.fill('input[aria-label="Username"]', "casey.moreau");
  await page.fill('input[aria-label="Passcode"]', "saltmarsh-audit-1");
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('[role="grid"]', { timeout: 10000 });
  check("auditor has no New directive",
    await page.locator('button:has-text("New directive")').count() === 0);
  check("auditor can view a thread drawer", true);
  await page.locator("[role='gridcell']:not(.empty)").first().click();
  await page.waitForSelector('[aria-label^="Thread "]', { timeout: 5000 });
  const auditorDrawer = await page.locator("#drawer").textContent();
  check("auditor drawer shows no claim button",
    (await page.locator('button:has-text("Claim work card")').count()) === 0);
  check("auditor drawer has close", await page.locator('button:has-text("Close thread panel")').count() === 1);
  await page.keyboard.press("Escape");

  const failed = results.filter(r => !r.ok);
  console.log(`\npassed: ${results.length - failed.length}  failed: ${failed.length}`);
  for (const item of failed) console.log(`  FAILED: ${item.name} ${item.detail}`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch(error => { console.error(error); process.exit(2); });
