// The calendar screen: toolbar, rail and grid, with the one live connection
// keeping every open screen in step.

import { ApiError, api, type EventRecord } from "./api";
import { mainNavigation, openGoToDate, openNotices, openShortcuts, reminderRegions } from "./chrome";
import { ThreeClocks, clocksFor } from "./clocks";
import { clear, el, layout, on, queryAll } from "./dom";
import { closeAllDialogs, dialogOpen, scopeDialog } from "./dialogs";
import { draftFromEvent, emptyDraft, openEventDialog, restoreDraft } from "./eventdialog";
import {
  DAY_HEIGHT,
  SLOT_HEIGHT,
  buildMonthGrid,
  buildSchedule,
  buildTimeGrid,
  blockName,
  restoreScheduleAnchor,
  scheduleAnchor,
  timeLabel,
  type GridHandles,
} from "./gridview";
import { displayWall, occurrenceID } from "./layout";
import { keyboardMove, openQuickDialog, startDrag, zoneWarningText } from "./interact";
import { onLive, type EventChange } from "./live";
import { go, readAddress, setParams } from "./router";
import {
  announce,
  changed,
  defaultCalendars,
  editableCalendars,
  state,
  subscribe,
  todayHere,
  viewerZone,
} from "./state";
import {
  addDays,
  addMonths,
  daysBetween,
  monthName,
  parseLocal,
  readableDate,
  serverClock,
  startOfWeek,
  wallDate,
} from "./time";
import { clearUndo, offerUndo, restoreFromTrash, runUndo, undoButton } from "./undo";
import { openDialog } from "./dialogs";

type View = "day" | "week" | "month" | "custom" | "schedule";

let grid: GridHandles | null = null;
let shown: EventRecord[] = [];
let focusedSlot: { date: string; minutes: number } | null = null;
let scopeMemory: { id: string; scope: string } | null = null;
let unsubscribers: (() => void)[] = [];
let scrollTop = -1;
let rendered: { view: View; date: string; calendars: string; event: string | null } | null = null;
let screenKeysAttached = false;

function phone(): boolean {
  return layout() === "phone";
}

/** currentView gives the view the address asks for, held to what this layout
 *  offers. */
export function currentView(): View {
  const address = readAddress();
  const asked = (address.view ?? (phone() ? "schedule" : "week")) as View;
  if (phone() && asked !== "schedule" && asked !== "day") return "schedule";
  return asked;
}

function currentDate(): string {
  return readAddress().date ?? todayHere();
}

function chosenCalendars(): string[] {
  const address = readAddress();
  if (address.calendars === null) return defaultCalendars();
  return address.calendars.filter((id) => state.calendars.some((calendar) => calendar.id === id));
}

/** shownDates lists the dates the current view draws. */
export function shownDates(): string[] {
  const view = currentView();
  const date = currentDate();
  const me = state.me;
  const hide = me?.hide_weekends ?? false;
  const keep = (list: string[]) =>
    hide ? list.filter((day) => {
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      return weekday !== 0 && weekday !== 6;
    }) : list;
  if (view === "day") return [date];
  if (view === "week") {
    const first = startOfWeek(date, me?.week_start ?? "monday");
    return keep(Array.from({ length: 7 }, (_, index) => addDays(first, index)));
  }
  if (view === "custom") {
    const count = Math.min(7, Math.max(2, me?.custom_days ?? 4));
    return keep(Array.from({ length: count }, (_, index) => addDays(date, index)));
  }
  if (view === "schedule") {
    return Array.from({ length: 14 }, (_, index) => addDays(date, index));
  }
  const wall = parseLocal(date);
  const first = startOfWeek(`${date.slice(0, 8)}01`, me?.week_start ?? "monday");
  const lastOfMonth = `${String(wall.y).padStart(4, "0")}-${String(wall.m).padStart(2, "0")}-${new Date(Date.UTC(wall.y, wall.m, 0)).getUTCDate()}`;
  const weeks = Math.ceil((daysBetween(first, lastOfMonth) + 1) / 7);
  return Array.from({ length: weeks * 7 }, (_, index) => addDays(first, index));
}

function periodHeading(): string {
  const view = currentView();
  const dates = shownDates();
  const date = currentDate();
  const wall = parseLocal(date);
  if (view === "day") return readableDate(date);
  if (view === "month") return `${monthName(wall.m)} ${wall.y}`;
  return `${readableDate(dates[0])} to ${readableDate(dates[dates.length - 1])}`;
}

function windowRange(): [string, string] {
  const dates = shownDates();
  return [addDays(dates[0], -1), addDays(dates[dates.length - 1], 2)];
}

async function loadOccurrences(): Promise<void> {
  const [from, to] = windowRange();
  const result = await api.occurrences(from, to, chosenCalendars());
  shown = result.occurrences;
  state.occurrences = shown;
}

/** renderCalendar draws the whole screen for the current address. */
export async function renderCalendar(root: HTMLElement): Promise<void> {
  for (const stop of unsubscribers) stop();
  unsubscribers = [];
  await loadOccurrences();
  draw(root);
  unsubscribers.push(subscribe(() => draw(root)));
  unsubscribers.push(
    onLive((message) => {
      if (message.type === "share.changed") {
        const level = (message.data as { level?: string }).level;
        if (level === "draft") {
          void restoreDraft((record) => void afterSave(root, record));
          return;
        }
        void reload(root);
        return;
      }
      if (
        message.type === "event.changed" ||
        message.type === "event.deleted" ||
        message.type === "reply.changed" ||
        message.type === "proposal.changed"
      ) {
        void applyChange(root, message.data as EventChange);
      }
    }),
  );
  const address = readAddress();
  rendered = { view: currentView(), date: currentDate(), calendars: chosenCalendars().join(","), event: address.event };
  if (address.event) openQuickFor(root, address.event);
  else if (address.focus) focusBlock(address.focus);
  else void restoreDraft((record) => void afterSave(root, record));
}

/** calendarMounted reports whether the calendar screen is already drawn, so an
 *  address change inside it needs no new screen. */
export function calendarMounted(): boolean {
  return rendered !== null;
}

/** handleAddressChange answers a change of view, date, calendars or open
 *  event without rebuilding the screen from nothing. */
export async function handleAddressChange(root: HTMLElement): Promise<void> {
  const address = readAddress();
  const next = { view: currentView(), date: currentDate(), calendars: chosenCalendars().join(","), event: address.event };
  const was = rendered;
  rendered = next;
  if (!was) {
    await renderCalendar(root);
    return;
  }
  if (was.view !== next.view || was.date !== next.date || was.calendars !== next.calendars) {
    scrollTop = -1;
    closeAllDialogs();
    await loadOccurrences();
    draw(root);
    if (next.event) openQuickFor(root, next.event);
    else if (address.focus) focusBlock(address.focus);
    return;
  }
  if (was.event !== next.event) {
    closeAllDialogs();
    if (next.event) openQuickFor(root, next.event);
    return;
  }
  if (address.focus) focusBlock(address.focus);
}

async function reload(root: HTMLElement): Promise<void> {
  state.me = await api.me();
  state.calendars = (await api.calendars()).calendars;
  await loadOccurrences();
  draw(root);
}

/** redrawCalendar draws the shown period again, which a change of window
 *  height needs so each month cell's count follows it. */
export function redrawCalendar(root: HTMLElement): void {
  if (!rendered) return;
  draw(root);
}

// applyChange redraws for a live change, leaving focus on the same event at
// its new position, or on its old slot when the event is gone.
async function applyChange(root: HTMLElement, change: EventChange): Promise<void> {
  const focused = document.activeElement as HTMLElement | null;
  const focusedID = focused?.dataset?.occurrence ?? null;
  const focusedCell =
    focused?.getAttribute("role") === "gridcell"
      ? { date: focused.dataset.date!, minutes: Number(focused.dataset.minutes) }
      : null;
  const oldSlot = focusedID ? slotOf(focusedID) : null;
  const anchor = scheduleAnchor();
  await loadOccurrences();
  draw(root);
  if (dialogOpen()) return;
  if (anchor && grid) {
    restoreScheduleAnchor(grid.node, anchor);
    return;
  }
  if (focusedCell) {
    grid?.slotFor(focusedCell.date, focusedCell.minutes)?.focus();
    return;
  }
  if (!focusedID) return;
  const block = grid?.blockFor(focusedID);
  if (block) {
    focusBlock(focusedID);
    return;
  }
  if (oldSlot) grid?.slotFor(oldSlot.date, oldSlot.minutes)?.focus();
  void change;
}

function slotOf(id: string): { date: string; minutes: number } | null {
  const occurrence = shown.find((item) => occurrenceID(item) === id);
  if (!occurrence || !occurrence.start_utc) return null;
  const wall = displayWall(occurrence, "start", viewerZone());
  return { date: wallDate(wall), minutes: Math.floor((wall.h * 60 + wall.min) / 15) * 15 };
}

function draw(root: HTMLElement): void {
  if (grid) scrollTop = grid.scroller.scrollTop;
  clear(root);
  const skip = el("a", { href: "#calendar-grid", text: "Skip to calendar", class: "skip" });
  on(skip, "click", (event: MouseEvent) => {
    event.preventDefault();
    grid?.node.querySelector<HTMLElement>('[role="gridcell"]')?.focus();
  });
  const shell = el("div", { class: `calendar-shell ${layout()}` });
  const rail = buildRail(root);
  const main = el("div", { class: "calendar-main" });
  main.append(buildToolbar(root));
  const gridHolder = el("div", { id: "calendar-grid", class: "grid-holder" });
  main.append(gridHolder);
  if (phone()) {
    shell.append(main);
  } else {
    shell.append(rail, main);
  }
  root.append(skip, mainNavigation(), shell, reminderRegions());
  const undo = undoButton();
  if (undo) root.append(undo);
  if (!state.connected) root.append(el("p", { class: "lost", text: "Reconnecting. Changes will catch up." }));

  const view = currentView();
  const dates = shownDates();
  const callbacks = {
    onOpenEvent: (occurrence: EventRecord) => {
      setParams({ event: occurrenceID(occurrence), focus: null });
    },
    onSlotEnter: (date: string, minutes: number) => openNewAt(root, date, minutes, minutes + 15),
    onDragCreate: (date: string, from: number, to: number) => openNewAt(root, date, from, to),
    onBlockPointerDown: (occurrence: EventRecord, block: HTMLElement, event: PointerEvent, edge: "move" | "top" | "bottom") => {
      if (phone()) return;
      startDrag(event, {
        occurrence,
        block,
        edge,
        columnWidth: () => grid?.columnWidth() ?? 1,
        onSaved: (record) => void afterSave(root, record, occurrenceID(occurrence)),
        reopen: () => undefined,
      });
    },
    onSlotFocus: (date: string, minutes: number) => {
      focusedSlot = { date, minutes };
    },
  };

  if (view === "month") {
    grid = buildMonthGrid(dates, shown, callbacks.onOpenEvent, (date, rows, opener) => openDayList(date, rows, opener));
  } else if (view === "schedule" || (phone() && view !== "day")) {
    grid = buildSchedule(dates, shown, callbacks.onOpenEvent);
  } else {
    grid = buildTimeGrid(view === "day" ? "day" : view === "custom" ? "custom" : "week", dates, shown, callbacks);
  }
  gridHolder.append(grid.node);
  attachKeys(root);
  if (view !== "month" && view !== "schedule") {
    // The first draw is scrolled to working hours, with the 09:00 row at the
    // top of the scrolling area.
    const wanted = scrollTop >= 0 ? scrollTop : (9 * 60 * SLOT_HEIGHT) / 15;
    grid.scroller.scrollTop = wanted;
    scrollTop = wanted;
    requestAnimationFrame(() => {
      if (grid) grid.scroller.scrollTop = wanted;
    });
  }
}

function buildToolbar(root: HTMLElement): HTMLElement {
  const toolbar = el("div", { class: "toolbar" });
  const today = el("button", { type: "button", text: "Today" });
  const previous = el("button", { type: "button", text: "Previous" });
  const next = el("button", { type: "button", text: "Next" });
  const create = el("button", { type: "button", class: "primary", text: "New event" });
  const notices = el("button", { type: "button", text: "Notices" });
  on(today, "click", () => setParams({ date: todayHere() }));
  on(previous, "click", () => step(-1));
  on(next, "click", () => step(1));
  on(create, "click", () => openNewAt(root, currentDate(), 9 * 60, 10 * 60));
  on(notices, "click", () => openNotices(notices));
  toolbar.append(el("h1", { text: periodHeading() }), today, previous, next, create, notices);

  const group = el("div", { role: "radiogroup", "aria-label": "View", class: "view-group" });
  const views: [View, string][] = phone()
    ? [["schedule", "Schedule"], ["day", "Day"]]
    : [["day", "Day"], ["week", "Week"], ["month", "Month"], ["custom", "Custom days"], ["schedule", "Schedule"]];
  for (const [value, label] of views) {
    const radio = el("div", {
      role: "radio",
      class: "radio",
      "aria-checked": currentView() === value ? "true" : "false",
      tabindex: currentView() === value ? "0" : "-1",
      text: label,
    });
    on(radio, "click", () => setParams({ view: value }));
    on(radio, "keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setParams({ view: value });
      }
    });
    group.append(radio);
  }
  toolbar.append(group);
  if (phone()) {
    const calendars = el("button", { type: "button", text: "Calendars" });
    on(calendars, "click", () => {
      openDialog({ title: "Calendars", opener: calendars, sheet: true }, (body) => {
        body.append(el("h2", { text: "Calendars" }), buildMiniMonth(), buildCalendarList());
      });
    });
    toolbar.append(calendars);
  }
  return toolbar;
}

function step(direction: number): void {
  const view = currentView();
  const date = currentDate();
  if (view === "day") setParams({ date: addDays(date, direction) });
  else if (view === "week") setParams({ date: addDays(date, 7 * direction) });
  else if (view === "month") setParams({ date: addMonths(date, direction) });
  else if (view === "custom") setParams({ date: addDays(date, (state.me?.custom_days ?? 4) * direction) });
  else setParams({ date: addDays(date, 14 * direction) });
}

function buildRail(root: HTMLElement): HTMLElement {
  void root;
  return el("div", { class: "rail" }, [buildMiniMonth(), buildCalendarList()]);
}

function buildMiniMonth(): HTMLElement {
  const region = el("div", { role: "region", "aria-label": "Mini month", class: "mini-month" });
  const date = currentDate();
  const wall = parseLocal(date);
  region.append(el("p", { class: "mini-title", text: `${monthName(wall.m)} ${wall.y}` }));
  const days = el("div", { class: "mini-days" });
  const first = startOfWeek(`${date.slice(0, 8)}01`, state.me?.week_start ?? "monday");
  for (let index = 0; index < 42; index += 1) {
    const day = addDays(first, index);
    const button = el("button", {
      type: "button",
      class: `mini-day ${day.slice(0, 7) === date.slice(0, 7) ? "" : "other"} ${day === date ? "chosen" : ""}`,
      text: String(Number(day.slice(8, 10))),
    });
    button.setAttribute("aria-label", readableDate(day));
    on(button, "click", () => setParams({ date: day }));
    days.append(button);
  }
  region.append(days);
  return region;
}

function buildCalendarList(): HTMLElement {
  const group = el("div", { role: "group", "aria-label": "Calendars", class: "calendar-list" });
  const chosen = chosenCalendars();
  for (const calendar of state.calendars) {
    const input = el("input", { type: "checkbox", "aria-label": calendar.name });
    input.checked = chosen.includes(calendar.id);
    on(input, "change", () => {
      const next = input.checked
        ? [...chosen, calendar.id]
        : chosen.filter((id) => id !== calendar.id);
      setParams({ calendars: next.join(",") });
    });
    group.append(
      el("label", { class: "calendar-row" }, [
        input,
        el("span", { class: `chip colour-${calendar.colour.toLowerCase()}` }),
        el("span", { text: calendar.name }),
      ]),
    );
  }
  return group;
}

function openDayList(date: string, rows: EventRecord[], opener: HTMLElement): void {
  openDialog({ title: `Events on ${readableDate(date)}`, opener }, (body) => {
    body.append(el("h2", { text: `Events on ${readableDate(date)}` }));
    for (const occurrence of rows) {
      const button = el("button", { type: "button", "aria-label": blockName(occurrence), text: blockName(occurrence) });
      on(button, "click", () => {
        closeAllDialogs();
        setParams({ event: occurrenceID(occurrence) });
      });
      body.append(button);
    }
  });
}

function openNewAt(root: HTMLElement, date: string, fromMinutes: number, toMinutes: number): void {
  const calendars = editableCalendars();
  if (calendars.length === 0) {
    announce("You have no calendar you may add to.");
    return;
  }
  const draft = emptyDraft(
    `${date}T${timeLabel(fromMinutes)}`,
    `${date}T${timeLabel(toMinutes)}`,
    viewerZone(),
    calendars[0].id,
  );
  openEventDialog({
    mode: "new",
    draft,
    quick: true,
    onSaved: (record) => void afterSave(root, record),
  });
}

async function openQuick(root: HTMLElement, occurrence: EventRecord, block: HTMLElement | null): Promise<void> {
  openQuickDialog({
    occurrence,
    opener: block,
    onOpenPage: () => go(`/events/${occurrence.event_id ?? occurrence.id}?occurrence=${occurrenceID(occurrence)}`),
    onEdit: () =>
      openEventDialog({
        mode: "edit",
        draft: draftFromEvent(occurrence),
        record: occurrence,
        opener: block,
        onSaved: (record) => void afterSave(root, record, occurrenceID(occurrence)),
      }),
    onDuplicate: () => void duplicate(root, occurrence),
    onDelete: () => void remove(root, occurrence, block),
    onClose: () => setParams({ event: null }, true),
  });
}

function openQuickFor(root: HTMLElement, id: string): void {
  const occurrence = shown.find((item) => occurrenceID(item) === id);
  if (!occurrence) {
    announce("That event is not available.");
    return;
  }
  void openQuick(root, occurrence, grid?.blockFor(id) ?? null);
}

async function duplicate(root: HTMLElement, occurrence: EventRecord): Promise<void> {
  announce(`Duplicating ${occurrence.title}...`);
  try {
    const record = await api.duplicate(occurrence.event_id ?? occurrence.id!);
    announce(`Duplicated ${occurrence.title}.`);
    await afterSave(root, record);
  } catch (error) {
    if (error instanceof ApiError) announce(error.message);
  }
}

async function remove(root: HTMLElement, occurrence: EventRecord, block: HTMLElement | null): Promise<void> {
  const eventID = occurrence.event_id ?? occurrence.id!;
  const act = async (scope: string | null) => {
    announce(`Moving ${occurrence.title} to trash...`);
    try {
      const result = await api.deleteEvent(eventID, occurrence.version ?? 1, scope ?? "all", occurrenceID(occurrence));
      announce(`Moved ${occurrence.title} to trash.`);
      offerUndo({ title: occurrence.title, run: restoreFromTrash(result.trash_id) });
      await loadOccurrences();
      draw(root);
      const slot = grid?.slotFor(occurrence.start_local.slice(0, 10), minutesFrom(occurrence));
      slot?.focus();
    } catch (error) {
      if (error instanceof ApiError) announce(error.message);
    }
  };
  if (occurrence.rrule) {
    scopeDialog("Delete repeating event", block, (scope) => void act(scope));
    return;
  }
  await act(null);
}

function minutesFrom(occurrence: EventRecord): number {
  if (!occurrence.start_utc) return 0;
  const wall = parseLocal(occurrence.start_local);
  return wall.h * 60 + wall.min;
}

// afterSave redraws and puts focus back on the saved event. A pointer drag
// settles into the quick dialog; a keyboard move keeps the block focused with
// Three clocks beside it.
async function afterSave(
  root: HTMLElement,
  record: EventRecord,
  focusID?: string,
  settle: "quick" | "block" = "quick",
): Promise<void> {
  await loadOccurrences();
  draw(root);
  const id = focusID ?? record.occurrence_id ?? record.id ?? "";
  const block = grid?.blockFor(id);
  if (!block) return;
  block.focus();
  if (settle === "block") {
    const clocks = new ThreeClocks();
    clocks.placeBeside(block);
    const fresh = shown.find((item) => occurrenceID(item) === id) ?? record;
    if (!fresh.all_day && fresh.start_utc) clocks.set(clocksFor(Date.parse(fresh.start_utc)));
    window.setTimeout(() => clocks.remove(), 2500);
    return;
  }
  void openQuick(root, shown.find((item) => occurrenceID(item) === id) ?? record, block);
}

function focusBlock(id: string): void {
  const block = grid?.blockFor(id);
  if (!block) return;
  block.focus();
  block.scrollIntoView({ block: "center", behavior: "auto" });
}

function attachKeys(root: HTMLElement): void {
  if (!grid) return;
  const cells = queryAll<HTMLElement>('[role="gridcell"]', grid.node);
  if (cells.length) {
    const first = focusedSlot
      ? grid.slotFor(focusedSlot.date, focusedSlot.minutes) ?? cells[0]
      : grid.slotFor(grid.dates[0], 9 * 60) ?? cells[0];
    first.setAttribute("tabindex", "0");
  }
  on(grid.node, "focusin", (event: FocusEvent) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[role="gridcell"]');
    if (!cell) return;
    for (const other of cells) other.setAttribute("tabindex", "-1");
    cell.setAttribute("tabindex", "0");
    focusedSlot = { date: cell.dataset.date!, minutes: Number(cell.dataset.minutes) };
    keepInView(cell);
  });
  on(grid.node, "keydown", (event: KeyboardEvent) => void slotKeys(root, event));
  if (!screenKeysAttached) {
    screenKeysAttached = true;
    on(document, "keydown", (event: KeyboardEvent) => {
      if (rendered) void screenKeys(root, event);
    });
  }
}

function keepInView(cell: HTMLElement): void {
  if (!grid) return;
  const box = cell.getBoundingClientRect();
  const frame = grid.scroller.getBoundingClientRect();
  if (box.top < frame.top) grid.scroller.scrollTop -= frame.top - box.top + 4;
  else if (box.bottom > frame.bottom) grid.scroller.scrollTop += box.bottom - frame.bottom + 4;
}

async function slotKeys(root: HTMLElement, event: KeyboardEvent): Promise<void> {
  if (!grid) return;
  const cell = (event.target as HTMLElement).closest<HTMLElement>('[role="gridcell"]');
  if (cell) {
    const date = cell.dataset.date!;
    const minutes = Number(cell.dataset.minutes);
    const dates = grid.dates;
    const index = dates.indexOf(date);
    const moveTo = (nextDate: string, nextMinutes: number) => {
      event.preventDefault();
      const target = grid?.slotFor(nextDate, Math.max(0, Math.min(23 * 60 + 45, nextMinutes)));
      target?.focus();
    };
    if (event.key === "ArrowDown") return moveTo(date, minutes + 15);
    if (event.key === "ArrowUp") return moveTo(date, minutes - 15);
    if (event.key === "ArrowRight") return moveTo(dates[Math.min(dates.length - 1, index + 1)], minutes);
    if (event.key === "ArrowLeft") return moveTo(dates[Math.max(0, index - 1)], minutes);
    if (event.key === "Home" && !event.ctrlKey) return moveTo(dates[0], minutes);
    if (event.key === "End" && !event.ctrlKey) return moveTo(dates[dates.length - 1], minutes);
    if (event.key === "Home" && event.ctrlKey) return moveTo(dates[0], 0);
    if (event.key === "End" && event.ctrlKey) return moveTo(dates[dates.length - 1], 23 * 60 + 45);
    if (event.key === "Enter") {
      event.preventDefault();
      openNewAt(root, date, minutes, minutes + 15);
      return;
    }
  }
  const block = (event.target as HTMLElement).closest<HTMLElement>(".event-block, .month-chip, .schedule-event");
  if (!block) return;
  const id = block.dataset.occurrence!;
  const occurrence = shown.find((item) => occurrenceID(item) === id);
  if (!occurrence) return;
  if (event.key === "Enter") {
    event.preventDefault();
    setParams({ event: id });
    return;
  }
  if (!event.altKey) return;
  const resize = event.shiftKey;
  let minutes = 0;
  let days = 0;
  if (event.key === "ArrowUp") minutes = -15;
  else if (event.key === "ArrowDown") minutes = 15;
  else if (event.key === "ArrowLeft") days = -1;
  else if (event.key === "ArrowRight") days = 1;
  else return;
  if (resize && days !== 0) return;
  event.preventDefault();
  const scope = occurrence.rrule
    ? scopeMemory?.id === id
      ? scopeMemory.scope
      : await new Promise<string | null>((resolve) => {
          scopeDialog("Edit repeating event", block, (chosen) => {
            scopeMemory = { id, scope: chosen };
            resolve(chosen);
          }, () => resolve(null));
        })
    : null;
  if (occurrence.rrule && scope === null) return;
  await keyboardMove(occurrence, block, minutes, days, resize, scope, (record) => {
    void afterSave(root, record, id, "block");
  });
}

async function screenKeys(root: HTMLElement, event: KeyboardEvent): Promise<void> {
  if (dialogOpen()) return;
  const target = event.target as HTMLElement;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key.toLowerCase();
  const views: Record<string, View> = {
    "1": "day", d: "day", "2": "week", w: "week", "3": "month", m: "month",
    "4": "custom", x: "custom", "5": "schedule", a: "schedule",
  };
  if (views[key]) {
    event.preventDefault();
    setParams({ view: views[key] });
    return;
  }
  if (key === "t") {
    event.preventDefault();
    setParams({ date: todayHere() });
    return;
  }
  if (key === "j") {
    event.preventDefault();
    step(1);
    return;
  }
  if (key === "k") {
    event.preventDefault();
    step(-1);
    return;
  }
  if (key === "g") {
    event.preventDefault();
    openGoToDate(target, (date) => setParams({ date }));
    return;
  }
  if (key === "c") {
    event.preventDefault();
    openNewAt(root, currentDate(), 9 * 60, 10 * 60);
    return;
  }
  if (key === "z") {
    event.preventDefault();
    await runUndo();
    await loadOccurrences();
    draw(root);
    return;
  }
  if (key === "/") {
    event.preventDefault();
    go("/search");
    return;
  }
  if (key === "s") {
    event.preventDefault();
    go("/settings");
    return;
  }
  if (event.key === "?") {
    event.preventDefault();
    openShortcuts(target);
    return;
  }
  const block = target.closest<HTMLElement>(".event-block, .month-chip, .schedule-event");
  if (!block) return;
  const id = block.dataset.occurrence!;
  const occurrence = shown.find((item) => occurrenceID(item) === id);
  if (!occurrence) return;
  if (key === "e") {
    event.preventDefault();
    go(`/events/${occurrence.event_id ?? occurrence.id}?occurrence=${id}`);
    return;
  }
  if (event.key === "Delete") {
    event.preventDefault();
    await remove(root, occurrence, block);
  }
}

export function teardownCalendar(): void {
  for (const stop of unsubscribers) stop();
  unsubscribers = [];
  grid = null;
  rendered = null;
  scrollTop = -1;
  clearUndo();
}

export { DAY_HEIGHT, changed, serverClock, zoneWarningText };
