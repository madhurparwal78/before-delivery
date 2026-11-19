import { escapeHtml, attr } from "./html.js";
import { stringsFor, dateForLang, englishCount, urduCount } from "../api/sheets.js";

export interface QuotePageView {
  reference: string;
  language: string;
  state: string;
  stage: string;
  stops: string[];
  departAt: { date: string; time: string } | null;
  returnAt: { date: string; time: string } | null;
  people: number;
  vehicles: { seats: number; total: string; deposit: string }[];
  total: string;
  depositTotal: string;
  validUntil: string | null;
  endsAt: string | null;
  depositSaidSent: boolean;
  cancelled: boolean;
  endedLineDate: string | null;
}

export function langFromQuery(q: unknown, fallback: string): string {
  return q === "pl" || q === "ur" ? String(q) : fallback;
}

export function moneyFormat(v: string): string {
  const n = Number(v);
  const sign = n < 0 ? "-" : "";
  return `${sign}£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function peopleText(lang: string, n: number): string {
  if (lang === "pl") {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (n === 1) return `${n} osoba`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} osoby`;
    return `${n} osób`;
  }
  if (lang === "ur") return urduCount(n, "فرد", "افراد");
  return englishCount(n, "person", "people");
}

function vehiclesText(lang: string, n: number): string {
  if (lang === "pl") {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (n === 1) return `${n} pojazd`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} pojazdy`;
    return `${n} pojazdów`;
  }
  if (lang === "ur") return urduCount(n, "گاڑی", "گاڑیاں");
  return englishCount(n, "vehicle", "vehicles");
}

export function quotePageBody(v: QuotePageView, lang: string): { title: string; h1: string; body: string; dir: string } {
  const s = stringsFor(lang);
  const dir = lang === "ur" ? "rtl" : "ltr";
  const title = `${s.yourQuote} ${v.reference}`;
  const steps = [s.quoteSent, s.accepted, s.deposit, s.balance, s.travel];
  const stageIndex = ["quoteSent", "accepted", "deposit", "balance", "travel"].indexOf(v.stage);
  const stepper = `<ol class="stepper" role="list" aria-label="Progress" data-part="stepper">${steps
    .map((label, i) => `<li class="stepper-step${i === stageIndex ? ' aria-current="step"' : ""}"${i === stageIndex ? ' data-current' : ""}>${escapeHtml(label)}</li>`)
    .join("")}</ol>`;
  const outLine = v.departAt
    ? `<p class="q-line"><strong>${s.out}:</strong> ${dateForLang(lang, v.departAt.date)} ${escapeHtml(v.departAt.time)}</p>`
    : "";
  const returnLine = v.returnAt ? `<p class="q-line"><strong>${s.return}:</strong> ${dateForLang(lang, v.returnAt.date)} ${escapeHtml(v.returnAt.time)}</p>` : "";
  const cancelledLine = v.cancelled ? `<p class="q-cancelled">${s.cancelled}</p>` : "";
  const endedLine =
    !v.cancelled && v.state !== "accepted" && v.endsAt && new Date() > new Date(v.endsAt)
      ? `<p class="q-ended">${s.endedLine} ${dateForLang(lang, String(v.endedLineDate ?? ""))}. ${s.askUs}</p>`
      : "";
  const action = v.cancelled
    ? ""
    : v.state === "accepted"
      ? `<button type="button" class="primary" data-action="deposit-sent">${s.sentDeposit}</button>`
      : `<button type="button" class="primary" data-action="accept">${s.accept}</button>`;
  const saidLine = v.depositSaidSent ? `<p class="q-checking">${s.checkingPayment}</p>` : "";
  const body = `
<div class="q-page" data-q-page data-token-placehold>
  <h1>${escapeHtml(title)}</h1>
  ${stepper}
  ${cancelledLine}
  ${endedLine}
  <h2 class="q-section">${s.route}</h2>
  <ul class="q-stops">${v.stops.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
  <h2 class="q-section">${s.travel}</h2>
  ${outLine}
  ${returnLine}
  <p class="q-line"><strong>${s.party}:</strong> ${peopleText(lang, v.people)}</p>
  <p class="q-line"><strong>${s.vehicles}:</strong> ${vehiclesText(lang, v.vehicles.length)}</p>
  <h2 class="q-section">${s.total}</h2>
  <ul class="q-vehicles">${v.vehicles.map((x) => `<li>${x.seats} — ${moneyFormat(x.total)}</li>`).join("")}</ul>
  <p class="q-total">${escapeHtml(s.total)} ${moneyFormat(v.total)}</p>
  <p class="q-deposit">${escapeHtml(s.depositDue)} ${moneyFormat(v.depositTotal)}</p>
  ${v.validUntil ? `<p class="q-valid">${escapeHtml(s.validUntil)} ${dateForLang(lang, v.validUntil)}</p>` : ""}
  <p class="q-pay">${escapeHtml(s.payBy)} ${escapeHtml(v.reference)}</p>
  ${saidLine}
  <div class="language-switch">
    <label class="field-label" for="langSelect">${escapeHtml(s.language)}</label>
    <select id="langSelect" class="input" data-language>
      <option value="en"${lang === "en" ? " selected" : ""}>English</option>
      <option value="pl"${lang === "pl" ? " selected" : ""}>Polski</option>
      <option value="ur"${lang === "ur" ? " selected" : ""}>اردو</option>
    </select>
  </div>
  <a class="q-download" href="pdf">${escapeHtml(s.downloadQuote)}</a>
</div>
<div class="dialog-holder" data-dialogs>
  <div class="dialog q-dialog" data-overlay="accept" role="dialog" aria-modal="true" aria-labelledby="accept-title" hidden>
    <h2 id="accept-title">${escapeHtml(s.acceptThisQuote)}</h2>
    <p class="dialog-message" data-message hidden></p>
    <div class="field"><label class="field-label" for="acceptName">${escapeHtml(s.yourFullName)}</label><input id="acceptName" class="input" type="text" autocomplete="name"></div>
    <div class="dialog-actions">
      <button type="button" class="primary" data-action="confirm-accept">${escapeHtml(s.confirmAcceptance)}</button>
      <button type="button" data-close="accept">${escapeHtml(s.close)}</button>
    </div>
  </div>
</div>
<div class="bottom-bar" data-bottom-bar>${action}</div>`;
  return { title, h1: title, body, dir };
}

export interface BidPageView {
  route: string[];
  departAt: { date: string; time: string } | null;
  returnAt: { date: string; time: string } | null;
  vehicles: { index: number; seats: number }[];
  partySize: number;
  closesAt: string;
  bid: { prices: string[]; receivedAt: string } | null;
}

export function bidPageBody(v: BidPageView): string {
  const rows = v.vehicles
    .map(
      (x) => `<div class="field"><label class="field-label" for="price-${x.index}">Price for vehicle ${x.index}</label><input id="price-${x.index}" class="input" data-price-index="${x.index}" inputmode="decimal"></div>`
    )
    .join("");
  const shown = v.bid
    ? `<p class="bid-sent">Price sent.</p><button type="button" class="primary" data-action="change-price">Change price</button> <button type="button" data-action="withdraw">Withdraw bid</button>`
    : `<button type="button" class="primary" data-action="send-price">Send price</button>`;
  return `
<div class="b-page" data-b-page>
  <h1>Price this hire</h1>
  <p class="b-copy">Enter one price per vehicle. Prices close at ${escapeHtml((v.closesAt ?? "").replace("T", " ").replace("Z", ""))}.</p>
  <h2 class="q-section">Route</h2>
  <ul class="q-stops">${v.route.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
  <h2 class="q-section">Dates</h2>
  ${v.departAt ? `<p class="q-line"><strong>Out:</strong> ${attr(v.departAt.date)} ${attr(v.departAt.time)}</p>` : ""}
  ${v.returnAt ? `<p class="q-line"><strong>Return:</strong> ${attr(v.returnAt.date)} ${attr(v.returnAt.time)}</p>` : ""}
  <h2 class="q-section">Vehicles</h2>
  <ul class="q-vehicles">${v.vehicles.map((x) => `<li>Vehicle ${x.index} — ${x.seats} seats</li>`).join("")}</ul>
  <p class="q-line"><strong>Party size:</strong> ${attr(v.partySize)}</p>
  <h2 class="q-section">Your prices</h2>
  <form data-bid-form novalidate>
    <div class="group problems" data-problems hidden>
      <h2 class="problems-h">Problems</h2>
      <ul class="problems-list" data-problems-list></ul>
    </div>
    ${rows}
    <div class="dialog-actions">${shown}</div>
  </form>
</div>
<div class="dialog-holder" data-dialogs>
  <div class="dialog" data-overlay="withdraw" role="dialog" aria-modal="true" aria-labelledby="withdraw-title" hidden>
    <h2 id="withdraw-title">Withdraw bid</h2>
    <p>Withdrawing your price leaves you free to price again while the window is open.</p>
    <div class="dialog-actions">
      <button type="button" class="primary" data-action="confirm-withdraw">Confirm withdrawal</button>
      <button type="button" data-close="withdraw">Close</button>
    </div>
  </div>
</div>`;
}

export interface RunPageView {
  number: number;
  departAt: { date: string; time: string };
  stops: { id: string; text: string; presses: { arrived: string | null; boarded: string | null; left: string | null } }[];
  flightLine: string | null;
  charges: { stopId: string | null; kind: string; minutes: number; amount: string; accepted: boolean }[];
}

export function runSheetBody(v: RunPageView, lang: string): { title: string; body: string; dir: string } {
  const pl = lang === "pl";
  const s = {
    run: pl ? "Kurs" : "Run",
    stopOf: (i: number, n: number) => (pl ? `Przystanek ${i} z ${n}` : `Stop ${i} of ${n}`),
    arrived: pl ? "Na miejscu" : "Arrived",
    boarded: pl ? "Wsiedli" : "Boarded",
    left: pl ? "Odjazd" : "Left",
    comfort: pl ? "Postój" : "Comfort stop",
    back: pl ? "W trasie" : "Back on the road",
    details: pl ? "Szczegóły kursu" : "Run details",
    close: pl ? "Zamknij" : "Close",
    waiting: (n: number) => (pl ? `Do wysłania: ${n}` : `${n} waiting to send`),
    allSent: pl ? "Wszystko wysłane" : "All sent",
    language: pl ? "Język" : "Language",
    refresh: pl ? "Nie udało się odświeżyć. Próbujemy ponownie." : "Couldn't refresh. Trying again.",
  };
  const n = v.stops.length;
  const stops = v.stops
    .map((stop, i) => {
      const group = pl ? `Przystanek ${i + 1} z ${n}` : `Stop ${i + 1} of ${n}`;
      const presses = stop.presses;
      const btn = (kind: "arrived" | "boarded" | "left", label: string) =>
        presses[kind]
          ? `<button type="button" class="press big-press" data-press="${kind}" data-stop="${attr(stop.id)}" disabled aria-disabled="true">${escapeHtml(label)}</button>`
          : `<button type="button" class="press big-press" data-press="${kind}" data-stop="${attr(stop.id)}">${escapeHtml(label)}</button>`;
      return `<div class="run-stop" data-run-stop="${attr(stop.id)}" role="group" aria-label="${escapeHtml(group)}">
  <h2 class="stop-h">${escapeHtml(group)}</h2>
  <p class="stop-text">${escapeHtml(stop.text)}</p>
  ${btn("arrived", s.arrived)}
  ${btn("boarded", s.boarded)}
  ${btn("left", s.left)}
</div>`;
    })
    .join("");
  const title = `${s.run} ${v.number}`;
  const body = `
<div class="r-page" data-r-page data-run-number="${attr(v.number)}">
  <h1>${escapeHtml(title)}</h1>
  <div class="refresh-line run-refresh" data-part="refresh-line" hidden>${escapeHtml(s.refresh)}</div>
  <p class="r-meta">${attr(v.departAt.date)} ${attr(v.departAt.time)} UK time</p>
  ${v.flightLine ? `<p class="r-flight">${escapeHtml(v.flightLine)}</p>` : ""}
  ${stops}
  <p class="r-waiting" data-waiting-line hidden></p>
  <div class="language-switch">
    <label class="field-label" for="langSelect">${escapeHtml(s.language)}</label>
    <select id="langSelect" class="input" data-language>
      <option value="en"${pl ? "" : " selected"}>English</option>
      <option value="pl"${pl ? " selected" : ""}>Polski</option>
    </select>
  </div>
  <button type="button" class="run-details" data-open="run-details">${escapeHtml(s.details)}</button>
</div>
<div class="sheet run-sheet" data-overlay="run-details" role="dialog" aria-modal="true" aria-label="${escapeHtml(s.details)}" hidden>
  <button type="button" class="close" data-close="run-details">${escapeHtml(s.close)}</button>
  <h2>${escapeHtml(s.details)}</h2>
  <p>${attr(v.departAt.date)} ${attr(v.departAt.time)} UK time</p>
  <ul class="r-stops-list">${v.stops.map((x) => `<li>${escapeHtml(x.text)}</li>`).join("")}</ul>
</div>
<div class="bottom-bar r-bottom-bar" data-bottom-bar></div>`;
  return { title, body, dir: "ltr" };
}
