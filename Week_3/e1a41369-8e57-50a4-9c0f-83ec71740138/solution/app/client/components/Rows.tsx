import { Check, Minus, Plus } from "lucide-react";
import { useRef, type PointerEvent } from "react";
import type { Task } from "../../shared/api";
import { buyReward, completeTask, scoreHabit, uncompleteTask } from "../actions";
import { GENERIC_FAILURE, api } from "../api";
import { hundredths, reducedMotion } from "../format";
import { setState, useStore } from "../store";

const SWIPE_COMPLETE_PX = 80;

interface RowProps {
  task: Task;
  tabIndex: number;
  onEdit: (task: Task, row: HTMLElement) => void;
}

function Chip({ task }: { task: Task }) {
  return <span className={`chip chip-${task.band!.toLowerCase()}`}>{task.band}</span>;
}

function Title({ task, onEdit }: RowProps) {
  return (
    <span className="row-title" onClick={(event) => onEdit(task, event.currentTarget.closest<HTMLElement>("[data-task-id]")!)}>
      {task.title}
    </span>
  );
}

function Complete({ task }: { task: Task }) {
  const pending = useStore((state) => state.pendingTasks.includes(task.id));
  return (
    <input
      type="checkbox"
      className="tick"
      aria-label={`Complete ${task.title}`}
      aria-disabled={pending}
      checked={!!task.done}
      tabIndex={-1}
      onChange={(event) => {
        const row = event.currentTarget.closest<HTMLElement>("[data-task-id]");
        void (event.currentTarget.checked ? completeTask(task, row) : uncompleteTask(task));
      }}
    />
  );
}

/** A rightward drag of at least 80 px completes a daily or to-do that is not done; anything else springs back. */
function useSwipe(task: Task) {
  const body = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; id: number } | null>(null);
  const distance = useRef(0);

  const release = (complete: boolean): void => {
    const element = body.current!;
    const from = distance.current;
    start.current = null;
    distance.current = 0;
    element.style.transform = "";
    if (from > 0 && !reducedMotion()) element.animate([{ transform: `translateX(${from}px)` }, { transform: "translateX(0)" }], { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" });
    if (complete) void completeTask(task, element.closest<HTMLElement>("[data-task-id]"));
  };

  return {
    body,
    handlers: {
      onPointerDown: (event: PointerEvent) => {
        if (event.pointerType === "touch") start.current = { x: event.clientX, id: event.pointerId };
      },
      onPointerMove: (event: PointerEvent) => {
        if (!start.current || event.pointerId !== start.current.id) return;
        distance.current = Math.max(0, event.clientX - start.current.x);
        body.current!.style.transform = `translateX(${distance.current}px)`;
      },
      onPointerUp: () => start.current && release(distance.current >= SWIPE_COMPLETE_PX && !task.done),
      onPointerCancel: () => start.current && release(false),
    },
  };
}

function Underlay() {
  return (
    <div className="row-underlay" aria-hidden="true">
      <Check size={24} />
    </div>
  );
}

export function HabitRow(props: RowProps) {
  const { task, tabIndex } = props;
  const pending = useStore((state) => state.pendingTasks.includes(task.id));
  return (
    <li className="row row-habit" data-task-id={task.id} tabIndex={tabIndex} aria-label={`Habit: ${task.title}, score ${task.value}`}>
      <div className="row-body">
        <Title {...props} />
        <button type="button" className="score score-down" tabIndex={-1} aria-label={`Score ${task.title} down`} aria-disabled={pending} onClick={(event) => void scoreHabit(task, "down", event.currentTarget.closest<HTMLElement>("[data-task-id]"))}>
          <Minus aria-hidden="true" size={22} />
        </button>
        <span className="row-meta">
          <Chip task={task} />
          <span className="row-figure">{task.value}</span>
        </span>
        <button type="button" className="score score-up" tabIndex={-1} aria-label={`Score ${task.title} up`} aria-disabled={pending} onClick={(event) => void scoreHabit(task, "up", event.currentTarget.closest<HTMLElement>("[data-task-id]"))}>
          <Plus aria-hidden="true" size={22} />
        </button>
      </div>
    </li>
  );
}

export function DailyRow(props: RowProps) {
  const { task, tabIndex } = props;
  const swipe = useSwipe(task);
  const label = `Daily: ${task.title}, ${task.dueToday ? "due today" : "not due today"}, streak ${task.streak}, ${task.done ? "done" : "not done"}`;
  return (
    <li className={`row row-daily${task.dueToday ? "" : " row-quiet"}`} data-task-id={task.id} tabIndex={tabIndex} aria-label={label}>
      <Underlay />
      <div className="row-body" ref={swipe.body} {...swipe.handlers}>
        <Complete task={task} />
        <Title {...props} />
        <Chip task={task} />
        <span className="row-note">{`Streak ${task.streak}`}</span>
      </div>
    </li>
  );
}

export function TodoRow(props: RowProps) {
  const { task, tabIndex } = props;
  const swipe = useSwipe(task);
  const items = task.checklist!;
  const checked = items.filter((item) => item.checked).length;
  const progress = items.length > 0 ? `, ${checked} of ${items.length} checklist items` : "";
  return (
    <li className="row row-todo" data-task-id={task.id} tabIndex={tabIndex} aria-label={`To-do: ${task.title}${progress}, ${task.done ? "done" : "not done"}`}>
      <Underlay />
      <div className="row-body" ref={swipe.body} {...swipe.handlers}>
        <Complete task={task} />
        <Title {...props} />
        <Chip task={task} />
        {items.length > 0 && (
          <div className="checklist">
            {items.map((item) => (
              <label className="check-item" key={item.id}>
                <input
                  type="checkbox"
                  tabIndex={-1}
                  checked={item.checked}
                  onChange={(event) => void api("PATCH", `/api/tasks/${task.id}/checklist/${item.id}`, { checked: event.currentTarget.checked }).catch(() => setState({ alert: GENERIC_FAILURE }))}
                />
                <span>{item.text}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

export function RewardRow(props: RowProps) {
  const { task, tabIndex } = props;
  const pending = useStore((state) => state.pendingTasks.includes(task.id));
  return (
    <li className="row row-reward" data-task-id={task.id} tabIndex={tabIndex} aria-label={`Reward: ${task.title}, costs ${hundredths(task.price!)} gold`}>
      <div className="row-body">
        <Title {...props} />
        <span className="row-price">{`${hundredths(task.price!)} gold`}</span>
        <button type="button" className="btn" tabIndex={-1} aria-disabled={pending} aria-label={`Buy ${task.title}`} onClick={() => void buyReward(task)}>
          Buy
        </button>
      </div>
    </li>
  );
}

