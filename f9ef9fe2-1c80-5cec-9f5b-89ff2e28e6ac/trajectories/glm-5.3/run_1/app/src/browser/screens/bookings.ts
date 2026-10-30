import { api, ApiError } from "../api";
import { el, fmtHours, fmtMoney } from "../ui";
import { state, actionPaused } from "../main";
import { openDialog } from "../ui";

export interface BookingLine {
  station_id: string;
  station: string;
  tier: number;
  paid_by: "cash" | "pack";
  quarters: number;
  hours: string;
  hourly_rate_cents: number;
  amount_cents: number;
}

export interface Booking {
  id: string;
  ref: string;
  member_id: string;
  kitchen_id: string;
  date: string;
  state: string;
  cells: Array<{ station_id: string; start: string }>;
  blocks: Array<{ station_id: string; station: string; start: string; end: string; hours: string }>;
  starts_at: string;
  ends_at: string;
  quarters: number;
  hours: string;
  lines: BookingLine[];
  pack_quarters: number;
  total_cents: number;
  total: string;
  rate_card_id: string;
  cancellation_window_hours: number;
  confirmed_at: string;
  invoice_id: string | null;
  series_id: string | null;
}

export interface Invoice {
  id: string;
  ref: string;
  member_id: string;
  kind: string;
  booking_ids: string[];
  lines: Array<BookingLine | { description: string; amount_cents: number }>;
  total_cents: number;
  total: string;
  killbill_invoice_id: string | null;
  billing_amount_cents: number | null;
  issued_at: string;
}

export function stationsSummary(booking: Booking): string {
  return booking.blocks.map((block) => block.station).join(", ");
}

export function timesSummary(booking: Booking): string {
  const starts = booking.blocks.map((block) => block.start);
  const ends = booking.blocks.map((block) => block.end);
  const first = starts.sort()[0] ?? "";
  const last = ends.sort().slice(-1)[0] ?? "";
  return `${first}\u2013${last}`;
}

export function isLine(line: BookingLine | { description: string; amount_cents: number }): line is BookingLine {
  return (line as BookingLine).station !== undefined;
}

export function renderBookings(container: HTMLElement): void {
  const wide = el("div", { class: "wide editorial" });
  const title = el("h1", { class: "page-title", text: state.user!.role === "operator" ? "Day sheet" : "Bookings" });
  wide.append(title);
  const statusRegion = el("div", { role: "status", "aria-label": "Form status", class: "status-line" });
  const listEl = el("div");
  const detailEl = el("div");
  let selected: Booking | null = null;

  const isOperator = state.user!.role === "operator";
  const isBookkeeper = state.user!.role === "bookkeeper";
  const useDate = isOperator || isBookkeeper;
  let chosenDate = state.kitchen!.today;
  const memberNames = new Map<string, string>();
  if (isOperator || isBookkeeper) {
    void api<{ members: Array<{ id: string; business: string }> }>("GET", `/kitchens/${state.user!.kitchen_id}/members`).then((body) => {
      for (const member of body.members) {
        memberNames.set(member.id, member.business);
      }
      void refresh();
    });
  }

  const controls = el("div", { class: "row" });
  if (useDate) {
    const field = el("div", { class: "field" });
    const label = el("label", { for: "bookings-date" });
    label.textContent = "Date";
    const input = el("input", { id: "bookings-date", type: "date", value: chosenDate });
    input.setAttribute("aria-label", "Date");
    input.addEventListener("change", () => {
      chosenDate = input.value;
      void refresh();
    });
    field.append(label, input);
    controls.append(field);
  }
  wide.append(controls, statusRegion, listEl, detailEl);
  container.append(wide);

  async function refresh(): Promise<void> {
    const path = useDate ? `/bookings?date=${chosenDate}` : "/bookings";
    const body = await api<{ bookings: Booking[] }>("GET", path);
    const bookings = body.bookings;
    if (!useDate) {
      const today = state.kitchen!.today;
      bookings.sort((a, b) => {
        const aUpcoming = a.date >= today ? 0 : 1;
        const bUpcoming = b.date >= today ? 0 : 1;
        if (aUpcoming !== bUpcoming) {
          return aUpcoming - bUpcoming;
        }
        return aUpcoming === 0 ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
      });
    }
    renderTable(bookings);
  }

  function renderTable(bookings: Booking[]): void {
    listEl.replaceChildren();
    const table = el("table", { class: "data card-table", "aria-label": "Bookings" });
    const headRow = el("tr");
    for (const column of ["Reference", "Date", "Stations", "Time", ...(isOperator || isBookkeeper ? ["Member"] : []), "Hours", "Total", "State"]) {
      headRow.append(el("th", { text: column, class: ["Hours", "Total"].includes(column) ? "num" : "" }));
    }
    const thead = el("thead");
    thead.append(headRow);
    table.append(thead);
    const tbody = el("tbody");
    if (bookings.length === 0) {
      const row = el("tr");
      row.append(el("td", { colspan: 8, class: "muted", text: "No bookings for this day." }));
      tbody.append(row);
    }
    for (const booking of bookings) {
      const row = el("tr", { tabindex: "0", onclick: () => select(booking), onkeydown: (event: KeyboardEvent) => {
        if (event.key === "Enter") {
          select(booking);
        }
      } });
      row.append(el("td", { text: booking.ref, "data-label": "Reference" }));
      row.append(el("td", { text: booking.date, class: "num", "data-label": "Date" }));
      row.append(el("td", { text: stationsSummary(booking), "data-label": "Stations" }));
      row.append(el("td", { text: timesSummary(booking), class: "num", "data-label": "Time" }));
      if (isOperator || isBookkeeper) {
        row.append(el("td", { text: memberNames.get(booking.member_id) ?? booking.member_id, "data-label": "Member" }));
      }
      row.append(el("td", { text: booking.hours, class: "num", "data-label": "Hours" }));
      row.append(el("td", { text: booking.total, class: "num", "data-label": "Total" }));
      row.append(el("td", { "data-label": "State" }, [el("span", { class: `state-chip ${booking.state}`, text: booking.state.replace(/_/g, " ") })]));
      tbody.append(row);
    }
    table.append(tbody);
    listEl.append(table);
  }

  function select(booking: Booking): void {
    selected = booking;
    void renderDetail();
  }

  async function renderDetail(): Promise<void> {
    if (!selected) {
      detailEl.replaceChildren();
      return;
    }
    const booking = selected;
    detailEl.replaceChildren();
    const panel = el("section", { class: "detail-panel", role: "region", "aria-label": `Booking ${booking.ref}` });
    const lines: Array<[string, string]> = [
      ["Reference", booking.ref],
      ["Date", booking.date],
      ["Stations", stationsSummary(booking)],
      ["Time", timesSummary(booking)],
      ["Hours", booking.hours],
      ["Total", booking.total],
      ["Pack hours used", fmtHours(booking.pack_quarters)],
      ["Rate card", booking.rate_card_id],
      ["Cancellation window", `${booking.cancellation_window_hours} hours`],
      ["State", booking.state.replace(/_/g, " ")],
    ];
    for (const [key, value] of lines) {
      panel.append(el("div", { class: "line" }, [el("span", { class: "k", text: key }), el("span", { class: "v", text: value })]));
    }
    for (const line of booking.lines) {
      panel.append(
        el("div", { class: "line" }, [
          el("span", { class: "k", text: `${line.station} · tier ${line.tier} · ${line.paid_by}` }),
          el("span", { class: "v", text: `${line.hours} h · ${line.paid_by === "pack" ? "pack" : fmtMoney(line.amount_cents)}` }),
        ])
      );
    }
    const actions = el("div", { class: "actions" });
    if (booking.invoice_id) {
      const invoiceBody = await api<{ invoice: Invoice }>("GET", `/invoices/${booking.invoice_id}`);
      const link = el("a", { href: "#", onclick: (event: Event) => {
        event.preventDefault();
        renderInvoice(invoiceBody.invoice);
      } }, []);
      link.setAttribute("aria-label", `Invoice ${invoiceBody.invoice.ref}`);
      link.textContent = `Invoice ${invoiceBody.invoice.ref}`;
      actions.append(link);
    }
    if (state.user!.role !== "bookkeeper" && booking.state === "confirmed") {
      const cancelBtn = el("button", { class: "btn", onclick: () => openCancelDialog(booking) });
      cancelBtn.textContent = "Cancel booking";
      if (actionPaused("cancel_booking")) {
        cancelBtn.disabled = true;
      }
      actions.append(cancelBtn);
    }
    if (isOperator) {
      if (booking.state === "confirmed") {
        const checkIn = el("button", { class: "btn", onclick: () => void dayOp(booking, "check-in") });
        checkIn.textContent = "Check in";
        const noShow = el("button", { class: "btn", onclick: () => void dayOp(booking, "no-show") });
        noShow.textContent = "Mark no-show";
        actions.append(checkIn, noShow);
      }
      if (booking.state === "checked_in") {
        const complete = el("button", { class: "btn", onclick: () => void dayOp(booking, "complete") });
        complete.textContent = "Mark completed";
        actions.append(complete);
      }
    }
    panel.append(actions);
    detailEl.append(panel);
  }

  function renderInvoice(invoice: Invoice): void {
    const panel = el("section", { class: "detail-panel", role: "region", "aria-label": `Invoice ${invoice.ref}` });
    panel.append(el("div", { class: "line" }, [el("span", { class: "k", text: "Invoice" }), el("span", { class: "v", text: invoice.ref })]));
    panel.append(el("div", { class: "line" }, [el("span", { class: "k", text: "Kind" }), el("span", { class: "v", text: invoice.kind })]));
    for (const line of invoice.lines) {
      if (isLine(line)) {
        panel.append(
          el("div", { class: "line" }, [
            el("span", { class: "k", text: `${line.station} · tier ${line.tier} · ${line.paid_by}` }),
            el("span", { class: "v", text: `${line.hours} h · ${line.paid_by === "pack" ? "pack" : fmtMoney(line.amount_cents)}` }),
          ])
        );
      } else {
        panel.append(el("div", { class: "line" }, [el("span", { class: "k", text: line.description }), el("span", { class: "v", text: fmtMoney(line.amount_cents) })]));
      }
    }
    panel.append(el("div", { class: "line" }, [el("span", { class: "k", text: "Total" }), el("span", { class: "v", text: invoice.total })]));
    panel.append(
      el("div", { class: "line" }, [
        el("span", { class: "k", text: "Billing invoice" }),
        el("span", { class: "v", text: invoice.killbill_invoice_id ?? "\u2014" }),
      ])
    );
    panel.append(
      el("div", { class: "line" }, [
        el("span", { class: "k", text: "Billing amount" }),
        el("span", { class: "v", text: invoice.billing_amount_cents === null ? "\u2014" : fmtMoney(invoice.billing_amount_cents) }),
      ])
    );
    detailEl.append(panel);
  }

  function openCancelDialog(booking: Booking): void {
    const inWindow = Date.now() <= Date.parse(booking.starts_at) - booking.cancellation_window_hours * 3600000;
    const hours = fmtHours(booking.pack_quarters);
    const amount = (booking.total_cents / 100).toFixed(2);
    const preview = inWindow
      ? `Cancelling now refunds ${hours} pack hours and $${amount}.`
      : `This is inside the ${booking.cancellation_window_hours}-hour cancellation window. Cancelling now refunds nothing.`;
    const body = el("div", { class: "dialog-body" });
    body.append(el("p", { text: preview }));
    const actions = el("div", { class: "dialog-actions" });
    const yes = el("button", { class: "btn primary" });
    yes.textContent = "Yes, cancel";
    const keep = el("button", { class: "btn" });
    keep.textContent = "Keep booking";
    actions.append(yes, keep);
    body.append(actions);
    const dialogHandle = openDialog({ label: "Cancel booking", body }, () => undefined);
    yes.addEventListener("click", async () => {
      yes.disabled = true;
      statusRegion.textContent = "Cancelling…";
      try {
        const result = await api<{ booking: Booking; refund: { pack_quarters: number; amount_cents: number } }>("POST", `/bookings/${booking.id}/cancel`, {});
        dialogHandle.close(true);
        selected = result.booking;
        if (result.booking.state === "cancelled_in_window") {
          statusRegion.textContent = `Booking ${result.booking.ref} cancelled. ${fmtHours(result.refund.pack_quarters)} pack hours and $${(result.refund.amount_cents / 100).toFixed(2)} refunded.`;
        } else {
          statusRegion.textContent = `Booking ${result.booking.ref} cancelled inside the ${result.booking.cancellation_window_hours}-hour window, so it is still charged.`;
        }
        await refresh();
        await renderDetail();
      } catch (error) {
        yes.disabled = false;
        if (error instanceof ApiError && error.code === "invalid_transition") {
          statusRegion.textContent = `${booking.ref} cannot move from ${String(error.extra.from).replace(/_/g, " ")} to ${String(error.extra.to).replace(/_/g, " ")}.`;
        } else {
          statusRegion.textContent = error instanceof ApiError ? error.message : "Something went wrong.";
        }
      }
    });
    keep.addEventListener("click", () => dialogHandle.close(null));
  }

  async function dayOp(booking: Booking, action: string): Promise<void> {
    const op = action === "check-in" ? "check in" : action === "complete" ? "mark completed" : "mark no-show";
    statusRegion.textContent = "Saving…";
    try {
      const result = await api<{ booking: Booking }>("POST", `/bookings/${booking.id}/${action}`, {});
      selected = result.booking;
      if (action === "check-in") {
        statusRegion.textContent = `Checked in ${memberNames.get(booking.member_id) ?? booking.member_id}.`;
      } else if (action === "complete") {
        statusRegion.textContent = `Marked ${result.booking.ref} completed.`;
      } else {
        statusRegion.textContent = `Marked ${result.booking.ref} as a no-show.`;
      }
      await refresh();
      await renderDetail();
    } catch (error) {
      if (error instanceof ApiError && error.code === "invalid_transition") {
        statusRegion.textContent = `${booking.ref} cannot move from ${String(error.extra.from).replace(/_/g, " ")} to ${String(error.extra.to).replace(/_/g, " ")}.`;
      } else if (error instanceof ApiError && error.code === "booking_day_not_reached") {
        statusRegion.textContent = `${booking.ref} can only be checked in or marked no-show from its booking day.`;
      } else {
        statusRegion.textContent = error instanceof ApiError ? error.message : `Could not ${op}.`;
      }
    }
  }

  void refresh();
}
