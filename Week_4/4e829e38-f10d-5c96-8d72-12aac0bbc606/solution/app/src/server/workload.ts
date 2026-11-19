/** The workload spread: how a task's effort lands on each person's working days. */
import { addDays, daysBetween, isWorkingDay, mondayOf, weekdayOf } from "./dates.js";

export interface WorkloadTask {
  id: string;
  name: string;
  assigneeId: string | null;
  start: string | null;
  due: string | null;
  effort: number | null;
  completed: boolean;
}

export const DEFAULT_CAPACITY = 8;

function workingDays(task: WorkloadTask): string[] {
  if (task.completed || !task.assigneeId || task.effort === null || !task.due) return [];
  const first = task.start ?? task.due;
  if (first > task.due) return [];
  const span = daysBetween(first, task.due);
  return Array.from({ length: span + 1 }, (_, i) => addDays(first, i)).filter(isWorkingDay);
}

export function gridDays(from: string): string[] {
  const monday = mondayOf(from);
  return Array.from({ length: 14 }, (_, i) => addDays(monday, i)).filter(isWorkingDay);
}

function shownHours(value: number): string {
  return String(Math.floor(value * 10 + 0.5 + 1e-9) / 10);
}

interface Cell {
  date: string;
  total: number;
  capacity: number;
  over: boolean;
  text: string;
  tasks: Array<{ id: string; name: string }>;
}

export function buildCells(
  days: string[],
  personId: string,
  tasks: WorkloadTask[],
  capacityOf: (personId: string, weekday: string) => number,
): Cell[] {
  const mine = tasks.filter((t) => t.assigneeId === personId).map((task) => ({ task, spread: workingDays(task) }));
  return days.map((date) => {
    const here = mine.filter((entry) => entry.spread.includes(date));
    const total = here.reduce((sum, { task, spread }) => sum + (task.effort as number) / spread.length, 0);
    const capacity = capacityOf(personId, weekdayOf(date));
    const over = total > capacity;
    return {
      date,
      total,
      capacity,
      over,
      text: `${shownHours(total)} of ${shownHours(capacity)} h${over ? ", over capacity" : ""}`,
      tasks: here.map(({ task }) => ({ id: task.id, name: task.name })),
    };
  });
}
