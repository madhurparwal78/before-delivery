/** Bookings: search, export, and each booking's row actions. */

import type { Booking, User } from "../../shared/api-types.js";
import { ApiClientError, apiDownload, apiJson } from "../api.js";
import type { Feedback } from "../feedback.js";
import { clearActivity, fallbackCopy, showActivity, showError } from "../feedback.js";
import { openDialog } from "../ui/dialog.js";
import { dollars } from "../kitchen-time.js";

interface ScreenDeps {
  user: User | null;
  feedback: Feedback;
  navigate(path: string): void;
}

const STATUS_WORDS: Record<string, string> = {
  confirmed: "Confirmed",
  checked_in: "Checked in",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show"
};

export async function renderBookings(root: HTMLElement, deps: ScreenDeps): Promise<void> {
  const user = deps.user;
  if (user === null) return;
  const activeUser = user;
  const screen = document.createElement("div");
  screen.className = "screen";
  const title = document.createElement("h1");
  title.textContent = "Bookings";
  screen.appendChild(title);

  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  const search = document.createElement("input");
  search.type = "search";
  search.setAttribute("role", "searchbox");
  search.setAttribute("aria-label", "Search bookings");
  search.placeholder = activeUser.role === "operator" ? "Ref, notes or business" : "Ref or notes";
  search.style.minWidth = "240px";
  const exportButton = document.createElement("button");
  exportButton.className = "btn";
  exportButton.textContent = "Export CSV";
  toolbar.append(search, exportButton);
  screen.appendChild(toolbar);

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "data";
  table.setAttribute("aria-label", "Bookings");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const columns = ["Ref", "Station", "Date", "Start", "End", "Status", "Payment", "Amount", "Notes", "Actions"];
  if (activeUser.role === "operator") columns.unshift("Tenant");
  for (const col of columns) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = col;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  screen.appendChild(tableWrap);
  root.replaceChildren(screen);

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  search.addEventListener("input", () => {
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void load(), 250);
  });
  exportButton.addEventListener("click", () => void exportCsv());

  async function load(): Promise<void> {
    showActivity(deps.feedback, "Searching…");
    try {
      const params = new URLSearchParams();
      if (search.value !== "") params.set("q", search.value);
      const query = params.toString();
      const res = await apiJson<{ bookings: Booking[] }>(
        "GET",
        `/api/bookings${query === "" ? "" : `?${query}`}`
      );
      clearActivity(deps.feedback);
      renderRows(res.bookings);
    } catch (e) {
      clearActivity(deps.feedback);
      if (e instanceof ApiClientError) showError(deps.feedback, fallbackCopy(e));
    }
  }

  function renderRows(bookings: Booking[]): void {
    tbody.replaceChildren();
    for (const booking of bookings) {
      const tr = document.createElement("tr");
      const cells: Array<[string, string]> = [
        ["Ref", booking.ref],
        ["Station", stationName(booking.station_id)],
        ["Date", booking.date],
        ["Start", booking.start_local],
        ["End", booking.end_local],
        ["Status", STATUS_WORDS[booking.status] ?? booking.status],
        ["Payment", booking.pay_with === "account" ? "Account" : booking.pay_with === "hour_pack" ? "Hour pack" : ""],
        ["Amount", booking.amount_cents === null ? "" : dollars(booking.amount_cents)],
        ["Notes", booking.notes]
      ];
      if (activeUser.role === "operator") cells.unshift(["Tenant", booking.tenant_name ?? ""]);
      for (const [label, value] of cells) {
        const td = document.createElement("td");
        td.dataset.label = label;
        td.textContent = value;
        if (["Ref", "Date", "Start", "End", "Amount"].includes(label)) td.className = "mono";
        tr.appendChild(td);
      }
      const actionTd = document.createElement("td");
      actionTd.dataset.label = "Actions";
      const actions = document.createElement("div");
      actions.className = "row-actions";
      appendRowActions(actions, booking);
      actionTd.appendChild(actions);
      tr.appendChild(actionTd);
      tbody.appendChild(tr);
    }
  }

  function appendRowActions(container: HTMLElement, booking: Booking): void {
    const canCheckIn = booking.status === "confirmed" && (activeUser.role !== "cook" || booking.tenant_id === activeUser.tenant_id);
    const canCheckOut = booking.status === "checked_in";
    const canCancel = booking.status === "confirmed" && activeUser.role !== "cook";
    const canNoShow = booking.status === "confirmed" && activeUser.role === "operator";
    const canRefund =
      activeUser.role === "operator" &&
      booking.status === "cancelled" &&
      booking.cancellation?.late === true &&
      !booking.cancellation.fee_refunded;

    if (canCheckIn) {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = `Check in ${booking.ref}`;
      btn.addEventListener("click", () => void checkIn(booking, btn));
      container.appendChild(btn);
    }
    if (canCheckOut) {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = `Check out ${booking.ref}`;
      btn.addEventListener("click", () => openCheckOutDialog(booking));
      container.appendChild(btn);
    }
    if (canCancel) {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = `Cancel ${booking.ref}`;
      btn.addEventListener("click", () => openCancelDialog(booking));
      container.appendChild(btn);
    }
    if (canNoShow) {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = `Mark no-show ${booking.ref}`;
      btn.addEventListener("click", () => void markNoShow(booking));
      container.appendChild(btn);
    }
    if (canRefund) {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = `Refund fee ${booking.ref}`;
      btn.addEventListener("click", () => void refundFee(booking));
      container.appendChild(btn);
    }
  }

  async function checkIn(booking: Booking, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    showActivity(deps.feedback, "Checking in…");
    try {
      const updated = await apiJson<Booking>("POST", `/api/bookings/${booking.id}/check-in`, {});
      await load();
      clearActivity(deps.feedback);
      showActivity(deps.feedback, `Checked in to ${stationName(booking.station_id)} at ${updated.checked_in_at?.slice(11, 16) ?? ""}.`);
    } catch (e) {
      button.disabled = false;
      if (e instanceof ApiClientError) {
        showError(
          deps.feedback,
          e.detail.code === "outside_check_in_window"
            ? "Check-in isn't open for this booking yet, or it has ended."
            : e.detail.code === "tenant_not_active"
              ? "Check-in is blocked: a required document has expired."
              : fallbackCopy(e)
        );
      }
    }
  }

  function openCheckOutDialog(booking: Booking): void {
    openDialog({
      label: `Check out ${booking.ref}`,
      build: (inner, close) => {
        const form = document.createElement("form");
        const field = document.createElement("div");
        field.className = "field";
        const label = document.createElement("label");
        label.setAttribute("for", "holdover-minutes");
        label.textContent = "Minutes past booked end";
        const input = document.createElement("input");
        input.type = "number";
        input.id = "holdover-minutes";
        input.min = "0";
        input.max = "240";
        input.step = "1";
        input.value = "0";
        input.required = true;
        field.append(label, input);
        const fieldError = document.createElement("span");
        fieldError.className = "field-error";
        fieldError.id = "holdover-error";
        field.appendChild(fieldError);
        const actions = document.createElement("div");
        actions.className = "dialog-actions";
        const submit = document.createElement("button");
        submit.className = "btn primary";
        submit.type = "submit";
        submit.textContent = "Check out";
        const cancel = document.createElement("button");
        cancel.className = "btn";
        cancel.type = "button";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => close());
        actions.append(submit, cancel);
        form.append(field, actions);
        inner.appendChild(form);

        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const minutes = Number(input.value);
          if (!Number.isInteger(minutes) || minutes < 0 || minutes > 240) {
            fieldError.textContent = "Enter whole minutes from 0 to 240.";
            input.setAttribute("aria-describedby", "holdover-error");
            return;
          }
          fieldError.textContent = "";
          submit.disabled = true;
          showActivity(deps.feedback, "Checking out…");
          try {
            const updated = await apiJson<Booking>("POST", `/api/bookings/${booking.id}/check-out`, {
              holdover_minutes: minutes
            });
            close();
            await load();
            clearActivity(deps.feedback);
            showActivity(
              deps.feedback,
              updated.holdover && updated.holdover.billed_minutes > 0
                ? `Checked out. Hold-over billed: ${updated.holdover.billed_minutes} min (${dollars(updated.holdover.amount_cents)}).`
                : "Checked out. No hold-over billed."
            );
          } catch (e) {
            submit.disabled = false;
            if (e instanceof ApiClientError) {
              if (e.detail.code === "validation_failed") {
                fieldError.textContent = "Enter whole minutes from 0 to 240.";
                input.setAttribute("aria-describedby", "holdover-error");
                clearActivity(deps.feedback);
                return;
              }
              showError(
                deps.feedback,
                e.detail.code === "billing_unavailable"
                  ? "Billing is unreachable. Nothing was charged; try again in a moment."
                  : e.detail.code === "mail_unavailable"
                    ? "Email is unreachable. Nothing was recorded; try again in a moment."
                    : fallbackCopy(e)
              );
            }
          }
        });
      }
    });
  }

  function openCancelDialog(booking: Booking): void {
    const policy = booking.policy;
    // State the fee or hours that will be kept under the booking's own policy version.
    const startsInMs = Date.parse(booking.start);
    let feeStatement: string;
    if (policy === null) {
      feeStatement = "";
    } else if (startsInMs - Date.now() > policy.free_window_hours * 3_600_000) {
      feeStatement = "No charge: this booking is inside the free window.";
    } else if (booking.pay_with === "hour_pack") {
      const feeMinutes = Math.round((booking.elapsed_minutes * policy.late_fee_percent) / 100);
      feeStatement = `${Math.floor(feeMinutes / 60)}:${String(feeMinutes % 60).padStart(2, "0")} kept from your hour pack (policy v${policy.version}).`;
    } else {
      const feeCents = Math.round(((booking.amount_cents ?? 0) * policy.late_fee_percent) / 100);
      feeStatement = `Late cancellation charge: ${dollars(feeCents)} (policy v${policy.version}).`;
    }
    openDialog({
      label: `Cancel booking ${booking.ref}`,
      build: (inner, close) => {
        const text = document.createElement("p");
        text.textContent = feeStatement;
        const actions = document.createElement("div");
        actions.className = "dialog-actions";
        const confirm = document.createElement("button");
        confirm.className = "btn primary";
        confirm.textContent = "Cancel booking";
        confirm.addEventListener("click", async () => {
          confirm.disabled = true;
          showActivity(deps.feedback, "Cancelling…");
          try {
            const updated = await apiJson<Booking>("POST", `/api/bookings/${booking.id}/cancel`, {});
            close();
            await load();
            clearActivity(deps.feedback);
            const cancellation = updated.cancellation;
            let outcome = "No charge.";
            if (cancellation !== null && cancellation.late) {
              if (updated.pay_with === "hour_pack") {
                outcome = `${Math.floor(cancellation.fee_minutes / 60)}:${String(cancellation.fee_minutes % 60).padStart(2, "0")} kept from your hour pack.`;
              } else {
                outcome = `Late cancellation charge: ${dollars(cancellation.fee_cents)}.`;
              }
            }
            showActivity(deps.feedback, `Booking ${booking.ref} cancelled. ${outcome}`);
          } catch (e) {
            confirm.disabled = false;
            if (e instanceof ApiClientError) {
              showError(
                deps.feedback,
                e.detail.code === "already_started"
                  ? "This booking has started and can't be cancelled."
                  : e.detail.code === "billing_unavailable"
                    ? "Billing is unreachable. Nothing was charged; try again in a moment."
                    : fallbackCopy(e)
              );
            }
          }
        });
        const keep = document.createElement("button");
        keep.className = "btn";
        keep.textContent = "Keep booking";
        keep.addEventListener("click", () => close());
        actions.append(confirm, keep);
        inner.append(text, actions);
      }
    });
  }

  async function markNoShow(booking: Booking): Promise<void> {
    showActivity(deps.feedback, "Saving…");
    try {
      await apiJson<Booking>("POST", `/api/bookings/${booking.id}/no-show`, {});
      await load();
      clearActivity(deps.feedback);
      showActivity(deps.feedback, `Booking ${booking.ref} marked as a no-show.`);
    } catch (e) {
      if (e instanceof ApiClientError) {
        showError(
          deps.feedback,
          e.detail.code === "not_started" ? "This booking hasn't started yet." : fallbackCopy(e)
        );
      }
    }
  }

  async function refundFee(booking: Booking): Promise<void> {
    showActivity(deps.feedback, "Refunding fee…");
    try {
      await apiJson<Booking>("POST", `/api/bookings/${booking.id}/refund-fee`, {});
      await load();
      clearActivity(deps.feedback);
      showActivity(deps.feedback, `Late fee on ${booking.ref} refunded.`);
    } catch (e) {
      if (e instanceof ApiClientError) {
        showError(
          deps.feedback,
          e.detail.code === "invalid_transition" || e.detail.code === "fee_invoiced"
            ? "That fee is already refunded or invoiced."
            : e.detail.code === "billing_unavailable"
              ? "Billing is unreachable. Nothing was refunded; try again in a moment."
              : fallbackCopy(e)
        );
      }
    }
  }

  async function exportCsv(): Promise<void> {
    showActivity(deps.feedback, "Preparing export…");
    try {
      const params = new URLSearchParams();
      if (search.value !== "") params.set("q", search.value);
      const query = params.toString();
      await apiDownload(`/api/bookings/export${query === "" ? "" : `?${query}`}`);
      clearActivity(deps.feedback);
      showActivity(deps.feedback, "Export downloaded.");
    } catch (e) {
      clearActivity(deps.feedback);
      if (e instanceof ApiClientError) showError(deps.feedback, fallbackCopy(e));
    }
  }

  await load();
}

const stationNames = new Map<string, string>();

function stationName(id: string): string {
  return stationNames.get(id) ?? id;
}

export async function primeStationNames(): Promise<void> {
  try {
    const dial = await apiJson<{ stations: Array<{ id: string; name: string }> }>("GET", "/api/dial");
    for (const station of dial.stations) stationNames.set(station.id, station.name);
  } catch {
    /* names stay as ids */
  }
}
