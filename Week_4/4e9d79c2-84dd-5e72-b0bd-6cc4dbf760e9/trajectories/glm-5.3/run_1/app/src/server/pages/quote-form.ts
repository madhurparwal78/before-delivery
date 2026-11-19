import { escapeHtml } from "./html.js";

export type Step = "route" | "when" | "details";

export interface TicketLine {
  key: string;
  label: string;
}

export const TICKET_LINES: TicketLine[] = [
  { key: "occasion", label: "Occasion" },
  { key: "journey", label: "Journey" },
  { key: "from", label: "From" },
  { key: "to", label: "To" },
  { key: "stops", label: "Stops" },
  { key: "details", label: "Details" },
  { key: "out", label: "Out" },
  { key: "return", label: "Return" },
  { key: "people", label: "People" },
  { key: "bags", label: "Bags" },
  { key: "wheelchairs", label: "Wheelchair users" },
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "telephone", label: "Telephone" },
];

function ticketHtml(step: Step): string {
  const showing: Record<Step, string[]> = {
    route: ["occasion", "journey", "from", "to", "stops", "details"],
    when: ["occasion", "journey", "from", "to", "stops", "details", "out", "return", "people", "bags", "wheelchairs"],
    details: ["occasion", "journey", "from", "to", "stops", "details", "out", "return", "people", "bags", "wheelchairs", "name", "email", "telephone"],
  };
  const rows = TICKET_LINES.filter((l) => showing[step].includes(l.key))
    .map(
      (l) =>
        `<li class="ticket-line" data-ticket-line="${l.key}"${l.key === "stops" || l.key === "details" || l.key === "return" ? ' hidden' : ""}><span class="ticket-label">${escapeHtml(l.label)}</span><span class="ticket-value" data-ticket-value="${l.key}">Not yet given</span></li>`
    )
    .join("");
  const lines = `<ul class="ticket-lines">${rows}</ul>`;
  return `
<aside class="journey-ticket" aria-label="Journey ticket" data-ticket>
  <h2>Journey ticket</h2>
  ${lines}
</aside>
<div class="ticket-bar" data-ticket-bar>
  <button type="button" class="ticket-open" data-open="ticket-sheet">Journey ticket, <span data-answered-count>0</span> answered</button>
</div>
<div class="sheet ticket-sheet" data-overlay="ticket-sheet" role="dialog" aria-modal="true" aria-label="Journey ticket" hidden>
  <button type="button" class="close" data-close="ticket-sheet">Close</button>
  <h2>Journey ticket</h2>
  ${lines}
</div>`;
}

function addressField(id: string, label: string, autocomplete: string): string {
  return `
<div class="field" data-combobox="${id}">
  <label class="field-label" for="${id}">${escapeHtml(label)}</label>
  <input id="${id}" name="${id}" type="text" class="input" autocomplete="${autocomplete}" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="${id}-list" data-address>
  <ul class="combo-list" id="${id}-list" role="listbox" hidden></ul>
</div>`;
}

export function quoteFormBody(step: Step, occasion: string | null): string {
  const headings: Record<Step, string> = {
    route: "Route",
    when: "When and who",
    details: "Your details",
  };
  const h1 = headings[step];
  const routeStep = `
<section class="quote-step" data-step="route" ${step === "route" ? "" : 'hidden'}>
  <h2 class="step-h">Route</h2>
  <fieldset class="step-fields">
    <legend class="visually-hidden">Route</legend>
    <div class="field">
      <span class="field-label" id="occasion-label">Occasion</span>
      <div class="radios" role="radiogroup" aria-labelledby="occasion-label" data-occasion>
        <label class="radio"><input type="radio" name="occasion" value="school"${occasion === "school" ? " checked" : ""}><span>School</span></label>
        <label class="radio"><input type="radio" name="occasion" value="weddings"${occasion === "weddings" ? " checked" : ""}><span>Weddings</span></label>
        <label class="radio"><input type="radio" name="occasion" value="company"${occasion === "company" ? " checked" : ""}><span>Company</span></label>
        <label class="radio"><input type="radio" name="occasion" value="festivals"${occasion === "festivals" ? " checked" : ""}><span>Festivals and sport</span></label>
      </div>
    </div>
    <div class="field">
      <span class="field-label" id="journey-label">Journey type</span>
      <div class="journey-type" role="radiogroup" aria-labelledby="journey-label" data-journey-type>
        <label class="segment"><input type="radio" name="journeyType" value="oneWay" checked><span>One way</span></label>
        <label class="segment"><input type="radio" name="journeyType" value="return"><span>Return</span></label>
        <label class="segment"><input type="radio" name="journeyType" value="sameDayReturn"><span>Same day return</span></label>
        <label class="segment"><input type="radio" name="journeyType" value="severalStops"><span>Several stops</span></label>
      </div>
    </div>
    ${addressField("from", "From", "street-address")}
    ${addressField("to", "To", "street-address")}
    <div class="stops-holder" data-stops>
      <button type="button" class="add-stop" data-add-stop>Add a stop</button>
    </div>
    <div class="field" data-stop-details hidden>
      <label class="field-label" for="details">Stop details</label>
      <textarea id="details" name="details" class="input" rows="4" maxlength="2000"></textarea>
    </div>
  </fieldset>
</section>`;

  const whenStep = `
<section class="quote-step" data-step="when" ${step === "when" ? "" : 'hidden'}>
  <h2 class="step-h">When and who</h2>
  <fieldset class="step-fields">
    <legend class="visually-hidden">When and who</legend>
    <div class="quick-days">
      <button type="button" class="quick-day" data-quick-day="today" aria-pressed="false">Today</button>
      <button type="button" class="quick-day" data-quick-day="tomorrow" aria-pressed="false">Tomorrow</button>
    </div>
    <div class="field">
      <label class="field-label" for="outDate">Out date</label>
      <div class="date-row">
        <input id="outDate" name="outDate" type="text" inputmode="numeric" class="input date-input" placeholder="DD/MM/YYYY" autocomplete="off">
        <button type="button" class="calendar-open" data-open="out-calendar" aria-haspopup="dialog" aria-expanded="false">Choose out date</button>
      </div>
    </div>
    <div class="time-row">
      <div class="field"><label class="field-label" for="outHour">Out hour</label><select id="outHour" name="outHour" class="input">${hours()}</select></div>
      <div class="field"><label class="field-label" for="outMinutes">Out minutes</label><select id="outMinutes" name="outMinutes" class="input">${minutes15()}</select></div>
    </div>
    <div class="field" data-which-hour hidden>
      <span class="field-label" id="which-label">Which time?</span>
      <div class="radios" role="radiogroup" aria-labelledby="which-label" data-which-hour>
        <label class="radio"><input type="radio" name="repeatedHour" value="first"><span></span></label>
        <label class="radio"><input type="radio" name="repeatedHour" value="second"><span></span></label>
      </div>
    </div>
    <div class="field" data-return-date-holder hidden>
      <label class="field-label" for="returnDate">Return date</label>
      <div class="date-row">
        <input id="returnDate" name="returnDate" type="text" inputmode="numeric" class="input date-input" placeholder="DD/MM/YYYY" autocomplete="off">
        <button type="button" class="calendar-open" data-open="return-calendar" aria-haspopup="dialog" aria-expanded="false">Choose return date</button>
      </div>
    </div>
    <div class="time-row" data-return-time hidden>
      <div class="field"><label class="field-label" for="returnHour">Return hour</label><select id="returnHour" name="returnHour" class="input">${hours()}</select></div>
      <div class="field"><label class="field-label" for="returnMinutes">Return minutes</label><select id="returnMinutes" name="returnMinutes" class="input">${minutes15()}</select></div>
    </div>
    <div class="field"><label class="field-label" for="people">People</label><input id="people" name="people" type="number" min="1" max="400" class="input" inputmode="numeric"></div>
    <div class="field"><label class="field-label" for="large">Large (23 kg)</label><input id="large" name="large" type="number" min="0" max="40" value="0" class="input" inputmode="numeric"></div>
    <div class="field"><label class="field-label" for="medium">Medium (15 kg)</label><input id="medium" name="medium" type="number" min="0" max="40" value="0" class="input" inputmode="numeric"></div>
    <div class="field"><label class="field-label" for="hand">Hand (7 kg)</label><input id="hand" name="hand" type="number" min="0" max="40" value="0" class="input" inputmode="numeric"></div>
    <div class="field"><label class="field-label" for="wheelchairs">Wheelchair users</label><input id="wheelchairs" name="wheelchairs" type="number" min="0" max="10" value="0" class="input" inputmode="numeric"></div>
  </fieldset>
</section>`;

  const detailsStep = `
<section class="quote-step" data-step="details" ${step === "details" ? "" : 'hidden'}>
  <h2 class="step-h">Your details</h2>
  <fieldset class="step-fields">
    <legend class="visually-hidden">Your details</legend>
    <div class="field"><label class="field-label" for="name">Name</label><input id="name" name="name" type="text" class="input" autocomplete="name"></div>
    <div class="field"><label class="field-label" for="email">Email</label><input id="email" name="email" type="email" class="input" autocomplete="email"></div>
    <div class="field"><label class="field-label" for="telephone">Telephone</label><input id="telephone" name="telephone" type="tel" class="input" autocomplete="tel"></div>
    <div class="field"><label class="field-label" for="language">Language for your quote</label><select id="language" name="language" class="input"><option value="en" selected>English</option><option value="pl">Polski</option><option value="ur">اردو</option></select></div>
    <div class="trap" aria-hidden="true"><label for="website">Website</label><input id="website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
  </fieldset>
</section>`;

  const back = step === "route" ? "" : `<button type="button" class="back" data-nav="back">Back</button>`;
  const next =
    step === "details"
      ? `<button type="button" class="primary" data-action="send-request">Send request</button>`
      : `<button type="button" class="primary" data-nav="next">Next</button>`;

  return `
<div class="quote-form-wrap" data-quote-form data-step-name="${step}">
  <div class="quote-form-panel">
    <p class="quote-kicker">Get a free quote</p>
    <h1 class="quote-form-title">${escapeHtml(h1)}</h1>
    <form data-quote-form-form novalidate>
      <div class="group problems" data-problems hidden>
        <h2 class="problems-h">Problems</h2>
        <ul class="problems-list" data-problems-list></ul>
      </div>
      ${routeStep}
      ${whenStep}
      ${detailsStep}
      <div class="step-actions">
        ${back}
        ${next}
      </div>
    </form>
    <div class="calendar" data-overlay="out-calendar" role="dialog" aria-modal="true" aria-label="Choose a date" hidden>
      <div class="calendar-grid" role="grid" aria-label="Choose a date"></div>
      <div class="calendar-nav">
        <button type="button" data-calendar="prev">Previous month</button>
        <button type="button" data-calendar="next">Next month</button>
        <button type="button" class="close" data-close="out-calendar">Close</button>
      </div>
    </div>
    <div class="calendar" data-overlay="return-calendar" role="dialog" aria-modal="true" aria-label="Choose a date" hidden>
      <div class="calendar-grid" role="grid" aria-label="Choose a date"></div>
      <div class="calendar-nav">
        <button type="button" data-calendar="prev">Previous month</button>
        <button type="button" data-calendar="next">Next month</button>
        <button type="button" class="close" data-close="return-calendar">Close</button>
      </div>
    </div>
  </div>
  ${ticketHtml(step)}
</div>`;
}

function hours(): string {
  let out = "";
  for (let i = 0; i < 24; i++) out += `<option value="${String(i).padStart(2, "0")}">${String(i).padStart(2, "0")}</option>`;
  return out;
}

function minutes15(): string {
  return ["00", "15", "30", "45"].map((m) => `<option value="${m}">${m}</option>`).join("");
}

export function minutes59(): string {
  let out = "";
  for (let i = 0; i < 60; i++) out += `<option value="${String(i).padStart(2, "0")}">${String(i).padStart(2, "0")}</option>`;
  return out;
}

export function thanksBody(reference: string): string {
  return `<div class="thanks"><h1>Thank you</h1><p class="thanks-copy">Request sent. Your reference is <strong>${escapeHtml(reference)}</strong>.</p><p><a href="/">Back to the home page</a></p></div>`;
}
