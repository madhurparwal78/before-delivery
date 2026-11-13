// Caller-bound HTML pages. Every page answers Cache-Control: no-store.
import { CHAPTERS, FINISHES, HUBS } from "./seed";

// The raw server HTML of the long page holds one side-elevation drawing for each of
// the seven chapters, carrying the reading for the URL's selection and the caller,
// even with scripts off. The attributes update in place from the live feed.
function elevations(): string {
  return CHAPTERS.map(
    (ch) =>
      `<img class="elevation" data-chapter="${ch.id}" alt="Side elevation, ${ch.name}" ` +
      `src="/elevations/${ch.id}.svg" data-needle-deg="-135" data-lamp="false" data-units="00" data-ride="--:--" data-tank="#2f3f5c">`
  ).join("\n");
}

interface PageOpts {
  title: string;
  body: string;
  script: string;
  hubLink?: boolean;
}

function page(o: PageOpts): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.title}</title>
<link rel="stylesheet" href="/app.css">
<link rel="preload" href="/fonts/gloock-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/rethinksans-400.woff2" as="font" type="font/woff2" crossorigin>
</head>
<body>
<div class="topbar"></div>
<header class="top">
  <div class="wordmark">Malhar Motor Works</div>
  <nav class="toplinks" id="toplinks">
    <a href="/showroom">Showroom</a>
    <a href="/test-ride" id="nav-testride">Test ride</a>
    <a href="/garage">Garage</a>
    ${o.hubLink ? `<a href="/hub" id="nav-hub">Hub console</a>` : ""}
  </nav>
  <button class="menu-btn" id="menu-btn" aria-expanded="false" aria-controls="toplinks">Menu</button>
</header>
<div id="elevation-root">${elevations()}</div>
${o.body}
<div class="status" role="status" aria-live="polite" aria-label="Showroom status" id="status"></div>
<script src="${o.script}" defer></script>
</body>
</html>`;
}

export function renderPage(path: string): string {
  switch (path) {
    case "/":
    case "/showroom":
      return renderShowroom();
    case "/test-ride":
      return renderTestRide();
    case "/garage":
      return renderGarage();
    case "/hub":
      return renderHub();
    default:
      return render404();
  }
}

function render404(): string {
  return page({
    title: "Not found - Malhar Key-On",
    body: `<main class="page">
      <section class="working">
        <h1 class="statement">We couldn't find that page.</h1>
        <p><a class="action-link" href="/showroom">Back to the showroom</a></p>
      </section>
    </main>`,
    script: "/showroom.js",
  });
}

const CHAPTER_BUTTONS = CHAPTERS.map((c) => `<button class="chapter-btn" data-ch="${c.id}" aria-pressed="false">${c.name}</button>`).join("");

function renderShowroom(): string {
  const body = `<main class="page" id="longpage">
  <section class="hero" id="hero">
    <div class="hero-word-clip" aria-hidden="true">
      <svg class="hero-word" role="img" aria-label="Malhar" viewBox="0 0 240 200" preserveAspectRatio="none">
        <text x="120" y="188" text-anchor="middle" textLength="236" lengthAdjust="spacingAndGlyphs">MALHAR</text>
      </svg>
    </div>
    <p class="hero-sentence">A motorcycle priced for your road, on the day you ride it away.</p>
    <a class="primary" href="/showroom?at=0" id="start-build">Start the build</a>
  </section>
  <div class="stage-wrap" id="stage-wrap">
    <div class="stage" id="stage">
      <canvas id="stage-canvas" aria-label="Malhar Megh 349 showroom" role="img"></canvas>
      <div class="stage-overlay">
        <h1 class="statement" id="chapter-statement">It starts as a frame.</h1>
      </div>
      <div class="toolbar-slot">
        <div role="toolbar" aria-label="Chapters" id="chapters-toolbar">
          ${CHAPTER_BUTTONS}
        </div>
      </div>
      <div class="parts-slot">
        <div role="listbox" aria-label="Parts" id="parts-list" tabindex="0" aria-activedescendant=""></div>
      </div>
      <button class="parts-btn" id="parts-btn" aria-expanded="false" aria-controls="parts-sheet" hidden>Parts</button>
      <dialog class="parts-sheet" id="parts-sheet" aria-label="Parts"><div role="listbox" aria-label="Parts" id="parts-sheet-list" tabindex="0" aria-activedescendant=""></div></dialog>
      <div class="controls controls-stage" id="stage-controls">
        <fieldset><legend>Model</legend><div role="radiogroup" aria-label="Model" id="model-group">
          <label><input type="radio" name="model" value="megh-349" checked> Megh 349</label>
          <label><input type="radio" name="model" value="desh-648"> Desh 648</label>
        </div></fieldset>
        <label class="ctl">Hub city
          <select id="hub-select" aria-label="Hub city">
            ${HUBS.map((h) => `<option value="${h.id}"${h.id === "pune" ? " selected" : ""}>${h.name}</option>`).join("")}
          </select>
        </label>
        <fieldset><legend>Finish</legend><div role="radiogroup" aria-label="Finish" id="finish-group">
          ${FINISHES.map((f, i) => `<label><input type="radio" name="finish" value="${f.id}"${i === 0 ? " checked" : ""}> ${f.name}</label>`).join("")}
        </div></fieldset>
      </div>
    </div>
    <div class="stage-space" id="stage-space"></div>
  </div>
  <section aria-label="On-road price" id="price-region">
    <h1 class="statement">Now it reads the truth.</h1>
    <div class="numerals" id="numerals">
      <div class="numeral-pair">
        <div class="numeral" id="ex-showroom">Reading price…</div>
        <p class="numeral-sentence">Ex-showroom, including GST.</p>
      </div>
      <div class="numeral-pair">
        <div class="numeral" id="on-road">Reading price…</div>
        <p class="numeral-sentence">On the road at your hub, today.</p>
      </div>
    </div>
    <p class="stock-line" id="stock-line">Reading price…</p>
    <p class="as-of" id="as-of" hidden></p>
    <button class="primary" id="lock-price" aria-disabled="true">Lock this price</button>
  </section>
  <section class="ride-invite">
    <h1 class="statement">Pick the hour you ride it.</h1>
    <a class="action-link" href="/test-ride">Book a test ride</a>
  </section>
  <footer class="footer"><span>MALHAR</span></footer>
</main>`;
  return page({ title: "Malhar Key-On showroom", body, script: "/showroom.js" });
}

function renderTestRide(): string {
  const body = `<main class="page">
  <section class="working">
    <h1 class="statement">Pick the hour you ride it.</h1>
    <div class="controls controls-row">
      <label class="ctl">Hub city
        <select id="hub-select" aria-label="Hub city">
          ${HUBS.map((h) => `<option value="${h.id}"${h.id === "pune" ? " selected" : ""}>${h.name}</option>`).join("")}
        </select>
      </label>
      <fieldset><legend>Model</legend><div role="radiogroup" aria-label="Model" id="model-group">
        <label><input type="radio" name="model" value="megh-349" checked> Megh 349</label>
        <label><input type="radio" name="model" value="desh-648"> Desh 648</label>
      </div></fieldset>
      <label class="ctl">Ride day
        <select id="ride-day" aria-label="Ride day"></select>
      </label>
    </div>
    <div role="grid" aria-label="Test-ride slots" id="slot-grid"></div>
    <div class="empty-state" id="day-empty" hidden>
      <p class="statement">Every slot on this day is taken.</p>
      <button class="primary" id="try-next-day">Try the next day</button>
    </div>
    <form class="licence" id="licence-form">
      <label>Licence number
        <input type="text" id="licence-number" autocomplete="off" aria-describedby="licence-number-note">
      </label>
      <p class="field-note" id="licence-number-note">Enter a licence number like MH1220190043210.</p>
      <label>Licence valid until
        <input type="text" id="licence-date" placeholder="YYYY-MM-DD" autocomplete="off" aria-describedby="licence-date-note">
      </label>
      <p class="field-note" id="licence-date-note">Your licence must be valid on the ride day.</p>
      <label class="check">
        <input type="checkbox" id="mcwg" aria-describedby="mcwg-note"> My licence covers motorcycles with gear (MCWG)
      </label>
      <p class="field-note" id="mcwg-note">A test ride needs a licence that covers motorcycles with gear.</p>
      <p class="field-error" id="licence-error" hidden></p>
    </form>
    <div class="actions">
      <button class="primary" id="book-ride">Book this ride</button>
      <button class="primary" id="move-ride" hidden>Move this ride</button>
      <button class="secondary" id="cancel-ride" hidden>Cancel this ride</button>
    </div>
  </section>
</main>`;
  return page({ title: "Test ride - Malhar Key-On", body, script: "/testride.js" });
}

function renderGarage(): string {
  const body = `<main class="page">
  <section class="working">
    <h1 class="statement" id="garage-statement">Nothing is held for you yet.</h1>
    <section aria-label="Your lock" id="lock-band" class="band"></section>
    <section aria-label="Your ride" id="ride-band" class="band"></section>
    <section aria-label="Your delivery" id="delivery-band" class="band"></section>
  </section>
</main>`;
  return page({ title: "Garage - Malhar Key-On", body, script: "/garage.js" });
}

function renderHub(): string {
  const body = `<main class="page">
  <section class="working">
    <h1 class="statement" id="hub-statement">Hub console.</h1>
    <div class="controls controls-row">
      <label class="ctl">Sheet date
        <select id="sheet-date" aria-label="Sheet date"></select>
      </label>
      <button class="secondary" id="go-today" hidden>Go to today</button>
    </div>
    <table class="sheet" aria-label="Day sheet" id="day-sheet">
      <thead><tr><th>Time</th><th>Rider</th><th>Machine</th><th>Licence</th><th>State</th><th>Action</th></tr></thead>
      <tbody id="day-sheet-body"></tbody>
    </table>
    <div class="empty-state" id="day-empty" hidden>
      <p class="statement">Nothing on this day.</p>
      <button class="secondary" id="sheet-go-today">Go to today</button>
    </div>
    <table class="sheet" aria-label="Held units" id="held-units">
      <thead><tr><th>Rider</th><th>Machine</th><th>Finish</th><th>Ends</th><th>State</th><th>Action</th></tr></thead>
      <tbody id="held-units-body"></tbody>
    </table>
    <div class="empty-state" id="held-empty" hidden>
      <p class="statement">Nothing is held at this hub.</p>
    </div>
    <table class="sheet" aria-label="Stock" id="stock-table">
      <thead><tr><th>Machine</th><th>Finish</th><th>On hand</th><th>Held</th><th>Units left</th></tr></thead>
      <tbody id="stock-body"></tbody>
    </table>
    <div class="actions">
      <button class="secondary" id="start-count">Start stock count</button>
      <button class="secondary" id="finish-count" hidden>Finish stock count</button>
    </div>
    <p class="field-error" id="count-error" hidden></p>
  </section>
</main>`;
  return page({ title: "Hub console - Malhar Key-On", body, script: "/hub.js", hubLink: true });
}
