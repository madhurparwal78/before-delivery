/**
 * Visual compliance: touch target sizes, WCAG 2.2 AA contrast in every lighting
 * state, focus rings, and the published data attributes.
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
const eq = (name, a, e) => {
  const same = JSON.stringify(a) === JSON.stringify(e);
  check(name, same, same ? undefined : { actual: a, expected: e });
};

async function signIn(page, email, password) {
  await page.goto(`${BASE}/signin`);
  const main = page.locator("main");
  await main.getByRole("textbox", { name: "Email" }).fill(email);
  await main.getByRole("textbox", { name: "Password" }).fill(password);
  await main.getByRole("button", { name: "Sign in" }).click();
  await page.waitForFunction(() => !location.pathname.startsWith("/signin"), null, { timeout: 8000 });
}

/** Relative luminance and contrast ratio, as WCAG defines them. */
const CONTRAST_HELPERS = `
  const parse = (value) => {
    const n = value.match(/[\\d.]+/g);
    return n ? n.slice(0, 3).map(Number) : [0, 0, 0];
  };
  const lum = ([r, g, b]) => {
    const f = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const la = lum(parse(a));
    const lb = lum(parse(b));
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const effectiveBackground = (el) => {
    let node = el;
    while (node) {
      const bg = getComputedStyle(node).backgroundColor;
      const alpha = bg.startsWith("rgba") ? Number(bg.match(/[\\d.]+/g)[3]) : 1;
      if (alpha > 0) return bg;
      node = node.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
`;

async function run() {
  const browser = await chromium.launch();

  /* ---------- touch targets at 375 and 768 ---------- */
  for (const [label, viewport] of [["375", PHONE], ["768", TABLET]]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await signIn(page, "rangi@kowhai-electrical.test", "Trade-approved-2026");

    for (const path of ["/catalogue", "/products/kauri-downlight", "/cart", "/signup", "/admin", "/projects"]) {
      await page.goto(`${BASE}${path}`);
      await page.waitForTimeout(700);
      const small = await page.evaluate(() => {
        const selectors = "button, a[href], input, select, textarea, [role=button]";
        const bad = [];
        for (const el of document.querySelectorAll(selectors)) {
          const style = getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") continue;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          // Chips hide a native input behind a 44px label, which is the real target.
          if (el.matches(".chip input") || el.matches(".consent input")) continue;
          // Fitting buttons carry their own 44px minimum.
          if (rect.width < 44 || rect.height < 44) {
            bad.push({
              tag: el.tagName,
              name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40),
              w: Math.round(rect.width),
              h: Math.round(rect.height),
            });
          }
        }
        return bad;
      });
      check(`every control is at least 44x44 at ${label} on ${path}`, small.length === 0, small);
    }
    await context.close();
  }

  /* ---------- WCAG 2.2 AA contrast in every lighting state ---------- */
  {
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    await signIn(page, "rangi@kowhai-electrical.test", "Trade-approved-2026");

    for (const state of ["Morning", "Day", "Evening", "Night", "Gallery"]) {
      await page.goto(`${BASE}/catalogue`);
      await page.waitForSelector("article.card");
      await page.getByRole("radio", { name: state, exact: true }).check();
      await page.waitForTimeout(250);

      const worst = await page.evaluate(`(() => {
        ${CONTRAST_HELPERS}
        const samples = [];
        const selectors = [
          "h1", "h2", "h3", ".card-title", ".price-line", "p.muted", ".small.muted",
          ".eyebrow", "thead th", "td", ".button", ".nav-link", ".chip span", ".readout-label",
          ".readout-value", ".badge", "label",
        ];
        for (const selector of selectors) {
          for (const el of [...document.querySelectorAll(selector)].slice(0, 6)) {
            const style = getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden") continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 2 || rect.height < 2) continue;
            if ((el.textContent ?? "").trim() === "") continue;
            const size = parseFloat(style.fontSize);
            const bold = Number(style.fontWeight) >= 700;
            // AA: 3:1 for large text (>=24px, or >=18.66px bold), else 4.5:1.
            const required = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
            const r = ratio(style.color, effectiveBackground(el));
            samples.push({ selector, size, required, ratio: Math.round(r * 100) / 100 });
          }
        }
        return samples.filter((s) => s.ratio < s.required);
      })()`);
      check(`${state} meets AA contrast for text`, worst.length === 0, worst);

      // The focus ring must contrast with the ground it sits on.
      const ringRatio = await page.evaluate(`(() => {
        ${CONTRAST_HELPERS}
        const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
        const hex = accent.replace("#", "");
        const rgb = "rgb(" + [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",") + ")";
        return Math.round(ratio(rgb, getComputedStyle(document.body).backgroundColor) * 100) / 100;
      })()`);
      check(`${state} focus ring contrasts with the ground`, ringRatio >= 3, ringRatio);
    }
    await context.close();
  }

  /* ---------- the focus ring is visible on every control ---------- */
  {
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    await page.goto(`${BASE}/catalogue`);
    await page.waitForSelector("article.card");
    const rings = await page.evaluate(() => {
      const results = [];
      for (const el of [...document.querySelectorAll("button, a[href], input, select")].slice(0, 30)) {
        el.focus();
        const style = getComputedStyle(el);
        const chip = el.closest(".chip");
        const outline = chip ? getComputedStyle(chip).outlineStyle : style.outlineStyle;
        const width = chip ? getComputedStyle(chip).outlineWidth : style.outlineWidth;
        results.push({
          tag: el.tagName,
          outline,
          width,
          ok: outline !== "none" && parseFloat(width) >= 1,
        });
      }
      return results;
    });
    check("every control shows a focus ring", rings.every((r) => r.ok), rings.filter((r) => !r.ok));
    await context.close();
  }

  /* ---------- the published root data attributes ---------- */
  {
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    await page.goto(`${BASE}/`);
    await page.waitForTimeout(500);
    const attributes = await page.evaluate(() => ({
      light: document.documentElement.dataset.light,
      mode: document.documentElement.dataset.lightMode,
    }));
    check("data-light carries a resolved state", ["morning", "day", "evening", "night", "gallery"].includes(attributes.light), attributes);
    check("data-light-mode carries auto or the choice", ["auto", "morning", "day", "evening", "night", "gallery"].includes(attributes.mode), attributes);

    // The home hero is a full-bleed 3D scene behind a small overlay title.
    eq("the home scene is the featured fitting", await page.getByRole("img", { name: "Kauri Downlight 3D model" }).count(), 1);
    const overlay = await page.locator(".hero-overlay h1").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    check("the overlay title stays restrained", overlay <= 40, overlay);
    eq("a link to the catalogue", await page.getByRole("link", { name: "Browse the catalogue" }).count(), 1);
    eq("a link to the trade application", await page.getByRole("link", { name: "Apply for a trade account" }).count(), 1);

    // At 375 the overlay text sits below the scene.
    const phone = await browser.newContext({ viewport: PHONE });
    const phonePage = await phone.newPage();
    await phonePage.goto(`${BASE}/`);
    await phonePage.waitForTimeout(600);
    const stage = await phonePage.locator(".hero-stage").boundingBox();
    const text = await phonePage.locator(".hero-overlay").boundingBox();
    check("the overlay text sits below the scene at 375", text.y >= stage.y + stage.height - 2, { stage, text });
    await phone.close();

    // The footer line.
    eq(
      "the footer line",
      (await page.locator(".footer .muted").last().textContent()).trim(),
      "Southerly Light Works \u00b7 \u014ctautahi Christchurch",
    );
    eq("the newsletter region", await page.getByRole("region", { name: "Newsletter" }).count(), 1);
    eq("the consent checkbox", await page.getByRole("checkbox", { name: "Send me the Lightfall newsletter" }).count(), 1);
    eq("the newsletter status", await page.getByRole("status", { name: "Newsletter status" }).count(), 1);
    await context.close();
  }

  /* ---------- DP-53: the newsletter, with consent ---------- */
  {
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    await page.goto(`${BASE}/`);
    await page.waitForTimeout(400);
    const footer = page.locator(".footer");
    await footer.getByRole("textbox", { name: "Email" }).fill("ui-news@example.test");
    await footer.getByRole("button", { name: "Subscribe" }).click();
    await page.waitForTimeout(500);
    eq(
      "subscribing without consent is refused",
      await page.getByRole("status", { name: "Newsletter status" }).textContent(),
      "Tick the box to agree to the newsletter.",
    );
    await footer.getByRole("checkbox", { name: "Send me the Lightfall newsletter" }).check();
    await footer.getByRole("button", { name: "Subscribe" }).click();
    await page.waitForTimeout(1200);
    eq(
      "subscribing with consent is accepted",
      await page.getByRole("status", { name: "Newsletter status" }).textContent(),
      "Check your inbox. We've sent a confirmation link to ui-news@example.test.",
    );

    // Follow the emailed link.
    const { messages } = await (await fetch(`${process.env.MAILPIT_URL ?? "http://mailpit:8025"}/api/v1/messages?limit=200`)).json();
    const letter = messages.find((m) => m.Subject === "Confirm your Lightfall newsletter");
    check("the confirmation email arrives", Boolean(letter), messages.map((m) => m.Subject));
    const full = await (await fetch(`${process.env.MAILPIT_URL ?? "http://mailpit:8025"}/api/v1/message/${letter.ID}`)).json();
    const token = /newsletter\/confirm\?token=([a-f0-9]+)/.exec(full.Text)[1];
    await page.goto(`${BASE}/newsletter/confirm?token=${token}`);
    await page.waitForTimeout(900);
    eq("the confirmation page heading", await page.getByRole("heading", { level: 1 }).textContent(), "You're subscribed");
    await page.goto(`${BASE}/newsletter/confirm?token=deadbeef`);
    await page.waitForTimeout(900);
    eq("an invalid link says so", await page.getByRole("heading", { level: 1 }).textContent(), "That confirmation link isn't valid.");
    await context.close();
  }

  await browser.close();
  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  if (failures.length > 0) process.exitCode = 1;
}

await run();
