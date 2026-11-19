import { get, request } from "../api.js";
import { data, type Screen } from "../app.js";
import { copy } from "../copy.js";
import { clear, el, field, setFieldError } from "../dom.js";
import { amount, rotterdamTime } from "../format.js";
import type { Frame, Invoice } from "../types.js";
import { emptyState } from "./simple.js";

const filters: [string, string, string][] = [
  ["unpaid", "Unpaid", "/desk/cashier"],
  ["paid", "Paid", "/desk/cashier?show=paid"],
  ["all", "All", "/desk/cashier?show=all"],
];

const methods: [string, string][] = [
  ["bank_transfer", "Bank transfer"],
  ["card", "Card at the counter"],
  ["cash", "Cash"],
];

/** The cashier's desk: the Invoices table, one invoice's detail, Defaults. */
export const cashierScreen: Screen = (app) => {
  const show = data<string>(app, "show", "unpaid");
  let invoices = data<Invoice[]>(app, "invoices", []);
  let defaults = data<Invoice[]>(app, "defaults", []);
  let selected: Invoice | null = invoices.length > 0 ? invoices[0] : null;

  const filterGroup = el("div", {
    class: "radiogroup",
    role: "radiogroup",
    "aria-label": "Show",
  });
  for (const [value, label, href] of filters) {
    const radio = el("input", {
      type: "radio",
      name: "show",
      value,
      checked: value === show,
    });
    radio.addEventListener("change", () => window.location.assign(href));
    filterGroup.append(el("label", { class: "radio" }, [radio, el("span", { text: label })]));
  }

  const tableHolder = el("div", { class: "table-holder" });
  const detail = el("div", { class: "invoice-detail" });
  const defaultsPanel = el("section", {
    class: "panel",
    role: "region",
    "aria-label": "Defaults",
  });

  clear(app.root);
  app.root.className = "page page-cashier";
  app.root.append(
    el("h1", { class: "desk-heading", text: "CASHIER DESK" }),
    el("div", { class: "cashier-grid" }, [
      el("div", { class: "cashier-list" }, [filterGroup, tableHolder, defaultsPanel]),
      detail,
    ]),
  );

  const paintTable = () => {
    clear(tableHolder);
    if (invoices.length === 0) {
      tableHolder.append(emptyState(copy.noInvoicesLine, copy.noInvoicesSentence));
      return;
    }
    const body = el("tbody");
    for (const invoice of invoices) {
      const link = el("a", {
        class: "panel-link",
        href: `/desk/cashier?show=${show}`,
        text: `Invoice ${invoice.number}`,
      });
      link.addEventListener("click", (event) => {
        event.preventDefault();
        selected = invoice;
        paintDetail();
      });
      body.append(
        el("tr", {}, [
          el("td", {}, [link]),
          el("td", { text: invoice.bidder_name ?? "" }),
          el("td", { text: invoice.paddle === null ? "—" : String(invoice.paddle) }),
          el("td", { class: "amounts", text: amount(invoice.total) }),
          el("td", { class: "amounts", text: amount(invoice.outstanding) }),
          el("td", { text: invoice.status }),
        ]),
      );
    }
    tableHolder.append(
      el("table", { class: "desk-table", "aria-label": "Invoices" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { scope: "col", text: "Invoice" }),
            el("th", { scope: "col", text: "Buyer" }),
            el("th", { scope: "col", text: "Paddle" }),
            el("th", { scope: "col", text: "Total" }),
            el("th", { scope: "col", text: "Outstanding" }),
            el("th", { scope: "col", text: "Status" }),
          ]),
        ]),
        body,
      ]),
    );
  };

  const paintDefaults = () => {
    clear(defaultsPanel);
    defaultsPanel.append(el("h2", { text: "Defaults" }));
    for (const invoice of defaults) {
      defaultsPanel.append(
        el("p", {
          class: "amounts",
          text: `Invoice ${invoice.number} · Paddle ${invoice.paddle ?? "—"} · ${rotterdamTime(invoice.due_at)}`,
        }),
      );
    }
  };

  const paintDetail = () => {
    clear(detail);
    if (!selected) return;
    const invoice = selected;
    const amountInput = el("input", { type: "text", class: "amounts", inputmode: "decimal" });
    const methodSelect = el("select", { "aria-label": "Method" });
    for (const [value, label] of methods) {
      methodSelect.append(el("option", { value, text: label }));
    }
    const recordButton = el("button", { type: "button", class: "action", text: "Record payment" });
    const note = el("p", { class: "form-note" });
    const lines = el("tbody");
    for (const line of invoice.lines) {
      lines.append(
        el("tr", {}, [
          el("td", { text: `Lot ${line.lot_number}` }),
          el("td", { text: line.title }),
          el("td", { class: "amounts", text: amount(line.hammer) }),
          el("td", { class: "amounts", text: amount(line.premium) }),
          el("td", { class: "amounts", text: amount(line.vat) }),
        ]),
      );
    }
    detail.append(
      el("h2", { text: `Invoice ${invoice.number}` }),
      el("p", { text: `${invoice.bidder_name ?? ""} · Paddle ${invoice.paddle ?? "—"}` }),
      el("p", { class: "amounts", text: `Due by ${rotterdamTime(invoice.due_at)}` }),
      el("p", { class: "document-status", text: invoice.status }),
      el("table", { class: "desk-table", "aria-label": "Invoice lines" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { scope: "col", text: "Lot" }),
            el("th", { scope: "col", text: "Title" }),
            el("th", { scope: "col", text: "Hammer" }),
            el("th", { scope: "col", text: "Premium" }),
            el("th", { scope: "col", text: "VAT" }),
          ]),
        ]),
        lines,
      ]),
      el("p", { class: "amounts", text: `Outstanding ${amount(invoice.outstanding)}` }),
      field("Payment amount", amountInput, "payment-amount-error"),
      el("label", { class: "field" }, [
        el("span", { class: "field-label", text: "Method" }),
        methodSelect,
      ]),
      recordButton,
      note,
    );
    recordButton.addEventListener("click", async () => {
      setFieldError(amountInput, "payment-amount-error", "");
      recordButton.disabled = true;
      const result = await request<{ invoice: Invoice; payment: { amount: string } }>(
        "POST",
        `/api/desk/invoices/${encodeURIComponent(invoice.id)}/payments`,
        { amount: amountInput.value.trim(), method: methodSelect.value },
      );
      recordButton.disabled = false;
      if (result.status === 201 && result.body.invoice) {
        const next = result.body.invoice;
        note.textContent =
          next.status === "paid"
            ? copy.paymentFull(result.body.payment.amount, next.number)
            : copy.paymentPart(result.body.payment.amount, next.outstanding);
        app.say.result(note.textContent);
        selected = next;
        await refresh();
        return;
      }
      const message =
        result.body.fields?.amount ?? result.body.message ?? copy.serverFailure;
      if (result.body.fields?.amount) {
        setFieldError(amountInput, "payment-amount-error", message);
      } else {
        note.textContent = message;
      }
      app.say.result(message);
    });
  };

  const refresh = async () => {
    const status = show === "paid" ? "?status=paid" : show === "all" ? "" : "?status=issued";
    const [listed, defaulted] = await Promise.all([
      get<{ invoices: Invoice[] }>(`/api/desk/invoices${status}`),
      get<{ invoices: Invoice[] }>("/api/desk/invoices?status=defaulted"),
    ]);
    if (listed.status === 200) invoices = listed.body.invoices ?? [];
    if (defaulted.status === 200) defaults = defaulted.body.invoices ?? [];
    if (selected) {
      const fresh = await get<{ invoice: Invoice }>(
        `/api/desk/invoices/${encodeURIComponent(selected.id)}`,
      );
      if (fresh.status === 200) selected = fresh.body.invoice;
    } else if (invoices.length > 0) {
      selected = invoices[0];
    }
    paintTable();
    paintDefaults();
    paintDetail();
  };

  paintTable();
  paintDefaults();
  paintDetail();

  let refreshing = 0;
  return (_frame: Frame) => {
    window.clearTimeout(refreshing);
    refreshing = window.setTimeout(() => void refresh(), 150);
  };
};
