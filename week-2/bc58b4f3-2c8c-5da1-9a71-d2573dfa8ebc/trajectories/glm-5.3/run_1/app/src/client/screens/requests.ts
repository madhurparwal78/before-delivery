// Requests screen: request form (schedulers) and the organisation's request list.
import { api, ApiCallError, centralToInstant, el, formatRange, parseInstant } from "../lib";
import { coveredCountText, createDrawer, formField, pollWhileConnected, seatLanes, statusRegion } from "../components";
import { App } from "../main";
import type { OrgAssignmentView, OfferAssignmentView, SeatView, StaffAssignmentView } from "../types";
import { LANGUAGES, SETTINGS } from "../types";
import { assignmentDetails, cancelDialog, changeTimeDialog, statusChip } from "./drawer";

function coveredOf(seats: SeatView[]): number {
  return seats.filter((s) => s.status !== "open").length;
}

export function renderRequests(app: App): void {
  const main = app.main;
  const drawer = createDrawer();

  // ── Request form ─────────────────────────────────────────────────────────
  let idempotencyKey = crypto.randomUUID();
  const fields = {
    language: formField({ name: "language", label: "Language", options: LANGUAGES.map((l) => ({ value: l.code, label: l.name })) }),
    setting: formField({ name: "setting", label: "Setting", options: SETTINGS.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })) }),
    date: formField({ name: "date", label: "Date", type: "date", placeholder: "YYYY-MM-DD" }),
    time: formField({ name: "time", label: "Start time", type: "time", placeholder: "HH:MM" }),
    duration: formField({ name: "duration", label: "Duration (minutes)", type: "number", min: 30, max: 480, step: 15, value: "60" }),
    street: formField({ name: "street", label: "Street address" }),
    city: formField({ name: "city", label: "City" }),
    initials: formField({ name: "initials", label: "Patient initials", placeholder: "AB" }),
    notes: formField({ name: "notes", label: "Medical notes" }),
  };

  const submitBtn = el("button", { class: "btn btn-primary", type: "submit", text: "Submit request" });
  const reqStatus = statusRegion("Request status");

  const form = el("form", { "aria-label": "Request an interpreter" },
    el("h2", { text: "Request an interpreter" }),
    fields.language.row, fields.setting.row,
    el("div", { class: "form-grid" }, fields.date.row, fields.time.row, fields.duration.row),
    fields.street.row, fields.city.row, fields.initials.row, fields.notes.row,
    reqStatus.el,
    submitBtn,
  );

  const clearFieldErrors = (): void => {
    for (const f of Object.values(fields)) f.error.textContent = "";
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submitBtn.disabled) return; // a double-click sends one request
    const date = (fields.date.input as HTMLInputElement).value;
    const time = (fields.time.input as HTMLInputElement).value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      reqStatus.set("Enter the date as YYYY-MM-DD and the time as HH:MM.");
      return;
    }
    const startAt = centralToInstant(date, Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)));
    if (Number.isNaN(startAt.getTime())) {
      reqStatus.set("Enter the date as YYYY-MM-DD and the time as HH:MM.");
      return;
    }
    const body = {
      language: (fields.language.input as HTMLSelectElement).value,
      setting: (fields.setting.input as HTMLSelectElement).value,
      start_at: startAt.toISOString(),
      duration_minutes: Number((fields.duration.input as HTMLInputElement).value),
      street_address: (fields.street.input as HTMLInputElement).value,
      city: (fields.city.input as HTMLInputElement).value,
      patient_initials: (fields.initials.input as HTMLInputElement).value,
      medical_notes: (fields.notes.input as HTMLInputElement).value,
    };
    submitBtn.disabled = true;
    reqStatus.set("Submitting…");
    try {
      const created = await api<OrgAssignmentView>("POST", "/api/assignments", body, { "Idempotency-Key": idempotencyKey });
      reqStatus.set(`Request ${created.number} submitted. Awaiting release by dispatch.`);
      form.reset();
      (fields.duration.input as HTMLInputElement).value = "60";
      idempotencyKey = crypto.randomUUID(); // a fresh key for the next request
      refresh();
    } catch (err) {
      if (err instanceof ApiCallError) {
        if (err.code === "validation") {
          reqStatus.set("Check the highlighted fields.");
          clearFieldErrors();
          const map: Record<string, HTMLDivElement> = {
            language: fields.language.error, setting: fields.setting.error, start_at: fields.time.error,
            duration_minutes: fields.duration.error, street_address: fields.street.error, city: fields.city.error,
            patient_initials: fields.initials.error, medical_notes: fields.notes.error,
          };
          for (const [field, message] of Object.entries(err.fields)) {
            (map[field] ?? reqStatus.el).textContent = message;
          }
        } else if (err.code === "idempotency_conflict") {
          reqStatus.set("This request was already submitted with different details. Reload to see it.");
        } else {
          reqStatus.set("Couldn't reach Teamseat. Your request is safe to submit again.");
        }
      } else {
        reqStatus.set("Couldn't reach Teamseat. Your request is safe to submit again.");
      }
    } finally {
      submitBtn.disabled = false;
    }
  });

  // ── Request list ─────────────────────────────────────────────────────────
  const search = formField({ name: "q", label: "Search requests", type: "search", placeholder: "Number or city" });
  search.row.querySelector("label")?.remove();
  search.input.setAttribute("aria-label", "Search requests");
  const listStatus = statusRegion("Requests list", "");
  const table = el("table", { class: "paper", "aria-label": "Requests" });
  const thead = el("thead", {}, el("tr", {},
    el("th", { text: "Number" }), el("th", { text: "Language" }), el("th", { text: "Setting" }),
    el("th", { text: "Time (Central)" }), el("th", { text: "Seats" }), el("th", { text: "Status" }), el("th", { text: "" })));
  const tbody = el("tbody");
  table.append(thead, tbody);

  let lastQuery = "";
  const openAssignment = (number: string, opener: HTMLElement): void => {
    api<OrgAssignmentView | OfferAssignmentView | StaffAssignmentView>("GET", `/api/assignments/${number}`).then((a) => {
      const content = el("div");
      if (a.seats && "street_address" in a && "cancellation" in a) {
        content.append(assignmentDetails(a as OrgAssignmentView));
        const role = app.me.role;
        if (role === "scheduler") {
          const changeable = ["draft", "released", "partially_covered", "covered"].includes(a.status);
          const cancellable = ["draft", "released", "partially_covered", "covered"].includes(a.status);
          const actions = el("div", { class: "two-col", style: "margin-top: 16px;" });
          if (changeable) {
            actions.append(el("button", {
              class: "btn", text: "Change time",
              onclick: () => { drawer.close(); changeTimeDialog(number, () => { refresh(); openAssignment(number, opener); }); },
            }));
          }
          if (cancellable) {
            actions.append(el("button", {
              class: "btn btn-danger", text: "Cancel request",
              onclick: () => { drawer.close(); cancelDialog(number, () => refresh()); },
            }));
          }
          content.append(actions);
        }
      }
      drawer.open(content, opener, `Assignment ${number}`);
    }).catch(() => {
      drawer.close();
    });
  };

  const renderRows = (assignments: OrgAssignmentView[]): void => {
    tbody.replaceChildren();
    for (const a of assignments) {
      const range = formatRangeOf(a);
      const openBtn = el("button", {
        class: "btn btn-quiet",
        text: `Open ${a.number}`,
        "aria-label": `Open ${a.number}`,
        onclick: (e: Event) => openAssignment(a.number, e.target as HTMLElement),
      });
      const tr = el("tr", {},
        el("td", { "data-label": "Number" }, el("span", { class: "num", text: a.number })),
        el("td", { "data-label": "Language", text: a.language }),
        el("td", { "data-label": "Setting", text: a.setting }),
        el("td", { "data-label": "Time", text: range }),
        el("td", { "data-label": "Seats", style: "min-width: 120px;" },
          seatLanes(a.seats),
          el("span", { class: "mono-num", style: "font-size: 0.8rem;", text: coveredCountText(coveredOf(a.seats), a.seats.length) })),
        el("td", { "data-label": "Status" }, statusChip(a.status)),
        el("td", { "data-label": "" }, openBtn),
      );
      tbody.append(tr);
    }
  };

  const formatRangeOf = (a: OrgAssignmentView | OfferAssignmentView): string =>
    formatRange(parseInstant(a.start_at)!, parseInstant(a.end_at)!);

  const refresh = (): void => {
    const q = (search.input as HTMLInputElement).value.trim();
    api<{ assignments: OrgAssignmentView[] }>("GET", `/api/assignments?q=${encodeURIComponent(q)}`).then((res) => {
      renderRows(res.assignments);
      listStatus.set("");
    }).catch(() => {
      listStatus.set("Requests not updating. Retrying…");
    });
  };

  (search.input as HTMLInputElement).addEventListener("input", () => {
    const q = (search.input as HTMLInputElement).value.trim();
    if (q !== lastQuery) {
      lastQuery = q;
      refresh();
    }
  });

  const layout = app.me.role === "scheduler"
    ? el("div", { class: "grid-12" },
        el("section", { class: "w-4" }, el("h1", { text: "Requests" }), form),
        el("section", { class: "w-8" },
          el("div", { class: "field" }, search.input),
          listStatus.el,
          el("div", { class: "board-wrap" }, table)),
      )
    : el("div", {},
        el("h1", { text: "Requests" }),
        el("div", { class: "field" }, search.input),
        listStatus.el,
        el("div", { class: "board-wrap" }, table));

  main.append(layout);
  refresh();
  pollWhileConnected(main, refresh);
}
