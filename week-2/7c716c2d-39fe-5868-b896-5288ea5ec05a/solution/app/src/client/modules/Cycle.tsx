// The Cycle module: the crease ribbon (fold, unfold, chips, unplaced tray), the burndown and the
// cycle's issue list.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { api, ApiFailure, get, type Cycle, type Day, type Issue } from "../api";
import { SETTLE } from "../components/exit";
import { inListOrder, IssueRows } from "../components/IssueRows";
import { Panes } from "../components/Panes";
import { NotFound, SheetHeader, TitleBlock } from "../components/Sheet";
import { shortDate, showDate, weekdayOf } from "../format";
import { navigate } from "../router";
import { useApp } from "../store";

const FOLD_DELAY = 200;
const FOLD_MS = 330;

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type Phase = "calendar" | "folding" | "folded";

export function CycleModule(props: { rest: string[] }): JSX.Element {
  const app = useApp();
  const requested = props.rest[0] ?? null;
  const valid = props.rest.length <= 1 && (requested === null || (/^[1-9]\d{0,3}$/.test(requested) && Number(requested) <= 1000));
  const [cycle, setCycle] = useState<Cycle | null | "missing">(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [phase, setPhase] = useState<Phase>("calendar");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const firstCalendar = useRef(app.calendarVersion);

  const load = useCallback(
    async (fold: boolean): Promise<void> => {
      try {
        const next = await get<Cycle>(requested ? `/api/cycles/${requested}` : "/api/cycles/current");
        const list = await get<{ issues: Issue[] }>(`/api/issues?cycle=${next.number}`);
        for (const timer of timers.current) clearTimeout(timer);
        timers.current = [];
        if (fold && !reducedMotion()) {
          setPhase("calendar");
          timers.current.push(setTimeout(() => setPhase("folding"), FOLD_DELAY));
          timers.current.push(setTimeout(() => setPhase("folded"), FOLD_DELAY + FOLD_MS));
        } else {
          setPhase("folded");
        }
        setCycle(next);
        setIssues(list.issues);
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 404) setCycle("missing");
      }
    },
    [requested],
  );

  useEffect(() => {
    if (!valid) return;
    setCycle(null);
    void load(true);
  }, [load, valid]);

  useEffect(() => {
    if (app.calendarVersion === firstCalendar.current) return;
    firstCalendar.current = app.calendarVersion;
    void load(false);
  }, [app.calendarVersion, load]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const shown = useRef<number | null>(null);
  shown.current = cycle && cycle !== "missing" && !cycle.is_finished ? cycle.number : null;

  /** Re-reads the cycle's surfaces in place: no fold, and an unfolded crease stays as it is. */
  const refresh = useCallback(async (): Promise<void> => {
    const next = await get<Cycle>(requested ? `/api/cycles/${requested}` : "/api/cycles/current");
    setCycle(next);
  }, [requested]);

  useEffect(
    () =>
      app.on((event) => {
        if (event.name === "reset") void load(false);
        if (event.name === "revoked" && event.data.scope === "project") {
          const gone = event.data.id;
          setIssues((list) => list.filter((i) => i.project_id !== gone));
          void refresh().catch(() => undefined);
        }
        if (event.name !== "issue" || shown.current === null) return;
        const issue = event.data;
        setIssues((list) => inListOrder(issue.cycle_number === shown.current ? [...list.filter((i) => i.key !== issue.key), issue] : list.filter((i) => i.key !== issue.key)));
        void refresh().catch(() => undefined);
      }),
    [app, load, refresh],
  );

  const onChanged = useCallback((updated: Issue) => setIssues((list) => inListOrder(list.map((i) => (i.key === updated.key ? updated : i)))), []);
  const number = cycle && cycle !== "missing" ? cycle.number : null;

  const list = (
    <IssueRows
      issues={issues}
      loading={cycle === null}
      onChanged={onChanged}
      onOpen={(key) => navigate(`/issues/${encodeURIComponent(key)}`)}
      emptyText="No issues in this cycle yet."
      toolbar={
        <div className="toolbar">
          <h2 className="toolbar-title">{number ? `Cycle ${number} issues` : "Cycle issues"}</h2>
        </div>
      }
    />
  );

  let detail: JSX.Element;
  if (!valid || cycle === "missing") detail = <NotFound back="/cycle" />;
  else if (cycle === null) detail = <div className="sheet" aria-busy="true" />;
  else detail = <CycleSheet cycle={cycle} issues={issues} phase={phase} onIssue={onChanged} />;

  return <Panes list={list} detail={detail} detailFirst detailKey={`cycle-${requested ?? "current"}`} />;
}

function CycleSheet(props: { cycle: Cycle; issues: Issue[]; phase: Phase; onIssue: (issue: Issue) => void }): JSX.Element {
  const app = useApp();
  const { cycle, phase } = props;
  const ribbon = useRef<HTMLDivElement>(null);
  const state = cycle.is_current ? "Current" : cycle.is_finished ? "Finished" : "Upcoming";
  return (
    <article className="sheet cycle-sheet">
      <SheetHeader back="/cycle" />
      <TitleBlock name={`Cycle ${cycle.number}`} state={state} changed={cycle.is_current ? app.workspace.today : cycle.first_working_date} />
      <header className="cycle-head">
        <h1 className={cycle.is_current ? "is-current" : undefined}>
          {`Cycle ${cycle.number}`}
          {cycle.is_current && <span className="current-mark">Current</span>}
        </h1>
        <p className="mono range">
          {showDate(cycle.first_working_date)} – {showDate(cycle.last_working_date)}
        </p>
        <p role="status" aria-label="Cycle length" className="mono counter">
          {phase === "folded" ? `${cycle.working_day_count} working days` : `${cycle.calendar_days} days`}
        </p>
      </header>
      <div className="cycle-nav">
        <p className="mono today">{`Today: ${showDate(app.workspace.today)}`}</p>
        <div className="cycle-buttons">
          <button type="button" className="button" disabled={cycle.number <= 1} onClick={() => navigate(`/cycle/${cycle.number - 1}`)}>
            <ChevronLeft aria-hidden="true" size={18} strokeWidth={1.5} />
            Previous cycle
          </button>
          <button type="button" className="button" onClick={() => navigate(`/cycle/${cycle.number + 1}`)}>
            Next cycle
            <ChevronRight aria-hidden="true" size={18} strokeWidth={1.5} />
          </button>
        </div>
      </div>
      <Ribbon cycle={cycle} issues={props.issues} phase={phase} today={app.workspace.today} onIssue={props.onIssue} ribbonRef={ribbon} />
      <Burndown cycle={cycle} drawn={phase === "folded"} ribbonRef={ribbon} />
    </article>
  );
}

interface Drag {
  key: string;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  touch: boolean;
}

const CLOCK_COPY = { forward: "Clocks go forward", back: "Clocks go back" } as const;

const HOLD_MS = 400;
const HOLD_SLIP_PX = 10;

function Ribbon(props: { cycle: Cycle; issues: Issue[]; phase: Phase; today: string; onIssue: (issue: Issue) => void; ribbonRef: RefObject<HTMLDivElement> }): JSX.Element {
  const app = useApp();
  const { cycle, phase } = props;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [override, setOverride] = useState<Record<string, string | null>>({});
  const [drag, setDrag] = useState<Drag | null>(null);
  const pendingFocus = useRef<{ key: string; done: boolean } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dayDates = new Set(cycle.days.map((d) => d.date));
  const counted = cycle.days.filter((d) => d.counted);

  const placed = (issue: Issue): string | null => {
    const date = issue.key in override ? (override[issue.key] ?? null) : issue.due_date;
    return date && dayDates.has(date) ? date : null;
  };

  /** Once a long press has started a drag, the finger moves the chip and no longer scrolls the page. */
  useEffect(() => {
    const hold = (event: TouchEvent): void => {
      if (dragRef.current?.active) event.preventDefault();
    };
    document.addEventListener("touchmove", hold, { passive: false });
    return () => document.removeEventListener("touchmove", hold);
  }, []);

  /** Clicking anywhere else folds the open crease, on browsers that do not focus a clicked button too. */
  useEffect(() => {
    const away = (event: MouseEvent): void => {
      if (!(event.target as HTMLElement).closest?.(".crease")) setExpanded(null);
    };
    document.addEventListener("click", away);
    return () => document.removeEventListener("click", away);
  }, []);

  /** Keeps focus on a moving chip while it changes columns, until its save has settled. */
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    const chip = document.querySelector<HTMLElement>(`[data-chip="${CSS.escape(pending.key)}"]`);
    if (chip && document.activeElement !== chip) chip.focus();
    if (pending.done) pendingFocus.current = null;
  });

  /** A chip that changed column glides there from where it was. */
  const chipSpots = useRef(new Map<string, { column: string; left: number; top: number }>());
  useLayoutEffect(() => {
    const spots = new Map<string, { column: string; left: number; top: number }>();
    for (const chip of document.querySelectorAll<HTMLElement>("[data-chip]")) {
      const key = chip.dataset.chip as string;
      const column = chip.closest<HTMLElement>("[data-drop-date]")?.dataset.dropDate ?? "";
      const { left, top } = chip.getBoundingClientRect();
      spots.set(key, { column, left, top });
      const was = chipSpots.current.get(key);
      if (was && was.column !== column && !reducedMotion()) {
        chip.animate([{ transform: `translate(${was.left - left}px, ${was.top - top}px)` }, { transform: "none" }], { duration: 200, easing: SETTLE });
      }
    }
    chipSpots.current = spots;
  });

  const updateDrag = (next: Drag | null | ((d: Drag | null) => Drag | null)): void => {
    dragRef.current = typeof next === "function" ? next(dragRef.current) : next;
    setDrag(dragRef.current);
  };

  /** The chip sits on its drop target while the save is pending; the stored date then places it. */
  const move = (issue: Issue, date: string): void => {
    if (date === placed(issue)) return;
    const pending = { key: issue.key, done: false };
    pendingFocus.current = pending;
    setOverride((o) => ({ ...o, [issue.key]: date }));
    api<Issue>("PATCH", `/api/issues/${issue.key}`, { due_date: date })
      .then((updated) => {
        pending.done = true;
        props.onIssue(updated);
        setOverride(({ [issue.key]: _, ...rest }) => rest);
        if (updated.due_date) app.announce(updated.due_date_snapped ? `Due date moved to ${showDate(updated.due_date)}, the next working day.` : `Due date set to ${showDate(updated.due_date)}.`);
      })
      .catch((error: unknown) => {
        pending.done = true;
        setOverride(({ [issue.key]: _, ...rest }) => rest);
        app.announce(error instanceof ApiFailure && error.code === "validation" ? "Enter a date as YYYY-MM-DD." : "Due date not saved.");
      });
  };

  const step = (issue: Issue, direction: 1 | -1): void => {
    const at = placed(issue);
    if (at === null) {
      if (direction === 1 && counted[0]) move(issue, counted[0].date);
      return;
    }
    const next = direction === 1 ? counted.find((d) => d.date > at) : counted.findLast((d) => d.date < at);
    if (next) move(issue, next.date);
  };

  const chipEvents = (issue: Issue) => ({
    "data-chip": issue.key,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (!event.shiftKey || (event.key !== "ArrowRight" && event.key !== "ArrowLeft")) return;
      event.preventDefault();
      step(issue, event.key === "ArrowRight" ? 1 : -1);
    },
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const touch = event.pointerType === "touch";
      const next: Drag = { key: issue.key, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false, touch };
      updateDrag(next);
      if (touch) longPress.current = setTimeout(() => updateDrag((d) => (d && d.key === issue.key ? { ...d, active: true } : d)), HOLD_MS);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
      updateDrag((d) => {
        if (!d || d.pointerId !== event.pointerId) return d;
        const distance = Math.hypot(event.clientX - d.startX, event.clientY - d.startY);
        if (d.touch && !d.active && distance > HOLD_SLIP_PX) {
          if (longPress.current) clearTimeout(longPress.current);
          return null;
        }
        const active = d.active || (!d.touch && distance > 4);
        return { ...d, x: event.clientX, y: event.clientY, active };
      });
    },
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (longPress.current) clearTimeout(longPress.current);
      const d = dragRef.current;
      updateDrag(null);
      if (!d || !d.active) return;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-drop-date]");
      const date = target?.dataset.dropDate;
      event.currentTarget.focus();
      if (date) move(issue, date);
    },
    onPointerCancel: () => {
      if (longPress.current) clearTimeout(longPress.current);
      updateDrag(null);
    },
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
  });

  const chipFor = (issue: Issue, inTray: boolean): JSX.Element => {
    const at = placed(issue);
    const due = issue.key in override ? override[issue.key] : issue.due_date;
    const label = inTray ? (due ? `${issue.key} due ${showDate(due)}` : `${issue.key}, no due date`) : `${issue.key} due ${showDate(at as string)}`;
    const dragging = drag?.key === issue.key && drag.active;
    return (
      <button key={issue.key} type="button" className={`ribbon-chip${dragging ? " is-dragging" : ""}`} data-status={issue.status} aria-label={label} title={issue.title} {...chipEvents(issue)}>
        {issue.key}
      </button>
    );
  };

  const uncounted = cycle.days.filter((d) => !d.counted).length;
  /** Labels in a run of neighbouring creases step down three levels so they never overlap. */
  const labelLevel = new Map(cycle.days.map((d, i) => [d.date, d.counted ? 0 : (runPosition(cycle.days, i) - 1) % 3]));
  const folded = phase !== "calendar";
  const creases = folded ? uncounted - (expanded ? 1 : 0) : 0;
  const wide = `calc((100% - ${creases * 8}px) / ${cycle.days.length - creases})`;
  const width = (day: Day): string => (!folded ? `calc(100% / ${cycle.days.length})` : day.counted || day.date === expanded ? wide : "8px");
  const tray = props.issues.filter((i) => placed(i) === null);
  const ghost = drag?.active ? props.issues.find((i) => i.key === drag.key) : undefined;

  return (
    <div className="ribbon-block">
      <div role="group" aria-label="Unplaced" className="tray">
        <span className="tray-label">Unplaced</span>
        <div className="tray-chips" data-drop-date="">
          {tray.length === 0 ? <span className="muted">Every issue has a day.</span> : tray.map((i) => chipFor(i, true))}
        </div>
      </div>
      <div role="region" aria-label="Cycle ribbon" className={`ribbon phase-${phase}`} ref={props.ribbonRef}>
        {cycle.days.map((day) =>
          day.counted ? (
            <div
              key={`${day.date}-counted`}
              role="group"
              aria-label={showDate(day.date)}
              className={`ribbon-day${day.date === props.today ? " is-today" : ""}`}
              style={{ width: width(day) }}
              data-drop-date={day.date}
            >
              <span className="day-head" aria-hidden="true">
                <span>{weekdayOf(day.date)}</span>
                <span className="mono">{day.date.slice(8).replace(/^0/, "")}</span>
              </span>
              {day.clock_change && <span className="clock-note">{CLOCK_COPY[day.clock_change]}</span>}
              <span className="day-chips">{props.issues.filter((i) => placed(i) === day.date).map((i) => chipFor(i, false))}</span>
            </div>
          ) : (
            <div key={`${day.date}-crease`} className="crease-col" style={{ width: width(day) }} data-drop-date={day.date}>
              <button
                type="button"
                className={`crease${day.date === expanded ? " is-open" : ""}`}
                aria-label={`${showDate(day.date)}, not counted`}
                aria-expanded={day.date === expanded}
                onClick={() => setExpanded((e) => (e === day.date ? null : day.date))}
                onBlur={() => setExpanded((e) => (e === day.date ? null : e))}
              >
                <span className={`crease-label mono level-${labelLevel.get(day.date) ?? 0}`} aria-hidden="true">
                  {shortDate(day.date)}
                </span>
                {day.date === expanded && (
                  <span className="crease-note">
                    <strong>Not counted</strong>
                    <span>{day.reason}</span>
                    {day.clock_change && <span>{CLOCK_COPY[day.clock_change]}</span>}
                  </span>
                )}
              </button>
              <span className="day-chips crease-chips">{props.issues.filter((i) => placed(i) === day.date).map((i) => chipFor(i, false))}</span>
            </div>
          ),
        )}
      </div>
      {ghost && drag && (
        <span className="drag-ghost mono" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          {ghost.key}
        </span>
      )}
    </div>
  );
}

/** 1-based position of an uncounted day within its run of neighbouring uncounted days. */
function runPosition(days: Day[], index: number): number {
  let position = 0;
  for (let i = index; i >= 0 && !days[i]?.counted; i--) position++;
  return position;
}

const CHART_HEIGHT = 140;

/** Keeps each burndown point on its working-day column, through the fold and every unfold. */
function useColumnCentres(ribbonRef: RefObject<HTMLDivElement>, chartRef: RefObject<SVGSVGElement>, dates: string): { width: number; centres: number[] } {
  const [shape, setShape] = useState({ width: 0, centres: [] as number[] });
  useLayoutEffect(() => {
    const ribbon = ribbonRef.current;
    const chart = chartRef.current;
    if (!ribbon || !chart) return;
    const measure = (): void => {
      const box = chart.getBoundingClientRect();
      const centres = [...ribbon.querySelectorAll<HTMLElement>(".ribbon-day")].map((day) => {
        const rect = day.getBoundingClientRect();
        return rect.left + rect.width / 2 - box.left;
      });
      setShape({ width: box.width, centres });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(ribbon);
    observer.observe(chart);
    for (const day of ribbon.querySelectorAll(".ribbon-day")) observer.observe(day);
    return () => observer.disconnect();
  }, [ribbonRef, chartRef, dates]);
  return shape;
}

function Burndown(props: { cycle: Cycle; drawn: boolean; ribbonRef: RefObject<HTMLDivElement> }): JSX.Element {
  const entries = props.cycle.burndown;
  const counted = props.cycle.days.filter((d) => d.counted);
  const chart = useRef<SVGSVGElement>(null);
  const { width, centres } = useColumnCentres(props.ribbonRef, chart, props.cycle.days.map((d) => `${d.date}:${d.counted}`).join());
  const max = Math.max(1, ...entries.map((e) => e.open));
  const yOf = (open: number): number => CHART_HEIGHT - 8 - (open / max) * (CHART_HEIGHT - 20);
  const points = entries.map((e) => ({ x: centres[counted.findIndex((d) => d.date === e.date)] ?? 0, y: yOf(e.open), date: e.date }));
  return (
    <section className={`burndown${props.drawn ? " is-drawn" : ""}`} aria-label="Burndown chart">
      <h2>Burndown</h2>
      <svg ref={chart} role="img" aria-label="Burndown" height={CHART_HEIGHT} className="burndown-svg">
        {counted.map((d, i) => (
          <line key={d.date} x1={centres[i] ?? 0} x2={centres[i] ?? 0} y1={4} y2={CHART_HEIGHT - 4} className="burndown-grid" />
        ))}
        <line x1={0} x2={width} y1={CHART_HEIGHT - 8} y2={CHART_HEIGHT - 8} className="burndown-axis" />
        <clipPath id={`burndown-${props.cycle.number}`}>
          <rect className="burndown-reveal" x={0} y={0} width={width} height={CHART_HEIGHT} />
        </clipPath>
        <g clipPath={`url(#burndown-${props.cycle.number})`}>
          {points.length > 0 && <polyline points={points.map((p) => `${p.x},${p.y}`).join(" ")} className="burndown-line" />}
          {points.map((p) => (
            <circle key={p.date} cx={p.x} cy={p.y} r={3} className="burndown-point" />
          ))}
        </g>
      </svg>
      <p className="burndown-scale mono" aria-hidden="true">
        <span>{entries.length > 0 ? `${max} open` : ""}</span>
        <span>{entries.length > 0 ? `${entries[entries.length - 1]?.open ?? 0} open now` : "Starts when the cycle begins"}</span>
      </p>
      <ul aria-label="Burndown values" className="visually-hidden">
        {entries.map((e) => (
          <li key={e.date}>{`${showDate(e.date)}: ${e.open} open`}</li>
        ))}
      </ul>
    </section>
  );
}
