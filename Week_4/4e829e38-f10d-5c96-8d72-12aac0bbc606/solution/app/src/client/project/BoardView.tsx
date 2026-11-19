import { useRef, useState } from "preact/hooks";
import { useMount } from "../hooks";
import { topLevelIn, withMove, type Bundle, type ProjectData } from "../project-data";
import { announce } from "../store";
import type { Section, Task } from "../types";
import { Status } from "../ui";
import { clearPlaces, useMove } from "./useMove";
import { TraceLine } from "./TraceLine";

interface Props { data: ProjectData; bundle: Bundle; onOpen: (task: Task) => void }

interface Move { id: string; originSection: string; originPosition: number; originCount: number; section: string; position: number }
interface Drag { id: string; x: number; y: number; section: string | null; position: number }

const NS = "board:";
const DRAG_THRESHOLD = 8;

function Card({ task, section, index, count, lifted, handlers }: {
  task: Task; section: Section; index: number; count: number; lifted: boolean;
  handlers: Record<string, (e: any) => void>;
}) {
  const ref = useMove<HTMLDivElement>(NS, task.id, `${task.section}:${task.position}`);
  return (
    <div ref={ref} role="button" tabIndex={0} class={`card board-card${lifted ? " is-lifted" : ""}${task.completed ? " is-done" : ""}`}
      aria-label={`${task.name}, ${section.name}, position ${index} of ${count}`} data-task={task.id} data-open-id={task.id}
      data-section={task.section} data-position={index} {...handlers}>
      <span class="card-title">{task.name}</span>
      {task.due && <span class="muted num card-meta" data-text={task.due} />}
    </div>
  );
}

export function BoardView({ data, bundle, onOpen }: Props) {
  const { project, tasks } = bundle;
  const [move, setMove] = useState<Move | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const focused = useRef<string | null>(null);
  const press = useRef<{ id: string; x: number; y: number; pointer: number } | null>(null);
  const suppress = useRef(false);

  useMount(() => () => clearPlaces(NS), []);
  useMount(() => {
    const active = document.activeElement;
    if (focused.current && (!active || active === document.body)) {
      root.current?.querySelector<HTMLElement>(`[data-task="${focused.current}"]`)?.focus({ preventScroll: true });
    }
  });

  const columns = project.sections.map((section) => ({ section, cards: topLevelIn(tasks, section.id) }));
  const sectionById = new Map(project.sections.map((s) => [s.id, s]));

  const commit = (task: Task, sectionId: string, position: number) => {
    const target = sectionById.get(sectionId)!;
    const count = topLevelIn(tasks, sectionId).filter((t) => t.id !== task.id).length + 1;
    void data.save(task.id, { section: sectionId, position }, (all) => withMove(all, task.id, sectionId, position));
    announce("Board status", `Dropped ${task.name} in ${target.name}, position ${Math.min(position, count)} of ${count}.`);
  };

  /* ------------------------------------------------------------ keyboard */

  const target = (m: Move): { count: number; position: number } => {
    const others = topLevelIn(tasks, m.section).filter((t) => t.id !== m.id).length;
    const count = others + 1;
    return { count, position: Math.min(m.position, count) };
  };

  const describe = (task: Task, m: Move) => {
    const { count, position } = target(m);
    return `${task.name}, ${sectionById.get(m.section)!.name}, position ${position} of ${count}.`;
  };

  const keydown = (task: Task) => (event: KeyboardEvent) => {
    if (event.key === " ") {
      event.preventDefault();
      if (!move) {
        const section = sectionById.get(task.section)!;
        const count = topLevelIn(tasks, task.section).length;
        setMove({ id: task.id, originSection: task.section, originPosition: task.position, originCount: count, section: task.section, position: task.position });
        announce("Board status", `Picked up ${task.name}. ${section.name}, position ${task.position} of ${count}.`);
      } else if (move.id === task.id) {
        const { position } = target(move);
        setMove(null);
        commit(task, move.section, position);
      }
    } else if (event.key === "Escape" && move) {
      event.preventDefault();
      event.stopPropagation();
      const origin = sectionById.get(move.originSection)!;
      announce("Board status", `Move cancelled. ${task.name} is back in ${origin.name}, position ${move.originPosition} of ${move.originCount}.`);
      setMove(null);
    } else if (move && move.id === task.id && event.key.startsWith("Arrow")) {
      event.preventDefault();
      const index = project.sections.findIndex((s) => s.id === move.section);
      let next: Move = { ...move, position: target(move).position };
      if (event.key === "ArrowRight") next = { ...next, section: project.sections[Math.min(project.sections.length - 1, index + 1)].id };
      if (event.key === "ArrowLeft") next = { ...next, section: project.sections[Math.max(0, index - 1)].id };
      const limit = topLevelIn(tasks, next.section).filter((t) => t.id !== task.id).length + 1;
      if (event.key === "ArrowDown") next.position = Math.min(limit, next.position + 1);
      if (event.key === "ArrowUp") next.position = Math.max(1, next.position - 1);
      next.position = Math.min(next.position, limit);
      setMove(next);
      announce("Board status", describe(task, next));
    } else if (event.key === "Enter" && !move) {
      event.preventDefault();
      onOpen(task);
    }
  };

  /* ------------------------------------------------------------ pointer and touch drag */

  const aim = (x: number, y: number, id: string): { section: string | null; position: number } => {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('[role="group"][data-section-id]');
    if (!hit) return { section: null, position: 1 };
    const sectionId = hit.dataset.sectionId!;
    const cards = [...hit.querySelectorAll<HTMLElement>("[data-task]")].filter((c) => c.dataset.task !== id);
    const before = cards.filter((c) => c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2 < y).length;
    return { section: sectionId, position: before + 1 };
  };

  const pointerHandlers = (task: Task) => ({
    onPointerDown: (e: PointerEvent) => {
      suppress.current = false;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      press.current = { id: task.id, x: e.clientX, y: e.clientY, pointer: e.pointerId };
    },
    onPointerMove: (e: PointerEvent) => {
      const start = press.current;
      if (!start || start.pointer !== e.pointerId || start.id !== task.id) return;
      if (!drag && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD) return;
      if (!drag) (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setDrag({ id: task.id, x: e.clientX, y: e.clientY, ...aim(e.clientX, e.clientY, task.id) });
    },
    onPointerUp: () => {
      const dragging = drag;
      press.current = null;
      if (!dragging) return;
      suppress.current = true;
      setDrag(null);
      if (dragging.section) commit(task, dragging.section, dragging.position);
    },
    onPointerCancel: () => {
      press.current = null;
      setDrag(null);
    },
    onClick: () => {
      if (suppress.current) suppress.current = false;
      else onOpen(task);
    },
    onKeyDown: keydown(task),
    onFocus: () => { focused.current = task.id; },
    onBlur: (e: FocusEvent) => { if ((e.currentTarget as HTMLElement).isConnected) focused.current = null; },
  });

  const dragged = drag ? tasks.find((t) => t.id === drag.id) : undefined;
  const marker = drag?.section ? { section: drag.section, position: drag.position } : move ? { section: move.section, position: target(move).position } : null;
  return (
    <div class="board-view" ref={root}>
      <Status name="Board status" assertive />
      <div class="board">
        {columns.map(({ section, cards }) => {
          const withoutMoving = cards.filter((c) => c.id !== (move?.id ?? drag?.id));
          return (
            <section key={section.id} role="group" aria-label={section.name} data-section-id={section.id} class="board-column">
              <h3 class="column-title">{section.name}<span class="muted num">{cards.length}</span></h3>
              <div class="column-cards">
                {cards.map((task, i) => {
                  const isMoving = task.id === (move?.id ?? drag?.id);
                  const slot = marker?.section === section.id && !isMoving && withoutMoving.indexOf(task) === marker.position - 1;
                  return (
                    <div key={task.id} class="card-slot">
                      {slot && <div class="drop-marker" aria-hidden="true" />}
                      <Card task={task} section={section} index={i + 1} count={cards.length} lifted={isMoving} handlers={pointerHandlers(task)} />
                    </div>
                  );
                })}
                {marker?.section === section.id && marker.position > withoutMoving.length && <div class="drop-marker" aria-hidden="true" />}
                {cards.length === 0 && <p class="muted column-empty">No tasks</p>}
              </div>
            </section>
          );
        })}
      </div>
      {drag && dragged && <div class="card board-card drag-ghost" aria-hidden="true" style={{ left: `${drag.x}px`, top: `${drag.y}px` }}>{dragged.name}</div>}
      <TraceLine ids={project.trace} container={root} mode="board" />
    </div>
  );
}
