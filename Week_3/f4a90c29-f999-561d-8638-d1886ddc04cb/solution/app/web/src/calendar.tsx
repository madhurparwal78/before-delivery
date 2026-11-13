import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { ApiError, get } from "./api";
import {
  VIEWS, eventIdOf, fetchRange, isPhone, itemKey, label, monthCells, parseState, shownDays, viewerSpan, weekBegin, type CalState, type ViewName,
} from "./cal";
import { ThreeClocks } from "./clocks";
import { askScope, duplicateEvent, trashEvent, undo$, undoLast, versionFor } from "./eventsvc";
import { defaultValues, editEvent$, focusAfter$, isOwnDraft, newEvent$, openNewEvent, valuesFromDraft } from "./form";
import { navigate, useLocation, currentQuery } from "./router";
import { announce } from "./status";
import { bump, calendars$, connection$, dataVersion$, draft$, hours$, loadDraft, me$ } from "./state";
import { Store, useStore } from "./store";
import { TimeGrid, colourVar, reveal } from "./timegrid";
import {
  CITY_OF, MINUTE, clock$, addDays, addMonths, dateOf, dayLabel, firstOfMonth, monthTitle, parseDate, rangeTitle, serverNow, syncClock, timeOf, wallInZone,
  weekday, WEEKDAYS, MONTHS, type Wall,
} from "./time";
import { Chevron, Modal, WarningMark, anyDialogOpen } from "./ui";
import { syncGridRoom, syncToolbarHeight } from "./cal";
import type { CalendarInfo, Item, Me } from "./types";

const phone$ = new Store(isPhone());
addEventListener("resize", () => {
  if (phone$.get() !== isPhone()) phone$.set(isPhone());
});

/** Resolves when the quick dialog of the event just opened is on screen. */
let quickShown: (() => void) | null = null;

function go(changes: Partial<Record<"view" | "date" | "calendars" | "event" | "focus", string | null>>, replace = false): void {
  const q = currentQuery();
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined) q.delete(key);
    else q.set(key, value);
  }
  const text = q.toString().replaceAll("%2C", ",");
  navigate("/calendar" + (text ? `?${text}` : ""), replace);
}

function useNow(): number {
  useStore(clock$);
  const [, redraw] = useState(0);
  useEffect(() => {
    const tick = () => {
      void syncClock();
      redraw((n) => n + 1);
    };
    const timer = setInterval(tick, 30000);
    const visible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return serverNow();
}

const SHORTCUTS: [string, string][] = [
  ["1 or D", "Day view"], ["2 or W", "Week view"], ["3 or M", "Month view"], ["4 or X", "Custom days view"], ["5 or A", "Schedule view"],
  ["T", "Go to today"], ["J", "Next period"], ["K", "Previous period"], ["G", "Go to a date"], ["C", "New event"],
  ["E", "Open the focused event's page"], ["Z", "Undo the last change"], ["Delete", "Delete the focused event"],
  ["/", "Search"], ["S", "Settings"], ["?", "This list"],
];

function defaultStart(me: Me, date: string): { start: Wall; end: Wall } {
  const nowWall = wallInZone(serverNow(), me.zone);
  const today = dateOf(nowWall);
  const base = date === today ? Math.ceil(nowWall / (60 * MINUTE)) * 60 * MINUTE : (parseDate(date) as Wall) + 9 * 60 * MINUTE;
  return { start: base, end: base + 60 * MINUTE };
}

export function CalendarPage() {
  const me = useStore(me$) as Me;
  const loc = useLocation();
  const phone = useStore(phone$);
  const version = useStore(dataVersion$);
  const calendars = useStore(calendars$);
  const hours = useStore(hours$);
  const draft = useStore(draft$);
  const undo = useStore(undo$);
  const now = useNow();
  const today = dateOf(wallInZone(now, me.zone));
  const state = useMemo(() => parseState(loc.query, today), [loc.query.toString(), today, phone]);
  const [items, setItems] = useState<Item[] | null>(null);
  const [dialog, setDialog] = useState<"go" | "keys" | "notices" | "sheet" | null>(null);
  const [dayList, setDayList] = useState<string | null>(null);
  const [ribbonRect, setRibbonRect] = useState<DOMRect | null>(null);
  const head = useRef<HTMLElement>(null);

  const days = state.view === "month" || state.view === "schedule" ? [] : shownDays(state, me);
  const range = fetchRange(state, me);
  const calendarsParam = state.calendars ? state.calendars.join(",") : "";
  const rangeKey = `${range.from}|${range.to}|${calendarsParam}`;

  useEffect(() => {
    let current = true;
    const query = new URLSearchParams({ from: range.from, to: range.to });
    if (state.calendars) query.set("calendars", calendarsParam);
    get<{ occurrences: Item[] }>(`/api/occurrences?${query}`)
      .then((body) => current && setItems(body.occurrences))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [rangeKey, version]);

  useEffect(() => {
    void loadDraft();
  }, []);

  const after = useStore(focusAfter$);
  useEffect(() => {
    if (!after || !items) return;
    const target = document.querySelector<HTMLElement>(`[data-fk="blk:${CSS.escape(after)}"]`);
    if (target) {
      target.focus();
      focusAfter$.set(null);
    }
  }, [items, after]);

  useEffect(() => {
    if (draft.loaded && draft.draft && !newEvent$.get() && !isOwnDraft(draft.draft)) newEvent$.set({ values: valuesFromDraft(draft.draft, me) });
  }, [draft, me]);

  useLayoutEffect(() => {
    syncToolbarHeight();
    syncGridRoom();
  });
  useEffect(() => {
    addEventListener("resize", syncGridRoom);
    return () => removeEventListener("resize", syncGridRoom);
  }, []);

  const visibleCalendars = state.calendars ?? calendars.filter((c) => c.id !== "cal-holidays").map((c) => c.id);

  const openItem = (item: Item, ribbon: DOMRect | null = null, id: string = itemKey(item)): Promise<void> => {
    setRibbonRect(ribbon);
    const shown = new Promise<void>((resolve) => {
      quickShown = resolve;
      setTimeout(resolve, 3000);
    });
    go({ event: id, focus: null });
    return shown;
  };

  const newAt = (day: string, from: number, to: number) => {
    const midnight = parseDate(day) as Wall;
    const values = defaultValues(me, midnight + from * MINUTE, midnight + to * MINUTE);
    openNewEvent(values, () => document.querySelector<HTMLElement>(`[data-day="${day}"][data-min="${from}"]`)?.focus());
  };

  const newNow = () => {
    const { start, end } = defaultStart(me, state.date);
    openNewEvent(defaultValues(me, start, end));
  };

  const shift = (direction: 1 | -1) => {
    let date = state.date;
    if (state.view === "day") date = addDays(date, direction);
    else if (state.view === "week") date = addDays(date, 7 * direction);
    else if (state.view === "month") date = addMonths(date, direction);
    else if (state.view === "custom") date = addDays(date, me.custom_days * direction);
    else date = addDays(date, 14 * direction);
    go({ date, event: null, focus: null });
  };

  const setView = (view: ViewName) => go({ view, event: null, focus: null });

  // single-key shortcuts, off in text fields and while a dialog is open
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keyHandler.current = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || anyDialogOpen()) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable='true'], [role='combobox'], [role='searchbox'], [role='textbox']")) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const views: Record<string, ViewName> = { "1": "day", d: "day", "2": "week", w: "week", "3": "month", m: "month", "4": "custom", x: "custom", "5": "schedule", a: "schedule" };
      if (views[key]) {
        if (phone && views[key] !== "day" && views[key] !== "schedule") return;
        event.preventDefault();
        setView(views[key]);
        return;
      }
      const block = target.closest<HTMLElement>("[data-key]");
      const found = block ? (items ?? []).find((i) => itemKey(i) === block.dataset.key) : undefined;
      switch (key) {
        case "t": go({ date: today, event: null, focus: null }); break;
        case "j": shift(1); break;
        case "k": shift(-1); break;
        case "g": setDialog("go"); break;
        case "c": newNow(); break;
        case "e": if (found) navigate(`/events/${eventIdOf(found)}${found.occurrence_id?.includes("@") ? `?occurrence=${found.occurrence_id}` : ""}`); else return; break;
        case "z": void undoLast(); break;
        case "Delete": if (found) void removeItem(found); else return; break;
        case "/": navigate("/search"); break;
        case "s": navigate("/settings"); break;
        case "?": setDialog("keys"); break;
        default: return;
      }
      event.preventDefault();
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keyHandler.current(event);
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, []);

  const removeItem = async (item: Item) => {
    if (item.access !== "full") return;
    const fresh = (await get<Item>(`/api/events/${eventIdOf(item)}${item.occurrence_id?.includes("@") ? `?occurrence_id=${encodeURIComponent(item.occurrence_id)}` : ""}`).catch(() => null)) ?? item;
    const recurring = Boolean(item.rrule);
    let scope;
    if (recurring) {
      scope = await askScope("delete", item.title);
      if (scope === null) return;
    }
    await trashEvent({ ...fresh, event_id: eventIdOf(item) }, scope, recurring ? itemKey(item) : undefined);
  };

  const period =
    state.view === "month" ? monthTitle(state.date)
    : state.view === "schedule" ? rangeTitle(state.date, addDays(state.date, 13))
    : state.view === "day" ? dayLabel(state.date)
    : rangeTitle(days[0], days[days.length - 1]);

  const regionLabel = { day: "Day grid", week: "Week grid", custom: "Custom days grid" }[state.view as "day"] ?? "";

  return (
    <div class="cal">
      {!phone && (
        <aside class="rail">
          <MiniMonth state={state} me={me} today={today} />
          <CalendarList calendars={calendars} shown={visibleCalendars} state={state} />
        </aside>
      )}
      <div class="cal-main">
        <header class="cal-head" ref={head}>
          {!phone && (
            <div class="head-row">
              <h1>{period}</h1>
              <ReconnectNote />
            </div>
          )}
          <Toolbar
            state={state} phone={phone} undo={undo !== null}
            onToday={() => go({ date: today, event: null, focus: null })}
            onShift={shift} onView={setView} onNew={newNow}
            onNotices={() => setDialog("notices")} onSheet={() => setDialog("sheet")}
          />
        </header>
        {phone && (
          <div class="head-row">
            <h1 class="phone-title">{period}</h1>
            <ReconnectNote />
          </div>
        )}
        <div id="cal-grid" class="cal-body">
          {items === null ? (
            <p class="quiet">Loading the calendar.</p>
          ) : state.view === "month" ? (
            <MonthGrid state={state} items={items} me={me} calendars={calendars} today={today} onOpen={openItem} onMore={setDayList} />
          ) : state.view === "schedule" ? (
            <Schedule state={state} items={items} me={me} onOpen={openItem} phone={phone} />
          ) : (
            <TimeGrid
              key={state.view}
              days={days} items={items} me={me} hours={hours} calendars={calendars} regionLabel={regionLabel} today={today} now={now}
              focusKey={state.focus} onOpen={openItem} onCreate={newAt} onSlotDeleteFocus={() => undefined}
            />
          )}
        </div>
      </div>
      {state.event && <QuickDialog state={state} me={me} items={items} ribbon={ribbonRect} />}
      {dialog === "go" && <GoToDialog onClose={() => setDialog(null)} onGo={(date) => { setDialog(null); go({ date, event: null, focus: null }); }} />}
      {dialog === "keys" && (
        <Modal label="Keyboard shortcuts" onClose={() => setDialog(null)}>
          <h2>Keyboard shortcuts</h2>
          <ul aria-label="Shortcuts" class="plain-list">
            {SHORTCUTS.map(([keys, what]) => (
              <li key={keys}>
                <kbd>{keys}</kbd> {what}
              </li>
            ))}
          </ul>
          <div class="actions"><button type="button" onClick={() => setDialog(null)} data-autofocus>Close</button></div>
        </Modal>
      )}
      {dialog === "notices" && <NoticesDialog onClose={() => setDialog(null)} />}
      {dialog === "sheet" && (
        <Modal label="Calendars" onClose={() => setDialog(null)}>
          <MiniMonth state={state} me={me} today={today} />
          <CalendarList calendars={calendars} shown={visibleCalendars} state={state} />
          <div class="actions"><button type="button" onClick={() => setDialog(null)}>Close</button></div>
        </Modal>
      )}
      {dayList && (
        <Modal label={`Events on ${dayLabel(dayList)}`} onClose={() => setDayList(null)}>
          <h2>{dayLabel(dayList)}</h2>
          <ul class="plain-list">
            {(items ?? []).filter((i) => itemsOnDay(i, me).includes(dayList)).map((i) => (
              <li key={itemKey(i)}>
                <button type="button" class="chip wide" style={{ background: colourVar(i, calendars) }} aria-label={label(i, me)}
                  onClick={() => { setDayList(null); openItem(i); }}>
                  {i.title}
                </button>
              </li>
            ))}
          </ul>
          <div class="actions"><button type="button" onClick={() => setDayList(null)}>Close</button></div>
        </Modal>
      )}
    </div>
  );
}

function itemsOnDay(item: Item, me: Me): string[] {
  const span = viewerSpan(item, me);
  const out: string[] = [];
  const last = item.all_day ? span.end : span.end - 1;
  for (let d = dateOf(span.start); d <= dateOf(Math.max(last, span.start)); d = addDays(d, 1)) out.push(d);
  return out;
}

function Toolbar(props: {
  state: CalState; phone: boolean; undo: boolean;
  onToday: () => void; onShift: (d: 1 | -1) => void; onView: (v: ViewName) => void; onNew: () => void; onNotices: () => void; onSheet: () => void;
}) {
  const views = props.phone ? VIEWS.filter((v) => v === "schedule" || v === "day") : VIEWS;
  const names: Record<ViewName, string> = { day: "Day", week: "Week", month: "Month", custom: "Custom days", schedule: "Schedule" };
  return (
    <div class="toolbar">
      {props.phone && (
        <button type="button" onClick={props.onSheet}>Calendars</button>
      )}
      <button type="button" onClick={props.onToday}>Today</button>
      <button type="button" class="icon" aria-label="Previous" onClick={() => props.onShift(-1)}><Chevron direction="left" /></button>
      <button type="button" class="icon" aria-label="Next" onClick={() => props.onShift(1)}><Chevron direction="right" /></button>
      <div role="radiogroup" aria-label="View" class="seg-group">
        {views.map((v) => (
          <label class="seg" key={v}>
            <input type="radio" name="view" checked={props.state.view === v} onChange={() => props.onView(v)} />
            <span>{names[v]}</span>
          </label>
        ))}
      </div>
      <button type="button" class="primary" onClick={props.onNew}>New event</button>
      <button type="button" class="notices" onClick={props.onNotices}>
        <span class="notices-text">Notices</span>
        <svg class="notices-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15zM10 20a2 2 0 004 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <UndoButton />
    </div>
  );
}

function ReconnectNote() {
  const connection = useStore(connection$);
  return connection.reconnecting ? <span class="reconnect">Reconnecting. Changes will catch up.</span> : null;
}

function UndoButton() {
  const undo = useStore(undo$);
  if (!undo) return null;
  return <button type="button" onClick={() => void undoLast()}>Undo</button>;
}

function MiniMonth({ state, me, today }: { state: CalState; me: Me; today: string }) {
  const [shown, setShown] = useState(firstOfMonth(state.date));
  useEffect(() => setShown(firstOfMonth(state.date)), [state.date]);
  const cells = monthCells(shown, me);
  const start = weekBegin(shown, me);
  const heads = Array.from({ length: 7 }, (_, i) => WEEKDAYS[(weekday(start) + i) % 7][0]);
  return (
    <section aria-label="Mini month" class="mini">
      <div class="mini-head">
        <h2>{monthTitle(shown)}</h2>
        <button type="button" class="icon" aria-label="Previous month" onClick={() => setShown(addMonths(shown, -1))}><Chevron direction="left" /></button>
        <button type="button" class="icon" aria-label="Next month" onClick={() => setShown(addMonths(shown, 1))}><Chevron direction="right" /></button>
      </div>
      <div class="mini-grid">
        {heads.map((h, i) => <span class="mini-wd" aria-hidden="true" key={i}>{h}</span>)}
        {cells.map((d) => (
          <button
            type="button" key={d} aria-label={dayLabel(d)} class="mini-day"
            tabIndex={(cells.includes(state.date) && d.slice(0, 7) === state.date.slice(0, 7) ? d === state.date : d === shown) ? 0 : -1}
            onKeyDown={(e) => {
              const days = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>(".mini-day") ?? [])];
              const at = days.indexOf(e.currentTarget);
              const next = { ArrowLeft: at - 1, ArrowRight: at + 1, ArrowUp: at - 7, ArrowDown: at + 7, Home: at - (at % 7), End: at - (at % 7) + 6 }[e.key as "Home"];
              if (next !== undefined && days[next]) {
                e.preventDefault();
                days.forEach((b, i) => (b.tabIndex = i === next ? 0 : -1));
                days[next].focus();
              }
            }}
            data-selected={d === state.date ? "yes" : "no"} data-today={d === today ? "yes" : "no"} data-out={d.slice(0, 7) !== shown.slice(0, 7) ? "yes" : "no"}
            aria-current={d === today ? "date" : undefined}
            onClick={() => go({ date: d, event: null, focus: null })}
          >
            {Number(d.slice(8))}
          </button>
        ))}
      </div>
    </section>
  );
}

function CalendarList({ calendars, shown, state }: { calendars: CalendarInfo[]; shown: string[]; state: CalState }) {
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...shown, id] : shown.filter((c) => c !== id);
    go({ calendars: next.join(","), event: null, focus: null });
  };
  void state;
  return (
    <div role="group" aria-label="Calendars" class="cal-list">
      <h2>Calendars</h2>
      {calendars.map((c) => (
        <label class="check" key={c.id}>
          <input type="checkbox" checked={shown.includes(c.id)} onChange={(e) => toggle(c.id, e.currentTarget.checked)} />
          <span class="chip-dot" style={{ background: `var(--c-${c.colour})` }} aria-hidden="true" />
          {c.name}
        </label>
      ))}
    </div>
  );
}

// ---- month ----

const DATE_H = 32;
const CHIP_H = 30;
const MORE_H = 34;

function MonthGrid(props: {
  state: CalState; items: Item[]; me: Me; calendars: CalendarInfo[]; today: string;
  onOpen: (item: Item) => void; onMore: (date: string) => void;
}) {
  const { state, items, me, calendars, today } = props;
  const cells = monthCells(state.date, me);
  const [height, setHeight] = useState(0);
  const grid = useRef<HTMLElement>(null);
  const rows = cells.length / 7;
  const focusKey = useRef<{ key: string; date: string } | null>(null);
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const measure = () => setHeight(Math.max(el.getBoundingClientRect().height - 36, 0) / rows);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [rows]);
  const perDay = new Map<string, Item[]>();
  for (const item of [...items].sort((a, b) => viewerSpan(a, me).start - viewerSpan(b, me).start)) {
    for (const d of itemsOnDay(item, me)) perDay.set(d, [...(perDay.get(d) ?? []), item]);
  }
  useLayoutEffect(() => {
    const f = focusKey.current;
    const el = grid.current;
    if (!f || !el || anyDialogOpen()) return;
    const active = document.activeElement;
    if (active && active !== document.body && el.contains(active)) return;
    const target = el.querySelector<HTMLElement>(`[data-fk="blk:${CSS.escape(f.key)}"]`) ?? el.querySelector<HTMLElement>(`[data-date="${f.date}"] .chip, [data-date="${f.date}"] .mg-more`) ?? el.querySelector<HTMLElement>(`[data-date="${f.date}"]`);
    target?.focus();
  }, [items]);
  const startChipDrag = (event: PointerEvent, item: Item) => {
    if (event.button !== 0 || item.access !== "full") return;
    const x = event.clientX;
    const y = event.clientY;
    let moved = false;
    const move = (e: PointerEvent) => {
      if (Math.abs(e.clientX - x) > 4 || Math.abs(e.clientY - y) > 4) moved = true;
    };
    const up = (e: PointerEvent) => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      if (!moved) {
        props.onOpen(item);
        return;
      }
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-date]");
      const from = dateOf(viewerSpan(item, me).start);
      if (!target || target.dataset.date === from) return;
      void moveToDay(item, ((parseDate(target.dataset.date as string) as number) - (parseDate(from) as number)) / 86400000);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  const moveToDay = async (item: Item, delta: number) => {
    const { saveEvent, offerUndo } = await import("./eventsvc");
    const shiftText = (s: string) => {
      const w = (item.all_day ? parseDate(s) : Date.parse(s + "Z")) as number;
      const next = w + delta * 86400000;
      return item.all_day ? dateOf(next) : new Date(next).toISOString().slice(0, 16);
    };
    const recurring = Boolean(item.rrule);
    let scope;
    if (recurring) {
      scope = await askScope("edit", item.title);
      if (scope === null) return;
    }
    const saved = await saveEvent({
      id: eventIdOf(item), title: item.title, version: versionFor(eventIdOf(item), item.version as number),
      patch: { start_local: shiftText(item.start_local), end_local: shiftText(item.end_local) }, scope, occurrenceId: recurring ? itemKey(item) : undefined,
    }).catch(() => null);
    if (!saved) return;
    const start = viewerSpan(item, me).start + delta * 86400000;
    announce(`Moved ${item.title} to ${item.all_day ? dayLabel(dateOf(start)) : timeOf(start)} ${me.city}.`);
    if (scope !== "following") offerUndo({ title: item.title, eventId: saved.event.id as string, version: saved.event.version as number, trashId: null });
    bump();
  };
  return (
    <section role="region" aria-label="Month grid" class="mg" ref={grid} style={{ "--rows": String(rows) }}>
      <div class="mg-heads" aria-hidden="true">
        {Array.from({ length: 7 }, (_, i) => <span key={i}>{WEEKDAYS[(weekday(cells[0]) + i) % 7]}</span>)}
      </div>
      <div class="mg-cells">
        {cells.map((d) => {
          const list = perDay.get(d) ?? [];
          const fit = Math.max(Math.floor((height - DATE_H - 4) / CHIP_H), 0);
          const shown = list.length <= fit ? list.length : Math.max(Math.floor((height - DATE_H - MORE_H - 4) / CHIP_H), 0);
          return (
            <div class="mg-cell" key={d} data-date={d} tabIndex={-1} data-today={d === today ? "yes" : "no"} data-out={d.slice(0, 7) !== state.date.slice(0, 7) ? "yes" : "no"}>
              <span class="mg-date">{Number(d.slice(8)) === 1 ? `1 ${MONTHS[Number(d.slice(5, 7)) - 1]}` : Number(d.slice(8))}</span>
              {list.slice(0, shown).map((item) => (
                <button
                  type="button" class="chip" key={itemKey(item) + d} data-fk={`blk:${itemKey(item)}`} data-key={itemKey(item)}
                  style={{ background: item.access === "busy" ? "var(--c-busy)" : colourVar(item, calendars) }} aria-label={label(item, me)}
                  onFocus={() => (focusKey.current = { key: itemKey(item), date: d })}
                  onPointerDown={(e) => startChipDrag(e, item)}
                  onClick={(e) => { if (e.detail === 0) props.onOpen(item); }}
                >
                  <span class="chip-title">{item.title}</span>
                  {(item.zone_warnings?.length ?? 0) > 0 && <WarningMark />}
                </button>
              ))}
              {list.length > shown && (
                <button type="button" class="mg-more" onClick={() => props.onMore(d)}>+{list.length - shown} more</button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---- schedule ----

function Schedule({ state, items, me, onOpen, phone }: { state: CalState; items: Item[]; me: Me; onOpen: (i: Item) => void; phone: boolean }) {
  const list = useRef<HTMLUListElement>(null);
  const lastTop = useRef<{ el: HTMLElement; top: number } | null>(null);
  const perDay = new Map<string, Item[]>();
  const end = addDays(state.date, 14);
  for (const item of [...items].sort((a, b) => viewerSpan(a, me).start - viewerSpan(b, me).start)) {
    for (const d of itemsOnDay(item, me)) if (d >= state.date && d < end) perDay.set(d, [...(perDay.get(d) ?? []), item]);
  }
  const days = [...perDay.keys()].sort();
  useLayoutEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active?.classList.contains("sched-date") && lastTop.current?.el === active) {
      const diff = active.getBoundingClientRect().top - lastTop.current.top;
      if (Math.abs(diff) > 0.5) scrollBy(0, diff);
    }
    if (active?.classList.contains("sched-date")) lastTop.current = { el: active, top: active.getBoundingClientRect().top };
  });
  useEffect(() => {
    const onScroll = () => {
      const active = document.activeElement as HTMLElement | null;
      if (active?.classList.contains("sched-date")) lastTop.current = { el: active, top: active.getBoundingClientRect().top };
    };
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);
  if (days.length === 0) return <p class="quiet">Nothing scheduled in this period.</p>;
  const dateKey = (event: KeyboardEvent) => {
    const buttons = [...(list.current?.querySelectorAll<HTMLElement>(".sched-date") ?? [])];
    const at = buttons.indexOf(event.currentTarget as HTMLElement);
    const target = { ArrowDown: buttons[at + 1], ArrowUp: buttons[at - 1], Home: buttons[0], End: buttons[buttons.length - 1] }[event.key as "Home"];
    if (!event.key || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (target) {
      target.focus({ preventScroll: true });
      reveal(target, document.querySelector(".cal-head")?.getBoundingClientRect().bottom ?? 0);
      lastTop.current = { el: target, top: target.getBoundingClientRect().top };
    }
  };
  return (
    <ul aria-label="Schedule" class={`sched${phone ? " phone" : ""}`} ref={list}>
      {days.map((d) => (
        <li key={d} class="sched-day">
          <button type="button" class="sched-date" onKeyDown={dateKey} onClick={() => go({ view: "day", date: d, event: null, focus: null })}>
            {dayLabel(d)}
          </button>
          <ul>
            {(perDay.get(d) ?? []).map((item) => (
              <li key={itemKey(item) + d}>
                <button type="button" class="sched-event" data-fk={`blk:${itemKey(item)}`} data-key={itemKey(item)} aria-label={label(item, me)}
                  onClick={() => onOpen(item)}>
                  <span class="chip-dot" style={{ background: item.access === "busy" ? "var(--c-busy)" : `var(--c-${item.colour && item.colour !== "calendar" ? item.colour : calendarColour(item)})` }} aria-hidden="true" />
                  <span>{item.title}</span>{" "}
                  <span class="muted">{item.all_day ? "All day" : `${timeOf(viewerSpan(item, me).start)} to ${timeOf(viewerSpan(item, me).end)}`}</span>{" "}
                  {(item.zone_warnings?.length ?? 0) > 0 && <WarningMark />}
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function calendarColour(item: Item): string {
  return calendars$.get().find((c) => c.id === item.calendar_id)?.colour ?? "indigo";
}

// ---- dialogs ----

function GoToDialog({ onClose, onGo }: { onClose: () => void; onGo: (date: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const submit = (event: Event) => {
    event.preventDefault();
    if (parseDate(value.trim()) === null) setError("Use YYYY-MM-DD.");
    else onGo(value.trim());
  };
  return (
    <Modal label="Go to date" onClose={onClose}>
      <form onSubmit={submit} noValidate class="dialog-form">
        <h2>Go to date</h2>
        <div class="field">
          <label for="goto-date">Date</label>
          <input id="goto-date" type="text" value={value} data-autofocus onInput={(e) => setValue(e.currentTarget.value)} placeholder="YYYY-MM-DD" autocomplete="off" />
          {!!error && <p class="field-error">{error}</p>}
        </div>
        <div class="actions">
          <button type="submit" class="primary">Go</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

function NoticesDialog({ onClose }: { onClose: () => void }) {
  const [notices, setNotices] = useState<{ id: string; text: string }[] | null>(null);
  const version = useStore(dataVersion$);
  useEffect(() => {
    void get<{ notices: { id: string; text: string }[] }>("/api/notices").then((b) => setNotices(b.notices));
  }, [version]);
  return (
    <Modal label="Notices" onClose={onClose}>
      <h2>Notices</h2>
      {notices && notices.length === 0 && <p class="quiet">No notices yet.</p>}
      <ul aria-label="Notices" class="plain-list">
        {(notices ?? []).map((n) => <li key={n.id}>{n.text}</li>)}
      </ul>
      <div class="actions"><button type="button" onClick={onClose} data-autofocus>Close</button></div>
    </Modal>
  );
}

export function warningSentence(item: Item): string | null {
  const w = item.zone_warnings?.[0];
  if (!w) return null;
  return `A zone rule for ${w.city} took effect on ${dayLabel(w.effective_date)}: ${w.note} ${w.saved_time} now shows as ${w.shown_time}.`;
}

export function adjustedSentence(item: Item): string | null {
  if (!item.adjusted) return null;
  const key = (item.occurrence_id ?? item.id ?? "").split("@")[1];
  if (!key) return null;
  const requested = `${key.slice(9, 11)}:${key.slice(11, 13)}`;
  return `This occurrence starts at ${item.start_local.slice(11, 16)} because ${requested} does not exist on ${dayLabel(item.start_local.slice(0, 10))}.`;
}

function QuickDialog({ state, me, items, ribbon }: { state: CalState; me: Me; items: Item[] | null; ribbon: DOMRect | null }) {
  const id = state.event as string;
  const [event, setEvent] = useState<Item | null>(null);
  const version = useStore(dataVersion$);
  const [mounted] = useState(() => ({ ribbon }));
  useEffect(() => {
    const eventId = id.split("@")[0];
    const query = id.includes("@") ? `?occurrence_id=${encodeURIComponent(id)}` : "";
    get<Item>(`/api/events/${eventId}${query}`)
      .then(setEvent)
      .catch((error) => {
        if (error instanceof ApiError) {
          announce("That event is not available.");
          go({ event: null }, true);
        }
      });
  }, [id, version]);
  void items;
  useLayoutEffect(() => {
    if (event) {
      quickShown?.();
      quickShown = null;
    }
  }, [event]);
  if (!event) return null;
  const close = () => go({ event: null });
  const span = viewerSpan(event, me);
  const eventId = eventIdOf({ ...event, event_id: id.split("@")[0] });
  const canEditEvent = event.access === "full" || (event.access === "guest" && event.switches?.modify_event);
  const sentence = warningSentence(event);
  const adjusted = adjustedSentence({ ...event, occurrence_id: id });
  const blockFocus = () => document.querySelector<HTMLElement>(`[data-fk="blk:${CSS.escape(id)}"]`)?.focus();
  const remove = async () => {
    const recurring = Boolean(event.rrule);
    let scope;
    if (recurring) {
      scope = await askScope("delete", event.title);
      if (scope === null) return;
    }
    close();
    await trashEvent({ ...event, event_id: eventId }, scope, recurring ? id : undefined);
  };
  return (
    <Modal label={event.title} onClose={close} fallback={blockFocus}>
      <div class="qd-title">
        <h2>{event.title}</h2>
        {event.clocks.length > 0 && <ThreeClocks clocks={event.clocks} from={mounted.ribbon} baseDate={event.access === "busy" ? undefined : dateOf(span.start)} />}
      </div>
      {event.access !== "busy" && (
        <p class="qd-when">
          {event.all_day
            ? dayLabel(dateOf(span.start)) + (span.end > span.start ? ` to ${dayLabel(dateOf(span.end))}` : "")
            : `${dayLabel(dateOf(span.start))} ${timeOf(span.start)} to ${timeOf(span.end)} ${CITY_OF[me.zone]}`}
        </p>
      )}
      {!!event.location && <p class="muted">{event.location}</p>}
      {adjusted && <p>{adjusted}</p>}
      {sentence && <section role="region" aria-label="Zone rule warning" class="warning"><WarningMark /> <span>{sentence}</span></section>}
      <div class="actions" key="actions">
        <button type="button" onClick={() => navigate(`/events/${eventId}${id.includes("@") ? `?occurrence=${encodeURIComponent(id)}` : ""}`)} data-autofocus>Open event</button>
        {canEditEvent && (
          <button type="button" onClick={() => { go({ event: null }, true); editEvent$.set({ item: event, occurrenceId: id.includes("@") ? id : undefined, fallback: blockFocus }); }}>Edit</button>
        )}
        {event.access !== "busy" && event.calendar_id !== "cal-holidays" && <button type="button" onClick={() => void duplicateEvent({ ...event, event_id: eventId })}>Duplicate</button>}
        {event.access === "full" && <button type="button" onClick={() => void remove()}>Delete</button>}
      </div>
    </Modal>
  );
}

