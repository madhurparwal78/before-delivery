import { data, type Screen } from "../app.js";
import { clear, el } from "../dom.js";
import { amount, rotterdamTime } from "../format.js";
import type { Invoice, Statement } from "../types.js";

const statusWord: Record<string, string> = {
  issued: "Issued",
  paid: "Paid",
  defaulted: "Defaulted",
  superseded: "Superseded",
  draft: "Draft",
};

const money = (value: string | null): string => (value === null ? "—" : amount(value));

const row = (cells: (string | Node)[], head = false): HTMLElement =>
  el(
    "tr",
    {},
    cells.map((cell) =>
      el(
        head ? "th" : "td",
        { class: typeof cell === "string" && cell.startsWith("€") ? "amounts" : "" , scope: head ? "col" : null },
        [cell],
      ),
    ),
  );

/** The invoice, set like a printed sale result. */
export const invoiceScreen: Screen = (app) => {
  const invoice = data<Invoice | null>(app, "invoice", null);
  clear(app.root);
  app.root.className = "page page-document";
  if (!invoice) return;
  const body = el("tbody");
  for (const line of invoice.lines) {
    body.append(
      row([
        `Lot ${line.lot_number}`,
        line.title,
        amount(line.hammer),
        amount(line.premium),
        amount(line.vat),
      ]),
    );
  }
  const foot = el("tfoot", {}, [
    row(["", "Hammer total", amount(invoice.hammer_total), "", ""]),
    row(["", "Buyer's premium", amount(invoice.premium_total), "", ""]),
    row(["", "VAT on the premium", amount(invoice.vat_total), "", ""]),
    row(["", "Total", amount(invoice.total), "", ""]),
    row(["", "Paid", amount(invoice.paid), "", ""]),
    row(["", "Outstanding", amount(invoice.outstanding), "", ""]),
  ]);
  app.root.append(
    el("article", { class: "document" }, [
      el("h1", { class: "document-heading", text: `INVOICE ${invoice.number}` }),
      el("p", { class: "document-meta", text: invoice.sale_title }),
      el("p", { class: "document-status", text: statusWord[invoice.status] ?? invoice.status }),
      el("p", {
        class: "document-meta amounts",
        text: `Payment due by ${rotterdamTime(invoice.due_at)}`,
      }),
      el("table", { class: "document-table", "aria-label": "Invoice lines" }, [
        el("thead", {}, [
          row(["Lot", "Title", "Hammer", "Premium", "VAT"], true),
        ]),
        body,
        foot,
      ]),
    ]),
  );
};

/** The seller statement, set like a printed sale result. */
export const statementScreen: Screen = (app) => {
  const statement = data<Statement | null>(app, "statement", null);
  const siblings = data<Statement[]>(app, "statements", []);
  clear(app.root);
  app.root.className = "page page-document";
  if (!statement) return;
  const body = el("tbody");
  for (const line of statement.lines) {
    body.append(
      row([
        `Lot ${line.lot_number}`,
        line.title,
        line.result === "sold" ? "Sold" : "Unsold",
        money(line.hammer),
        money(line.commission),
        money(line.net),
      ]),
    );
  }
  const foot = el("tfoot", {}, [
    row(["", "Hammer total", "", amount(statement.hammer_total), "", ""]),
    row(["", "Commission", "", amount(statement.commission_total), "", ""]),
    row(["", "Net due to you", "", amount(statement.net_total), "", ""]),
  ]);

  const linked = statement.superseded_by ?? statement.supersedes;
  const linkedStatement = siblings.find((other) => other.id === linked);
  const article = el("article", { class: "document" }, [
    el("h1", { class: "document-heading", text: `SELLER STATEMENT ${statement.number}` }),
    el("p", { class: "document-meta", text: statement.sale_title }),
    el("p", { class: "document-status", text: statusWord[statement.status] ?? statement.status }),
    el("table", { class: "document-table", "aria-label": "Statement lines" }, [
      el("thead", {}, [row(["Lot", "Title", "Result", "Hammer", "Commission", "Net"], true)]),
      body,
      foot,
    ]),
  ]);
  if (linked && linkedStatement) {
    article.append(
      el("p", {}, [
        el("a", {
          class: "panel-link",
          href: `/consign/statements/${encodeURIComponent(linkedStatement.id)}`,
          text: `Statement ${linkedStatement.number}`,
        }),
      ]),
    );
  }
  app.root.append(article);
};
