import { escapeHtml, attr } from "./html.js";

export function homeBody(): string {
  return `
<section class="hero" data-part="hero">
  <div class="hero-inner">
    <h1>Coaches and minibuses with a driver</h1>
    <p class="hero-sub">Arranged for you from Coventry</p>
  </div>
</section>
<section class="client-marks" data-part="client-marks" aria-label="Client marks">
  <button type="button" data-marks="earlier" class="marks-button">Earlier</button>
  <ul class="marks-list" data-marks-list>
    <li>Aldermoor Primary</li><li>Foleshill Tools</li><li>Kenilworth Keep</li><li>Ardenside FC</li><li>Walsall Lock</li>
  </ul>
  <button type="button" data-marks="later" class="marks-button">Later</button>
</section>
<section class="promise" data-part="promise">
  <div class="promise-inner">
    <h2>One desk, one person, every detail checked</h2>
    <svg class="promise-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><path d="M8 20h34v22H8z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M42 28h8l6 6v8h-14z" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="16" cy="44" r="5" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="42" cy="44" r="5" fill="none" stroke="currentColor" stroke-width="3"/><path d="M24 14l6-6 6 6" fill="none" stroke="currentColor" stroke-width="3"/><path d="M30 8v12" fill="none" stroke="currentColor" stroke-width="3"/></svg>
    <ul class="promise-lines">
      <li>Partner operators asked for you</li>
      <li>Papers checked for your last day</li>
      <li>Drivers' hours checked before you travel</li>
      <li>One private page for your quote</li>
    </ul>
    <a class="quote-link promise-quote" href="/quote/route">Get a free quote</a>
  </div>
</section>
<section class="split-panels">
  <div class="split-panel">
    <div class="split-drawing">${coachSvg(1)}</div>
    <div class="split-text"><h3>School trips</h3><p>From a morning at a museum to a week away, with the DBS dates checked.</p><a href="/occasions/school">Read about school trips</a></div>
  </div>
  <div class="split-panel reverse">
    <div class="split-text"><h3>Weddings</h3><p>One minibus for the close family, or coaches for the whole day.</p><a href="/occasions/weddings">Read about weddings</a></div>
    <div class="split-drawing">${coachSvg(2)}</div>
  </div>
</section>
<section class="occasion-cards" aria-label="Occasions">
  <a class="occasion-card" href="/occasions/school"><span class="card-drawing">${coachSvg(3)}</span><h3>School<br>trips</h3><ul><li>DBS dates checked</li><li>Seat plan printed</li><li>One invoice for the office</li></ul></a>
  <a class="occasion-card" href="/occasions/weddings"><span class="card-drawing">${coachSvg(4)}</span><h3>Weddings</h3><ul><li>Guests moved on time</li><li>Polish or Urdu quote</li><li>Waiting charges shown</li></ul></a>
  <a class="occasion-card" href="/occasions/company"><span class="card-drawing">${coachSvg(5)}</span><h3>Company<br>travel</h3><ul><li>Shuttles and day hires</li><li>Credit notes kept straight</li><li>Invoice by calendar year</li></ul></a>
  <a class="occasion-card" href="/occasions/festivals"><span class="card-drawing">${coachSvg(6)}</span><h3>Festivals<br>and sport</h3><ul><li>Waiting worked out per stop</li><li>Comfort stops charged fairly</li><li>Driver run sheet on a phone</li></ul></a>
</section>
<section class="quote-form-band">
  <div class="quote-form-inner">
    <h2>Start your quote</h2>
    <p class="quote-form-copy">Tell us the route, the day and the party. We ask clear operators for their prices and send one private page with your quote.</p>
    <a class="quote-link quote-form-link" href="/quote/route">Start your quote</a>
  </div>
</section>`;
}

export function coachSvg(variant: number): string {
  const body = variant % 3 === 0 ? "coach" : "minibus";
  const len = body === "coach" ? 210 : 120;
  const windows = body === "coach" ? 5 : 2;
  let win = "";
  for (let i = 0; i < windows; i++) win += `<rect x="${16 + i * 30}" y="30" width="22" height="16" fill="var(--cyan)"/>`;
  return `<svg class="coach-svg" viewBox="0 0 230 90" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet"><rect x="6" y="16" width="${len}" height="56" fill="var(--plum)"/><rect x="6" y="16" width="${len}" height="8" fill="var(--cyan-bright)"/>${win}<circle cx="46" cy="74" r="11" fill="var(--ink)"/><circle cx="${len - 24}" cy="74" r="11" fill="var(--ink)"/></svg>`;
}

export interface Occasion {
  slug: string;
  title: string;
  intro: string;
  arrange: string[];
  tell: string[];
  payment: string[];
  answer: string;
}

export const OCCASIONS: Record<string, Occasion> = {
  school: {
    slug: "school",
    title: "School trips",
    intro:
      "School trips by coach and minibus, from a morning at a museum to a week away. Every operator we ask holds an operator licence and public liability cover, and for a school hire we also check the driver's DBS date covers your last day.",
    arrange: [
      "Day trips and residentials by coach or minibus.",
      "Operators whose papers cover your last day, not just today.",
      "A seat plan printed for the party list.",
      "One invoice for the school office, with a credit note if a run changes.",
    ],
    tell: [
      "The pick-up and the destination, with any stops between.",
      "The out date and time, and a return if there is one.",
      "How many people, how many bags and any wheelchair users.",
      "A name, an email and a telephone number.",
    ],
    payment: [
      "A deposit holds the seats and the balance is due in the week before you travel.",
      "Your quote is one private page, in English, Polish or Urdu.",
      "Say you have sent the deposit and the desk matches it to the bank statement.",
    ],
    answer: "We answer within three working days in England and Wales.",
  },
  weddings: {
    slug: "weddings",
    title: "Weddings",
    intro:
      "Weddings and the guests around them: one minibus for the close family or coaches for the whole day. The quote reaches you in English, Polish or Urdu, and waiting charges are shown before the balance is due.",
    arrange: [
      "Guests moved on time, with the driver's hours checked before the day.",
      "One private page holding the quote, the party and the vehicles.",
      "Waiting charged per stop and only after the desk accepts it.",
    ],
    tell: [
      "The pick-up, the ceremony and the reception.",
      "The times, including which side of a clock change.",
      "The party size, bags and any wheelchair users.",
    ],
    payment: [
      "A deposit holds the seats and the balance is due in the week before the day.",
      "Your quote is one private page, in English, Polish or Urdu.",
      "A cancellation is charged by UK calendar days between your notice and the day.",
    ],
    answer: "Popular Saturdays go early, so ask as soon as the venue is fixed.",
  },
  company: {
    slug: "company",
    title: "Company travel",
    intro:
      "Company travel: shuttles between sites, a day at a conference, or the Christmas party run. One desk collects the prices and one invoice follows, with a credit note if a run changes.",
    arrange: [
      "Shuttles, day hires and multi-day runs.",
      "Operators clear for the hire's last day.",
      "Invoices numbered without gaps by calendar year.",
    ],
    tell: [
      "The route and the stops in order.",
      "The dates and the times.",
      "The numbers travelling and any wheelchair users.",
    ],
    payment: [
      "A deposit holds the seats and the balance is due in the week before you travel.",
      "One invoice follows the hire, with a credit note if a run changes.",
      "A bank statement brings the money in, matched to the booking.",
    ],
    answer: "Ask as soon as the dates are fixed and we will do the rest.",
  },
  festivals: {
    slug: "festivals",
    title: "Festivals and sport",
    intro:
      "Festivals and sport: the coach that waits, or the minibuses that shuttle all weekend. Waiting time and comfort stops are worked out per stop and shown before you accept them.",
    arrange: [
      "Coaches that wait at the gate and minibuses that shuttle.",
      "Waiting counted from the flight when the stop is an airport.",
      "The driver's run sheet on a phone, working with no signal.",
    ],
    tell: [
      "The pick-up and the ground.",
      "The times, and the flight number for an airport pick-up.",
      "The party size and any wheelchair users.",
    ],
    payment: [
      "A deposit holds the seats and the balance is due in the week before you travel.",
      "Waiting and comfort charges are shown before the balance is asked for.",
      "A cancellation is charged by UK calendar days between your notice and the day.",
    ],
    answer: "Festival weekends fill early, so ask as soon as you know the date.",
  },
};

export function occasionBody(slug: string): string {
  const o = OCCASIONS[slug];
  return `
<div class="occ-hero">
  <h1>${escapeHtml(o.title)}</h1>
  <a class="quote-link occ-quote" href="/quote?occasion=${attr(slug)}">Get a free quote</a>
</div>
<nav class="on-this-page" aria-label="On this page" data-rail>
  <h2>On this page</h2>
  <ul>
    <li><a href="#what-we-arrange" data-rail-link>What we arrange</a></li>
    <li><a href="#what-to-tell-us" data-rail-link>What to tell us</a></li>
    <li><a href="#how-payment-works" data-rail-link>How payment works</a></li>
    <li><a href="#questions" data-rail-link>Questions</a></li>
  </ul>
</nav>
<section id="what-we-arrange" class="occ-section" data-observe>
  <h2>What we arrange</h2>
  <p>${escapeHtml(o.intro)}</p>
  <ul class="checklist">${o.arrange.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
</section>
<section id="what-to-tell-us" class="occ-section" data-observe>
  <h2>What to tell us</h2>
  <ul class="checklist">${o.tell.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
</section>
<section id="how-payment-works" class="occ-section" data-observe>
  <h2>How payment works</h2>
  <ul class="checklist">${o.payment.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
</section>
<section id="questions" class="occ-section" data-observe>
  <h2>Questions</h2>
  <div class="accordion" data-accordion>
    <h3 class="accordion-heading"><button type="button" aria-expanded="false" aria-controls="how-early" id="how-early-button">How early should we ask?</button></h3>
    <div class="accordion-panel" id="how-early" role="region" aria-labelledby="how-early-button" hidden><p>${escapeHtml(o.answer)}</p></div>
  </div>
  <div class="accordion" data-accordion>
    <h3 class="accordion-heading"><button type="button" aria-expanded="false" aria-controls="who-checks" id="who-checks-button">Who checks the driver?</button></h3>
    <div class="accordion-panel" id="who-checks" role="region" aria-labelledby="who-checks-button" hidden><p>We do, against the operator's papers and the drivers' hours rules, before the run is confirmed.</p></div>
  </div>
  <div class="accordion" data-accordion>
    <h3 class="accordion-heading"><button type="button" aria-expanded="false" aria-controls="plans-change" id="plans-change-button">What happens if plans change?</button></h3>
    <div class="accordion-panel" id="plans-change" role="region" aria-labelledby="plans-change-button" hidden><p>We reprice and show you the change side by side, and a written cancellation is charged by UK calendar days.</p></div>
  </div>
</section>`;
}

const FLEET: [number, number, boolean][] = [
  [8, 16, false],
  [12, 24, false],
  [16, 32, true],
  [31, 62, false],
  [49, 98, true],
  [56, 112, false],
  [70, 140, false],
];

export function fleetBody(): string {
  const rows = FLEET.map(
    ([seats, bags, lift]) => `<div class="fleet-row">
  <span class="fleet-drawing">${coachSvg(seats)}</span>
  <p><strong>${seats} seats</strong> · ${bags} bag units${lift ? " · lift for two wheelchair users" : ""}</p>
</div>`
  ).join("");
  return `<h1>Our fleet</h1><p class="fleet-lead">Seven sizes, from an 8-seat minibus to a 70-seat coach, with the seats and the bag units for each.</p>${rows}`;
}

export function termsBody(): string {
  return `<h1>Terms</h1>
<div class="terms-text">
<p>Terms of hire. These terms set out what Merrowfield Coach Hire arranges and what you agree to.</p>
<p>We arrange coaches and minibuses operated by partner operators. We are not the operator and we own no vehicles.</p>
<p>A quote is valid for five days from the day it is sent. A deposit holds the seats. The balance is due seven days before departure.</p>
<p>A cancellation by you is charged by the calendar days between your written notice and the departure: thirty days or more takes the deposit only, fifteen to twenty-nine days takes a quarter, eight to fourteen days takes half, and seven days or fewer takes the whole amount.</p>
<p>Complaints are answered within three working days in England and Wales. Found property is held for one calendar month.</p>
</div>`;
}
