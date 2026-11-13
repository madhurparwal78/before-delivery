// calendar.ts — the workspace: toolbar, rail, grid, drag and the three clocks.

import { api, Occurrence } from "./api";
import { state, View, fmtDate, fmtLong, fmtHM, parseDate, splitLocal, joinLocal, localNow, weekStartFor } from "./state";
import { h, heading, button, checkbox, dialog, radiogroupWrap, radio, focusTrap } from "./dom";
import { navigate } from "./main";
import { openEventDialog, openNewEventDialog, openNotices } from "./dialogs";
import { drawTimeGrid, loadOfficeHours } from "./timegrid";

export function calendarAddress(q: URLSearchParams): { view: View; date: string; calendars: string[]; event: string; focus: string } {
  const view = (q.get("view") ?? "") as View;
  const valid: View[] = ["day", "week", "month", "custom", "schedule"];
  const isPhone = window.innerWidth < 600;
  const defaultView: View = isPhone ? "schedule" : "week";
  const chosen = valid.includes(view) ? view : defaultView;
  const date = q.get("date") ?? fmtDate(localNow());
  const calendars = (q.get("calendars") ?? "").split(",").filter((x) => x !== "");
  const event = q.get("event") ?? "";
  const focus = q.get("focus") ?? "";
  return { view: chosen, date, calendars, event, focus };
}

export function renderCalendar(app: HTMLElement, q: URLSearchParams): void {
  const addr = calendarAddress(q);
  const isPhone = window.innerWidth < 600;
  const view = addr.view;

  const wrap = h("div", { class: "workspace" });
  const rail = h("aside", { class: "rail", "aria-label": "Calendars" });
  const main = h("main", { class: "calendar-main" });
  const toolbar = h("div", { class: "toolbar" });
  wrap.append(rail, main);
  app.appendChild(wrap);

  // toolbar
  const viewGroup = radiogroupWrap("View");
  const offered: View[] = isPhone ? ["schedule", "day"] : ["day", "week", "month", "custom", "schedule"];
  for (const v of offered) {
    const r = radio("View", v, v === "day" ? "Day" : v === "week" ? "Week" : v === "month" ? "Month" : v === "custom" ? "Custom days" : "Schedule", v === view);
    r.addEventListener("change", () => navigate("/calendar", { ...addrParams(addr), view: v }));
    viewGroup.appendChild(r.parentElement!);
  }
  const periodHeading = heading(1, periodTitle(view, addr.date));
  periodHeading.classList.add("period");
  toolbar.append(
    button("Today", { class: "btn ghost", onclick: () => navigate("/calendar", { ...addrParams(addr), date: fmtDate(localNow()) }) }, "Today"),
    button("Previous", { class: "btn ghost", "aria-label": "Previous", onclick: () => shiftPeriod(addr, -1) }, "Previous"),
    button("Next", { class: "btn ghost", "aria-label": "Next", onclick: () => shiftPeriod(addr, 1) }, "Next"),
    button("New event", { class: "btn accent", onclick: () => openNewEventDialog(joinLocal(fmtDate(localNow()), 9 * 60), joinLocal(fmtDate(localNow()), 10 * 60), () => reload()) }, "New event"),
    viewGroup,
    button("Notices", { class: "btn ghost", onclick: () => openNotices() }, "Notices"),
    periodHeading
  );
  if (state.reconnecting) {
    toolbar.appendChild(h("span", { class: "reconnect" }, "Reconnecting. Changes will catch up."));
  }
  main.appendChild(toolbar);

  const content = h("div", { class: "calendar-content" });
  main.appendChild(content);

  renderRail(rail, addr);

  const draw = async () => {
    await loadOfficeHours();
    // a server draft reopens the new event dialog with its values
    try {
      const { data } = await api.draft();
      if (data.draft && !document.querySelector("dialog[open]")) {
        const d = data.draft;
        const startLocal = typeof d.start_local === "string" ? String(d.start_local) : joinLocal(fmtDate(localNow()), 9 * 60);
        const endLocal = typeof d.end_local === "string" ? String(d.end_local) : joinLocal(fmtDate(localNow()), 10 * 60);
        openNewEventDialog(startLocal, endLocal, () => void reload(), d);
      }
    } catch {
      /* drafts are best-effort on load */
    }
    await drawGrid(content, view, addr);
    // the focus value in the address puts focus on that event's block
    if (addr.focus) {
      const block = content.querySelector<HTMLElement>(`[data-occ="${CSS.escape(addr.focus)}"]`);
      if (block) {
        block.focus();
        block.scrollIntoView({ block: "center" });
      } else {
        // a slot at its old start holds focus when the event is gone
        const first = content.querySelector<HTMLElement>(".slot");
        first?.focus();
      }
    }
    // an event value in the address opens its quick dialog
    if (addr.event) {
      const occ = state.occurrenceCache.get(addr.event);
      if (occ) {
        openEventDialog(occ, () => {
          navigate("/calendar", { ...addrParams(addr), event: undefined });
          void reload();
        }, content.querySelector<HTMLElement>(`[data-occ="${CSS.escape(addr.event)}"]`) ?? undefined);
      }
    }
  };
  void draw();

  // single-key shortcut events, with undo wired to the last change
  const onNew = () => openNewEventDialog(joinLocal(fmtDate(localNow()), 9 * 60), joinLocal(fmtDate(localNow()), 10 * 60), () => void reload());
  const onUndo = () => document.getElementById("undo-holder")?.querySelector<HTMLButtonElement>("button")?.click();
  const onOpenFocused = () => {
    const focused = content.querySelector<HTMLElement>(".event-block:focus");
    const occId = focused?.dataset.occ;
    if (occId && state.occurrenceCache.has(occId)) {
      const occ = state.occurrenceCache.get(occId)!;
      history.pushState(null, "", `/events/${occ.event_id}?occurrence=${encodeURIComponent(occId)}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  };
  const onDeleteFocused = () => {
    const focused = content.querySelector<HTMLElement>(".event-block:focus");
    const occId = focused?.dataset.occ;
    if (occId && state.occurrenceCache.has(occId)) {
      const occ = state.occurrenceCache.get(occId)!;
      void deleteOccurrence(occ);
    }
  };
  window.addEventListener("wren:new-event", onNew);
  window.addEventListener("wren:undo", onUndo);
  window.addEventListener("wren:open-focused", onOpenFocused);
  window.addEventListener("wren:delete-focused", onDeleteFocused);
}

// deleteOccurrence trashes an event through the same scope rules as its button.
async function deleteOccurrence(o: import("./api").Occurrence): Promise<void> {
  const { announce } = await import("./main");
  announce(`Moving ${o.title} to trash...`);
  try {
    const { data } = await api.getEvent(o.event_id, o.occurrence_id);
    const etag = String(data.version ?? 1);
    const res = await api.deleteEvent(o.event_id, data.rrule ? "all" : "all", o.occurrence_id, etag);
    announce(`Moved ${o.title} to trash.`);
    const { offerUndo } = await import("./dialogs");
    offerUndo(async () => {
      await api.restore(res.data.trash_id);
      announce(`Restored ${o.title}.`);
      void reload();
    });
    void reload();
  } catch (err) {
    announce(err instanceof Error ? err.message : "Something went wrong.");
  }
}

function addrParams(addr: { view: View; date: string; calendars: string[]; event?: string; focus?: string }): Record<string, string | undefined> {
  return {
    view: addr.view,
    date: addr.date,
    calendars: addr.calendars.length ? addr.calendars.join(",") : undefined,
    event: addr.event || undefined,
    focus: addr.focus || undefined,
  };
}

function periodTitle(view: View, date: string): string {
  const d = parseDate(date);
  if (view === "day" || view === "schedule") return fmtLong(d);
  if (view === "month") return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const days = shownDays(view, d);
  return `${fmtLong(days[0])} to ${fmtLong(days[days.length - 1])}`;
}

function shownDays(view: View, d: Date): Date[] {
  const me = state.me!;
  if (view === "day") return [d];
  void me;
  if (view === "week") {
    const start = weekStartFor(me, d);
    const out: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const x = new Date(start);
      x.setDate(x.getDate() + i);
      if (me.hide_weekends && (x.getDay() === 0 || x.getDay() === 6)) continue;
      out.push(x);
    }
    return out;
  }
  if (view === "custom") {
    const out: Date[] = [];
    for (let i = 0; i < (me.custom_days ?? 4); i++) {
      const x = new Date(d);
      x.setDate(x.getDate() + i);
      if (me.hide_weekends && (x.getDay() === 0 || x.getDay() === 6)) continue;
      out.push(x);
    }
    return out;
  }
  return [d];
}

function shiftPeriod(addr: { view: View; date: string; calendars: string[] }, dir: number): void {
  const d = parseDate(addr.date);
  if (addr.view === "month") d.setMonth(d.getMonth() + dir);
  else if (addr.view === "schedule") d.setDate(d.getDate() + 14 * dir);
  else if (addr.view === "week") d.setDate(d.getDate() + 7 * dir);
  else if (addr.view === "custom") d.setDate(d.getDate() + (state.me?.custom_days ?? 4) * dir);
  else d.setDate(d.getDate() + dir);
  navigate("/calendar", { ...addrParams(addr), date: fmtDate(d) });
}

function renderRail(rail: HTMLElement, addr: { view: View; date: string; calendars: string[]; event?: string; focus?: string }): void {
  const isPhone = window.innerWidth < 600;
  if (isPhone) {
    const sheet = dialog("Calendars", "sheet");
    const close = button("Close", { class: "btn ghost", onclick: () => sheet.close() }, "Close");
    sheet.append(close, buildMiniMonth(addr.date), buildCalendarList(addr.calendars));
    rail.append(
      button("Calendars", { class: "btn ghost", onclick: () => sheet.showModal() }, "Calendars"),
      sheet
    );
    return;
  }
  const mini = buildMiniMonth(addr.date);
  const list = buildCalendarList(addr.calendars);
  const group = h("div", { role: "group", "aria-label": "Calendars", class: "calendar-list" }, ...list.childNodes);
  rail.append(mini, group);
}

function buildMiniMonth(date: string): HTMLElement {
  const region = h("section", { role: "region", "aria-label": "Mini month", class: "mini-month" });
  const d = parseDate(date);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const grid = h("div", { class: "mini-grid", role: "grid" });
  for (let i = 0; i < first.getDay(); i++) grid.appendChild(h("span", { class: "mini-pad" }));
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  for (let day = 1; day <= days; day++) {
    const cellDate = new Date(d.getFullYear(), d.getMonth(), day);
    const btn = button(fmtLong(cellDate), {
      class: `mini-day${day === d.getDate() ? " today" : ""}`,
      onclick: () => navigate("/calendar", { view: currentViewParam(), date: fmtDate(cellDate) }),
    }, String(day));
    grid.appendChild(btn);
  }
  region.append(h("div", { class: "mini-title" }, d.toLocaleDateString("en-GB", { month: "long", year: "numeric" })), grid);
  return region;
}

function currentViewParam(): View {
  return (new URLSearchParams(location.search).get("view") ?? "week") as View;
}

function buildCalendarList(selected: string[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const cal of state.calendars) {
    if (cal.level === "none") continue;
    const startsOn = selected.length ? selected.includes(cal.id) : cal.id !== "cal-holidays";
    const box = checkbox(cal.name, startsOn);
    box.addEventListener("change", () => {
      const next = selected.length ? new Set(selected) : new Set(state.calendars.filter((c) => c.id !== "cal-holidays" && c.level !== "none").map((c) => c.id));
      if (box.checked) next.add(cal.id);
      else next.delete(cal.id);
      navigate("/calendar", { view: currentViewParam(), date: currentDateParam(), calendars: Array.from(next).join(",") });
    });
    const label = h("label", { class: "calendar-item" }, box, h("span", { class: `chip chip-${cal.colour}` }), cal.name);
    frag.appendChild(label);
  }
  return frag;
}

function currentDateParam(): string {
  return new URLSearchParams(location.search).get("date") ?? fmtDate(localNow());
}

async function drawGrid(content: HTMLElement, view: View, addr: { view: View; date: string; calendars: string[]; event: string; focus: string }): Promise<void> {
  content.replaceChildren();
  const days = view === "month" ? monthDays(parseDate(addr.date)) : view === "schedule" ? scheduleDays(parseDate(addr.date)) : shownDays(view, parseDate(addr.date));
  const rangeFrom = view === "month" ? fmtDate(monthGridStart(parseDate(addr.date))) : fmtDate(days[0]);
  const rangeTo = view === "month" ? fmtDate(addDays(monthGridStart(parseDate(addr.date)), 42)) : fmtDate(addDays(days[days.length - 1], 1));
  let occs: Occurrence[] = [];
  try {
    const { data } = await api.occurrences(rangeFrom, rangeTo, addr.calendars);
    occs = data.occurrences;
  } catch {
    occs = [];
  }
  for (const o of occs) state.occurrenceCache.set(o.occurrence_id, o);

  if (view === "month") {
    drawMonth(content, occs, parseDate(addr.date));
    return;
  }
  if (view === "schedule") {
    drawSchedule(content, occs, days);
    return;
  }
  drawTimeGrid(content, occs, days, view);
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function monthGridStart(d: Date): Date {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  return addDays(first, -first.getDay());
}

function monthDays(d: Date): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < 42; i++) out.push(addDays(monthGridStart(d), i));
  return out;
}

function scheduleDays(d: Date): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < 14; i++) out.push(addDays(d, i));
  return out;
}

function occurrenceTitle(o: Occurrence): string {
  return o.access === "busy" ? "Busy" : o.title;
}

function occurrenceTimes(o: Occurrence): { start: string; end: string } {
  const start = o.all_day ? 0 : splitLocal(o.start_local).minutes;
  const end = o.all_day ? 0 : splitLocal(o.end_local).minutes;
  return { start: o.all_day ? "" : fmtHM(start), end: o.all_day ? "" : fmtHM(end) };
}

// drawMonth lays the month grid with its +N more control.
function drawMonth(content: HTMLElement, occs: Occurrence[], date: Date): void {
  const region = h("section", { role: "region", "aria-label": "Month grid", class: "month-grid" });
  const byDay = new Map<string, Occurrence[]>();
  for (const o of occs) {
    const dates = occurrenceDates(o);
    for (const d of dates) {
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(o);
    }
  }
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) weeks.push(monthDays(date).slice(w * 7, w * 7 + 7));
  for (const week of weeks) {
    const row = h("div", { class: "month-row" });
    for (const day of week) {
      const ds = fmtDate(day);
      const list = byDay.get(ds) ?? [];
      const cell = h("div", { class: `month-cell${day.getMonth() === date.getMonth() ? "" : " other"}`, role: "gridcell" });
      const headingEl = button(fmtLong(day), { class: "month-day-head", onclick: () => navigate("/calendar", { view: "day", date: ds }) }, String(day.getDate()));
      cell.appendChild(headingEl);
      const holder = h("div", { class: "chips" });
      cell.appendChild(holder);
      row.appendChild(cell);
      const relayout = () => {
        holder.replaceChildren();
        const available = Math.max(1, Math.floor((holder.clientHeight - 4) / 26));
        const shown = list.slice(0, available);
        for (const o of shown) holder.appendChild(monthChip(o, ds));
        if (list.length > shown.length) {
          const more = button(`+${list.length - shown.length} more`, {
            class: "more-btn",
            onclick: () => openDayDialog(ds, list),
          }, `+${list.length - shown.length} more`);
          holder.appendChild(more);
        }
      };
      requestAnimationFrame(relayout);
      (cell as HTMLElement & { relayout?: () => void }).relayout = relayout;
    }
    region.appendChild(row);
  }
  content.appendChild(region);
  const onResize = () => {
    for (const cell of region.querySelectorAll<HTMLElement>(".month-cell")) {
      (cell as HTMLElement & { relayout?: () => void }).relayout?.();
    }
  };
  window.addEventListener("resize", onResize);
}

function occurrenceDates(o: Occurrence): string[] {
  if (o.all_day) {
    const start = o.start_local;
    const end = o.end_local;
    const out: string[] = [];
    let d = parseDate(start);
    const last = parseDate(end);
    while (fmtDate(d) <= fmtDate(last)) {
      out.push(fmtDate(d));
      d = addDays(d, 1);
    }
    return out;
  }
  const utc = o.start_utc;
  if (!utc) return [o.start_local.split("T")[0]];
  const inst = new Date(utc);
  const out = [fmtDate(inst)];
  const endInst = o.end_utc ? new Date(o.end_utc) : null;
  if (endInst && fmtDate(endInst) !== out[0]) {
    const span = splitLocal(o.start_local).date;
    out.push(fmtDate(endInst));
    void span;
  }
  return out;
}

function monthChip(o: Occurrence, ds: string): HTMLElement {
  const warn = (o.zone_warnings ?? []).length > 0;
  const chip = button(`${occurrenceTitle(o)}, ${fmtLong(parseDate(ds))}`, {
    class: `chip chip-${o.colour ?? "calendar"}${warn ? " warned" : ""}`,
    onclick: () => openEventDialog(o, () => location.reload()),
  }, occurrenceTitle(o));
  if (warn) chip.appendChild(h("img", { src: "/static/icons/warn.svg", alt: "Zone rule warning", class: "warn-icon" }));
  return chip;
}

function openDayDialog(ds: string, list: Occurrence[]): void {
  const dlg = dialog(`Events on ${fmtLong(parseDate(ds))}`);
  const listEl = h("ul", { "aria-label": `Events on ${fmtLong(parseDate(ds))}`, class: "day-list" });
  for (const o of list) {
    const times = occurrenceTimes(o);
    const row = h("li", null,
      button(`${occurrenceTitle(o)}, ${times.start} to ${times.end}`, {
        onclick: () => { dlg.close(); openEventDialog(o, () => location.reload()); },
      }, occurrenceTitle(o))
    );
    listEl.appendChild(row);
  }
  const close = button("Close", { class: "btn ghost", onclick: () => { dlg.close(); dlg.remove(); } }, "Close");
  dlg.append(listEl, close);
  document.body.appendChild(dlg);
  dlg.showModal();
  focusTrap(dlg);
  dlg.addEventListener("close", () => dlg.remove());
}

// drawSchedule lists the 14 days as the schedule.
function drawSchedule(content: HTMLElement, occs: Occurrence[], days: Date[]): void {
  const list = h("ul", { role: "list", "aria-label": "Schedule", class: "schedule" });
  const byDay = new Map<string, Occurrence[]>();
  for (const o of occs) {
    for (const d of occurrenceDates(o)) {
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(o);
    }
  }
  let any = false;
  for (const day of days) {
    const ds = fmtDate(day);
    const listForDay = byDay.get(ds) ?? [];
    if (listForDay.length === 0) continue;
    any = true;
    const head = button(fmtLong(day), { class: "schedule-day" }, fmtLong(day));
    head.addEventListener("keydown", scheduleKeys(head, days, ds));
    const ul = h("ul", { class: "schedule-items" });
    for (const o of listForDay) {
      const times = occurrenceTimes(o);
      ul.appendChild(h("li", null,
        button(`${occurrenceTitle(o)}, ${times.start} to ${times.end}`, {
          class: "schedule-item",
          onclick: () => openEventDialog(o, () => location.reload()),
        }, occurrenceTitle(o), h("span", { class: "schedule-time" }, o.all_day ? "All day" : `${times.start} to ${times.end}`))
      ));
    }
    list.append(h("li", null, head, ul));
  }
  if (!any) list.appendChild(h("li", { class: "empty" }, "Nothing scheduled in this period."));
  content.appendChild(list);
}

function scheduleKeys(head: HTMLElement, days: Date[], ds: string): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    const idx = days.findIndex((d) => fmtDate(d) === ds);
    let target = -1;
    if (e.key === "ArrowDown") target = Math.min(days.length - 1, idx + 1);
    else if (e.key === "ArrowUp") target = Math.max(0, idx - 1);
    else if (e.key === "Home") target = 0;
    else if (e.key === "End") target = days.length - 1;
    if (target < 0) return;
    const next = head.closest("ul")?.querySelectorAll(`[aria-label="${fmtLong(days[target])}"]`)[0] as HTMLElement | undefined;
    if (next) {
      e.preventDefault();
      next.scrollIntoView({ block: "nearest" });
      next.focus();
    }
  };
}

export async function reload(): Promise<void> {
  await route0();
}

async function route0(): Promise<void> {
  const app = document.getElementById("app")!;
  app.replaceChildren();
  const q = new URLSearchParams(location.search);
  // re-render via the router without a new history entry
  const { route } = await import("./main");
  void route;
  renderCalendar(app, q);
}
