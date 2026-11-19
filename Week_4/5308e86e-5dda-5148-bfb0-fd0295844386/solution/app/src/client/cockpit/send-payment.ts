/** Send payment: a form whose draft lives in the address, a review step, and a confirm that sends once. */
import { formatDollars, parseDollars } from "../../shared/money.js";
import { APPROVALS_REFRESH_SECONDS, APPROVAL_THRESHOLD_CENTS, MEMO_MAX, PAYMENT_METHODS } from "../../shared/rules.js";
import { announce } from "../shared/announce.js";
import { api, ServerFault, SignedOut, Unreachable } from "../shared/api.js";
import { COPY } from "../shared/copy.js";
import { h, ICONS, isPending, pending, query, svg } from "../shared/dom.js";
import { calendarDate, methodLabel } from "../shared/format.js";
import { MEMO_TOO_LONG, SCHEDULED_CAP } from "../../shared/messages.js";
import { actionFailed, actionSucceeded, refreshFailed } from "../shared/outage.js";
import { after } from "../shared/timers.js";
import { celebrate } from "./celebration.js";
import { draftAddress, EMPTY_DRAFT, knownMethod, readDraft, type Draft } from "./draft.js";
import { clearErrors, field, focusFirstInvalid, showError } from "./fields.js";
import { currentMe, loadAccounts, loadMe, store } from "./store.js";

interface Recipient {
  id: string;
  display_name: string;
  status: string;
}

interface Refusal {
  input: HTMLElement;
  message: string;
}

export function mountSendPayment(root: HTMLElement): void {
  const source = h("select", { class: "select" });
  const recipient = h("select", { class: "select" });
  const method = h("select", { class: "select" }, ...PAYMENT_METHODS.map((value) => h("option", { value }, methodLabel(value))));
  const amount = h("input", { class: "input mono", type: "text", inputmode: "decimal", autocomplete: "off" });
  const memo = h("input", { class: "input", type: "text", autocomplete: "off" });
  const sendOn = h("input", { class: "input", type: "date" });
  const settlementText = h("span", { "data-settlement": "" });
  const settlementLine = h("p", { class: "settlement-line" }, svg(ICONS.clock), settlementText);
  const reviewButton = h("button", { class: "btn btn-primary", type: "submit" }, "Review payment");
  const form = h(
    "form",
    { class: "stack-form payment-form", novalidate: true, hidden: true },
    field("source", "Source account", source),
    field("recipient", "Recipient", recipient),
    h("div", { class: "field-with-line" }, field("method", "Method", method), settlementLine),
    field("amount", "Amount", amount),
    field("memo", "Memo", memo),
    field("send_on", "Send on", sendOn),
    reviewButton,
  );
  const reviewSettlementText = h("span", { "data-settlement": "" });
  const reviewSettlement = h("p", { class: "settlement-line" }, svg(ICONS.clock), reviewSettlementText);
  const summary = h("dl", { class: "review-list" });
  const backButton = h("button", { class: "btn btn-quiet", type: "button" }, "Back");
  const confirmButton = h("button", { class: "btn btn-primary", type: "button" }, "Confirm and send");
  const review = h("section", { class: "panel review", "aria-label": "Review payment", hidden: true }, h("h2", { class: "panel-title" }, "Check the details"), summary, reviewSettlement, h("div", { class: "review-actions" }, backButton, confirmButton));

  let recipients: Recipient[] = [];
  let draft: Draft = { ...EMPTY_DRAFT };
  let key = "";
  let cancelRefresh: (() => void) | null = null;

  function writeInputs(): void {
    source.value = draft.source;
    recipient.value = draft.recipient;
    method.value = draft.method;
    amount.value = draft.amount;
    memo.value = draft.memo;
    sendOn.value = draft.sendOn;
  }

  function readInputs(): void {
    draft = { source: source.value, recipient: recipient.value, method: method.value, amount: amount.value, memo: memo.value, sendOn: sendOn.value };
  }

  function settlementCopy(): string {
    if (draft.sendOn !== "") return "";
    const entered = parseDollars(draft.amount);
    if (entered.ok && entered.cents > APPROVAL_THRESHOLD_CENTS) return "Settles once approved";
    const date = currentMe().settlement_dates[draft.method];
    return date ? `Settles ${calendarDate(date)}` : "";
  }

  function paintSettlement(): void {
    const text = settlementCopy();
    settlementText.textContent = text;
    reviewSettlementText.textContent = text;
    settlementLine.hidden = text === "";
    reviewSettlement.hidden = text === "";
  }

  function scheduleSettlementRefresh(): void {
    cancelRefresh?.();
    const { business_now: now, settlement_dates_change_at: changeAt } = currentMe();
    const gap = Math.max(1_000, Date.parse(changeAt) - Date.parse(now));
    cancelRefresh = after(async () => {
      try {
        await loadMe();
        paintSettlement();
        scheduleSettlementRefresh();
      } catch (error) {
        if (error instanceof Unreachable) {
          refreshFailed();
          cancelRefresh = after(() => scheduleSettlementRefresh(), APPROVALS_REFRESH_SECONDS * 1000);
        } else if (!(error instanceof SignedOut)) throw error;
      }
    }, gap + 500);
  }

  function refusals(): Refusal[] {
    const found: Refusal[] = [];
    const account = store.accounts.find((candidate) => candidate.id === draft.source);
    if (!account) found.push({ input: source, message: "Choose an account" });
    if (!draft.recipient) found.push({ input: recipient, message: "Choose a recipient" });
    const entered = parseDollars(draft.amount);
    if (!entered.ok) found.push({ input: amount, message: entered.reason === "format" ? COPY.dollarFormat : COPY.amountZero });
    else if (account && entered.cents > account.available_cents) found.push({ input: amount, message: COPY.insufficientFunds });
    if (draft.sendOn !== "" && draft.sendOn <= currentMe().business_date) found.push({ input: sendOn, message: COPY.chooseDate });
    if ([...draft.memo].length > MEMO_MAX) found.push({ input: memo, message: MEMO_TOO_LONG });
    return found;
  }

  function showErrors(found: Refusal[]): void {
    clearErrors(form);
    for (const refusal of found) showError(refusal.input, refusal.message);
    focusFirstInvalid(form, ["source", "recipient", "method", "amount", "memo", "send_on"]);
  }

  function showForm(): void {
    review.hidden = true;
    form.hidden = false;
  }

  function showReview(): void {
    key = crypto.randomUUID();
    const account = store.accounts.find((candidate) => candidate.id === draft.source);
    const named = recipients.find((candidate) => candidate.id === draft.recipient);
    const entered = parseDollars(draft.amount);
    summary.replaceChildren();
    const rows: Array<[string, string]> = [
      ["Source", account?.name ?? ""],
      ["Recipient", named?.display_name ?? ""],
      ["Method", methodLabel(draft.method)],
      ["Amount", entered.ok ? formatDollars(entered.cents) : ""],
    ];
    if (draft.sendOn !== "") rows.push(["Send on", calendarDate(draft.sendOn)]);
    if (draft.memo !== "") rows.push(["Memo", draft.memo]);
    for (const [label, value] of rows) summary.append(h("dt", {}, label), h("dd", { class: label === "Amount" ? "mono" : "" }, value));
    paintSettlement();
    form.hidden = true;
    review.hidden = false;
    confirmButton.focus();
  }

  function sanitise(raw: Draft): Draft {
    return {
      ...raw,
      source: store.accounts.some((candidate) => candidate.id === raw.source) ? raw.source : "",
      recipient: recipients.some((candidate) => candidate.id === raw.recipient) ? raw.recipient : "",
      method: knownMethod(raw.method) ? raw.method : "ach",
    };
  }

  /** Applies the draft in the address, as when the page opens or history moves. */
  function applyAddress(initial: boolean): void {
    const parsed = readDraft(location.search);
    draft = sanitise(parsed.draft);
    writeInputs();
    clearErrors(form);
    const cleanAddress = draftAddress(draft, parsed.step);
    if (initial && cleanAddress !== location.pathname + location.search) history.replaceState(null, "", cleanAddress);
    paintSettlement();
    if (parsed.step === "review") {
      const found = refusals();
      if (found.length === 0) {
        showReview();
        return;
      }
      history.replaceState(null, "", draftAddress(draft, "form"));
      showForm();
      showErrors(found);
      return;
    }
    showForm();
  }

  function persist(): void {
    readInputs();
    history.replaceState(null, "", draftAddress(draft, "form"));
    paintSettlement();
  }

  for (const control of [source, recipient, method, amount, memo, sendOn]) {
    control.addEventListener(control instanceof HTMLSelectElement ? "change" : "input", () => {
      persist();
      if (control.getAttribute("aria-invalid") === "true") {
        control.removeAttribute("aria-invalid");
        control.removeAttribute("aria-describedby");
        query(control.closest(".field") as HTMLElement, ".field-error").textContent = "";
      }
    });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    readInputs();
    const found = refusals();
    if (found.length > 0) {
      showErrors(found);
      return;
    }
    clearErrors(form);
    history.pushState(null, "", draftAddress(draft, "review"));
    showReview();
  });

  backButton.addEventListener("click", () => history.back());
  window.addEventListener("popstate", () => {
    if (store.me) applyAddress(false);
  });

  function returnToForm(found: Refusal[]): void {
    history.replaceState(null, "", draftAddress(draft, "form"));
    showForm();
    showErrors(found);
  }

  confirmButton.addEventListener("click", async () => {
    if (isPending(confirmButton)) return;
    const entered = parseDollars(draft.amount);
    if (!entered.ok) return;
    const done = pending(confirmButton, "Sending…");
    const body: Record<string, unknown> = { source_account_id: draft.source, recipient_id: draft.recipient, method: draft.method, amount_cents: entered.cents };
    if (draft.memo !== "") body.memo = draft.memo;
    if (draft.sendOn !== "") body.scheduled_for = draft.sendOn;
    try {
      const { status, data } = await api<any>("POST", "/api/payments", { body, key });
      actionSucceeded();
      if (status === 201) {
        await finish(data);
      } else if (data.error === "insufficient_funds") {
        returnToForm([{ input: amount, message: COPY.insufficientFunds }]);
      } else if (data.error === "validation") {
        returnToForm(validationRefusals(data.fields));
      } else if (status === 404) {
        returnToForm([{ input: recipient, message: "This recipient is no longer available." }]);
      } else announce(COPY.serverError);
    } catch (error) {
      if (error instanceof Unreachable) actionFailed();
      else if (error instanceof ServerFault) announce(COPY.serverError);
      else if (!(error instanceof SignedOut)) throw error;
    } finally {
      done();
    }
  });

  function validationRefusals(fields: Record<string, string>): Refusal[] {
    const found: Refusal[] = [];
    if (fields.source_account_id) found.push({ input: source, message: "Choose an account" });
    if (fields.recipient_id) found.push({ input: recipient, message: "Choose a recipient" });
    if (fields.amount_cents) {
      const entered = parseDollars(draft.amount);
      found.push({ input: amount, message: entered.ok && entered.cents > APPROVAL_THRESHOLD_CENTS && draft.sendOn !== "" ? SCHEDULED_CAP : COPY.amountZero });
    }
    if (fields.scheduled_for) found.push({ input: sendOn, message: COPY.chooseDate });
    if (fields.memo) found.push({ input: memo, message: MEMO_TOO_LONG });
    return found;
  }

  async function finish(payment: { status: string; effective_date: string | null; scheduled_for: string | null }): Promise<void> {
    draft = { ...EMPTY_DRAFT };
    history.replaceState(null, "", "/payments/new");
    writeInputs();
    clearErrors(form);
    showForm();
    paintSettlement();
    let message: string;
    if (payment.status === "posted") {
      const effective = payment.effective_date;
      message = effective !== null && effective !== currentMe().business_date ? `Payment sent Settles on ${calendarDate(effective)}` : "Payment sent";
    } else if (payment.status === "scheduled") {
      const effective = payment.effective_date;
      message = effective !== null && effective !== payment.scheduled_for ? `Payment scheduled Scheduled for ${calendarDate(effective)}` : "Payment scheduled";
    } else message = "Payment awaiting approval";
    announce(message);
    if (payment.status === "posted") celebrate();
    query(document, "#page-title").focus();
    await loadAccounts().catch(() => undefined);
    populateSources();
    source.value = "";
  }

  function populateSources(): void {
    source.replaceChildren(h("option", { value: "" }, "Choose an account"), ...store.accounts.map((account) => h("option", { value: account.id }, `${account.name} — ${formatDollars(account.available_cents)} available`)));
  }

  async function start(): Promise<void> {
    try {
      await loadMe();
      await loadAccounts();
      const { data } = await api<{ recipients: Recipient[] }>("GET", "/api/recipients");
      recipients = data.recipients.filter((candidate) => candidate.status === "active");
    } catch (error) {
      if (error instanceof Unreachable) {
        refreshFailed();
        after(() => void start(), APPROVALS_REFRESH_SECONDS * 1000);
        return;
      }
      if (error instanceof SignedOut) return;
      throw error;
    }
    populateSources();
    recipient.replaceChildren(h("option", { value: "" }, "Choose a recipient"), ...recipients.map((candidate) => h("option", { value: candidate.id }, candidate.display_name)));
    root.append(form, review);
    form.hidden = false;
    applyAddress(true);
    scheduleSettlementRefresh();
  }

  void start();
}
