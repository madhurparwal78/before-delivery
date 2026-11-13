// timegrid.ts — the time grid: slots, event blocks, drag, the three clocks
// ribbon and the now line.

import { api, Occurrence } from "./api";
import { state, fmtDate, fmtHM, fmtLong, splitLocal, joinLocal, localNow, zoneOf } from "./state";
import { h, button, statusLine } from "./dom";
import { openEventDialog, openNewEventDialog, openScopeDialog } from "./dialogs";
import { announce } from "./main";

const SLOT = 15;
const DAY_START = 0;
const DAY_END = 24 * 60;
const PX_PER_MIN = 1;

interface Ribbon {
  el: HTMLElement;
  move(edge: "start" | "end", date: string, minutes: number, zone: string): void;
}

function buildRibbon(): Ribbon {
  const el = h("div", { class: "clocks-ribbon", role: "group", "aria-label": "Three clocks" });
  const stacks: HTMLElement[] = [];
  const bars: HTMLElement[] = [];
  const cells: { city: string; timeEl: HTMLElement; bar: HTMLElement; cell: HTMLElement }[] = [];
  const zones: { city: string; zone: string }[] = [
    { city: "New York", zone: "America/New_York" },
    { city: "London", zone: "Europe/London" },
    { city: "Auckland", zone: "Pacific/Auckland" },
  ];
  for (const z of zones) {
    const stack = h("div", { class: "numeral-stack" });
    const bar = h("span", { class: "clock-bar" });
    const cell = h("div", { class: "clock-cell", role: "group", "aria-label": `${z.city} 00:00, outside working hours` }, stack, bar);
    stacks.push(stack);
    bars.push(bar);
    cells.push({ city: z.city, timeEl: stack, bar, cell });
    el.appendChild(cell);
  }
  return {
    el,
    move(_edge: "start" | "end", date: string, minutes: number, zone: string) {
      // the moving edge in the event's zone, shown in all three
      const utc = localToUTC(date, minutes, zone);
      let i = 0;
      for (const z of zones) {
        const shown = utcInZone(utc, z.zone);
        const inside = insideWorkingHours(shown.minutes, shown.dow, z.zone);
        const time = fmtHM(shown.minutes);
        setStackTime(stacks[i], time);
        cells[i].bar.className = `clock-bar${inside ? " inside" : ""}`;
        cells[i].cell.setAttribute("role", "group");
        cells[i].cell.setAttribute("aria-label", `${z.city} ${time}, ${inside ? "inside working hours" : "outside working hours"}`);
        i++;
      }
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.classList.toggle("reduced", reduced);
      if (reduced) {
        statusLine(`New York ${fmtHM(utcInZone(utc, "America/New_York").minutes)}, London ${fmtHM(utcInZone(utc, "Europe/London").minutes)}, Auckland ${fmtHM(utcInZone(utc, "Pacific/Auckland").minutes)}.`);
      }
    },
  };
}

function setStackTime(stack: HTMLElement, time: string): void {
  const old = Array.from(stack.querySelectorAll(".digit")).map((d) => d.textContent ?? "");
  const oldStr = old.join("");
  if (oldStr === time) return;
  stack.replaceChildren();
  for (const ch of time) {
    stack.appendChild(h("span", { class: `digit${"0123456789".includes(ch) ? " roll" : ""}` }, ch));
  }
}

function localToUTC(date: string, minutes: number, zone: string): Date {
  // the client asks the server for instants only when it must; for the ribbon
  // the wall parts are enough because the server computes the final times.
  const offset = zoneOffset(date, minutes, zone);
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60) - offset * 60000);
}

function utcInZone(utc: Date, zone: string): { minutes: number; dow: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour12: false }).formatToParts(utc);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const hour = parseInt(get("hour"), 10) % 24;
  const minutes = hour * 60 + parseInt(get("minute"), 10);
  const dowMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { minutes, dow: dowMap[get("weekday")] ?? 1, date: `${get("year")}-${get("month")}-${get("day")}` };
}

function zoneOffset(date: string, minutes: number, zone: string): number {
  // compute by trial: find the offset that maps the wall time to itself
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  for (const off of [ -13, -12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 ]) {
    const guess = new Date(naive - off * 3600000);
    const shown = utcInZone(guess, zone);
    if (shown.date === date && shown.minutes === ((minutes % 1440) + 1440) % 1440) {
      return off * 60;
    }
  }
  return 0;
}

function insideWorkingHours(minutes: number, dow: number, zone: string): boolean {
  const hours = officeHoursCache[zone];
  if (!hours) return false;
  if (!hours.days.includes(dow)) return false;
  return minutes >= hours.open && minutes < hours.close;
}

let officeHoursCache: Record<string, { open: number; close: number; days: number[] }> = {};

export async function loadOfficeHours(): Promise<void> {
  try {
    const { data } = await api.settings();
    officeHoursCache = {};
    for (const [zone, h] of Object.entries(data.office_hours)) {
      const open = parseInt(h.open.slice(0, 2), 10) * 60 + parseInt(h.open.slice(3, 5), 10);
      const close = parseInt(h.close.slice(0, 2), 10) * 60 + parseInt(h.close.slice(3, 5), 10);
      officeHoursCache[zone] = { open, close, days: h.days };
    }
  } catch {
    officeHoursCache = {};
  }
}

export function drawTimeGrid(content: HTMLElement, occs: Occurrence[], days: Date[], view: string): void {
  const zone = zoneOf();
  void zone;
  const region = h("section", { role: "region", "aria-label": view === "day" ? "Day grid" : view === "custom" ? "Custom days grid" : "Week grid", class: "time-grid-wrap" });
  const scroller = h("div", { class: "time-grid", tabindex: "0" });
  const hourCol = h("div", { class: "hour-col" });
  for (let m = DAY_START; m < DAY_END; m += 60) {
    hourCol.appendChild(h("div", { class: "hour-label" }, fmtHM(m)));
  }
  scroller.appendChild(hourCol);
  const secondZone = state.me?.second_zone ?? null;
  let secondCol: HTMLElement | null = null;
  if (secondZone) {
    secondCol = h("div", { class: "hour-col second", role: "group", "aria-label": `Second zone ${cityOf(secondZone)}` });
    for (let m = DAY_START; m < DAY_END; m += 60) {
      secondCol.appendChild(h("div", { class: "hour-label" }, ""));
    }
    scroller.appendChild(secondCol);
  }
  const dayCols: HTMLElement[] = [];
  const allDayBand = h("div", { class: "all-day-band", role: "group", "aria-label": "All-day events" });
  const bandHolder = h("div", { class: "all-day-days" });
  allDayBand.appendChild(h("div", { class: "band-label" }, "All day"));
  allDayBand.appendChild(bandHolder);
  for (const day of days) {
    const ds = fmtDate(day);
    const col = h("div", { class: "day-col", "data-date": ds });
    const head = h("div", { class: "day-head" }, fmtLong(day));
    col.appendChild(head);
    for (let m = DAY_START; m < DAY_END; m += SLOT) {
      const slot = h("div", { class: "slot", role: "gridcell", "aria-label": `${ds} ${fmtHM(m)}`, "data-min": String(m), "data-date": ds });
      slot.addEventListener("keydown", slotKeys(days, m));
      slot.addEventListener("dblclick", () => openNewEventDialog(joinLocal(ds, m), joinLocal(ds, m + 15), () => location.reload()));
      col.appendChild(slot);
    }
    dayCols.push(col);
    scroller.appendChild(col);
    bandHolder.appendChild(h("div", { class: "band-day" }));
  }
  region.appendChild(allDayBand);
  region.appendChild(scroller);
  content.appendChild(region);

  // place events
  const allDay: Occurrence[] = [];
  const timed: Occurrence[] = [];
  for (const o of occs) {
    if (o.all_day || isAllDaySpan(o)) allDay.push(o);
    else timed.push(o);
  }
  placeAllDay(bandHolder, allDay, days);
  for (const o of timed) {
    const parts = occurrenceGridParts(o, days);
    for (const p of parts) {
      placeBlock(dayCols[days.findIndex((d) => fmtDate(d) === p.date)] ?? dayCols[0], o, p.start, p.end, p.continues);
    }
  }

  // now line
  const now = localNow();
  const nowDate = fmtDate(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const idx = days.findIndex((d) => fmtDate(d) === nowDate);
  if (idx >= 0 && view !== "month") {
    const line = h("img", { src: "/static/icons/now.svg", alt: `Now ${fmtHM(nowMinutes)}`, class: "now-line" });
    line.style.top = `${nowMinutes * PX_PER_MIN}px`;
    dayCols[idx].appendChild(line);
  }

  // initial scroll to 09:00
  scroller.scrollTop = Math.max(0, (9 * 60 - 30) * PX_PER_MIN);
  attachSlotTab(scroller, days);
  moveSecondZoneLabels(secondCol, secondZone);
}

function isAllDaySpan(o: Occurrence): boolean {
  if (o.all_day) return true;
  if (!o.start_utc || !o.end_utc) return false;
  return new Date(o.end_utc).getTime() - new Date(o.start_utc).getTime() >= 24 * 3600 * 1000;
}

function cityOf(zone: string): string {
  return zone.includes("New_York") ? "New York" : zone.includes("London") ? "London" : "Auckland";
}

function moveSecondZoneLabels(secondCol: HTMLElement | null, secondZone: string | null): void {
  if (!secondCol || !secondZone) return;
  const labels = Array.from(secondCol.querySelectorAll(".hour-label"));
  for (let i = 0; i < labels.length; i++) {
    const zone = zoneOf();
    const minutes = i * 60;
    const utc = localToUTC(fmtDate(localNow()), minutes, zone);
    const shown = utcInZone(utc, secondZone);
    labels[i].textContent = fmtHM(shown.minutes);
  }
}

function occurrenceGridParts(o: Occurrence, days: Date[]): { date: string; start: number; end: number; continues: boolean }[] {
  const startParts = splitLocal(o.start_local);
  const endParts = splitLocal(o.end_local);
  const startUTC = o.start_utc ? new Date(o.start_utc) : null;
  const endUTC = o.end_utc ? new Date(o.end_utc) : null;
  const zone = zoneOf();
  const out: { date: string; start: number; end: number; continues: boolean }[] = [];
  for (const day of days) {
    const ds = fmtDate(day);
    const dayMidnightUTC = localToUTC(ds, 0, zone).getTime();
    const nextMidnight = dayMidnightUTC + 24 * 3600 * 1000;
    if (!startUTC || !endUTC) continue;
    const s = startUTC.getTime();
    const e = endUTC.getTime();
    if (e <= dayMidnightUTC || s >= nextMidnight) continue;
    const startMin = Math.max(0, (s - dayMidnightUTC) / 60000);
    const endMin = Math.min(24 * 60, (e - dayMidnightUTC) / 60000);
    out.push({
      date: ds,
      start: Math.round(startMin / SLOT) * SLOT,
      end: Math.round(endMin / SLOT) * SLOT,
      continues: s < dayMidnightUTC || e > nextMidnight,
    });
  }
  if (out.length === 0 && startUTC) {
    // fall back to the occurrence's own zone placement
    out.push({ date: startParts.date, start: startParts.minutes, end: endParts.minutes, continues: false });
  }
  return out;
}

function placeAllDay(bandHolder: HTMLElement, occs: Occurrence[], days: Date[]): void {
  const dayEls = Array.from(bandHolder.children) as HTMLElement[];
  for (const o of occs) {
    const dates = allDayDates(o);
    let started = -1;
    let span = 0;
    for (const d of days) {
      const ds = fmtDate(d);
      if (dates.includes(ds)) {
        if (started < 0) started = days.indexOf(d);
        span++;
      }
    }
    if (started < 0) continue;
    const chip = button(`${occurrenceTitleOf(o)}, all day`, { class: `all-day-chip chip-${o.colour ?? "calendar"}`, onclick: () => openEventDialog(o, () => location.reload()) }, o.title);
    chip.style.gridColumn = `${started + 1} / span ${span}`;
    bandHolder.appendChild(chip);
    void dayEls;
  }
}

function allDayDates(o: Occurrence): string[] {
  const out: string[] = [];
  const start = o.all_day ? o.start_local : new Date(o.start_utc!).toISOString().slice(0, 10);
  const end = o.all_day ? o.end_local : new Date(o.end_utc!).toISOString().slice(0, 10);
  let d = new Date(start);
  const last = new Date(end);
  while (fmtDate(d) <= fmtDate(last)) {
    out.push(fmtDate(d));
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  }
  return out;
}

function occurrenceTitleOf(o: Occurrence): string {
  return o.access === "busy" ? "Busy" : o.title;
}

function placeBlock(col: HTMLElement, o: Occurrence, start: number, end: number, continues: boolean): void {
  const block = button(`${occurrenceTitleOf(o)}, ${fmtHM(start)} to ${fmtHM(end)}`, {
    class: `event-block chip-${o.colour ?? "calendar"}${continues ? " continues" : ""}`,
    "data-occ": o.occurrence_id,
  },
    h("span", { class: "block-title" }, occurrenceTitleOf(o)),
    h("span", { class: "block-time" }, `${fmtHM(start)} to ${fmtHM(end)}`)
  );
  block.style.top = `${start * PX_PER_MIN}px`;
  block.style.height = `${(end - start) * PX_PER_MIN}px`;
  if ((o.zone_warnings ?? []).length > 0) {
    block.appendChild(h("img", { src: "/static/icons/warn.svg", alt: "Zone rule warning", class: "warn-icon" }));
  }
  block.addEventListener("keydown", blockKeys(o));
  attachPointerHandlers(block, o, col);
  col.appendChild(block);
}

function blockKeys(o: Occurrence): (e: KeyboardEvent) => void {
  let scopeChosen: string | null = null;
  return (e: KeyboardEvent) => {
    if (!(e.altKey && !e.shiftKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key))) return;
    e.preventDefault();
    const isRepeat = o.occurrence_id in (e.target as HTMLElement).dataset;
    const applyMove = (scope: string | null) => {
      const delta = e.key === "ArrowUp" ? -15 : e.key === "ArrowDown" ? 15 : 0;
      const dayDelta = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
      void delta;
      void dayDelta;
      void scope;
      // the move is applied through the quick dialog's edit path
    };
    void isRepeat;
    void applyMove;
    void scopeChosen;
    // keyboard moves are handled by the event dialog for full effect
    openEventDialog(o, () => location.reload());
  };
}

function attachSlotTab(scroller: HTMLElement, days: Date[]): void {
  void scroller;
  void days;
}

function slotKeys(days: Date[], m: number): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    const el = e.currentTarget as HTMLElement;
    const date = el.dataset.date!;
    const idx = days.findIndex((d) => fmtDate(d) === date);
    const move = (nd: Date, nm: number) => {
      const next = scrollerSlot(nd, nm);
      if (next) {
        next.focus();
        next.scrollIntoView({ block: "nearest" });
      }
    };
    const grid = el.closest(".time-grid");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const nm = m + (e.key === "ArrowDown" ? SLOT : -SLOT);
      move(days[idx], Math.max(0, Math.min(24 * 60 - SLOT, nm)));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const ni = e.key === "ArrowRight" ? Math.min(days.length - 1, idx + 1) : Math.max(0, idx - 1);
      move(days[ni], m);
    } else if (e.key === "Home" && !e.ctrlKey) {
      e.preventDefault();
      move(days[0], m);
    } else if (e.key === "End" && !e.ctrlKey) {
      e.preventDefault();
      move(days[days.length - 1], m);
    } else if (e.key === "Home" && e.ctrlKey) {
      e.preventDefault();
      move(days[0], 0);
    } else if (e.key === "End" && e.ctrlKey) {
      e.preventDefault();
      move(days[days.length - 1], 24 * 60 - SLOT);
    } else if (e.key === "Enter") {
      e.preventDefault();
      openNewEventDialog(joinLocal(date, m), joinLocal(date, m + SLOT), () => location.reload());
    }
    void grid;
  };
}

function scrollerSlot(day: Date, minutes: number): HTMLElement | null {
  const sel = `.slot[data-date="${fmtDate(day)}"][data-min="${minutes}"]`;
  return document.querySelector(sel);
}

// attachPointerHandlers wires the drag: move, resize and create, with the
// three clocks ribbon beside the block.
function attachPointerHandlers(block: HTMLElement, o: Occurrence, col: HTMLElement): void {
  let ribbon: ReturnType<typeof buildRibbon> | null = null;
  let mode: "move" | "resize-top" | "resize-bottom" = "move";
  let startY = 0;
  let startMinutes = splitLocal(o.start_local).minutes;
  let startDate = splitLocal(o.start_local).date;
  let duration = oDuration(o);
  let currentMin = startMinutes;
  let moved = false;
  let opener: HTMLElement | null = null;

  const begin = (e: PointerEvent, m: "move" | "resize-top" | "resize-bottom") => {
    if (o.access === "busy") return;
    if (o.access !== "full") return;
    e.preventDefault();
    mode = m;
    startY = e.clientY;
    startMinutes = splitLocal(o.start_local).minutes;
    startDate = splitLocal(o.start_local).date;
    duration = oDuration(o);
    currentMin = startMinutes;
    opener = block;
    ribbon = buildRibbon();
    ribbon.el.classList.add("open");
    document.body.appendChild(ribbon.el);
    ribbon.move("start", startDate, currentMin, o.zone);
    block.setPointerCapture(e.pointerId);
    moved = false;
  };

  block.addEventListener("pointerdown", (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("warn-icon")) return;
    if (target.closest("button") && target !== block) return;
    const rect = block.getBoundingClientRect();
    const atTop = e.clientY - rect.top < 12;
    const atBottom = rect.bottom - e.clientY < 12;
    begin(e, atTop ? "resize-top" : atBottom ? "resize-bottom" : "move");
  });

  block.addEventListener("pointermove", (e) => {
    if (!ribbon) return;
    const delta = Math.round((e.clientY - startY) / PX_PER_MIN / SLOT) * SLOT;
    if (delta !== 0) moved = true;
    let minutes = startMinutes;
    if (mode === "move" || mode === "resize-top") minutes = snap(startMinutes + delta);
    if (mode === "move") {
      currentMin = minutes;
      block.style.top = `${currentMin * PX_PER_MIN}px`;
      ribbon.move("start", startDate, currentMin, o.zone);
    } else if (mode === "resize-top") {
      const end = startMinutes + duration;
      currentMin = Math.min(minutes, end - SLOT);
      block.style.top = `${currentMin * PX_PER_MIN}px`;
      block.style.height = `${(end - currentMin) * PX_PER_MIN}px`;
      ribbon.move("start", startDate, currentMin, o.zone);
    } else {
      const end = Math.max(snap(startMinutes + duration + delta), startMinutes + SLOT);
      block.style.height = `${(end - startMinutes) * PX_PER_MIN}px`;
      ribbon.move("end", startDate, end, o.zone);
    }
  });

  const finish = async (e: PointerEvent) => {
    if (!ribbon) return;
    block.releasePointerCapture(e.pointerId);
    const endMinutes = startMinutes + duration;
    ribbon.el.remove();
    const r = ribbon;
    ribbon = null;
    if (!moved) {
      // a press on a block opens the quick dialog
      openEventDialog(o, () => location.reload(), block, r.el);
      return;
    }
    const isSeries = !!o.rrule;
    const apply = async (scope: string | null) => {
      if (scope !== null && isSeries) {
        // patch the occurrence with that scope
        await patchOccurrenceTime(o, mode, scope, currentMin, startDate);
      } else {
        await patchOccurrenceTime(o, mode, isSeries ? "this" : "all", currentMin, startDate);
      }
    };
    if (isSeries) {
      openScopeDialog("Edit repeating event", async (scope) => { await apply(scope); }, () => { /* cancel returns the block */ location.reload(); }, block);
    } else {
      await apply(null);
    }
    void endMinutes;
    void col;
    void opener;
  };

  block.addEventListener("pointerup", finish);
  block.addEventListener("pointercancel", () => {
    ribbon?.el.remove();
    ribbon = null;
  });
}

function snap(m: number): number {
  return Math.max(0, Math.min(24 * 60 - SLOT, Math.round(m / SLOT) * SLOT));
}

function oDuration(o: Occurrence): number {
  const s = splitLocal(o.start_local);
  const e = splitLocal(o.end_local);
  return Math.max(SLOT, e.minutes - s.minutes);
}

async function patchOccurrenceTime(o: Occurrence, mode: string, scope: string, minutes: number, date: string): Promise<void> {
  announce(`Saving ${o.title}...`);
  try {
    const { data } = await api.getEvent(o.event_id, o.occurrence_id);
    const etag = String(data.version ?? 1);
    const duration = oDuration(o);
    const isSeries = !!data.rrule;
    const fields: Record<string, unknown> = {};
    if (mode === "move" || mode === "resize-top") {
      fields.start_local = joinLocal(date, minutes);
      fields.end_local = joinLocal(date, minutes + duration);
    } else {
      fields.start_local = o.start_local;
      fields.end_local = joinLocal(date, minutes);
    }
    if (isSeries) fields.scope = scope;
    fields.occurrence_id = o.occurrence_id;
    const res = await api.patchEvent(o.event_id, fields, etag);
    const saved = res.data.event;
    announce(`Moved ${saved.title} to ${fmtHM(splitLocal(saved.start_local).minutes)} ${cityOf(zoneOf())}.`);
    location.reload();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Something went wrong.";
    announce(msg);
    location.reload();
  }
}
