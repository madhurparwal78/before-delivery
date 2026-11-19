import type { BoardDto, CalendarDto, DayDto, TaskDto } from '../../shared/types.js';
import { api } from '../api.js';
import { state } from '../app.js';
import { addDays } from '../../shared/time.js';

export type DropTarget =
  | { kind: 'backlog' }
  | { kind: 'day'; date: string }
  | { kind: 'slot'; date: string; startTime: string };

export const SLOT_TIMES: string[] = (() => {
  const slots: string[] = [];
  for (let minutes = 7 * 60; minutes < 20 * 60; minutes += 30) {
    slots.push(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${minutes % 60 === 0 ? '00' : '30'}`);
  }
  return slots;
})();

export function boardDays(): DayDto[] {
  return state.board?.days ?? [];
}

export function threshold(): number {
  return state.board?.thresholdMinutes ?? 360;
}

export function allTasks(): TaskDto[] {
  const board = state.board;
  if (!board) return [];
  return [...board.backlog, ...board.days.flatMap((day) => day.tasks)];
}

export function findTask(taskId: string): TaskDto | null {
  return allTasks().find((task) => task.id === taskId) ?? null;
}

export function dayOf(date: string): DayDto | null {
  return boardDays().find((day) => day.date === date) ?? null;
}

export function columnLabel(target: DropTarget): string {
  if (target.kind === 'backlog') return 'Backlog';
  const day = dayOf(target.date);
  return day ? day.label : target.date;
}

/** Projected minutes for a day if the held card landed there. */
export function projectedMinutes(date: string, task: TaskDto): number {
  const day = dayOf(date);
  if (!day) return 0;
  if (task.dayDate === date) return day.plannedMinutes;
  return day.plannedMinutes + (task.estimateMinutes ?? 0);
}

function removeTaskFromBoard(board: BoardDto, taskId: string): TaskDto | null {
  const backlogIndex = board.backlog.findIndex((task) => task.id === taskId);
  if (backlogIndex >= 0) {
    const [task] = board.backlog.splice(backlogIndex, 1);
    return task ?? null;
  }
  for (const day of board.days) {
    const index = day.tasks.findIndex((task) => task.id === taskId);
    if (index < 0) continue;
    const [task] = day.tasks.splice(index, 1);
    if (task) {
      day.taskMinutes -= task.estimateMinutes ?? 0;
      day.plannedMinutes -= task.estimateMinutes ?? 0;
      day.overByMinutes = Math.max(0, day.plannedMinutes - board.thresholdMinutes);
    }
    return task ?? null;
  }
  return null;
}

/** Moves a card between columns in the local board so the drop shows at once. */
export function applyOptimisticMove(taskId: string, target: DropTarget): void {
  const board = state.board;
  if (!board) return;
  const task = removeTaskFromBoard(board, taskId);
  if (!task) return;
  if (target.kind === 'backlog') {
    task.dayDate = null;
    task.session = null;
    board.backlog.unshift(task);
    return;
  }
  const day = board.days.find((candidate) => candidate.date === target.date);
  task.dayDate = target.date;
  if (target.kind === 'day') task.session = null;
  if (!day) return;
  day.tasks.push(task);
  day.taskMinutes += task.estimateMinutes ?? 0;
  day.plannedMinutes += task.estimateMinutes ?? 0;
  day.overByMinutes = Math.max(0, day.plannedMinutes - board.thresholdMinutes);
}

export function applyServerDays(days: DayDto[], task?: TaskDto): void {
  const board = state.board;
  if (!board) return;
  for (const fresh of days) {
    const index = board.days.findIndex((day) => day.date === fresh.date);
    if (index >= 0) board.days[index] = fresh;
  }
  if (!task) return;
  const onDay = board.days.some((day) => day.tasks.some((candidate) => candidate.id === task.id));
  const backlogIndex = board.backlog.findIndex((candidate) => candidate.id === task.id);
  if (onDay) {
    if (backlogIndex >= 0) board.backlog.splice(backlogIndex, 1);
    return;
  }
  if (backlogIndex >= 0) board.backlog[backlogIndex] = task;
  else board.backlog.unshift(task);
}

export async function refreshBoard(): Promise<void> {
  const board = await api.board();
  state.board = board;
  if (!state.stripDate || !board.days.some((day) => day.date === state.stripDate)) {
    state.stripDate = board.days[0]?.date ?? board.today;
  }
  const first = board.days[0]?.date ?? board.today;
  state.calendar = await api.calendar(first, addDays(first, 4));
}

export function calendarItems(date: string): CalendarDto['items'] {
  return (state.calendar?.items ?? []).filter((item) => item.date === date);
}
