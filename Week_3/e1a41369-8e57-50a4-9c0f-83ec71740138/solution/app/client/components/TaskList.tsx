import { Plus } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Task, TaskType } from "../../shared/api";
import { moveTask, scoreHabit, completeTask, uncompleteTask } from "../actions";
import { applyPendingFocus, rowSelector } from "../focus";
import { DailyRow, HabitRow, RewardRow, TodoRow } from "./Rows";

export type ListName = "habits" | "dailies" | "todos" | "rewards";

interface ListSpec {
  title: string;
  type: TaskType;
  singular: string;
  word: string;
  empty: string;
}

export const LISTS: Record<ListName, ListSpec> = {
  habits: { title: "Habits", type: "habit", singular: "habit", word: "FRESH", empty: "No habits yet. Add one to start scoring." },
  dailies: { title: "Dailies", type: "daily", singular: "daily", word: "OPEN", empty: "No dailies yet. Pick the days that matter." },
  todos: { title: "To-dos", type: "todo", singular: "to-do", word: "CLEAR", empty: "No to-dos. Add one, or enjoy the quiet." },
  rewards: { title: "Rewards", type: "reward", singular: "reward", word: "TREAT", empty: "No rewards yet. Name a treat worth the gold." },
};

const ROW = { habits: HabitRow, dailies: DailyRow, todos: TodoRow, rewards: RewardRow } as const;
const TEXT_FIELDS = "input:not([type=checkbox]), select, textarea";

/** The row that should hold focus after the list re-renders moved it out of the document. */
let keepFocus: string | null = null;
document.addEventListener("focusin", (event) => {
  keepFocus = (event.target as HTMLElement).closest<HTMLElement>("[data-task-id]")?.dataset.taskId ?? null;
});
document.addEventListener("focusout", (event) => {
  if (event.relatedTarget) keepFocus = null;
});
window.addEventListener("pointerdown", () => (keepFocus = null), { capture: true });

function visibleLists(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-list]")].filter((list) => list.getClientRects().length > 0);
}

function rowsOf(list: HTMLElement): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>("[data-task-id]")];
}

interface Props {
  name: ListName;
  tasks: Task[];
  tone: "blush" | "ink";
  onAdd: (name: ListName, returnTo?: string) => void;
  onEdit: (task: Task, row: HTMLElement) => void;
}

export function TaskList({ name, tasks, tone, onAdd, onEdit }: Props) {
  const spec = LISTS[name];
  const headingId = useId();
  const [rovingId, setRovingId] = useState<string | null>(null);
  const roving = tasks.some((task) => task.id === rovingId) ? rovingId : tasks[0]?.id;
  const Row = ROW[name];
  const list = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    applyPendingFocus();
    if (keepFocus && (!document.activeElement || document.activeElement === document.body)) document.querySelector<HTMLElement>(rowSelector(keepFocus))?.focus();
  });

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const target = event.target as HTMLElement;
    if (target.closest(TEXT_FIELDS) || event.ctrlKey || event.metaKey) return;
    const key = event.key;
    const row = target.closest<HTMLElement>("[data-task-id]");
    if ((key === "n" || key === "N") && !event.altKey) {
      event.preventDefault();
      onAdd(name, row ? rowSelector(row.dataset.taskId!) : `[data-list="${name}"]`);
      return;
    }
    const task = tasks.find((candidate) => candidate.id === row?.dataset.taskId);
    if (!row || !task) return;
    const index = tasks.indexOf(task);

    if (event.altKey) {
      if (key !== "ArrowUp" && key !== "ArrowDown") return;
      event.preventDefault();
      const position = index + (key === "ArrowUp" ? -1 : 1) + 1;
      if (position >= 1 && position <= tasks.length) void moveTask(task, position);
      return;
    }
    switch (key) {
      case "ArrowUp":
      case "ArrowDown": {
        event.preventDefault();
        rowsOf(list.current!)[index + (key === "ArrowUp" ? -1 : 1)]?.focus();
        return;
      }
      case "ArrowLeft":
      case "ArrowRight": {
        event.preventDefault();
        const lists = visibleLists();
        const neighbour = lists[lists.indexOf(list.current!) + (key === "ArrowLeft" ? -1 : 1)];
        if (!neighbour) return;
        const rows = rowsOf(neighbour);
        (rows[Math.min(index, rows.length - 1)] ?? neighbour).focus();
        return;
      }
      case "Enter":
        event.preventDefault();
        onEdit(task, row);
        return;
      case " ":
        if (target.tagName === "INPUT" || target.tagName === "BUTTON") return;
        event.preventDefault();
        if (task.type === "daily" || task.type === "todo") void (task.done ? uncompleteTask(task) : completeTask(task, row));
        return;
      case "+":
      case "-":
        if (task.type !== "habit") return;
        event.preventDefault();
        void scoreHabit(task, key === "+" ? "up" : "down", row);
        return;
    }
  };

  return (
    <section className={`field field-${tone} field-${name}`}>
      <header className="list-head">
        <h2 id={headingId} className="list-title">{spec.title}</h2>
        <button type="button" className="add" data-add={name} aria-label={`Add ${spec.singular}`} onClick={() => onAdd(name)}>
          <Plus aria-hidden="true" size={22} />
        </button>
      </header>
      <ul
        ref={list}
        className="rows"
        role="list"
        aria-labelledby={headingId}
        data-list={name}
        tabIndex={tasks.length === 0 ? 0 : -1}
        onKeyDown={onKeyDown}
        onFocus={(event) => {
          const id = (event.target as HTMLElement).closest<HTMLElement>("[data-task-id]")?.dataset.taskId;
          if (id) setRovingId(id);
        }}
      >
        {tasks.map((task) => (
          <Row key={task.id} task={task} tabIndex={task.id === roving ? 0 : -1} onEdit={onEdit} />
        ))}
      </ul>
      {tasks.length === 0 && (
        <>
          <p className="empty">{spec.empty}</p>
          <span className="giant" aria-hidden="true">{spec.word}</span>
        </>
      )}
    </section>
  );
}
