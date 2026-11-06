import { api, ApiError } from "../api";
import { el, fmtHours, fmtMoney } from "../ui";
import { state, actionPaused, navigate } from "../main";
import type { Invoice } from "./bookings";

interface Movement {
  id: string;
  kind: string;
  quarters: number;
  booking_id: string | null;
  reverses: string | null;
  created_at: string;
  entries: Array<{ account: string; quarters: number }>;
}

export function renderBilling(container: HTMLElement): void {
  const wide = el("div", { class: "wide editorial" });
  wide.append(el("h1", { class: "page-title", text: "Billing" }));
  const statusRegion = el("div", { role: "status", "aria-label": "Form status", class: "status-line" });
  const content = el("div");
  wide.append(statusRegion, content);
  container.append(wide);

  async function refresh(): Promise<void> {
    const memberId = state.user!.member_id!;
    const pack = await api<{ balance_quarters: number; balance_hours: string; movements: Movement[] }>("GET", `/members/${memberId}/pack`);
    const invoices = await api<{ invoices: Invoice[] }>("GET", "/invoices");
    content.replaceChildren();

    const balanceSection = el("section", { class: "first" });
    const heading = el("h2", { text: "Pack balance" });
    const balanceText = el("div", { class: "num", style: "font-size:2.2rem;font-family:var(--serif);color:var(--amber)", text: `${pack.balance_hours} hours` });
    const buy = el("button", { class: "btn primary", onclick: () => void buyPack() });
    buy.textContent = "Buy 20-hour pack";
    if (actionPaused("buy_pack")) {
      buy.disabled = true;
    }
    balanceSection.append(heading, balanceText, buy);
    content.append(balanceSection);

    const movementsSection = el("section");
    movementsSection.append(el("h2", { text: "Pack movements" }));
    const moveTable = el("table", { class: "data card-table", "aria-label": "Pack movements" });
    const headRow = el("tr");
    for (const column of ["Date", "Kind", "Hours", "Booking", "Balance after"]) {
      headRow.append(el("th", { text: column, class: ["Hours", "Balance after"].includes(column) ? "num" : "" }));
    }
    const thead = el("thead");
    thead.append(headRow);
    moveTable.append(thead);
    const tbody = el("tbody");
    let running = 0;
    for (const movement of pack.movements) {
      const memberEntry = movement.entries.find((entry) => entry.account === "member_pack");
      running += memberEntry?.quarters ?? 0;
      const row = el("tr");
      row.append(el("td", { text: movement.created_at.slice(0, 10), class: "num", "data-label": "Date" }));
      row.append(el("td", { text: movement.kind, "data-label": "Kind" }));
      row.append(el("td", { text: fmtHours(movement.quarters), class: "num", "data-label": "Hours" }));
      row.append(el("td", { text: movement.booking_id ?? "\u2014", class: "num", "data-label": "Booking" }));
      row.append(el("td", { text: fmtHours(running), class: "num", "data-label": "Balance after" }));
      tbody.append(row);
    }
    moveTable.append(tbody);
    movementsSection.append(moveTable);
    content.append(movementsSection);

    const invoicesSection = el("section");
    invoicesSection.append(el("h2", { text: "Invoices" }));
    const invTable = el("table", { class: "data card-table", "aria-label": "Invoices" });
    const invHead = el("tr");
    for (const column of ["Invoice", "Kind", "Issued", "Total", "Billing invoice", "Billing amount"]) {
      invHead.append(el("th", { text: column, class: ["Total", "Billing amount"].includes(column) ? "num" : "" }));
    }
    const invThead = el("thead");
    invThead.append(invHead);
    invTable.append(invThead);
    const invTbody = el("tbody");
    for (const invoice of invoices.invoices) {
      const row = el("tr", { tabindex: "0", onclick: () => renderInvoice(invoice), onkeydown: (event: KeyboardEvent) => {
        if (event.key === "Enter") {
          renderInvoice(invoice);
        }
      } });
      row.append(el("td", { text: invoice.ref, class: "num", "data-label": "Invoice" }));
      row.append(el("td", { text: invoice.kind, "data-label": "Kind" }));
      row.append(el("td", { text: invoice.issued_at.slice(0, 10), class: "num", "data-label": "Issued" }));
      row.append(el("td", { text: invoice.total, class: "num", "data-label": "Total" }));
      row.append(el("td", { text: invoice.killbill_invoice_id ?? "\u2014", class: "num", "data-label": "Billing invoice" }));
      row.append(el("td", { text: invoice.billing_amount_cents === null ? "\u2014" : fmtMoney(invoice.billing_amount_cents), class: "num", "data-label": "Billing amount" }));
      invTbody.append(row);
    }
    invTable.append(invTbody);
    invoicesSection.append(invTable);
    const detail = el("div");
    invoicesSection.append(detail);
    content.append(invoicesSection);

    function renderInvoice(invoice: Invoice): void {
      detail.replaceChildren();
      const panel = el("section", { class: "detail-panel", role: "region", "aria-label": `Invoice ${invoice.ref}` });
      for (const line of invoice.lines) {
        const isBookingLine = (line as { station?: string }).station !== undefined;
        panel.append(
          el("div", { class: "line" }, [
            el("span", {
              class: "k",
              text: isBookingLine
                ? `${(line as { station: string }).station} · tier ${(line as { tier: number }).tier} · ${(line as { paid_by: string }).paid_by}`
                : (line as { description: string }).description,
            }),
            el("span", { class: "v", text: isBookingLine ? `${(line as { hours: string }).hours} h · ${fmtMoney((line as { amount_cents: number }).amount_cents)}` : fmtMoney((line as { amount_cents: number }).amount_cents) }),
          ])
        );
      }
      panel.append(el("div", { class: "line" }, [el("span", { class: "k", text: "Total" }), el("span", { class: "v", text: invoice.total })]));
      panel.append(el("div", { class: "line" }, [el("span", { class: "k", text: "Billing invoice" }), el("span", { class: "v", text: invoice.killbill_invoice_id ?? "\u2014" })]));
      panel.append(
        el("div", { class: "line" }, [
          el("span", { class: "k", text: "Billing amount" }),
          el("span", { class: "v", text: invoice.billing_amount_cents === null ? "\u2014" : fmtMoney(invoice.billing_amount_cents) }),
        ])
      );
      detail.append(panel);
    }
  }

  async function buyPack(): Promise<void> {
    statusRegion.textContent = "Adding pack…";
    try {
      const result = await api<{ balance_quarters: number }>("POST", `/members/${state.user!.member_id}/packs`, {}, {
        "Idempotency-Key": `pack-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
      statusRegion.textContent = `20-hour pack added. Balance ${fmtHours(result.balance_quarters)} hours.`;
      await refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "billing_unavailable") {
        statusRegion.textContent = "Billing is unreachable. Pack purchases are paused; try again shortly.";
      } else {
        statusRegion.textContent = error instanceof ApiError ? error.message : "Something went wrong.";
      }
    }
  }

  window.addEventListener("pilotlight:status", () => {
    void refresh();
  });
  void refresh();
  void navigate;
}
