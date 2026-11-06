// The timing screen: running heat selector and the keyboard-first run grid.
import { api, type EventObj, type EntryObj, type RunObj } from "../api.js";
import { h, liveRegion, announce, errorMessage, Dialog, dialogTrap, fieldFor, pendingButton } from "../ui.js";
import { state, shell, eventSectionsNav } from "../client.js";

interface Draft {
  time: string;
  cones: string;
}

export async function renderTiming(eventId: string): Promise<void> {
  const content = h("div", null);
  const announceRegion = liveRegion("Timing announcements");
  content.appendChild(announceRegion);
  const body = h("div", null);
  content.appendChild(body);
  await shell(content, { eventId });
  await drawTiming(eventId, body, announceRegion);
}

interface GridModel {
  event: EventObj;
  entries: EntryObj[];
  heat: number;
  drafts: Map<string, Draft>;
  focused: { row: number; col: number } | null;
}

async function drawTiming(eventId: string, body: HTMLElement, announceRegion: HTMLElement): Promise<void> {
  const { event } = await api.get<{ event: EventObj }>(`/api/events/${eventId}`);
  const roles = state.user?.roles ?? [];
  if (!roles.includes("chair") && !roles.includes("timing")) {
    body.textContent = "";
    body.appendChild(h("p", { class: "dim", text: "The timing screen is for the timing chief." }));
    return;
  }
  const heat = event.runningHeat ?? 1;
  const { entries } = await api.get<{ entries: EntryObj[] }>(`/api/events/${eventId}/runs?heat=${heat}`);

  body.textContent = "";
  body.appendChild(eventSectionsNav(event, "timing"));

  const model: GridModel = { event, entries, heat, drafts: new Map(), focused: null };

  const header = h("div", { class: "timing-header" });
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Running heat");
  for (const hh of event.heats) {
    const option = document.createElement("option");
    option.value = String(hh.number);
    option.textContent = `Heat ${hh.number}`;
    if (hh.number === heat) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener("change", async () => {
    try {
      await api.post(`/api/events/${eventId}/running-heat`, { heat: Number(select.value) });
      await drawTiming(eventId, body, announceRegion);
    } catch (e) {
      announce(announceRegion, errorMessage(e));
    }
  });
  header.appendChild(select);
  header.appendChild(h("div", { class: "dim", text: "Alt+G jumps into the grid" }));
  body.appendChild(header);

  const gridBox = h("div", { class: "run-grid-box" });
  const grid = buildGrid(model, announceRegion, eventId, body);
  gridBox.appendChild(grid);
  body.appendChild(gridBox);

  // Alt+G from any control on this screen.
  document.addEventListener("keydown", (event) => {
    if (event.altKey && (event.key === "g" || event.key === "G")) {
      event.preventDefault();
      focusFirstPending(model, grid);
    }
  });
}

function buildGrid(model: GridModel, announceRegion: HTMLElement, eventId: string, body: HTMLElement): HTMLElement {
  const { event, entries } = model;
  const table = h("table", { class: "run-grid", role: "grid", "aria-label": "Run grid" }) as HTMLTableElement;
  const headRow = h("tr", null);
  headRow.appendChild(h("th", { text: "Car" }));
  headRow.appendChild(h("th", { text: "Class" }));
  headRow.appendChild(h("th", { text: "Driver" }));
  for (let k = 1; k <= event.runsPerDriver; k++) {
    headRow.appendChild(h("th", { class: "mono", text: `R${k} time` }));
    headRow.appendChild(h("th", { class: "mono", text: `R${k} cones` }));
  }
  table.appendChild(h("thead", null, headRow));

  const bodyRows = h("tbody", null);
  table.appendChild(bodyRows);

  entries.forEach((entry) => {
    const tr = h("tr", { role: "row" });
    if (!entry.checkedIn) tr.classList.add("not-checked-in");
    tr.appendChild(h("td", { class: "mono", text: String(entry.carNumber) }));
    tr.appendChild(h("td", { text: entry.classCode }));
    tr.appendChild(h("td", { text: entry.driverName }));
    if (!entry.checkedIn) {
      const td = h("td", { colspan: String(event.runsPerDriver * 2), text: "Not checked in" });
      tr.appendChild(td);
      bodyRows.appendChild(tr);
      return;
    }
    for (let k = 1; k <= event.runsPerDriver; k++) {
      const timeCell = h("td", { class: "time", role: "gridcell", "aria-label": `Car ${entry.carNumber} ${entry.classCode} run ${k} time`, tabindex: "-1" });
      const conesCell = h("td", { class: "cones", role: "gridcell", "aria-label": `Car ${entry.carNumber} ${entry.classCode} run ${k} cones`, tabindex: "-1" });
      paintCells(timeCell, conesCell, entry, k, model.drafts);
      bindCellKeys(model, entry, k, true, timeCell, conesCell, announceRegion, eventId, body);
      bindCellKeys(model, entry, k, false, conesCell, timeCell, announceRegion, eventId, body);
      tr.appendChild(timeCell);
      tr.appendChild(conesCell);
    }
    bodyRows.appendChild(tr);
  });
  return table;
}

function paintCells(timeCell: HTMLElement, conesCell: HTMLElement, entry: EntryObj, k: number, drafts: Map<string, Draft>): void {
  const run = entry.runs[k - 1];
  const key = draftKey(entry, k);
  const draft = drafts.get(key);
  const draftTime = draft?.time ?? "";
  const draftCones = draft?.cones ?? "";

  timeCell.textContent = "";
  conesCell.textContent = "";
  if (run.outcome === "rerun" && run.status === "rerun_granted") {
    timeCell.appendChild(h("span", { class: "dim", text: draftTime || "RRN" }));
  } else if (run.outcome === "dnf") {
    timeCell.appendChild(h("span", { class: "dnf", text: "DNF" }));
  } else if (run.rawTime) {
    timeCell.appendChild(h("span", { class: "", text: draftTime || run.rawTime }));
  } else {
    timeCell.appendChild(h("span", { class: draftTime ? "draft" : "dim", text: draftTime || "·" }));
  }
  const conesText = draftCones || (run.cones !== null && run.cones !== undefined ? String(run.cones) : "");
  conesCell.appendChild(h("span", { class: draftCones ? "draft" : "", text: conesText || "0" }));
}

function draftKey(entry: EntryObj, k: number): string {
  return `${entry.registrationId}:${k}`;
}

function bindCellKeys(
  model: GridModel,
  entry: EntryObj,
  k: number,
  isTime: boolean,
  cell: HTMLElement,
  other: HTMLElement,
  announceRegion: HTMLElement,
  eventId: string,
  body: HTMLElement,
): void {
  cell.addEventListener("keydown", async (event) => {
    const { event: ev } = model;
    const key = draftKey(entry, k);
    const run = entry.runs[k - 1];
    const committable = run.status === "pending" || run.status === "rerun_granted";

    if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      moveFocus(model, cell, entry, k, isTime, event.key);
      return;
    }
    if (event.key === "Tab") {
      // One tab stop: leaving the grid returns focus to the running-heat control.
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      model.drafts.delete(key);
      repaintAll(model, eventId, body, announceRegion);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (committable) {
        await commitRun(model, entry, k, announceRegion, eventId, body);
      } else {
        openCorrectDialog(model, entry, k, cell, announceRegion, eventId, body);
      }
      return;
    }
    if (!committable) return;

    const draft = model.drafts.get(key) ?? { time: "", cones: "" };
    if (isTime) {
      if (/^[0-9.]$/.test(event.key)) {
        event.preventDefault();
        if (draft.time.length >= 6 && event.key !== ".") return;
        draft.time += event.key;
      } else if (event.key === "Backspace") {
        event.preventDefault();
        draft.time = draft.time.slice(0, -1);
      } else if (event.key === "d" || event.key === "D") {
        event.preventDefault();
        draft.time = "DNF";
      } else if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        draft.time = "RRN";
      } else {
        return;
      }
      model.drafts.set(key, draft);
      repaintAll(model, eventId, body, announceRegion);
    } else {
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        if (draft.cones.length >= 2) return;
        draft.cones += event.key;
      } else if (event.key === "Backspace") {
        event.preventDefault();
        draft.cones = draft.cones.slice(0, -1);
      } else {
        return;
      }
      model.drafts.set(key, draft);
      repaintAll(model, eventId, body, announceRegion);
    }
    void other;
    void ev;
  });

  cell.addEventListener("focus", () => {
    cell.classList.add("focused");
  });
  cell.addEventListener("blur", () => {
    cell.classList.remove("focused");
  });
}

function moveFocus(model: GridModel, cell: HTMLElement, entry: EntryObj, k: number, isTime: boolean, keyName: string): void {
  const rows = Array.from(document.querySelectorAll<HTMLElement>("table.run-grid tbody tr"));
  const rowIndex = rows.findIndex((tr) => tr.contains(cell));
  if (rowIndex === -1) return;
  const cols = ["car", "class", "driver"];
  for (let i = 1; i <= model.event.runsPerDriver; i++) {
    cols.push(`t${i}`, `c${i}`);
  }
  const cellsInRow = Array.from(rows[rowIndex].children) as HTMLElement[];
  let colIndex = cellsInRow.indexOf(cell);
  if (keyName === "ArrowLeft") colIndex = Math.max(0, colIndex - 1);
  if (keyName === "ArrowRight") colIndex = Math.min(cellsInRow.length - 1, colIndex + 1);
  if (keyName === "Home") colIndex = 0;
  if (keyName === "End") colIndex = cellsInRow.length - 1;
  if (keyName === "ArrowUp" || keyName === "ArrowDown") {
    const targetRow = keyName === "ArrowUp" ? rows[rowIndex - 1] : rows[rowIndex + 1];
    if (!targetRow) return;
    const targetCells = Array.from(targetRow.children) as HTMLElement[];
    const focusable = targetCells[colIndex];
    if (focusable && (focusable.classList.contains("time") || focusable.classList.contains("cones"))) {
      focusable.focus();
    }
    return;
  }
  const target = cellsInRow[colIndex];
  if (target && (target.classList.contains("time") || target.classList.contains("cones"))) {
    target.focus();
  } else {
    // Car, Class and Driver cells are not focusable; skip to the nearest run cell.
    const next = cellsInRow.slice(colIndex).find((c) => c.classList.contains("time") || c.classList.contains("cones"));
    (next ?? cellsInRow[3])?.focus();
  }
  void entry; void k; void isTime; void cols;
}

function focusFirstPending(model: GridModel, grid: HTMLElement): void {
  const cells = Array.from(grid.querySelectorAll<HTMLElement>("td.time"));
  for (const cell of cells) {
    const run = runForCell(model, cell);
    if (run && (run.status === "pending" || run.status === "rerun_granted")) {
      cell.focus();
      return;
    }
  }
  cells[0]?.focus();
}

function runForCell(model: GridModel, cell: HTMLElement): RunObj | null {
  const tr = cell.closest("tr");
  if (!tr) return null;
  const rows = Array.from(document.querySelectorAll<HTMLElement>("table.run-grid tbody tr"));
  const rowIndex = rows.indexOf(tr);
  const cells = Array.from(tr.children) as HTMLElement[];
  const colIndex = cells.indexOf(cell);
  const runIndex = Math.floor((colIndex - 3) / 2);
  const entry = model.entries[rowIndex];
  return entry?.runs[runIndex] ?? null;
}

function repaintAll(model: GridModel, eventId: string, body: HTMLElement, announceRegion: HTMLElement): void {
  const rows = Array.from(document.querySelectorAll<HTMLElement>("table.run-grid tbody tr"));
  model.entries.forEach((entry, rowIndex) => {
    const tr = rows[rowIndex];
    if (!tr) return;
    const cells = Array.from(tr.children) as HTMLElement[];
    for (let k = 1; k <= model.event.runsPerDriver; k++) {
      const timeCell = cells[3 + (k - 1) * 2];
      const conesCell = cells[4 + (k - 1) * 2];
      if (timeCell && conesCell) paintCells(timeCell, conesCell, entry, k, model.drafts);
    }
  });
  void eventId; void body; void announceRegion;
}

async function commitRun(model: GridModel, entry: EntryObj, k: number, announceRegion: HTMLElement, eventId: string, body: HTMLElement): Promise<void> {
  const key = draftKey(entry, k);
  const draft = model.drafts.get(key);
  const timeDraft = draft?.time ?? "";
  if (!timeDraft) {
    announce(announceRegion, "Type a time, D for DNF or R for rerun.");
    return;
  }
  let outcome: "time" | "dnf" | "rerun";
  let payload: Record<string, unknown>;
  if (timeDraft === "DNF") {
    outcome = "dnf";
    payload = { outcome, cones: Number(draft?.cones ?? "0") || 0 };
  } else if (timeDraft === "RRN") {
    outcome = "rerun";
    payload = { outcome };
  } else {
    if (!/^\d{2,3}\.\d{3}$/.test(timeDraft)) {
      announce(announceRegion, "Run time must look like 45.123.");
      return;
    }
    outcome = "time";
    payload = { outcome, rawTime: timeDraft, cones: Number(draft?.cones ?? "0") || 0 };
  }
  const idemKey = `${entry.registrationId}:${k}:${Date.now()}`;
  try {
    const result = await api.post<{
      run: RunObj;
      entry: { position: number | null; classPosition: number | null; bestIndexed: string | null };
      rankChange: { indexed: string; class: string; raw: string };
    }>(`/api/registrations/${entry.registrationId}/runs/${k}`, payload, { "idempotency-key": idemKey });
    model.drafts.delete(key);
    announce(announceRegion, commitSentence(entry, outcome, result.entry, k));
    await drawTiming(eventId, body, announceRegion);
    focusNextRow(entry, k);
  } catch (e) {
    announce(announceRegion, errorMessage(e));
  }
}

/** The published announcement for a commit, per Feedback states. */
function commitSentence(
  entry: EntryObj,
  outcome: "time" | "dnf" | "rerun",
  position: { position: number | null; classPosition: number | null; bestIndexed: string | null },
  k: number,
): string {
  const car = `Car ${entry.carNumber} ${entry.classCode}`;
  if (outcome === "rerun") return `${car}: rerun granted for run ${k}`;
  if (outcome === "dnf") {
    if (position.position === null) return `${car}: DNF, no time yet`;
    return `${car}: DNF, P${position.classPosition} in ${entry.classCode}, P${position.position} overall`;
  }
  return `${car}: indexed ${position.bestIndexed}, P${position.classPosition} in ${entry.classCode}, P${position.position} overall`;
}

function focusNextRow(entry: EntryObj, k: number): void {
  const rows = Array.from(document.querySelectorAll<HTMLElement>("table.run-grid tbody tr"));
  const rowIndex = modelIndexOf(entry);
  const next = rows[rowIndex + 1];
  if (!next) {
    const cells = Array.from(rows[rowIndex]?.children ?? []) as HTMLElement[];
    cells[3 + (k - 1) * 2]?.focus();
    return;
  }
  const cells = Array.from(next.children) as HTMLElement[];
  cells[3 + (k - 1) * 2]?.focus();
}

function modelIndexOf(entry: EntryObj): number {
  const rows = Array.from(document.querySelectorAll<HTMLElement>("table.run-grid tbody tr"));
  return rows.findIndex((tr) => tr.textContent?.includes(entry.driverName));
}

function openCorrectDialog(
  _model: GridModel,
  entry: EntryObj,
  k: number,
  cell: HTMLElement,
  announceRegion: HTMLElement,
  eventId: string,
  body: HTMLElement,
): void {
  const run = entry.runs[k - 1];
  const dialog = new Dialog(`Correct car ${entry.carNumber} ${entry.classCode} run ${k}`, (dlg) => {
    const form = h("form", null) as HTMLFormElement;
    form.setAttribute("aria-label", `Correct car ${entry.carNumber} ${entry.classCode} run ${k}`);
    const heading = h("h2", { text: `Correct car ${entry.carNumber} ${entry.classCode} run ${k}` });
    form.appendChild(heading);

    const outcomeTime = document.createElement("input");
    outcomeTime.type = "radio";
    outcomeTime.name = "outcome";
    outcomeTime.id = "corr-time";
    const outcomeDnf = document.createElement("input");
    outcomeDnf.type = "radio";
    outcomeDnf.name = "outcome";
    outcomeDnf.id = "corr-dnf";
    if (run.outcome === "dnf") outcomeDnf.checked = true;
    else outcomeTime.checked = true;
    const outcomeRow = h("div", { class: "field" });
    const timeLabel = h("label", { for: "corr-time" });
    timeLabel.appendChild(outcomeTime);
    timeLabel.appendChild(document.createTextNode(" Time"));
    const dnfLabel = h("label", { for: "corr-dnf" });
    dnfLabel.appendChild(outcomeDnf);
    dnfLabel.appendChild(document.createTextNode(" DNF"));
    outcomeRow.appendChild(timeLabel);
    outcomeRow.appendChild(dnfLabel);
    form.appendChild(outcomeRow);

    const rawTime = document.createElement("input");
    rawTime.value = run.rawTime ?? "";
    rawTime.setAttribute("aria-label", "Raw time");
    form.appendChild(fieldFor("Raw time", rawTime));

    const cones = document.createElement("input");
    cones.type = "number";
    cones.min = "0";
    cones.max = "30";
    cones.value = String(run.cones ?? 0);
    form.appendChild(fieldFor("Cones", cones));

    const reason = document.createElement("input");
    reason.setAttribute("aria-label", "Reason");
    form.appendChild(fieldFor("Reason", reason));

    const save = h<HTMLButtonElement>("button", { class: "primary", type: "submit", text: "Save correction" });
    const cancel = h<HTMLButtonElement>("button", { type: "button", text: "Cancel", onclick: () => dlg.close() });
    form.appendChild(h("div", { class: "actions" }, save, cancel));

    form.addEventListener("submit", async (submitEvent) => {
      submitEvent.preventDefault();
      const restore = pendingButton(save, "Saving correction");
      try {
        const payload = outcomeDnf.checked
          ? { outcome: "dnf", cones: Number(cones.value) || 0, reason: reason.value }
          : { outcome: "time", rawTime: rawTime.value, cones: Number(cones.value) || 0, reason: reason.value };
        const result = await api.post<{
          entry: { position: number | null; classPosition: number | null };
          rankChange: { indexed: string };
        }>(`/api/runs/${run.id}/corrections`, payload);
        const car = `Car ${entry.carNumber} ${entry.classCode}`;
        const position = result.entry.position;
        const sentence = outcomeDnf.checked || !rawTime.value
          ? `${car} run ${k} corrected: DNF, P${result.entry.classPosition} in ${entry.classCode}, P${position} overall`
          : `${car} run ${k} corrected: indexed ${result.rankChange.indexed}, P${result.entry.classPosition} in ${entry.classCode}, P${position} overall`;
        announce(announceRegion, sentence);
        dlg.close();
        await drawTiming(eventId, body, announceRegion);
        cell.focus();
      } catch (e) {
        announce(announceRegion, errorMessage(e));
        restore();
      }
    });

    dialogTrap(dlg, form);
    return form;
  }, cell);
  dialog.open();
}
