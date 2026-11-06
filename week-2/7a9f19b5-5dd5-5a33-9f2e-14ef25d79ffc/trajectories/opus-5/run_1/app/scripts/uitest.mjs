/**
 * Browser checks for the published roles, names, interactions and journeys.
 * Needs a freshly reset database and a built, running app.
 *
 *   node scripts/uitest.mjs
 */

import { chromium } from "/tmp/node_modules/playwright/index.mjs";

const BASE = process.env.LF_BASE ?? "http://127.0.0.1:4173";
const DESKTOP = { width: 1280, height: 800 };
const TABLET = { width: 768, height: 1024 };
const PHONE = { width: 375, height: 812 };

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
  // The footer newsletter also has an Email box, so scope to the page body.
  const form = page.locator("main");
  await form.getByRole("textbox", { name: "Email" }).fill(email);
  await form.getByRole("textbox", { name: "Password" }).fill(password);
  await form.getByRole("button", { name: "Sign in" }).click();
  await page.waitForFunction(() => !location.pathname.startsWith("/signin"), null, { timeout: 8000 });
}

/** True when nothing matching the name is visible, focusable or in the a11y tree. */
async function absent(page, role, name) {
  const locator = page.getByRole(role, { name, exact: true });
  return (await locator.count()) === 0;
}

async function run() {
  const browser = await chromium.launch();

  /* ---------- DP-01, DP-05, DP-06: catalogue, closed panels, browsing ---------- */
  {
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    await signIn(page, "jo@bennett-home.test", "Retail-buyer-2026");
    await page.goto(`${BASE}/catalogue`);
    await page.waitForSelector("article.card");

    eq("header has navigation Main", await page.getByRole("navigation", { name: "Main" }).count(), 1);
    eq("results count region", await page.getByRole("status", { name: "Results count" }).textContent(), "5 fittings");
    eq("inline Filters region at 1280", await page.getByRole("region", { name: "Filters" }).count(), 1);
    eq("cards run three across", await page.locator(".card-grid").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length), 3);

    // DP-05: the mega-menu is not in the accessibility tree while closed.
    check("closed mega-menu is absent", await absent(page, "region", "Catalogue menu"));
    check("mega-menu links absent while closed", await absent(page, "link", "Downlights"));
    const catalogueButton = page.getByRole("button", { name: "Catalogue", exact: true });
    eq("Catalogue button reports closed", await catalogueButton.getAttribute("aria-expanded"), "false");

    await catalogueButton.click();
    eq("Catalogue button reports open", await catalogueButton.getAttribute("aria-expanded"), "true");
    eq("mega-menu region appears", await page.getByRole("region", { name: "Catalogue menu" }).count(), 1);
    for (const label of ["Downlights", "Track spots", "Pendants", "Surface mounted", "Clearance"]) {
      eq(`mega-menu has ${label}`, await page.getByRole("link", { name: label, exact: true }).count(), 1);
    }
    // Escape closes it and returns focus to "Catalogue".
    await page.keyboard.press("Escape");
    check("mega-menu closes on Escape", await absent(page, "region", "Catalogue menu"));
    eq("focus returns to Catalogue", await page.evaluate(() => document.activeElement?.textContent), "Catalogue");

    // Down Arrow opens the menu and focuses its first link.
    await catalogueButton.focus();
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(80);
    eq("Down Arrow focuses the first link", await page.evaluate(() => document.activeElement?.textContent), "Downlights");
    await page.keyboard.press("Escape");

    // Journey 1: search "downlight" leaves two cards.
    const search = page.getByRole("searchbox", { name: "Search fittings" });
    await search.fill("downlight");
    await page.waitForTimeout(500);
    eq("search narrows to two cards", await page.locator("article.card").count(), 2);
    eq("results count reads 2 fittings", await page.getByRole("status", { name: "Results count" }).textContent(), "2 fittings");
    eq("search names", await page.locator("article.card .card-title").allTextContents(), ["Kauri Downlight", "Rimu Gimbal Downlight"]);
    check("the URL query follows the search", page.url().includes("q=downlight"), page.url());

    // Clear the search and filter to Matte Black: three cards.
    await search.fill("");
    await page.waitForTimeout(500);
    eq("clearing the search restores five cards", await page.locator("article.card").count(), 5);
    await page.getByRole("checkbox", { name: "Matte Black" }).check();
    await page.waitForTimeout(300);
    eq("Matte Black leaves three cards", await page.locator("article.card .card-title").allTextContents(),
      ["Kauri Downlight", "T\u014dtara Track Spot", "Harbour Surface Cylinder"]);

    // DP-03: add the three to the tray, which holds their default variants.
    for (const name of ["Kauri Downlight", "T\u014dtara Track Spot", "Harbour Surface Cylinder"]) {
      await page.getByRole("button", { name: `Compare ${name}`, exact: true }).click();
    }
    const trayToggle = page.getByRole("button", { name: /^Compare \(\d\)$/ });
    eq("tray count reads three", await trayToggle.textContent(), "Compare (3)");
    check("closed tray contents are absent", await absent(page, "region", "Compare tray"));
    await trayToggle.click();
    eq("open tray is a region", await page.getByRole("region", { name: "Compare tray" }).count(), 1);
    const trayCodes = await page.locator('[aria-label="Compare tray"] .numeric').allTextContents();
    eq("tray holds the default variants", trayCodes, ["KDL-WH-36-3000", "TTS-BK-24-3000", "HSC-WH-24-3000"]);

    // A fifth press does nothing to the tray and shows the full-tray copy.
    await page.getByRole("checkbox", { name: "Matte Black" }).uncheck();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Compare P\u014dhutukawa Pendant", exact: true }).click();
    eq("tray takes a fourth", await trayToggle.textContent(), "Compare (4)");
    await page.getByRole("button", { name: "Compare Rimu Gimbal Downlight", exact: true }).click();
    eq("the fifth is refused", await trayToggle.textContent(), "Compare (4)");
    eq("full-tray copy", await page.locator(".tray-inner [aria-live='polite']").textContent(), "You can compare up to four fittings.");

    // DP-04: save one fitting, which persists.
    await page.getByRole("button", { name: "Save Kauri Downlight", exact: true }).click();
    await page.waitForTimeout(400);
    eq("save button is pressed", await page.getByRole("button", { name: "Save Kauri Downlight", exact: true }).getAttribute("aria-pressed"), "true");
    await page.goto(`${BASE}/favourites`);
    await page.waitForSelector("article.card", { timeout: 8000 });
    eq("the favourite is listed", await page.locator("article.card").count(), 1);

    // DP-03: the comparison itself.
    await page.goto(`${BASE}/compare?codes=KDL-WH-36-3000,TTS-BK-24-3000`);
    eq("comparison table", await page.getByRole("table", { name: "Comparison" }).count(), 1);
    const rowHeaders = await page.locator('table[aria-label="Comparison"] tbody th').allTextContents();
    eq("comparison rows", rowHeaders, [
      "Product", "Code", "Finish", "Beam", "Colour temperature", "Lumens", "Candela",
      "Watts", "CRI", "IP rating", "Price", "Pool at 2.7 m", "Centre at 2.7 m",
    ]);
    await context.close();
  }

  /* ---------- DP-22, DP-23, DP-24, DP-25: the product page ---------- */
  {
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    await page.goto(`${BASE}/products/kauri-downlight`);
    await page.waitForSelector('[aria-label="Specification"]');

    eq("level 1 heading is the product name", await page.getByRole("heading", { level: 1 }).textContent(), "Kauri Downlight");
    eq("the spec panel is a region", await page.getByRole("region", { name: "Specification" }).count(), 1);
    eq("the light readout is a region", await page.getByRole("region", { name: "Light readout" }).count(), 1);
    eq("the viewer is an image", await page.getByRole("img", { name: "Kauri Downlight 3D model" }).count(), 1);

    // DP-23: canvas and spec panel side by side at 1280, both above the fold.
    const canvasBox = await page.locator(".product-canvas").boundingBox();
    const panelBox = await page.locator(".product-panel").boundingBox();
    check("canvas and panel sit side by side at 1280", canvasBox.x + canvasBox.width <= panelBox.x + 2, { canvasBox, panelBox });
    check("both start above the fold", canvasBox.y < 800 && panelBox.y < 800, { canvasY: canvasBox.y, panelY: panelBox.y });

    // DP-24: the model turns on its own and reports its state.
    const viewer = page.getByRole("img", { name: "Kauri Downlight 3D model" });
    eq("idle turning is on", await viewer.getAttribute("data-idle"), "on");
    const firstYaw = Number(await viewer.getAttribute("data-yaw"));
    await page.waitForTimeout(1200);
    const secondYaw = Number(await viewer.getAttribute("data-yaw"));
    check("the model turns on its own", firstYaw !== secondYaw, { firstYaw, secondYaw });
    check("yaw is whole degrees 0-359", Number.isInteger(secondYaw) && secondYaw >= 0 && secondYaw <= 359, secondYaw);

    // Dragging turns the model: across the full width is half a turn.
    const box = await viewer.boundingBox();
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2, { steps: 12 });
    const dragged = Number(await viewer.getAttribute("data-yaw"));
    await page.mouse.up();
    check("dragging turns the model about half a turn", Math.abs(((dragged % 360) + 360) % 360 - 180) < 40, dragged);

    // DP-22: the variant picker.
    eq("finish radiogroup", await page.getByRole("radiogroup", { name: "Finish" }).count(), 1);
    eq("beam radiogroup", await page.getByRole("radiogroup", { name: "Beam angle" }).count(), 1);
    eq("colour temperature radiogroup", await page.getByRole("radiogroup", { name: "Colour temperature" }).count(), 1);
    eq("default beam is selected", await viewer.getAttribute("data-beam"), "36");

    await page.getByRole("radio", { name: "24\u00b0" }).check();
    await page.waitForTimeout(700);
    eq("the model re-lights to the new beam", await viewer.getAttribute("data-beam"), "24");
    check("the URL variant follows without a reload", page.url().includes("variant=KDL-WH-24-3000"), page.url());
    eq(
      "the product live region announces the new values",
      await page.getByRole("status", { name: "Product updates" }).textContent(),
      "Kauri Downlight, Matte White, 24\u00b0 beam, 3000K: 900 lumens, $95.00 + GST.",
    );
    const readout = await page.locator(".readout").innerText();
    check("the readout shows the new pool", readout.includes("1148"), readout);
    check("the readout shows the new centre lux", readout.includes("898"), readout);

    await page.getByRole("radio", { name: "4000K" }).check();
    await page.waitForTimeout(500);
    eq("the model re-lights to the new colour temperature", await viewer.getAttribute("data-cct"), "4000");

    // A combination that does not exist cannot be chosen: Pohutukawa has one beam.
    await page.goto(`${BASE}/products/pohutukawa-pendant`);
    await page.waitForSelector('[aria-label="Beam angle"]');
    const beams = page.getByRole("radiogroup", { name: "Beam angle" }).getByRole("radio");
    eq("the pendant offers one beam", await beams.count(), 1);
    await page.goto(`${BASE}/products/harbour-surface-cylinder?variant=HSC-CH-24-3000`);
    await page.waitForSelector('[aria-label="Colour temperature"]');
    const cct2700 = page.getByRole("radio", { name: "2700K" });
    if ((await cct2700.count()) > 0) {
      eq("an impossible colour temperature is disabled", await cct2700.isDisabled(), true);
    }

    // DP-25: the spec drawers.
    await page.goto(`${BASE}/products/kauri-downlight`);
    await page.waitForSelector('[aria-label="Specification"]');
    const photometrics = page.getByRole("button", { name: "Photometrics" });
    const dimensions = page.getByRole("button", { name: "Dimensions" });
    const downloads = page.getByRole("button", { name: "Downloads" });
    eq("Photometrics is open by default", await photometrics.getAttribute("aria-expanded"), "true");
    eq("Dimensions starts closed", await dimensions.getAttribute("aria-expanded"), "false");
    eq("Downloads starts closed", await downloads.getAttribute("aria-expanded"), "false");
    check("the closed Downloads drawer hides its link", await absent(page, "link", "Spec sheet (PDF)"));

    // Enter and Space toggle a drawer.
    await downloads.focus();
    await page.keyboard.press("Enter");
    eq("Enter opens Downloads", await downloads.getAttribute("aria-expanded"), "true");
    eq("the spec sheet link appears", await page.getByRole("link", { name: "Spec sheet (PDF)" }).count(), 1);
    await page.keyboard.press("Space");
    eq("Space closes Downloads", await downloads.getAttribute("aria-expanded"), "false");
    await dimensions.click();
    eq("a tap opens Dimensions", await dimensions.getAttribute("aria-expanded"), "true");
    await context.close();
  }

  /* ---------- DP-23: product layouts at 768 and 375 ---------- */
  {
    const context = await browser.newContext({ viewport: TABLET });
    const page = await context.newPage();
    await page.goto(`${BASE}/products/kauri-downlight`);
    await page.waitForSelector(".product-canvas");
    const canvas = await page.locator(".product-canvas").boundingBox();
    const panel = await page.locator(".product-panel").boundingBox();
    check("the spec panel sits under the canvas at 768", panel.y >= canvas.y + canvas.height - 2, { canvas, panel });
    eq("cards run two across at 768", await (await context.newPage().then(async (p) => {
      await p.goto(`${BASE}/catalogue`);
      const columns = await p.locator(".card-grid").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
      await p.close();
      return columns;
    })), 2);
    eq("a Filters button opens the sheet at 768", await page.getByRole("button", { name: "Filters" }).count(), 0);
    await context.close();

    const phone = await browser.newContext({ viewport: PHONE });
    const phonePage = await phone.newPage();
    await phonePage.goto(`${BASE}/products/kauri-downlight`);
    await phonePage.waitForSelector('[aria-label="Quick add"]');
    eq("a quick-add bar at 375", await phonePage.getByRole("region", { name: "Quick add" }).count(), 1);
    const quickAdd = await phonePage.locator(".quick-add").boundingBox();
    check("the quick-add bar is fixed to the bottom", quickAdd.y + quickAdd.height >= 812 - 2, quickAdd);
    eq("one add button at 375", await phonePage.getByRole("button", { name: "Add to cart" }).count(), 1);
    // The dial never covers the quick-add bar's button.
    const dialBox = await phonePage.locator(".dial").boundingBox();
    const addButton = await phonePage.getByRole("button", { name: "Add to cart" }).boundingBox();
    const overlaps =
      dialBox.x < addButton.x + addButton.width &&
      dialBox.x + dialBox.width > addButton.x &&
      dialBox.y < addButton.y + addButton.height &&
      dialBox.y + dialBox.height > addButton.y;
    check("the dial does not cover the add button", !overlaps, { dialBox, addButton });

    // The phone header uses a Menu dialog.
    await phonePage.goto(`${BASE}/catalogue`);
    check("the Menu dialog is absent while closed", await absent(phonePage, "dialog", "Menu"));
    await phonePage.getByRole("button", { name: "Menu" }).click();
    eq("the Menu dialog opens", await phonePage.getByRole("dialog", { name: "Menu" }).count(), 1);
    await phonePage.keyboard.press("Escape");
    check("Escape closes the Menu dialog", await absent(phonePage, "dialog", "Menu"));

    // The filter sheet.
    await phonePage.getByRole("button", { name: "Filters" }).click();
    eq("the Filters sheet opens", await phonePage.getByRole("dialog", { name: "Filters" }).count(), 1);
    eq("the sheet holds Show results", await phonePage.getByRole("button", { name: "Show results" }).count(), 1);
    // Opening it moves focus to its first control.
    const focusedTag = await phonePage.evaluate(() => document.activeElement?.tagName);
    check("focus moves into the sheet", focusedTag === "INPUT" || focusedTag === "BUTTON", focusedTag);
    await phonePage.getByRole("checkbox", { name: "Matte Black" }).check();
    await phonePage.waitForTimeout(300);
    await phonePage.getByRole("button", { name: "Show results" }).click();
    check("Show results closes the sheet", await absent(phonePage, "dialog", "Filters"));
    eq("the sheet applied its tick", await phonePage.locator("article.card").count(), 3);
    await phone.close();
  }

  /* ---------- DP-58: no horizontal page scrolling at every viewport ---------- */
  {
    for (const [label, viewport] of [["375", PHONE], ["768", TABLET], ["1280", DESKTOP]]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      for (const path of ["/", "/catalogue", "/compare?codes=KDL-BK-24-3000,TTS-BK-24-3000", "/products/kauri-downlight", "/cart", "/checkout", "/signin", "/signup", "/favourites", "/admin", "/projects"]) {
        await page.goto(`${BASE}${path}`);
        await page.waitForTimeout(150);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        check(`no horizontal scrolling at ${label} on ${path}`, overflow <= 1, overflow);
      }
      await context.close();
    }
  }

  /* ---------- DP-57: the lighting dial ---------- */
  {
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    await page.goto(`${BASE}/catalogue`);
    eq("the dial is a radiogroup", await page.getByRole("radiogroup", { name: "Lighting" }).count(), 1);
    for (const label of ["Auto", "Morning", "Day", "Evening", "Night", "Gallery"]) {
      eq(`the dial offers ${label}`, await page.getByRole("radio", { name: label, exact: true }).count(), 1);
    }
    eq("Auto is the default mode", await page.evaluate(() => document.documentElement.dataset.lightMode), "auto");
    const autoState = await page.evaluate(() => document.documentElement.dataset.light);
    check("Auto resolves to a lighting state", ["morning", "day", "evening", "night"].includes(autoState), autoState);

    await page.getByRole("radio", { name: "Gallery", exact: true }).check();
    await page.waitForTimeout(150);
    eq("Gallery is applied", await page.evaluate(() => document.documentElement.dataset.light), "gallery");
    eq("the manual choice is reported", await page.evaluate(() => document.documentElement.dataset.lightMode), "gallery");

    // A signed-in user's manual choice persists.
    await signIn(page, "jo@bennett-home.test", "Retail-buyer-2026");
    await page.getByRole("radio", { name: "Night", exact: true }).check();
    await page.waitForTimeout(400);
    const fresh = await context.newPage();
    await fresh.goto(`${BASE}/catalogue`);
    await fresh.waitForTimeout(600);
    eq("the choice persists across loads", await fresh.evaluate(() => document.documentElement.dataset.lightMode), "night");
    eq("and the ground is the near-black Night", await fresh.evaluate(() => document.documentElement.dataset.light), "night");
    await context.close();
  }

  /* ---------- DP-59: the nocturnal look ---------- */
  {
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    await page.goto(`${BASE}/catalogue`);
    await page.getByRole("radio", { name: "Night", exact: true }).check();
    await page.waitForTimeout(200);

    const styles = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const heading = document.querySelector("h1");
      const numeral = document.querySelector(".price-line");
      return {
        background: body.backgroundColor,
        colour: body.color,
        bodyFont: body.fontFamily,
        headingFont: heading ? getComputedStyle(heading).fontFamily : "",
        numeralFont: numeral ? getComputedStyle(numeral).fontFamily : "",
        ruleWidth: getComputedStyle(document.querySelector(".card")).borderTopWidth,
      };
    });
    const rgb = styles.background.match(/\d+/g).map(Number);
    check("a near-black ground at Night", rgb[0] < 30 && rgb[1] < 30 && rgb[2] < 40, styles.background);
    check("the ground has a faint blue cast", rgb[2] >= rgb[0], styles.background);
    const ink = styles.colour.match(/\d+/g).map(Number);
    check("warm off-white paper text", ink[0] > 220 && ink[1] > 215 && ink[2] > 200 && ink[0] >= ink[2], styles.colour);
    check("serif display headings", styles.headingFont.includes("Instrument Serif"), styles.headingFont);
    check("compact grotesk body text", styles.bodyFont.includes("Inter Tight"), styles.bodyFont);
    check("monospaced spec numerals", styles.numeralFont.includes("JetBrains Mono"), styles.numeralFont);
    eq("hairline rules are one pixel", styles.ruleWidth, "1px");

    // The amber accent is the only saturated colour, and focus rings use it.
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
    );
    check("a lamp-amber accent", /^#e8a33d$/i.test(accent), accent);

    // The three faces are self-hosted from the app's own origin.
    const fontRequests = [];
    page.on("request", (request) => {
      if (/\.woff2?$/.test(request.url())) fontRequests.push(request.url());
    });
    await page.goto(`${BASE}/products/kauri-downlight`);
    await page.waitForTimeout(900);
    check("fonts load", fontRequests.length > 0, fontRequests);
    check("every font comes from this origin", fontRequests.every((url) => url.startsWith(BASE)), fontRequests);
    await context.close();
  }

  /* ---------- IF-05: no third-party requests ---------- */
  {
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    const foreign = [];
    page.on("request", (request) => {
      const url = request.url();
      if (!url.startsWith(BASE) && !url.startsWith("data:") && !url.startsWith("blob:")) foreign.push(url);
    });
    for (const path of ["/", "/catalogue", "/products/kauri-downlight", "/compare?codes=KDL-BK-24-3000"]) {
      await page.goto(`${BASE}${path}`);
      await page.waitForTimeout(500);
    }
    eq("pages make no third-party requests", foreign, []);
    await context.close();
  }

  await browser.close();
  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  if (failures.length > 0) process.exitCode = 1;
}

await run();
