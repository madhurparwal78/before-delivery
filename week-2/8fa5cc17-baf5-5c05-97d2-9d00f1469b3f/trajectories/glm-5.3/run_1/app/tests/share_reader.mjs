// Development test: the share reader surface. Not shipped.
import { chromium } from "playwright-core";

const failures = [];
function check(name, got, want) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures.push(name);
    console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

async function signIn(page) {
  await page.goto("http://localhost:4173/today");
  await page.fill('[aria-label="Email"]', "tamsin@oakgall.test");
  await page.fill('[aria-label="Password"]', "commonplace-1847");
  await page.click('button:has-text("Sign in")');
  await page.waitForTimeout(1800);
}

const browser = await chromium.launch();
const owner = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await signIn(owner);

// create a share link on the seed collection
const link = await owner.evaluate(async () => {
  const session = await (await fetch("/api/session")).json();
  const collections = await (await fetch("/api/collections")).json();
  const cid = collections.collections[0].id;
  const expires = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16);
  const res = await fetch(`/api/collections/${cid}/share-links`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf_token },
    body: JSON.stringify({ expires_at: expires }),
  });
  return (await res.json());
});
check("share link active", link.status, "active");
check("share url form", link.url.startsWith("/s/"), true);

// a share reader opens the link in another browser (no session)
const readerCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const reader = await readerCtx.newPage();
const shareBase = `http://localhost:4173${link.url}`;
await reader.goto(shareBase);
await reader.waitForTimeout(1200);
check("share collection heading", (await reader.textContent("h1")).includes("Advisor reading"), true);
const notes = await reader.textContent('[aria-label="Shared notes"]');
check("chapter notes absent", notes.includes("Chapter three argument"), false);
check("gathered margin present", notes.includes("The Gathered Margin"), true);

// open Florilegium: the quote of the out-of-scope Reading by Lamplight shows the placeholder
const florilegium = await reader.getAttribute('[aria-label="Shared notes"] a:has-text("Florilegium")', "href");
await reader.goto(`http://localhost:4173${florilegium}`);
await reader.waitForTimeout(1000);
const bodyText = await reader.textContent("main");
check("out-of-scope quote placeholder", bodyText.includes("Quoted from a note outside this share."), true);
check("in-scope quote body", bodyText.includes("Every reader keeps two books"), true);
check("out-of-scope backlink absent", (await reader.textContent('[aria-label="Backlinks"]')).includes("Chapter three argument"), false);

// the strict CSP header is sent
const res = await fetch(shareBase);
const csp = res.headers.get("content-security-policy");
check("share csp", csp.includes("default-src 'none'") && csp.includes("frame-ancestors 'none'"), true);
check("share no-store", res.headers.get("cache-control"), "no-store");
check("share referrer", res.headers.get("referrer-policy"), "no-referrer");
check("share nosniff", res.headers.get("x-content-type-options"), "nosniff");

// write methods are refused on the share surface
const put = await fetch(`${shareBase}/api/status`, { method: "POST" });
check("share read-only", put.status, 405);
check("share allow header", put.headers.get("allow"), "GET, HEAD");

// a share token sent to an /api route is not a credential
const apiAttempt = await fetch(`http://localhost:4173/api/collections`);
check("token not a credential", apiAttempt.status, 401);

// revoke: the reader's open page shows the inactive state within the delay
await owner.evaluate(async (linkId) => {
  const session = await (await fetch("/api/session")).json();
  await fetch(`/api/share-links/${linkId}/revoke`, { method: "POST", headers: { "X-CSRF-Token": session.csrf_token } });
}, link.id);
await reader.waitForTimeout(6000);
const readerHeading = await reader.textContent("h1");
check("reader sees inactive", readerHeading.includes("no longer active"), true);
const linkStatus = await reader.textContent('[aria-label="Link status"]');
check("reader link status copy", linkStatus.includes("no longer active"), true);

await browser.close();
console.log(failures.length === 0 ? "\nALL OK" : `\n${failures.length} FAILURES`);
process.exit(failures.length === 0 ? 0 : 1);
