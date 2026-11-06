/**
 * Journey checks in the browser: keyboard checkout, the card journey, the
 * light-pool room, live collaboration, quote shares, trade approval and the admin
 * day. Needs a freshly reset database and a built, running app.
 */

import { chromium } from "/tmp/node_modules/playwright/index.mjs";

const BASE = process.env.LF_BASE ?? "http://127.0.0.1:4173";
const MAILPIT = process.env.MAILPIT_URL ?? "http://mailpit:8025";
const DESKTOP = { width: 1280, height: 800 };

let passed = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) passed += 1;
  else failures.push(`${name}${detail === undefined ? "" : ` -> ${JSON.stringify(detail)}`}`);
};
const eq = (name, actual, expected) => {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, same, same ? undefined : { actual, expected });
};

async function signIn(page, email, password) {
  await page.goto(`${BASE}/signin`);
  const main = page.locator("main");
  await main.getByRole("textbox", { name: "Email" }).fill(email);
  await main.getByRole("textbox", { name: "Password" }).fill(password);
  await main.getByRole("button", { name: "Sign in" }).click();
  await page.waitForFunction(() => !location.pathname.startsWith("/signin"), null, { timeout: 8000 });
}

const mail = async (subjectPart) => {
  const { messages } = await (await fetch(`${MAILPIT}/api/v1/messages?limit=200`)).json();
  return messages.filter((m) => m.Subject.includes(subjectPart));
};

/** Tabs until the named control has focus, so keyboard-only reach is proven. */
async function tabTo(page, label, limit = 45) {
  for (let i = 0; i < limit; i += 1) {
    const current = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      return {
        text: (el.textContent ?? "").trim(),
        label: el.getAttribute("aria-label") ?? "",
        id: el.id,
        tag: el.tagName,
        outline: getComputedStyle(el).outlineStyle,
        outlineWidth: getComputedStyle(el).outlineWidth,
      };
    });
    if (current && (current.text === label || current.label === label || current.id === label)) return current;
    await page.keyboard.press("Tab");
  }
  return null;
}

async function run() {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
  const browser = await chromium.launch();

  /* ---------- DP-12, DP-13: the retail card journey, keyboard only ---------- */
  {
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    await signIn(page, "jo@bennett-home.test", "Retail-buyer-2026");

    // Add two units of a fitting.
    await page.goto(`${BASE}/products/kauri-downlight`);
    await page.waitForSelector('[aria-label="Specification"]');
    await page.getByRole("spinbutton", { name: "Quantity" }).fill("2");
    await page.getByRole("button", { name: "Add to cart" }).click();
    await page.waitForTimeout(700);
    eq(
      "adding announces the cart total",
      await page.getByRole("status", { name: "Product updates" }).textContent(),
      "Added 2 to cart. Cart total $178.00 + GST.",
    );

    // DP-07: the cart shows one 15% GST line and the labelled totals.
    await page.goto(`${BASE}/cart`);
    await page.waitForSelector('table[aria-label="Cart"]');
    const totals = await page.locator(".totals").innerText();
    check("the cart labels the subtotal without GST", totals.includes("Subtotal (excl. GST)"), totals);
    check("one 15% GST line", totals.includes("GST (15%)"), totals);
    check("the total includes GST", totals.includes("Total (incl. GST)"), totals);
    check("subtotal figure", totals.includes("$178.00"), totals);
    check("gst figure", totals.includes("$26.70"), totals);
    check("total figure", totals.includes("$204.70"), totals);
    eq("a quantity box per line", await page.getByRole("spinbutton", { name: "Quantity for KDL-WH-36-3000" }).count(), 1);
    eq("a remove button per line", await page.getByRole("button", { name: "Remove KDL-WH-36-3000" }).count(), 1);

    // DP-12: reach checkout and pay using only the keyboard.
    await page.getByRole("link", { name: "Checkout" }).focus();
    await page.keyboard.press("Enter");
    await page.waitForSelector('form[aria-label="Checkout"]');
    eq("the pay button carries the total", await page.getByRole("button", { name: /^Pay \$/ }).textContent(), "Pay $204.70");

    await page.keyboard.press("Tab");
    const nameField = await tabTo(page, "co-name");
    check("the delivery name is reachable by keyboard", nameField !== null, nameField);
    check("and shows a visible focus ring", nameField && nameField.outlineStyle !== "none", nameField);

    const type = async (id, value) => {
      const field = await tabTo(page, id);
      check(`${id} is reachable by keyboard`, field !== null, field);
      await page.keyboard.type(value);
    };
    await type("co-name", "Jo Bennett");
    await type("co-address", "12 Papanui Road");
    await type("co-city", "Christchurch");
    await type("co-postcode", "8014");
    // The decline test card first.
    await type("co-number", "4000 0000 0000 0002");
    await type("co-expiry", "04/30");
    await type("co-cvc", "123");
    await type("co-cardname", "J Bennett");

    const payButton = await tabTo(page, "Pay $204.70");
    check("the pay button is reachable by keyboard", payButton !== null, payButton);
    check("the pay button shows a focus ring", payButton && payButton.outlineStyle !== "none", payButton);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);

    // DP-10: the published decline copy.
    const alert = page.getByRole("alert");
    eq("declined heading", await alert.getByRole("heading", { level: 2 }).textContent(), "Card declined");
    eq(
      "declined body",
      await alert.locator("p").textContent(),
      "Your bank declined this card. No money has been taken. Try another card or contact your bank.",
    );
    check("the buyer stays on the same checkout", page.url().includes("/checkout"), page.url());

    // Pay again with the approval card from the same checkout.
    await page.getByLabel("Card number").fill("4242 4242 4242 4242");
    await page.getByRole("button", { name: /^Pay \$/ }).click();
    await page.waitForFunction(() => location.pathname.startsWith("/orders/"), null, { timeout: 15000 });

    const orderKey = page.url().split("/orders/")[1];
    await page.waitForFunction(() => (document.querySelector("main h1")?.textContent ?? "") !== "", null, { timeout: 8000 });
    eq("the confirmed order heading", await page.getByRole("heading", { level: 1 }).textContent(), "Order confirmed");
    eq(
      "the confirmed order body",
      await page.locator("main p").first().textContent(),
      `Order ${orderKey} is confirmed. A receipt is on its way to jo@bennett-home.test.`,
    );

    // DP-11: one receipt with the GST line.
    let receipts = [];
    for (let i = 0; i < 20; i += 1) {
      receipts = await mail(`Your Lightfall order ${orderKey}`);
      if (receipts.length > 0) break;
      await page.waitForTimeout(400);
    }
    eq("one receipt email", receipts.length, 1);
    const receipt = await (await fetch(`${MAILPIT}/api/v1/message/${receipts[0].ID}`)).json();
    for (const needle of ["KDL-WH-36-3000 x 2", "GST (15%)", "$26.70", "Total (incl. GST)", "$204.70"]) {
      check(`the receipt shows ${needle}`, receipt.Text.includes(needle), receipt.Text);
    }
    await context.close();
  }

  /* ---------- DP-29, DP-32..DP-35: the light-pool room ---------- */
  {
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    await signIn(page, "rangi@kowhai-electrical.test", "Trade-approved-2026");

    await page.goto(`${BASE}/projects`);
    await page.waitForSelector("article.card");
    eq("the trade buyer sees the Projects link", await page.getByRole("link", { name: "Projects" }).count(), 1);
    await page.getByRole("link", { name: "Ponsonby Kitchen" }).click();
    await page.waitForSelector('[aria-label="Light-pool room"]');

    eq("the room is a region", await page.getByRole("region", { name: "Light-pool room" }).count(), 1);
    eq("the room 3D view is an image", await page.getByRole("img", { name: "Room 3D view" }).count(), 1);
    eq("the light-pools table", await page.getByRole("table", { name: "Light pools" }).count(), 1);
    eq("the unplaced list", await page.getByRole("list", { name: "Unplaced fittings" }).count(), 1);
    eq("the ceiling slider", await page.getByRole("slider", { name: "Ceiling height" }).count(), 1);

    // The canvas never takes focus.
    eq("the canvas is not focusable", await page.getByRole("img", { name: "Room 3D view" }).getAttribute("tabindex"), null);

    const slider = page.getByRole("slider", { name: "Ceiling height" });
    eq("the slider range", [await slider.getAttribute("min"), await slider.getAttribute("max"), await slider.getAttribute("step")], ["2400", "4000", "100"]);
    eq("the slider value text", await slider.getAttribute("aria-valuetext"), "2.7 m");

    // DP-29: set the ceiling to 3.0 m.
    await slider.fill("3000");
    await page.waitForTimeout(900);
    eq("the ceiling reads 3.0 m", await page.getByRole("slider", { name: "Ceiling height" }).getAttribute("aria-valuetext"), "3.0 m");

    // DP-32: placing plays the four steps in order.
    const room = page.getByRole("region", { name: "Light-pool room" });
    eq("the room settles before any placement", await room.getAttribute("data-phase"), "settled");
    const phases = [];
    const watcher = setInterval(async () => {
      try {
        const phase = await room.getAttribute("data-phase");
        if (phase && phases[phases.length - 1] !== phase) phases.push(phase);
      } catch {
        // The page may be mid-update.
      }
    }, 40);

    await page.getByRole("button", { name: "Place KDL-BK-24-2700" }).first().click();
    await page.waitForTimeout(2000);
    clearInterval(watcher);
    const ordered = phases.filter((p, i) => i === 0 || p !== phases[i - 1]);
    check("the placement sequence runs cone, pool, tint, count, settled", ordered.join(">").includes("cone>pool>tint>count>settled"), ordered);

    // DP-30: the figures at a 3.0 m ceiling.
    const firstRow = await page.locator('table[aria-label="Light pools"] tbody tr').first().innerText();
    check("the table shows the code", firstRow.includes("KDL-BK-24-2700"), firstRow);
    check("placed at the room centre on the 100 mm grid", firstRow.includes("3000") && firstRow.includes("2300"), firstRow);
    check("the pool diameter at 3.0 m", firstRow.includes("1275"), firstRow);

    eq(
      "the room announces the placement",
      await page.getByRole("status", { name: "Room updates" }).textContent(),
      "KDL-BK-24-2700 placed at 3000 mm, 2300 mm. Pool 1275 mm, 696 lux.",
    );

    // Focus moved to the new fitting's button, which is named for its position.
    const focusedName = await page.evaluate(() => document.activeElement?.textContent?.trim());
    check("focus moves to the new fitting", focusedName?.includes("KDL-BK-24-2700 #1"), focusedName);

    // DP-33: nudge with the arrow keys and with Shift.
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(700);
    eq("Right adds 100 mm to x", await page.getByRole("status", { name: "Room updates" }).textContent(), "KDL-BK-24-2700 moved to 3100 mm, 2300 mm.");
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(700);
    eq("Down adds 100 mm to y", await page.getByRole("status", { name: "Room updates" }).textContent(), "KDL-BK-24-2700 moved to 3100 mm, 2400 mm.");
    await page.keyboard.press("Shift+ArrowLeft");
    await page.waitForTimeout(700);
    eq("Shift+Left subtracts 500 mm", await page.getByRole("status", { name: "Room updates" }).textContent(), "KDL-BK-24-2700 moved to 2600 mm, 2400 mm.");
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(700);
    eq("Up subtracts 100 mm from y", await page.getByRole("status", { name: "Room updates" }).textContent(), "KDL-BK-24-2700 moved to 2600 mm, 2300 mm.");

    // DP-34: the table follows the room.
    const movedRow = await page.locator('table[aria-label="Light pools"] tbody tr').first().innerText();
    check("the table follows the move", movedRow.includes("2600") && movedRow.includes("2300"), movedRow);

    // Escape moves focus to the ceiling slider.
    await page.keyboard.press("Escape");
    eq("Escape focuses the ceiling slider", await page.evaluate(() => document.activeElement?.id), "ceiling-height");

    // Place a second one, then remove it with Delete.
    await page.getByRole("button", { name: "Place KDL-BK-24-2700" }).first().click();
    await page.waitForTimeout(1800);
    eq("two placements", await page.locator('table[aria-label="Light pools"] tbody tr').count(), 2);
    await page.keyboard.press("Delete");
    await page.waitForTimeout(900);
    eq("the fitting is removed", await page.locator('table[aria-label="Light pools"] tbody tr').count(), 1);
    eq("the room announces the removal", await page.getByRole("status", { name: "Room updates" }).textContent(), "KDL-BK-24-2700 removed.");
    const afterRemoveFocus = await page.evaluate(() => document.activeElement?.textContent?.trim());
    check("focus returns to the Place button", afterRemoveFocus?.startsWith("Place KDL-BK-24-2700"), afterRemoveFocus);

    // Tab always leaves the room.
    await page.locator(".fitting-button").first().focus();
    await page.keyboard.press("Tab");
    const left = await page.evaluate(() => !document.activeElement?.classList.contains("fitting-button"));
    check("Tab leaves the room", left);

    // DP-35: the placements are still there when the project reopens.
    await page.reload();
    await page.waitForSelector('table[aria-label="Light pools"] tbody tr');
    eq("the placement survives a reload", await page.locator('table[aria-label="Light pools"] tbody tr').count(), 1);
    const reopened = await page.locator('table[aria-label="Light pools"] tbody tr').first().innerText();
    check("at the position it was left", reopened.includes("2600") && reopened.includes("2300"), reopened);
    await context.close();
  }

  /* ---------- DP-37, DP-38: live presence, comments and placements ---------- */
  {
    const ownerContext = await browser.newContext({ viewport: DESKTOP });
    const owner = await ownerContext.newPage();
    await signIn(owner, "rangi@kowhai-electrical.test", "Trade-approved-2026");
    await owner.goto(`${BASE}/projects`);
    await owner.waitForSelector("article.card");
    await owner.getByRole("link", { name: "Ponsonby Kitchen" }).click();
    await owner.waitForSelector('[aria-label="Light-pool room"]');
    const projectUrl = owner.url();

    const designerContext = await browser.newContext({ viewport: DESKTOP });
    const designer = await designerContext.newPage();
    await signIn(designer, "isla@harbourlight.test", "Trade-collab-2026");
    await designer.goto(projectUrl);
    await designer.waitForSelector('[aria-label="Light-pool room"]');

    // Each viewer appears in the other's "Viewing now" within 3 seconds.
    await owner.waitForFunction(
      () => document.querySelectorAll('[aria-label="Viewing now"] img, [aria-label="Viewing now"] [role="img"]').length >= 2,
      null,
      { timeout: 6000 },
    ).catch(() => undefined);
    const ownerAvatars = await owner.locator('[aria-label="Viewing now"] [role="img"]').count();
    check("the owner sees both viewers", ownerAvatars >= 2, ownerAvatars);
    const names = await owner.locator('[aria-label="Viewing now"] [role="img"]').evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-label")),
    );
    check("the avatars are named for the viewers", names.includes("Isla Morven"), names);

    // DP-38: a placement by one collaborator reaches the other within 3 seconds.
    const before = await owner.locator('table[aria-label="Light pools"] tbody tr').count();
    await designer.getByRole("button", { name: "Place KDL-BK-24-2700" }).first().click();
    await designer.waitForTimeout(1600);
    await owner.waitForFunction(
      (count) => document.querySelectorAll('table[aria-label="Light pools"] tbody tr').length > count,
      before,
      { timeout: 6000 },
    );
    eq("the owner's room follows the designer's placement", await owner.locator('table[aria-label="Light pools"] tbody tr').count(), before + 1);

    // DP-37: a comment from either appears for both without a reload.
    await designer.getByRole("textbox", { name: "Add a comment" }).fill("Shift the pair towards the island.");
    await designer.getByRole("button", { name: "Post comment" }).click();
    await designer.waitForTimeout(600);
    eq("the designer's comment posts", await designer.getByRole("status", { name: "Project updates" }).textContent(), "Comment posted.");
    await owner.waitForFunction(
      () => [...document.querySelectorAll('[aria-label="Comment thread"] li')].some((li) => li.textContent?.includes("Shift the pair towards the island.")),
      null,
      { timeout: 8000 },
    );
    check("the comment reaches the owner without a reload", true);

    await owner.getByRole("textbox", { name: "Add a comment" }).fill("Agreed, 200 mm closer.");
    await owner.getByRole("button", { name: "Post comment" }).click();
    await designer.waitForFunction(
      () => [...document.querySelectorAll('[aria-label="Comment thread"] li')].some((li) => li.textContent?.includes("Agreed, 200 mm closer.")),
      null,
      { timeout: 8000 },
    );
    check("and the reply reaches the designer", true);

    // Enter in the comment box inserts a new line rather than posting.
    const box = owner.getByRole("textbox", { name: "Add a comment" });
    await box.fill("one");
    await box.press("Enter");
    await box.type("two");
    eq("Enter inserts a new line", await box.inputValue(), "one\ntwo");

    /* ---------- DP-43: the quote share journey ---------- */
    eq("only the owner sees Share quote", await designer.getByRole("button", { name: "Share quote" }).count(), 0);
    await owner.getByRole("button", { name: "Share quote" }).click();
    await owner.waitForSelector('[role="dialog"][aria-label="Share quote"], [role="dialog"]');
    await owner.getByRole("textbox", { name: "Recipients" }).fill("client-one@example.test, client-two@example.test");
    await owner.getByRole("radio", { name: "No prices" }).check();
    await owner.getByRole("textbox", { name: "Message" }).fill("First pass for your review.");
    await owner.getByRole("button", { name: "Send quote" }).click();
    await owner.waitForTimeout(900);
    eq(
      "the share is queued",
      await owner.getByRole("status", { name: "Project updates" }).textContent(),
      "Quote queued for 2 recipients. Emails go out as soon as the PDF is ready.",
    );

    await owner.getByRole("button", { name: "Share quote" }).click();
    await owner.getByRole("textbox", { name: "Recipients" }).fill("wholesale@example.test");
    await owner.getByRole("radio", { name: "Trade prices" }).check();
    await owner.getByRole("button", { name: "Send quote" }).click();
    await owner.waitForTimeout(900);

    // The shares table shows each share preparing, then Ready.
    await owner.waitForFunction(
      () => {
        const cells = [...document.querySelectorAll('table[aria-label="Quote shares"] tbody tr td:last-child')];
        return cells.length === 2 && cells.every((cell) => cell.textContent?.trim() === "Ready");
      },
      null,
      { timeout: 25000 },
    );
    const shareStates = await owner.locator('table[aria-label="Quote shares"] tbody tr td:last-child').allTextContents();
    eq("both shares become Ready", shareStates.map((s) => s.trim()), ["Ready", "Ready"]);

    // Each recipient gets their own email with the matching PDF.
    let quotes = [];
    for (let i = 0; i < 30; i += 1) {
      quotes = await mail("shared a Lightfall quote");
      if (quotes.length >= 3) break;
      await owner.waitForTimeout(600);
    }
    eq("one email per recipient", quotes.length, 3);
    eq("the subject names the sender and the project", quotes[0].Subject, "Rangi Parata shared a Lightfall quote: Ponsonby Kitchen");
    const addresses = quotes.map((m) => m.To[0].Address).sort();
    eq("each recipient has their own email", addresses, ["client-one@example.test", "client-two@example.test", "wholesale@example.test"]);

    for (const message of quotes) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json();
      const attachment = full.Attachments?.[0];
      check(`the PDF is attached for ${message.To[0].Address}`, Boolean(attachment), full.Attachments);
      if (message.To[0].Address === "wholesale@example.test") {
        check("the trade share shows amounts", /\$\d/.test(full.Text), full.Text);
      } else {
        check("the no-prices email carries no amount at all", !full.Text.includes("$"), full.Text);
        check("and no GST line", !/GST/i.test(full.Text), full.Text);
        check("but still lists the fittings", full.Text.includes("KDL-BK-24-2700"), full.Text);
      }
    }

    await ownerContext.close();
    await designerContext.close();
  }

  /* ---------- DP-21: the trade approval journey ---------- */
  {
    const applicantContext = await browser.newContext({ viewport: DESKTOP });
    const applicant = await applicantContext.newPage();
    await signIn(applicant, "sam@whitcombe-wholesale.test", "Trade-pending-2026");

    await applicant.goto(`${BASE}/account`);
    await applicant.waitForSelector('[aria-label="Trade application"]');
    eq(
      "the pending banner",
      (await applicant.getByRole("status", { name: "Trade application" }).textContent()).trim(),
      "Your trade application is with our team. You'll see trade prices once it's approved.",
    );
    await applicant.goto(`${BASE}/products/kauri-downlight`);
    await applicant.waitForSelector('[aria-label="Specification"]');
    const retailOnly = await applicant.locator(".product-panel .price-line").first().textContent();
    check("the applicant sees retail prices only", !retailOnly.includes("Trade"), retailOnly);
    eq("and has no Projects link", await applicant.getByRole("link", { name: "Projects" }).count(), 0);

    const adminContext = await browser.newContext({ viewport: DESKTOP });
    const admin = await adminContext.newPage();
    await signIn(admin, "admin@southerly-light.test", "Lightfall-admin-2026");
    await admin.goto(`${BASE}/admin`);
    await admin.waitForSelector('table[aria-label="Trade applications"]');
    eq("the admin tablist", await admin.getByRole("tab").count(), 4);
    await admin.getByRole("button", { name: "Approve Whitcombe Wholesale" }).click();
    await admin.waitForTimeout(1200);
    eq("the approval is announced", await admin.getByRole("status", { name: "Admin updates" }).textContent(), "Approved Whitcombe Wholesale.");

    let approval = [];
    for (let i = 0; i < 20; i += 1) {
      approval = await mail("Your Lightfall trade account is approved");
      if (approval.length > 0) break;
      await admin.waitForTimeout(400);
    }
    eq("the approval email arrives", approval.length, 1);
    eq("addressed to the applicant", approval[0].To[0].Address, "sam@whitcombe-wholesale.test");

    // Once they sign in again, trade prices and the Projects link appear.
    const after = await applicantContext.newPage();
    await signIn(after, "sam@whitcombe-wholesale.test", "Trade-pending-2026");
    await after.goto(`${BASE}/products/kauri-downlight`);
    await after.waitForSelector('[aria-label="Specification"]');
    const tradeLine = await after.locator(".product-panel .price-line").first().textContent();
    check("trade prices now show", tradeLine.startsWith("Trade $"), tradeLine);
    const rrp = await after.locator(".product-panel .price-line").nth(1).textContent();
    check("with the RRP below", rrp.startsWith("RRP $"), rrp);
    eq("the Projects link appears", await after.getByRole("link", { name: "Projects" }).count(), 1);
    await applicantContext.close();

    /* ---------- DP-08, DP-44..DP-46: the admin day ---------- */
    await admin.getByRole("tab", { name: "Health" }).click();
    await admin.waitForSelector('table[aria-label="Service health"]');
    await admin.waitForFunction(
      () => [...document.querySelectorAll('table[aria-label="Service health"] tbody td')]
        .every((cell) => (cell.textContent ?? "").trim() !== ""),
      null,
      { timeout: 15000 },
    );
    const healthRows = await admin.locator('table[aria-label="Service health"] tbody tr').allTextContents();
    eq("five services listed", healthRows.length, 5);
    check("every service is Up", healthRows.every((row) => row.includes("Up")), healthRows);
    const serviceNames = await admin.locator('table[aria-label="Service health"] tbody th').allTextContents();
    eq("the service names", serviceNames, ["Postgres", "Kill Bill", "Mailpit", "MinIO", "PocketBase"]);

    // Dispatch the authorised card order from the first journey.
    await admin.getByRole("tab", { name: "Orders" }).click();
    await admin.waitForSelector('table[aria-label="Orders"]');
    const authorisedRow = admin.locator('table[aria-label="Orders"] tbody tr', { hasText: "Authorised" }).first();
    const orderKey = (await authorisedRow.locator("td").first().textContent()).trim();
    eq("the order reads Authorised before dispatch", (await authorisedRow.locator("td").nth(4).textContent()).trim(), "Authorised");

    await admin.getByRole("button", { name: `Dispatch ${orderKey}` }).click();
    await admin.waitForTimeout(3000);
    eq("the capture is announced", await admin.getByRole("status", { name: "Admin updates" }).textContent(), `Payment captured. Order ${orderKey} is Paid.`);
    const paidRow = admin.locator('table[aria-label="Orders"] tbody tr', { hasText: orderKey }).first();
    eq("the order reads Paid once Kill Bill confirms", (await paidRow.locator("td").nth(4).textContent()).trim(), "Paid");

    // Refund part, then the rest.
    await admin.getByRole("button", { name: `Refund ${orderKey}` }).click();
    await admin.getByRole("textbox", { name: "Amount (NZD)" }).fill("100.00");
    await admin.getByRole("textbox", { name: "Reason" }).fill("One trim marked");
    await admin.getByRole("button", { name: "Issue refund" }).click();
    await admin.waitForTimeout(2500);
    eq("the partial refund is announced", await admin.getByRole("status", { name: "Admin updates" }).textContent(), `Refunded $100.00 on ${orderKey}.`);
    const partRow = admin.locator('table[aria-label="Orders"] tbody tr', { hasText: orderKey }).first();
    eq("the order reads Partly refunded", (await partRow.locator("td").nth(4).textContent()).trim(), "Partly refunded");

    // A refund larger than what remains is refused.
    await admin.getByRole("button", { name: `Refund ${orderKey}` }).click();
    await admin.getByRole("textbox", { name: "Amount (NZD)" }).fill("500.00");
    await admin.getByRole("textbox", { name: "Reason" }).fill("Too much");
    await admin.getByRole("button", { name: "Issue refund" }).click();
    await admin.waitForTimeout(1500);
    eq("the over-refund is refused with the refundable amount", await admin.locator('[role="dialog"] .field-error').textContent(), "More than the $104.70 still refundable.");
    await admin.keyboard.press("Escape");

    await admin.getByRole("button", { name: `Refund ${orderKey}` }).click();
    await admin.getByRole("textbox", { name: "Amount (NZD)" }).fill("104.70");
    await admin.getByRole("textbox", { name: "Reason" }).fill("Returned");
    await admin.getByRole("button", { name: "Issue refund" }).click();
    await admin.waitForTimeout(2500);
    const refundedRow = admin.locator('table[aria-label="Orders"] tbody tr', { hasText: orderKey }).first();
    eq("the order reads Refunded", (await refundedRow.locator("td").nth(4).textContent()).trim(), "Refunded");

    // DP-14: the admin stock table agrees with the catalogue.
    await admin.getByRole("tab", { name: "Stock" }).click();
    await admin.waitForSelector('table[aria-label="Clearance stock"]');
    const stockHeaders = await admin.locator('table[aria-label="Clearance stock"] thead th').allTextContents();
    eq("the stock columns", stockHeaders.slice(0, 4), ["Code", "Product", "Clearance price", "On hand"]);
    await adminContext.close();
  }

  /* ---------- DP-58: reduced motion and no WebGL ---------- */
  {
    const context = await browser.newContext({ viewport: DESKTOP, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(`${BASE}/products/kauri-downlight`);
    await page.waitForSelector('[aria-label="Specification"]');
    const viewer = page.getByRole("img", { name: "Kauri Downlight 3D model" });
    eq("the idle turn stops under reduced motion", await viewer.getAttribute("data-idle"), "off");
    const yawA = await viewer.getAttribute("data-yaw");
    await page.waitForTimeout(1200);
    eq("and the model does not turn on its own", await viewer.getAttribute("data-yaw"), yawA);

    // Dragging still turns the model.
    const box = await viewer.boundingBox();
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    check("dragging still turns the model", (await viewer.getAttribute("data-yaw")) !== yawA, await viewer.getAttribute("data-yaw"));

    // Drawers appear and disappear at once.
    const dimensions = page.getByRole("button", { name: "Dimensions" });
    await dimensions.click();
    eq("the drawer opens at once", await dimensions.getAttribute("aria-expanded"), "true");

    // The room goes straight to settled.
    await signIn(page, "rangi@kowhai-electrical.test", "Trade-approved-2026");
    await page.goto(`${BASE}/projects`);
    await page.waitForSelector("article.card");
    await page.getByRole("link", { name: "Ponsonby Kitchen" }).click();
    await page.waitForSelector('[aria-label="Light-pool room"]');
    const anyPlace = page.locator("button", { hasText: /^Place / }).first();
    if ((await anyPlace.count()) > 0) {
      await anyPlace.click();
      await page.waitForTimeout(400);
      eq("the room goes straight to settled", await page.getByRole("region", { name: "Light-pool room" }).getAttribute("data-phase"), "settled");
    }
    await context.close();
  }

  {
    // Without WebGL the viewer shows a still drawing and the room a plan.
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
        return original.call(this, type, ...rest);
      };
    });
    await page.goto(`${BASE}/products/kauri-downlight`);
    await page.waitForSelector('[aria-label="Specification"]');
    eq("the viewer falls back to a still drawing", await page.getByRole("img", { name: "Kauri Downlight drawing" }).count(), 1);
    eq("and the 3D model is not claimed", await page.getByRole("img", { name: "Kauri Downlight 3D model" }).count(), 0);
    // The variant picker still works.
    await page.getByRole("radio", { name: "24\u00b0" }).check();
    await page.waitForTimeout(400);
    eq("the drawing re-lights to the new beam", await page.getByRole("img", { name: "Kauri Downlight drawing" }).getAttribute("data-beam"), "24");

    await signIn(page, "rangi@kowhai-electrical.test", "Trade-approved-2026");
    await page.goto(`${BASE}/projects`);
    await page.waitForSelector("article.card");
    await page.getByRole("link", { name: "Ponsonby Kitchen" }).click();
    await page.waitForSelector('[aria-label="Light-pool room"]');
    eq("the room falls back to a plan", await page.getByRole("img", { name: "Room plan" }).count(), 1);
    eq("the light-pools table still works", await page.getByRole("table", { name: "Light pools" }).count(), 1);
    const buttons = await page.locator(".fitting-button").count();
    check("the fitting buttons still work", buttons > 0, buttons);
    await context.close();
  }

  await browser.close();
  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  if (failures.length > 0) process.exitCode = 1;
}

await run();
