// The time grid, month grid and schedule list, with the published slot
// keyboard model, overlap lanes, top band and now line.

import type { Calendar, EventRecord } from "./api";
import { clear, el, on } from "./dom";
import {
  assignLanes,
  bandDates,
  displayWall,
  isAllDayBand,
  occurrenceID,
  timedPieces,
  type Block,
} from "./layout";
import { state, viewerZone } from "./state";
import {
  addDays,
  cityOf,
  inZone,
  minutesOfDay,
  readableDate,
  serverClock,
  shortDayName,
  wallClock,
  wallDate,
  weekdayOf,
} from "./time";

export const SLOT_HEIGHT = 13;
export const SLOTS_PER_DAY = 96;
export const DAY_HEIGHT = SLOT_HEIGHT * SLOTS_PER_DAY;

export type GridKind = "week" | "day" | "custom";

export type GridHandles = {
  node: HTMLElement;
  scroller: HTMLElement;
  blockFor: (id: string) => HTMLElement | null;
  slotFor: (date: string, minutes: number) => HTMLElement | null;
  columnWidth: () => number;
  dates: string[];
};

export type GridCallbacks = {
  onOpenEvent: (occurrence: EventRecord, block: HTMLElement) => void;
  onSlotEnter: (date: string, minutes: number) => void;
  onDragCreate: (date: string, startMinutes: number, endMinutes: number) => void;
  onBlockPointerDown: (occurrence: EventRecord, block: HTMLElement, event: PointerEvent, edge: "move" | "top" | "bottom") => void;
  onSlotFocus: (date: string, minutes: number) => void;
};

export function timeLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** blockName writes an event block's published accessible name. */
export function blockName(occurrence: EventRecord): string {
  if (occurrence.all_day || !occurrence.start_utc || !occurrence.end_utc) {
    return `${occurrence.title}, all day`;
  }
  const zone = viewerZone();
  const start = displayWall(occurrence, "start", zone);
  const end = displayWall(occurrence, "end", zone);
  return `${occurrence.title}, ${wallClock(start)} to ${wallClock(end)}`;
}

function colourClass(occurrence: EventRecord, calendars: Calendar[]): string {
  const chosen = occurrence.colour && occurrence.colour !== "Calendar colour" ? occurrence.colour : null;
  const calendar = calendars.find((item) => item.id === occurrence.calendar_id);
  const colour = chosen ?? calendar?.colour ?? "Indigo";
  return `colour-${colour.toLowerCase().replace(/ /g, "-")}`;
}

function warningMarker(): HTMLElement {
  return el("span", { role: "img", "aria-label": "Zone rule warning", class: "warn-marker", text: "!" });
}

export function hasWarning(occurrence: EventRecord): boolean {
  return (occurrence.zone_warnings?.length ?? 0) > 0 &&
    (occurrence.access === "full" || occurrence.access === "guest");
}

/** buildTimeGrid draws the week, day or custom-days grid. */
export function buildTimeGrid(
  kind: GridKind,
  dates: string[],
  occurrences: EventRecord[],
  callbacks: GridCallbacks,
): GridHandles {
  const label = kind === "week" ? "Week grid" : kind === "day" ? "Day grid" : "Custom days grid";
  const region = el("div", { role: "region", "aria-label": label, class: "time-grid" });
  const zone = viewerZone();

  const heading = el("div", { class: "grid-head" }, [el("div", { class: "corner" })]);
  for (const date of dates) {
    heading.append(
      el("div", { class: "day-head" }, [
        el("span", { class: "day-name", text: shortDayName(weekdayOf(date)) }),
        el("span", { class: "day-number", text: String(Number(date.slice(8, 10))) }),
      ]),
    );
  }

  const band = el("div", { role: "group", "aria-label": "All-day events", class: "all-day-band" }, [
    el("div", { class: "corner", text: "All day" }),
  ]);
  const bandColumns = new Map<string, HTMLElement>();
  for (const date of dates) {
    const column = el("div", { class: "band-column" });
    bandColumns.set(date, column);
    band.append(column);
  }

  const blocksByID = new Map<string, HTMLElement>();
  for (const occurrence of occurrences) {
    if (!isAllDayBand(occurrence)) continue;
    for (const date of bandDates(occurrence, zone)) {
      const column = bandColumns.get(date);
      if (!column) continue;
      const chip = eventButton(occurrence, callbacks, "band");
      blocksByID.set(occurrenceID(occurrence), chip);
      column.append(chip);
    }
  }

  const scroller = el("div", { class: "grid-body" });
  const hours = el("div", { class: "hour-labels" });
  for (let hour = 0; hour < 24; hour += 1) {
    hours.append(el("div", { class: "hour-label", style: `height:${SLOT_HEIGHT * 4}px`, text: timeLabel(hour * 60) }));
  }
  const inner = el("div", { class: "grid-inner", style: `--columns:${dates.length}` });
  inner.append(hours);

  const second = state.me?.second_zone;
  if (second) {
    const secondLabels = el("div", {
      role: "group",
      "aria-label": `Second zone ${cityOf(second)}`,
      class: "hour-labels second",
    });
    for (let hour = 0; hour < 24; hour += 1) {
      const instant = Date.parse(`${dates[0]}T00:00:00Z`);
      void instant;
      const sample = sampleInstant(dates[0], hour * 60, zone);
      secondLabels.append(
        el("div", {
          class: "hour-label",
          style: `height:${SLOT_HEIGHT * 4}px`,
          text: wallClock(inZone(sample, second)),
        }),
      );
    }
    inner.append(secondLabels);
  }

  const slotGrid = el("div", {
    role: "grid",
    class: "slot-grid",
    style: `grid-template-columns:repeat(${dates.length},1fr)`,
  });
  const slots = new Map<string, HTMLElement>();
  for (let index = 0; index < SLOTS_PER_DAY; index += 1) {
    const minutes = index * 15;
    const row = el("div", { role: "row", class: "slot-row", style: `height:${SLOT_HEIGHT}px` });
    for (const date of dates) {
      const cell = el("div", {
        role: "gridcell",
        "aria-label": `${readableDate(date)} ${timeLabel(minutes)}`,
        class: `slot ${minutes % 120 < 60 ? "tint" : ""}`,
        tabindex: "-1",
        "data-date": date,
        "data-minutes": String(minutes),
      });
      slots.set(`${date}|${minutes}`, cell);
      row.append(cell);
    }
    slotGrid.append(row);
  }
  inner.append(slotGrid);

  const overlay = el("div", { class: "block-layer", style: `grid-template-columns:repeat(${dates.length},1fr)` });
  const columns = new Map<string, HTMLElement>();
  for (const date of dates) {
    const column = el("div", { class: "day-column", style: `height:${DAY_HEIGHT}px` });
    columns.set(date, column);
    overlay.append(column);
  }
  inner.append(overlay);

  const piecesByDate = new Map<string, Block[]>();
  for (const occurrence of occurrences) {
    if (isAllDayBand(occurrence)) continue;
    for (const piece of timedPieces(occurrence, zone)) {
      if (!columns.has(piece.date)) continue;
      const list = piecesByDate.get(piece.date) ?? [];
      list.push(piece);
      piecesByDate.set(piece.date, list);
    }
  }
  for (const [date, pieces] of piecesByDate) {
    assignLanes(pieces);
    const column = columns.get(date)!;
    for (const piece of pieces) {
      const button = eventButton(piece.occurrence, callbacks, "timed");
      const top = (piece.startMinutes / 15) * SLOT_HEIGHT;
      const height = Math.max(SLOT_HEIGHT, ((piece.endMinutes - piece.startMinutes) / 15) * SLOT_HEIGHT);
      const width = 100 / piece.lanes;
      button.style.top = `${top}px`;
      button.style.height = `${height}px`;
      button.style.left = `${piece.lane * width}%`;
      button.style.width = `${width}%`;
      blocksByID.set(occurrenceID(piece.occurrence), button);
      column.append(button);
    }
  }

  const todayHere = wallDate(inZone(serverClock.now(), zone));
  if (dates.includes(todayHere)) {
    const nowWall = inZone(serverClock.now(), zone);
    const line = el("div", {
      role: "img",
      "aria-label": `Now ${wallClock(nowWall)}`,
      class: "now-line",
      style: `top:${(minutesOfDay(nowWall) / 15) * SLOT_HEIGHT}px`,
    });
    columns.get(todayHere)?.append(line);
  }

  scroller.append(inner);
  region.append(heading, band, scroller);

  attachSlotPointer(slotGrid, callbacks);

  return {
    node: region,
    scroller,
    blockFor: (id) => blocksByID.get(id) ?? null,
    slotFor: (date, minutes) => slots.get(`${date}|${minutes}`) ?? null,
    columnWidth: () => {
      const first = columns.values().next().value as HTMLElement | undefined;
      return first ? first.getBoundingClientRect().width : 1;
    },
    dates,
  };
}

function sampleInstant(date: string, minutes: number, zone: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const wall = { y, m, d, h: Math.floor(minutes / 60), min: minutes % 60 };
  const guess = Date.UTC(wall.y, wall.m - 1, wall.d, wall.h, wall.min);
  const back = inZone(guess, zone);
  const drift = Date.UTC(back.y, back.m - 1, back.d, back.h, back.min) - guess;
  return guess - drift;
}

function eventButton(occurrence: EventRecord, callbacks: GridCallbacks, shape: "band" | "timed"): HTMLElement {
  const button = el("button", {
    type: "button",
    class: `event-block ${shape} ${colourClass(occurrence, state.calendars)} kind-${occurrence.kind ?? "event"}`,
    "aria-label": blockName(occurrence),
    "data-occurrence": occurrenceID(occurrence),
  });
  button.append(el("span", { class: "block-title", text: occurrence.title }));
  if (!occurrence.all_day && occurrence.start_utc) {
    button.append(el("span", { class: "block-time", text: wallClock(displayWall(occurrence, "start", viewerZone())) }));
  }
  if (hasWarning(occurrence)) button.append(warningMarker());
  on(button, "click", (event: MouseEvent) => {
    event.preventDefault();
    if (button.dataset.dragged === "1") {
      delete button.dataset.dragged;
      return;
    }
    callbacks.onOpenEvent(occurrence, button);
  });
  const mayEdit =
    occurrence.access === "full" || (occurrence.access === "guest" && occurrence.switches?.modify_event === true);
  if (shape === "timed" && mayEdit) {
    const top = el("span", { class: "resize top", "aria-hidden": "true" });
    const bottom = el("span", { class: "resize bottom", "aria-hidden": "true" });
    button.append(top, bottom);
    on(top, "pointerdown", (event: PointerEvent) => callbacks.onBlockPointerDown(occurrence, button, event, "top"));
    on(bottom, "pointerdown", (event: PointerEvent) => callbacks.onBlockPointerDown(occurrence, button, event, "bottom"));
  }
  if (mayEdit) {
    on(button, "pointerdown", (event: PointerEvent) => {
      if ((event.target as HTMLElement).classList.contains("resize")) return;
      callbacks.onBlockPointerDown(occurrence, button, event, "move");
    });
  }
  return button;
}

/** attachSlotPointer lets a drag across empty slots open the New event
 *  dialog with both ends snapped to 15 minutes. */
function attachSlotPointer(slotGrid: HTMLElement, callbacks: GridCallbacks): void {
  let startCell: HTMLElement | null = null;
  let lastCell: HTMLElement | null = null;
  on(slotGrid, "pointerdown", (event: PointerEvent) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>(".slot");
    if (!cell) return;
    startCell = cell;
    lastCell = cell;
    slotGrid.setPointerCapture(event.pointerId);
  });
  on(slotGrid, "pointermove", (event: PointerEvent) => {
    if (!startCell) return;
    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".slot");
    if (cell) lastCell = cell;
  });
  const finish = () => {
    if (!startCell || !lastCell) {
      startCell = null;
      return;
    }
    const date = startCell.dataset.date!;
    const first = Number(startCell.dataset.minutes);
    const second = Number(lastCell.dataset.minutes);
    const from = Math.min(first, second);
    const to = Math.max(first, second) + 15;
    startCell = null;
    lastCell = null;
    callbacks.onDragCreate(date, from, to);
  };
  on(slotGrid, "pointerup", finish);
  on(slotGrid, "pointercancel", () => {
    startCell = null;
    lastCell = null;
  });
}

/** buildMonthGrid draws the month, each cell showing as many chips as fit
 *  plus a +N more control. */
export function buildMonthGrid(
  dates: string[],
  occurrences: EventRecord[],
  onOpenEvent: (occurrence: EventRecord, block: HTMLElement) => void,
  onMore: (date: string, rows: EventRecord[], opener: HTMLElement) => void,
): GridHandles {
  const region = el("div", { role: "region", "aria-label": "Month grid", class: "month-grid" });
  const zone = viewerZone();
  const byDate = new Map<string, EventRecord[]>();
  for (const occurrence of occurrences) {
    const days = isAllDayBand(occurrence)
      ? bandDates(occurrence, zone)
      : timedPieces(occurrence, zone).map((piece) => piece.date);
    for (const date of days) {
      const list = byDate.get(date) ?? [];
      list.push(occurrence);
      byDate.set(date, list);
    }
  }
  const blocks = new Map<string, HTMLElement>();
  const head = el("div", { class: "month-head" });
  for (let index = 0; index < 7; index += 1) {
    head.append(el("div", { class: "month-day-name", text: shortDayName(weekdayOf(dates[index])) }));
  }
  const body = el("div", { class: "month-body" });
  for (const date of dates) {
    const rows = byDate.get(date) ?? [];
    const cell = el("div", { class: "month-cell", "data-date": date });
    cell.append(el("div", { class: "month-date", text: String(Number(date.slice(8, 10))) }));
    const chips = el("div", { class: "month-chips" });
    cell.append(chips);
    body.append(cell);
    requestAnimationFrame(() => fillMonthCell(cell, chips, rows, onOpenEvent, onMore, blocks));
  }
  region.append(head, body);
  return {
    node: region,
    scroller: body,
    blockFor: (id) => blocks.get(id) ?? null,
    slotFor: () => null,
    columnWidth: () => 1,
    dates,
  };
}

const CHIP_HEIGHT = 24;

function fillMonthCell(
  cell: HTMLElement,
  chips: HTMLElement,
  rows: EventRecord[],
  onOpenEvent: (occurrence: EventRecord, block: HTMLElement) => void,
  onMore: (date: string, rows: EventRecord[], opener: HTMLElement) => void,
  blocks: Map<string, HTMLElement>,
): void {
  clear(chips);
  const available = chips.clientHeight || cell.clientHeight - 28;
  let room = Math.max(0, Math.floor(available / CHIP_HEIGHT));
  if (rows.length > room && room > 0) room -= 1;
  const shown = rows.slice(0, Math.min(room, rows.length));
  for (const occurrence of shown) {
    const chip = el("button", {
      type: "button",
      class: `month-chip ${colourClass(occurrence, state.calendars)}`,
      "aria-label": blockName(occurrence),
      "data-occurrence": occurrenceID(occurrence),
    }, [el("span", { text: occurrence.title })]);
    if (hasWarning(occurrence)) chip.append(warningMarker());
    on(chip, "click", () => onOpenEvent(occurrence, chip));
    blocks.set(occurrenceID(occurrence), chip);
    chips.append(chip);
  }
  const hidden = rows.length - shown.length;
  if (hidden > 0) {
    const more = el("button", { type: "button", class: "more", text: `+${hidden} more` });
    more.setAttribute("aria-label", `+${hidden} more`);
    on(more, "click", () => onMore(cell.dataset.date!, rows, more));
    chips.append(more);
  }
}

/** buildSchedule draws the fourteen-day schedule list. */
export function buildSchedule(
  dates: string[],
  occurrences: EventRecord[],
  onOpenEvent: (occurrence: EventRecord, block: HTMLElement) => void,
): GridHandles {
  const list = el("div", { role: "list", "aria-label": "Schedule", class: "schedule" });
  const zone = viewerZone();
  const byDate = new Map<string, EventRecord[]>();
  for (const occurrence of occurrences) {
    const days = isAllDayBand(occurrence)
      ? bandDates(occurrence, zone)
      : timedPieces(occurrence, zone).map((piece) => piece.date);
    for (const date of days) {
      const rows = byDate.get(date) ?? [];
      rows.push(occurrence);
      byDate.set(date, rows);
    }
  }
  const blocks = new Map<string, HTMLElement>();
  let any = false;
  for (const date of dates) {
    const rows = byDate.get(date);
    if (!rows || rows.length === 0) continue;
    any = true;
    const item = el("div", { role: "listitem", class: "schedule-day" });
    const dayButton = el("button", { type: "button", class: "schedule-date", text: readableDate(date) });
    dayButton.setAttribute("aria-label", readableDate(date));
    item.append(dayButton);
    for (const occurrence of rows) {
      const block = el("button", {
        type: "button",
        class: `schedule-event ${colourClass(occurrence, state.calendars)}`,
        "aria-label": blockName(occurrence),
        "data-occurrence": occurrenceID(occurrence),
      }, [el("span", { text: blockName(occurrence) })]);
      if (hasWarning(occurrence)) block.append(warningMarker());
      on(block, "click", () => onOpenEvent(occurrence, block));
      blocks.set(occurrenceID(occurrence), block);
      item.append(block);
    }
    list.append(item);
  }
  if (!any) list.append(el("p", { text: "Nothing scheduled in this period." }));
  attachScheduleKeys(list);
  return {
    node: list,
    scroller: list,
    blockFor: (id) => blocks.get(id) ?? null,
    slotFor: () => null,
    columnWidth: () => 1,
    dates,
  };
}

/** attachScheduleKeys moves the focused day by keys and keeps it in place
 *  under the sticky toolbar when a live change adds rows above it. */
function attachScheduleKeys(list: HTMLElement): void {
  on(list, "keydown", (event: KeyboardEvent) => {
    const current = (event.target as HTMLElement).closest<HTMLElement>(".schedule-date");
    if (!current) return;
    const days = Array.from(list.querySelectorAll<HTMLElement>(".schedule-date"));
    const index = days.indexOf(current);
    let next = -1;
    if (event.key === "ArrowDown") next = Math.min(days.length - 1, index + 1);
    else if (event.key === "ArrowUp") next = Math.max(0, index - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = days.length - 1;
    else return;
    event.preventDefault();
    focusScheduleDay(days[next]);
  });
}

/** focusScheduleDay brings a day heading fully into view under the toolbar. */
export function focusScheduleDay(day: HTMLElement): void {
  day.focus({ preventScroll: true });
  const toolbar = document.querySelector<HTMLElement>(".toolbar");
  const clearance = (toolbar?.getBoundingClientRect().height ?? 0) + 8;
  const box = day.getBoundingClientRect();
  if (box.top < clearance) window.scrollBy(0, box.top - clearance);
  else if (box.bottom > window.innerHeight) window.scrollBy(0, box.bottom - window.innerHeight + 8);
}

/** scheduleAnchor remembers where the focused day sits, so a live change that
 *  adds rows above it leaves it where it was. */
export function scheduleAnchor(): { date: string; top: number } | null {
  const focused = document.activeElement as HTMLElement | null;
  if (!focused || !focused.classList.contains("schedule-date")) return null;
  return { date: focused.textContent ?? "", top: focused.getBoundingClientRect().top };
}

export function restoreScheduleAnchor(list: HTMLElement, anchor: { date: string; top: number } | null): void {
  if (!anchor) return;
  const day = Array.from(list.querySelectorAll<HTMLElement>(".schedule-date")).find(
    (node) => node.textContent === anchor.date,
  );
  if (!day) return;
  day.focus({ preventScroll: true });
  window.scrollBy(0, day.getBoundingClientRect().top - anchor.top);
}

export { addDays };
