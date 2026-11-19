import { html, raw, type Markup } from "../html.js";
import { documentPage, problems, textField, selectField, hourOptions, minuteOptions, areaField, addressField, radioGroup, dialog, formAttrs } from "./layout.js";
import { clientMarks, fleetSide, heroStreet, icon, mastheadCoach, occasionArt, wordmark } from "./art.js";

const CALL = "Call 01632 960140";
const TEL = "tel:01632960140";
const MAIL = "mailto:desk@merrowfield.example";
const NAV: [string, string][] = [["Home", "/"], ["School trips", "/occasions/school"], ["Weddings", "/occasions/weddings"], ["Company travel", "/occasions/company"], ["Festivals and sport", "/occasions/festivals"], ["Fleet", "/fleet"], ["Terms", "/terms"]];

export const OCCASIONS: Record<string, { heading: string; title: string; cardLine: string; card: string[]; arrange: string; tell: string; pay: string; early: string; who: string; change: string; seats: number; panel: string }> = {
  school: {
    heading: "School trips", title: "School trips", seats: 49, panel: "From the first letter home to the last head count, one person keeps your trip together.",
    cardLine: "with papers checked", card: ["Papers checked for the return day", "Driver DBS date on file", "Seat plan by class"],
    arrange: "A coach or minibus with a driver for a day out, a residential week or a run of swimming lessons. We ask partner operators who know school gates and bring back one clear price.",
    tell: "Your year groups, how many pupils and adults, where you need to be and by when, and any wheelchair users, so the vehicle with the lift is planned from the start.",
    pay: "A deposit holds the coach and the balance is due seven days before you travel, by bank transfer with your reference. Your finance office gets one invoice.",
    early: "Six weeks before term-time trips is comfortable. We can often help sooner, and the form will tell you the shortest notice we can take.",
    who: "We keep each operator's licence, cover and driver DBS check on file and check them against the last day of your trip before anyone is awarded the hire.",
    change: "Tell us as soon as you know. We show the old and new side by side, and any money due back is listed against each vehicle.",
  },
  weddings: {
    heading: "Weddings", title: "Weddings", seats: 31, panel: "Guests at the church, the reception and home again, with a driver who has the running order.",
    cardLine: "with guests home safe", card: ["One route for every guest", "A driver with your timings", "Late return planned in"],
    arrange: "Vehicles to carry your guests between the ceremony, the reception and their hotels, sized for your numbers with room for dresses, gifts and the odd pair of spare shoes.",
    tell: "The addresses and times of each leg, how many guests on each, and the latest anyone will want to be taken home.",
    pay: "A deposit confirms the day. The balance is due seven days before the wedding, so nothing about money follows you down the aisle.",
    early: "As soon as you have a date, especially from May to September, when the larger coaches go first.",
    who: "Your operator's papers are checked for the wedding day itself, and your driver's hours are planned so a late finish is still legal.",
    change: "Numbers move and that is fine. We update the plan, show you what changes, and a new private page replaces the old one if the price moves.",
  },
  company: {
    heading: "Company travel", title: "Company travel", seats: 49, panel: "Shuttles, site visits and away days, with one invoice and one person to ring.",
    cardLine: "with one invoice", card: ["Shuttles between sites", "Invoices with your reference", "One contact all the way"],
    arrange: "Staff shuttles, conference transfers, site visits and away days. We plan the fewest vehicles that carry everyone and their kit, and keep the paperwork in one place.",
    tell: "Pick-up points, arrival times, head count and how much equipment is coming, plus any reference your accounts team needs on the invoice.",
    pay: "A deposit per vehicle holds the booking and the balance follows seven days before travel. Invoices carry gapless numbers for your records.",
    early: "A fortnight is usually plenty. Conference weeks book up sooner, so ask as soon as your dates are firm.",
    who: "We check every operator's licence and cover for the last day of your hire, and every run's drivers' hours before it is confirmed.",
    change: "Send the new numbers or times. We reprice if needed and refunds or amounts owed show against each vehicle.",
  },
  festivals: {
    heading: "Festivals and sport", title: "Festivals and sport", seats: 56, panel: "Away days and weekend fields, with kit bags planned before anyone packs.",
    cardLine: "with room for bags", card: ["Room for every kit bag", "Waiting time agreed up front", "Home after the final whistle"],
    arrange: "Team coaches, supporters' buses and festival runs, sized for people and their bags, with waiting and comfort stops agreed in plain terms before you go.",
    tell: "Where you are starting, the venue, kick-off or gate times, how many are coming and how many large, medium and hand bags to expect.",
    pay: "A deposit per vehicle holds it, the balance is due seven days before departure, and any waiting charge is shown before it reaches your balance.",
    early: "Cup runs can be short notice and we will try. For festival weekends, ask as soon as tickets are bought.",
    who: "Each operator is checked for your last day, and the run is planned so the driver's hours still work if the match goes to extra time.",
    change: "Results change plans. Tell us by mail or telephone and we show what moves, including any cancellation charge counted by UK calendar days.",
  },
};
const SECTIONS: [string, string][] = [["what-we-arrange", "What we arrange"], ["what-to-tell-us", "What to tell us"], ["how-payment-works", "How payment works"], ["questions", "Questions"]];
const SIZES: [number, number, string][] = [[8, 16, "Minibus"], [12, 24, "Minibus"], [16, 32, "Minibus with a lift"], [31, 62, "Midi coach"], [49, 98, "Coach with a lift"], [56, 112, "Coach"], [70, 140, "Double-deck coach"]];

const mainNav = (current: string): Markup => html`<ul>${NAV.map(([label, path]) => html`<li><a href="${path}"${raw(path === current ? ' aria-current="page"' : "")}>${label}</a></li>`)}</ul>`;
const quoteLink = (occasion?: string): string => (occasion ? `/quote?occasion=${occasion}` : "/quote/route");

const publicHeader = (current: string, occasion?: string): Markup => html`
  <header class="masthead">
    <a class="masthead-brand" href="/" aria-label="Merrowfield Coach Hire"><span class="masthead-word">Merrowfield</span>${mastheadCoach()}</a>
    <div class="masthead-call"><span class="masthead-label">Ask for a coach or minibus</span><a class="masthead-tel" href="${TEL}" aria-label="${CALL}">01632 960140</a><a class="btn btn-cyan" href="${quoteLink(occasion)}">Get a free quote</a></div>
  </header>
  <div class="main-nav-row"><nav class="main-nav" aria-label="Main">${mainNav(current)}</nav><button type="button" class="btn-plain nav-search" data-dialog-open="search-overlay">${icon("search", 18)}<span>Search</span></button></div>
  <div class="slim-bar" data-part="slim-bar" data-slim><a class="slim-brand" href="/" aria-label="Merrowfield Coach Hire home">${wordmark()}</a><nav class="main-nav" aria-label="Main">${mainNav(current)}</nav><button type="button" class="btn-plain nav-search" data-dialog-open="search-overlay">${icon("search", 18)}<span>Search</span></button><a class="btn btn-cyan" href="${quoteLink(occasion)}">Get a free quote</a></div>
  <header class="phone-bar" data-phone-bar><a class="phone-brand" href="/" aria-label="Merrowfield Coach Hire">${wordmark()}</a><a class="phone-call" href="${TEL}" aria-label="${CALL}">${icon("phone", 26)}</a><button type="button" class="menu-button" data-dialog-open="public-menu" aria-label="Menu"><span></span><span></span><span class="short"></span></button></header>`;
const publicFooter = (): Markup => html`<footer class="legal"><p><a href="/terms">Terms</a> | <a href="/fleet">Fleet</a></p><p>Merrowfield Coach Hire, Coventry</p><p>Coaches and minibuses arranged by one independent desk</p></footer>`;
const floaters = (): Markup => html`<a class="message-us" href="${MAIL}" aria-label="Message us">${icon("message", 26)}</a><a class="back-top" href="#top" aria-label="Back to top" hidden data-back-top>${icon("up", 22)}</a>`;
const publicOverlays = (current: string): Markup => html`
  ${dialog({ id: "public-menu", title: "Menu", kind: "panel", body: html`<nav class="menu-nav" aria-label="Main">${mainNav(current)}</nav><button type="button" class="btn btn-outline menu-search" data-dialog-open="search-overlay">${icon("search", 18)}<span>Search</span></button>` })}
  ${dialog({ id: "search-overlay", title: "Search", kind: "search", body: html`<form class="search-form" data-search novalidate>${textField({ label: "Search the site", type: "search", name: "q", icon: "search", extra: 'enterkeyhint="search"' })}</form><ul class="search-results" aria-label="Search results" data-results hidden></ul>` })}`;

const SITE = "Merrowfield Coach Hire";
const publicPage = (titleStart: string, current: string, main: Markup, occasion?: string): string => {
  return documentPage({ title: `${titleStart} | ${SITE}`, kind: "public", app: html`<div id="top"></div>${publicHeader(current, occasion)}<main id="screen">${main}</main>${publicFooter()}${floaters()}`, overlays: publicOverlays(current) });
};

export const homePage = (): string => publicPage("Coach and minibus hire from Coventry", "/", html`
  <section class="hero">${heroStreet()}<div class="hero-shade"></div><div class="hero-words"><h1>Coaches and minibuses with a driver</h1><p class="hero-sub">Arranged for you from Coventry</p></div></section>
  <section class="marks" data-marks aria-label="Client marks"><div class="marks-window"><ul class="marks-track" data-marks-track>${clientMarks()}</ul></div>
    <div class="marks-controls"><button type="button" class="btn btn-outline" data-marks-step="-1" aria-disabled="true">Earlier</button><button type="button" class="btn btn-outline" data-marks-step="1">Later</button></div></section>
  <section class="band band-plum promise rise"><h2>One desk, one person, every detail checked</h2><span class="promise-icon">${icon("seat", 88)}</span>
    <ul class="promise-lines"><li>Partner operators asked for you</li><li>Papers checked for your last day</li><li>Drivers' hours checked before you travel</li><li>One private page for your quote</li></ul>
    <a class="btn btn-cyan btn-wide" href="/quote/route">Get a free quote</a></section>
  ${Object.entries(OCCASIONS).map(([key, o], i) => html`<section class="split ${i % 2 ? "split-swap" : ""} rise">${occasionArt(key, o.seats, "split-art")}<div class="split-words split-${["white", "plum", "white", "plum"][i]}"><h2>${o.heading}</h2><p>${o.panel}</p><a class="text-link" href="/occasions/${key}">Read about ${o.heading.toLowerCase()}</a></div></section>`)}
  <section class="cards rise">${Object.entries(OCCASIONS).map(([key, o]) => html`<a class="occasion-card" href="/occasions/${key}">${occasionArt(key, o.seats, "card-art")}<h3>${o.heading}<br>${o.cardLine}</h3><ul>${o.card.map((line) => html`<li>${icon("check", 16)}<span>${line}</span></li>`)}</ul></a>`)}</section>
  <section class="band band-cyan start-band rise"><h2>Get a free quote</h2><p>Three short steps, and the Journey ticket fills itself in as you go.</p><a class="btn btn-plum btn-wide" href="/quote/route">Start your quote</a></section>`);

export const occasionPage = (key: string): string => {
  const o = OCCASIONS[key];
  const questions: [string, string, string][] = [["how-early", "How early should we ask?", o.early], ["who-checks", "Who checks the driver?", o.who], ["plans-change", "What happens if plans change?", o.change]];
  return publicPage(o.title, `/occasions/${key}`, html`
    <div class="band band-plum page-head"><h1>${o.heading}</h1><a class="btn btn-cyan head-quote" href="${quoteLink(key)}">Get a free quote</a></div>
    <div class="occasion-layout"><nav class="rail" aria-label="On this page" data-rail><ul>${SECTIONS.map(([id, label]) => html`<li><a href="#${id}">${label}</a></li>`)}</ul></nav>
      <div class="occasion-sections">
        <section id="what-we-arrange" class="reading rise" data-section><h2>What we arrange</h2><p>${o.arrange}</p>${occasionArt(key, o.seats, "reading-art")}</section>
        <section id="what-to-tell-us" class="reading rise" data-section><h2>What to tell us</h2><p>${o.tell}</p></section>
        <section id="how-payment-works" class="reading rise" data-section><h2>How payment works</h2><p>${o.pay}</p></section>
        <section id="questions" class="reading rise" data-section><h2>Questions</h2>${questions.map(([id, q, a]) => html`<div class="question" id="${id}"><h3><button type="button" class="question-button" aria-expanded="false" aria-controls="${id}-panel" data-question>${q}${icon("chevron", 18)}</button></h3><div class="question-panel" id="${id}-panel" data-question-panel><div class="question-inner"><p>${a}</p></div></div></div>`)}</section>
      </div></div>`, key);
};

export const fleetPage = (): string => publicPage("Our fleet", "/fleet", html`
  <div class="band band-plum page-head"><h1>Our fleet</h1></div>
  <p class="page-intro">We own no vehicles. Partner operators bring these seven sizes, and we plan the fewest that seat everyone and hold every bag.</p>
  <ul class="fleet-list">${SIZES.map(([seats, units, label]) => html`<li class="fleet-item rise">${fleetSide(seats)}<h2>${seats} seats</h2><p>${label}</p><p>${units} bag units</p></li>`)}</ul>`);

export const termsPage = (): string => publicPage("Terms", "/terms", html`
  <div class="band band-plum page-head"><h1>Terms</h1></div>
  <div class="terms">
    <section class="reading"><h2>Who you are dealing with</h2><p>Merrowfield Coach Hire is one independent arranger working from Coventry. We own no vehicles. We ask partner operators for prices, award your hire to one of them and stay your contact throughout.</p></section>
    <section class="reading"><h2>Your quote</h2><p>Your private quote page holds the total, the deposit and the date it is valid until, which is the end of the fifth calendar day after we send it. You accept by typing your full name.</p></section>
    <section class="reading"><h2>Paying</h2><p>Payment is by bank transfer quoting your reference. A deposit is due per vehicle and the balance is due seven days before departure. We count money as paid when it reaches our bank statement.</p></section>
    <section class="reading"><h2>Waiting and comfort stops</h2><p>Fifteen minutes at each stop are free, and sixty minutes from landing at an airport. Beyond that, waiting is charged by the minute at the hourly rate on your booking. Charges reach your balance only after we accept them.</p></section>
    <section class="reading"><h2>Cancelling</h2><p>Written notice is counted in UK calendar days before departure. Thirty days or more costs the deposit only, fifteen to twenty-nine costs a quarter of the vehicle's total, eight to fourteen costs half, and seven or fewer costs all of it. If we cancel, you get back exactly what you paid.</p></section>
    <section class="reading"><h2>Lost property and complaints</h2><p>We hold found items for one calendar month and a return costs £5.00. We reply to complaints within three working days in England and Wales.</p></section>
  </div>`);

const STEP_TITLES: Record<string, string> = { route: "Route", when: "When and who", details: "Your details", thanks: "Thank you" };

export const journeyFields = (prefix: string, opts: { calendar: boolean }): { route: Markup; when: Markup; details: Markup } => {
  const stamp = (name: string): string => `${prefix}${name}`;
  const timeFields = (label: string, key: string): Markup => html`
    <div class="field-pair" data-time-pair="${key}">
      ${selectField({ label: `${label} hour`, name: stamp(`${key}.hour`), options: hourOptions(), placeholder: "Hour", icon: "clock", field: `${key}`, extra: `data-hour="${key}"` })}
      ${selectField({ label: `${label} minutes`, name: stamp(`${key}.minutes`), options: minuteOptions(true), placeholder: "Minutes", icon: "clock", extra: `data-minutes="${key}"` })}
    </div>
    <div class="which-slot" data-which="${key}" hidden></div>`;
  const dateField = (label: string, key: string, choose: string): Markup => html`
    <div class="date-row">${textField({ label: `${label} date`, name: stamp(`${key}.date`), dataType: "date", icon: "calendar", field: `${key}`, extra: `data-date="${key}" placeholder="DD/MM/YYYY" inputmode="numeric"` })}
      ${opts.calendar ? html`<button type="button" class="btn btn-field" data-calendar="${key}">${choose}</button>` : ""}</div>`;
  return {
    route: html`
      ${radioGroup("Occasion", stamp("occasion"), [{ value: "school", label: "School" }, { value: "weddings", label: "Weddings" }, { value: "company", label: "Company" }, { value: "festivals", label: "Festivals and sport" }], { field: "occasion", cls: "segments-4" })}
      ${radioGroup("Journey type", stamp("journeyType"), [{ value: "oneWay", label: "One way", checked: true }, { value: "return", label: "Return" }, { value: "sameDayReturn", label: "Same day return" }, { value: "severalStops", label: "Several stops" }], { field: "journeyType", cls: "segments-4 segments-bar" })}
      <div class="field-pair">${addressField("From", { name: stamp("from"), field: "from", icon: "pin" })}${addressField("To", { name: stamp("to"), field: "to", icon: "flag" })}</div>
      <div class="stops" data-stops></div>
      <button type="button" class="btn-plain add-stop" data-add-stop>${icon("route", 18)}<span>Add a stop</span></button>
      ${areaField({ label: "Stop details", name: stamp("details"), field: "details", icon: "note", cls: "details-field", hidden: true })}`,
    when: html`
      <div class="out-block">
        ${opts.calendar ? html`<div class="shortcuts"><button type="button" class="shortcut" data-shortcut="0" aria-pressed="false">Today</button><button type="button" class="shortcut" data-shortcut="1" aria-pressed="false">Tomorrow</button></div>` : ""}
        ${dateField("Out", "departAt", "Choose out date")}
        <p class="no-hours" data-no-hours hidden>No more pick-ups today.</p>
        ${timeFields("Out", "departAt")}
      </div>
      <div class="return-block" data-return hidden>${dateField("Return", "returnAt", "Choose return date")}${timeFields("Return", "returnAt")}</div>
      ${textField({ label: "People", name: stamp("people"), type: "number", dataType: "int", field: "people", icon: "people", min: 1, max: 400 })}
      <div class="bags">
        ${textField({ label: "Large (23 kg)", name: stamp("large"), type: "number", dataType: "int", field: "large", icon: "bagLarge", value: 0, min: 0, max: 40 })}
        ${textField({ label: "Medium (15 kg)", name: stamp("medium"), type: "number", dataType: "int", field: "medium", icon: "bagMedium", value: 0, min: 0, max: 40 })}
        ${textField({ label: "Hand (7 kg)", name: stamp("hand"), type: "number", dataType: "int", field: "hand", icon: "bagHand", value: 0, min: 0, max: 40 })}
      </div>
      ${textField({ label: "Wheelchair users", name: stamp("wheelchairs"), type: "number", dataType: "int", field: "wheelchairs", icon: "wheelchair", value: 0, min: 0, max: 10 })}`,
    details: html`
      ${textField({ label: "Name", name: stamp("name"), field: "name", icon: "person", autocomplete: "name" })}
      ${textField({ label: "Email", name: stamp("email"), type: "email", field: "email", icon: "mail", autocomplete: "email" })}
      ${textField({ label: "Telephone", name: stamp("telephone"), type: "tel", field: "telephone", icon: "phone", autocomplete: "tel" })}
      ${selectField({ label: "Language for your quote", name: stamp("language"), icon: "globe", options: [{ value: "en", label: "English", selected: true }, { value: "pl", label: "Polski" }, { value: "ur", label: "اردو" }] })}`,
  };
};

const TICKET_LINES: [string, string, boolean][] = [["occasion", "Occasion", true], ["journey", "Journey", true], ["from", "From", true], ["to", "To", true], ["stops", "Stops", false], ["details", "Details", false], ["out", "Out", true], ["return", "Return", false], ["people", "People", true], ["bags", "Bags", true], ["wheelchairs", "Wheelchair users", true], ["name", "Name", true], ["email", "Email", true], ["telephone", "Telephone", true]];
const ticketBody = (part: boolean): Markup => html`<dl class="ticket-lines">${TICKET_LINES.map(([key, label, always]) => html`<div class="ticket-row"${raw(part ? ' data-part="ticket-line"' : "")} data-ticket-line="${key}"${raw(always ? "" : " hidden")}><dt>${label}</dt><dd data-ticket-value>Not yet given</dd></div>`)}</dl>`;

export const quotePage = (step: string): string => {
  const fields = journeyFields("", { calendar: true });
  const stepBlock = (key: string, body: Markup): Markup => html`<section class="step" data-step="${key}"${raw(key === step ? "" : " hidden")}><h1 tabindex="-1">${STEP_TITLES[key]}</h1>${body}</section>`;
  return documentPage({
    title: `${STEP_TITLES[step]} | Get a free quote`, kind: "public",
    app: html`<div id="top"></div>${publicHeader("", undefined)}
    <main id="screen" class="quote-screen"><div class="quote-layout"><form class="journey-form" data-journey="public" novalidate>
      <p class="form-title">Get a free quote</p>
      ${problems()}
      <div class="trap" aria-hidden="true"><label for="website-trap">website</label><input id="website-trap" name="website" type="text" tabindex="-1" autocomplete="off"></div>
      <div class="steps">
      ${stepBlock("route", fields.route)}
      ${stepBlock("when", fields.when)}
      ${stepBlock("details", fields.details)}
      ${stepBlock("thanks", html`<p data-thanks-line>Your request is with the desk.</p><p><a class="text-link" href="/">Back to the home page</a></p>`)}
      </div>
      <div class="form-back"><button type="button" class="btn-plain" data-step-back hidden>Back</button></div>
      <div class="quote-actions" data-quote-actions><button type="button" class="ticket-open" data-dialog-open="ticket-sheet" data-ticket-count>Journey ticket, 1 answered</button><button type="button" class="btn btn-plum action-next" data-step-next>Next</button><button type="button" class="btn btn-plum action-send" data-step-send hidden>Send request</button></div>
    </form>
    <aside class="ticket" aria-label="Journey ticket"><h2 class="ticket-band">Journey ticket</h2>${ticketBody(true)}</aside></div></main>${publicFooter()}${floaters()}`,
    overlays: html`${publicOverlays("")}${dialog({ id: "ticket-sheet", title: "Journey ticket", kind: "sheet", body: ticketBody(false) })}
      ${dialog({ id: "calendar", title: "Choose a date", kind: "dialog", body: html`<div class="calendar-head"><button type="button" class="btn btn-field" data-month="-1">Previous month</button><span data-month-label></span><button type="button" class="btn btn-field" data-month="1">Next month</button></div><div data-calendar-grid></div>` })}`,
  });
};

export const signPage = (mode: "in" | "up", returnPath: string | null): string => {
  const up = mode === "up";
  return documentPage({
    title: up ? "Start a desk | Wayticket" : "Sign in | Wayticket", kind: "plain",
    app: html`<main id="screen" class="sign-screen"><div class="sign-card"><span class="sign-brand">${wordmark()}<span>Wayticket</span></span><h1 tabindex="-1" data-focus-on-load>${up ? "Start a desk" : "Sign in"}</h1>
      <form ${up ? formAttrs("POST /api/auth/sign-up", undefined, 'data-after="signed-in"') : formAttrs("POST /api/auth/sign-in", undefined, 'data-after="signed-in"')} ${raw(returnPath ? html`data-return="${returnPath}"`.text : "")}>
        ${problems()}
        ${up ? textField({ label: "Desk name", name: "name", field: "name", icon: "person" }) : ""}
        ${textField({ label: "Email", name: "email", type: "email", field: "email", icon: "mail", autocomplete: "email" })}
        ${textField({ label: "Password", name: "password", type: "password", field: "password", icon: "shield", autocomplete: up ? "new-password" : "current-password" })}
        <button class="btn btn-plum btn-full" type="submit">${up ? "Start desk" : "Sign in"}</button>
      </form>
      <p class="sign-switch">${up ? html`<a href="/sign-in">Sign in</a>` : html`<a href="/sign-up">Start a desk</a>`}</p></div></main>`,
  });
};

export const notFoundPage = (): string => {
  return documentPage({ title: "Page not found", kind: "plain", app: html`<main id="screen" class="sign-screen"><div class="sign-card"><span class="sign-brand">${wordmark()}</span><h1 tabindex="-1">Page not found</h1><p>We can't find that.</p><p><a class="text-link" href="/">Back to the home page</a></p></div></main>` });
};
