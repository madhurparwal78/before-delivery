/** Loans: the venture line, with withdrawals whose lost answers retry under their own key. */
import { formatDollars, parseDollars } from "../../shared/money.js";
import { announce } from "../shared/announce.js";
import { api, ServerFault, SignedOut, Unreachable } from "../shared/api.js";
import { COPY } from "../shared/copy.js";
import { h, isPending, pending, query } from "../shared/dom.js";
import { actionFailed, actionSucceeded, refreshFailed } from "../shared/outage.js";
import { field } from "./fields.js";
import { loadAccounts, store } from "./store.js";

interface Loan {
  id: string;
  name: string;
  principal_cents: number;
  drawn_cents: number;
  remaining_cents: number;
  funding_account_id: string;
}

/** The key of a withdrawal that got no answer, kept in memory for a retry of the same loan and amount text. */
interface Attempt {
  loanId: string;
  text: string;
  key: string;
}

function figure(label: string, value: string, name: string): HTMLElement {
  return h("div", { class: "loan-figure" }, h("dt", {}, label), h("dd", { class: "mono", "data-loan": name }, value));
}

export function mountLoans(root: HTMLElement): void {
  const list = h("div", { class: "loan-list" });
  root.append(list);
  let attempt: Attempt | null = null;

  function accountName(id: string): string {
    return store.accounts.find((account) => account.id === id)?.name ?? "";
  }

  function paint(card: HTMLElement, loan: Loan): void {
    query(card, '[data-loan="principal"]').textContent = formatDollars(loan.principal_cents);
    query(card, '[data-loan="drawn"]').textContent = formatDollars(loan.drawn_cents);
    query(card, '[data-loan="remaining"]').textContent = formatDollars(loan.remaining_cents);
  }

  function loanCard(loan: Loan): HTMLElement {
    const input = h("input", { class: "input mono", type: "text", inputmode: "decimal", autocomplete: "off" });
    const button = h("button", { class: "btn btn-primary", type: "submit" }, "Request withdrawal");
    const form = h("form", { class: "withdrawal-form", novalidate: true }, field(`withdrawal-${loan.id}`, "Withdrawal amount", input), button);
    const card = h(
      "article",
      { class: "card loan-card enter", "data-loan-id": loan.id },
      h("h2", { class: "card-label" }, loan.name),
      h("dl", { class: "loan-figures" }, figure("Principal", "", "principal"), figure("Drawn", "", "drawn"), figure("Remaining", "", "remaining"), h("div", { class: "loan-figure" }, h("dt", {}, "Funding account"), h("dd", {}, accountName(loan.funding_account_id)))),
      form,
    );
    paint(card, loan);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (isPending(button)) return;
      const text = input.value.trim();
      const entered = parseDollars(text);
      if (!entered.ok) {
        announce(entered.reason === "format" ? COPY.dollarFormat : COPY.amountZero);
        return;
      }
      const key = attempt && attempt.loanId === loan.id && attempt.text === text ? attempt.key : crypto.randomUUID();
      attempt = { loanId: loan.id, text, key };
      const done = pending(button, "Requesting…");
      try {
        const { status, data } = await api<any>("POST", `/api/loans/${loan.id}/draw`, { body: { amount_cents: entered.cents }, key });
        actionSucceeded();
        attempt = null;
        if (status === 200) {
          paint(card, data as Loan);
          announce(`${formatDollars(entered.cents)} credited to ${accountName(loan.funding_account_id)}`);
        } else if (data.error === "exceeds_available_credit") announce("That's more than the remaining credit");
        else if (data.error === "validation") announce(COPY.dollarFormat);
        else announce(COPY.serverError);
      } catch (error) {
        if (error instanceof Unreachable) actionFailed();
        else if (error instanceof ServerFault) announce(COPY.serverError);
        else if (!(error instanceof SignedOut)) throw error;
      } finally {
        done();
      }
    });
    return card;
  }

  async function load(): Promise<void> {
    try {
      await loadAccounts();
      const { data } = await api<{ loans: Loan[] }>("GET", "/api/loans");
      list.replaceChildren(...data.loans.map(loanCard));
      if (data.loans.length === 0) list.append(h("p", { class: "empty-state" }, "No loans yet."));
    } catch (error) {
      if (error instanceof Unreachable) refreshFailed();
      else if (error instanceof ServerFault) announce(COPY.serverError);
      else if (!(error instanceof SignedOut)) throw error;
    }
  }
  void load();
}
