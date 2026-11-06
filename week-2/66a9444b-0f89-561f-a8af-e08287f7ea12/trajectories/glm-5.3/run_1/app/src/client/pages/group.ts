import { api, el, announce, problemText, eur, dateLong } from "../api.js";

interface Invoice {
  id: string;
  number: string;
  status: string;
  amount_cents: number;
  balance_cents: number;
  due_at: string;
}

export async function renderGroup(root: HTMLElement): Promise<void> {
  const wrap = el("div", { class: "wrap" });
  wrap.append(el("h1", { class: "section-head", text: "Group bookings" }));
  const statusNode = el("div", { role: "status", text: "" });
  wrap.append(statusNode);

  const totals = await api<{ organisation: { name: string }; orders: number; tickets: number; invoiced_cents: number; credited_cents: number; paid_cents: number; outstanding_cents: number }>("/api/group/dashboard");
  const totalsPanel = el("section", { class: "panel", role: "region", "aria-label": "Organisation totals" });
  totalsPanel.append(el("h2", { text: `${totals.organisation.name} — totals` }));
  const totalsList = el("ul", { class: "ruled" });
  for (const [label, value] of [
    ["Orders", String(totals.orders)],
    ["Tickets", String(totals.tickets)],
    ["Invoiced", eur(totals.invoiced_cents)],
    ["Credited", eur(totals.credited_cents)],
    ["Paid", eur(totals.paid_cents)],
    ["Outstanding", eur(totals.outstanding_cents)],
  ] as const) {
    const li = el("li", { class: "rule-row" });
    li.append(el("span", { text: label }), el("span", { text: value }));
    totalsList.append(li);
  }
  totalsPanel.append(totalsList);
  wrap.append(totalsPanel);

  const searchPanel = el("section", { class: "panel" });
  const searchInput = el("input", { type: "search", "aria-label": "Search attendees", placeholder: "Search attendees" }) as HTMLInputElement;
  const searchBtn = el("button", { text: "Search" });
  const searchResults = el("ul", { class: "ruled" });
  searchBtn.addEventListener("click", async () => {
    try {
      const res = await api<{ attendees: Array<{ name: string; order_ref: string; item_title: string; state: string }> }>(`/api/group/attendees?q=${encodeURIComponent(searchInput.value)}`);
      searchResults.replaceChildren();
      for (const a of res.attendees) {
        const li = el("li", { class: "rule-row", text: `${a.name} — ${a.item_title} — ${a.order_ref} — ${a.state}` });
        searchResults.append(li);
      }
    } catch (err) {
      announce(statusNode, problemText(err));
    }
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchBtn.click();
  });
  searchPanel.append(el("h2", { text: "Attendee search" }), searchInput, searchBtn, searchResults);
  wrap.append(searchPanel);

  const exportLink = el("a", { href: "/api/group/export.csv", text: "Export CSV" });
  wrap.append(exportLink);

  const invoicesTable = el("table", { class: "ruled", "aria-label": "Invoices" });
  const invoices = (await api<{ invoices: Invoice[] }>("/api/invoices")).invoices;
  const head = el("thead");
  const headRow = el("tr");
  for (const col of ["Number", "Status", "Amount", "Balance", "Due"]) headRow.append(el("th", { text: col }));
  head.append(headRow);
  invoicesTable.append(head);
  const tbody = el("tbody");
  for (const invoice of invoices) {
    const tr = el("tr");
    tr.append(
      el("td", { text: invoice.number }),
      el("td", { text: invoice.status }),
      el("td", { text: eur(invoice.amount_cents) }),
      el("td", { text: eur(invoice.balance_cents) }),
      el("td", { text: dateLong(invoice.due_at) }),
    );
    tbody.append(tr);
  }
  invoicesTable.append(tbody);
  wrap.append(el("h2", { text: "Invoices" }), invoicesTable);
  root.append(wrap);
}
