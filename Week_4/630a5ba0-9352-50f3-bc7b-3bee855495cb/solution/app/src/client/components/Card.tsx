import { useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { Task } from "../../shared/types.js";
import { dayLabel } from "../../shared/time.js";
import { prefersReducedMotion } from "../announce.js";

const ESTIMATES: { minutes: number; short: string }[] = [
  { minutes: 15, short: "15m" },
  { minutes: 30, short: "30m" },
  { minutes: 45, short: "45m" },
  { minutes: 60, short: "60m" },
  { minutes: 90, short: "90m" },
  { minutes: 120, short: "2h" },
];

/** Where each card stood before a refused move, so it can slide back (FLIP). */
export const slideFrom = new Map<string, DOMRect>();

type Props = {
  task: Task;
  today: string;
  estimating: boolean;
  held: boolean;
  focus: boolean;
  onFocused: () => void;
  onPointerDown: (task: Task, event: PointerEvent<HTMLElement>) => void;
  onMoveKey: (task: Task, event: KeyboardEvent<HTMLButtonElement>) => void;
  onBlurMove: (task: Task) => void;
  onDone: (task: Task, done: boolean) => void;
  onEstimate: (task: Task, minutes: number) => void;
};

export function Card({ task, today, estimating, held, focus, onFocused, onPointerDown, onMoveKey, onBlurMove, onDone, onEstimate }: Props) {
  const slip = useRef<HTMLLIElement>(null);
  const move = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (focus) {
      move.current?.focus();
      onFocused();
    }
  }, [focus, onFocused]);

  useLayoutEffect(() => {
    const from = slideFrom.get(task.id);
    const element = slip.current;
    if (!from || !element) return;
    slideFrom.delete(task.id);
    const to = element.getBoundingClientRect();
    if (prefersReducedMotion()) return;
    element.animate(
      [{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: "translate(0, 0)" }],
      { duration: 400, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  });

  const done = task.status === "done";
  const past = task.dayDate !== null && task.dayDate < today && !done;
  return (
    <li
      ref={slip}
      className={`slip${held ? " is-held" : ""}${done ? " is-done" : ""}`}
      data-task={task.id}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("input, [role=radiogroup]")) return;
        onPointerDown(task, event);
      }}
    >
      <div className="slip-row">
        <input
          type="checkbox"
          className="slip-done"
          aria-label={`Done: ${task.title}`}
          checked={done}
          onChange={(event) => onDone(task, event.currentTarget.checked)}
        />
        <div className="slip-body">
          <button
            ref={move}
            type="button"
            className="slip-move"
            aria-label={`Move ${task.title}`}
            data-move={task.id}
            onKeyDown={(event) => onMoveKey(task, event)}
            onBlur={() => onBlurMove(task)}
          />
          <span className="slip-title">{task.title}</span>
          <span className="slip-meta">
            <span className="mono">{task.estimateMinutes === null ? "No estimate" : `${task.estimateMinutes}m`}</span>
            {past && task.dayDate && <span className="slip-from">From {dayLabel(task.dayDate)}</span>}
          </span>
        </div>
      </div>
      {estimating && !done && (
        <div className="estimates" role="radiogroup" aria-label={`Estimate for ${task.title}`}>
          {ESTIMATES.map((option) => (
            <label key={option.minutes} className="estimate">
              <input
                type="radio"
                name={`estimate-${task.id}`}
                aria-label={`${option.minutes} minutes`}
                checked={task.estimateMinutes === option.minutes}
                onChange={() => onEstimate(task, option.minutes)}
              />
              <span className="mono" aria-hidden="true">
                {option.short}
              </span>
            </label>
          ))}
        </div>
      )}
    </li>
  );
}
