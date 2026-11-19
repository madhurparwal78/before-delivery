import type { Board, Day, Session, Task } from "../shared/types.js";

// Board state transforms. Optimistic projections are always overwritten by the days and tasks the
// server confirms (applyWrite); the server stays the authority on every total.

function allTasks(board: Board): Task[] {
  return [...board.backlog, ...board.days.flatMap((d) => d.tasks)];
}

export function findTask(board: Board, id: string): Task | undefined {
  return allTasks(board).find((t) => t.id === id);
}

function withLoad(day: Day, deltaMinutes: number, threshold: number): Day {
  const plannedMinutes = day.plannedMinutes + deltaMinutes;
  return {
    ...day,
    taskMinutes: day.taskMinutes + deltaMinutes,
    plannedMinutes,
    overByMinutes: Math.max(0, plannedMinutes - threshold),
  };
}

/** Where a task shows on this board: a day column, the Backlog, or nowhere (dated outside the view). */
function columnFor(board: Board, task: Task): "backlog" | string | null {
  if (task.dayDate === null) return "backlog";
  if (board.days.some((d) => d.date === task.dayDate)) return task.dayDate;
  return task.dayDate < board.today && task.status === "open" ? "backlog" : null;
}

function without(board: Board, id: string): Board {
  return {
    ...board,
    backlog: board.backlog.filter((t) => t.id !== id),
    days: board.days.map((d) => (d.tasks.some((t) => t.id === id) ? { ...d, tasks: d.tasks.filter((t) => t.id !== id) } : d)),
  };
}

/** Puts a task into its column (replacing any older copy), keeping server positions in order. */
export function upsertTask(board: Board, task: Task): Board {
  const next = without(board, task.id);
  const column = columnFor(next, task);
  const insert = (list: Task[]) => [...list, task].sort((a, b) => a.position - b.position);
  if (column === "backlog") return { ...next, backlog: insert(next.backlog) };
  if (column === null) return next;
  return { ...next, days: next.days.map((d) => (d.date === column ? { ...d, tasks: insert(d.tasks) } : d)) };
}

/** Applies a write's confirmed task and the affected days it returned. */
export function applyWrite(board: Board, task: Task, days: Day[]): Board {
  const next = upsertTask(board, task);
  return { ...next, days: next.days.map((d) => days.find((x) => x.date === d.date) ?? d) };
}

/**
 * Optimistically moves a task to another column (null = Backlog): the card moves at once and the
 * affected days' loads shift by its estimate until the server answers.
 */
export function moveLocal(board: Board, task: Task, dayDate: string | null, session: Session | null = null): Board {
  const estimate = task.estimateMinutes ?? 0;
  const source = task.dayDate;
  const days = board.days.map((d) => {
    if (d.date === source && source !== dayDate) return withLoad(d, -estimate, board.thresholdMinutes);
    if (d.date === dayDate && source !== dayDate) return withLoad(d, estimate, board.thresholdMinutes);
    return d;
  });
  const columnLength = dayDate === null ? board.backlog.length : (board.days.find((d) => d.date === dayDate)?.tasks.length ?? 0);
  const moved: Task = { ...task, dayDate, session, position: source === dayDate ? task.position : columnLength + 1000 };
  return upsertTask({ ...board, days }, moved);
}

export function columnName(board: Board, dayDate: string | null): string {
  if (dayDate === null) return "Backlog";
  return board.days.find((d) => d.date === dayDate)?.label ?? "Backlog";
}
