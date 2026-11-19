import "../styles/fonts.css";
import "../styles/base.css";
import "../styles/proposal.css";

import { byId, operatorZone, request } from "../lib/api.js";
import { formatBusinessDate } from "../../shared/dates.js";
import { formatUsd } from "../../shared/money.js";

interface Deposit {
  invoice_number: string;
  amount_cents: number;
  balance_cents: number;
  paid: boolean;
  billing: "live" | "unreachable";
}

interface Proposal {
  reference: string;
  project_title: string;
  scope: string;
  fee_cents: number;
  production_month_label: string;
  month_open: boolean;
  milestones: { number: number; name: string; percent: number; amount_cents: number }[];
  status: "proposal_sent" | "accepted" | "deposit_paid" | "booked";
  expires_at: string;
  deposit: Deposit | null;
}

const RETRY_MS = 3000;
const LIVE_MS = 2000;
const AUTO_RETRIES = 5;
const token = location.pathname.split("/")[2] ?? "";
const status = byId("proposal-status");
const acceptArea = byId("accept-area");
const acceptButton = byId<HTMLButtonElement>("accept-button");
const depositArea = byId("deposit");
const payForm = byId<HTMLFormElement>("pay-form");
const payButton = byId<HTMLButtonElement>("pay-button");
const payer = byId<HTMLInputElement>("payer-name");

let proposal: Proposal | null = null;
let idempotencyKey: string | null = null;
let keyPayer: string | null = null;
let paying = false;

const say = (text: string, success = false): void => {
  status.textContent = text;
  status.classList.toggle("success", success);
};
const paidCopy = (p: Proposal): string =>
  `Deposit received. ${p.production_month_label} is confirmed. A confirmation email will follow.`;
const monthTaken = (p: Proposal): string =>
  `${p.production_month_label} has just been booked by another production. Ask Kettlehole Audio for another month.`;

function cell(text: string, className = ""): HTMLTableCellElement {
  const td = document.createElement("td");
  td.textContent = text;
  td.setAttribute("role", "cell");
  if (className) td.className = className;
  return td;
}

function render(p: Proposal): void {
  proposal = p;
  byId("proposal-reference").textContent = p.reference;
  byId("project-title").textContent = p.project_title;
  byId("project-scope").textContent = p.scope;
  byId("proposal-fee").textContent = `$${formatUsd(p.fee_cents)}`;
  byId("proposal-month").textContent = p.production_month_label;
  const open = p.status === "proposal_sent";
  byId("proposal-expiry-label").textContent = open ? "Accept by" : "Status";
  byId("proposal-expiry").textContent = open ? formatBusinessDate(p.expires_at, operatorZone()) : "Accepted";
  byId("milestone-rows").replaceChildren(...p.milestones.map((m) => {
    const row = document.createElement("tr");
    row.setAttribute("role", "row");
    const name = document.createElement("th");
    name.scope = "row";
    name.setAttribute("role", "rowheader");
    name.textContent = m.name;
    row.append(name, cell(`${m.percent}%`, "mono"), cell(`$${formatUsd(m.amount_cents)}`, "amount mono"));
    return row;
  }));
  byId("proposal-body").hidden = false;
  acceptArea.hidden = !(open && p.month_open);
  acceptButton.textContent = `Accept and hold ${p.production_month_label}`;
  showDeposit(p);
}

function showDeposit(p: Proposal): void {
  const deposit = p.deposit;
  depositArea.hidden = !deposit;
  if (!deposit) return;
  acceptArea.hidden = true;
  byId("deposit-number").textContent = `Invoice ${deposit.invoice_number}`;
  byId("deposit-amount").textContent = `Deposit $${formatUsd(deposit.amount_cents)}`;
  const settled = p.status === "deposit_paid" || p.status === "booked";
  payForm.hidden = settled;
  if (!idempotencyKey && !settled) newKey();
}

function newKey(): void {
  idempotencyKey = crypto.randomUUID();
  keyPayer = null;
}

const ALREADY_ACCEPTED = "This proposal has already been accepted. The deposit invoice is below.";

let gone = false;

function showGone(error: string | undefined): void {
  gone = true;
  byId("proposal-body").hidden = true;
  say(error === "proposal_closed"
    ? "This proposal is no longer open."
    : "This proposal has expired. Ask Kettlehole Audio for a new one.");
}

/** Reads the proposal and states it; returns the HTTP status. */
async function load(): Promise<number> {
  const answer = await request<Proposal & { error?: string }>(`/api/proposals/${token}`);
  if (answer.status === 410) {
    showGone(answer.body.error);
    return 410;
  }
  if (answer.status !== 200) {
    say(answer.status === 404 ? "This proposal link is not available." : "The proposal could not load. Refresh to try again.");
    return answer.status;
  }
  render(answer.body);
  const p = answer.body;
  if (p.status === "deposit_paid" || p.status === "booked") say(paidCopy(p), true);
  else if (p.deposit?.billing === "unreachable") say("Billing can’t be reached, so these deposit figures may be out of date.");
  else if (p.status === "proposal_sent" && !p.month_open) say(monthTaken(p));
  return 200;
}

acceptButton.addEventListener("click", async () => {
  if (!proposal || acceptButton.disabled) return;
  const p = proposal;
  acceptButton.disabled = true;
  say(`Holding ${p.production_month_label}…`);
  const answer = await request<{ deposit?: Deposit; error?: string }>(`/api/proposals/${token}/accept`, { method: "POST", json: {} });
  acceptButton.disabled = false;
  if (answer.status === 201 && answer.body.deposit) {
    render({ ...p, status: "accepted", deposit: answer.body.deposit });
    say(`${p.production_month_label} is held. Pay the deposit to confirm it.`, true);
  } else if (answer.status === 409 && answer.body.error === "illegal_transition") {
    await load();
    if (proposal?.deposit) say(ALREADY_ACCEPTED);
  } else if (answer.status === 409 && answer.body.error === "month_taken") {
    acceptArea.hidden = true;
    say(monthTaken(p));
  } else if (answer.status === 410) {
    await load();
  } else if (answer.status === 503) {
    say("Billing is unreachable, so nothing was held. Try again in a few minutes.");
  } else {
    say("The proposal could not be accepted. Reload the page to see its current state.");
  }
});

payer.addEventListener("input", () => {
  if (keyPayer !== null && payer.value !== keyPayer) newKey();
});

/**
 * One deposit request with the page's key. A lost answer or request_in_progress is sent again 3 s after the
 * previous request went out, up to 5 automatic attempts.
 */
async function pay(attempt: number): Promise<void> {
  const p = proposal;
  if (!p?.deposit || !idempotencyKey) return;
  keyPayer = payer.value;
  const sentAt = Date.now();
  const answer = await request<{ error?: string }>(`/api/proposals/${token}/deposit`, {
    method: "POST",
    json: { payer_name: payer.value, amount_cents: p.deposit.amount_cents },
    headers: { "Idempotency-Key": idempotencyKey },
  });
  if (answer.status === 0 || (answer.status === 409 && answer.body.error === "request_in_progress")) {
    if (attempt < AUTO_RETRIES) {
      say("Connection lost. Retrying with the same payment…");
      window.setTimeout(() => void pay(attempt + 1), Math.max(0, sentAt + RETRY_MS - Date.now()));
      return;
    }
    finishPaying();
    say("We couldn't confirm the payment. Press Pay deposit to check again. You won't be charged twice.");
    return;
  }
  finishPaying();
  if (answer.status === 200) {
    say(paidCopy(p), true);
    if ((await load()) !== 200) say(paidCopy(p), true);
  }
  else if (answer.status === 503) say("Billing is unreachable, so no payment was taken. Try again in a few minutes.");
  else if (answer.status === 409 && answer.body.error === "illegal_transition") await load();
  else say("The payment request was refused. Reload the page to see the current deposit.");
}

function finishPaying(): void {
  paying = false;
  payButton.disabled = false;
}

payForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (paying) return;
  paying = true;
  payButton.disabled = true;
  say("Recording payment…");
  void pay(0);
});

/**
 * Live state: while the proposal is open and this page has no accept pending, it is re-read every two seconds, so an
 * acceptance elsewhere, the month filling or opening again, or the link closing shows here without a click. Focus
 * stays put unless the focused accept button goes away, when it moves to the heading.
 */
async function reread(): Promise<void> {
  const before = proposal;
  if (gone || before?.status !== "proposal_sent" || acceptButton.disabled) return;
  const answer = await request<Proposal & { error?: string }>(`/api/proposals/${token}`);
  if (acceptButton.disabled || proposal !== before) return;
  const focused = document.activeElement === acceptButton;
  if (answer.status === 410) showGone(answer.body.error);
  else if (answer.status === 200) {
    const p = answer.body;
    render(p);
    if (p.status === "accepted") say(ALREADY_ACCEPTED);
    else if (p.status !== "proposal_sent") say(paidCopy(p), true);
    else if (!p.month_open) say(monthTaken(p));
    else if (!before.month_open) say("");
  }
  if (focused && (acceptArea.hidden || byId("proposal-body").hidden)) byId("proposal-heading").focus();
}

void load();
window.setInterval(() => void reread(), LIVE_MS);
