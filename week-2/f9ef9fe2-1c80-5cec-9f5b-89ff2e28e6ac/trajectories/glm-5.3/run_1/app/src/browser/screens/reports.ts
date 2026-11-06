import { api } from "../api";
import { el, fmtMoney } from "../ui";
import { state } from "../main";

export function renderReports(container: HTMLElement): void {
  const wide = el("div", { class: "wide editorial" });
  wide.append(el("h1", { class: "page-title", text: "Reports" }));
  const statusRegion = el("div", { role: "status", "aria-label": "Form status", class: "status-line" });

  const controls = el("div", { class: "row" });
  const field = el("div", { class: "field" });
  const label = el("label", { for: "report-month" });
  label.textContent = "Month";
  const monthInput = el("input", { id: "report-month", type: "month", value: state.kitchen!.today.slice(0, 7) });
  monthInput.setAttribute("aria-label", "Month");
  field.append(label, monthInput);
  const csvLink = el("a", { href: "#", onclick: (event: Event) => {
    event.preventDefault();
    downloadCsv();
  } });
  csvLink.textContent = "Download CSV";
  controls.append(field, csvLink);

  const content = el("div");
  wide.append(controls, statusRegion, content);
  container.append(wide);

  monthInput.addEventListener("change", () => {
    void refresh();
  });

  async function refresh(): Promise<void> {
    statusRegion.textContent = "Loading report…";
    const month = monthInput.value;
    try {
      const body = await api<{
        kitchen: { name: string };
        month: string;
        members: Array<{ member_id: string; business: string; booked_hours: string; cancelled_in_window_hours: string; billed_cents: number; refunded_cents: number; pack_balance_hours: string }>;
        stations: Array<{ station_id: string; name: string; booked_hours: string }>;
        invoices: Array<{ invoice_id: string; ref: string; kind: string; business: string; killbill_invoice_id: string | null; total_cents: number; issued_on: string }>;
        totals: { booked_hours: string; billed_cents: number; refunded_cents: number };
      }>("GET", `/kitchens/${state.user!.kitchen_id}/reports/usage?month=${month}`);
      statusRegion.replaceChildren();
      content.replaceChildren();

      const usageSection = el("section", { class: "first" });
      usageSection.append(el("h2", { text: "Usage by member" }));
      const usageTable = el("table", { class: "data card-table", "aria-label": "Usage by member" });
      usageTable.append(thead(["Business", "Booked hours", "Cancelled in window hours", "Billed", "Refunded", "Pack balance"]));
      const usageBody = el("tbody");
      for (const member of body.members) {
        const row = el("tr");
        row.append(el("td", { text: member.business, "data-label": "Business" }));
        row.append(el("td", { text: member.booked_hours, class: "num", "data-label": "Booked hours" }));
        row.append(el("td", { text: member.cancelled_in_window_hours, class: "num", "data-label": "Cancelled in window hours" }));
        row.append(el("td", { text: fmtMoney(member.billed_cents), class: "num", "data-label": "Billed" }));
        row.append(el("td", { text: fmtMoney(member.refunded_cents), class: "num", "data-label": "Refunded" }));
        row.append(el("td", { text: member.pack_balance_hours, class: "num", "data-label": "Pack balance" }));
        usageBody.append(row);
      }
      if (body.members.length === 0) {
        usageBody.append(emptyRow(6));
      }
      usageTable.append(usageBody);
      usageSection.append(usageTable);
      content.append(usageSection);

      const occupancySection = el("section");
      occupancySection.append(el("h2", { text: "Station occupancy" }));
      const occupancyTable = el("table", { class: "data card-table", "aria-label": "Station occupancy" });
      occupancyTable.append(thead(["Station", "Booked hours"]));
      const occupancyBody = el("tbody");
      for (const station of body.stations) {
        const row = el("tr");
        row.append(el("td", { text: station.name, "data-label": "Station" }));
        row.append(el("td", { text: station.booked_hours, class: "num", "data-label": "Booked hours" }));
        occupancyBody.append(row);
      }
      if (body.stations.length === 0) {
        occupancyBody.append(emptyRow(2));
      }
      occupancyTable.append(occupancyBody);
      occupancySection.append(occupancyTable);
      content.append(occupancySection);

      const invoicesSection = el("section");
      invoicesSection.append(el("h2", { text: "Invoices" }));
      const invoicesTable = el("table", { class: "data card-table", "aria-label": "Invoices" });
      invoicesTable.append(thead(["Invoice", "Kind", "Member", "Billing invoice", "Total", "Issued"]));
      const invoicesBody = el("tbody");
      for (const invoice of body.invoices) {
        const row = el("tr");
        row.append(el("td", { text: invoice.ref, class: "num", "data-label": "Invoice" }));
        row.append(el("td", { text: invoice.kind, "data-label": "Kind" }));
        row.append(el("td", { text: invoice.business, "data-label": "Member" }));
        row.append(el("td", { text: invoice.killbill_invoice_id ?? "\u2014", class: "num", "data-label": "Billing invoice" }));
        row.append(el("td", { text: fmtMoney(invoice.total_cents), class: "num", "data-label": "Total" }));
        row.append(el("td", { text: invoice.issued_on, class: "num", "data-label": "Issued" }));
        invoicesBody.append(row);
      }
      if (body.invoices.length === 0) {
        invoicesBody.append(emptyRow(6));
        statusRegion.textContent = `No bookings in ${monthName(month)}.`;
      }
      invoicesTable.append(invoicesBody);
      invoicesSection.append(invoicesTable);
      content.append(invoicesSection);
    } catch {
      statusRegion.textContent = "Could not load the report.";
    }
  }

  function thead(columns: string[]): HTMLElement {
    const headRow = el("tr");
    for (const column of columns) {
      headRow.append(el("th", { text: column, class: ["Booked hours", "Cancelled in window hours", "Billed", "Refunded", "Pack balance", "Total", "Issued"].includes(column) ? "num" : "" }));
    }
    const head = el("thead");
    head.append(headRow);
    return head;
  }

  function emptyRow(colspan: number): HTMLElement {
    const row = el("tr");
    row.append(el("td", { colspan: colspan, class: "muted", text: "Nothing here." }));
    return row;
  }

  async function downloadCsv(): Promise<void> {
    const month = monthInput.value;
    const response = await fetch(`/api/kitchens/${state.user!.kitchen_id}/reports/usage.csv?month=${month}`, { credentials: "same-origin" });
    if (!response.ok) {
      statusRegion.textContent = "Could not download the CSV.";
      return;
    }
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const match = /filename="([^"]+)"/.exec(disposition);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = match?.[1] ?? "report.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  void refresh();
}

function monthName(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(date) + " " + month.slice(0, 4);
}
