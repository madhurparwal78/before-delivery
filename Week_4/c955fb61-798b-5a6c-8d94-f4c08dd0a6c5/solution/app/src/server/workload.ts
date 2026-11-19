import { addDays, isIsoDate, weekdayIndex, type IsoDate } from "../shared/calendar";
import type { Workload, WorkloadAssignment } from "../shared/types";
import { pool } from "./db";
import { invalidField } from "./errors";
import { loadProject } from "./model";

export function workloadMonday(value: string | null): IsoDate {
  if (!value || !isIsoDate(value) || weekdayIndex(value) !== 0) throw invalidField("from");
  return value;
}

/** Each owner's and editor's hours per weekday, summed over every project of the workspace on that project's working days. */
export async function computeWorkload(workspaceId: string, from: IsoDate): Promise<Workload> {
  const [people, projectIds] = await Promise.all([
    pool.query(
      `SELECT u.id, u.name, u.capacity FROM members m JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = $1 AND m.role <> 'viewer' ORDER BY u.name`,
      [workspaceId],
    ),
    pool.query("SELECT id FROM projects WHERE workspace_id = $1", [workspaceId]),
  ]);
  const projects = (await Promise.all(projectIds.rows.map((row) => loadProject(pool, row.id)))).sort((a, b) => a.name.localeCompare(b.name));
  const days: IsoDate[] = [];
  for (let offset = 0; days.length < 10; offset++) {
    const day = addDays(from, offset);
    if (weekdayIndex(day) < 5) days.push(day);
  }
  return {
    from,
    days,
    people: people.rows.map((person) => {
      const dayEntries = days.map((date) => {
        const assignments: WorkloadAssignment[] = projects.flatMap((project) =>
          project.items.flatMap((item) => {
            const placed = project.schedule.items[item.id];
            const assignment = item.assignees.find((assignee) => assignee.userId === person.id);
            const covers = placed.start !== null && placed.end !== null && placed.start <= date && date <= placed.end;
            return assignment && covers && project.calendar.isWorking(date) ? [{ project: project.name, item: item.name, hours: assignment.hours }] : [];
          }),
        );
        const hours = assignments.reduce((sum, assignment) => sum + assignment.hours, 0);
        return { date, hours, over: hours > person.capacity, assignments };
      });
      return { userId: person.id, name: person.name, capacity: person.capacity, overDays: dayEntries.filter((day) => day.over).length, days: dayEntries };
    }),
  };
}
