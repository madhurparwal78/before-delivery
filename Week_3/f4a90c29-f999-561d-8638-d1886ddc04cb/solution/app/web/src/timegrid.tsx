import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  SLOT, SLOTS_PER_DAY, syncGridRoom, syncToolbarHeight, clocksAt, eventIdOf, itemKey, label, layoutDay, minutesLabel, segments, viewerInstant, viewerSpan,
  type Seg,
} from "./cal";
import { ThreeClocks, clockLine } from "./clocks";
import { askScope, clearUndo, offerUndo, saveEvent, versionFor, type Scope } from "./eventsvc";
import { announce } from "./status";
import { bump } from "./state";
import { CITY_OF, DAY, MINUTE, apiWall, instantOfWall, parseWall, dateOf, dayLabel, parseDate, prefersReducedMotion, shortDayLabel, timeOf, wallInZone, weekday, WEEKDAYS, type Wall } from "./time";
import { WarningMark, anyDialogOpen } from "./ui";
import type { CalendarInfo, ClockEntry, Hours, Item, Me, Zone } from "./types";

export function colourVar(item: Item, calendars: CalendarInfo[]): string {
  const own = item.colour && item.colour !== "calendar" ? item.colour : calendars.find((c) => c.id === item.calendar_id)?.colour ?? "indigo";
  return `var(--c-${own})`;
}

function canEdit(item: Item): boolean {
  return item.access === "full";
}

type DragKind = "move" | "top" | "bottom";

interface Drag {
  kind: DragKind;
  seg: Seg;
  startX: number;
  startY: number;
  dMin: number;
  dDay: number;
  moved: boolean;
  lanes: { lane: number; lanes: number };
}

interface Create {
  day: string;
  from: number;
  to: number;
}

interface Props {
  days: string[];
  items: Item[];
  me: Me;
  hours: Record<Zone, Hours> | null;
  calendars: CalendarInfo[];
  regionLabel: string;
  today: string;
  now: number;
  focusKey: string | null;
  onOpen: (item: Item, ribbon: DOMRect | null, id?: string) => Promise<void> | void;
  onCreate: (day: string, from: number, to: number) => void;
  onSlotDeleteFocus: (fn: (() => void) | null) => void;
}

const SLOT_MIN = 15;
/** The ribbon's drawn size, from .tc-ribbon, to choose the side of the block where it covers nothing. */
const RIBBON_W = 281;
const RIBBON_H = 91;

/** At tablet and desktop the grid scrolls inside itself; at phone width the page scrolls. */
function scrollsItself(root: HTMLElement): boolean {
  return getComputedStyle(root).overflowY === "auto";
}

/** How far the sticky headings reach down the scrolling area once they are stuck. */
function stickyBottom(root: HTMLElement): number {
  const top = root.querySelector<HTMLElement>(".tg-top");
  if (!top) return 0;
  return (scrollsItself(root) ? 0 : parseFloat(getComputedStyle(top).top)) + top.getBoundingClientRect().height;
}

/** Brings an element fully into view, clear of the sticky headings. */
export function reveal(el: HTMLElement, stickyBottomPx: number): void {
  if (el.closest(".tg-top")) return;
  const grid = el.closest<HTMLElement>(".tg");
  const scroller = grid && scrollsItself(grid) ? grid : null;
  const area = scroller?.getBoundingClientRect();
  const top = (area?.top ?? 0) + stickyBottomPx + 2;
  const bottom = (area?.bottom ?? innerHeight) - 4;
  const rect = el.getBoundingClientRect();
  const by = (distance: number) => (scroller ? scroller.scrollBy(0, distance) : scrollBy(0, distance));
  if (rect.top < top) by(rect.top - top);
  else if (rect.bottom > bottom) by(Math.min(rect.bottom - bottom, rect.top - top));
  scroller?.scrollIntoView({ block: "nearest" });
}

export function TimeGrid(props: Props) {
  const { days, items, me, hours, calendars, today, now } = props;
  const root = useRef<HTMLElement>(null);
  const [slot, setSlot] = useState<{ day: string; min: number }>({ day: days[0], min: 9 * 60 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [create, setCreate] = useState<Create | null>(null);
  const [ribbonKey, setRibbonKey] = useState<string | null>(null);
  const focused = useRef<{ key: string; series: string; day: string; min: number } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const creating = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const scopeMemo = useRef<{ series: string; scope: Scope } | null>(null);
  const handledFocus = useRef<string | null>(null);

  const { timed, band } = useMemo(() => segments(items, me), [items, me]);
  const byDay = useMemo(() => {
    const out = new Map<string, ReturnType<typeof layoutDay>>();
    for (const d of days) out.set(d, layoutDay(timed.filter((s) => s.day === d)));
    return out;
  }, [timed, days]);

  const secondZone = me.second_zone;
  const dayIndex = (d: string) => days.indexOf(d);

  useEffect(() => {
    if (!days.includes(slot.day)) setSlot({ day: days[0], min: slot.min });
  }, [days]);

  // First draw: the 09:00 row sits at the top of the scrolling area, clear of the sticky headings.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || props.focusKey) return;
    syncToolbarHeight();
    syncGridRoom();
    const body = el.querySelector<HTMLElement>(".tg-body");
    if (!body) return;
    if (scrollsItself(el)) el.scrollTop = body.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop + 9 * 4 * SLOT - stickyBottom(el);
    else scrollTo(0, body.getBoundingClientRect().top + scrollY + 9 * 4 * SLOT - stickyBottom(el));
  }, []);

  useLayoutEffect(() => {
    const el = root.current;
    if (el) el.style.setProperty("--sticky", `${Math.ceil(stickyBottom(el))}px`);
  });

  // Keep focus on the same event across a redraw, or on its old slot when it is gone.
  useLayoutEffect(() => {
    const el = root.current;
    const f = focused.current;
    if (!el || !f || anyDialogOpen()) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && el.contains(active)) {
      if (active.classList.contains("blk")) {
        reveal(active, stickyBottom(el));
        focused.current = { key: active.dataset.key ?? "", series: active.dataset.series ?? "", day: active.dataset.day ?? "", min: Number(active.dataset.min) };
      }
      return;
    }
    const target =
      el.querySelector<HTMLElement>(`[data-fk="blk:${CSS.escape(f.key)}"]`) ??
      [...el.querySelectorAll<HTMLElement>(".blk")].find((b) => b.dataset.series === f.series && b.dataset.day === f.day) ??
      el.querySelector<HTMLElement>(`[data-day="${f.day}"][data-min="${Math.floor(f.min / SLOT_MIN) * SLOT_MIN}"]`);
    if (target) {
      target.focus();
      if (!target.classList.contains("blk")) setSlot({ day: f.day, min: Math.floor(f.min / SLOT_MIN) * SLOT_MIN });
    }
  }, [items]);

  // A focus address value puts focus on that event's block, fully in view.
  useLayoutEffect(() => {
    const el = root.current;
    const key = props.focusKey;
    if (!el || !key || handledFocus.current === key) return;
    const target = el.querySelector<HTMLElement>(`[data-fk="blk:${CSS.escape(key)}"]`);
    if (target) {
      handledFocus.current = key;
      target.focus();
      reveal(target, stickyBottom(el));
    }
  }, [items, props.focusKey]);

  // After a long press starts a drag, a moving finger drags the event instead of scrolling the page.
  useEffect(() => {
    const hold = (event: TouchEvent) => {
      if ((dragRef.current || creating.current) && event.cancelable) event.preventDefault();
    };
    addEventListener("touchmove", hold, { passive: false });
    return () => removeEventListener("touchmove", hold);
  }, []);

  useEffect(() => {
    const clear = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target && !target.closest?.(".blk")) focused.current = null;
    };
    document.addEventListener("pointerdown", clear, true);
    document.addEventListener("focusin", clear, true);
    return () => {
      document.removeEventListener("pointerdown", clear, true);
      document.removeEventListener("focusin", clear, true);
    };
  }, []);

  const colGeometry = (): DOMRect[] => [...(root.current?.querySelectorAll<HTMLElement>(".tg-evcol") ?? [])].map((c) => c.getBoundingClientRect());

  /** The span a block shows after a pending drag. */
  const dragged = (seg: Seg): { day: string; from: number; to: number } | null => {
    if (!drag || drag.seg.key !== seg.key) return null;
    let from = seg.from;
    let to = seg.to;
    if (drag.kind === "move") {
      from = Math.min(Math.max(seg.from + drag.dMin, 0), 1440 - (seg.to - seg.from));
      to = from + (seg.to - seg.from);
    } else if (drag.kind === "top") from = Math.min(Math.max(seg.from + drag.dMin, 0), seg.to - SLOT_MIN);
    else to = Math.max(Math.min(seg.to + drag.dMin, 1440), seg.from + SLOT_MIN);
    const di = Math.min(Math.max(dayIndex(seg.day) + drag.dDay, 0), days.length - 1);
    return { day: days[di], from, to };
  };

  const ribbonClocks = (): ClockEntry[] | null => {
    if (!drag || !hours) return null;
    const shown = dragged(drag.seg);
    if (!shown) return null;
    const midnight = parseDate(shown.day) as Wall;
    const edge = drag.kind === "bottom" ? shown.to : shown.from;
    return clocksAt(viewerInstant(midnight + edge * MINUTE, me), hours, drag.kind === "bottom");
  };

  // The three-clock line is announced on each snap under reduced motion.
  const lastLine = useRef("");
  const liveClocks = ribbonClocks();
  useEffect(() => {
    if (liveClocks && prefersReducedMotion()) {
      const line = clockLine(liveClocks);
      if (line !== lastLine.current) {
        lastLine.current = line;
        announce(line);
      }
    }
    if (!liveClocks) lastLine.current = "";
  });

  // ---- committing a move or resize ----

  // What this browser just saved per event, until a redraw catches up, so quick key presses build on each other.
  const recent = useRef(new Map<string, { start: Wall; end: Wall; at: number }>());

  const commit = async (item: Item, kind: DragKind, dDay: number, dMin: number, keyboard: boolean, opened?: (id: string) => Promise<void> | void) => {
    // Days and minutes move the event's own clock, so a move across a daylight change keeps its clock time.
    const key = itemKey(item);
    const before = recent.current.get(key);
    const known = keyboard && before && Date.now() - before.at < 5000 ? before : null;
    const wasStart = known?.start ?? (parseWall(item.start_local) as Wall);
    const wasEnd = known?.end ?? (parseWall(item.end_local) as Wall);
    let eventStart = wasStart;
    let eventEnd = wasEnd;
    if (kind === "move") {
      eventStart = wasStart + dDay * DAY + dMin * MINUTE;
      eventEnd = wasEnd + dDay * DAY + dMin * MINUTE;
    } else if (kind === "top") eventStart = wasStart + dMin * MINUTE;
    else eventEnd = wasEnd + dMin * MINUTE;
    if (eventEnd - eventStart < SLOT_MIN * MINUTE) {
      announce("Events are at least 15 minutes long.");
      return undefined;
    }
    const recurring = Boolean(item.rrule);
    let scope: Scope | undefined;
    if (recurring) {
      const memo = scopeMemo.current;
      if (keyboard && memo && memo.series === (item.series_id ?? "")) scope = memo.scope;
      else {
        const asked = await askScope("edit", item.title);
        if (asked === null) {
          setDrag(null);
          return;
        }
        scope = asked;
        if (keyboard) scopeMemo.current = { series: item.series_id ?? "", scope };
      }
    }
    const patch = { start_local: apiWall(eventStart), end_local: apiWall(eventEnd) };
    try {
      const saved = await saveEvent({
        id: eventIdOf(item), title: item.title, version: versionFor(eventIdOf(item), item.version as number), patch, scope,
        occurrenceId: recurring ? itemKey(item) : undefined,
      });
      if (!saved) return;
      recent.current.set(key, { start: eventStart, end: eventEnd, at: Date.now() });
      const edge = kind === "bottom" ? eventEnd : eventStart;
      const text = `${timeOf(wallInZone(instantOfWall(edge, item.zone), me.zone))} ${me.city}`;
      const message = kind === "bottom" ? `Resized ${item.title} to end at ${text}.` : `Moved ${item.title} to ${text}.`;
      if (scope === "following") clearUndo();
      else offerUndo({ title: item.title, eventId: saved.event.id as string, version: saved.event.version as number, trashId: null });
      if (keyboard) setRibbonKey(itemKey(item));
      bump();
      // An edit of the series re-keys the occurrence; the quick dialog opens on the occurrence as it now is.
      const [eventId, occurrenceKey] = key.split("@");
      const openId = occurrenceKey && kind !== "bottom" && scope !== "this"
        ? `${saved.split ? saved.split.later_id : eventId}@${apiWall(eventStart).replaceAll("-", "").replace(":", "")}`
        : key;
      await opened?.(openId);
      announce(message);
      return saved;
    } catch {
      setDrag(null);
    }
    return undefined;
  };

  const enqueue = (print: () => Promise<unknown>) => {
    queue.current = queue.current.then(async () => void (await print())).catch(() => undefined);
  };

  // ---- pointer: move, resize, create ----

  const startDrag = (event: PointerEvent, seg: Seg, kind: DragKind, lanes: { lane: number; lanes: number }) => {
    const state: Drag = { kind, seg, startX: event.clientX, startY: event.clientY, dMin: 0, dDay: 0, moved: false, lanes };
    dragRef.current = state;
    setDrag(state);
    const item = seg.item;
    const columns = colGeometry();
    const width = columns[0]?.width ?? 1;
    let cancelled = false;
    const move = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur || cancelled) return;
      const dMin = Math.round((e.clientY - cur.startY) / SLOT) * SLOT_MIN;
      const dDay = kind === "move" ? Math.round((e.clientX - cur.startX) / (width + 2)) : 0;
      const moved = cur.moved || Math.abs(e.clientX - cur.startX) > 3 || Math.abs(e.clientY - cur.startY) > 3;
      let limit = false;
      if (kind === "bottom" && seg.to + dMin < seg.from + SLOT_MIN) limit = true;
      if (kind === "top" && seg.from + dMin > seg.to - SLOT_MIN) limit = true;
      if (limit && !cur.moved) announce("Events are at least 15 minutes long.");
      else if (limit && (cur.dMin !== dMin)) announce("Events are at least 15 minutes long.");
      const next = { ...cur, dMin, dDay, moved };
      dragRef.current = next;
      setDrag(next);
    };
    const finish = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", abort);
      removeEventListener("keydown", key, true);
    };
    const abort = () => {
      cancelled = true;
      dragRef.current = null;
      setDrag(null);
      finish();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        abort();
      }
    };
    const up = () => {
      const cur = dragRef.current;
      finish();
      dragRef.current = null;
      if (!cur || cancelled) return;
      const ribbon = root.current?.querySelector(".tc-ribbon")?.getBoundingClientRect() ?? null;
      if (!cur.moved || (cur.dMin === 0 && cur.dDay === 0)) {
        setDrag(null);
        props.onOpen(item, null);
        return;
      }
      const shown = dragged2(cur);
      enqueue(async () => {
        const dDay = dayIndex(shown.day) - dayIndex(seg.day);
        await commit(item, kind, dDay, kind === "bottom" ? shown.to - seg.to : shown.from - seg.from, false, (id) => {
          setDrag(null);
          return props.onOpen(item, ribbon, id);
        });
        setDrag(null);
      });
    };
    const dragged2 = (cur: Drag) => {
      let from = seg.from;
      let to = seg.to;
      if (cur.kind === "move") {
        from = Math.min(Math.max(seg.from + cur.dMin, 0), 1440 - (seg.to - seg.from));
        to = from + (seg.to - seg.from);
      } else if (cur.kind === "top") from = Math.min(Math.max(seg.from + cur.dMin, 0), seg.to - SLOT_MIN);
      else to = Math.max(Math.min(seg.to + cur.dMin, 1440), seg.from + SLOT_MIN);
      const di = Math.min(Math.max(dayIndex(seg.day) + cur.dDay, 0), days.length - 1);
      return { day: days[di], from, to };
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", abort);
    addEventListener("keydown", key, true);
  };

  const onBlockPointerDown = (event: PointerEvent, seg: Seg, lanes: { lane: number; lanes: number }) => {
    if (event.button !== 0 || innerWidth < 600 || !canEdit(seg.item) || seg.item.all_day) return;
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const edge = Math.min(8, rect.height / 3);
    const kind: DragKind = event.clientY - rect.top <= edge ? "top" : rect.bottom - event.clientY <= edge ? "bottom" : "move";
    if (event.pointerType === "touch") {
      const timer = setTimeout(() => startDrag(event, seg, kind, lanes), 500);
      const cancel = () => clearTimeout(timer);
      addEventListener("pointerup", cancel, { once: true });
      addEventListener("pointermove", cancel, { once: true });
      return;
    }
    event.preventDefault();
    el.focus({ preventScroll: true });
    startDrag(event, seg, kind, lanes);
  };

  const onCellPointerDown = (event: PointerEvent, day: string, min: number) => {
    if (event.button !== 0 || innerWidth < 600) return;
    const begin = () => {
      let state: Create = { day, from: min, to: min };
      creating.current = true;
      setCreate(state);
      const move = (e: PointerEvent) => {
        const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-min]");
        if (hit && hit.dataset.day === day) {
          state = { day, from: min, to: Number(hit.dataset.min) };
          setCreate(state);
        }
      };
      const up = () => {
        removeEventListener("pointermove", move);
        removeEventListener("pointerup", up);
        creating.current = false;
        setCreate(null);
        if (state.to !== state.from) {
          const a = Math.min(state.from, state.to);
          const b = Math.max(state.from, state.to) + SLOT_MIN;
          props.onCreate(day, a, b);
        }
      };
      addEventListener("pointermove", move);
      addEventListener("pointerup", up);
    };
    if (event.pointerType === "touch") {
      const timer = setTimeout(begin, 500);
      addEventListener("pointerup", () => clearTimeout(timer), { once: true });
      return;
    }
    begin();
  };

  // ---- keyboard ----

  const onSlotKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (!target.dataset.min) return;
    const col = dayIndex(target.dataset.day as string);
    let min = Number(target.dataset.min);
    let next = col;
    switch (event.key) {
      case "ArrowDown": min = Math.min(min + SLOT_MIN, 1440 - SLOT_MIN); break;
      case "ArrowUp": min = Math.max(min - SLOT_MIN, 0); break;
      case "ArrowRight": next = Math.min(col + 1, days.length - 1); break;
      case "ArrowLeft": next = Math.max(col - 1, 0); break;
      case "Home": if (event.ctrlKey) min = 0; next = 0; break;
      case "End": if (event.ctrlKey) min = 1440 - SLOT_MIN; next = days.length - 1; break;
      case "Enter": event.preventDefault(); props.onCreate(days[col], min, min + SLOT_MIN); return;
      default: return;
    }
    event.preventDefault();
    const cell = root.current?.querySelector<HTMLElement>(`[data-day="${days[next]}"][data-min="${min}"]`);
    setSlot({ day: days[next], min });
    if (cell) {
      cell.focus({ preventScroll: true });
      reveal(cell, stickyBottom(root.current as HTMLElement));
    }
  };

  const onBlockKey = (event: KeyboardEvent, seg: Seg) => {
    if (!event.altKey || !event.key.startsWith("Arrow") || !canEdit(seg.item) || seg.item.all_day) return;
    event.preventDefault();
    const key = event.key;
    let kind: DragKind = "move";
    let dMin = 0;
    let dDay = 0;
    if (event.shiftKey) {
      if (key !== "ArrowUp" && key !== "ArrowDown") return;
      kind = "bottom";
      dMin = key === "ArrowUp" ? -SLOT_MIN : SLOT_MIN;
    } else if (key === "ArrowUp" || key === "ArrowDown") dMin = key === "ArrowUp" ? -SLOT_MIN : SLOT_MIN;
    else dDay = key === "ArrowLeft" ? -1 : 1;
    const item = seg.item;
    enqueue(async () => {
      const fresh = latest.current.find((i) => itemKey(i) === itemKey(item)) ?? item;
      const saved = await commit(fresh, kind, dDay, dMin, true);
      if (saved && prefersReducedMotion() && hours) {
        const stored = recent.current.get(itemKey(item));
        if (stored) {
          const edge = kind === "bottom" ? stored.end : stored.start;
          announce(clockLine(clocksAt(instantOfWall(edge, item.zone), hours, kind === "bottom")));
        }
      }
    });
  };

  const latest = useRef(items);
  latest.current = items;
  useLayoutEffect(() => recent.current.clear(), [items]);
  const latestSegs = useRef(timed);
  latestSegs.current = timed;

  // ---- render ----

  const dayStyle = { "--cols": String(days.length), "--slot": `${SLOT}px` } as Record<string, string>;
  const nowDate = dateOf(wallInZone(now, me.zone));
  const nowMin = ((wallInZone(now, me.zone) - (parseDate(nowDate) as Wall)) / MINUTE) | 0;
  const nowText = timeOf(wallInZone(now, me.zone));
  const hoursList = Array.from({ length: 24 }, (_, h) => h);

  const bandRows = useMemo(() => {
    const rows: { item: Item; first: number; last: number; row: number }[] = [];
    const free: number[][] = [];
    for (const b of band) {
      const first = Math.max(dayIndex(b.first < days[0] ? days[0] : b.first), 0);
      const lastIdx = days.indexOf(b.last > days[days.length - 1] ? days[days.length - 1] : b.last);
      if (b.last < days[0] || b.first > days[days.length - 1] || lastIdx < 0 || dayIndex(b.first < days[0] ? days[0] : b.first) < 0) continue;
      let row = 0;
      while (free[row]?.some((c) => c >= first && c <= lastIdx)) row++;
      (free[row] ??= []).push(...Array.from({ length: lastIdx - first + 1 }, (_, i) => first + i));
      rows.push({ item: b.item, first, last: lastIdx, row });
    }
    return rows;
  }, [band, days]);

  const ribbonAt = (lanes: { lane: number; lanes: number }, shown: { day: string; from: number; to: number }): Record<string, string> => {
    const cols = colGeometry();
    const col = cols[Math.max(dayIndex(shown.day), 0)];
    if (!col) return {};
    const after = col.left + (col.width * (lanes.lane + 1)) / lanes.lanes + 8;
    const before = col.left + (col.width * lanes.lane) / lanes.lanes - RIBBON_W - 8;
    const top = col.top + (shown.from / SLOT_MIN) * SLOT;
    const others = [...(root.current?.querySelectorAll<HTMLElement>(".blk:not(.dragging)") ?? [])].map((b) => b.getBoundingClientRect());
    const covers = (x: number) => others.some((b) => b.left < x + RIBBON_W && b.right > x && b.top < top + RIBBON_H && b.bottom > top);
    const beforeFits = before >= cols[0].left;
    const useBefore = after + RIBBON_W > innerWidth || (beforeFits && covers(after) && !covers(before));
    return { position: "fixed", left: `${Math.max(useBefore ? before : after, 8)}px`, top: `${top}px`, zIndex: "6" };
  };

  const renderBlock = (placed: ReturnType<typeof layoutDay>[number]) => {
    const { seg, lane, lanes } = placed;
    const item = seg.item;
    const shown = dragged(seg);
    const from = shown?.from ?? seg.from;
    const to = shown?.to ?? seg.to;
    const warned = (item.zone_warnings?.length ?? 0) > 0;
    const style = {
      top: `${(from / SLOT_MIN) * SLOT}px`,
      height: `${((to - from) / SLOT_MIN) * SLOT}px`,
      left: `${(lane / lanes) * 100}%`,
      width: `${100 / lanes}%`,
      background: item.access === "busy" ? "var(--c-busy)" : colourVar(item, calendars),
    };
    return { shown, node: (
      <button
        type="button"
        class={`blk${to - from >= 45 ? " tall" : ""}${shown ? " dragging" : ""}${item.access === "busy" ? " busy" : ""}`}
        key={seg.key}
        data-fk={`blk:${itemKey(item)}`}
        data-key={itemKey(item)}
        data-series={item.series_id ?? ""}
        data-day={seg.day}
        data-min={from}
        aria-label={label(item, me)}
        style={shown ? { ...style, left: `${(lane / lanes) * 100}%` } : style}
        onPointerDown={(e) => onBlockPointerDown(e, seg, { lane, lanes })}
        onClick={(e) => {
          if (e.detail === 0) props.onOpen(item, null);
        }}
        onKeyDown={(e) => onBlockKey(e, seg)}
        onFocus={() => {
          focused.current = { key: itemKey(item), series: item.series_id ?? "", day: seg.day, min: seg.from };
        }}
        onBlur={(e) => {
          const next = e.relatedTarget as HTMLElement | null;
          if (!anyDialogOpen() && !(next && next.closest(".blk") === e.currentTarget)) {
            scopeMemo.current = null;
            setRibbonKey((k) => (k === itemKey(item) ? null : k));
          }
        }}
      >
        <span class="blk-text">
          <span class="blk-title">{item.title}</span>{" "}
          {!shown && to - from >= 30 && (
            <span class="blk-time" aria-hidden="true">{timeOf(viewerSpan(item, me).start)} to {timeOf(viewerSpan(item, me).end)}</span>
          )}
        </span>
        {warned && <WarningMark />}
      </button>
    ) };
  };

  const dragNode = drag ? ((): { clocks: ClockEntry[] | null; style: Record<string, string> } => {
    const placed = byDay.get(drag.seg.day)?.find((p) => p.seg.key === drag.seg.key);
    const shown = dragged(drag.seg);
    return { clocks: ribbonClocks(), style: placed && shown ? ribbonAt(drag.lanes, shown) : {} };
  })() : null;

  const keyboardRibbon = (() => {
    if (!ribbonKey || drag) return null;
    for (const [day, placedList] of byDay) {
      const p = placedList.find((x) => itemKey(x.seg.item) === ribbonKey);
      if (p) return { clocks: p.seg.item.clocks, style: ribbonAt({ lane: p.lane, lanes: p.lanes }, { day, from: p.seg.from, to: p.seg.to }) };
    }
    return null;
  })();

  const regionDay = (d: string) => (
    <div class="tg-dayhead" key={d} data-today={d === today ? "yes" : "no"}>
      <span class="dh-wd">{WEEKDAYS[weekday(d)]}</span>
      <span class="dh-date">{shortDayLabel(d).slice(4)}</span>
    </div>
  );

  return (
    <section role="region" aria-label={props.regionLabel} class="tg" ref={root} style={dayStyle} tabIndex={-1}>
      <div class="tg-top">
        <div class="tg-head">
          <div class="tg-gutter-head" />
          {secondZone && <div class="tg-gutter-head" />}
          <div class="tg-heads">{days.map(regionDay)}</div>
        </div>
        <div class="tg-band-row">
          <div class="tg-gutter-head" />
          {secondZone && <div class="tg-gutter-head" />}
          <div role="group" aria-label="All-day events" class="tg-band">
            {bandRows.map((b) => (
              <button
                type="button"
                class="blk band-blk"
                key={itemKey(b.item) + b.row}
                data-fk={`blk:${itemKey(b.item)}`}
                data-key={itemKey(b.item)}
                data-series={b.item.series_id ?? ""}
                data-day={days[b.first]}
                aria-label={label(b.item, me)}
                style={{ gridColumn: `${b.first + 1} / ${b.last + 2}`, gridRow: String(b.row + 1), background: b.item.access === "busy" ? "var(--c-busy)" : colourVar(b.item, calendars) }}
                onClick={() => props.onOpen(b.item, null)}
                onFocus={() => {
                  focused.current = { key: itemKey(b.item), series: b.item.series_id ?? "", day: days[b.first], min: 0 };
                }}
              >
                <span class="blk-title">{b.item.title}</span>
                {(b.item.zone_warnings?.length ?? 0) > 0 && <WarningMark />}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div class="tg-body">
        <div class="tg-gutter" aria-hidden="true">
          {hoursList.map((h) => (
            <span class="hour" key={h} style={{ top: `${h * 4 * SLOT}px` }}>
              {String(h).padStart(2, "0")}:00
            </span>
          ))}
        </div>
        {secondZone && (
          <div role="group" aria-label={`Second zone ${CITY_OF[secondZone]}`} class="tg-gutter second">
            {hoursList.map((h) => {
              const instant = viewerInstant((parseDate(days[0]) as Wall) + h * 60 * MINUTE, me);
              return (
                <span class="hour" key={h} style={{ top: `${h * 4 * SLOT}px` }}>
                  {timeOf(wallInZone(instant, secondZone))}
                </span>
              );
            })}
          </div>
        )}
        <div class="tg-cols">
          <div role="grid" aria-label="Time slots" class="tg-slots" onKeyDown={onSlotKey}>
            {days.map((d) => (
              <div role="row" class="tg-day" key={d}>
                {Array.from({ length: SLOTS_PER_DAY }, (_, i) => {
                  const min = i * SLOT_MIN;
                  const isRoving = slot.day === d && slot.min === min;
                  const picked = create && create.day === d && min >= Math.min(create.from, create.to) && min <= Math.max(create.from, create.to);
                  return (
                    <div
                      role="gridcell"
                      key={min}
                      class={`cell band-${Math.floor(min / 60) % 2}${picked ? " picked" : ""}`}
                      data-day={d}
                      data-min={min}
                      tabIndex={isRoving ? 0 : -1}
                      aria-label={`${dayLabel(d)} ${minutesLabel(min)}`}
                      onFocus={() => setSlot({ day: d, min })}
                      onPointerDown={(e) => onCellPointerDown(e, d, min)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <div class="tg-events">
            {days.map((d) => (
              <div class="tg-evcol" key={d} data-day={d}>
                {(byDay.get(d) ?? []).map((placed) => renderBlock(placed).node)}
                {d === nowDate && (
                  <div role="img" aria-label={`Now ${nowText}`} class="now-line" style={{ top: `${(nowMin / SLOT_MIN) * SLOT}px` }} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      {dragNode?.clocks && <ThreeClocks clocks={dragNode.clocks} ribbon style={dragNode.style} />}
      {keyboardRibbon && <ThreeClocks clocks={keyboardRibbon.clocks} ribbon style={keyboardRibbon.style} />}
    </section>
  );
}
