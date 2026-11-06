// Shift: the usage sheet with check-in, check-out and the Block station
// dialog. The sheet's date lives in the address (DP-49).

import { ApiFailure, apiJson, postJson } from "../lib/api.js";
import { announce, clear, el, trapFocus } from "../lib/dom.js";
import { dayOfMonth, isValidDate, monthName, weekdayName } from "../lib/clock.js";
import { screenFrame, type AppCtx } from "../lib/shell.js";

type Row = {
  booking_id: string;
  station_name: string;
  renter_business_name: string;
  start: string;
  end: string;
  actual_start: string | null;
  actual_end: string | null;
  status: string;
  overage_units: number;
  overage_usd: string;
};

type SheetData = { date: string; server_now: string; rows: Row[] };
type Station = { id: string; name: string };

const roundDownTo15 = (minutes: number): number => Math.floor(minutes / 15) * 15;
const hhmm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export const renderShift = async (mount: HTMLElement, ctx: AppCtx): Promise<void> => {
  const status = el("div", {
    role: "status",
    id: "shift-status",
    class: "status-live",
    "aria-live": "polite",
    "aria-label": "Shift status",
  });

  const body = el("div", { class: "shift-body" });
  const frame = screenFrame(ctx.user, ctx.navigate, body, "Shift");

  const shownDate = (): string => {
    const param = new URLSearchParams(window.location.search).get("date") ?? "";
    return isValidDate(param) ? param : ctx.today;
  };
  const setDate = (date: string): void => {
    window.history.pushState({}, "", `/shift?date=${date}`);
    void load();
  };

  const dateInput = el("input", { type: "text", "aria-label": "Sheet date", value: shownDate() });
  dateInput.addEventListener("change", () => {
    const value = (dateInput as HTMLInputElement).value.trim();
    if (isValidDate(value)) setDate(value);
    else (dateInput as HTMLInputElement).value = shownDate();
  });

  const sheetHeading = el("h2", { class: "sheet-heading" }, "");
  const table = el("table", { class: "data-table", "aria-label": "Usage sheet" });
  const blockButton = el("button", { type: "button" }, "Block station");

  let data: SheetData | null = null;
  let serverNowMs = Date.now();

  const openDialog = (kind: "in" | "out", row: Row): void => {
    const minutesNow = Math.floor(
      (serverNowMs - Date.parse(`${data?.date ?? shownDate()}T00:00:00Z`)) / 60000,
    );
    const preset = hhmm(roundDownTo15(Math.max(0, Math.min(1440, minutesNow))));
    const input = el("input", {
      type: "text",
      value: preset,
      "aria-label": kind === "in" ? "Actual start" : "Actual end",
    });
    const record = el("button", { type: "button" }, kind === "in" ? "Record check-in" : "Record check-out");
    const dialog = el(
      "div",
      { role: "dialog", "aria-label": kind === "in" ? "Check in" : "Check out", class: "dialog" },
      input,
      record,
    );
    const backdrop = el("div", { class: "dialog-backdrop" }, dialog);
    const close = (): void => {
      backdrop.remove();
      void load();
    };
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      trapFocus(dialog, event);
    });
    record.addEventListener("click", async () => {
      record.disabled = true;
      announce(status, "Saving…");
      const path = kind === "in" ? "check-in" : "check-out";
      const payload = kind === "in" ? { actual_start: (input as HTMLInputElement).value } : { actual_end: (input as HTMLInputElement).value };
      try {
        const result = await postJson<{ booking: { overage_units: number; overage_usd: string | null } }>(
          `/api/bookings/${row.booking_id}/${path}`,
          payload,
        );
        if (kind === "in") {
          announce(status, `Checked in at ${(input as HTMLInputElement).value}.`);
        } else {
          const units = result.booking.overage_units ?? 0;
          announce(
            status,
            units > 0
              ? `Checked out. Overage: ${units} × 15 minutes, $${result.booking.overage_usd}.`
              : "Checked out. No overage.",
          );
        }
        close();
      } catch (err) {
        record.disabled = false;
        if (err instanceof ApiFailure && err.code === "billing_unavailable") {
          announce(status, "Billing is unreachable, so this check-out wasn't recorded. Try again in a minute.");
        } else {
          announce(status, "Something went wrong. Try again.");
        }
      }
    });
    mount.append(backdrop);
    input.focus();
  };

  const openBlock = async (): Promise<void> => {
    const stations = (await apiJson<{ stations: Station[] }>(`/api/stations?date=${shownDate()}`)).stations;
    const select = el("select", { "aria-label": "Station" });
    for (const station of stations) select.append(el("option", { value: station.id }, station.name));
    const dateField = el("input", { type: "text", "aria-label": "Date", value: shownDate() });
    const fromField = el("input", { type: "text", "aria-label": "From" });
    const untilField = el("input", { type: "text", "aria-label": "Until" });
    const reasonField = el("input", { type: "text", "aria-label": "Reason" });
    const save = el("button", { type: "button" }, "Save block");
    const dialog = el(
      "div",
      { role: "dialog", "aria-label": "Block station", class: "dialog" },
      select,
      dateField,
      fromField,
      untilField,
      reasonField,
      save,
    );
    const backdrop = el("div", { class: "dialog-backdrop" }, dialog);
    const close = (): void => {
      backdrop.remove();
      void load();
    };
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      trapFocus(dialog, event);
    });
    save.addEventListener("click", async () => {
      save.disabled = true;
      announce(status, "Saving…");
      try {
        const result = await postJson<{ displaced_booking_ids: string[] }>(
          `/api/stations/${(select as HTMLSelectElement).value}/maintenance`,
          {
            date: (dateField as HTMLInputElement).value.trim(),
            start: (fromField as HTMLInputElement).value.trim(),
            end: (untilField as HTMLInputElement).value.trim(),
            reason: (reasonField as HTMLInputElement).value.trim(),
          },
        );
        announce(status, `Station blocked. ${result.displaced_booking_ids.length} bookings displaced. Affected renters are being emailed.`);
        close();
      } catch (err) {
        save.disabled = false;
        if (err instanceof ApiFailure && err.code === "station_in_use") {
          announce(status, "Someone is checked in on that station during that time.");
        } else {
          announce(status, "Something went wrong. Try again.");
        }
      }
    });
    mount.append(backdrop);
    select.focus();
  };
  blockButton.addEventListener("click", () => void openBlock());

  const load = async (): Promise<void> => {
    const date = shownDate();
    if (!isValidDate(new URLSearchParams(window.location.search).get("date") ?? "")) {
      window.history.replaceState({}, "", `/shift?date=${ctx.today}`);
    }
    const sheet = await apiJson<SheetData>(`/api/usage-sheet?date=${date}`);
    data = sheet;
    serverNowMs = Date.parse(sheet.server_now);
    window.__railsideToday = sheet.date;
    (dateInput as HTMLInputElement).value = sheet.date;
    sheetHeading.textContent = `Usage sheet for ${weekdayName(sheet.date)} ${dayOfMonth(sheet.date)} ${monthName(sheet.date)} ${sheet.date.slice(0, 4)}`;
    clear(table);
    table.append(
      el("thead", {}, el("tr", {}, el("th", {}, "Station"), el("th", {}, "Renter"), el("th", {}, "Booked"), el("th", {}, "Actual"), el("th", {}, "Status"), el("th", {}, "Overage"), el("th", {}, ""))),
    );
    const tbody = el("tbody");
    if (sheet.rows.length === 0) {
      tbody.append(el("tr", { class: "empty-row" }, el("td", { colspan: "7" }, "No bookings on this day.")));
    }
    for (const row of sheet.rows) {
      const action = el("div", { class: "row-actions" });
      if (row.status === "confirmed") {
        const checkIn = el("button", { type: "button" }, `Check in ${row.renter_business_name}`);
        checkIn.addEventListener("click", () => openDialog("in", row));
        action.append(checkIn);
      } else if (row.status === "checked_in") {
        const checkOut = el("button", { type: "button" }, `Check out ${row.renter_business_name}`);
        checkOut.addEventListener("click", () => openDialog("out", row));
        action.append(checkOut);
      }
      const statusWord = row.status === "confirmed" ? "Confirmed" : row.status === "checked_in" ? "Checked in" : "Completed";
      tbody.append(
        el(
          "tr",
          {},
          el("td", {}, row.station_name),
          el("td", {}, row.renter_business_name),
          el("td", { class: "mono" }, `${row.start}–${row.end}`),
          el("td", { class: "mono" }, `${row.actual_start ?? ""}${row.actual_start ? "–" : ""}${row.actual_end ?? ""}`),
          el("td", {}, statusWord),
          el("td", { class: "mono" }, row.overage_units > 0 ? `${row.overage_units} × 15 min · $${row.overage_usd}` : ""),
          el("td", {}, action),
        ),
      );
    }
    table.append(tbody);
  };

  body.append(el("div", { class: "shift-controls" }, blockButton, dateInput), sheetHeading, table, status);
  mount.append(frame);
  await load();
};
