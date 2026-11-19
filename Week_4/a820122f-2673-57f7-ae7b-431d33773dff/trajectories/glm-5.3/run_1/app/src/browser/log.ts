import { apiJson, el, restText, ApiError } from "./api.js";
import { readQueue, enqueue, sendQueue, type QueuedEntry } from "./queue.js";
import { cacheDay, readCachedDay } from "./day-cache.js";
import { openDialog, firstFieldError } from "./dialogs.js";

interface DayCell { start_utc: string; ship_time: string; repeated: boolean; state: "not_logged" | "rest" | "work" | "short_break" | "late" }
interface DayView {
  ship_date: string;
  state: "open" | "closed" | "signed" | "countersigned";
  closes_at_utc: string;
  can_edit: boolean;
  server_now_utc: string;
  start_utc: string;
  end_utc: string;
  cell_count: number;
  cells: DayCell[];
  rest_hours: number;
  entries: { entry_key: string; late: boolean; applied: boolean }[];
  notes: { id: string; text: string; author_role: string; created_at_utc: string; event_id: string | null }[];
  events: { id: string; kind: string; start_utc: string; end_utc: string; description: string; mismatch: boolean }[];
  signed_at_utc: string | null;
  countersigned_at_utc: string | null;
}
interface Rolling { rest_hours_24: number; rest_hours_168: number }
interface MonthInfo { month: string; state: "open" | "awaiting_archive" | "sealed" }

const CELL_STATE_NAME: Record<DayCell["state"], string> = {
  not_logged: "Not logged",
  rest: "Rest",
  work: "Work",
  short_break: "Rest under one hour",
  late: "Rest under one hour",
};

/** `/log` — the crew member's watch grid for one ship's day. */
export async function renderLog(dateParam?: string): Promise<void> {
  document.title = "Today's log — Sixbell Rest Log";
  const app = document.getElementById("app")!;
  app.textContent = "";

  let me: { id: string; name: string; today_ship_date: string | null; vessel_id: string };
  try {
    me = await apiJson<{ id: string; name: string; today_ship_date: string | null; vessel_id: string }>("/api/me");
    localStorage.setItem("sixbell-me", JSON.stringify(me));
  } catch {
    const stored = localStorage.getItem("sixbell-me");
    if (!stored) throw new Error("offline with no identity");
    me = JSON.parse(stored) as typeof me;
  }
  const shipDate = dateParam ?? me.today_ship_date ?? "";

  const heading = el("h1", {}, `Ship's day ${shipDate}`);
  const signOut = el("button", { type: "button" }, "Sign out");
  signOut.addEventListener("click", async () => {
    await fetch("/api/session", { method: "DELETE" });
    window.location.assign("/");
  });

  const connection = el("p", { class: "status banner", role: "status", "aria-live": "polite", "aria-label": "Connection" });
  const syncStatus = el("p", { class: "status", role: "status", "aria-live": "polite", "aria-label": "Sync status" });
  const dayStatus = el("p", { class: "status", role: "status", "aria-live": "polite", "aria-label": "Day status" });

  const gridPane = el("section", { class: "pane", "aria-label": "Watch grid" },
    el("span", { class: "pane-label" }, "Watch grid"));
  const grid = el("div", { class: "watch-grid", role: "grid", "aria-label": "Watch grid" });
  gridPane.append(grid);
  const shortBreakHint = el("p", { class: "small muted" });
  const lateBadge = el("span", { class: "late-badge" }, "Late entry");

  const totalsPane = el("section", { class: "pane", role: "region", "aria-label": "Rolling totals" },
    el("span", { class: "pane-label" }, "Rolling totals"));
  const totals24 = el("p", {}, "");
  const totals168 = el("p", {}, "");
  totalsPane.append(totals24, totals168);

  const prevButton = el("button", { type: "button" }, "Previous ship's day");
  const nextButton = el("button", { type: "button" }, "Next ship's day");
  const myVoyage = el("a", { href: `/voyage/${me.vessel_id}/${me.id}`, class: "button" }, "My voyage");

  const signButton = el("button", { type: "button" }, "Sign this day");
  const noteButton = el("button", { type: "button" }, "Add a note");
  const downloadCopy = el("a", { class: "button" }, "Download my copy");
  downloadCopy.style.display = "none";
  const monthStatus = el("p", { class: "status", role: "status", "aria-live": "polite", "aria-label": "Month status" });

  const notesList = el("ul", { class: "small" });
  const notices = el("div");

  app.append(el("header", {}, heading, signOut),
    connection, syncStatus, dayStatus,
    gridPane, shortBreakHint, lateBadge,
    el("div", { class: "two-col" },
      el("div", {}, totalsPane),
      el("div", {}, el("h3", {}, "Notes"), notesList, notices)),
    el("div", {}, prevButton, nextButton, myVoyage),
    el("div", {}, signButton, noteButton, downloadCopy),
    monthStatus);

  let currentDay: DayView | null = null;
  let offline = !navigator.onLine;
  const queuedKeys = new Set<string>();

  updateConnectionBanner();
  window.addEventListener("online", () => {
    offline = false;
    updateConnectionBanner();
    sendQueue();
  });
  window.addEventListener("offline", () => {
    offline = true;
    updateConnectionBanner();
  });
  window.addEventListener("sixbell:synced", ((event: CustomEvent) => {
    const detail = event.detail as { results: { outcome: string; entry: { late: boolean } | null }[] };
    const late = detail.results.filter((r) => r.outcome === "late" && r.entry?.late).length;
    syncStatus.textContent = `Synced ${detail.results.length} entries.` + (late > 0 ? ` ${late} marked Late entry.` : "");
    // The queue is empty once the server has taken every entry.
    offline = !navigator.onLine;
    updateConnectionBanner();
    void refresh();
  }) as EventListener);

  function updateConnectionBanner(): void {
    const queue = readQueue();
    if (offline || queue.length > 0) {
      connection.textContent = `Logging on board. Entries will sync when the ship reconnects. ${queue.length} queued`;
    } else {
      connection.textContent = "";
      connection.classList.remove("banner");
      return;
    }
    connection.classList.add("banner");
  }

  async function refresh(): Promise<void> {
    try {
      currentDay = await apiJson<DayView>(`/api/crew/${me.id}/days/${shipDate}`);
      cacheDay(shipDate, currentDay);
      renderDay(currentDay);
      const rolling = await apiJson<Rolling>(`/api/crew/${me.id}/rolling`);
      totals24.textContent = `${restText(rolling.rest_hours_24)} hours in the last 24 hours`;
      totals168.textContent = `${restText(rolling.rest_hours_168)} hours in the last 7 days`;
      const month = await apiJson<MonthInfo>(`/api/crew/${me.id}/months/${shipDate.slice(0, 7)}`);
      renderMonth(month);
    } catch {
      offline = offline || !navigator.onLine;
      const cached = readCachedDay(shipDate);
      if (cached) {
        currentDay = cached as DayView;
        renderDay(currentDay);
      }
      updateConnectionBanner();
    }
  }

  function renderDay(day: DayView): void {
    grid.textContent = "";
    const editable = day.can_edit;
    day.cells.forEach((cell, index) => {
      const name = `${cell.ship_time.slice(11)} ${cellStateName(cell)}${cell.repeated ? " repeated" : ""}`;
      const cellEl = el("div", {
        class: "gridcell",
        role: "gridcell",
        tabindex: editable ? "0" : null,
        "data-state": cell.state,
        "data-index": String(index),
        "aria-label": name,
      }, cell.ship_time.slice(11, 16));
      if (!editable) cellEl.setAttribute("aria-disabled", "true");
      grid.append(cellEl);
    });
    grid.setAttribute("role", "grid");
    heading.textContent = `Ship's day ${day.ship_date}`;
    dayStatus.textContent = dayStatusLabel(day);
    shortBreakHint.textContent = day.cells.some((c) => c.state === "short_break")
      ? "Breaks under one hour do not count as rest."
      : "";
    lateBadge.style.display = day.entries.some((e) => e.late) ? "inline-block" : "none";

    notesList.textContent = "";
    for (const note of day.notes) {
      notesList.append(el("li", {}, `${note.created_at_utc} — ${note.text}`));
    }
    notices.textContent = "";
    for (const event of day.events) {
      if (!event.mismatch) continue;
      const notice = el("p", { class: "mismatch" },
        "Record mismatch: a drill or call-out overlaps hours logged as rest. Add a note to explain it.");
      const mismatchNote = el("button", { type: "button" }, "Add a note to this mismatch");
      mismatchNote.addEventListener("click", () => openNoteDialog(mismatchNote, event.id));
      notice.append(el("br"), mismatchNote);
      notices.append(notice);
    }
    setSignButtonState(day);
  }

  function cellStateName(cell: DayCell): string {
    if (cell.state === "late") return "Rest under one hour";
    return CELL_STATE_NAME[cell.state];
  }

  function dayStatusLabel(day: DayView): string {
    const label = { open: "Open", closed: "Closed", signed: "Signed", countersigned: "Countersigned" }[day.state];
    if (day.state === "open") {
      return `Open — you can edit this ship's day until ${day.closes_at_utc}.`;
    }
    if (day.state === "closed") return "Closed — this ship's day has closed.";
    return label;
  }

  function setSignButtonState(day: DayView): void {
    const queueLength = readQueue().length;
    if (offline || queueLength > 0) {
      signButton.setAttribute("aria-disabled", "true");
      noteButton.setAttribute("aria-disabled", "true");
      downloadCopy.setAttribute("aria-disabled", "true");
    } else {
      signButton.removeAttribute("aria-disabled");
      noteButton.removeAttribute("aria-disabled");
      downloadCopy.removeAttribute("aria-disabled");
    }
  }

  function renderMonth(month: MonthInfo): void {
    const label = { open: "Open", awaiting_archive: "Awaiting archive", sealed: "Sealed" }[month.state];
    monthStatus.textContent = `Month ${month.month}: ${label}.`;
    if (month.state === "sealed") {
      downloadCopy.style.display = "inline-block";
      downloadCopy.setAttribute("href", `/api/crew/${me.id}/months/${month.month}/copy.pdf`);
    } else {
      downloadCopy.style.display = "none";
    }
  }

  function openNoteDialog(opener: HTMLElement, eventId?: string): void {
    if (offline) {
      dayStatus.textContent = "Notes need a connection.";
      return;
    }
    openDialog({
      label: "Add a note",
      fields: [{ name: "note", type: "textarea" }],
      submitLabel: "Save note",
    }, opener, async (values) => {
      if (!values.note || values.note.trim().length === 0) return "Write a note first.";
      dayStatus.textContent = "Saving note.";
      try {
        await apiJson(`/api/crew/${me.id}/days/${shipDate}/notes`, {
          method: "POST",
          body: JSON.stringify({ text: values.note, ...(eventId ? { event_id: eventId } : {}) }),
        });
        dayStatus.textContent = "Note saved.";
        await refresh();
        return;
      } catch (error) {
        dayStatus.textContent = firstFieldError(error);
        return firstFieldError(error);
      }
    });
  }

  noteButton.addEventListener("click", () => openNoteDialog(noteButton));

  downloadCopy.addEventListener("click", (event) => {
    if (offline) {
      event.preventDefault();
      dayStatus.textContent = "Downloading needs a connection.";
    }
  });

  signButton.addEventListener("click", () => {
    if (offline || readQueue().length > 0) {
      dayStatus.textContent = "Signing needs a connection.";
      return;
    }
    openDialog({
      label: "Sign this day",
      fields: [],
      submitLabel: "Confirm signature",
      text: `By signing you confirm these are your hours for ${shipDate}.`,
      confirmOnly: true,
    }, signButton, async () => {
      dayStatus.textContent = "Signing.";
      try {
        await apiJson(`/api/crew/${me.id}/days/sign`, {
          method: "POST",
          body: JSON.stringify({ ship_dates: [shipDate] }),
        });
        dayStatus.textContent = "Signed.";
        await refresh();
        return;
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.code === "day_not_closed") dayStatus.textContent = "This ship's day is still open, so it cannot be signed yet.";
          else dayStatus.textContent = firstFieldError(error);
        }
        return firstFieldError(error);
      }
    });
  });

  prevButton.addEventListener("click", () => {
    window.location.assign(`/log?date=${addDay(shipDate, -1)}`);
  });
  nextButton.addEventListener("click", () => {
    window.location.assign(`/log?date=${addDay(shipDate, 1)}`);
  });

  // Grid keyboard and pointer interaction.
  grid.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    if (!target.classList.contains("gridcell")) return;
    const cells = Array.from(grid.querySelectorAll<HTMLElement>(".gridcell"));
    const index = cells.indexOf(target);
    if (index < 0) return;
    let nextIndex: number | null = null;
    switch (event.key) {
      case "ArrowLeft": nextIndex = index - 1; break;
      case "ArrowRight": nextIndex = index + 1; break;
      case "ArrowUp": nextIndex = index - 6; break;
      case "ArrowDown": nextIndex = index + 6; break;
      case " ": case "Enter": {
        event.preventDefault();
        flipCell(target);
        return;
      }
      case "r": case "R": event.preventDefault(); setCell(target, "rest"); return;
      case "w": case "W": event.preventDefault(); setCell(target, "work"); return;
      default: return;
    }
    event.preventDefault();
    if (nextIndex !== null && nextIndex >= 0 && nextIndex < cells.length) {
      cells[nextIndex]!.focus();
    }
  });

  function cellIndex(el: HTMLElement): number {
    return Number(el.getAttribute("data-index"));
  }

  function flipCell(cellEl: HTMLElement): void {
    if (!currentDay || !currentDay.can_edit) return;
    const cell = currentDay.cells[cellIndex(cellEl)]!;
    if (cell.state === "not_logged") setCell(cellEl, "rest");
    else if (cell.state === "rest" || cell.state === "short_break" || cell.state === "late") setCell(cellEl, "work");
    else setCell(cellEl, "rest");
  }

  function setCell(cellEl: HTMLElement, kind: "rest" | "work"): void {
    if (!currentDay || !currentDay.can_edit) return;
    const cell = currentDay.cells[cellIndex(cellEl)]!;
    const currentState = cell.state;
    const alreadySame = (kind === "rest" && (currentState === "rest" || currentState === "short_break" || currentState === "late"))
      || (kind === "work" && currentState === "work");
    if (alreadySame) return;
    cellEl.setAttribute("data-state", kind);
    cellEl.setAttribute("aria-label", `${cell.ship_time.slice(11)} ${kind === "rest" ? "Rest" : "Work"}${cell.repeated ? " repeated" : ""}`);
    saveEntry([{ start: cell.start_utc, kind }]);
  }

  interface PendingSave { start: string; kind: "rest" | "work" }

  async function saveEntry(cellsToSave: PendingSave[]): Promise<void> {
    const entries: QueuedEntry[] = cellsToSave.map((cell, i) => ({
      entry_key: `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${i}`,
      start_utc: cell.start,
      end_utc: addHalfHour(cell.start),
      kind: cell.kind,
    }));
    syncStatus.textContent = "Saving.";
    try {
      if (offline) throw new TypeError("offline");
      await apiJson("/api/watch-entries", {
        method: "POST",
        body: JSON.stringify(entries[0]),
      });
      syncStatus.textContent = "Saved.";
      await refresh();
    } catch (error) {
      if (error instanceof ApiError && (error.code === "day_closed" || error.code === "month_sealed")) {
        syncStatus.textContent = "This ship's day has closed, so the server did not save that entry.";
        await refresh();
        return;
      }
      offline = true;
      for (const entry of entries) {
        enqueue(entry);
        queuedKeys.add(entry.entry_key);
      }
      updateConnectionBanner();
      syncStatus.textContent = "Queued.";
    }
  }

  // Pointer painting: press paints, drag paints all cells with the first state.
  let painting = false;
  let paintKind: "rest" | "work" | null = null;
  grid.addEventListener("pointerdown", (event) => {
    const cellEl = event.target as HTMLElement;
    if (!cellEl.classList.contains("gridcell")) return;
    if (!currentDay?.can_edit) return;
    event.preventDefault();
    painting = true;
    grid.setPointerCapture(event.pointerId);
    const cell = currentDay.cells[cellIndex(cellEl)]!;
    paintKind = cell.state === "not_logged" ? "rest"
      : cell.state === "work" ? "rest" : "work";
    setCell(cellEl, paintKind);
  });
  grid.addEventListener("pointermove", (event) => {
    if (!painting || !paintKind) return;
    const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    if (target?.classList?.contains("gridcell")) {
      event.preventDefault();
      setCell(target, paintKind);
    }
  });
  grid.addEventListener("pointerup", () => {
    painting = false;
    paintKind = null;
  });

  void refresh();
  window.setInterval(() => void refresh(), 60_000);
  window.setInterval(() => {
    if (!offline && readQueue().length > 0) sendQueue();
  }, 15_000);
  if (readQueue().length > 0 && !offline) sendQueue();
}

function addDay(shipDate: string, days: number): string {
  const ms = Date.parse(`${shipDate}T00:00:00Z`);
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

function addHalfHour(startUtc: string): string {
  const ms = Date.parse(startUtc);
  return new Date(ms + 30 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}
