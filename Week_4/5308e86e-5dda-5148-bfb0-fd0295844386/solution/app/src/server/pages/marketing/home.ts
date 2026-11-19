/** The home page: hero, product tour, the scroll-revealed cockpit still and the reasons to open an account. */
import { esc, type RenderedPage } from "../layout.js";
import { calendarArt, controlsArt, invoiceArt, receiptArt, routeArt, virtualCardArt } from "./art.js";
import { marketingDocument } from "./chrome.js";
import { icon, type IconName } from "./icons.js";
import { band, emailCapture, featurePanel, hero, linkButton, splitRows, tileGrid } from "./parts.js";
import { TOUR_CUES } from "./tour.js";

const COCKPIT_STILL = "/assets/img/cockpit-still.svg";

const LEDGER_POINTS: { glyph: IconName; title: string; body: string }[] = [
  { glyph: "chart", title: "Accounts and treasury", body: "Checking and savings in one sitting, with up to 3.75% on idle cash." },
  { glyph: "card", title: "Lift Card and spend controls", body: "Virtual cards with caps you set and 1.5 percent cashback on every purchase." },
  { glyph: "invoice", title: "Payments and invoicing", body: "No fees on USD payments, and each invoice settles into the account you choose." },
  { glyph: "scan", title: "Books and reconciliation", body: "Bookkeeping that reads from your ledger, so receipts match as they arrive." },
];

const SETUP_STEPS = [
  "Open an account without a branch visit",
  "Start spending with a virtual Lift Card the same day",
  "Find any payment or recipient from the search bar",
];

const EARNINGS: { figure: string; title: string }[] = [
  { figure: "$0", title: "No fees on USD payments" },
  { figure: "1.5%", title: "1.5 percent cashback" },
  { figure: "3.75%", title: "Up to 3.75% on idle cash in Treasury" },
];

const TRUST_STATS: { figure: string; label: string }[] = [
  { figure: "38,000", label: "companies" },
  { figure: "$4B+", label: "moved each month" },
  { figure: "40+", label: "currencies for wires" },
  { figure: "4.8", label: "average app rating" },
];

function announcementStrip(): string {
  return `<p class="announcement"><a href="/payroll"><span>New: Tallwind Payroll runs pay day from the same account that funds it</span>${icon("arrowRight")}</a></p>`;
}

function heroSection(): string {
  return hero({
    id: "home-title",
    title: "Calm banking for companies on the move",
    lede: "Open an account in one sitting and see every dollar your company holds, owes and is owed on one quiet screen.",
    className: "hero-home",
    actions: `${emailCapture()}
      <p class="hero-secondary">${linkButton("/demo", "Launch demo", "text", "play")}</p>
      <p class="legal-line">Deposits are held at our partner banks, Harbor Financial and Keystone N.A., each a Member FDIC.</p>
      <div class="hero-route" aria-hidden="true">${routeArt()}</div>`,
  });
}

function tourSection(): string {
  const transcript = TOUR_CUES.map((cue) => `<li>${esc(cue.text)}</li>`).join("");
  return `<section class="band tour" aria-labelledby="tour-title">
    <div class="container tour-grid">
      <div class="tour-copy">
        <h2 class="display section-title" id="tour-title">See the whole company in one minute</h2>
        <p class="band-lede">A short tour of the cockpit: every account, a payment moving, and a large payment waiting for its second approver.</p>
        <button class="btn btn-quiet" type="button" aria-expanded="false" aria-controls="tour-transcript" data-transcript-toggle>Show transcript</button>
        <div class="transcript" id="tour-transcript" hidden>
          <h3>Transcript</h3>
          <ol>${transcript}</ol>
        </div>
      </div>
      <figure class="tour-player">
        <video controls preload="none" poster="${COCKPIT_STILL}" aria-label="Tallwind product tour">
          <track kind="captions" label="English" srclang="en" src="/media/tour.vtt" default>
          <p>Your browser cannot play video. The transcript beside the tour has the same three lines.</p>
        </video>
      </figure>
    </div>
  </section>`;
}

function ledgerSection(): string {
  const points = LEDGER_POINTS.map(
    (point) => `<li class="ledger-point">
        <span class="tile-icon">${icon(point.glyph)}</span>
        <div><h3>${esc(point.title)}</h3><p>${esc(point.body)}</p></div>
      </li>`,
  ).join("");
  return `<section class="band band-ledger" aria-labelledby="ledger-title">
    <div class="container">
      <h2 class="display section-title" id="ledger-title">One ledger for the whole company.</h2>
      <div class="ledger-grid">
        <div class="ledger-still" data-reveal>
          <img src="${COCKPIT_STILL}" width="1200" height="720" alt="The Tallwind cockpit showing three accounts with their balances and the latest transactions">
          <div class="ledger-cover" data-reveal-cover></div>
        </div>
        <ul class="ledger-points">${points}</ul>
      </div>
    </div>
  </section>`;
}

function proofSection(): string {
  return `<section class="band" aria-labelledby="proof-title">
    <div class="container proof">
      <h2 class="display section-title" id="proof-title">Chosen by 38,000 small companies that would rather build than reconcile</h2>
      <figure class="testimonial">
        <blockquote><p>Tallwind replaced four tools with one calm screen; I see every dollar and move it in seconds.</p></blockquote>
        <figcaption><span class="avatar" aria-hidden="true">JA</span><span><strong>Jordan Ames</strong>, founder of Fieldstone</span></figcaption>
      </figure>
    </div>
  </section>`;
}

function runwaySection(): string {
  return band({
    id: "runway-title",
    title: "Less admin, more runway.",
    className: "band-tint",
    body: splitRows([
      { title: "Issue a virtual card before the meeting ends", body: "Name the card, set its cap and hand the number to whoever needs it. Every swipe lands in your ledger as it happens.", art: virtualCardArt() },
      { title: "Schedule bills around bank holidays", body: "Pick the day you want a bill paid. Tallwind moves it to the first Federal Reserve business day when the date falls on a holiday.", art: calendarArt() },
      { title: "Settle each invoice into the account you choose", body: "Mark an invoice paid and its total is credited to the account you pick, exactly once, even if you press twice.", art: invoiceArt() },
      { title: "Match receipts as they arrive", body: "Receipts find their transactions on their own, so month end is a review instead of a hunt.", art: receiptArt() },
    ]),
  });
}

function setupSection(): string {
  const steps = SETUP_STEPS.map(
    (step, index) => `<li class="step"><span class="step-number mono" aria-hidden="true">${index + 1}</span><span>${esc(step)}</span></li>`,
  ).join("");
  return band({ id: "setup-title", title: "Set up in one sitting.", body: `<ol class="steps">${steps}</ol>` });
}

function earningsSection(): string {
  const items = EARNINGS.map(
    (item) => `<li class="earning"><span class="earning-figure mono">${esc(item.figure)}</span><h3>${esc(item.title)}</h3></li>`,
  ).join("");
  return featurePanel({ id: "earn-title", title: "Keep more of what you earn.", body: `<ul class="earnings">${items}</ul>` });
}

function controlsSection(): string {
  return band({
    id: "controls-title",
    title: "Grown-up controls from day one.",
    body: `<div class="controls-layout">
      ${tileGrid([
        { glyph: "layers", title: "Every account in view", body: "Balances, available figures and thirty-day trends on one screen." },
        { glyph: "repeat", title: "Rules that move money for you", body: "Scheduled payments and transfers that run without a reminder." },
        { glyph: "users", title: "Roles and approvals for your team", body: "Owners, admins and members, with a second approver on large payments." },
        { glyph: "sparkle", title: "Pilot for quick answers", body: "Ask a question in plain words and jump straight to the payment or recipient." },
      ])}
      <div class="controls-art" aria-hidden="true">${controlsArt()}</div>
    </div>`,
  });
}

function statsSection(): string {
  const stats = TRUST_STATS.map(
    (stat) => `<li class="stat"><span class="stat-figure mono">${esc(stat.figure)}</span> <span class="stat-label">${esc(stat.label)}</span></li>`,
  ).join("");
  return `<section class="band band-tint" aria-label="Tallwind in numbers">
    <div class="container"><ul class="stats">${stats}</ul></div>
  </section>`;
}

function securitySection(): string {
  return `<section class="band" aria-labelledby="security-title">
    <div class="container security">
      <span class="tile-icon tile-icon-large">${icon("shield")}</span>
      <div>
        <h2 class="display section-title" id="security-title">Security you can check</h2>
        <p class="band-lede">Deposits are held at our partner banks, and every sign-in to move money is checked against your team's roles.</p>
      </div>
    </div>
  </section>`;
}

function closingSection(): string {
  return featurePanel({
    id: "closing-title",
    title: "Open an account in one sitting",
    className: "closing",
    body: `<p class="band-lede">No branch visit, no monthly fee on the core plan, and the whole company on one screen by the end of the day.</p>
        ${linkButton("/signup", "Create your account", "primary", "arrowRight")}`,
  });
}

export function homePage(): RenderedPage {
  return marketingDocument({
    title: "Calm banking for companies on the move | Tallwind",
    description: "Open a business account in one sitting and see every dollar your company holds, owes and is owed on one quiet screen.",
    page: "home",
    main: [
      announcementStrip(),
      heroSection(),
      tourSection(),
      ledgerSection(),
      proofSection(),
      runwaySection(),
      setupSection(),
      earningsSection(),
      controlsSection(),
      statsSection(),
      securitySection(),
      closingSection(),
    ].join("\n"),
  });
}
