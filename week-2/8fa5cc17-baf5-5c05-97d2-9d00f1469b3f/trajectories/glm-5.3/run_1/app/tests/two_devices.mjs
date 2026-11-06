// Development browser test: two devices, one block. Not shipped.
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

const browser = await chromium.launch();

// device 1: the laptop, device 2: the phone, each with its own session
const laptop = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const phone = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
for (const page of [laptop, phone]) {
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
}

// both sign in and open today
for (const page of [laptop, phone]) {
  await page.goto("http://localhost:4173/today");
  await page.fill('[aria-label="Email"]', "tamsin@oakgall.test");
  await page.fill('[aria-label="Password"]', "commonplace-1847");
  await page.click('button:has-text("Sign in")');
  await page.waitForTimeout(1800);
}
await laptop.click(".add-block");
await laptop.waitForTimeout(800);
await laptop.keyboard.type("Both devices edit this block.");
await laptop.waitForTimeout(1200);

// the phone sees the block within the live delay
await phone.waitForTimeout(2500);
const phoneText = await phone.evaluate(() => {
  const render = [...document.querySelectorAll(".block-render")].map((r) => r.textContent);
  return render.find((t) => (t ?? "").includes("Both devices")) ?? "";
});
check("phone sees the laptop block", phoneText.includes("Both devices edit this block."), true);

// the phone edits the same block near its end while the laptop types near its start
await phone.click(".block-render:has-text(\"Both devices\")");
await phone.waitForTimeout(400);
const phoneBox = phone.locator("textarea.block-input").first();
check("phone textbox", await phoneBox.count(), 1);
await phoneBox.focus();
await phone.evaluate(() => {
  const box = document.querySelector("textarea.block-input");
  box.setSelectionRange(box.value.length, box.value.length);
});
await phone.keyboard.type(" End of the thought.");
await laptop.locator("textarea.block-input").first().focus();
await laptop.evaluate(() => {
  const box = document.querySelector("textarea.block-input");
  box.setSelectionRange(0, 0);
});
await laptop.keyboard.type("Start: ");
await phone.waitForTimeout(2500);
await laptop.waitForTimeout(2500);

const laptopText = await laptop.evaluate(() => {
  const box = document.querySelector("textarea.block-input");
  const render = [...document.querySelectorAll(".block-render")].map((r) => r.textContent).join(" ");
  return (box?.value ?? render).trim();
});
const phoneText2 = await phone.evaluate(() => {
  const box = document.querySelector("textarea.block-input");
  const render = [...document.querySelectorAll(".block-render")].map((r) => r.textContent).join(" ");
  return (box?.value ?? render).trim();
});
check("laptop shows both edits", laptopText.includes("Start: ") && laptopText.includes("End of the thought."), true);
check("phone shows both edits", phoneText2.includes("Start: ") && phoneText2.includes("End of the thought."), true);

// remote carets: the laptop draws the phone's labelled caret
const laptopCaret = await laptop.evaluate(() => {
  const caret = document.querySelector("[data-remote-caret]");
  return caret === null ? null : { label: caret.textContent ?? "" };
});
check("laptop sees a remote caret", laptopCaret !== null, true);

// the sessions list shows both devices
await laptop.goto("http://localhost:4173/settings");
await laptop.waitForTimeout(1200);
const sessions = await laptop.evaluate(() => Array.from(document.querySelectorAll(".session-item span")).map((s) => (s.textContent ?? "").trim()));
check("two sessions listed", sessions.length, 2);
check("current marked", sessions.some((s) => s.includes("This device")), true);

// sign out the phone from the laptop
await laptop.click(".session-item:not(:has-text('This device')) button");
await laptop.waitForTimeout(400);
await laptop.click('.dialog button:has-text("Sign out device")');
await laptop.waitForTimeout(1200);
const sessionsAfter = await laptop.evaluate(() => Array.from(document.querySelectorAll(".session-item span")).map((s) => (s.textContent ?? "").trim()));
check("one session left", sessionsAfter.length, 1);

// the phone's open page went to sign-in
await phone.waitForTimeout(3000);
check("phone signed out", phone.url().includes("/sign-in"), true);
const phoneAlert = await phone.textContent('[role="alert"]').catch(() => "");
check("phone signed-out copy", (phoneAlert ?? "").includes("signed out on this device"), true);

await browser.close();
console.log(failures.length === 0 ? "\nALL OK" : `\n${failures.length} FAILURES`);
process.exit(failures.length === 0 ? 0 : 1);
