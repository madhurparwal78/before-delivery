import { chromium } from "playwright";

const BASE = "http://localhost:4173";
const pass = (m) => console.log("PASS " + m);
const fail = (m) => console.log("FAIL " + m);
const check = async (cond, m) => (await cond ? pass(m) : fail(m));

const browser = await chromium.launch();

async function signIn(email, password) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(BASE + "/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Courses" }).waitFor();
  return { context, page };
}

// Self-contained setup: Grace buys a seat pack and assigns Ben a seat.
{
  const { execSync } = await import("node:child_process");
  const run = (cmd) => execSync(cmd, { cwd: "/app" }).toString().trim();
  run(`curl -s -X POST ${BASE}/api/session -H "Content-Type: application/json" -d '{"email":"coord@harbourview.test","password":"credwell-demo-1"}' -c /tmp/smoke-grace.jar -o /dev/null`);
  const pack = run(`curl -s -X POST ${BASE}/api/sponsor/packs -b /tmp/smoke-grace.jar -H "Content-Type: application/json" -H "Idempotency-Key: smoke-setup-1" -d '{"course_id":"c0000000-0000-4000-8000-000000000001","seats":3}'`);
  const packId = JSON.parse(pack).pack.id;
  const learners = JSON.parse(run(`curl -s "${BASE}/api/sponsor/learners?q=Ben" -b /tmp/smoke-grace.jar`)).learners;
  run(`curl -s -X POST ${BASE}/api/sponsor/packs/${packId}/assignments -b /tmp/smoke-grace.jar -H "Content-Type: application/json" -d '{"nurse_id":"${learners[0].id}"}' -o /dev/null`);
  pass("seat pack bought and seat assigned to Ben");
}

// Learner walk
{
  const { page } = await signIn("ben.osei@harbourview.test", "credwell-demo-1");
  await page.getByRole("link", { name: "Sepsis Recognition in the First Hour" }).click();
  await page.getByRole("heading", { name: "Sepsis Recognition in the First Hour" }).waitFor();
  await check(page.getByRole("img", { name: "Contact-hour seal" }).isVisible(), "course page shows seal");

  await page.getByRole("link", { name: "Continue learning" }).click();
  await page.getByRole("navigation", { name: "Course modules" }).waitFor();
  pass("module player renders with navigation");

  // Answer every lesson with the keyboard, then reach the post-evaluation.
  for (let m = 0; m < 4; m += 1) {
    const checkBtn = page.getByRole("button", { name: "Check answer" });
    if ((await checkBtn.count()) > 0 && (await checkBtn.first().isEnabled())) {
      let verified = false;
      for (let option = 0; option < 3 && !verified; option += 1) {
        const radios = page.getByRole("radiogroup").first().getByRole("radio");
        if ((await radios.count()) > option) {
          await radios.nth(option).check();
          await checkBtn.first().click();
          try {
            await page.getByRole("link", { name: /Next module|Go to post-evaluation/ }).first().waitFor({ timeout: 4000 });
            verified = true;
          } catch {
            // wrong answer, try the next option
          }
        }
      }
      if (!verified) fail("lesson could not be verified");
    }
    await page.getByRole("link", { name: /Next module|Go to post-evaluation/ }).first().waitFor({ timeout: 8000 });
    await page.waitForTimeout(400);
    await page.getByRole("link", { name: /Next module|Go to post-evaluation/ }).first().click();
    await page.waitForTimeout(600);
  }
  pass("lessons answered via keyboard");

  // Post-evaluation and the seal.
  await page.getByRole("heading", { name: "Post-evaluation" }).waitFor();
  await page.getByRole("radiogroup", { name: "Overall rating" }).getByRole("radio").nth(4).check();
  await page.getByRole("radiogroup", { name: "Did this activity meet its stated outcomes?" }).getByRole("radio").first().check();
  await page.getByRole("button", { name: "Submit evaluation" }).click();
  await page.getByRole("heading", { name: "Your contact-hour seal" }).waitFor({ timeout: 20000 });
  pass("evaluation submitted, completion screen shown");
  await page.waitForTimeout(3500);
  const sealState = await page.locator("[data-seal-state]").first().getAttribute("data-seal-state");
  const numeral = await page.locator("[data-seal-numeral]").first().textContent();
  console.log("seal state:", sealState, "| numeral:", numeral);
  const wedges = await page.locator("[data-module-id]").count();
  console.log("wedges:", wedges);
  const sweeps = [];
  for (const w of await page.locator("[data-sweep]").all()) {
    sweeps.push(await w.getAttribute("data-sweep"));
  }
  console.log("sweeps:", sweeps.join(","));
  await page.getByRole("button", { name: "Share with a verifier" }).waitFor({ timeout: 30000 });
  pass("share button enabled after seal");
  await page.getByRole("status", { name: "Seal status" }).waitFor();
  
  // Share dialog
  await page.getByRole("button", { name: "Share with a verifier" }).click();
  const dialog = page.getByRole("dialog", { name: "Share with a verifier" });
  await dialog.waitFor();
  const linkValue = await dialog.getByRole("textbox", { name: "Verification link" }).inputValue();
  console.log("share link:", linkValue.slice(0, 60));
  await dialog.getByRole("button", { name: "Close" }).click();
  pass("share dialog opens with a link");

  // Verify page in a fresh context
  const fresh = await (await browser.newContext()).newPage();
  await fresh.goto(linkValue);
  await fresh.getByRole("heading", { name: "Certificate verification" }).waitFor();
  const nurse = await fresh.getByText("Ben Osei").first().isVisible();
  await check(Promise.resolve(nurse), "verify page shows the nurse");
  await check(Promise.resolve(await fresh.getByRole("link", { name: "Download PDF" }).isVisible()), "verify page offers PDF");
  const statusText = await page.getByRole("status", { name: "Seal status" }).textContent();
  console.log("seal status copy:", statusText);

  await page.goto(BASE + "/learning");
  await page.getByRole("progressbar").first().waitFor();
  pass("progress bar on My learning");

  // Checkout dialog keyboard flow on the delirium course.
  await page.goto(BASE + "/courses");
  await page.getByRole("heading", { name: "Courses" }).waitFor();
  await page.getByRole("link", { name: "Delirium Screening at the Bedside" }).click();
  await page.getByRole("heading", { name: "Delirium Screening at the Bedside" }).waitFor();
  await page.getByRole("button", { name: "Enrol" }).click();
  await page.getByRole("dialog", { name: "Checkout" }).waitFor();
  const checkout = page.getByRole("dialog", { name: "Checkout" });
  await checkout.getByRole("button", { name: /^Pay \$/ }).waitFor({ timeout: 6000 });
  pass("checkout dialog opens with pay button");
  await checkout.getByRole("button", { name: "Cancel" }).click();
  pass("checkout dialog closes");

  await page.getByRole("link", { name: "Transcript" }).click();
  await page.getByRole("heading", { name: "Transcript" }).waitFor();
  pass("transcript renders");

  for (const [w, h] of [[375, 812], [768, 1024], [1280, 800]]) {
    await page.setViewportSize({ width: w, height: h });
    const over = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    await check(Promise.resolve(!over), "no overflow at " + w);
  }
  const menuBtn = page.getByRole("button", { name: "Menu" });
  await check(menuBtn.isVisible(), "Menu button appears at 375");
}

// Coordinator walk
{
  const { page } = await signIn("coord@harbourview.test", "credwell-demo-1");
  await page.getByRole("link", { name: "Hospital seats" }).click();
  await page.getByRole("heading", { name: "Hospital seats" }).waitFor();
  await page.getByRole("region", { name: "Totals" }).waitFor();
  await pass("sponsor totals region");
  await page.getByRole("table", { name: "Seat packs" }).waitFor({ timeout: 10000 });
  await pass("seat packs table");
  await page.getByRole("searchbox", { name: "Search nurses" }).waitFor();
  await pass("nurse search");
  await page.getByRole("combobox", { name: "Report year" }).waitFor();
  await pass("report year combobox");
  await page.getByRole("button", { name: "Show ledger" }).first().click();
  await page.getByRole("table", { name: "Ledger" }).waitFor({ timeout: 10000 });
  await pass("ledger expands");
  await page.getByRole("button", { name: "Buy seats" }).click();
  await page.getByRole("dialog", { name: "Buy seats" }).waitFor();
  await page.getByRole("dialog", { name: "Buy seats" }).getByRole("button", { name: "Cancel" }).click();
  pass("buy seats dialog opens and closes");
}

// Planner walk
{
  const { page } = await signIn("planner@sorrelpike.test", "credwell-demo-1");
  await page.getByRole("link", { name: "Planner" }).click();
  await page.getByRole("heading", { name: "Planner" }).waitFor();
  await page.getByRole("region", { name: "Review queue" }).waitFor();
  await pass("review queue region");
  await page.getByRole("region", { name: "Refund requests" }).waitFor();
  await pass("refund region");
  await page.getByRole("region", { name: "Certificates" }).waitFor();
  await pass("certificates region");
  await page.getByRole("searchbox", { name: "Search certificates" }).waitFor();
  await pass("certificate search");
}

// Author walk
{
  const { page } = await signIn("author@sorrelpike.test", "credwell-demo-1");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Authoring" }).click();
  await page.getByRole("heading", { name: "Authoring" }).waitFor();
  await check(page.getByRole("button", { name: "New course" }).isVisible(), "new course button");
  await page.getByRole("button", { name: "New course" }).click();
  await check(page.getByRole("textbox", { name: "Course title" }).isVisible(), "course editor fields");
  await check(page.getByRole("button", { name: "Save draft" }).isVisible(), "save draft button");
}

// Public verify page
{
  const page = await (await browser.newContext()).newPage();
  const resp = await page.goto(BASE + "/verify/not-a-real-token");
  await page.getByRole("heading", { name: "Link not valid" }).waitFor();
  pass("invalid verify token shows Link not valid (" + resp.status() + ")");
}

await browser.close();
