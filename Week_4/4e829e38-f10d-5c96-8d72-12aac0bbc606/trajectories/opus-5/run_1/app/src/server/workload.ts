import { query } from './db.js';
import { addDays, isWorkingDay, mondayOf, weekdayKey } from './clock.js';
import { roundHalfAway } from './formula.js';

export interface WorkloadCell {
  date: string;
  total: number;
  capacity: number;
  over: boolean;
  text: string;
  tasks: { id: string; name: string }[];
}

export interface WorkloadPerson {
  id: string;
  name: string;
  cells: WorkloadCell[];
}

export function tenWorkingDays(from: string): string[] {
  const days: string[] = [];
  let cursor = mondayOf(from);
  while (days.length < 10) {
    if (isWorkingDay(cursor)) days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

function formatHours(value: number): string {
  const rounded = roundHalfAway(value, 1);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * The one place a task's effort is spread: evenly over its working days from
 * start to due inclusive, or on its due date alone when it has no start.
 */
export function workingDaysOf(start: string | null, due: string | null): string[] {
  if (!due) return [];
  if (!start) return isWorkingDay(due) ? [due] : [];
  if (start > due) return isWorkingDay(due) ? [due] : [];
  const days: string[] = [];
  let cursor = start;
  while (cursor <= due) {
    if (isWorkingDay(cursor)) days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

export async function teamWorkload(
  teamId: string,
  from: string,
): Promise<{ from: string; days: string[]; people: WorkloadPerson[] }> {
  const days = tenWorkingDays(from);
  const people = await query<{ id: string; name: string }>(
    `SELECT p.id, p.name FROM people p JOIN memberships m ON m.person_id = p.id
     WHERE m.team_id = $1 ORDER BY p.name`,
    [teamId],
  );
  const capacities = await query<{ person_id: string; weekday: string; hours: string }>(
    `SELECT person_id, weekday, hours FROM capacities WHERE team_id = $1`,
    [teamId],
  );
  const capacityOf = (personId: string, date: string): number => {
    const key = weekdayKey(date);
    const row = capacities.find((c) => c.person_id === personId && c.weekday === key);
    return row ? Number(row.hours) : 8;
  };
  const tasks = await query<{
    id: string;
    name: string;
    assignee_id: string;
    start_date: string | null;
    due_date: string | null;
    effort: string | null;
  }>(
    `SELECT t.id, t.name, t.assignee_id, t.start_date, t.due_date, t.effort
     FROM tasks t JOIN projects pr ON pr.id = t.project_id
     WHERE pr.team_id = $1 AND t.completed = false AND t.assignee_id IS NOT NULL
       AND t.effort IS NOT NULL AND t.due_date IS NOT NULL`,
    [teamId],
  );

  const totals = new Map<string, number>();
  const taskLists = new Map<string, { id: string; name: string }[]>();
  for (const task of tasks) {
    const start = task.start_date ? String(task.start_date).slice(0, 10) : null;
    const due = String(task.due_date).slice(0, 10);
    const working = workingDaysOf(start, due);
    if (working.length === 0) continue;
    const share = Number(task.effort) / working.length;
    for (const day of working) {
      const key = `${task.assignee_id}|${day}`;
      totals.set(key, (totals.get(key) ?? 0) + share);
      const list = taskLists.get(key) ?? [];
      list.push({ id: task.id, name: task.name });
      taskLists.set(key, list);
    }
  }

  return {
    from: days[0],
    days,
    people: people.map((person) => ({
      id: person.id,
      name: person.name,
      cells: days.map((date) => {
        const key = `${person.id}|${date}`;
        const total = totals.get(key) ?? 0;
        const capacity = capacityOf(person.id, date);
        const over = total > capacity;
        return {
          date,
          total: Number(total.toFixed(2)),
          capacity,
          over,
          text: `${formatHours(total)} of ${formatHours(capacity)} h${over ? ', over capacity' : ''}`,
          tasks: taskLists.get(key) ?? [],
        };
      }),
    })),
  };
}
