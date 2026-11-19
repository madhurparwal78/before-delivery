import { Router, type Request, type Response } from "express";
import { cases, caseSections, caseBody } from "../cases.js";
import { chairDrawing, conditionGround } from "../drawings.js";
import { esc, pageLayout, publicHeader, publicFooter, notFoundBody } from "./html.js";

export const renderPages = Router();

renderPages.get("/", (req: Request, res: Response) => {
  const body = `
${publicHeader("")}
<main id="main">
  <h1 class="home-headline">ONE CHAIR AT A TIME.</h1>
  <p class="home-sub">A conservator's desk in Turin, re-covering twentieth-century design chairs for Turin, London, New York, Kyoto and Dubai.</p>
  <a class="mint-link" href="/enquire">Send an enquiry</a>
  <section class="home-row">
    <div class="tile tile-mint"><p class="tile-figure">38.75</p><p class="tile-caption">sq ft of one hide used for the Bentwood armchair</p></div>
    <div class="tile tile-drawing">${chairDrawing("bentwood", 220, 200)}</div>
    <div class="tile tile-drawing">${conditionGround(320, 240)}</div>
  </section>
</main>
${publicFooter}`;
  res.send(pageLayout({ title: "Bottega Semenza", body }));
});

renderPages.get("/work", (req: Request, res: Response) => {
  const kind = typeof req.query.kind === "string" && ["leather", "fabric", "frame-only"].includes(req.query.kind) ? (req.query.kind as string) : null;
  const shown = kind ? cases.filter((c) => c.kind === kind) : cases;
  const tiles = shown
    .map(
      (c) => `<a class="case-tile" href="/work/${c.slug}" data-case="${c.slug}">
      <div class="case-drawing" data-part="case-drawing" data-case="${c.slug}">${chairDrawing(c.chair)}</div>
      <h2>${esc(c.title)}</h2><p>${esc(c.figure)}</p></a>`
    )
    .join("\n");
  const body = `
${publicHeader("work")}
<main id="main">
  <h1>Work</h1>
  <div class="kind-filter">
    <fieldset role="radiogroup" aria-label="Kind" class="kind-group" id="kind-group" data-kind="${kind ?? ""}">
      <label><input type="radio" name="kind" value="all" ${kind ? "" : "checked"}><span>All</span></label>
      <label><input type="radio" name="kind" value="leather" ${kind === "leather" ? "checked" : ""}><span>Leather</span></label>
      <label><input type="radio" name="kind" value="fabric" ${kind === "fabric" ? "checked" : ""}><span>Fabric</span></label>
      <label><input type="radio" name="kind" value="frame-only" ${kind === "frame-only" ? "checked" : ""}><span>Frame only</span></label>
    </fieldset>
  </div>
  <div class="case-grid" id="case-grid">${tiles || "<p>No cases here.</p>"}</div>
</main>
${publicFooter}`;
  res.send(pageLayout({ title: "Work — Bottega Semenza", body }));
});

renderPages.get("/work/:slug", (req: Request, res: Response) => {
  const spec = cases.find((c) => c.slug === req.params.slug);
  if (!spec) {
    res.status(404).send(pageLayout({ title: "Page not found", body: notFoundBody() }));
    return;
  }
  const rail = caseSections
    .map((s, i) => `<a href="${s.hash}" class="rail-link"><span class="rail-number">${String(i + 1).padStart(2, "0")}</span> <span>${esc(s.heading)}</span></a>`)
    .join("\n");
  const sections = caseSections
    .map(
      (s) => `<section id="${s.hash.slice(1)}" class="case-section">
      <h2 id="${s.hash.slice(1)}-heading">${esc(s.heading)}</h2>
      ${(caseBody[s.hash.slice(1)] ?? []).map((p) => `<p>${esc(p)}</p>`).join("")}
    </section>`
    )
    .join("\n");
  const body = `
${publicHeader("work")}
<main id="main">
  <div class="case-hero" data-part="case-drawing" data-case="${spec.slug}" data-hero="true">${chairDrawing(spec.chair)}</div>
  <h1 id="case-title" tabindex="-1">${esc(spec.title)}</h1>
  <nav class="sections-rail" aria-label="Sections">${rail}</nav>
  <div class="case-body">
    ${sections}
  </div>
</main>
${publicFooter}`;
  res.send(pageLayout({ title: `${spec.title} — Bottega Semenza`, body }));
});

renderPages.get("/enquire", (req: Request, res: Response) => {
  const body = `
${publicHeader("enquire")}
<main id="main">
  <h1>Send an enquiry</h1>
  <form class="tile enquiry-form" data-endpoint="/api/enquiries">
    <label>Name<input type="text" name="name" autocomplete="name" required></label>
    <label>Email<input type="email" name="email" autocomplete="email" required></label>
    <label>Message<textarea name="message" required></textarea></label>
    <button type="submit" class="primary">Send enquiry</button>
    <p class="form-note" id="enquiry-note"></p>
  </form>
</main>
${publicFooter}`;
  res.send(pageLayout({ title: "Enquire — Bottega Semenza", body }));
});

renderPages.get("/sign-in", (req: Request, res: Response) => {
  const returnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : "";
  const body = `
<main id="main" class="auth-main">
  <a class="wordmark" href="/">Bottega Semenza</a>
  <h1 id="signin-heading" tabindex="-1">Sign in</h1>
  <form class="tile auth-form" data-endpoint="/api/session" data-return-to="${esc(returnTo)}">
    <label>Email<input type="email" name="email" autocomplete="email" required></label>
    <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
    <button type="submit" class="primary">Sign in</button>
    <p><a href="/sign-up">Start a desk</a></p>
  </form>
</main>`;
  res.send(pageLayout({ title: "Sign in — Semenza Desk", body, desk: true }));
});

renderPages.get("/sign-up", (req: Request, res: Response) => {
  const body = `
<main id="main" class="auth-main">
  <a class="wordmark" href="/">Bottega Semenza</a>
  <h1 id="signup-heading" tabindex="-1">Start a desk</h1>
  <form class="tile auth-form" data-endpoint="/api/sign-up">
    <label>Your name<input type="text" name="name" autocomplete="name" required></label>
    <label>Email<input type="email" name="email" autocomplete="email" required></label>
    <label>Password<input type="password" name="password" autocomplete="new-password" required></label>
    <button type="submit" class="primary">Start a desk</button>
  </form>
</main>`;
  res.send(pageLayout({ title: "Start a desk — Semenza Desk", body, desk: true }));
});

renderPages.use((req: Request, res: Response) => {
  res.status(404).send(pageLayout({ title: "Page not found", body: notFoundBody() }));
});
