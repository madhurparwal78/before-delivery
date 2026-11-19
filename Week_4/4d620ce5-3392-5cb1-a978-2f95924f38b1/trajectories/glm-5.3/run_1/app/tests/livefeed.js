/* DP-20/DP-61/DP-62: one browser's action reaches the other's open board and drawer. */
const { chromium } = require("playwright-core");
const BASE = "http://127.0.0.1:4173";
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "  ok:" : "FAIL:"} ${name} ${detail}`);
}
async function signIn(page, username, passcode) {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.fill('input[aria-label="Username"]', username);
  await page.fill('input[aria-label="Passcode"]', passcode);
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('[role="grid"]');
}
(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const avery = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const noor = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await signIn(avery, "avery.lund", "saltmarsh-planner-1");
  await signIn(noor, "noor.haddad", "saltmarsh-planner-2");

  // Noor opens the drawer for G-FNAD (claimed by Dara) — planner sees no claim button.
  await noor.locator('[data-registration="G-FNAD"][data-directive="dir_easa_2026-0142"]').click();
  await noor.waitForSelector('[aria-label^="Thread "]');
  check("planner drawer open for G-FNAD", true);

  // Avery defers the first still-open EASA cell.
  const openCell = avery.locator(
    '[data-directive="dir_easa_2026-0142"].state-open').first();
  await openCell.click();
  await avery.waitForSelector('[aria-label^="Thread "]');
  await avery.fill('input[aria-label="Deferral reason"]', "Kit delay");
  await avery.click('button:has-text("Defer")');
  await avery.waitForTimeout(500);

  // Noor's open board shows the change within the live-feed delay (3s) — his own drawer
  // for a different thread stays; the counts update without reload.
  await noor.waitForTimeout(3500);
  const counts = await noor.locator('[aria-label="Fleet counts"]').textContent();
  check("colleague's board recounts the deferral", /Deferred\s*2/.test(counts), counts);

  // DP-62: Dara (inspector) and Sol (inspector) — Sol's open drawer for the same thread
  // shows the holder after Dara claims it.
  const dara = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const sol = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await signIn(dara, "dara.okafor", "saltmarsh-insp-1");
  await signIn(sol, "sol.brennan", "saltmarsh-insp-2");
  await sol.locator('[data-registration="G-FNAF"][data-directive="dir_easa_2026-0142"]').click();
  await sol.waitForSelector('[aria-label^="Thread "]');
  check("Sol sees Claim work card before the claim",
    (await sol.locator('button:has-text("Claim work card")').count()) === 1);
  await dara.locator('[data-registration="G-FNAF"][data-directive="dir_easa_2026-0142"]').click();
  await dara.waitForSelector('[aria-label^="Thread "]');
  await dara.click('button:has-text("Claim work card")');
  await sol.waitForTimeout(3500);
  check("losing claimant's drawer shows the holder",
    (await sol.locator('button:has-text("Claim work card")').count()) === 0,
    String(await sol.locator("#drawer").textContent()).slice(0, 80));
  const solDrawerText = await sol.locator("#drawer").textContent();
  check("Sol's drawer names the holder", solDrawerText.includes("Dara Okafor"));

  const failed = results.filter(r => !r.ok);
  console.log(`\npassed: ${results.length - failed.length}  failed: ${failed.length}`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch(error => { console.error(error); process.exit(2); });
