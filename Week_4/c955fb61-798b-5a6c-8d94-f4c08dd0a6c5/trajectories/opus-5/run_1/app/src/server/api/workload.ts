import { query } from '../db.js';
import { loadProjectState, scheduleOf } from '../repo.js';
import { fromIso, toIso, isWeekday, type IsoDate } from '../../shared/dates.js';
import type { WorkloadAssignment, WorkloadPerson, WorkloadResponse } from '../../shared/types.js';

/** The ten weekdays of the two weeks starting on this Monday. */
export function fortnightDays(from: IsoDate): IsoDate[] {
  const start = fromIso(from);
  const days: IsoDate[] = [];
  for (let offset = 0; offset < 14; offset += 1) {
    const day = start + offset;
    if (isWeekday(day)) days.push(toIso(day));
  }
  return days;
}

interface Load {
  hours: number;
  assignments: (WorkloadAssignment & { projectName: string; row: number })[];
}

export async function readWorkload(workspaceId: string, from: IsoDate): Promise<WorkloadResponse> {
  const days = fortnightDays(from);
  const window = new Set(days);

  const people = await query<{ id: string; name: string; capacity: number }>(
    `SELECT users.id, users.name, users.capacity
       FROM members JOIN users ON users.id = members.user_id
      WHERE members.workspace_id = $1 AND members.role IN ('owner', 'editor')
      ORDER BY users.name`,
    [workspaceId],
  );

  const projectIds = await query<{ id: string }>(
    'SELECT id FROM projects WHERE workspace_id = $1',
    [workspaceId],
  );

  const loads = new Map<string, Load>();
  for (const { id } of projectIds) {
    const state = await loadProjectState(id);
    if (!state) continue;
    const schedule = scheduleOf(state);
    for (const item of schedule.items) {
      if (item.kind !== 'task' || item.assignees.length === 0) continue;
      const first = fromIso(item.start!);
      const last = fromIso(item.end!);
      for (let day = first; day <= last; day += 1) {
        const date = toIso(day);
        if (!window.has(date) || !schedule.calendar.isWorkingDay(day)) continue;
        for (const assignee of item.assignees) {
          const key = `${assignee.userId}|${date}`;
          const load = loads.get(key) ?? { hours: 0, assignments: [] };
          load.hours += assignee.hours;
          load.assignments.push({
            project: state.name,
            item: item.name,
            hours: assignee.hours,
            projectName: state.name,
            row: item.row,
          });
          loads.set(key, load);
        }
      }
    }
  }

  const result: WorkloadPerson[] = people.map((person) => {
    const capacity = Number(person.capacity);
    const personDays = days.map((date) => {
      const load = loads.get(`${person.id}|${date}`) ?? { hours: 0, assignments: [] };
      const assignments = [...load.assignments]
        .sort((a, b) => a.projectName.localeCompare(b.projectName) || a.row - b.row)
        .map(({ project, item, hours }) => ({ project, item, hours }));
      return {
        date,
        hours: Math.round(load.hours * 2) / 2,
        over: load.hours > capacity,
        assignments,
      };
    });
    return {
      userId: person.id,
      name: person.name,
      capacity,
      overDays: personDays.filter((day) => day.over).length,
      days: personDays,
    };
  });

  return { from, days, people: result };
}
