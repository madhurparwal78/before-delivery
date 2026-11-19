import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { addDays, daysBetween, formatLong, type IsoDate } from "../../shared/calendar";
import type { Item, Link } from "../../shared/types";
import { chartDays, connectorPath, DAY_PX, DAY_ROW_PX, HEADER_PX, MONTH_ROW_PX, placeOf, ROW_PX, tailColumns, type Place } from "../chart";
import { describeItem } from "../describe";
import { KnockOn, slidesBetween } from "../knock-on";
import { minimumDuration, moveSentence, resizeSentence } from "../messages";
import type { ProjectSession, SessionState } from "../store";
import { DayHeader, MonthLabels } from "./gantt-header";

const DRAG_THRESHOLD_PX = 4;

interface Props {
  session: ProjectSession;
  state: SessionState;
  showBaseline: boolean;
  highlightCritical: boolean;
  openDetails: (itemId: string, opener: HTMLElement | null) => void;
  openLink: (item: Item, opener: HTMLElement | null) => void;
}

type DragMode = "move" | "start" | "end";

interface Drag {
  id: string;
  mode: DragMode;
  originX: number;
  started: boolean;
  cancelled: boolean;
  pointerId: number;
  offset: number;
}

interface Preview {
  id: string;
  start: IsoDate;
  end: IsoDate;
  duration: number;
}

const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Gantt({ session, state, showBaseline, highlightCritical, openDetails, openLink }: Props) {
  const project = state.project;
  const calendar = useMemo(() => session.calendar(), [session, project?.holidays]);
  const days = useMemo(() => (project ? chartDays(project, session.config.today, calendar) : []), [project, session, calendar]);
  const first = days[0]?.date ?? session.config.today;
  const regionRef = useRef<HTMLDivElement>(null);
  const linksRef = useRef<SVGSVGElement>(null);
  const bars = useRef(new Map<string, HTMLElement>());
  const knock = useRef<KnockOn | null>(null);
  const places = useRef(new Map<string, Place>());
  const [activeId, setActiveId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const drag = useRef<Drag | null>(null);
  const seenSeq = useRef(state.signal?.seq ?? 0);

  const items = project?.items ?? [];
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const work = items.filter((item) => item.kind !== "group" && item.start && item.end);
  const tabStop = work.some((item) => item.id === activeId) ? activeId : (work[0]?.id ?? "");
  const finishColumn = project?.finish ? daysBetween(first, project.finish) : -1;
  const todayColumn = daysBetween(first, session.config.today);
  const bodyHeight = items.length * ROW_PX;

  const placeFor = (item: Item): Place | null => {
    const shown = state.pending[item.id] ?? item;
    return shown.start && shown.end ? placeOf(item, first, shown.start, shown.end) : null;
  };

  const refreshLinks = () => {
    const svg = linksRef.current;
    const offsets = knock.current?.offsets;
    if (!svg || !project) return;
    for (const link of project.links) {
      const from = places.current.get(link.from);
      const to = places.current.get(link.to);
      const path = svg.querySelector(`[data-link-id="${link.id}"]`);
      if (from && to && path) path.setAttribute("d", connectorPath(link, from, to, offsets?.get(link.from) ?? 0, offsets?.get(link.to) ?? 0));
    }
  };

  useLayoutEffect(() => {
    if (regionRef.current && !knock.current) knock.current = new KnockOn(regionRef.current, refreshLinks);
  });

  useLayoutEffect(() => {
    const signal = state.signal;
    if (!signal || signal.seq === seenSeq.current || !project || !knock.current) return;
    seenSeq.current = signal.seq;
    if (reducedMotion()) return;
    const finishColumns = signal.previous.finish && project.finish ? daysBetween(project.finish, signal.previous.finish) : 0;
    knock.current.play(session.config, slidesBetween(signal.previous, project, signal.editedId, signal.previousLinks), finishColumns);
  }, [state.signal?.seq]);

  useLayoutEffect(refreshLinks);

  useEffect(() => () => knock.current?.settle(), []);

  if (!project) return null;

  const selectedBy = (itemId: string): string =>
    state.people
      .filter((person) => person.userId !== session.me.id && person.selected === itemId)
      .map((person) => person.name)
      .join(", ");

  const previewFor = (item: Item, mode: DragMode, offset: number): Preview | null => {
    if (!item.start || !item.end) return null;
    if (mode === "move") {
      const start = calendar.nextWorking(addDays(item.start, offset));
      return { id: item.id, start, end: item.kind === "milestone" ? start : calendar.shiftWorking(start, item.duration - 1), duration: item.duration };
    }
    if (mode === "end") {
      const wanted = calendar.previousWorking(addDays(item.end, offset));
      const end = wanted < item.start ? item.start : wanted;
      return { id: item.id, start: item.start, end, duration: calendar.workingSpan(item.start, end) };
    }
    const wanted = calendar.nextWorking(addDays(item.start, offset));
    const start = wanted > item.end ? item.end : wanted;
    return { id: item.id, start, end: item.end, duration: calendar.workingSpan(start, item.end) };
  };

  const commitDrag = (item: Item, mode: DragMode, shown: Preview) => {
    const payload = mode === "move" ? { start: shown.start } : mode === "end" ? { duration: shown.duration } : { start: shown.start, duration: shown.duration };
    void session.edit(item.id, (current) => ({
      payload,
      preview: { start: shown.start, end: shown.end },
      sentence: (result) => (mode === "move" || shown.duration === current.duration ? moveSentence(result, result.constraint?.predecessor ?? null) : resizeSentence(result)),
    }));
  };

  const endDrag = () => {
    drag.current = null;
    setPreview(null);
    window.removeEventListener("keydown", cancelOnEscape, true);
  };

  function cancelOnEscape(event: globalThis.KeyboardEvent) {
    if (event.key === "Escape" && drag.current) {
      drag.current.cancelled = true;
      setPreview(null);
    }
  }

  const onPointerDown = (event: PointerEvent<HTMLElement>, item: Item) => {
    if (item.kind === "group" || (event.pointerType === "mouse" && event.button !== 0)) return;
    const handle = (event.target as HTMLElement).closest("[data-handle]")?.getAttribute("data-handle");
    drag.current = { id: item.id, mode: handle === "start" || handle === "end" ? handle : "move", originX: event.clientX, started: false, cancelled: false, pointerId: event.pointerId, offset: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    window.addEventListener("keydown", cancelOnEscape, true);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>, item: Item) => {
    const current = drag.current;
    if (!current || current.id !== item.id || current.cancelled) return;
    const dx = event.clientX - current.originX;
    if (!current.started && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    current.started = true;
    current.offset = Math.round(dx / DAY_PX);
    if (!session.readOnly) setPreview(previewFor(item, current.mode, current.offset));
  };

  const onPointerUp = (event: PointerEvent<HTMLElement>, item: Item) => {
    const current = drag.current;
    if (!current || current.id !== item.id) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const shown = current.started && !current.cancelled && current.offset !== 0 ? previewFor(item, current.mode, current.offset) : null;
    const wasDrag = current.started && !current.cancelled;
    endDrag();
    if (session.readOnly) {
      if (wasDrag) session.announceReadOnly();
    } else if (shown) commitDrag(item, current.mode, shown);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, item: Item) => {
    const index = work.findIndex((candidate) => candidate.id === item.id);
    const sideways = event.key === "ArrowRight" || event.key === "ArrowLeft";
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = work[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (next) bars.current.get(next.id)?.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      openDetails(item.id, event.currentTarget);
    } else if (event.key.toLowerCase() === "l" && !event.shiftKey) {
      event.preventDefault();
      if (session.readOnly) session.announceReadOnly();
      else openLink(item, event.currentTarget);
    } else if (sideways) {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      if (!event.shiftKey) {
        void session.edit(item.id, (current, working) => {
          const target = working.shiftWorking(current.start ?? "", step);
          const end = current.kind === "milestone" ? target : working.shiftWorking(target, current.duration - 1);
          return { payload: { start: target }, preview: { start: target, end }, sentence: (result) => moveSentence(result, result.constraint?.predecessor ?? null) };
        });
      } else if (item.kind === "task") {
        void session.edit(item.id, (current, working) => {
          if (current.duration + step < 1) return { announce: minimumDuration(current) };
          const end = working.shiftWorking(current.start ?? "", current.duration + step - 1);
          return { payload: { duration: current.duration + step }, preview: { start: current.start ?? "", end }, sentence: resizeSentence };
        });
      }
    }
  };

  const linkIsCritical = (link: Link): string => String(link.critical);

  return (
    <div className="gantt">
      <div className="gantt-names" style={{ ["--header" as string]: `${HEADER_PX}px` }}>
        <div className="names-head">Task</div>
        {items.map((item) => (
          <div key={item.id} className="name-row" data-kind={item.kind} data-grouped={item.group ? "true" : undefined} title={item.name}>
            <span className="row-number">{item.row}</span>
            <span className="row-name">{item.name}</span>
          </div>
        ))}
      </div>
      <div className="chart" role="region" aria-label="Chart" ref={regionRef}>
        <div className="chart-canvas" style={{ width: days.length * DAY_PX, height: HEADER_PX + bodyHeight }}>
          <div className="chart-head" style={{ height: HEADER_PX }}>
            <MonthLabels days={days} height={MONTH_ROW_PX} />
            <DayHeader days={days} top={MONTH_ROW_PX} height={DAY_ROW_PX} />
          </div>
          <div className="chart-body" style={{ top: HEADER_PX, height: bodyHeight }}>
            {days.map((day, column) =>
              day.working ? null : (
                <div key={day.date} className="shade" style={{ left: column * DAY_PX }} aria-hidden="true">
                  {day.holiday ? <span className="holiday-name">{day.holiday}</span> : null}
                </div>
              ),
            )}
            {todayColumn >= 0 && todayColumn < days.length ? <div id="today-line" data-date={session.config.today} style={{ left: todayColumn * DAY_PX + DAY_PX / 2 - 1 }} /> : null}
            {project.finish && finishColumn >= 0 ? (
              <div id="finish-marker" data-date={project.finish} style={{ left: (finishColumn + 1) * DAY_PX + 2 }}>
                <span>Finish</span>
              </div>
            ) : null}
            {showBaseline
              ? items.flatMap((item) =>
                  item.baseline ? [<div key={`ghost-${item.id}`} data-baseline-bar="" data-item-id={item.id} data-start={item.baseline.start} data-end={item.baseline.end} className="ghost" style={{ left: daysBetween(first, item.baseline.start) * DAY_PX, width: (daysBetween(first, item.baseline.end) - daysBetween(first, item.baseline.start) + 1) * DAY_PX, top: item.row * ROW_PX - 8 }} aria-hidden="true" />] : [],
                )
              : null}
            <svg className="links" width={days.length * DAY_PX} height={bodyHeight} ref={linksRef} aria-hidden="true">
              {project.links.map((link) => {
                const from = byId.get(link.from);
                const to = byId.get(link.to);
                const fromPlace = from && placeFor(from);
                const toPlace = to && placeFor(to);
                if (!fromPlace || !toPlace) return null;
                return <path key={link.id} data-link-id={link.id} data-from={link.from} data-to={link.to} data-type={link.type} data-lag={link.lag} data-critical={linkIsCritical(link)} d={connectorPath(link, fromPlace, toPlace, 0, 0)} />;
              })}
            </svg>
            {items.map((item) => {
              const place = placeFor(item);
              if (!place) return null;
              places.current.set(item.id, place);
              const isGroup = item.kind === "group";
              const busy = state.busy.has(item.id);
              const column = place.left / DAY_PX;
              const tail = !isGroup && item.float && !state.pending[item.id] ? tailColumns(column + place.width / DAY_PX - 1, item.float, days) : 0;
              const others = selectedBy(item.id);
              return (
                <div key={item.id} className="bar-slot" style={{ top: place.row * ROW_PX }}>
                  <div
                    ref={(element) => {
                      if (element) bars.current.set(item.id, element);
                      else bars.current.delete(item.id);
                    }}
                    role={isGroup ? "img" : "button"}
                    aria-label={item.name}
                    aria-describedby={`describe-${item.id}`}
                    aria-busy={busy ? "true" : undefined}
                    aria-disabled={!isGroup && session.readOnly ? "true" : undefined}
                    tabIndex={isGroup ? undefined : item.id === tabStop ? 0 : -1}
                    className="bar"
                    data-item-id={item.id}
                    data-kind={item.kind}
                    data-start={(state.pending[item.id] ?? item).start ?? undefined}
                    data-end={(state.pending[item.id] ?? item).end ?? undefined}
                    data-duration={isGroup || !state.pending[item.id] ? item.duration : calendar.workingSpan(state.pending[item.id].start, state.pending[item.id].end)}
                    data-percent={item.percent}
                    data-critical={String(item.critical)}
                    data-late={String(item.late)}
                    data-variance={item.baseline ? item.baseline.variance : undefined}
                    data-baseline-start={item.baseline?.start}
                    data-baseline-end={item.baseline?.end}
                    data-shifted={state.shifted.has(item.id) ? "true" : undefined}
                    data-dimmed={highlightCritical && !item.critical ? "true" : undefined}
                    data-selected-by={others || undefined}
                    data-dragging={preview?.id === item.id ? "true" : undefined}
                    style={{ left: preview?.id === item.id ? daysBetween(first, preview.start) * DAY_PX : place.left, width: preview?.id === item.id ? (daysBetween(preview.start, preview.end) + 1) * DAY_PX : place.width }}
                    onFocus={() => {
                      if (!isGroup) {
                        setActiveId(item.id);
                        session.select(item.id);
                      }
                    }}
                    onBlur={(event) => {
                      if (!isGroup && !(event.relatedTarget instanceof HTMLElement && event.relatedTarget.hasAttribute("data-item-id"))) session.select(null);
                    }}
                    onKeyDown={isGroup ? undefined : (event) => onKeyDown(event, item)}
                    onPointerDown={isGroup ? undefined : (event) => onPointerDown(event, item)}
                    onPointerMove={isGroup ? undefined : (event) => onPointerMove(event, item)}
                    onPointerUp={isGroup ? undefined : (event) => onPointerUp(event, item)}
                    onPointerCancel={isGroup ? undefined : () => endDrag()}
                  >
                    {item.kind === "task" ? (
                      <>
                        <span className="bar-progress" style={{ width: `${item.percent}%` }} />
                        <span className="handle" data-handle="start" />
                        <span className="handle" data-handle="end" />
                      </>
                    ) : null}
                  </div>
                  <span id={`describe-${item.id}`} hidden>
                    {describeItem(item, project)}
                  </span>
                  {tail > 0 ? <span className="tail" style={{ left: place.left + place.width, width: tail * DAY_PX }} aria-hidden="true" /> : null}
                  {item.late && !isGroup && !state.pending[item.id] ? <span className="late-word" style={{ left: place.left + place.width + tail * DAY_PX + 6 }} aria-hidden="true">Late</span> : null}
                  {others ? <span className="presence-tag" style={{ left: place.left + place.width + tail * DAY_PX + (item.late ? 44 : 6) }} aria-hidden="true">{others}</span> : null}
                </div>
              );
            })}
            {preview ? (
              <div id="drag-tip" style={{ left: daysBetween(first, preview.start) * DAY_PX, top: (byId.get(preview.id)?.row ?? 1) * ROW_PX - ROW_PX - 4 }}>
                {formatLong(preview.start)} - {formatLong(preview.end)}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
