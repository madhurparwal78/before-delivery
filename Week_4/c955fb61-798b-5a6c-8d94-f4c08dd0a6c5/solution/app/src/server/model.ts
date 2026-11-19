import { WorkCalendar, type IsoDate } from "../shared/calendar";
import type { Assignee, Holiday, Item, ItemKind, LinkType, Project } from "../shared/types";
import { planToday } from "./config";
import type { Db } from "./db";
import { ApiError } from "./errors";
import { computeSchedule, varianceInWorkingDays, type Schedule, type WorkItem } from "./schedule";

export interface ItemRow {
  id: string;
  row: number;
  name: string;
  kind: ItemKind;
  group: string | null;
  chosenStart: IsoDate | null;
  duration: number;
  percent: number;
  version: number;
  updatedBy: string;
  updatedByName: string;
  baselineStart: IsoDate | null;
  baselineEnd: IsoDate | null;
  assignees: Assignee[];
}

export interface LinkRow {
  id: string;
  from: string;
  to: string;
  type: LinkType;
  lag: number;
}

export interface LoadedProject {
  id: string;
  workspaceId: string;
  name: string;
  rev: number;
  baselineName: string | null;
  baselineFinish: IsoDate | null;
  holidays: Holiday[];
  items: ItemRow[];
  byId: Record<string, ItemRow>;
  links: LinkRow[];
  calendar: WorkCalendar;
  schedule: Schedule;
}

export async function loadProject(db: Db, projectId: string, lock = false): Promise<LoadedProject> {
  const found = await db.query(
    `SELECT id, workspace_id, name, rev, baseline_name, baseline_finish FROM projects WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [projectId],
  );
  if (found.rowCount === 0) throw new ApiError(404, "not_found");
  // One after another: a transaction's client runs a single query at a time.
  const holidays = await db.query("SELECT on_date, name FROM holidays WHERE project_id = $1 ORDER BY on_date", [projectId]);
  const items = await db.query(
      `SELECT i.id, i.position, i.name, i.kind, i.group_id, i.chosen_start, i.duration, i.percent, i.version, i.updated_by,
              u.name AS updated_by_name, i.baseline_start, i.baseline_end
         FROM items i JOIN users u ON u.id = i.updated_by WHERE i.project_id = $1 ORDER BY i.position`,
      [projectId],
  );
  const links = await db.query("SELECT id, from_id, to_id, type, lag FROM links WHERE project_id = $1 ORDER BY id", [projectId]);
  const assignments = await db.query(
      `SELECT a.item_id, a.user_id, u.name, a.hours FROM assignments a
         JOIN users u ON u.id = a.user_id JOIN items i ON i.id = a.item_id WHERE i.project_id = $1 ORDER BY u.name`,
      [projectId],
  );
  const project = found.rows[0];
  const holidayList: Holiday[] = holidays.rows.map((row) => ({ date: row.on_date, name: row.name }));
  const itemRows: ItemRow[] = items.rows.map((row, index) => ({
    id: row.id,
    row: index + 1,
    name: row.name,
    kind: row.kind,
    group: row.group_id,
    chosenStart: row.chosen_start,
    duration: row.duration,
    percent: row.percent,
    version: row.version,
    updatedBy: row.updated_by,
    updatedByName: row.updated_by_name,
    baselineStart: row.baseline_start,
    baselineEnd: row.baseline_end,
    assignees: assignments.rows.filter((entry) => entry.item_id === row.id).map((entry) => ({ userId: entry.user_id, name: entry.name, hours: entry.hours })),
  }));
  const linkRows: LinkRow[] = links.rows.map((row) => ({ id: row.id, from: row.from_id, to: row.to_id, type: row.type, lag: row.lag }));
  const calendar = new WorkCalendar(holidayList.map((holiday) => holiday.date));
  return {
    id: project.id,
    workspaceId: project.workspace_id,
    name: project.name,
    rev: project.rev,
    baselineName: project.baseline_name,
    baselineFinish: project.baseline_finish,
    holidays: holidayList,
    items: itemRows,
    byId: Object.fromEntries(itemRows.map((row) => [row.id, row])),
    links: linkRows,
    calendar,
    schedule: scheduleOf(calendar, itemRows, linkRows),
  };
}

function scheduleOf(calendar: WorkCalendar, items: readonly ItemRow[], links: readonly LinkRow[]): Schedule {
  const work: WorkItem[] = items.flatMap((item) =>
    item.kind === "group" || item.chosenStart === null
      ? []
      : [{ id: item.id, kind: item.kind, group: item.group, chosenStart: item.chosenStart, duration: item.duration, percent: item.percent }],
  );
  return computeSchedule(calendar, work, items.filter((item) => item.kind === "group").map((item) => item.id), links, planToday());
}

export function buildProject(loaded: LoadedProject): Project {
  const { schedule, calendar } = loaded;
  const items: Item[] = loaded.items.map((row) => {
    const placed = schedule.items[row.id];
    const isGroup = row.kind === "group";
    const baseline =
      !isGroup && row.baselineStart && row.baselineEnd && placed.end
        ? { start: row.baselineStart, end: row.baselineEnd, variance: varianceInWorkingDays(calendar, row.baselineEnd, placed.end) }
        : null;
    return {
      id: row.id,
      row: row.row,
      name: row.name,
      kind: row.kind,
      group: row.group,
      chosenStart: row.chosenStart,
      start: placed.start,
      end: placed.end,
      duration: placed.duration,
      percent: placed.percent,
      critical: placed.critical,
      float: placed.float,
      late: placed.late,
      version: row.version,
      assignees: row.assignees,
      baseline,
    };
  });
  const baseline =
    loaded.baselineName !== null && loaded.baselineFinish !== null && schedule.finish
      ? { name: loaded.baselineName, finish: loaded.baselineFinish, finishVariance: varianceInWorkingDays(calendar, loaded.baselineFinish, schedule.finish) }
      : null;
  return {
    id: loaded.id,
    name: loaded.name,
    finish: schedule.finish,
    holidays: loaded.holidays,
    items,
    links: loaded.links.map((link) => ({ ...link, critical: schedule.criticalLinks.has(link.id) })),
    baseline,
  };
}
