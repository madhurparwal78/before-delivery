import { api, el, link, button, announce, type Page, register, liveRegion } from "../pages.js";
import { ApiFail, focusElement } from "../lib.js";
import { formatDay, formatMoney, formatMonth, formatOfficeTime } from "../../shared/format.js";

const boardStatus = liveRegion("board", "Board announcements");
const bookingStatus = liveRegion("booking", "Booking announcements");
const licenceStatus = liveRegion("licence", "Licence announcements");
const statementStatus = liveRegion("statement", "Statement announcements");
const rosterStatus = liveRegion("roster", "Roster announcements");
const calendarStatus = liveRegion("calendar", "Calendar announcements");

interface Option {
  id: string;
  clientCompany: string;
  date: string;
  state: string;
  rank: number | null;
}

interface DayColumn {
  date: string;
  dayState: "open" | "held" | "booked";
  options: Option[];
}

function ordinal(rank: number): string {
  return rank === 1 ? "1st" : rank === 2 ? "2nd" : "3rd";
}

async function rerender(): Promise<void> {
  const { go } = await import("../app.js");
  await go(location.pathname + location.search);
}

function dialogErrorText(dialog: HTMLElement, message: string): void {
  let region = dialog.querySelector<HTMLElement>(".dialog-problems");
  if (!region) {
    region = el("section", "problems dialog-problems");
    dialog.querySelector(".dialog-body")?.prepend(region);
  }
  region.hidden = false;
  region.textContent = `Error: ${message}`;
  region.setAttribute("tabindex", "-1");
  region.focus();
}

function copyForBoardError(fail: ApiFail): string {
  const body = fail.body as Record<string, unknown>;
  switch (fail.code) {
    case "ladder_full": return "This day already holds three options.";
    case "client_already_holds": return `${body.clientCompany || "That client"} already holds an option on this day.`;
    case "day_booked": return "This day is already booked.";
    case "option_released": return `This option was released at ${body.releasedAt || ""}.`;
    case "not_second": return "Only the 2nd option can challenge the 1st.";
    case "already_challenged": return "The 1st option is already challenged.";
    case "challenge_expired": return `The challenge deadline passed at ${body.challengeDeadline || ""}, so this option is being released.`;
    case "not_first": return "Only the 1st option can be confirmed.";
    case "already_booked": return `Not booked: ${body.bookedBy || "another booker"} confirmed this day first, at ${body.bookedAt || ""}.`;
    case "billing_unavailable": return "Billing is unreachable, so nothing was booked. The option is still 1st. Try again in a few minutes.";
    default: return "Something went wrong. Try again.";
  }
}

function makeSelect(label: string, options: Array<[string, string]>): HTMLElement {
  const wrap = el("div", "field");
  const l = el("label", undefined, label);
  const select = document.createElement("select");
  select.setAttribute("aria-label", label);
  select.id = `sel-${label.replace(/\s+/g, "-").toLowerCase()}`;
  for (const [value, text] of options) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    select.appendChild(o);
  }
  l.setAttribute("for", select.id);
  wrap.append(l, select);
  return wrap;
}

function makeInput(label: string, type: string, value = ""): HTMLElement {
  const wrap = el("div", "field");
  const l = el("label", undefined, label);
  const input = document.createElement("input");
  input.type = type;
  input.value = value;
  input.setAttribute("aria-label", label);
  input.id = `in-${label.replace(/\s+/g, "-").toLowerCase()}`;
  l.setAttribute("for", input.id);
  wrap.append(l, input);
  return wrap;
}

function selectValue(node: HTMLElement): string {
  return (node.querySelector("select") as HTMLSelectElement).value;
}

function inputValue(node: HTMLElement): string {
  return (node.querySelector("input") as HTMLInputElement).value;
}

/** Availability board: office rail, talent list, 14-day strip, keyboard and touch access. */
const boardPage: Page = {
  path: "/workspace/board",
  title: () => "Availability board",
  workspace: true,
  render: async (main, params) => {
    const office = params.get("office") === "vancouver" ? "vancouver" : "toronto";
    const talent = (await api(`/api/talent?office=${office}&state=active`)) as { talent: Array<{ id: string; slug: string; displayName: string }> };
    const selected = talent.talent.find((t) => t.slug === params.get("talent")) || talent.talent[0];
    if (!selected) {
      main.appendChild(el("p", undefined, "No talent in this office yet."));
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const ladder = (await api(`/api/talent/${selected.id}/ladder?from=${today}&days=14`)) as { days: DayColumn[] };

    main.appendChild(el("h1", undefined, `Availability for ${selected.displayName}`));

    const offices = el("nav");
    offices.setAttribute("aria-label", "Offices");
    for (const [value, label] of [["toronto", "Toronto"], ["vancouver", "Vancouver"]] as Array<[string, string]>) {
      const a = link(`/workspace/board?office=${value}`, label);
      if (value === office) a.setAttribute("aria-current", "page");
      offices.appendChild(a);
    }
    main.appendChild(offices);

    const list = el("ul");
    list.setAttribute("aria-label", "Talent");
    for (const t of talent.talent) {
      const li = el("li");
      li.appendChild(link(`/workspace/board?office=${office}&talent=${t.slug}`, t.displayName));
      list.appendChild(li);
    }
    main.appendChild(list);

    const grid = el("div");
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", `Availability for ${selected.displayName}`);
    const strip = el("div", "strip");
    grid.appendChild(strip);

    const openers: Record<string, HTMLButtonElement> = {};
    for (const day of ladder.days) {
      const dayBtn = dayButton(day);
      openers[day.date] = dayBtn;
      dayBtn.addEventListener("click", () => {
        void (async () => {
          await openDayDialog(selected, day, dayBtn);
        })();
      });
      strip.appendChild(dayBtn);
    }

    const days = Array.from(strip.querySelectorAll<HTMLButtonElement>(".day"));
    strip.addEventListener("keydown", (event) => {
      const index = days.indexOf(event.target as HTMLButtonElement);
      if (index < 0) return;
      const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -index, End: days.length - 1 - index };
      const delta = moves[event.key];
      if (delta === undefined) return;
      event.preventDefault();
      days[Math.max(0, Math.min(days.length - 1, index + delta))]?.focus();
    });

    main.appendChild(grid);
    main.appendChild(boardStatus);
    void openers;
  },
};

function dayButton(day: DayColumn): HTMLButtonElement {
  const dayBtn = document.createElement("button");
  dayBtn.className = "day";
  dayBtn.dataset.dayState = day.dayState;
  const dateText = formatDay(day.date);
  const chips = day.options.filter((o) => ["placed", "challenged", "confirmed"].includes(o.state));
  const label = day.dayState === "booked"
    ? `Booked ${day.options.find((o) => o.state === "confirmed")?.clientCompany || ""} ${dateText}`
    : `${dateText} ${chips.map((o) => `${ordinal(o.rank || 1)} ${o.clientCompany}`).join(" ") || "Open"}`;
  dayBtn.setAttribute("aria-label", label);
  dayBtn.appendChild(el("span", "day-label", dateText));
  const chipWrap = el("div", "day-chips");
  for (const option of chips) {
    const chip = el("span", "chip");
    chip.dataset.rank = String(option.rank || 1);
    chip.dataset.state = option.state === "confirmed" ? "booked" : option.state;
    chip.appendChild(el("span", "chip-rank", `${ordinal(option.rank || 1)} ${option.clientCompany}${option.state === "challenged" ? " Challenged" : ""}`));
    chipWrap.appendChild(chip);
  }
  if (day.dayState === "booked") chipWrap.appendChild(el("span", "booked-label", "Booked"));
  dayBtn.appendChild(chipWrap);
  return dayBtn;
}

async function openDayDialog(selected: { id: string; slug: string; displayName: string }, day: DayColumn, opener: HTMLElement): Promise<void> {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", `${selected.displayName}, ${formatDay(day.date)}`);
  const body = el("div", "dialog-body");
  body.appendChild(el("h2", undefined, `${selected.displayName}, ${formatDay(day.date)}`));
  const optionsList = el("ul");
  for (const option of day.options.filter((o) => ["placed", "challenged", "confirmed"].includes(o.state))) {
    const li = el("li");
    li.textContent = `${ordinal(option.rank || 1)} ${option.clientCompany}${option.state === "challenged" ? " Challenged" : ""}`;
    if (option.state !== "confirmed") {
      li.appendChild(button("Release", async () => {
        try {
          await api(`/api/options/${option.id}/release`, { body: {} });
          announce(boardStatus, `Released ${option.clientCompany}'s option.`);
          closeDialog();
          await rerender();
        } catch (err) {
          dialogErrorText(dialog, copyForBoardError(err as ApiFail));
        }
      }));
    }
    optionsList.appendChild(li);
  }
  body.appendChild(optionsList);

  const clients = (await api("/api/clients")) as { clients: Array<{ id: string; company: string }> };
  const clientSelect = makeSelect("Client", clients.clients.map((c) => [c.id, c.company]));
  const jobInput = makeInput("Job title", "text");
  const noteInput = makeInput("Note", "text");
  const holdInput = makeInput("Hold until", "datetime-local");
  const place = button("Place option", async () => {
    try {
      await api("/api/options", {
        headers: { "Idempotency-Key": `place-${selected.id}-${day.date}-${Date.now()}` },
        body: {
          talentId: selected.id,
          clientId: selectValue(clientSelect),
          date: day.date,
          jobTitle: inputValue(jobInput),
          note: inputValue(noteInput) || null,
          holdUntilLocal: inputValue(holdInput) || null,
        },
      });
      const chosen = clients.clients.find((c) => c.id === selectValue(clientSelect));
      announce(boardStatus, `Placed option for ${chosen?.company} on ${formatDay(day.date)}.`);
      closeDialog();
      await rerender();
    } catch (err) {
      dialogErrorText(dialog, copyForBoardError(err as ApiFail));
    }
  }, "primary");
  body.append(clientSelect, jobInput, noteInput, holdInput, place);

  const first = day.options.find((o) => o.rank === 1 && ["placed", "challenged"].includes(o.state));
  const second = day.options.find((o) => o.rank === 2 && o.state === "placed");
  if (first) {
    body.appendChild(button("Confirm", () => {
      void openConfirmDialog(first, day, dialog);
    }));
    if (second) {
      body.appendChild(button("Challenge", async () => {
        try {
          await api(`/api/options/${second.id}/challenge`, { body: {} });
          announce(boardStatus, `Challenged ${first.clientCompany}'s 1st option. It must be answered by ${formatOfficeTime(new Date(Date.now() + 14400 * 1000), "America/Toronto", "Toronto")}.`);
          closeDialog();
          await rerender();
        } catch (err) {
          dialogErrorText(dialog, copyForBoardError(err as ApiFail));
        }
      }));
    }
  }

  const close = button("Close", closeDialog);
  const actions = el("div", "dialog-actions");
  actions.appendChild(close);
  body.appendChild(actions);
  dialog.appendChild(body);
  document.body.appendChild(dialog);
  dialog.showModal();
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialog();
  });

  function closeDialog(): void {
    dialog.close();
    dialog.remove();
    opener.focus();
  }
}

async function openConfirmDialog(first: Option, day: DayColumn, dayDialog: HTMLDialogElement): Promise<void> {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", "Confirm booking");
  const body = el("div", "dialog-body");
  body.appendChild(el("h2", undefined, "Confirm booking"));
  const dayType = el("div");
  dayType.setAttribute("role", "radiogroup");
  dayType.setAttribute("aria-label", "Day type");
  for (const [value, label] of [["full_day", "Full day"], ["half_day", "Half day"]] as Array<[string, string]>) {
    const r = document.createElement("input");
    r.type = "radio";
    r.name = "confirm-day-type";
    r.value = value;
    r.id = `cdt-${value}`;
    r.checked = value === "full_day";
    const l = el("label", undefined, label);
    l.setAttribute("for", `cdt-${value}`);
    dayType.append(r, l);
  }
  const overtimeInput = makeInput("Overtime minutes", "number", "0");
  const usageRows = el("div", "stack");
  const addUsage = button("Add usage", () => {
    usageRows.append(
      makeSelect("Media", [["digital", "Digital"], ["print", "Print"], ["out_of_home", "Out of home"], ["broadcast", "Broadcast"]]),
      makeSelect("Territory", [["canada", "Canada"], ["north_america", "North America"], ["worldwide", "Worldwide"]]),
      makeSelect("Term", [["3", "3 months"], ["6", "6 months"], ["12", "12 months"]]),
    );
  });
  body.append(dayType, overtimeInput, addUsage, usageRows);

  const confirm = button("Confirm booking", async () => {
    try {
      const type = dialog.querySelector<HTMLInputElement>("input[name='confirm-day-type']:checked")?.value || "full_day";
      const selects = Array.from(usageRows.querySelectorAll("select"));
      const usage: Array<Record<string, unknown>> = [];
      for (let i = 0; i + 2 < selects.length + 1; i += 3) {
        if (selects[i] && selects[i + 1] && selects[i + 2]) {
          usage.push({ media: selects[i].value, territory: selects[i + 1].value, termMonths: Number(selects[i + 2].value) });
        }
      }
      const result = (await api("/api/bookings", {
        body: { options: [{ optionId: first.id, dayType: type, overtimeMinutes: Number(inputValue(overtimeInput)), usage }] },
      })) as { booking: { id: string; reference: string; talent: Array<{ displayName: string }> } };
      dayDialog.close();
      dayDialog.remove();
      dialog.close();
      dialog.remove();
      announce(boardStatus, `Booked ${result.booking.talent.map((t) => t.displayName).join(", ")} for ${first.clientCompany} on ${formatDay(day.date)}. The confirmation email is on its way.`);
      const view = link(`/workspace/bookings/${result.booking.id}`, `View booking ${result.booking.reference}`);
      document.querySelector("main")?.appendChild(view);
      focusElement(view);
    } catch (err) {
      dialogErrorText(dialog, copyForBoardError(err as ApiFail));
    }
  }, "primary");
  body.appendChild(confirm);
  dialog.appendChild(body);
  document.body.appendChild(dialog);
  dialog.showModal();
}

register(boardPage);

/** Bookings list and page. */
interface Booking {
  id: string;
  reference: string;
  state: string;
  date: string;
  clientCompany: string;
  jobTitle: string;
  rateCard: { name: string };
  lines: Array<{ label: string; amountCents: number }>;
  totalCents: number;
}

const bookingsPage: Page = {
  path: "/workspace/bookings",
  title: () => "Bookings",
  workspace: true,
  render: async (main) => {
    main.appendChild(el("h1", undefined, "Bookings"));
    const data = (await api("/api/bookings")) as { bookings: Booking[] };
    const region = el("div", "scroll-region");
    region.setAttribute("role", "region");
    region.setAttribute("aria-label", "Bookings");
    const table = el("table");
    table.setAttribute("aria-label", "Bookings");
    const thead = el("thead");
    const headRow = el("tr");
    for (const label of ["Reference", "Day", "Client", "Job", "State", "Total"]) headRow.appendChild(el("th", undefined, label));
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = el("tbody");
    for (const booking of data.bookings) {
      const row = el("tr");
      const refCell = el("td");
      const ref = link(`/workspace/bookings/${booking.id}`, booking.reference);
      refCell.appendChild(ref);
      row.append(refCell, el("td", undefined, formatDay(booking.date)), el("td", undefined, booking.clientCompany), el("td", undefined, booking.jobTitle), el("td", undefined, booking.state), el("td", undefined, formatMoney(booking.totalCents)));
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    region.appendChild(table);
    main.appendChild(region);
  },
};

register(bookingsPage);

const bookingPage: Page = {
  path: "/workspace/bookings/:id",
  title: () => "Booking",
  workspace: true,
  render: async (main) => {
    const id = location.pathname.split("/")[3];
    const data = (await api(`/api/bookings/${id}`)) as { booking: Booking };
    const booking = data.booking;
    main.appendChild(el("h1", undefined, booking.reference));
    const state = el("p", "state-text", booking.state === "invoiced" ? "Invoiced" : booking.state === "corrected" ? "Corrected" : "Confirmed");
    main.appendChild(state);
    main.appendChild(el("p", undefined, `${booking.clientCompany} · ${formatDay(booking.date)} · ${booking.jobTitle}`));
    main.appendChild(el("p", undefined, `Rate card: ${booking.rateCard.name}`));
    const region = el("div", "scroll-region");
    region.setAttribute("role", "region");
    region.setAttribute("aria-label", "Fee lines");
    const table = el("table");
    table.setAttribute("aria-label", "Fee lines");
    const thead = el("thead");
    const headRow = el("tr");
    for (const label of ["Line", "Amount"]) headRow.appendChild(el("th", undefined, label));
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = el("tbody");
    for (const line of booking.lines) {
      const row = el("tr");
      row.append(el("td", undefined, line.label), el("td", undefined, formatMoney(line.amountCents)));
      tbody.appendChild(row);
    }
    const totalRow = el("tr");
    totalRow.append(el("td", undefined, "Total"), el("td", undefined, formatMoney(booking.totalCents)));
    tbody.appendChild(totalRow);
    table.appendChild(tbody);
    region.appendChild(table);
    main.appendChild(region);
    const issue = button("Issue invoice", async () => {
      issue.textContent = "Issuing invoice…";
      issue.disabled = true;
      try {
        await api(`/api/bookings/${id}/issue`, { body: {} });
        state.textContent = "Invoiced";
        announce(bookingStatus, "Invoice issued in billing.");
        focusElement(state);
      } catch (err) {
        const fail = err as ApiFail;
        issue.textContent = "Issue invoice";
        issue.disabled = false;
        announce(bookingStatus, fail.code === "already_invoiced"
          ? `This invoice was already issued by ${(fail.body.issuedBy as string) || "another member"}.`
          : "Billing is unreachable, so nothing was saved. Try again in a few minutes.");
      }
    }, "primary");
    main.appendChild(issue);
    main.appendChild(bookingStatus);
  },
};

register(bookingPage);

/** Licences with tiles, table, extend and record dialogs. */
const licencesPage: Page = {
  path: "/workspace/licences",
  title: () => "Licences",
  workspace: true,
  render: async (main) => {
    main.appendChild(el("h1", undefined, "Licences"));
    const data = (await api("/api/licences")) as {
      counts: { active: number; expiring: number; expired: number };
      licences: Array<{ id: string; talentDisplayName: string; clientCompany: string; media: string; endsOn: string; status: string; version: number; monthlyFeeCents: number }>;
    };
    const tiles = el("div", "tiles");
    for (const [key, label] of [["active", "Active"], ["expiring", "Expiring"], ["expired", "Expired"]] as Array<[string, string]>) {
      const count = data.counts[key as "active" | "expiring" | "expired"];
      const tile = el("div", "tile");
      tile.append(el("p", "tile-label", `${label} ${count}`), el("p", "tile-count", String(count)));
      tiles.appendChild(tile);
    }
    main.appendChild(tiles);

    const table = el("table");
    table.setAttribute("aria-label", "Licences");
    const thead = el("thead");
    const headRow = el("tr");
    for (const label of ["Talent", "Client", "Media", "Ends", "Status", "Monthly fee", ""]) headRow.appendChild(el("th", undefined, label));
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = el("tbody");
    for (const licence of data.licences) {
      const row = el("tr");
      row.append(
        el("td", undefined, licence.talentDisplayName),
        el("td", undefined, licence.clientCompany),
        el("td", undefined, licence.media),
        el("td", undefined, formatDay(licence.endsOn)),
        el("td", undefined, licence.status),
        el("td", undefined, formatMoney(licence.monthlyFeeCents)),
      );
      const actionCell = el("td");
      actionCell.appendChild(button("Extend", () => {
        void openExtendDialog(licence);
      }));
      row.appendChild(actionCell);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    main.appendChild(table);
    main.appendChild(button("Record licence", () => {
      void openRecordDialog();
    }, "primary"));
    main.appendChild(licenceStatus);

    async function openExtendDialog(licence: { id: string; version: number; talentDisplayName: string }): Promise<void> {
      const dialog = document.createElement("dialog");
      dialog.setAttribute("aria-label", "Extend licence");
      const body = el("div", "dialog-body");
      body.appendChild(el("h2", undefined, "Extend licence"));
      const months = makeInput("Months", "number", "3");
      const extend = button("Extend licence", async () => {
        extend.textContent = "Extending licence…";
        try {
          await api(`/api/licences/${licence.id}/extensions`, {
            headers: { "Idempotency-Key": `ext-${licence.id}-${Date.now()}` },
            body: { months: Number(inputValue(months)), version: licence.version },
          });
          dialog.close();
          dialog.remove();
          announce(licenceStatus, `Extended ${licence.talentDisplayName}'s licence by ${inputValue(months)} months.`);
          await rerender();
        } catch (err) {
          const fail = err as ApiFail;
          extend.textContent = "Extend licence";
          dialogErrorText(dialog, fail.code === "stale_version"
            ? `${fail.body.savedBy} extended this licence at ${fail.body.savedAt}. Check the new end date before extending again.`
            : "Billing is unreachable, so nothing was saved. Try again in a few minutes.");
        }
      }, "primary");
      body.append(months, extend);
      dialog.appendChild(body);
      document.body.appendChild(dialog);
      dialog.showModal();
    }

    async function openRecordDialog(): Promise<void> {
      const clients = (await api("/api/clients")) as { clients: Array<{ id: string; company: string }> };
      const talent = (await api("/api/talent")) as { talent: Array<{ id: string; displayName: string }> };
      const dialog = document.createElement("dialog");
      dialog.setAttribute("aria-label", "Record licence");
      const body = el("div", "dialog-body");
      body.appendChild(el("h2", undefined, "Record licence"));
      const clientSelect = makeSelect("Client", clients.clients.map((c) => [c.id, c.company]));
      const talentSelect = makeSelect("Talent", talent.talent.map((t) => [t.id, t.displayName]));
      const mediaSelect = makeSelect("Media", [["digital", "Digital"], ["print", "Print"], ["out_of_home", "Out of home"], ["broadcast", "Broadcast"]]);
      const territorySelect = makeSelect("Territory", [["canada", "Canada"], ["north_america", "North America"], ["worldwide", "Worldwide"]]);
      const firstUse = makeInput("First use date", "date");
      const months = makeInput("Months", "number", "1");
      const fee = makeInput("Monthly fee (cents)", "number", "45000");
      const save = button("Save licence", async () => {
        save.textContent = "Recording licence…";
        try {
          await api("/api/licences", {
            body: {
              clientId: selectValue(clientSelect),
              talentId: selectValue(talentSelect),
              media: selectValue(mediaSelect),
              territory: selectValue(territorySelect),
              firstUseDate: inputValue(firstUse),
              termMonths: Number(inputValue(months)),
              monthlyFeeCents: Number(inputValue(fee)),
            },
          });
          dialog.close();
          dialog.remove();
          await rerender();
        } catch {
          save.textContent = "Save licence";
        }
      }, "primary");
      body.append(clientSelect, talentSelect, mediaSelect, territorySelect, firstUse, months, fee, save);
      dialog.appendChild(body);
      document.body.appendChild(dialog);
      dialog.showModal();
    }
  },
};

register(licencesPage);

/** Statements: lines, reversal, advance, CSV export. */
const statementPage: Page = {
  path: "/workspace/statements/:talentId/:month",
  title: () => "Statement",
  workspace: true,
  render: async (main) => {
    const parts = location.pathname.split("/");
    const talentId = parts[3];
    const month = (parts[4] || new Date().toISOString().slice(0, 7)).replace(/\.csv$/, "");
    const data = (await api(`/api/talent/${talentId}/statements/${month}`)) as {
      displayName: string;
      openingBalanceCents: number;
      closingBalanceCents: number;
      totals: { netCents: number };
      lines: Array<{ movementId: string; officeDate: string; kind: string; reference: string; client: string; description: string; amountCents: number; balanceCents: number }>;
    };
    main.appendChild(el("h1", undefined, `Statement for ${formatMonth(month)}`));
    main.appendChild(el("p", undefined, `${data.displayName} · Opening ${formatMoney(data.openingBalanceCents)} · Closing ${formatMoney(data.closingBalanceCents)} · Net ${formatMoney(data.totals.netCents)}`));
    const region = el("div", "table-pin");
    region.setAttribute("role", "region");
    region.setAttribute("aria-label", "Statement lines");
    const table = el("table");
    table.setAttribute("aria-label", "Statement");
    const thead = el("thead");
    const headRow = el("tr");
    for (const label of ["Date", "Type", "Reference", "Client", "Description", "Amount", "Balance", ""]) headRow.appendChild(el("th", undefined, label));
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = el("tbody");
    for (const line of data.lines) {
      const row = el("tr");
      row.dataset.movement = line.movementId;
      row.append(
        el("td", undefined, formatDay(line.officeDate)),
        el("td", undefined, line.kind === "booking" ? "Booking" : line.kind === "advance" ? "Advance" : "Reversal"),
        el("td", undefined, line.reference),
        el("td", undefined, line.client),
        el("td", undefined, line.description),
        el("td", undefined, formatMoney(line.amountCents)),
        el("td", undefined, formatMoney(line.balanceCents)),
      );
      const actionCell = el("td");
      actionCell.appendChild(button("Reverse", () => {
        void openReverseDialog(line.movementId);
      }));
      row.appendChild(actionCell);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    region.appendChild(table);
    main.appendChild(region);
    main.appendChild(button("Record advance", () => {
      void openAdvanceDialog(talentId);
    }));
    const exportCsv = button("Export CSV", async () => {
      exportCsv.textContent = "Preparing export…";
      exportCsv.disabled = true;
      try {
        const res = await fetch(`/api/talent/${talentId}/statements/${month}.csv`);
        if (!res.ok) throw new Error("failed");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `statement-${month}.csv`;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
        announce(statementStatus, `Statement for ${formatMonth(month)} downloaded.`);
      } catch {
        announce(statementStatus, "Photo storage is unreachable, so nothing was saved. Try again in a few minutes.");
      } finally {
        exportCsv.textContent = "Export CSV";
        exportCsv.disabled = false;
      }
    });
    main.append(exportCsv, statementStatus);

    async function openReverseDialog(movementId: string): Promise<void> {
      const dialog = document.createElement("dialog");
      dialog.setAttribute("aria-label", "Reverse entry");
      const body = el("div", "dialog-body");
      body.appendChild(el("h2", undefined, "Reverse entry"));
      const reason = makeInput("Reason", "text");
      const reverse = button("Reverse entry", async () => {
        reverse.textContent = "Reversing…";
        try {
          const result = (await api(`/api/ledger/movements/${movementId}/reversal`, { body: { reason: inputValue(reason) } })) as { movement: { id: string } };
          dialog.close();
          dialog.remove();
          announce(statementStatus, "Reversed. The balance has been updated.");
          const row = document.querySelector(`tr[data-movement="${result.movement.id}"] td`);
          focusElement(row as HTMLElement);
          await rerender();
        } catch (err) {
          const fail = err as ApiFail;
          reverse.textContent = "Reverse entry";
          announce(statementStatus, fail.code === "already_reversed" ? "This entry was already reversed." : "Something went wrong. Try again.");
        }
      }, "primary");
      body.append(reason, reverse);
      dialog.appendChild(body);
      document.body.appendChild(dialog);
      dialog.showModal();
    }

    async function openAdvanceDialog(talentId2: string): Promise<void> {
      const dialog = document.createElement("dialog");
      dialog.setAttribute("aria-label", "Record advance");
      const body = el("div", "dialog-body");
      body.appendChild(el("h2", undefined, "Record advance"));
      const amount = makeInput("Amount (cents)", "number");
      const note = makeInput("Note", "text");
      const save = button("Save advance", async () => {
        save.textContent = "Saving advance…";
        const amountValue = Number(inputValue(amount));
        try {
          const result = (await api(`/api/talent/${talentId2}/advances`, { body: { amountCents: amountValue, note: inputValue(note) } })) as { movement: { id: string } };
          dialog.close();
          dialog.remove();
          announce(statementStatus, `Recorded an advance of ${formatMoney(amountValue)}.`);
          const row = document.querySelector(`tr[data-movement="${result.movement.id}"] td`);
          focusElement(row as HTMLElement);
          await rerender();
        } catch (err) {
          const fail = err as ApiFail;
          save.textContent = "Save advance";
          if (fail.status === 422) dialogErrorText(dialog, "Enter an amount.");
        }
      }, "primary");
      body.append(amount, note, save);
      dialog.appendChild(body);
      document.body.appendChild(dialog);
      dialog.showModal();
    }
  },
};

register(statementPage);

export { rosterStatus, calendarStatus, rerender, dialogErrorText, makeSelect, makeInput };


export function registerWorkspacePages(): void {
  // pages register themselves at module load
}
