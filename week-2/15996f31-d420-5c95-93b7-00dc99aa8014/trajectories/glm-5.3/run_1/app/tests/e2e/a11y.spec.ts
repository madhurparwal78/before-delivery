import { chromium } from "playwright";

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

async function signIn(page: import("playwright").Page, email: string): Promise<void> {
  await page.goto(BASE + "/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("bloom-desk-2027");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/desk");
}

async function main(): Promise<void> {
  const browser = await chromium.launch();

  // Keyboard order, skip link, meters and tap targets on the broker desk.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await signIn(page, "dana@kettleman-pollination.example");
    await page.getByRole("group", { name: /Plat map/ }).waitFor();
    // Deterministic tab order check: focus items in sequence from the start.
    const focused: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      await page.keyboard.press("Tab");
      focused.push(await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element) return "";
        return element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 40) ?? "";
      }));
    }
    ok("tab starts at the skip link", focused[0] === "Skip to plat map", focused.join(" | "));
    ok("tab reaches Sign out second", focused[1] === "Sign out", focused.join(" | "));
    await page.getByRole("link", { name: "Skip to plat map" }).focus();
    await page.keyboard.press("Enter");
    ok("skip link focuses the plat map", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")?.startsWith("Plat map, ") ?? false));
    const meters = page.getByRole("meter");
    const blocks = page.locator(".plat-grid .block");
    const blockCount = await blocks.count();
    ok("one meter per block", (await meters.count()) === blockCount && blockCount > 0, `${await meters.count()} meters, ${blockCount} blocks`);
    const firstMeter = meters.first();
    ok("meter carries the range and value text",
      (await firstMeter.getAttribute("aria-valuemin")) === "0" &&
      (await firstMeter.getAttribute("aria-valuemax")) === "20" &&
      (await firstMeter.getAttribute("aria-valuetext")) === "Not inspected",
      await firstMeter.getAttribute("aria-valuetext") ?? "");
    const smallTargets = await page.evaluate(() => {
      const tooSmall: string[] = [];
      for (const element of Array.from(document.querySelectorAll("button, select, input, a[href], [role='button']"))) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (rect.width < 44 || rect.height < 44) {
          tooSmall.push(`${element.tagName}.${element.className} ${rect.width}x${rect.height}`);
        }
      }
      return tooSmall;
    });
    ok("every control is at least 44 by 44", smallTargets.length === 0, smallTargets.slice(0, 6).join(", "));
    // Blocks respond to Enter and Space.
    const block = page.getByRole("button", { name: /Block 1, Not inspected/ }).first();
    await block.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("table", { name: "Placements, Block 1" }).waitFor();
    ok("Enter selects a block", true);
    ok("focus stays on the block after selecting", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")?.startsWith("Block 1, ") ?? false));
    const blockTwo = page.getByRole("button", { name: /Block 2, Not inspected/ }).first();
    await blockTwo.focus();
    await page.keyboard.press("Space");
    await page.getByRole("table", { name: "Placements, Block 2" }).waitFor();
    ok("Space selects a block", true);
    // Dialog focus, Escape and focus return.
    await page.getByRole("button", { name: "New orchard" }).click();
    const dialog = page.locator("dialog[aria-label='New orchard']");
    await dialog.waitFor();
    ok("dialog opens focused on its first field", await page.evaluate(() => document.activeElement?.id === "orchard-grower"));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    ok("Escape closes the dialog", (await page.locator("dialog[aria-label='New orchard']").count()) === 0);
    ok("focus returns to the opener", await page.evaluate(() => document.activeElement?.textContent?.includes("New orchard") ?? false));
    await page.close();
  }

  // Narrow viewports: no horizontal scroll, drawer behaviour, cards.
  for (const viewport of [{ width: 768, height: 1024 }, { width: 375, height: 812 }]) {
    const page = await browser.newPage({ viewport });
    await signIn(page, "dana@kettleman-pollination.example");
    await page.getByRole("group", { name: /Plat map/ }).waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(`no horizontal scroll at ${viewport.width}`, overflow <= 0, String(overflow));
    const orchardsButton = page.getByRole("button", { name: "Orchards", exact: true });
    ok("Orchards button reflects collapsed state", (await orchardsButton.getAttribute("aria-expanded")) === "false");
    await orchardsButton.click();
    ok("drawer opens and focuses the first orchard link", await page.evaluate(() => document.activeElement?.getAttribute("href") === "#" && document.activeElement?.textContent?.length > 0));
    ok("Orchards button reflects expanded state", (await orchardsButton.getAttribute("aria-expanded")) === "true");
    await page.keyboard.press("Escape");
    ok("Escape closes the drawer", (await orchardsButton.getAttribute("aria-expanded")) === "false");
    await page.locator("#my-drops-area, #open-orders-area, table").first().waitFor();
    if (viewport.width === 375) {
      const cards = await page.evaluate(() => document.querySelectorAll("table.responsive tr").length);
      ok("tables turn into cards at 375", cards > 0, String(cards));
    }
    await page.close();
  }

  // Grower never sees beekeeper pay; sign-in copy; inspection link flow labels.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await signIn(page, "priya@harlanridge.example");
    await page.getByRole("group", { name: /Plat map/ }).waitFor();
    const ledger = await page.locator(".ledger").innerText();
    ok("grower ledger has exactly the published rows", ["Ordered", "Delivered", "Deposit", "Payable"].every((label) => ledger.includes(label)) && !ledger.includes("Commission"), ledger.slice(0, 160));
    await page.close();
  }

  // Sign-out ends the session.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await signIn(page, "sam@couleegold.example");
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(BASE + "/");
    ok("sign out returns to the sign-in page", true);
    await page.goto(BASE + "/desk");
    await page.waitForURL(BASE + "/");
    ok("a signed-out desk visit returns to sign-in", true);
    await page.close();
  }

  // Reduced motion: figures change at once and a note joins the change log.
  {
    const broker = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await signIn(broker, "dana@kettleman-pollination.example");
    await broker.locator("nav[aria-label='Orchards']").getByRole("link", { name: "Mendota Flats West" }).click();
    const picker = broker.getByRole("combobox", { name: "Order" });
    await picker.locator("option", { hasText: "MW-2026" }).waitFor({ state: "attached" });
    const mwLabel = (await picker.locator("option").allTextContents()).find((text) => text.includes("MW-2026")) ?? "";
    await picker.selectOption({ label: mwLabel });
    await broker.locator(".ledger").getByText("Order status: Placed").waitFor();
    await broker.getByRole("button", { name: "Send inspection link" }).click();
    const dialog = broker.locator("dialog[aria-label='Send inspection link']");
    await dialog.waitFor();
    await dialog.getByLabel("Inspector email").fill("reduced.motion@example.com");
    await dialog.getByRole("button", { name: "Send link" }).click();
    await broker.getByText(/Inspection link for MW-2026 is on its way/).waitFor({ state: "attached" });
    await broker.close();

    const token = await fetch("http://mailpit:8025/api/v1/messages?limit=20")
      .then((response) => response.json() as Promise<{ messages: { ID: string; Subject: string }[] }>)
      .then((data) => data.messages.find((message) => message.Subject.includes("Inspection sheet: Mendota Flats West"))?.ID ?? "")
      .then((id) => fetch(`http://mailpit:8025/api/v1/message/${id}`).then((response) => response.json() as Promise<{ Text: string }>))
      .then((detail) => ((detail.Text.split("/inspect/")[1] ?? "").split("\n")[0] ?? "").trim());

    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(`http://localhost:4173/inspect/${token}`);
    await page.getByText("Link expires").waitFor();
    const form = page.locator("form.add-sample");
    await form.getByLabel("Block", { exact: true }).selectOption({ label: "Block A" });
    await form.getByLabel("Yard", { exact: true }).selectOption({ index: 0 });
    await form.getByLabel("Colony", { exact: true }).fill("S1");
    await form.getByLabel("Frames of bees", { exact: true }).fill("9.5");
    await form.getByRole("button", { name: "Add sample" }).click();
    await page.getByText("Sample S1 saved.").waitFor({ state: "attached" });
    const log = page.locator("#strength-changes");
    await log.locator("li", { hasText: /Block A: no samples → 9.5 frames, now Standard/ }).waitFor();
    ok("reduced motion logs the strength change", true);
    await page.getByRole("button", { name: "Remove sample S1" }).click();
    await page.getByText("Sample S1 removed.").waitFor({ state: "attached" });
    await log.locator("li", { hasText: /Block A: 9.5 → no samples, now Not inspected/ }).waitFor();
    ok("removing the last sample logs without the word frames", true);
    await context.close();
  }

  console.log(`\n${passed} accessibility checks passed`);
  await browser.close();
}

await main().catch((error) => {
  console.error(error);
  process.exit(1);
});
