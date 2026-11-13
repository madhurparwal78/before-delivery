import {
  addDays, DAY, daysBetween, instantOfWall, MINUTE, parseDate, parseWall, ZONES, dateOf, timeOf, wallInZone, weekday,
  type Wall,
} from "./time";
import type { ClockEntry, Hours, Item, Me, Zone } from "./types";
import { CITY_OF } from "./time";

export type ViewName = "day" | "week" | "month" | "custom" | "schedule";
export const VIEWS: ViewName[] = ["day", "week", "month", "custom", "schedule"];
export const SLOT = 24;
export const SLOTS_PER_DAY = 96;

export interface CalState {
  view: ViewName;
  date: string;
  calendars: string[] | null;
  event: string | null;
  focus: string | null;
}

export function isPhone(): boolean {
  return innerWidth < 600;
}

export function parseState(query: URLSearchParams, today: string): CalState {
  const raw = query.get("view");
  const asked = VIEWS.find((v) => v === raw);
  const phone = isPhone();
  const fallback: ViewName = phone ? "schedule" : "week";
  let view = asked ?? fallback;
  if (phone && view !== "schedule" && view !== "day") view = "schedule";
  const date = parseDate(query.get("date") ?? "") !== null ? (query.get("date") as string) : today;
  const calendars = query.get("calendars");
  return {
    view,
    date,
    calendars: calendars === null ? null : calendars.split(",").filter(Boolean),
    event: query.get("event"),
    focus: query.get("focus"),
  };
}

const START_DAY = { monday: 1, sunday: 0, saturday: 6 } as const;

export function weekBegin(date: string, me: Me): string {
  return addDays(date, -((weekday(date) - START_DAY[me.week_start] + 7) % 7));
}

const isWeekend = (date: string) => weekday(date) === 0 || weekday(date) === 6;

/** The columns of a Day, Week or Custom days grid. */
export function shownDays(state: CalState, me: Me): string[] {
  if (state.view === "day") return [state.date];
  if (state.view === "week") {
    const first = weekBegin(state.date, me);
    const days = Array.from({ length: 7 }, (_, i) => addDays(first, i));
    return me.hide_weekends ? days.filter((d) => !isWeekend(d)) : days;
  }
  const days: string[] = [];
  for (let i = 0; days.length < me.custom_days; i++) {
    const d = addDays(state.date, i);
    if (!(me.hide_weekends && isWeekend(d))) days.push(d);
  }
  return days;
}

export function monthCells(date: string, me: Me): string[] {
  const first = date.slice(0, 8) + "01";
  const begin = weekBegin(first, me);
  const last = dateOf(Date.UTC(+date.slice(0, 4), +date.slice(5, 7), 0));
  const rows = Math.ceil((daysBetween(begin, last) + 1) / 7);
  return Array.from({ length: rows * 7 }, (_, i) => addDays(begin, i));
}

export function fetchRange(state: CalState, me: Me): { from: string; to: string } {
  if (state.view === "month") {
    const cells = monthCells(state.date, me);
    return { from: cells[0], to: addDays(cells[cells.length - 1], 1) };
  }
  if (state.view === "schedule") return { from: state.date, to: addDays(state.date, 14) };
  const days = shownDays(state, me);
  return { from: days[0], to: addDays(days[days.length - 1], 1) };
}

interface Span {
  start: Wall;
  end: Wall;
}

/** An occurrence's times on the viewer's clock; an event in the viewer's own zone reads its shown local times. */
export function viewerSpan(item: Item, me: Me): Span {
  if (item.all_day) return { start: parseDate(item.start_local) as Wall, end: parseDate(item.end_local) as Wall };
  if (item.zone === me.zone || item.start_utc === null || item.end_utc === null) {
    return { start: parseWall(item.start_local) as Wall, end: parseWall(item.end_local) as Wall };
  }
  return { start: wallInZone(Date.parse(item.start_utc), me.zone), end: wallInZone(Date.parse(item.end_utc), me.zone) };
}

export function itemKey(item: Item): string {
  return item.occurrence_id ?? (item.id as string);
}

export function eventIdOf(item: Item): string {
  return item.event_id ?? (item.id as string);
}

export function label(item: Item, me: Me): string {
  if (item.all_day) return `${item.title}, all day`;
  const span = viewerSpan(item, me);
  return `${item.title}, ${timeOf(span.start)} to ${timeOf(span.end)}`;
}

export interface Seg {
  item: Item;
  day: string;
  from: number;
  to: number;
  key: string;
}

/** Splits timed occurrences of under 24 hours into one segment per viewer day. */
export function segments(items: Item[], me: Me): { timed: Seg[]; band: { item: Item; first: string; last: string }[] } {
  const timed: Seg[] = [];
  const band: { item: Item; first: string; last: string }[] = [];
  for (const item of items) {
    const span = viewerSpan(item, me);
    if (item.all_day) {
      band.push({ item, first: dateOf(span.start), last: dateOf(span.end) });
      continue;
    }
    if (span.end - span.start >= DAY) {
      band.push({ item, first: dateOf(span.start), last: dateOf(span.end - 1) });
      continue;
    }
    const firstDay = dateOf(span.start);
    const lastDay = dateOf(span.end - 1);
    for (let d = firstDay; d <= lastDay; d = addDays(d, 1)) {
      const midnight = parseDate(d) as number;
      const from = Math.max(span.start, midnight);
      const to = Math.min(span.end, midnight + DAY);
      timed.push({ item, day: d, from: (from - midnight) / MINUTE, to: (to - midnight) / MINUTE, key: `${itemKey(item)}|${d}` });
    }
  }
  return { timed, band };
}

interface Placed {
  seg: Seg;
  lane: number;
  lanes: number;
}

/** Overlapping events form a group; longest first, then earliest start, then id; each takes the leftmost free lane. */
export function layoutDay(segs: Seg[]): Placed[] {
  const byStart = [...segs].sort((a, b) => a.from - b.from || a.to - b.to);
  const groups: Seg[][] = [];
  let reach = -1;
  for (const s of byStart) {
    if (groups.length === 0 || s.from >= reach) {
      groups.push([s]);
      reach = s.to;
    } else {
      groups[groups.length - 1].push(s);
      reach = Math.max(reach, s.to);
    }
  }
  const out: Placed[] = [];
  for (const group of groups) {
    const order = [...group].sort(
      (a, b) => b.to - b.from - (a.to - a.from) || a.from - b.from || (eventIdOf(a.item) < eventIdOf(b.item) ? -1 : 1),
    );
    const placed: { seg: Seg; lane: number }[] = [];
    for (const s of order) {
      let lane = 0;
      while (placed.some((p) => p.lane === lane && p.seg.from < s.to && s.from < p.seg.to)) lane++;
      placed.push({ seg: s, lane });
    }
    const lanes = Math.max(...placed.map((p) => p.lane)) + 1;
    for (const p of placed) out.push({ seg: p.seg, lane: p.lane, lanes });
  }
  return out;
}

/** The working-hours rule: a start is inside from opening until closing, an end after opening until closing. */
function inside(hours: Hours, wall: Wall, isEnd: boolean): boolean {
  const dayNumber = ((new Date(wall).getUTCDay() + 6) % 7) + 1;
  if (!hours.days.includes(dayNumber)) return false;
  const t = timeOf(wall);
  return isEnd ? t > hours.open && t <= hours.close : t >= hours.open && t < hours.close;
}

/** Three clock readings for one instant, as the ribbon shows them while dragging. */
export function clocksAt(instant: number, hours: Record<Zone, Hours>, isEnd: boolean): ClockEntry[] {
  return ZONES.map((zone) => {
    const wall = wallInZone(instant, zone);
    return { city: CITY_OF[zone], time: timeOf(wall), date: dateOf(wall), inside_hours: inside(hours[zone], wall, isEnd) };
  });
}

export function viewerInstant(wall: Wall, me: Me): number {
  return instantOfWall(wall, me.zone);
}

export function minutesLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}


/** At tablet and desktop the grids fit the room under the toolbar and rail, so those stay on the first screen. */
export function syncGridRoom(): void {
  const body = document.querySelector(".cal-body");
  if (!body) return;
  const room = innerHeight - (body.getBoundingClientRect().top + scrollY) - 8;
  document.documentElement.style.setProperty("--grid-room", `${Math.max(room, 360)}px`);
}

export function syncToolbarHeight(): void {
  const head = document.querySelector<HTMLElement>(".cal-head");
  const sticky = head !== null && getComputedStyle(head).position === "sticky";
  document.documentElement.style.setProperty("--toolbar-h", `${sticky && head ? head.getBoundingClientRect().height : 0}px`);
}
