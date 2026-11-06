import { now } from './clock.js';
import { db, type Queryable } from './db.js';
import type { Holiday } from '../shared/types.js';
import { todayOf, type CalendarHistory, type CalendarVersion } from './domain/calendar.js';

type CalendarRow = {
  id: number;
  effective_date: string;
  time_zone: string;
  working_weekdays: number[];
  holidays: Holiday[];
  cycle_anchor: string;
};

/** Every calendar save of a workspace, oldest first. */
export async function loadHistory(workspaceId: string, client: Queryable = db): Promise<CalendarHistory> {
  const rows = await client.query<CalendarRow>(
    `select id, effective_date, time_zone, working_weekdays, holidays, cycle_anchor
       from calendars where workspace_id = $1 order by effective_date asc, id asc`,
    [workspaceId],
  );
  const versions: CalendarVersion[] = rows.map((row) => ({
    id: Number(row.id),
    effectiveDate: row.effective_date,
    timeZone: row.time_zone,
    workingWeekdays: row.working_weekdays,
    holidays: row.holidays,
    cycleAnchor: row.cycle_anchor,
  }));
  if (versions.length === 0) throw new Error(`Workspace ${workspaceId} has no calendar`);
  return { workspaceId, versions };
}

/** The zone every instant of a workspace is printed in. */
export async function zoneOf(workspaceId: string, client: Queryable = db): Promise<string> {
  const row = await client.one<{ time_zone: string }>(
    'select time_zone from calendars where workspace_id = $1 order by effective_date desc, id desc limit 1',
    [workspaceId],
  );
  if (row === undefined) throw new Error(`Workspace ${workspaceId} has no calendar`);
  return row.time_zone;
}

export function workspaceToday(history: CalendarHistory): string {
  return todayOf(history, now());
}
