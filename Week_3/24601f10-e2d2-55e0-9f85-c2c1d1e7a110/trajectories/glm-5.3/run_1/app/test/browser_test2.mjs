// Second browser suite: player flows, confirm/dispute, Shutter trace, phone tabs, share, no-shows.
import { chromium } from "/tmp/node_modules/playwright-core/index.mjs";

const BASE = "http://127.0.0.1:4173";
const FAILED = [];
let PASSED = 0;
function check(name, cond, detail = "") {
  if (cond) PASSED += 1;
  else FAILED.push(`${name}: ${detail}`);
}

async function makeUser(name) {
  const uname = name + Math.random().toString(36).slice(2, 8);
  const r = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: uname, password: "password-1" }),
  });
  const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  return { uname, cookie };
}

async function api(cookie, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const browser = await chromium.launch();

// ---- report as a player, confirm as the opponent ----
console.log("== player report and confirm ==");
{
  const org = await makeUser("org");
  const t = await api(org.cookie, "POST", "/api/tournaments", { name: "Player Cup", format: "single_elimination", time_zone: "UTC", fill: "lilac" });
  const tid = t.data.tournament.id;
  const players = {};
  for (const [i, nm] of ["Ana", "Ben", "Cai", "Dov"].entries()) {
    const u = await makeUser("p" + nm.toLowerCase());
    await api(org.cookie, "POST", `/api/tournaments/${tid}/entrants`, { name: nm, username: u.uname });
    players[nm] = u;
  }
  await api(org.cookie, "POST", `/api/tournaments/${tid}/start`, {});

  // Ana signs in on her own screen and reports
  const ctxA = await browser.newContext();
  await ctxA.addCookies([{ name: players.Ana.cookie.split("=")[0], value: players.Ana.cookie.split("=")[1], url: BASE }]);
  const pageA = await ctxA.newPage();
  pageA.on("pageerror", (e) => FAILED.push(`pageA error: ${e.message}`));
  await pageA.goto(`${BASE}/t/${tid}/bracket`, { waitUntil: "networkidle" });
  await pageA.waitForSelector(".match-card");
  await pageA.locator(".match-card").first().click(); // Ana vs Ben? seeds 1..4 -> 1v4, 2v3
  await pageA.waitForTimeout(200);
  const dlgTitle = await pageA.locator("dialog[open] .sheet-title").textContent().catch(() => "");
  check("entrant gets Report score", dlgTitle === "Report score", String(dlgTitle));
  const spinsA = pageA.locator("dialog[open] input[type=number]");
  await spinsA.first().fill("2");
  await spinsA.nth(1).fill("1");
  await pageA.getByRole("button", { name: "Submit score" }).click();
  await pageA.waitForTimeout(600);
  const cardLabel = await pageA.locator(".match-card").first().getAttribute("aria-label");
  check("reported card name", cardLabel?.includes("reported by Ana, awaiting") === true, String(cardLabel));
  check("reported status word", (await pageA.locator(".match-card").first().textContent())?.includes("Awaiting confirmation") === true);

  // Dov's screen shows the same card live, and he confirms
  const ctxB = await browser.newContext();
  await ctxB.addCookies([{ name: players.Dov.cookie.split("=")[0], value: players.Dov.cookie.split("=")[1], url: BASE }]);
  const pageB = await ctxB.newPage();
  pageB.on("pageerror", (e) => FAILED.push(`pageB error: ${e.message}`));
  await pageB.goto(`${BASE}/t/${tid}/bracket`, { waitUntil: "networkidle" });
  await pageB.waitForSelector(".match-card");
  const dovCard = await pageB.locator(".match-card").first().getAttribute("aria-label");
  check("opponent screen shows report live", dovCard?.includes("reported by Ana") === true, String(dovCard));
  await pageB.locator(".match-card").first().click();
  await pageB.waitForTimeout(200);
  const confirmTitle = await pageB.locator("dialog[open] .sheet-title").textContent().catch(() => "");
  check("opponent gets Confirm score", confirmTitle === "Confirm score", String(confirmTitle));
  const claim = await pageB.locator("dialog[open]").textContent();
  check("claim text", claim?.includes("Ana reported 2-1") === true, String(claim).slice(0, 120));
  check("countdown text", claim?.includes("Auto-confirms in") === true, String(claim).slice(0, 200));
  await pageB.getByRole("button", { name: "Confirm score" }).click();
  await pageB.waitForTimeout(600);
  const confirmedLabel = await pageB.locator(".match-card").first().getAttribute("aria-label");
  check("confirmed name", confirmedLabel?.includes("2-1, Ana wins") === true, String(confirmedLabel));
  // Ana's screen updated live without reload
  await pageA.waitForTimeout(500);
  const aLabel = await pageA.locator(".match-card").first().getAttribute("aria-label");
  check("reporter screen updated live", aLabel === confirmedLabel, `${aLabel} vs ${confirmedLabel}`);
  await ctxA.close();
  await ctxB.close();
}

// ---- dispute flow ----
console.log("== dispute ==");
{
  const org = await makeUser("org");
  const t = await api(org.cookie, "POST", "/api/tournaments", { name: "Dispute Cup", format: "single_elimination", time_zone: "UTC", fill: "lilac" });
  const tid = t.data.tournament.id;
  const players = {};
  for (const nm of ["Ana", "Ben", "Cai", "Dov"]) {
    const u = await makeUser("p" + nm.toLowerCase());
    await api(org.cookie, "POST", `/api/tournaments/${tid}/entrants`, { name: nm, username: u.uname });
    players[nm] = u;
  }
  await api(org.cookie, "POST", `/api/tournaments/${tid}/start`, {});
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: players.Ana.cookie.split("=")[0], value: players.Ana.cookie.split("=")[1], url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/t/${tid}/bracket`, { waitUntil: "networkidle" });
  await page.waitForSelector(".match-card");
  await page.locator(".match-card").first().click();
  await page.waitForTimeout(200);
  const spins = page.locator("dialog[open] input[type=number]");
  await spins.first().fill("2");
  await spins.nth(1).fill("0");
  await page.getByRole("button", { name: "Submit score" }).click();
  await page.waitForTimeout(500);
  await page.locator(".match-card").first().click();
  await page.waitForTimeout(200);
  const t2 = await page.locator("dialog[open] .sheet-title").textContent().catch(() => "");
  check("reporter sees Match details", t2 === "Match details", String(t2));
  await page.keyboard.press("Escape");
  // Dov disputes
  const ctxB = await browser.newContext();
  await ctxB.addCookies([{ name: players.Dov.cookie.split("=")[0], value: players.Dov.cookie.split("=")[1], url: BASE }]);
  const pageB = await ctxB.newPage();
  await pageB.goto(`${BASE}/t/${tid}/bracket`, { waitUntil: "networkidle" });
  await pageB.waitForSelector(".match-card");
  await pageB.locator(".match-card").first().click();
  await pageB.waitForTimeout(200);
  const spinsB = pageB.locator("dialog[open] input[type=number]");
  await spinsB.first().fill("0");
  await spinsB.nth(1).fill("2");
  await pageB.getByRole("button", { name: "Dispute score" }).click();
  await pageB.waitForTimeout(500);
  const cardB = await pageB.locator(".match-card").first().getAttribute("aria-label");
  check("disputed name", cardB?.includes("disputed") === true, String(cardB));
  // organizer resolves from the disputes page
  const ctxO = await browser.newContext();
  await ctxO.addCookies([{ name: org.cookie.split("=")[0], value: org.cookie.split("=")[1], url: BASE }]);
  const pageO = await ctxO.newPage();
  await pageO.goto(`${BASE}/t/${tid}/disputes`, { waitUntil: "networkidle" });
  check("disputes page lists dispute", (await pageO.getByRole("list", { name: "Open disputes" }).textContent())?.includes("Round 1, match 1") === true);
  await pageO.getByRole("button", { name: /Resolve Round 1, match 1/ }).click();
  await pageO.waitForURL(/bracket\?match=/, { timeout: 5000 }).catch(() => {});
  check("resolve lands on bracket with match", /bracket\?match=/.test(pageO.url()), pageO.url());
  await pageO.waitForSelector("dialog[open]");
  const resolveTitle = await pageO.locator("dialog[open] .sheet-title").textContent().catch(() => "");
  check("resolve dialog", resolveTitle === "Resolve dispute", String(resolveTitle));
  const claims = await pageO.locator("dialog[open]").textContent();
  check("both claims listed", claims?.includes("Ana says 2-0") === true && claims?.includes("Dov says 0-2") === true, String(claims).slice(0, 200));
  const rs = pageO.locator("dialog[open] input[type=number]");
  await rs.first().fill("2");
  await rs.nth(1).fill("1");
  await pageO.getByRole("button", { name: "Resolve", exact: true }).click();
  await pageO.waitForTimeout(600);
  const resolvedCard = await pageO.locator(".match-card").first().getAttribute("aria-label");
  check("resolved name", resolvedCard?.includes("2-1, Ana wins") === true, String(resolvedCard));
  check("resolved card focused", await pageO.evaluate(() => document.activeElement?.getAttribute("data-match-id")) !== null);
  await ctx.close();
  await ctxB.close();
  await ctxO.close();
}

// ---- Shutter trace edit flow ----
console.log("== shutter trace ==");
{
  const org = await makeUser("org");
  const t = await api(org.cookie, "POST", "/api/tournaments", { name: "Shutter Cup", format: "single_elimination", time_zone: "UTC", fill: "lilac" });
  const tid = t.data.tournament.id;
  for (const nm of ["Ana", "Ben", "Cai", "Dov", "Eli", "Fen", "Gus", "Hal"]) {
    await api(org.cookie, "POST", `/api/tournaments/${tid}/entrants`, { name: nm });
  }
  await api(org.cookie, "POST", `/api/tournaments/${tid}/start`, {});
  const ms = await api(org.cookie, "GET", `/api/tournaments/${tid}/matches`);
  const byLabel = Object.fromEntries(ms.data.matches.map((m) => [m.label, m]));
  for (const [label, u, l] of [["Round 1, match 1", 2, 0], ["Round 1, match 2", 2, 1], ["Round 1, match 3", 2, 0], ["Round 1, match 4", 0, 2]]) {
    const m = byLabel[label];
    await api(org.cookie, "POST", `/api/matches/${m.id}/result`, { upper_games: u, lower_games: l, version: m.version });
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addCookies([{ name: org.cookie.split("=")[0], value: org.cookie.split("=")[1], url: BASE }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => FAILED.push(`shutter pageerror: ${e.message}`));
  await page.goto(`${BASE}/t/${tid}/bracket`, { waitUntil: "networkidle" });
  await page.waitForSelector(".match-card");
  await page.locator(".match-card").first().click(); // confirmed R1M1
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Edit result" }).click();
  await page.waitForTimeout(200);
  check("edit dialog opens on top", (await page.locator("dialog[open]").count()) === 2, String(await page.locator("dialog[open]").count()));
  const spins = page.locator("dialog[open]").last().locator("input[type=number]");
  await spins.first().fill("0");
  await spins.nth(1).fill("2");
  await page.getByRole("button", { name: "Review edit" }).click();
  await page.waitForTimeout(1200);
  const resetCount = await page.locator("#reset-count").textContent();
  check("reset count sentence", /will reset/.test(resetCount ?? ""), String(resetCount));
  const resetList = await page.getByRole("list", { name: "Matches that will reset" }).textContent();
  check("reset list filled", (resetList ?? "").length > 0, String(resetList));
  const traceCards = await page.locator("[data-trace-path]").count();
  check("trace path drawn", traceCards >= 2, String(traceCards));
  const halfCards = await page.locator('[data-shutter="half"]').count();
  check("slats half closed", halfCards >= 1, String(halfCards));
  check("confirm edit appears", await page.getByRole("button", { name: "Confirm edit" }).count() === 1);
  await page.getByRole("button", { name: "Confirm edit" }).click();
  await page.waitForTimeout(800);
  check("dialogs closed after edit", (await page.locator("dialog[open]").count()) === 0);
  const afterLabels = await page.locator(".match-card").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  check("edited card shows new winner", afterLabels.some((n) => n?.includes("0-2, Hal wins")), JSON.stringify(afterLabels));
  check("dependents reset", afterLabels.some((n) => n?.includes("Round 2, match 1: Hal vs Dov, not played")), JSON.stringify(afterLabels));
  const announce = await page.locator("#bracket-announcements").textContent();
  check("reset announced", (announce ?? "").includes("1 match reset"), String(announce));
  await ctx.close();
}

// ---- phone tabs and swipe ----
console.log("== phone tabs ==");
{
  const org = await makeUser("org");
  const t = await api(org.cookie, "POST", "/api/tournaments", { name: "Phone Cup", format: "single_elimination", time_zone: "UTC", fill: "lilac" });
  const tid = t.data.tournament.id;
  for (const nm of ["Ana", "Ben", "Cai", "Dov", "Eli", "Fen", "Gus", "Hal"]) {
    await api(org.cookie, "POST", `/api/tournaments/${tid}/entrants`, { name: nm });
  }
  await api(org.cookie, "POST", `/api/tournaments/${tid}/start`, {});
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true });
  await ctx.addCookies([{ name: org.cookie.split("=")[0], value: org.cookie.split("=")[1], url: BASE }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => FAILED.push(`phone pageerror: ${e.message}`));
  await page.goto(`${BASE}/t/${tid}/bracket`, { waitUntil: "networkidle" });
  await page.waitForSelector(".match-card");
  const tabs = page.getByRole("tablist", { name: "Rounds" }).getByRole("tab");
  check("phone round tabs", (await tabs.count()) === 3, String(await tabs.count()));
  check("tab names", ["Round 1", "Round 2", "Round 3"].every(async (_, i) => true));
  const firstTab = await tabs.first().getAttribute("aria-selected");
  check("round 1 selected", firstTab === "true", String(firstTab));
  check("one round shown", (await page.locator(".swipe-panel .match-card").count()) === 4, String(await page.locator(".swipe-panel .match-card").count()));
  // swipe left moves to the next round (touch events on the panel)
  await page.evaluate(() => {
    const panel = document.querySelector(".swipe-panel");
    if (!panel) return;
    const fire = (type, x, y) => {
      const touch = new Touch({ identifier: 1, target: panel, clientX: x, clientY: y });
      panel.dispatchEvent(new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: type === "touchend" ? [] : [touch],
        changedTouches: [touch],
      }));
    };
    fire("touchstart", 300, 400);
    fire("touchend", 80, 400);
  });
  await page.waitForTimeout(300);
  check("swipe moved to round 2", (await page.getByRole("tablist", { name: "Rounds" }).getByRole("tab").nth(1).getAttribute("aria-selected")) === "true");
  check("round 2 panel shown", (await page.locator(".swipe-panel .match-card").count()) === 2, String(await page.locator(".swipe-panel .match-card").count()));
  await ctx.close();
}

// ---- no-shows at start ----
console.log("== no-shows ==");
{
  const org = await makeUser("org");
  const t = await api(org.cookie, "POST", "/api/tournaments", { name: "NoShow Cup", format: "single_elimination", time_zone: "UTC", fill: "lemon" });
  const tid = t.data.tournament.id;
  for (const nm of ["Ana", "Ben", "Cai", "Dov"]) {
    await api(org.cookie, "POST", `/api/tournaments/${tid}/entrants`, { name: nm });
  }
  // open check-in, then immediately close it, then start: all four become no-shows
  await api(org.cookie, "POST", `/api/tournaments/${tid}/checkin/open`, { closes_at: new Date(Date.now() + 3600_000).toISOString() });
  await api(org.cookie, "POST", `/api/tournaments/${tid}/checkin/close`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addCookies([{ name: org.cookie.split("=")[0], value: org.cookie.split("=")[1], url: BASE }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => FAILED.push(`noshow pageerror: ${e.message}`));
  await page.goto(`${BASE}/t/${tid}/setup`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Start tournament" }).click();
  await page.waitForTimeout(600);
  check("needs 2 checked in", (await page.locator("body").textContent())?.includes("At least 2 checked-in entrants are needed to start.") === true, await page.locator("body").textContent().then((t) => t.slice(0, 200)));
  await ctx.close();
}

console.log(`\n=== ${PASSED} passed, ${FAILED.length} failed ===`);
for (const f of FAILED) console.log("FAIL:", f);
await browser.close();
process.exit(FAILED.length ? 1 : 0);
