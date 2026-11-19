import { html, raw, type Markup } from "../html.js";
import { addressField, dialog, documentPage, fileField, formAttrs, hourOptions, minuteOptions, problems, radioGroup, selectField, textField } from "./layout.js";
import { icon, wordmark } from "./art.js";
import { journeyFields } from "./public.js";
import { nowSeconds, only, pool, rows } from "../db.js";
import type { Desk } from "../http.js";
import { moneyText } from "../http.js";
import { hireMoney, marginText, type RateTable, PAYMENT_NAMES, rateInForce, seatLabels, vehiclesOf } from "../domain.js";
import { customersList, customerState } from "../api-access.js";
import { duplicatesOf, enquiriesPage, stopsOf, tripOnRead } from "../api-enquiries.js";
import { bidRows, lastDayOf, operatorsOf, standingReason } from "../api-operators.js";
import { hireRates } from "../api-hires.js";
import { chargesOf, currentWeek, diaryRead, hoursRead, type DiaryRun } from "../api-runs.js";
import { adultsLine, passengersOf, seatsJson } from "../api-seats.js";
import { bookings, moneyHeld } from "../api-money.js";
import { documentsOf, kindName, nextNumbers } from "../api-documents.js";
import { complaintsOf, itemsOf } from "../api-aftercare.js";
import { money, OCCASION_LABELS, JOURNEY_LABELS, peopleCount, printedMoney } from "../../shared/rules.js";
import { dateToTyped, longDate, mondayOfIsoWeek, ukDate, ukTime, instantToLocal } from "../../shared/time.js";
import type { DeskRow, CustomerRow, HireRow, OperatorView, VehicleRow, RunRow, DocumentRow, ChangeRow } from "../records.js";

const NAV: [string, string][] = [["Enquiries", "/enquiries"], ["Operators", "/operators"], ["Payments", "/payments"], ["Diary", "/diary"], ["Documents", "/documents"], ["Rate tables", "/rates"], ["Customers", "/customers"], ["Complaints", "/aftercare/complaints"], ["Lost property", "/aftercare/lost-property"]];
const navLinks = (current: string): Markup => html`<ul>${NAV.map(([label, path]) => html`<li><a href="${path}"${raw(path === current ? ' aria-current="page"' : "")} data-nav>${label}</a></li>`)}</ul>`;
const emptyState = (line: string): Markup => html`<div class="empty">${icon("note", 56)}<p>${line}</p></div>`;
const frame = (label: string, body: Markup, cls = ""): Markup => html`<div class="frame ${cls}" tabindex="0" role="region" aria-label="${label}">${body}</div>`;
const actionBtn = (label: string, attrs: string, cls = "btn-plum"): Markup => html`<button type="button" class="btn ${cls}" ${raw(attrs)}>${label}</button>`;

interface Shell { title: string; heading: string; desk: Desk; current?: string; main: Markup; action?: Markup; overlays?: Markup }
const deskPage = ({ title, heading, desk, current, main, action, overlays }: Shell): string => documentPage({
  title: `${title} | Wayticket`, kind: "desk", live: true,
  app: html`<header class="desk-top">${wordmark()}<button type="button" class="menu-button" data-dialog-open="desk-menu" aria-label="Menu"><span></span><span></span><span class="short"></span></button></header>
    <div class="band band-plum desk-band"><div class="desk-band-top"><p class="desk-name">${desk.name}</p><h1 tabindex="-1">${heading}</h1></div>
      <div class="desk-nav-wrap"><nav class="desk-nav" aria-label="Desk">${navLinks(current ?? "")}</nav><div class="desk-account"><button type="button" class="btn-plain on-plum" data-dialog-open="change-password">Change password</button><button type="button" class="btn-plain on-plum" data-sign-out>Sign out</button></div></div></div>
    <p class="refresh-line" data-part="refresh-line" hidden data-client-owned>Couldn't refresh. Trying again.</p>
    <div class="ended-line" data-ended hidden data-client-owned>Your session ended. Sign in again to keep going — what you typed is still here. <a data-sign-in-again href="/sign-in">Sign in again</a></div>
    <p class="status-line" data-status hidden data-client-owned></p>
    <main id="screen" class="desk-screen">${main}</main>
    ${action ? html`<div class="main-actions">${action}</div>` : ""}`,
  overlays: html`${dialog({ id: "desk-menu", title: "Desk menu", kind: "sheet", body: html`<nav class="menu-nav" aria-label="Desk">${navLinks(current ?? "")}</nav><div class="menu-actions"><button type="button" class="btn btn-outline" data-dialog-open="change-password">Change password</button><button type="button" class="btn btn-outline" data-sign-out>Sign out</button></div>` })}
    ${dialog({ id: "change-password", title: "Change password", body: html`<form ${formAttrs("POST /api/auth/password", "Password changed.", "data-close-on-ok")}>${problems()}${textField({ label: "Current password", name: "currentPassword", type: "password", field: "currentPassword", autocomplete: "current-password", icon: "shield" })}${textField({ label: "New password", name: "newPassword", type: "password", field: "newPassword", autocomplete: "new-password", icon: "shield" })}<button type="submit" class="btn btn-plum btn-full">Save password</button></form>` })}
    ${overlays}`,
});

// ---- Enquiries.
const addEnquiryDialog = (): Markup => {
  const fields = journeyFields("", { calendar: false });
  return dialog({ id: "add-enquiry", title: "Add enquiry", body: html`<form class="journey-form-desk" data-journey="desk" ${formAttrs("POST /api/enquiries", "Enquiry added.", "data-close-on-ok")}>${problems()}${fields.route}${fields.when}${fields.details}<button type="submit" class="btn btn-plum btn-full">Save enquiry</button></form>` });
};
const STATES = ["new", "priced", "quoted", "won", "lost"];
const stateName = (s: string): string => s[0].toUpperCase() + s.slice(1);

export const enquiriesScreen = async (desk: Desk, query: URLSearchParams): Promise<string> => {
  const state = query.get("state") ?? "";
  const occasion = query.get("occasion") ?? "";
  const q = query.get("q") ?? "";
  const { list, nextCursor, prevCursor } = await enquiriesPage(desk.id, query);
  const carry = (name: string, cursor: string): string => {
    const next = new URLSearchParams();
    if (state) next.set("state", state);
    if (occasion) next.set("occasion", occasion);
    if (q) next.set("q", q);
    next.set(name, cursor);
    return `/enquiries?${next}`;
  };
  const filterOptions = [{ value: "", label: "All" }, ...STATES.map((value) => ({ value, label: stateName(value) }))].map((o) => ({ ...o, checked: o.value === state }));
  return deskPage({
    title: "Enquiries", heading: "Enquiries", desk, current: "/enquiries",
    main: html`<form class="filters" data-filters novalidate>
        ${radioGroup("Filter by state", "state", filterOptions, { cls: "segments-plain", extra: "data-morph-radio" })}
        <div class="filter-pair">${selectField({ label: "Occasion", name: "occasion", options: Object.entries(OCCASION_LABELS).map(([value, label]) => ({ value, label, selected: value === occasion })), placeholder: "All occasions", icon: "tag" })}
        ${textField({ label: "Search enquiries", type: "search", name: "q", value: q, icon: "search", extra: "data-keep-typed" })}</div></form>
      ${list.length ? frame("Enquiries list", html`<table class="table"><thead><tr><th scope="col">Reference</th><th scope="col">Customer</th><th scope="col">Occasion</th><th scope="col">State</th><th scope="col">Departure</th></tr></thead><tbody>${list.map((h) => html`<tr data-key="${h.id}"><td><a class="row-link" href="/enquiries/${h.id}" data-nav data-key="link-${h.id}">${h.id}</a></td><td class="name-cell">${h.name}</td><td>${OCCASION_LABELS[h.occasion]}</td><td>${stateName(h.state)}</td><td>${longDate(h.depart_date)}, ${h.depart_time}</td></tr>`)}</tbody></table>`) : emptyState("No enquiries match these filters.")}
      <div class="pager">${prevCursor ? html`<a class="btn btn-outline" href="${carry("before", prevCursor)}" data-soft>Previous page</a>` : ""}${nextCursor ? html`<a class="btn btn-outline" href="${carry("after", nextCursor)}" data-soft>Next page</a>` : ""}</div>`,
    action: actionBtn("Add enquiry", 'data-dialog-open="add-enquiry"'),
    overlays: addEnquiryDialog(),
  });
};

const relatedLinks = (id: string, firstRun: string | null): Markup => html`<nav class="related" aria-label="This hire"><a class="btn btn-outline" href="/enquiries/${id}/bids" data-nav>Operator bids</a><a class="btn btn-outline" href="/hires/${id}/quote" data-nav>Quote</a><a class="btn btn-outline" href="/hires/${id}/hours${firstRun ? `?run=${firstRun}` : ""}" data-nav>Drivers' hours</a><a class="btn btn-outline" href="/hires/${id}/seats" data-nav>Seat plan</a><a class="btn btn-outline" href="/hires/${id}/changes" data-nav>Changes</a></nav>`;
const notCheckedMark = (checked: boolean): Markup => (checked ? html`` : html`<span class="mark-flag">Not checked</span>`);

export const enquiryScreen = async (desk: Desk, hire: HireRow): Promise<string> => {
  const stops = await stopsOf(pool, hire.id);
  const dups = await duplicatesOf(hire);
  const runs = await rows<Pick<RunRow, "id">>(pool, "SELECT id FROM runs WHERE hire_id=$1 ORDER BY number LIMIT 1", [hire.id]);
  const party = hire.party;
  return deskPage({
    title: `Enquiry ${hire.id}`, heading: `Enquiry ${hire.id}`, desk, current: "/enquiries",
    main: html`<section class="panel">${radioGroup("State", "state", STATES.map((value) => ({ value, label: stateName(value), checked: value === hire.state })), { cls: "segments-plain", extra: html`data-state-bar data-api="PATCH /api/enquiries/${hire.id}"`.text })}<p class="saving" data-saving hidden data-client-owned>Saving…</p></section>
      <section class="panel"><h2>What the ticket held</h2><dl class="facts">
        <div><dt>Occasion</dt><dd>${OCCASION_LABELS[hire.occasion]}</dd></div><div><dt>Journey</dt><dd>${JOURNEY_LABELS[hire.journey_type]}</dd></div>
        ${stops.map((s, i) => html`<div data-key="${s.id}"><dt>${i === 0 ? "From" : i === stops.length - 1 ? "To" : `Stop ${i}`}</dt><dd>${s.text} ${notCheckedMark(s.checked)}</dd></div>`)}
        ${hire.details ? html`<div><dt>Details</dt><dd>${hire.details}</dd></div>` : ""}
        <div><dt>Out</dt><dd>${longDate(hire.depart_date)}, ${hire.depart_time}</dd></div>${hire.return_date ? html`<div><dt>Return</dt><dd>${longDate(hire.return_date)}, ${hire.return_time}</dd></div>` : ""}
        <div><dt>People</dt><dd>${peopleCount(party.people)}</dd></div><div><dt>Bags</dt><dd>${party.large} large, ${party.medium} medium, ${party.hand} hand</dd></div><div><dt>Wheelchair users</dt><dd>${party.wheelchairs}</dd></div>
        <div><dt>Name</dt><dd>${hire.name}</dd></div><div><dt>Email</dt><dd>${hire.email}</dd></div><div><dt>Telephone</dt><dd>${hire.telephone}</dd></div></dl></section>
      ${dups.length ? html`<section class="panel"><h2>Possible duplicates</h2><ul class="plain-list">${dups.map((d) => html`<li data-key="${d.id}"><a class="row-link" href="/enquiries/${d.id}" data-nav>${d.id}</a></li>`)}</ul><button type="button" class="btn btn-outline" data-dialog-open="merge-enquiries">Merge</button></section>` : ""}
      ${relatedLinks(hire.id, runs[0]?.id ?? null)}`,
    action: html`<a class="btn btn-plum" href="/enquiries/${hire.id}/trip" data-nav>Plan this trip</a>`,
    overlays: dups.length ? dialog({ id: "merge-enquiries", title: "Merge enquiries", body: html`<form ${formAttrs("POST /api/enquiries/merge", "Enquiries merged.", html`data-close-on-ok data-flow="merge" data-current="${hire.id}"`.text)}>${problems()}<p>The earlier reference is kept and the later one is listed under it.</p><ul class="plain-list check-list">${dups.map((d) => html`<li><label class="check-row"><input type="checkbox" name="merge" value="${d.id}" checked><span>${d.id}</span></label></li>`)}</ul><button type="submit" class="btn btn-plum btn-full">Merge enquiries</button></form>` }) : undefined,
  });
};

export const tripScreen = async (desk: Desk, hire: HireRow): Promise<string> => {
  const trip = await tripOnRead(hire);
  const stops = trip.stops;
  const plan = trip.plan;
  const starting = (plan.sizes ?? plan.suggested).join(", ");
  return deskPage({
    title: `Trip plan ${hire.id}`, heading: `Trip plan ${hire.id}`, desk, current: "/enquiries",
    main: html`<section class="panel"><h2>Stops in order</h2><ol class="stop-rows" data-trip data-hire="${hire.id}">${stops.map((s, i) => html`<li class="stop-row" data-key="${s.id}" data-stop-id="${s.id}" data-text="${s.text.split(",")[0]}"><span class="stop-name">${s.text}</span>${notCheckedMark(s.checked)}<span class="stop-buttons"><button type="button" class="btn btn-field" data-stop-move="-1" aria-disabled="${i === 0 ? "true" : "false"}">Move up</button><button type="button" class="btn btn-field" data-stop-move="1" aria-disabled="${i === stops.length - 1 ? "true" : "false"}">Move down</button></span></li>`)}</ol></section>
      <section class="panel"><h2>Legs</h2>${trip.planOutOfDate ? html`<p class="line-mark">Plan is out of date</p><button type="button" class="btn btn-outline" data-act="POST /api/enquiries/${hire.id}/trip/route" data-ok="Route updated.">Try route again</button>` : ""}
        ${frame("Legs", html`<table class="table table-narrow"><thead><tr><th scope="col">Leg</th><th scope="col">Miles</th><th scope="col">Kilometres</th><th scope="col">Minutes</th></tr></thead><tbody>${trip.legs.map((leg, i) => html`<tr><td>${i + 1}</td><td>${leg.miles}</td><td>${leg.km}</td><td>${leg.minutes}</td></tr>`)}</tbody></table>`)}</section>
      <section class="panel"><h2>Vehicles</h2><p>Suggested: ${plan.suggested.join(", ")}</p>${plan.largerThanNeeded ? html`<p class="line-mark">Larger than needed</p>` : ""}
        <form id="plan-form" ${formAttrs(`PUT /api/enquiries/${hire.id}/trip/plan`, "Plan saved.")}>${problems()}${textField({ label: "Plan", name: "sizes", dataType: "sizes", field: "sizes", icon: "seat", value: starting })}</form></section>
      ${relatedLinks(hire.id, null)}`,
    action: html`<button type="submit" form="plan-form" class="btn btn-plum">Save plan</button>`,
  });
};

export const bidsScreen = async (desk: Desk, hire: HireRow, query: URLSearchParams): Promise<string> => {
  const sort = query.get("sort") === "priceHighest" ? "priceHighest" : "priceLowest";
  const list = await bidRows(hire, sort);
  const operators = await operatorsOf(pool, desk.id);
  const lastDay = await lastDayOf(pool, hire);
  const statusName: Record<string, string> = { asked: "Asked", open: "Open", withdrawn: "Withdrawn", closed: "Closed" };
  const awardedTo = hire.awarded_operator ? operators.find((o) => o.id === hire.awarded_operator) : null;
  return deskPage({
    title: `Operator bids ${hire.id}`, heading: `Operator bids ${hire.id}`, desk, current: "/enquiries",
    main: html`${awardedTo ? html`<p class="line-mark">Awarded to ${awardedTo.name} at ${ukTime(hire.awarded_at as number)}.</p>` : ""}
      <p><a class="btn btn-outline" href="/enquiries/${hire.id}/bids?sort=${sort === "priceLowest" ? "priceHighest" : "priceLowest"}" data-soft>Sort by price</a></p>
      ${frame("Bids", list.length ? html`<table class="table"><thead><tr><th scope="col">Operator</th><th scope="col">Standing</th><th scope="col">Status</th><th scope="col">Prices</th><th scope="col">Total</th><th scope="col">Received</th><th scope="col"><span class="sr-only">Award</span></th></tr></thead><tbody>${list.map((b) => html`<tr data-key="${b.operatorId}"><td>${b.operatorName}</td><td>${b.clear ? "Clear" : b.reason}</td><td>${statusName[b.status]}</td><td>${b.prices.map((p: string) => html`<span class="figure">${printedMoney(p)}</span> `)}</td><td class="figure">${b.total ? `${printedMoney(b.total)}` : ""}</td><td>${b.receivedSeconds && b.total ? `${longDate(ukDate(b.receivedSeconds))}, ${ukTime(b.receivedSeconds)}` : ""}</td><td>${b.total && !hire.awarded_operator ? html`<button type="button" class="btn btn-outline" data-act="POST /api/enquiries/${hire.id}/award" data-body="${JSON.stringify({ operatorId: b.operatorId })}" data-ok="Awarded to ${b.operatorName}.">Award</button>` : ""}</td></tr>`)}</tbody></table>` : emptyState("No bids yet."))}`,
    action: hire.awarded_operator ? undefined : actionBtn("Ask operators", 'data-dialog-open="ask-operators"'),
    overlays: hire.awarded_operator ? undefined : dialog({
      id: "ask-operators", title: "Ask operators", body: html`<form ${formAttrs(`POST /api/enquiries/${hire.id}/bids/ask`, "Operators asked.", 'data-close-on-ok data-flow="ask"')}>${problems()}
        ${operators.length ? html`<ul class="plain-list check-list" data-morph-keep>${operators.map((o) => { const reason = standingReason(o, hire, lastDay); return html`<li data-key="${o.id}"><label class="check-row"><input type="checkbox" name="operatorIds" value="${o.id}"><span>${o.name}, ${o.town} <small>${reason ? reason : "Clear"}</small></span></label></li>`; })}</ul>` : html`<p>No operators yet. Press Refresh directory.</p>`}
        <button type="submit" class="btn btn-plum btn-full">Send asks</button></form>`,
    }),
  });
};

export const quoteScreen = async (desk: Desk, hire: HireRow): Promise<string> => {
  const vehicles = await vehiclesOf(pool, hire.id);
  const rates = await hireRates(pool, hire);
  const accepted = hire.accepted_at !== null;
  const total = vehicles.reduce((a, v) => a + v.total, 0);
  const deposits = vehicles.reduce((a, v) => a + v.deposit, 0);
  const sending = hire.quote_sent_at ? `Sent ${longDate(ukDate(hire.quote_sent_at))}, ${ukTime(hire.quote_sent_at)}. Valid until ${longDate(ukDate(hire.quote_ends_at as number))}.` : "Not sent yet.";
  return deskPage({
    title: `Quote ${hire.id}`, heading: `Quote ${hire.id}`, desk, current: "/enquiries",
    main: vehicles.length ? html`<form class="quote-form" data-quote data-hire="${hire.id}" data-version="${hire.quote_version}" novalidate>${problems()}
        ${frame("Quote vehicles", html`<table class="table"><thead><tr><th scope="col">Vehicle</th><th scope="col">Seats</th><th scope="col">Bought price</th><th scope="col">Margin</th><th scope="col">Selling price</th><th scope="col">VAT</th><th scope="col">Total</th><th scope="col">Deposit</th></tr></thead><tbody>${vehicles.map((v, i) => html`<tr data-key="${v.id}" data-vehicle="${v.id}" data-seats="${v.seats}" data-bought="${moneyText(v.bought)}"><td>${i + 1}</td><td>${v.seats}</td><td class="figure">${money(v.bought)}</td><td><label class="sr-only" for="margin-${i + 1}">Margin for vehicle ${i + 1}</label><input class="cell-input" id="margin-${i + 1}" type="number" min="0" max="60" step="0.5" value="${marginText(v.margin_halves)}" data-margin data-field="marginPercent"${raw(accepted ? " readonly" : "")}></td><td class="figure" data-cell="sellingPrice">${money(v.selling)}</td><td class="figure" data-cell="vat">${money(v.vat)}</td><td class="figure" data-cell="total">${money(v.total)}</td><td class="figure" data-cell="deposit">${money(v.deposit)}</td></tr>`)}</tbody></table>`)}
        <div class="totals" role="group" aria-label="Totals" data-totals><p><span>Total</span> <strong class="figure" data-total>${money(total)}</strong></p><p><span>Deposits</span> <strong class="figure" data-deposit-total>${money(deposits)}</strong></p></div></form>
        <section class="panel"><h2>Sending</h2><p>${sending}</p>${accepted ? html`<p class="line-mark">This quote is accepted. Use Changes instead.</p>` : ""}${hire.quote_token ? html`<p><a class="text-link" href="/q/${hire.quote_token}" data-full>Open the private page</a></p>` : ""}<p><button type="button" class="btn btn-outline" data-reload hidden data-client-attrs="hidden">Reload</button></p></section>
        <section class="panel"><h2>Rates in force</h2><dl class="facts"><div><dt>Takes effect on</dt><dd>${longDate(rates.effective_from)}</dd></div><div><dt>Default margin</dt><dd>${marginText(rates.margin_halves)}%</dd></div><div><dt>Waiting rate per hour</dt><dd>${money(rates.waiting_rate)}</dd></div><div><dt>Second driver charge</dt><dd>${money(rates.second_driver)}</dd></div></dl></section>`
      : html`<section class="panel"><p>Award this hire to an operator first. Its quote is built from the winning prices.</p><p><a class="btn btn-outline" href="/enquiries/${hire.id}/bids" data-nav>Operator bids</a></p></section>`,
    action: vehicles.length && !accepted ? actionBtn("Send quote", 'data-dialog-open="send-quote"') : undefined,
    overlays: vehicles.length && !accepted ? dialog({ id: "send-quote", title: "Send quote", body: html`<form data-flow="send-quote" data-hire="${hire.id}" novalidate>${problems()}<p>The customer gets one mail with the total, the valid-until date and the private address.</p><button type="submit" class="btn btn-plum btn-full">Send now</button></form>` }) : undefined,
  });
};

export const ratesScreen = async (desk: Desk): Promise<string> => {
  const tables = await rows<RateTable>(pool, "SELECT * FROM rate_tables WHERE desk_id=$1 ORDER BY effective_from", [desk.id]);
  const inForce = await rateInForce(pool, desk.id, ukDate(nowSeconds()));
  return deskPage({
    title: "Rate tables", heading: "Rate tables", desk, current: "/rates",
    main: frame("Rate tables list", html`<table class="table"><thead><tr><th scope="col">Takes effect on</th><th scope="col">Default margin</th><th scope="col">Waiting rate per hour</th><th scope="col">Second driver charge</th><th scope="col">Minibus deposit</th><th scope="col">Higher minibus deposit</th><th scope="col">Coach deposit</th><th scope="col">Higher coach deposit</th><th scope="col">In force</th></tr></thead><tbody>${tables.map((t) => html`<tr data-key="${t.id}"><td>${longDate(t.effective_from)}</td><td>${marginText(t.margin_halves)}%</td><td>${money(t.waiting_rate)}</td><td>${money(t.second_driver)}</td><td>${money(t.deposit_minibus)}</td><td>${money(t.deposit_minibus_higher)}</td><td>${money(t.deposit_coach)}</td><td>${money(t.deposit_coach_higher)}</td><td>${t.id === inForce.id ? "In force" : ""}</td></tr>`)}</tbody></table>`),
    action: actionBtn("Add rate table", 'data-dialog-open="add-rate"'),
    overlays: dialog({
      id: "add-rate", title: "Add rate table", body: html`<form ${formAttrs("POST /api/rates", "Rate table added.", "data-close-on-ok")}>${problems()}
      ${textField({ label: "Takes effect on", name: "effectiveFrom", dataType: "date", field: "effectiveFrom", icon: "calendar", value: dateToTyped(ukDate(nowSeconds())) })}
      ${textField({ label: "Default margin", name: "defaultMarginPercent", field: "defaultMarginPercent", value: marginText(inForce.margin_halves), icon: "percent" })}
      ${textField({ label: "Waiting rate per hour", name: "waitingRatePerHour", field: "waitingRatePerHour", value: moneyText(inForce.waiting_rate), icon: "pound" })}
      ${textField({ label: "Second driver charge", name: "secondDriverCharge", field: "secondDriverCharge", value: moneyText(inForce.second_driver), icon: "pound" })}
      ${textField({ label: "Minibus deposit", name: "depositMinibus", field: "depositMinibus", value: moneyText(inForce.deposit_minibus), icon: "pound" })}
      ${textField({ label: "Higher minibus deposit", name: "depositMinibusHigher", field: "depositMinibusHigher", value: moneyText(inForce.deposit_minibus_higher), icon: "pound" })}
      ${textField({ label: "Coach deposit", name: "depositCoach", field: "depositCoach", value: moneyText(inForce.deposit_coach), icon: "pound" })}
      ${textField({ label: "Higher coach deposit", name: "depositCoachHigher", field: "depositCoachHigher", value: moneyText(inForce.deposit_coach_higher), icon: "pound" })}
      <button type="submit" class="btn btn-plum btn-full">Save table</button></form>`,
    }),
  });
};

// ---- Operators.
export const operatorsScreen = async (desk: Desk): Promise<string> => {
  const operators = await operatorsOf(pool, desk.id);
  const paper = (o: OperatorView, kind: string): string => {
    const found = o.paperRows.find((p) => p.kind === kind);
    return found ? `${longDate(found.ends_on)}${found.stored ? "" : " (no file yet)"}` : "Missing";
  };
  return deskPage({
    title: "Operators", heading: "Operators", desk, current: "/operators",
    main: operators.length ? frame("Operators list", html`<table class="table table-wide"><thead><tr><th scope="col">Operator</th><th scope="col">Town</th><th scope="col">Sizes</th><th scope="col">Operator licence</th><th scope="col">Public liability cover</th><th scope="col">Driver DBS check</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${operators.map((o) => html`<tr data-key="${o.id}"><td>${o.name}${o.listed ? "" : html` <span class="mark-flag">No longer listed</span>`}</td><td>${o.town}</td><td>${o.sizes.join(", ")}</td><td>${paper(o, "operatorLicence")}</td><td>${paper(o, "publicLiabilityCover")}</td><td>${o.dbs_checked_on ? longDate(o.dbs_checked_on) : "Missing"}</td><td><div class="cell-actions"><button type="button" class="btn btn-outline" data-dialog-open="upload-paper" data-form-api="POST /api/operators/${o.id}/papers">Upload paper</button><button type="button" class="btn btn-outline" data-dialog-open="set-dbs" data-form-api="PUT /api/operators/${o.id}/dbs">Set DBS date</button></div></td></tr>`)}</tbody></table>`) : emptyState("No operators yet. Press Refresh directory."),
    action: html`<button type="button" class="btn btn-plum" data-act="POST /api/operators/refresh" data-ok="Directory refreshed.">Refresh directory</button>`,
    overlays: html`${dialog({ id: "upload-paper", title: "Upload paper", body: html`<form data-api="" data-format="multipart" data-ok="Paper stored." data-close-on-ok novalidate>${problems()}
        ${selectField({ label: "Paper", name: "kind", field: "kind", options: [{ value: "operatorLicence", label: "Operator licence" }, { value: "publicLiabilityCover", label: "Public liability cover" }], icon: "file" })}
        ${textField({ label: "Ends on", name: "endsOn", dataType: "date", field: "endsOn", icon: "calendar" })}${fileField("File", "file", "file")}<button type="submit" class="btn btn-plum btn-full">Store paper</button></form>` })}
      ${dialog({ id: "set-dbs", title: "Set DBS date", body: html`<form data-api="" data-close-on-ok data-ok="Date saved." novalidate>${problems()}${textField({ label: "Checked on", name: "checkedOn", dataType: "date", field: "checkedOn", icon: "calendar" })}<button type="submit" class="btn btn-plum btn-full">Save date</button></form>` })}`,
  });
};

// ---- Payments.
export const paymentsScreen = async (desk: Desk): Promise<string> => {
  const held = await moneyHeld(pool, desk.id);
  const list = await bookings(desk.id);
  return deskPage({
    title: "Payments", heading: "Payments", desk, current: "/payments",
    main: html`<section class="panel money-held"><p class="money-label">Money held</p><p class="money-big figure">${money(held)}</p><a class="btn btn-outline" href="/api/payments/download" download>Download payments</a></section>
      ${list.length ? frame("Bookings", html`<table class="table"><thead><tr><th scope="col">Reference</th><th scope="col">Customer</th><th scope="col">State</th><th scope="col">Vehicle</th><th scope="col">Deposit paid</th><th scope="col">Balance paid</th><th scope="col">Paid</th><th scope="col">Owed</th><th scope="col">Credit</th></tr></thead><tbody>${list.map(({ hire, vehicles, money: m }) => html`<tr data-key="${hire.id}"><td><a class="row-link" href="/hires/${hire.id}/changes" data-nav data-key="link-${hire.id}">${hire.id}</a></td><td class="name-cell">${hire.name}</td><td>${PAYMENT_NAMES[m.paymentState]}</td><td>${vehicles.map((v) => html`<div>${v.seats} seats</div>`)}</td><td>${vehicles.map((v) => html`<div class="figure">${money(v.depositPaid)}</div>`)}</td><td>${vehicles.map((v) => html`<div class="figure">${money(v.balancePaid)}</div>`)}</td><td class="figure">${money(m.paid)}</td><td class="figure">${money(m.owed)}</td><td class="figure">${m.credit ? `Credit ${money(m.credit)}` : ""}</td></tr>`)}</tbody></table>`) : emptyState("No payments yet.")}`,
    action: actionBtn("Bring in statement", 'data-dialog-open="bring-in-statement"'),
    overlays: dialog({ id: "bring-in-statement", title: "Bring in statement", kind: "sheet", body: html`<form data-flow="statement" novalidate>${problems()}${fileField("Statement file", "file", "file", ".csv,text/csv")}<button type="submit" class="btn btn-plum btn-full">Read file</button></form><div class="statement-preview" data-preview hidden></div><button type="button" class="btn btn-plum btn-full" data-bring-in hidden>Bring in</button>` }),
  });
};

// ---- Diary.
export const diaryScreen = async (desk: Desk, query: URLSearchParams): Promise<string> => {
  const week = query.get("week") && mondayOfIsoWeek(query.get("week") as string) ? (query.get("week") as string) : currentWeek();
  const { days, found } = await diaryRead(desk.id, week);
  const monday = days[0].date;
  const label = (run: DiaryRun): Markup => html`<strong>Run ${run.number}</strong> <span>${run.hire_id}</span> <span>${run.depart_time}</span> <span>${run.seats} seats</span> ${run.driver_name ? html`<span>${run.driver_name}</span>` : ""}`;
  const driverAction = (run: DiaryRun): Markup => html`<div class="run-actions"><button type="button" class="btn btn-outline" data-dialog-open="assign-driver" data-form-api="PUT /api/runs/${run.id}/driver" data-fill="${JSON.stringify({ name: run.driver_name ?? "", telephone: run.driver_telephone ?? "" })}">Assign driver</button>${run.driver_name && run.told_at === null ? html`<button type="button" class="btn btn-outline" data-act="POST /api/runs/${run.id}/tell" data-ok="${"Driver told."}">Tell driver again</button>` : ""}<span class="told-line">${run.told_at !== null ? `Driver told at ${ukTime(run.told_at)}` : ""}</span></div>`;
  const inDay = (date: string): DiaryRun[] => found.filter((r) => r.depart_date === date);
  return deskPage({
    title: "Diary", heading: "Diary", desk, current: "/diary",
    main: html`<div class="diary-week"><div class="week-grid" role="grid" aria-label="Week" data-week data-week-value="${week}" data-monday="${monday}">
        <div role="row" class="week-head">${days.map((d) => html`<div role="columnheader" class="week-day"><span>${longDate(d.date)}</span>${d.label ? html`<small>${d.label}</small>` : ""}${d.hours !== 24 ? html`<small>${d.hours} hours</small>` : ""}</div>`)}</div>
        <div role="row" class="week-row">${days.map((d) => html`<div role="gridcell" class="week-cell" data-key="day-${d.date}" data-date="${d.date}" tabindex="-1" data-client-attrs="tabindex" aria-label="${longDate(d.date)}">${inDay(d.date).map((r) => html`<div class="diary-card" data-key="card-${r.id}" data-run="${r.id}" data-number="${r.number}" data-time="${r.depart_time}" tabindex="-1" data-client-attrs="tabindex">${label(r)}</div>`)}</div>`)}</div></div>
        ${found.length ? "" : emptyState("Nothing in this week.")}
        ${found.length ? html`<section class="panel"><h2>Runs this week</h2><ul class="run-list">${found.map((r) => html`<li data-key="runrow-${r.id}"><span>Run ${r.number}, ${longDate(r.depart_date)}, ${r.depart_time}${r.driver_name ? `, ${r.driver_name}` : ""}</span>${driverAction(r)}</li>`)}</ul></section>` : ""}</div>
      <div class="diary-agenda">${days.filter((d) => inDay(d.date).length).map((d) => html`<section class="agenda-day" data-key="agenda-${d.date}"><h2 class="agenda-heading">${longDate(d.date)}${d.label ? ` (${d.label})` : ""}</h2><ul>${inDay(d.date).map((r) => html`<li class="agenda-row diary-card-mobile" data-key="agenda-${r.id}" data-run="${r.id}" data-number="${r.number}" data-date="${d.date}" data-time="${r.depart_time}"><p>${label(r)}</p>${driverAction(r)}</li>`)}</ul></section>`)}${found.length ? "" : emptyState("Nothing in this week.")}</div>`,
    action: html`<button type="button" class="btn btn-outline" data-week-step="-1">Earlier week</button><button type="button" class="btn btn-plum" data-week-step="1">Later week</button>`,
    overlays: dialog({ id: "assign-driver", title: "Assign driver", body: html`<form data-api="" data-close-on-ok data-ok-driver novalidate>${problems()}${textField({ label: "Driver name", name: "name", field: "name", icon: "person", autocomplete: "name" })}${textField({ label: "Driver telephone", name: "telephone", type: "tel", field: "telephone", icon: "phone", autocomplete: "tel" })}<button type="submit" class="btn btn-plum btn-full">Tell driver</button></form>` }),
  });
};

// ---- Drivers' hours.
const KIND_NAMES: Record<string, string> = { drive: "Drive", break: "Break", wait: "Wait", rest: "Rest" };
const rulerMarks = (start: number, total: number): Markup[] => {
  const marks: Markup[] = [];
  const first = start + ((3600 - (start % 3600)) % 3600);
  for (let at = first; at <= start + total * 60 + 3600; at += 3600) marks.push(html`<span class="ruler-mark" data-part="ruler-mark" style="left:${(at - start) / 60}px">${ukTime(at)}</span>`);
  return marks;
};
export const hoursScreen = async (desk: Desk, hire: HireRow, query: URLSearchParams): Promise<string> => {
  const runs = await rows<RunRow>(pool, "SELECT * FROM runs WHERE hire_id=$1 ORDER BY number", [hire.id]);
  const run = runs.find((r) => r.id === query.get("run")) ?? runs[0];
  if (!run) {
    return deskPage({ title: `Drivers' hours ${hire.id}`, heading: `Drivers' hours ${hire.id}`, desk, current: "/diary", main: html`<section class="panel"><p>This hire has no runs yet. Runs start when it is awarded.</p></section>` });
  }
  const hours = await hoursRead(run);
  const blocks: { kind: string; minutes: number }[] = run.blocks;
  const vehicle = await only<VehicleRow>(pool, "SELECT * FROM vehicles WHERE id=$1", [run.vehicle_id]);
  const start = run.duty_start ?? vehicle.depart_instant;
  const total = blocks.reduce((a, b) => a + b.minutes, 0);
  const charges = await chargesOf(pool, run);
  const waiting = charges.filter((c) => !c.accepted);
  let at = 0;
  let breakNumber = 0;
  const placed = blocks.map((b) => { const place = { ...b, at }; at += b.minutes; return place; });
  const rates = await hireRates(pool, hire);
  const breach = hours.breaches[0];
  const startLocal = instantToLocal(start);
  return deskPage({
    title: `Drivers' hours ${hire.id}`, heading: `Drivers' hours ${hire.id}`, desk, current: "/diary",
    main: html`${runs.length > 1 ? selectField({ label: "Run", name: "run", options: runs.map((r) => ({ value: r.id, label: `Run ${r.number}`, selected: r.id === run.id })), icon: "route", extra: "data-run-chooser" }) : html`<p class="run-title">Run ${run.number}</p>`}
      <section class="panel"><h2>Duty</h2><div class="frame ribbon-frame" role="region" aria-label="Duty ribbon" tabindex="0"><div class="ribbon" style="width:${total + 90}px" data-ribbon data-run="${run.id}" data-blocks="${JSON.stringify(blocks)}" data-start-date="${startLocal.date}" data-start-time="${startLocal.time}">
        <div class="ruler">${rulerMarks(start, total)}</div>
        <div class="track">${placed.map((b, i) => {
          if (b.kind === "break") {
            breakNumber += 1;
            return html`<div class="block block-break" data-part="block" data-key="block-${i}" data-index="${i}" style="left:${b.at}px;width:${b.minutes}px" role="slider" tabindex="0" aria-label="Break ${breakNumber}" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${b.at}" aria-valuetext="Break of ${b.minutes} minutes from minute ${b.at}"><span>Break</span></div>`;
          }
          return html`<div class="block block-${b.kind}" data-part="block" data-key="block-${i}" style="left:${b.at}px;width:${b.minutes}px"><span>${KIND_NAMES[b.kind]}</span></div>`;
        })}${breach ? html`<div class="breach" data-part="breach" data-key="breach" style="left:${breach.atMinute}px;width:${Math.max(total - breach.atMinute, 1)}px" role="img" aria-label="Over the limit from ${breach.atLocal.time}"><span class="breach-label" aria-hidden="true">Over the limit</span></div>` : ""}</div></div></div>
        <div class="duty-lines">${breach ? html`<p class="line-mark">Over the limit from ${breach.atLocal.time}</p>` : ""}
        <p>Driving ${hours.drivingMinutes} minutes. Duty ${hours.spreadMinutes} minutes.</p></div></section>
      <div class="hours-columns"><section class="panel"><h2>Duty blocks</h2>${blocks.length ? html`<table class="table table-narrow" aria-label="Duty blocks"><thead><tr><th scope="col">Block</th><th scope="col">Minutes</th><th scope="col">From</th><th scope="col">To</th></tr></thead><tbody>${placed.map((b) => html`<tr><td>${KIND_NAMES[b.kind]}</td><td>${b.minutes}</td><td>${ukTime(start + b.at * 60)}</td><td>${ukTime(start + (b.at + b.minutes) * 60)}</td></tr>`)}</tbody></table>` : html`<table class="table table-narrow" aria-label="Duty blocks"><tbody><tr><td>No blocks planned yet.</td></tr></tbody></table>`}</section>
      <section class="panel"><h2>Driver</h2><p>${run.driver_name ? `${run.driver_name}, ${run.driver_telephone}` : "No driver yet."}</p><p class="told-line">${run.told_at !== null ? `Driver told at ${ukTime(run.told_at)}` : ""}</p>
        <p class="panel-actions">${run.second_driver ? html`<span class="line-mark">Second driver added</span>` : html`<button type="button" class="btn btn-outline" data-dialog-open="add-second-driver">Add second driver</button>`}${waiting.length ? html`<button type="button" class="btn btn-outline" data-act="POST /api/runs/${run.id}/accept-charges" data-ok-charges>Accept charges</button>` : ""}</p>
        ${charges.length ? html`<ul class="plain-list">${charges.map((c) => html`<li>${c.kind === "waiting" ? "Waiting" : "Comfort stop"} ${c.minutes} minutes, ${money(c.amount)}${c.accepted ? " (accepted)" : ""}</li>`)}</ul>` : ""}</section></div>`,
    action: run.confirmed ? undefined : html`<button type="button" class="btn btn-plum" data-act="POST /api/runs/${run.id}/confirm" data-ok="Run confirmed.">Confirm run</button>`,
    overlays: run.second_driver ? undefined : dialog({ id: "add-second-driver", title: "Add second driver", body: html`<form ${formAttrs(`POST /api/runs/${run.id}/second-driver`, "Second driver added.", "data-close-on-ok")}>${problems()}<p>This adds ${money(rates.second_driver)} to the vehicle's total, once.</p><button type="submit" class="btn btn-plum btn-full">Add charge</button></form>` }),
  });
};

// ---- Seat plan.
const seatIcon = (): Markup => icon("seat", 24);
export const seatsScreen = async (desk: Desk, hire: HireRow): Promise<string> => {
  const passengers = await passengersOf(pool, hire.id);
  const seats = await seatsJson(pool, hire.id);
  const adults = adultsLine(hire, passengers);
  const hasVehicles = seats.vehicles.length > 0;
  const nameOf = (id: string | null): string | undefined => passengers.find((p) => p.id === id)?.name;
  const seatMap = new Map(passengers.filter((p) => p.seat).map((p) => [`${p.vehicle_id}:${p.seat}`, p]));
  const shortLine = adults.adultsShort === 1 ? "1 more adult is needed" : adults.adultsShort > 1 ? `${adults.adultsShort} more adults are needed` : "";
  return deskPage({
    title: `Seat plan ${hire.id}`, heading: `Seat plan ${hire.id}`, desk, current: "/diary",
    main: html`<div class="seat-layout"><section class="panel"><h2>Passenger list</h2>${shortLine ? html`<p class="line-mark">${shortLine}</p>` : ""}
        ${passengers.length ? frame("Passengers", html`<table class="table"><thead><tr><th scope="col">Name</th><th scope="col">Group</th><th scope="col">Needs</th><th scope="col">Seat</th><th scope="col"><span class="sr-only">Marks</span></th></tr></thead><tbody>${passengers.map((p) => html`<tr data-key="${p.id}"><td>${p.name}</td><td>${p.grp}</td><td>${p.needs}</td><td>${p.seat ?? ""}</td><td>${p.listed_twice ? "Listed twice" : ""}</td></tr>`)}</tbody></table>`) : emptyState("No passengers yet.")}
        <p class="panel-actions"><a class="btn btn-outline" href="/api/hires/${hire.id}/passengers/download" download>Download passengers</a><button type="button" class="btn btn-outline" data-print>Print plan</button></p></section>
      <div class="seat-column">${seats.vehicles.map((v) => { const perRow = v.seats === 8 ? 3 : 4; const labels = seatLabels(v.seats); const rowsOf: string[][] = []; for (let i = 0; i < labels.length; i += perRow) rowsOf.push(labels.slice(i, i + perRow)); return html`<section class="panel seat-panel" data-key="${v.id}"><h2>${v.seats}-seat vehicle</h2><div class="seat-grid seats-${perRow}" role="grid" aria-label="Seats ${v.seats}-seat vehicle" data-seat-grid data-hire="${hire.id}" data-vehicle="${v.id}">${rowsOf.map((row, r) => html`<div role="row" class="seat-row" data-key="row-${r}">${row.map((seat) => { const person = seatMap.get(`${v.id}:${seat}`); return html`<div role="gridcell" class="seat${person ? " seat-taken" : ""}" data-key="${seat}" data-seat="${seat}" data-passenger="${person?.id ?? ""}" data-name="${person?.name ?? ""}" aria-label="Seat ${seat}: ${person?.name ?? "empty"}" tabindex="-1" data-client-attrs="tabindex">${seatIcon()}<span class="seat-label">${seat}</span> <span class="seat-name">${person?.name ?? ""}</span></div>`; })}</div>`)}</div>
        ${v.split.length ? html`<h3>Per-head split</h3>${frame(`Split ${v.seats}-seat vehicle`, html`<table class="table"><thead><tr><th scope="col">Name</th><th scope="col">Amount</th></tr></thead><tbody>${v.split.map((s) => html`<tr data-key="${s.passengerId}"><td>${nameOf(s.passengerId)}</td><td class="figure">${printedMoney(s.amount)}</td></tr>`)}</tbody></table>`)}` : ""}</section>`; })}
      ${hasVehicles ? "" : html`<section class="panel"><p>Seats appear once this hire has its vehicles.</p></section>`}</div></div>`,
    action: actionBtn("Add passengers", 'data-dialog-open="add-passengers"'),
    overlays: dialog({ id: "add-passengers", title: "Add passengers", body: html`<form ${formAttrs(`POST /api/hires/${hire.id}/passengers`, "Name added.", "data-clear-on-ok")}>${problems()}${textField({ label: "Name", name: "name", field: "name", icon: "person" })}${textField({ label: "Group", name: "group", field: "group", icon: "people" })}${textField({ label: "Needs", name: "needs", field: "needs", icon: "wheelchair" })}<button type="submit" class="btn btn-outline btn-full">Add name</button></form>
      <form data-api="POST /api/hires/${hire.id}/passengers/import" data-format="csv" data-flow="bring-in-list" data-close-on-ok novalidate>${problems()}${fileField("Passenger file", "file", "file", ".csv,text/csv")}<button type="submit" class="btn btn-plum btn-full">Bring in list</button></form>` }),
  });
};

// ---- Changes.
export const changesScreen = async (desk: Desk, hire: HireRow): Promise<string> => {
  const vehicles = await vehiclesOf(pool, hire.id);
  const stops = await stopsOf(pool, hire.id);
  const changes = await rows<ChangeRow>(pool, "SELECT * FROM changes WHERE hire_id=$1 ORDER BY at DESC, id", [hire.id]);
  const hireMoneyNow = await hireMoney(pool, hire.id, vehicles);
  const cancellation = hire.cancellation;
  const open = hire.accepted_at !== null && !cancellation;
  const canCancel = !cancellation && vehicles.length > 0;
  const side = (title: string, attr: string): Markup => html`<div class="change-side" role="group" aria-label="${title}" data-change-side="${attr}"><h3>${title}</h3><p>${longDate(hire.depart_date)}, ${hire.depart_time}</p><ul class="plain-list">${stops.map((s) => html`<li>${s.text}</li>`)}</ul><ul class="plain-list">${vehicles.map((v) => html`<li>${v.seats} seats, ${money(v.total)}</li>`)}</ul><p><strong>${money(vehicles.reduce((a, v) => a + v.total, 0))}</strong></p></div>`;
  const today = ukDate(nowSeconds());
  return deskPage({
    title: `Changes ${hire.id}`, heading: `Changes ${hire.id}`, desk, current: "/payments",
    main: html`<section class="panel"><h2>Money per vehicle</h2><p>${PAYMENT_NAMES[hireMoneyNow.paymentState]}${hireMoneyNow.credit ? html`, Credit ${money(hireMoneyNow.credit)}` : ""}</p>
        ${frame("Per vehicle", html`<table class="table"><thead><tr><th scope="col">Vehicle</th><th scope="col">Total</th><th scope="col">Paid</th><th scope="col">Refunds due</th><th scope="col">Owed</th></tr></thead><tbody>${vehicles.map((v, i) => html`<tr data-key="${v.id}"><td>${i + 1}, ${v.seats} seats</td><td class="figure">${money(v.total)}</td><td class="figure">${money(v.paid)}</td><td class="figure">${money(v.refundsDue)}</td><td class="figure">${money(v.owed)}</td></tr>`)}</tbody></table>`)}
        <p><a class="btn btn-outline" href="/api/hires/${hire.id}/payments/download" download>Download this hire's payments</a></p></section>
      ${cancellation ? html`<section class="panel"><h2>Cancellation</h2><p class="line-mark">This booking was cancelled.</p><p>Notice from ${cancellation.by === "customer" ? "the customer" : "us"}.</p>${frame("Cancellation lines", html`<table class="table"><thead><tr><th scope="col">Vehicle</th><th scope="col">Days</th><th scope="col">Charge</th><th scope="col">Paid</th><th scope="col">Refunds due</th><th scope="col">Owed</th></tr></thead><tbody>${cancellation.lines.map((l, i) => html`<tr><td>${i + 1}</td><td>${l.days}</td><td class="figure">${printedMoney(l.charge)}</td><td class="figure">${printedMoney(l.paid)}</td><td class="figure">${printedMoney(l.refundsDue)}</td><td class="figure">${printedMoney(l.owed)}</td></tr>`)}</tbody></table>`)}</section>` : ""}
      <section class="panel"><h2>Changes so far</h2>${changes.length ? html`<ul class="plain-list">${changes.map((c) => html`<li data-key="${c.id}">${longDate(ukDate(c.at))}, ${ukTime(c.at)}: from ${printedMoney(c.body.old.total)} to ${printedMoney(c.body.new.total)}</li>`)}</ul>` : html`<p>Nothing has changed on this booking.</p>`}</section>`,
    action: html`${open ? actionBtn("Change booking", 'data-dialog-open="change-booking"') : ""}${canCancel ? actionBtn("Cancel booking", 'data-dialog-open="cancel-booking"', "btn-outline") : ""}`,
    overlays: html`${open ? dialog({ id: "change-booking", title: "Change booking", body: html`<form data-flow="change" data-hire="${hire.id}" data-api="POST /api/hires/${hire.id}/changes" data-ok="Booking changed." data-close-on-ok novalidate>${problems()}
        ${textField({ label: "Departure date", name: "departAt.date", dataType: "date", field: "departAt", icon: "calendar", value: dateToTyped(hire.depart_date) })}
        <div class="field-pair">${selectField({ label: "Departure hour", name: "departAt.hour", options: hourOptions().map((o) => ({ ...o, selected: o.value === hire.depart_time.slice(0, 2) })), icon: "clock" })}${selectField({ label: "Departure minutes", name: "departAt.minutes", options: minuteOptions(false).map((o) => ({ ...o, selected: o.value === hire.depart_time.slice(3) })), icon: "clock" })}</div>
        ${stops.map((s, i) => addressField(`Stop ${i + 1}`, { value: s.text, checked: s.checked, extra: "data-change-stop" }))}
        ${vehicles.map((v, i) => html`<div class="change-vehicle" data-change-vehicle="${v.id}">${textField({ label: `Bought price for vehicle ${i + 1}`, name: `bought-${i}`, field: "boughtPrice", icon: "pound", value: moneyText(v.bought), extra: "data-change-bought" })}${textField({ label: `Margin for vehicle ${i + 1}`, name: `margin-${i}`, type: "number", field: "marginPercent", value: marginText(v.margin_halves), min: 0, max: 60, step: "0.5", extra: "data-change-margin" })}</div>`)}
        <div class="change-sides">${side("Old", "old")}${side("New", "new")}</div><button type="submit" class="btn btn-plum btn-full">Save change</button></form>` }) : ""}
      ${canCancel ? dialog({ id: "cancel-booking", title: "Cancel booking", body: html`<form ${formAttrs(`POST /api/hires/${hire.id}/cancel`, "Booking cancelled.", "data-close-on-ok")}>${problems()}
        ${textField({ label: "Notice date", name: "noticeAt.date", dataType: "date", field: "noticeAt", icon: "calendar", value: dateToTyped(today) })}
        <div class="field-pair">${selectField({ label: "Notice hour", name: "noticeAt.hour", options: hourOptions(), icon: "clock" })}${selectField({ label: "Notice minutes", name: "noticeAt.minutes", options: minuteOptions(false), icon: "clock" })}</div>
        ${radioGroup("Notice", "by", [{ value: "customer", label: "From the customer", checked: true }, { value: "arranger", label: "From us" }], { field: "by", cls: "segments-plain" })}
        <button type="submit" class="btn btn-plum btn-full">Cancel booking</button></form>` }) : ""}`,
  });
};

// ---- Documents.
export const documentsScreen = async (desk: Desk): Promise<string> => {
  const documents = await documentsOf(desk.id);
  const numbers = await nextNumbers(desk.id);
  const hires = await rows<{ id: string }>(pool, "SELECT DISTINCT h.id,h.created_at FROM hires h JOIN vehicles v ON v.hire_id=h.id JOIN customers c ON c.id=h.customer_id WHERE h.desk_id=$1 AND c.state<>'erased' ORDER BY h.created_at DESC, h.id", [desk.id]);
  const order = ["waiting", "rendering", "stored"];
  const strip = (d: DocumentRow): Markup => html`<ol class="steps-strip" aria-label="Steps" data-doc="${d.id}">${["Waiting", "Rendering", "Stored"].map((step, i) => { const reached = order.indexOf(d.state) >= i; return html`<li class="strip-step${reached ? " is-done" : ""}" data-key="${d.id}-${i}" data-step-done="${reached ? "1" : "0"}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path class="strip-check" pathLength="1" d="M4 12.500l5 5L20 6.500" fill="none" stroke="currentColor" stroke-width="2"/></svg><span>${step}</span></li>`; })}</ol>`;
  return deskPage({
    title: "Documents", heading: "Documents", desk, current: "/documents",
    main: html`<p class="next-numbers">Next invoice ${numbers.nextInvoice}. Next credit note ${numbers.nextCreditNote}.</p>
      ${documents.length ? frame("Documents list", html`<table class="table table-wide"><thead><tr><th scope="col">Kind</th><th scope="col">Hire</th><th scope="col">Customer</th><th scope="col">Number</th><th scope="col">Steps</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${documents.map((d) => html`<tr data-key="${d.id}"><td>${kindName(d.kind)}</td><td>${d.hire_id}</td><td class="name-cell">${d.customer_name}</td><td>${d.number ?? ""}</td><td>${strip(d)}</td><td><div class="cell-actions">${d.state === "stored" && !d.erased ? html`<a class="btn btn-outline" href="/api/documents/${d.id}/file" download>Download</a>` : ""}<button type="button" class="btn btn-outline" data-dialog-open="document-history" data-history="${JSON.stringify(d.history.map((h) => `${longDate(ukDate(Date.parse(h.at as string) / 1000))}, ${ukTime(Date.parse(h.at as string) / 1000)}: ${h.who}, ${h.what}`))}">History</button></div></td></tr>`)}</tbody></table>`) : emptyState("No documents yet.")}`,
    action: actionBtn("Make document", 'data-dialog-open="make-document"'),
    overlays: html`${dialog({ id: "make-document", title: "Make document", body: html`<form data-flow="make-document" data-fast-refresh novalidate data-close-on-ok>${problems()}${selectField({ label: "Hire", name: "hire", field: "hire", icon: "route", options: hires.map((h) => ({ value: h.id, label: h.id })), placeholder: "Choose a hire" })}${selectField({ label: "Kind", name: "kind", field: "kind", icon: "file", options: ["quote", "confirmationLetter", "invoice", "creditNote", "seatPlan"].map((value) => ({ value, label: kindName(value) })) })}<button type="submit" class="btn btn-plum btn-full">Make</button></form>` })}
      ${dialog({ id: "document-history", title: "History", kind: "sheet", body: html`<ul class="plain-list" data-history-list data-client-owned></ul>` })}`,
  });
};

// ---- Customers and aftercare.
export const customersScreen = async (desk: Desk, query: URLSearchParams): Promise<string> => {
  const closed = query.get("state") === "closed";
  const list = await customersList(desk.id, closed ? "closed" : "active", null);
  const review = (await only<Pick<DeskRow, "review_list">>(pool, "SELECT review_list FROM desks WHERE id=$1", [desk.id])).review_list;
  const languages = { en: "English", pl: "Polski", ur: "اردو" } as Record<string, string>;
  return deskPage({
    title: "Customers", heading: "Customers", desk, current: "/customers",
    main: html`<form class="filters" data-filters novalidate>${radioGroup("Filter customers", "state", [{ value: "", label: "Active", checked: !closed }, { value: "closed", label: "Closed", checked: closed }], { cls: "segments-plain", extra: "data-morph-radio" })}</form>
      ${list.length ? frame("Customers list", html`<table class="table table-wide"><thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Telephone</th><th scope="col">Language</th><th scope="col">State</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${list.map((c) => { const state = customerState(c); return html`<tr data-key="${c.id}"><td class="name-cell">${c.name}</td><td>${c.email}</td><td>${c.telephone}</td><td>${languages[c.language]}</td><td>${state === "active" ? "Active" : state === "closed" ? "Closed" : "Erasing"}</td><td><div class="cell-actions"><button type="button" class="btn btn-outline" data-dialog-open="rename-customer" data-form-api="PATCH /api/customers/${c.id}" data-fill="${JSON.stringify({ name: c.name })}">Rename</button><button type="button" class="btn btn-outline" data-dialog-open="remove-customer" data-form-api="DELETE /api/customers/${c.id}">Remove customer</button>${state === "active" ? html`<button type="button" class="btn btn-outline" data-act="POST /api/customers/${c.id}/close" data-ok="Customer closed.">Close customer</button>` : state === "closed" ? html`<button type="button" class="btn btn-outline" data-act="POST /api/customers/${c.id}/bring-back" data-ok="Customer brought back.">Bring back</button>` : ""}</div></td></tr>`; })}</tbody></table>`) : emptyState("No customers yet.")}
      <section class="panel"><h2>Review list</h2>${review.length ? html`<ul class="plain-list">${review.map((r) => html`<li>Row ${r.row}: ${r.message}</li>`)}</ul>` : html`<p>Nothing to review.</p>`}<button type="button" class="btn btn-outline" data-dialog-open="old-sheet">Bring in old sheet</button></section>`,
    action: actionBtn("Add customer", 'data-dialog-open="add-customer"'),
    overlays: html`${dialog({ id: "add-customer", title: "Add customer", body: html`<form ${formAttrs("POST /api/customers", "Customer saved.", "data-close-on-ok")}>${problems()}${textField({ label: "Name", name: "name", field: "name", icon: "person", autocomplete: "name" })}${textField({ label: "Email", name: "email", type: "email", field: "email", icon: "mail", autocomplete: "email" })}${textField({ label: "Telephone", name: "telephone", type: "tel", field: "telephone", icon: "phone", autocomplete: "tel" })}${selectField({ label: "Language", name: "language", field: "language", options: Object.entries(languages).map(([value, label]) => ({ value, label })) })}<button type="submit" class="btn btn-plum btn-full">Save customer</button></form>` })}
      ${dialog({ id: "rename-customer", title: "Rename customer", body: html`<form data-api="" data-ok="Customer renamed." data-close-on-ok novalidate>${problems()}${textField({ label: "Name", name: "name", field: "name", icon: "person", autocomplete: "name" })}<button type="submit" class="btn btn-plum btn-full">Save name</button></form>` })}
      ${dialog({ id: "remove-customer", title: "Remove customer", body: html`<form data-api="" data-format="none" data-ok="Customer removed." data-close-on-ok novalidate>${problems()}<p>This removes the customer for good.</p><button type="submit" class="btn btn-plum btn-full">Confirm removal</button></form>` })}
      ${dialog({ id: "old-sheet", title: "Bring in old sheet", body: html`<form data-api="POST /api/customers/import" data-format="csv" data-ok="Sheet brought in." data-close-on-ok novalidate>${problems()}${fileField("Customer sheet", "file", "file", ".csv,text/csv")}<button type="submit" class="btn btn-plum btn-full">Read sheet</button></form>` })}`,
  });
};

export const complaintsScreen = async (desk: Desk): Promise<string> => {
  const complaints = await complaintsOf(desk.id);
  const customers = await customersList(desk.id, "active", null);
  const named = await rows<Pick<CustomerRow, "id" | "name">>(pool, "SELECT id,name FROM customers WHERE desk_id=$1", [desk.id]);
  const shared = (name: string): boolean => customers.filter((c) => c.name === name).length > 1;
  return deskPage({
    title: "Complaints", heading: "Complaints", desk, current: "/aftercare/complaints",
    main: complaints.length ? frame("Complaints list", html`<table class="table"><thead><tr><th scope="col">Customer</th><th scope="col">Summary</th><th scope="col">Received</th><th scope="col">Reply due</th></tr></thead><tbody>${complaints.map((c) => html`<tr data-key="${c.id}"><td>${named.find((n) => n.id === c.customer_id)?.name ?? "Erased customer"}</td><td>${c.summary}${c.holiday_line ? html`<br><span class="mark-flag">${c.holiday_line}</span>` : ""}</td><td>${longDate(c.received_date)}, ${c.received_time}</td><td>${longDate(c.reply_due)}</td></tr>`)}</tbody></table>`) : emptyState("No complaints logged."),
    action: actionBtn("Log complaint", 'data-dialog-open="log-complaint"'),
    overlays: dialog({ id: "log-complaint", title: "Log complaint", body: html`<form ${formAttrs("POST /api/complaints", "Complaint logged.", "data-close-on-ok")}>${problems()}
      ${selectField({ label: "Customer", name: "customerId", field: "customerId", icon: "person", placeholder: "Choose a customer", options: customers.map((c) => ({ value: c.id, label: shared(c.name) ? `${c.name} ${c.email}` : c.name })) })}
      ${textField({ label: "Summary", name: "summary", field: "summary", icon: "note" })}
      ${textField({ label: "Received date", name: "receivedAt.date", dataType: "date", field: "receivedDate", icon: "calendar" })}
      <div class="field-pair">${selectField({ label: "Received hour", name: "receivedAt.hour", field: "receivedHour", options: hourOptions(), placeholder: "Hour", icon: "clock" })}${selectField({ label: "Received minutes", name: "receivedAt.minutes", options: minuteOptions(false), placeholder: "Minutes" })}</div>
      <button type="submit" class="btn btn-plum btn-full">Save complaint</button></form>` }),
  });
};

export const lostScreen = async (desk: Desk): Promise<string> => {
  const items = await itemsOf(desk.id);
  const today = ukDate(nowSeconds());
  return deskPage({
    title: "Lost property", heading: "Lost property", desk, current: "/aftercare/lost-property",
    main: items.length ? frame("Found items", html`<table class="table"><thead><tr><th scope="col">Item</th><th scope="col">Found on</th><th scope="col">Held to</th><th scope="col">State</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${items.map((i) => html`<tr data-key="${i.id}"><td>${i.description}</td><td>${longDate(i.found_on)}</td><td>${longDate(i.held_to)}</td><td>${i.returned_at !== null ? "Returned" : today > i.held_to ? "Past holding date" : "Held"}</td><td>${i.returned_at === null ? html`<button type="button" class="btn btn-outline" data-dialog-open="return-item" data-form-api="POST /api/lost-property/${i.id}/return">Return item</button>` : ""}</td></tr>`)}</tbody></table>`) : emptyState("No found items logged."),
    action: actionBtn("Log found item", 'data-dialog-open="log-item"'),
    overlays: html`${dialog({ id: "log-item", title: "Log found item", body: html`<form ${formAttrs("POST /api/lost-property", "Item logged.", "data-close-on-ok")}>${problems()}${textField({ label: "Item", name: "description", field: "description", icon: "bag" })}${textField({ label: "Found on", name: "foundOn", dataType: "date", field: "foundOn", icon: "calendar" })}<button type="submit" class="btn btn-plum btn-full">Save item</button></form>` })}
      ${dialog({ id: "return-item", title: "Return item", body: html`<form data-api="" data-ok="Item returned." data-close-on-ok novalidate>${problems()}<p>A return costs £5.00.</p>${textField({ label: "Owner's details", name: "ownerDetails", field: "ownerDetails", icon: "person" })}<button type="submit" class="btn btn-plum btn-full">Record return</button></form>` })}`,
  });
};
