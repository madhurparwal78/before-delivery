// The assignment drawer contents: scheduler/org/staff view with change-time and cancel actions.
import { api, ApiCallError, centralToInstant, el, formatMoney, formatRange, parseInstant, todayCentralISO } from "../lib";
import { coveredCountText, formField, openDialog, seatLanes, statusRegion } from "../components";
import type { CancellationView, OrgAssignmentView, HolderAssignmentView, SeatView } from "../types";
import { STATUS_LABELS, LANGUAGES } from "../types";

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

function statusChip(status: string): HTMLSpanElement {
  const tone =
    status === "released" || status === "partially_covered" ? "open" :
    status === "covered" ? "covered" :
    status === "cancelled" ? "cancelled" :
    status === "draft" ? "" : "done";
  return el("span", { class: "status-chip", "data-tone": tone, text: STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status });
}

function seatsSummary(seats: SeatView[]): { covered: number; total: number } {
  return { covered: seats.filter((s) => s.status !== "open").length, total: seats.length };
}

export function assignmentDetails(a: OrgAssignmentView): HTMLElement {
  const kv = el("dl", { class: "kv" });
  kv.append(
    el("dt", { text: "Language" }), el("dd", { text: languageName(a.language) }),
    el("dt", { text: "Setting" }), el("dd", { text: a.setting }),
    el("dt", { text: "Time" }), el("dd", { text: formatRange(parseInstant(a.start_at)!, parseInstant(a.end_at)!) }),
    el("dt", { text: "Street address" }), el("dd", { text: a.street_address }),
    el("dt", { text: "City" }), el("dd", { text: a.city }),
    el("dt", { text: "Patient initials" }), el("dd", { text: a.patient_initials }),
    el("dt", { text: "Medical notes" }), el("dd", { text: a.medical_notes || "—" }),
    el("dt", { text: "Requested by" }), el("dd", { text: `${a.scheduler.name} (${a.scheduler.phone})` }),
    el("dt", { text: "Duration" }), el("dd", { text: `${a.duration_minutes} min` }),
  );
  const block = el("div", {},
    statusChip(a.status),
    el("div", { style: "margin: 10px 0;", }, seatLanes(a.seats)),
    el("p", {}, coveredCountText(seatsSummary(a.seats).covered, a.seats.length)),
    kv,
  );
  if (a.cancellation) {
    const c = a.cancellation as CancellationView;
    block.append(el("p", {},
      `Cancelled. ${c.fee_applies ? `A late-cancellation fee of ${formatMoney(c.fee_cents)} applies.` : "No fee applies."}`
    ));
  }
  return block;
}

export function holderDetails(a: HolderAssignmentView): HTMLElement {
  const kv = el("dl", { class: "kv" });
  kv.append(
    el("dt", { text: "Language" }), el("dd", { text: languageName(a.language) }),
    el("dt", { text: "Setting" }), el("dd", { text: a.setting }),
    el("dt", { text: "Time" }), el("dd", { text: formatRange(parseInstant(a.start_at)!, parseInstant(a.end_at)!) }),
    el("dt", { text: "Street address" }), el("dd", { text: a.street_address }),
    el("dt", { text: "City" }), el("dd", { text: a.city }),
    el("dt", { text: "Patient initials" }), el("dd", { text: a.patient_initials }),
    el("dt", { text: "Medical notes" }), el("dd", { text: a.medical_notes || "—" }),
    el("dt", { text: "Requested by" }), el("dd", { text: `${a.scheduler.name} (${a.scheduler.phone})` }),
  );
  return el("div", {}, statusChip(a.status), el("div", { style: "margin: 10px 0;" }, seatLanes(a.seats)), kv);
}

// ── Change-time dialog ────────────────────────────────────────────────────────

export function changeTimeDialog(number: string, onDone: () => void): void {
  api<OrgAssignmentView>("GET", `/api/assignments/${number}`).then((a) => {
    const start = parseInstant(a.start_at)!;
    const fields = {
      date: formField({ name: "date", label: "Date", type: "date", value: todayCentralISO(), required: true }),
      time: formField({ name: "time", label: "Start time", type: "time", value: "09:00", required: true }),
      duration: formField({ name: "duration", label: "Duration (minutes)", type: "number", value: String(a.duration_minutes), min: 30, max: 480, step: 15, required: true }),
    };
    // Prefill in Central time.
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hour12: false }).format(start);
    fields.time.input.value = p === "24:00" ? "00:00" : p;
    fields.date.input.value = todayCentralISO(); // replaced below with the assignment's date
    const startDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(start);
    fields.date.input.value = startDate;

    const status = statusRegion("Change status");
    const dialogId = `change-${number}`;
    const content = el("form", {},
      el("h2", { id: dialogId, text: `Change time for ${number}` }),
      fields.date.row,
      fields.time.row,
      fields.duration.row,
      status.el,
      el("div", { class: "two-col" },
        el("button", { class: "btn btn-primary", type: "submit", text: "Save new time" }),
        el("button", { class: "btn btn-quiet", type: "button", text: "Keep request" }),
      ),
    );
    const dlg = openDialog(dialogId, content, () => undefined);
    (content.querySelector('button[type="button"]') as HTMLButtonElement).addEventListener("click", () => dlg.close());

    content.addEventListener("submit", async (e) => {
      e.preventDefault();
      status.set("Saving…");
      const dateValue = (fields.date.input as HTMLInputElement).value;
      const timeValue = (fields.time.input as HTMLInputElement).value;
      const durationValue = Number((fields.duration.input as HTMLInputElement).value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || !/^\d{2}:\d{2}$/.test(timeValue)) {
        status.set("Enter the date as YYYY-MM-DD and the time as HH:MM.");
        return;
      }
      const startAt = centralToInstant(dateValue, Number(timeValue.slice(0, 2)) * 60 + Number(timeValue.slice(3, 5)));
      try {
        await api<OrgAssignmentView>("PATCH", `/api/assignments/${number}`, {
          start_at: startAt.toISOString(),
          duration_minutes: durationValue,
        });
        status.set(`Request ${number} moved. Seats reopened, no fee.`);
        dlg.close();
        onDone();
      } catch (err) {
        if (err instanceof ApiCallError) {
          if (err.code === "late_change") status.set("Less than 48 business hours' notice. This request can only be cancelled now.");
          else if (err.code === "validation") status.set("Check the highlighted fields.");
          else if (err.code === "invalid_transition") status.set("This request can no longer be changed.");
          else status.set(err.message);
          for (const [field, message] of Object.entries(err.fields)) {
            const map: Record<string, HTMLDivElement> = { start_at: fields.time.error, duration_minutes: fields.duration.error };
            map[field]!.textContent = message;
          }
        } else {
          status.set("Couldn't reach Teamseat. Try again.");
        }
      }
    });
  }).catch(() => undefined);
}

// ── Cancel dialog ────────────────────────────────────────────────────────────

export function cancelDialog(number: string, onDone: () => void): void {
  const status = statusRegion("Cancellation status", "Checking fee…");
  const dialogId = `cancel-${number}`;
  const confirmBtn = el("button", { class: "btn btn-danger", type: "submit", text: "Confirm cancellation", disabled: true });
  const content = el("form", {},
    el("h2", { id: dialogId, text: `Cancel ${number}` }),
    status.el,
    el("div", { class: "two-col" }, confirmBtn,
      el("button", { class: "btn btn-quiet", type: "button", text: "Keep request" })),
  );
  const dlg = openDialog(dialogId, content, () => undefined);
  (content.querySelector('button[type="button"]') as HTMLButtonElement).addEventListener("click", () => dlg.close());

  const hoursAndMinutes = (minutes: number): string =>
    `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} m`;

  // Fetch the fee preview before Confirm becomes enabled.
  api<{ fee_applies: boolean; business_minutes_notice: number; fee_cents: number }>(
    "GET", `/api/assignments/${number}/cancellation-quote`,
  ).then((quote) => {
    status.set(quote.fee_applies
      ? `Cancelling now gives ${hoursAndMinutes(quote.business_minutes_notice)} of business-hour notice, under 48 business hours. A late-cancellation fee of ${formatMoney(quote.fee_cents)} applies.`
      : "Cancelling now gives at least 48 business hours of notice. No fee applies.");
    confirmBtn.disabled = false;
  }).catch((err) => {
    status.set(err instanceof ApiCallError && err.code === "invalid_transition"
      ? "This request can no longer be cancelled."
      : "Couldn't reach Teamseat. Try again.");
  });

  content.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (confirmBtn.disabled) return;
    status.set("Cancelling…");
    try {
      const a = await api<OrgAssignmentView>("POST", `/api/assignments/${number}/cancel`, {});
      const fee = a.cancellation?.fee_applies;
      status.set(fee ? `Request ${number} cancelled. Fee: ${formatMoney(a.cancellation!.fee_cents)}.` : `Request ${number} cancelled. No fee.`);
      dlg.close();
      onDone();
    } catch (err) {
      if (err instanceof ApiCallError && err.code === "invalid_transition") {
        status.set("This request can no longer be cancelled.");
      } else {
        status.set("Couldn't reach Teamseat. Try again.");
      }
    }
  });
}

export { statusChip, seatsSummary };
