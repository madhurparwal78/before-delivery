import { html, raw, type Markup } from "../html.js";
import { dialog, documentPage, problems, selectField, textField } from "./layout.js";
import { wordmark } from "./art.js";
import { pool, nowSeconds } from "../db.js";
import { hireMoney, vehiclesOf } from "../domain.js";
import { moneyText } from "../http.js";
import { stopsOf } from "../api-enquiries.js";
import { hireSizes } from "../api-operators.js";
import { chargesOf, sheetJson } from "../api-runs.js";
import { quoteStage } from "../api-hires.js";
import { copyFor, dateIn, sheetCopy, type Language, type SheetLanguage } from "../../shared/strings.js";
import { money } from "../../shared/rules.js";
import { longDate, ukDate } from "../../shared/time.js";
import type { HireRow, BidAskRow, RunRow } from "../records.js";

const refreshLine = (copy: string): Markup => html`<p class="refresh-line" data-part="refresh-line" hidden data-client-owned>${copy}</p>`;
const statusLine = (): Markup => html`<p class="status-line" data-status hidden data-client-owned></p>`;
const languageSelect = (label: string, current: string, options: [string, string][]): Markup =>
  selectField({ label, name: "language", cls: "language-field", icon: "globe", options: options.map(([value, text]) => ({ value, label: text, selected: value === current })), extra: "data-language-switch data-nodirty" });

const QUOTE_STEPS = ["quoteSent", "accepted", "deposit", "balance", "travel"] as const;

export const quotePrivatePage = async (hire: HireRow, language: Language): Promise<string> => {
  const t = copyFor(language);
  const vehicles = await vehiclesOf(pool, hire.id);
  const stops = await stopsOf(pool, hire.id);
  const moneyNow = await hireMoney(pool, hire.id, vehicles);
  const now = nowSeconds();
  const first = vehicles.reduce((a, v) => Math.min(a, v.depart_instant), hire.depart_instant);
  const stage = quoteStage(hire, first, moneyNow.paymentState, now);
  const cancelled = Boolean(hire.cancellation);
  const accepted = hire.accepted_at !== null;
  const endDate = ukDate(hire.quote_ends_at as number);
  const ended = !accepted && now > (hire.quote_ends_at as number);
  const total = vehicles.reduce((a, v) => a + v.total, 0);
  const deposits = vehicles.reduce((a, v) => a + v.deposit, 0);
  const stepNames: Record<string, string> = { quoteSent: t.quoteSent, accepted: t.accepted, deposit: t.deposit, balance: t.balance, travel: t.travel };
  const canAccept = !cancelled && !accepted;
  const canSay = !cancelled && accepted && !hire.deposit_said_sent;
  const heading = t.yourQuote(hire.id);
  const errorCopy = JSON.stringify({ nameMismatch: t.nameMismatch, quoteEnded: t.ended(dateIn(language, endDate)), bookingCancelled: t.cancelled, pdfDown: t.pdfDown });
  return documentPage({
    title: heading, lang: language, dir: language === "ur" ? "rtl" : "ltr", kind: "private", live: true,
    app: html`<main id="screen" class="private-screen"><header class="private-head">${wordmark()}</header>
      <div class="band band-plum private-band"><h1 tabindex="-1">${heading.split(hire.id)[0]}<bdi class="reference">${hire.id}</bdi>${heading.split(hire.id)[1]}</h1></div>
      ${refreshLine(t.refreshFailed)}${statusLine()}
      <div class="private-body">${languageSelect(t.language, language, [["en", "English"], ["pl", "Polski"], ["ur", "اردو"]])}
      <ol class="stepper" aria-label="Progress" data-part="stepper">${QUOTE_STEPS.map((step) => html`<li${raw(step === stage ? ' aria-current="step"' : "")}>${stepNames[step]}</li>`)}</ol>
      ${cancelled ? html`<p class="line-mark">${t.cancelled}</p>` : ""}${ended && !cancelled ? html`<p class="line-mark">${t.ended(dateIn(language, endDate))}</p>` : ""}
      <dl class="facts private-facts">
        <div><dt>${t.route}</dt><dd>${stops.map((s) => html`<span class="block-line">${s.text}</span>`)}</dd></div>
        <div><dt>${t.out}</dt><dd>${dateIn(language, hire.depart_date)}, ${hire.depart_time}</dd></div>
        <div><dt>${t.returnLabel}</dt><dd>${hire.return_date ? html`${dateIn(language, hire.return_date)}, ${hire.return_time}` : "–"}</dd></div>
        <div><dt>${t.party}</dt><dd>${t.people(hire.party.people)}</dd></div>
        <div><dt>${t.vehicles}</dt><dd>${t.vehicleCount(vehicles.length)}</dd></div>
        <div><dt>${t.total}</dt><dd class="figure">${money(total)}</dd></div>
        <div><dt>${t.depositDue}</dt><dd class="figure">${money(deposits)}</dd></div>
      </dl>
      <p>${t.validUntil(dateIn(language, endDate))}</p>
      ${accepted && !cancelled ? html`<p>${t.payBy(hire.id)}</p>` : ""}
      ${hire.deposit_said_sent && !cancelled ? html`<p class="line-mark">${t.checking}</p>` : ""}
      <p><a class="btn btn-outline" href="/api/q/${hire.quote_token}/pdf" download>${t.download}</a></p></div></main>
      ${canAccept || canSay ? html`<div class="main-actions private-actions">${canAccept ? html`<button type="button" class="btn btn-plum" data-dialog-open="accept-quote">${t.accept}</button>` : html`<button type="button" class="btn btn-plum" data-act="POST /api/q/${hire.quote_token}/deposit-sent" data-ok="${t.checking}">${t.sentDeposit}</button>`}</div>` : ""}`,
    overlays: canAccept ? dialog({ id: "accept-quote", title: t.acceptThis, closeLabel: t.close, body: html`<form data-api="POST /api/q/${hire.quote_token}/accept" data-ok="${t.quoteAccepted}" data-close-on-ok data-errors="${errorCopy}" novalidate>${problems()}${textField({ label: t.fullName, name: "name", field: "name", icon: "person", autocomplete: "name" })}<button type="submit" class="btn btn-plum btn-full">${t.confirm}</button></form>` }) : undefined,
  });
};
export const endedPrivatePage = (language: Language, text: string): string => {
  return documentPage({ title: text, lang: language, dir: language === "ur" ? "rtl" : "ltr", kind: "plain", app: html`<main id="screen" class="sign-screen"><div class="sign-card">${wordmark()}<h1 tabindex="-1">${text}</h1></div></main>` });
};

export const bidPrivatePage = async (ask: BidAskRow, hire: HireRow): Promise<string> => {
  const stops = await stopsOf(pool, hire.id);
  const sizes = hireSizes(hire);
  const live = ask.prices && !ask.withdrawn;
  return documentPage({
    title: "Price this hire", lang: "en-GB", kind: "private", live: true,
    app: html`<main id="screen" class="private-screen"><header class="private-head">${wordmark()}</header><div class="band band-plum private-band"><h1 tabindex="-1">Price this hire</h1></div>
      ${refreshLine("Couldn't refresh. Trying again.")}${statusLine()}
      <div class="private-body"><dl class="facts private-facts">
        <div><dt>Route</dt><dd>${stops.map((s) => html`<span class="block-line">${s.text}</span>`)}</dd></div>
        <div><dt>Dates</dt><dd>${longDate(hire.depart_date)}, ${hire.depart_time}${hire.return_date ? html`<br>${longDate(hire.return_date)}, ${hire.return_time}` : ""}</dd></div>
        <div><dt>Vehicles</dt><dd>${sizes.map((seats) => `${seats} seats`).join(", ")}</dd></div><div><dt>Party size</dt><dd>${hire.party.people}</dd></div></dl>
      <form id="bid-form" data-flow="bid" data-token="${ask.token}" data-count="${sizes.length}" novalidate>${problems()}${sizes.map((_, i) => textField({ label: `Price for vehicle ${i + 1}`, name: `price-${i}`, field: "prices", icon: "pound", value: live ? moneyText((ask.prices as number[])[i]) : "", inputmode: "decimal", extra: "data-bid-price" }))}</form>
      ${live ? html`<p><button type="button" class="btn btn-outline" data-dialog-open="withdraw-bid">Withdraw bid</button></p>` : ""}</div></main>
      <div class="main-actions private-actions"><button type="submit" form="bid-form" class="btn btn-plum">${live ? "Change price" : "Send price"}</button></div>`,
    overlays: live ? dialog({ id: "withdraw-bid", title: "Withdraw bid", body: html`<form data-api="DELETE /api/b/${ask.token}/bid" data-format="none" data-ok="Bid withdrawn." data-close-on-ok novalidate>${problems()}<p>You can price again while the window is open.</p><button type="submit" class="btn btn-plum btn-full">Confirm withdrawal</button></form>` }) : undefined,
  });
};
export const bidEndedPage = (): string => endedPrivatePage("en", "This bid page has closed").replace('<html lang="en"', '<html lang="en-GB"');

const PRESSES = ["arrived", "boarded", "left", "comfortStop", "backOnTheRoad"] as const;
export const runSheetPage = async (run: RunRow, language: SheetLanguage): Promise<string> => {
  const t = sheetCopy(language);
  const sheet = await sheetJson(pool, run);
  const charges = await chargesOf(pool, run);
  const total = sheet.stops.length;
  return documentPage({
    title: t.run(run.number), lang: language, kind: "private", live: true,
    extraHead: html`<meta name="theme-color" content="#33044A">`,
    app: html`<main id="screen" class="private-screen run-sheet" data-sheet data-token="${run.token}" data-lang="${language}" data-recorded="${language === "pl" ? "Zapisano: {p}." : "{p} recorded."}" data-waiting="${t.waiting(9999)}" data-all-sent="${t.allSent}">
      <header class="private-head">${wordmark()}</header><div class="band band-plum private-band"><h1 tabindex="-1">${t.run(run.number)}</h1></div>
      ${refreshLine(t.refreshFailed)}
      <div class="waiting-count" data-waiting-count data-client-owned>${t.allSent}</div>
      <div class="private-body"><div class="sheet-tools">${languageSelect(t.language, language, [["en", "English"], ["pl", "Polski"]])}<button type="button" class="btn btn-outline" data-dialog-open="run-details">${t.details}</button></div>
      ${sheet.flightLine ? html`<p class="line-mark">${t.flight}</p>` : ""}
      ${sheet.stops.map((s, i) => html`<div class="sheet-stop" role="group" aria-label="${t.stop(i + 1, total)}" data-key="${s.id}" data-stop="${s.id}"><h2>${t.stop(i + 1, total)}</h2><p>${s.text}</p>
        <div class="press-row">${PRESSES.map((kind) => { const label = t[kind]; const done = Boolean(s.presses[kind]); return html`<button type="button" class="btn btn-press${done ? " is-done" : ""}" data-press="${kind}" data-press-done="${done ? "1" : "0"}" data-client-attrs="aria-disabled class">${label}</button>`; })}</div>
        ${charges.filter((c) => c.stopId === s.id && c.kind === "waiting").map((c) => html`<p class="line-mark">${t.charge(money(c.amount))}</p>`)}</div>`)}</div></main>`,
    overlays: dialog({ id: "run-details", title: t.details, kind: "sheet", closeLabel: t.close, body: html`<dl class="facts"><div><dt>${t.run(run.number)}</dt><dd>${dateInSheet(language, sheet.departAt.date)}, ${sheet.departAt.time}</dd></div>${sheet.stops.map((s, i) => html`<div><dt>${t.stop(i + 1, total)}</dt><dd>${s.text}</dd></div>`)}</dl>` }),
  });
};
const dateInSheet = (language: SheetLanguage, date: string): string => dateIn(language as Language, date);
