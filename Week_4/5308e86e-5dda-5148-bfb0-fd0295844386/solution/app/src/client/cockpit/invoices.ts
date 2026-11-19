/** Invoicing: send a draft, mark a sent invoice paid into a chosen account. */
import { formatDollars } from "../../shared/money.js";
import { announce } from "../shared/announce.js";
import { api, ServerFault, SignedOut, Unreachable } from "../shared/api.js";
import { COPY } from "../shared/copy.js";
import { h, isPending, pending, query } from "../shared/dom.js";
import { actionFailed, actionSucceeded, refreshFailed } from "../shared/outage.js";
import { currentMe, loadAccounts, store } from "./store.js";

interface Invoice {
  id: string;
  number: string;
  customer_name: string;
  total_cents: number;
  status: "draft" | "sent" | "paid";
}

const STATUS_WORDS = { draft: "Draft", sent: "Sent", paid: "Paid" };

export function mountInvoices(root: HTMLElement): void {
  const body = h("tbody", {});
  const table = h(
    "table",
    { class: "data-table" },
    h("caption", { class: "sr-only" }, "Invoices"),
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Number"), h("th", { scope: "col" }, "Customer"), h("th", { scope: "col" }, "Total"), h("th", { scope: "col" }, "Status"), h("th", { scope: "col" }, "Action"))),
    body,
  );
  root.append(h("div", { class: "table-frame", role: "region", "aria-label": "Invoices table", tabindex: "0" }, table));
  const canAct = currentMe().user.role !== "member";

  function invoiceRow(invoice: Invoice): HTMLElement {
    const action = h("td", { class: "action-cell" });
    if (invoice.status === "paid") action.append(h("span", {}, "Paid"));
    if (canAct && invoice.status === "sent") {
      const deposit = h("select", { class: "select", "aria-label": "Deposit to" }, ...store.accounts.map((account) => h("option", { value: account.id }, account.name)));
      action.append(deposit, h("button", { class: "btn btn-primary", type: "button", "data-mark-paid": invoice.id }, "Mark paid"));
    }
    if (canAct && invoice.status === "draft") action.append(h("button", { class: "btn btn-quiet", type: "button", "data-send": invoice.id }, "Send invoice"));
    return h(
      "tr",
      { "data-invoice": invoice.id, "data-number": invoice.number },
      h("th", { scope: "row" }, invoice.number),
      h("td", {}, invoice.customer_name),
      h("td", { class: "mono" }, formatDollars(invoice.total_cents)),
      h("td", {}, STATUS_WORDS[invoice.status]),
      action,
    );
  }

  async function load(): Promise<void> {
    try {
      await loadAccounts();
      const { data } = await api<{ invoices: Invoice[] }>("GET", "/api/invoices");
      body.replaceChildren(...data.invoices.map(invoiceRow));
    } catch (error) {
      if (error instanceof Unreachable) refreshFailed();
      else if (error instanceof ServerFault) announce(COPY.serverError);
      else if (!(error instanceof SignedOut)) throw error;
    }
  }
  void load();

  body.addEventListener("click", async (event) => {
    const target = event.target as Element;
    const markPaid = target.closest<HTMLButtonElement>("[data-mark-paid]");
    const send = target.closest<HTMLButtonElement>("[data-send]");
    const button = markPaid ?? send;
    if (!button || isPending(button)) return;
    const row = button.closest("tr") as HTMLElement;
    const number = row.dataset.number ?? "";
    const done = pending(button, markPaid ? "Marking paid…" : "Sending…");
    try {
      const result = markPaid
        ? await api<{ error?: string }>("POST", `/api/invoices/${markPaid.dataset.markPaid}/mark-paid`, { body: { account_id: query<HTMLSelectElement>(row, "select").value } })
        : await api<{ error?: string }>("POST", `/api/invoices/${send?.dataset.send}/send`);
      actionSucceeded();
      if (result.status === 200) {
        announce(markPaid ? `${number} marked paid` : `${number} sent`);
        await load();
      } else if (result.data.error === "invoice_already_paid") announce("This invoice is already paid");
      else if (result.data.error === "invoice_not_sent") announce("Send this invoice before marking it paid");
      else if (result.data.error === "invoice_not_draft") announce("This invoice has already been sent.");
    } catch (error) {
      if (error instanceof Unreachable) actionFailed();
      else if (error instanceof ServerFault) announce(COPY.serverError);
      else if (!(error instanceof SignedOut)) throw error;
    } finally {
      done();
    }
  });
}
