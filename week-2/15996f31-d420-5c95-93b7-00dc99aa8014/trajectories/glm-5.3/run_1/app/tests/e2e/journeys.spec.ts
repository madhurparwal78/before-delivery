import { chromium } from "playwright";
import assert from "node:assert/strict";

const BASE = "http://localhost:4173";

let passed = 0;
function ok(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS ${label}`);
  } else {
    console.log(`  FAIL ${label} :: ${detail}`);
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch();

  // ---------- Journey 1: broker sets up a season order ----------
  console.log("Journey 1 — broker sets up a season order");
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(BASE + "/");
    await page.getByLabel("Email").fill("dana@kettleman-pollination.example");
    await page.getByLabel("Password").fill("bloom-desk-2027");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/desk");
    ok("sign-in reaches the desk", page.url().endsWith("/desk"));
    ok("wordmark shown", await page.locator(".desk-header .wordmark").textContent() === "Swarmline Bloom Desk");
    await page.getByRole("button", { name: "New orchard" }).click();
    const dialog = page.locator("dialog[aria-label='New orchard']");
    await dialog.waitFor();
    await dialog.getByLabel("Orchard name").fill("Del Rey Grove");
    await dialog.getByLabel("County").fill("Madera");
    const blockRows = dialog.locator(".block-input-row");
    await blockRows.nth(0).locator("input").nth(0).fill("Block 1");
    await blockRows.nth(0).locator("input").nth(1).fill("12");
    await blockRows.nth(1).locator("input").nth(0).fill("Block 2");
    await blockRows.nth(1).locator("input").nth(1).fill("18");
    await dialog.getByRole("button", { name: "Save orchard" }).click();
    await page.getByText("Orchard Del Rey Grove saved.").waitFor({ state: "attached" });
    ok("orchard saved announcement", true);
    await page.getByRole("button", { name: "New order" }).click();
    const orderDialog = page.locator("dialog[aria-label='New order']");
    await orderDialog.waitFor();
    await orderDialog.getByLabel("Orchard").selectOption({ label: "Del Rey Grove" });
    await orderDialog.getByLabel("Bloom start").fill("2027-02-10");
    await orderDialog.getByLabel("Bloom end").fill("2027-03-04");
    await orderDialog.getByLabel("Delivery deadline").fill("2027-02-06");
    await orderDialog.getByLabel("Hives, Block 1").fill("24");
    await orderDialog.getByLabel("Hives, Block 2").fill("36");
    await orderDialog.getByRole("button", { name: "Save draft" }).click();
    await page.getByText("Draft order BD-1001 saved.").waitFor({ state: "attached" });
    ok("draft order saved", true);
    await page.getByRole("button", { name: "Open order" }).click();
    await page.getByText("BD-1001 is open to beekeepers. Deposit invoice recorded.").waitFor({ state: "attached" });
    ok("open order announced with deposit copy", true);
    const rail = page.locator("nav[aria-label='Orchards']");
    await rail.getByRole("link", { name: "Del Rey Grove" }).waitFor();
    ok("new orchard in rail", true);
    const group = page.getByRole("group", { name: "Plat map, Del Rey Grove" });
    await group.waitFor();
    ok("plat map for the new orchard", true);
    const notInspected = page.getByRole("button", { name: "Block 1, Not inspected" });
    await notInspected.waitFor();
    ok("blocks show Not inspected", true);
    ok("ledger shows Open status", (await page.getByText("Order status: Open").count()) === 1);
    await page.close();
  }

  // ---------- Journey 2: beekeepers fill HS-2027 ----------
  console.log("Journey 2 — beekeepers fill the order");
  const hsTokenBlocks = ["Block 1", "Block 2", "Block 3"];
  {
    const coulee = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await coulee.goto(BASE + "/");
    await coulee.getByLabel("Email").fill("sam@couleegold.example");
    await coulee.getByLabel("Password").fill("bloom-desk-2027");
    await coulee.getByRole("button", { name: "Sign in" }).click();
    await coulee.waitForURL("**/desk");
    await coulee.locator("nav[aria-label='Orchards']").getByRole("link", { name: "Harlan South Ranch" }).click();
    await coulee.locator("#open-orders-area").getByText("HS-2027").first().waitFor();
    ok("beekeeper sees HS-2027 among open orders", true);
    const commit = coulee.locator("#open-orders-area").getByRole("button", { name: "Commit truckload to HS-2027" });
    await commit.click();
    const dialog = coulee.locator("dialog[aria-label='Commit truckload']");
    await dialog.waitFor();
    const hives = dialog.getByLabel("Hives");
    ok("hives field starts at still-open count", (await hives.inputValue()) === "240");
    await hives.fill("80");
    await dialog.getByLabel("Yard name").fill("Coulee Yard A");
    await dialog.getByRole("button", { name: "Commit" }).click();
    await coulee.getByText("80 hives committed to HS-2027.").waitFor({ state: "attached" });
    ok("coulee commits 80", true);

    // Coulee opens the dialog again with 100 hives, while prairie commits meanwhile.
    await commit.click();
    await dialog.waitFor();
    ok("hives field re-reads open count", (await dialog.getByLabel("Hives").inputValue()) === "160");
    await dialog.getByLabel("Hives").fill("100");
    await dialog.getByLabel("Yard name").fill("Coulee Yard B");

    const prairie = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await prairie.goto(BASE + "/");
    await prairie.getByLabel("Email").fill("ruth@prairielantern.example");
    await prairie.getByLabel("Password").fill("bloom-desk-2027");
    await prairie.getByRole("button", { name: "Sign in" }).click();
    await prairie.waitForURL("**/desk");
    await prairie.locator("#open-orders-area").getByRole("button", { name: "Commit truckload to HS-2027" }).click();
    const prairieDialog = prairie.locator("dialog[aria-label='Commit truckload']");
    await prairieDialog.waitFor();
    await prairieDialog.getByLabel("Hives").fill("80");
    await prairieDialog.getByLabel("Yard name").fill("Prairie Yard B");
    await prairieDialog.getByRole("button", { name: "Commit" }).click();
    await prairie.getByText("80 hives committed to HS-2027.").waitFor({ state: "attached" });
    ok("prairie commits 80 while coulee's dialog is open", true);

    await dialog.getByRole("button", { name: "Commit" }).click();
    await dialog.locator(".field .message", { hasText: "Only 80 hives are still open on HS-2027." }).waitFor();
    ok("refusal copy shows remaining 80", true);
    await dialog.locator(".error-summary").getByText("There is a problem").waitFor();
    ok("error summary links to the field", (await dialog.locator(".error-summary a").count()) === 1);
    ok("dialog still open after refusal", await dialog.isVisible());
    ok("hives maximum updated to remaining", (await hives.getAttribute("max")) === "80");
    await hives.fill("80");
    await dialog.getByRole("button", { name: "Commit" }).click();
    await coulee.getByText("80 hives committed to HS-2027.").waitFor({ state: "attached" });
    await coulee.getByText("Order status: Filled").waitFor({ state: "attached" });
    ok("order filled", true);

    // Each beekeeper logs each truckload into its own block.
    async function logDrop(page: import("playwright").Page, yard: string, block: string): Promise<void> {
      await page.locator("#my-drops-area").getByRole("button", { name: "Log drop" }).first().click();
      const dropDialog = page.locator("dialog[aria-label='Log drop']");
      await dropDialog.waitFor();
      await dropDialog.getByLabel("Block").selectOption({ label: block });
      const date = dropDialog.getByLabel(/Delivery date/);
      const value = await date.inputValue();
      assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
      await dropDialog.getByRole("button", { name: "Log drop" }).click();
      await page.getByText(/Drop logged: 80 hives in/).waitFor({ state: "attached" });
    }
    await logDrop(coulee, "Coulee Yard A", "Block 1");
    await logDrop(prairie, "Prairie Yard B", "Block 2");
    // coulee's second drop
    const couleeLogButtons = coulee.locator("#my-drops-area").getByRole("button", { name: "Log drop" });
    await couleeLogButtons.first().click();
    const d2 = coulee.locator("dialog[aria-label='Log drop']");
    await d2.waitFor();
    await d2.getByLabel("Block").selectOption({ label: "Block 3" });
    await d2.getByRole("button", { name: "Log drop" }).click();
    await coulee.getByText(/Drop logged: 80 hives in Block 3/).waitFor({ state: "attached" });
    ok("coulee logs second drop into Block 3", true);
    const delivered = coulee.locator("#my-drops-area").getByText("Delivered");
    ok("drops show Delivered", (await delivered.count()) >= 1);
    await coulee.close();
    await prairie.close();
  }

  // ---------- Journey 3: broker places the order and sends the link ----------
  console.log("Journey 3 — broker places and calls the inspector");
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(BASE + "/");
    await page.getByLabel("Email").fill("dana@kettleman-pollination.example");
    await page.getByLabel("Password").fill("bloom-desk-2027");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/desk");
    await page.locator("nav[aria-label='Orchards']").getByRole("link", { name: /Harlan South Ranch/ }).click();
    await page.waitForURL("**/desk");
    const picker = page.getByRole("combobox", { name: "Order" });
    await picker.locator("option", { hasText: "HS-2027" }).waitFor({ state: "attached" });
    const label = (await picker.locator("option").allTextContents()).find((text) => text.includes("HS-2027")) ?? "";
    await picker.selectOption({ label });
    await page.getByText("Order status: Filled").waitFor({ state: "attached" });
    await page.getByRole("button", { name: "Mark placed" }).click();
    await page.getByText("HS-2027 placed. The grower's placement confirmation is on its way.").waitFor({ state: "attached" });
    ok("placed announcement", true);
    await page.getByRole("button", { name: "Send inspection link" }).click();
    const dialog = page.locator("dialog[aria-label='Send inspection link']");
    await dialog.waitFor();
    await dialog.getByLabel("Inspector email").fill("ida.reed@example.com");
    await dialog.getByRole("button", { name: "Send link" }).click();
    await page.getByText("Inspection link for HS-2027 is on its way to ida.reed@example.com. Any earlier link has stopped working.").waitFor({ state: "attached" });
    ok("link announcement", true);
    await page.getByText(/Inspection link: Issued to ida.reed@example.com/).waitFor({ state: "attached" });
    ok("ledger shows the link Issued", true);
    await page.getByText("Order status: Placed").waitFor({ state: "attached" });
    ok("status line shows Placed", true);
    await page.close();
  }

  // Fetch the token from Mailpit for the inspector journey.
  const token = await fetch("http://mailpit:8025/api/v1/messages?limit=20")
    .then((response) => response.json() as Promise<{ messages: { ID: string; Subject: string }[] }>)
    .then((data) => data.messages.find((message) => message.Subject.includes("Inspection sheet: Harlan South Ranch"))?.ID)
    .then((id) => fetch(`http://mailpit:8025/api/v1/message/${id ?? ""}`).then((response) => response.json() as Promise<{ Text: string }>))
    .then((detail) => (detail.Text.split("/inspect/")[1] ?? "").split("\n")[0]?.trim() ?? "");

  // ---------- Journey 4: inspector samples and signs ----------
  console.log("Journey 4 — inspector samples and signs");
  {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await page.goto(`${BASE}/inspect/${token}`);
    await page.getByText("Link expires").waitFor({ state: "attached" });
    ok("inspector opens without sign-in", true);
    ok("no horizontal scroll at 375", await page.evaluate(() => document.documentElement.scrollWidth <= 376), `${await page.evaluate(() => document.documentElement.scrollWidth)}`);
    const framesCycle = [9.0, 9.5, 10.0, 8.5, 9.5, 10.5, 11.0, 9.0] as const;
    for (const block of hsTokenBlocks) {
      for (let index = 0; index < 8; index += 1) {
        const form = page.locator("form.add-sample");
        await form.getByLabel("Block", { exact: true }).selectOption({ label: block });
        await form.getByLabel("Yard", { exact: true }).selectOption({ index: 0 });
        await form.getByLabel("Colony", { exact: true }).fill(`C${index + 1}`);
        await form.getByLabel("Frames of bees", { exact: true }).fill(framesCycle[index]?.toFixed(1) ?? "9.0");
        await form.getByRole("button", { name: "Add sample" }).click();
        await page.getByText(`Sample C${index + 1} saved.`).waitFor({ state: "attached" });
      }
    }
    ok("all samples saved", true);
    // Sign the report.
    await page.getByRole("button", { name: "Sign report" }).click();
    const dialog = page.locator("dialog[aria-label='Sign report']");
    await dialog.waitFor();
    await dialog.getByLabel("Full name").fill("Ida Reed");
    await dialog.getByLabel("I counted these colonies and these figures are true").check();
    await dialog.getByRole("button", { name: "Sign and send" }).click();
    await page.getByText("Report signed. The grower's notice is on its way.").waitFor({ state: "attached" });
    ok("sign announced", true);
    await page.getByText("This inspection link no longer works").waitFor({ state: "attached" });
    ok("dead link page after signing", true);
    await page.reload();
    await page.getByText("This inspection link no longer works").waitFor({ state: "attached" });
    ok("link stops working on reload", true);
    await page.close();
  }

  // ---------- Journey 5: beekeeper reviews and disputes a drop ----------
  console.log("Journey 5 — beekeeper reviews a drop");
  {
    const page = await browser.newPage({ viewport: { width: 768, height: 1024 } });
    await page.goto(BASE + "/");
    await page.getByLabel("Email").fill("sam@couleegold.example");
    await page.getByLabel("Password").fill("bloom-desk-2027");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/desk");
    const link = page.locator("#my-drops-area").getByRole("link", { name: /View drop Coulee Yard A, 80 hives/ });
    await link.click();
    await page.waitForURL("**/desk/drops/*");
    await page.getByText("Coulee Yard A, 80 hives").waitFor({ state: "attached" });
    ok("drop detail opens", true);
    const tier = await page.getByText(/Block tier/).textContent();
    ok("block tier shown", (tier ?? "").length > 0);
    await page.getByRole("button", { name: "Dispute inspection" }).click();
    const dialog = page.locator("dialog[aria-label='Dispute inspection']");
    await dialog.waitFor();
    await dialog.getByLabel("Reason").fill("The frames counted in Block 1 look lower than what we delivered.");
    await dialog.getByRole("button", { name: "Send dispute" }).click();
    await page.getByText("Dispute sent to the broker.").waitFor({ state: "attached" });
    ok("dispute sent", true);
    await page.close();

    // The broker resolves the dispute; both then see the drop Accepted.
    const broker = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await broker.goto(BASE + "/");
    await broker.getByLabel("Email").fill("dana@kettleman-pollination.example");
    await broker.getByLabel("Password").fill("bloom-desk-2027");
    await broker.getByRole("button", { name: "Sign in" }).click();
    await broker.waitForURL("**/desk");
    const disputedId = await broker.evaluate(async () => {
      const response = await fetch("/api/drops");
      const drops = await response.json() as { id: string; status: string }[];
      return drops.find((drop) => drop.status === "disputed")?.id ?? "";
    });
    await broker.goto(`${BASE}/desk/drops/${disputedId}`);
    await broker.getByRole("button", { name: "Resolve dispute" }).click();
    const resolveDialog = broker.locator("dialog[aria-label='Resolve dispute']");
    await resolveDialog.waitFor();
    await resolveDialog.getByLabel("Resolution note").fill("Recounted with the inspector; the figures stand.");
    await resolveDialog.getByRole("button", { name: "Resolve" }).click();
    await broker.getByText("Dispute resolved. Coulee Yard A is accepted.").waitFor({ state: "attached" });
    ok("broker resolves the dispute", true);
    await broker.getByText("Status", { exact: true }).waitFor();
    ok("broker sees the drop accepted", (await broker.getByText("Accepted").count()) >= 1);
    await broker.close();

    const couleeAgain = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await couleeAgain.goto(BASE + "/");
    await couleeAgain.getByLabel("Email").fill("sam@couleegold.example");
    await couleeAgain.getByLabel("Password").fill("bloom-desk-2027");
    await couleeAgain.getByRole("button", { name: "Sign in" }).click();
    await couleeAgain.waitForURL("**/desk");
    await couleeAgain.goto(`${BASE}/desk/drops/${disputedId}`);
    await couleeAgain.getByText("Accepted").first().waitFor();
    ok("beekeeper sees the drop accepted after resolution", true);
    await couleeAgain.close();
  }

  // ---------- Journey 6: broker settles the orchard ----------
  console.log("Journey 6 — broker settles the orchard");
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(BASE + "/");
    await page.getByLabel("Email").fill("dana@kettleman-pollination.example");
    await page.getByLabel("Password").fill("bloom-desk-2027");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/desk");
    await page.locator("nav[aria-label='Orchards']").getByRole("link", { name: "Harlan South Ranch" }).click();
    await page.locator(".ledger").getByText("Order status: Inspected").waitFor();
    // The remaining inspected drops must be accepted by their own beekeepers.
    const pending = await page.evaluate(async () => {
      const response = await fetch("/api/drops");
      const drops = await response.json() as { id: string; status: string; yard_name: string }[];
      return drops
        .filter((drop) => drop.status === "inspected")
        .map((drop) => ({ id: drop.id, email: drop.yard_name.startsWith("Prairie") ? "ruth@prairielantern.example" : "sam@couleegold.example" }));
    });
    for (const drop of pending) {
      const beekeeper = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await beekeeper.goto(BASE + "/");
      await beekeeper.getByLabel("Email").fill(drop.email);
      await beekeeper.getByLabel("Password").fill("bloom-desk-2027");
      await beekeeper.getByRole("button", { name: "Sign in" }).click();
      await beekeeper.waitForURL("**/desk");
      await beekeeper.goto(`${BASE}/desk/drops/${drop.id}`);
      await beekeeper.getByRole("button", { name: "Accept inspection" }).click();
      await beekeeper.getByText(/Inspection accepted for/).waitFor({ state: "attached" });
      await beekeeper.close();
    }
    await page.reload();
    await page.locator("nav[aria-label='Orchards']").getByRole("link", { name: "Harlan South Ranch" }).click();
    await page.locator(".ledger").getByText("Order status: Inspected").waitFor();
    await page.getByRole("button", { name: "Settle orchard" }).click();
    const dialog = page.locator("dialog[aria-label='Settle orchard']");
    await dialog.waitFor();
    await dialog.getByRole("table", { name: "Settlement split" }).waitFor();
    ok("settlement split shown", true);
    await dialog.getByRole("button", { name: "Settle" }).click();
    await page.getByText("Harlan South Ranch settled.").waitFor({ state: "attached" });
    ok("settle announced", true);
    await page.locator(".ledger").getByText("Order status: Settled").waitFor();
    ok("ledger shows Settled", true);
    await page.close();
  }

  // ---------- Journey 7: grower reviews the orchard ----------
  console.log("Journey 7 — grower reviews the orchard");
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(BASE + "/");
    await page.getByLabel("Email").fill("priya@harlanridge.example");
    await page.getByLabel("Password").fill("bloom-desk-2027");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/desk");
    await page.locator("nav[aria-label='Orchards']").getByRole("link", { name: "Harlan South Ranch" }).click();
    await page.getByRole("group", { name: "Plat map, Harlan South Ranch" }).waitFor();
    const blockButton = page.getByRole("button", { name: /Block 1, (None|Reduced|Standard|Bonus)/ });
    await blockButton.waitFor();
    ok("grower reads a block tier by label", true);
    await blockButton.click();
    await page.getByRole("table", { name: "Placements, Block 1" }).waitFor();
    ok("placements open for the block", true);
    const reportLink = page.getByRole("link", { name: "Inspection report (PDF)" });
    await reportLink.waitFor();
    const reportResponse = await page.request.get(BASE + "/api/orders/" + await orderIdOf(page, "HS-2027") + "/report");
    const report = await reportResponse.text();
    ok("signed report is a PDF", report.startsWith("%PDF"), report.slice(0, 20));
    const body = await page.locator("#main-canvas").innerText();
    ok("grower sees no beekeeper pay", !body.includes("Coulee Gold Bees") && !body.includes("Prairie Lantern Honey"), body.slice(0, 200));
    ok("grower sees no commission", !body.toLowerCase().includes("commission"), "");
    await page.close();
  }

  console.log(`\n${passed} browser checks passed`);
  await browser.close();
}

async function orderIdOf(page: import("playwright").Page, ref: string): Promise<string> {
  return page.evaluate(async (orderRef) => {
    const response = await fetch("/api/orders");
    const orders = await response.json() as { id: string; ref: string }[];
    return orders.find((order) => order.ref === orderRef)?.id ?? "";
  }, ref);
}

await main().catch((error) => {
  console.error(error);
  process.exit(1);
});
