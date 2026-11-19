import { useRef, useState } from "preact/hooks";
import { api } from "../api";
import { useMount } from "../hooks";
import { orderTasks, SAVE_FAILED, type Bundle, type ProjectData } from "../project-data";
import { announce, toast } from "../store";
import type { Task } from "../types";
import { Status } from "../ui";
import { TraceLine } from "./TraceLine";
import { clearPlaces, useMove } from "./useMove";

interface Props { data: ProjectData; bundle: Bundle; onOpen: (task: Task) => void }

const DAY = 32;
const ROW = 64;
const HEAD = 52;
const NS = "timeline:";
const DAY_MS = 86_400_000;

const dayNumber = (iso: string) => Math.round(new Date(`${iso}T00:00:00Z`).getTime() / DAY_MS);
const fromDayNumber = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const shift = (iso: string, days: number) => fromDayNumber(dayNumber(iso) + days);

interface Scheduled { task: Task; start: string; due: string }

function Bar({ item, left, top, width, label, candidate, onKeyDown, onClick, onFocus }: {
  item: Scheduled; left: number; top: number; width: number; label: string; candidate: boolean;
  onKeyDown: (e: KeyboardEvent) => void; onClick: () => void; onFocus: () => void;
}) {
  const ref = useMove<HTMLButtonElement>(NS, item.task.id, `${item.start}:${item.due}`);
  return (
    <button ref={ref} type="button" class={`bar${item.task.completed ? " is-done" : ""}${candidate ? " is-candidate" : ""}`} aria-label={label}
      aria-current={candidate ? "true" : undefined} data-task={item.task.id} data-open-id={item.task.id} data-start={item.start} data-due={item.due}
      style={{ left: `${left}px`, top: `${top}px`, width: `${width}px` }} onKeyDown={onKeyDown} onClick={onClick} onFocus={onFocus} />
  );
}

export function TimelineView({ data, bundle, onOpen }: Props) {
  const { project, tasks } = bundle;
  const [linking, setLinking] = useState<{ from: string; candidate: string | null } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const focused = useRef<string | null>(null);
  /** The first day of the grid stays put while bars move, so a moved bar visibly moves. */
  const anchor = useRef<number | null>(null);
  useMount(() => () => clearPlaces(NS), []);
  useMount(() => {
    const active = document.activeElement;
    if (focused.current && (!active || active === document.body)) {
      root.current?.querySelector<HTMLElement>(`[data-task="${focused.current}"]`)?.focus({ preventScroll: true });
    }
  });

  const ordered = orderTasks(tasks, project.sections).filter((t) => !t.parentId);
  const scheduled: Scheduled[] = ordered.filter((t) => t.due).map((t) => ({ task: t, start: t.start ?? t.due!, due: t.due! }));
  const unscheduled = ordered.filter((t) => !t.due);
  const byId = new Map(ordered.map((t) => [t.id, t]));
  const earliest = scheduled.length ? Math.min(...scheduled.map((s) => dayNumber(s.start))) - 3 : 0;
  if (anchor.current === null || earliest < anchor.current) anchor.current = earliest;
  const firstDay = anchor.current;
  const lastDay = scheduled.length ? Math.max(...scheduled.map((s) => dayNumber(s.due))) + 14 : firstDay;
  const days = Math.max(lastDay - firstDay + 1, 21);
  const rowOf = new Map(scheduled.map((s, i) => [s.task.id, i]));
  const x = (iso: string) => (dayNumber(iso) - firstDay) * DAY;

  const label = (s: Scheduled) => `${s.task.name}, ${s.start} to ${s.due}`;

  const reschedule = (s: Scheduled, start: string | null, due: string, text: string) => {
    announce("Timeline status", text);
    void data.save(s.task.id, start === null ? { due } : { start, due }, (all) => all.map((t) => (t.id === s.task.id ? { ...t, start: start ?? t.start, due } : t)));
  };

  const finishLinking = (cancelled: boolean) => {
    const mode = linking;
    setLinking(null);
    if (!mode) return;
    const source = byId.get(mode.from)!;
    if (cancelled || !mode.candidate) {
      announce("Timeline status", "Dependency cancelled");
    } else {
      const target = byId.get(mode.candidate)!;
      void api("POST", `/api/tasks/${mode.from}/dependencies`, { blocks: mode.candidate }).then((result) => {
        if (result.ok) {
          announce("Timeline status", `${source.name} now blocks ${target.name}`);
          data.setTasks((all) => all.map((t) => (t.id === mode.from && !t.blocks.includes(mode.candidate!) ? { ...t, blocks: [...t.blocks, mode.candidate!] } : t)));
        } else if (result.errors.blocks) announce("Timeline status", result.errors.blocks);
        else toast(SAVE_FAILED);
      });
    }
    queueMicrotask(() => root.current?.querySelector<HTMLElement>(`[data-task="${mode.from}"]`)?.focus());
  };

  const keydown = (s: Scheduled) => (event: KeyboardEvent) => {
    const key = event.key;
    if (linking) {
      if (key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        return finishLinking(true);
      }
      if (key === "Enter") {
        event.preventDefault();
        return finishLinking(false);
      }
      if (key.startsWith("Arrow")) {
        event.preventDefault();
        const others = scheduled.filter((o) => o.task.id !== linking.from);
        const at = others.findIndex((o) => o.task.id === s.task.id);
        const forward = key === "ArrowDown" || key === "ArrowRight";
        const from = rowOf.get(linking.from) ?? 0;
        const next = at >= 0
          ? others[(at + (forward ? 1 : -1) + others.length) % others.length]
          : (forward ? others.find((o) => rowOf.get(o.task.id)! > from) : [...others].reverse().find((o) => rowOf.get(o.task.id)! < from)) ?? others[0];
        if (!next) return;
        setLinking({ ...linking, candidate: next.task.id });
        root.current?.querySelector<HTMLElement>(`[data-task="${next.task.id}"]`)?.focus();
      }
      return;
    }
    if (key === "d" || key === "D") {
      event.preventDefault();
      setLinking({ from: s.task.id, candidate: null });
      announce("Timeline status", `Choose the task that waits for ${s.task.name}`);
    } else if (key === "ArrowRight" || key === "ArrowLeft") {
      event.preventDefault();
      const step = key === "ArrowRight" ? 1 : -1;
      if (event.shiftKey) {
        const due = shift(s.due, step);
        if (due < s.start) announce("Timeline status", "Due date can't be before the start date");
        else reschedule(s, s.task.start, due, `${s.task.name} now due ${due}`);
      } else {
        const start = shift(s.start, step);
        const due = shift(s.due, step);
        reschedule(s, start, due, `${s.task.name} moved to ${start} to ${due}`);
      }
    }
  };

  const lines = scheduled.flatMap((from) => from.task.blocks.map((id) => ({ from, to: scheduled.find((s) => s.task.id === id) })).filter((l) => l.to));
  const warnings = (s: Scheduled) =>
    scheduled.filter((blocker) => blocker.task.blocks.includes(s.task.id) && blocker.due >= s.start).map((blocker) => blocker.task.name);

  return (
    <div class="timeline-view" ref={root}>
      <Status name="Timeline status" />
      <div class="timeline-scroll" role="region" aria-label="Timeline" tabIndex={0}>
        <div class="timeline-canvas" style={{ width: `${days * DAY}px`, height: `${HEAD + Math.max(scheduled.length, 1) * ROW}px`, "--day": `${DAY}px` }}>
          <div class="timeline-head" aria-hidden="true">
            {Array.from({ length: days }, (_, i) => {
              const iso = fromDayNumber(firstDay + i);
              const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
              return (
                <div key={iso} class={`day${weekday === 0 || weekday === 6 ? " is-weekend" : ""}`} style={{ left: `${i * DAY}px` }}>
                  <span class="num">{iso.slice(8)}</span>
                  {(i === 0 || iso.endsWith("-01")) && <span class="month">{iso.slice(0, 7)}</span>}
                </div>
              );
            })}
          </div>
          <svg class="deps" width={days * DAY} height={HEAD + Math.max(scheduled.length, 1) * ROW} aria-hidden="true">
            <defs>
              <marker id="dep-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">
                <path d="M0 0 8 4 0 8z" fill="#0D0D0D" />
              </marker>
            </defs>
            {lines.map(({ from, to }) => {
              const x1 = x(from.due) + DAY;
              const y1 = HEAD + rowOf.get(from.task.id)! * ROW + 16;
              const x2 = x(to!.start);
              const y2 = HEAD + rowOf.get(to!.task.id)! * ROW + 16;
              return <path key={`${from.task.id}-${to!.task.id}`} data-from={from.task.id} data-to={to!.task.id} d={`M ${x1} ${y1} H ${x1 + 10} V ${y2} H ${x2}`}
                fill="none" stroke="#0D0D0D" stroke-width="1.5" marker-end="url(#dep-arrow)" />;
            })}
          </svg>
          {scheduled.map((s, i) => {
            const top = HEAD + i * ROW;
            const left = x(s.start);
            const width = (dayNumber(s.due) - dayNumber(s.start) + 1) * DAY;
            return (
              <div key={s.task.id} class="lane" style={{ top: `${top}px` }}>
                <Bar item={s} left={left} top={top + 0} width={width} label={label(s)} candidate={linking?.candidate === s.task.id}
                  onKeyDown={keydown(s)} onClick={() => (linking ? undefined : onOpen(s.task))} onFocus={() => { focused.current = s.task.id; }} />
                <span class="bar-label" style={{ left: `${left + width + 8}px`, top: `${top + 2}px` }} aria-hidden="true">
                  {s.task.name} <span class="muted num">{s.start} to {s.due}</span>
                </span>
                {warnings(s).map((name) => (
                  <span key={name} class="bar-warning" style={{ left: `${left + width + 8}px`, top: `${top + 26}px` }}>{`Starts before ${name} is due`}</span>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <TraceLine ids={project.trace.filter((id) => rowOf.has(id))} container={root} mode="timeline" />
      <section class="unscheduled" aria-labelledby="unscheduled-title">
        <h2 id="unscheduled-title">Unscheduled</h2>
        {unscheduled.length === 0 ? <p class="muted">Every task has a due date.</p> : (
          <ul class="plain-list">
            {unscheduled.map((t) => (
              <li key={t.id}><button type="button" class="link-button" data-open-id={t.id} aria-label={`Open ${t.name}`} onClick={() => onOpen(t)}>{t.name}</button></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
