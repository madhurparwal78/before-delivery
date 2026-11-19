import { query } from './db.js';
import { today } from './config.js';
import { computeSchedule, type Schedule, type StoredBaseline, type StoredItem, type StoredLink } from './domain/schedule.js';
import type { Assignee, Holiday, Item, ItemKind, LinkType, Project, Role } from '../shared/types.js';

export interface ItemRow {
  id: string;
  project_id: string;
  kind: ItemKind;
  name: string;
  group_id: string | null;
  position: number;
  chosen_start: string | null;
  duration: number;
  percent: number;
  version: number;
  last_editor: string;
}

export interface ProjectRow {
  id: string;
  workspace_id: string;
  name: string;
}

export interface ProjectAccess {
  project: ProjectRow;
  role: Role;
  workspaceName: string;
}

export interface ProjectState {
  id: string;
  name: string;
  workspaceId: string;
  holidays: Holiday[];
  /** Items in row order: a group is immediately followed by its own items. */
  items: StoredItem[];
  rows: ItemRow[];
  links: StoredLink[];
  baseline: StoredBaseline | null;
  editorNames: Map<string, string>;
}

export async function projectAccess(userId: string, projectId: string): Promise<ProjectAccess | null> {
  const rows = await query<ProjectRow & { role: Role; workspace_name: string }>(
    `SELECT projects.id, projects.workspace_id, projects.name, members.role,
            workspaces.name AS workspace_name
       FROM projects
       JOIN workspaces ON workspaces.id = projects.workspace_id
       JOIN members ON members.workspace_id = projects.workspace_id AND members.user_id = $1
      WHERE projects.id = $2`,
    [userId, projectId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    project: { id: row.id, workspace_id: row.workspace_id, name: row.name },
    role: row.role,
    workspaceName: row.workspace_name,
  };
}

/** Flatten stored items into row order: top-level units by position, each group followed by its items. */
export function flattenRows(rows: readonly ItemRow[]): ItemRow[] {
  const byPosition = (a: ItemRow, b: ItemRow): number => a.position - b.position || a.id.localeCompare(b.id);
  const top = rows.filter((row) => row.group_id === null).sort(byPosition);
  const children = new Map<string, ItemRow[]>();
  for (const row of rows) {
    if (row.group_id === null) continue;
    const list = children.get(row.group_id);
    if (list) list.push(row);
    else children.set(row.group_id, [row]);
  }
  for (const list of children.values()) list.sort(byPosition);
  const result: ItemRow[] = [];
  for (const unit of top) {
    result.push(unit);
    if (unit.kind === 'group') result.push(...(children.get(unit.id) ?? []));
  }
  return result;
}

export async function loadProjectState(projectId: string): Promise<ProjectState | null> {
  const projects = await query<ProjectRow>(
    'SELECT id, workspace_id, name FROM projects WHERE id = $1',
    [projectId],
  );
  const project = projects[0];
  if (!project) return null;

  const [itemRows, linkRows, holidayRows, assignmentRows, baselineRows, baselineItemRows, editorRows] =
    await Promise.all([
      query<ItemRow>('SELECT * FROM items WHERE project_id = $1', [projectId]),
      query<{ id: string; from_item: string; to_item: string; type: LinkType; lag: number }>(
        'SELECT id, from_item, to_item, type, lag FROM links WHERE project_id = $1',
        [projectId],
      ),
      query<{ date: string; name: string }>(
        'SELECT date, name FROM holidays WHERE project_id = $1 ORDER BY date',
        [projectId],
      ),
      query<{ item_id: string; user_id: string; name: string; hours: number }>(
        `SELECT assignments.item_id, assignments.user_id, users.name, assignments.hours
           FROM assignments
           JOIN users ON users.id = assignments.user_id
           JOIN items ON items.id = assignments.item_id
          WHERE items.project_id = $1
          ORDER BY users.name`,
        [projectId],
      ),
      query<{ name: string; finish: string | null }>(
        'SELECT name, finish FROM baselines WHERE project_id = $1',
        [projectId],
      ),
      query<{ item_id: string; start_date: string; end_date: string }>(
        'SELECT item_id, start_date, end_date FROM baseline_items WHERE project_id = $1',
        [projectId],
      ),
      query<{ id: string; editor_name: string }>(
        `SELECT items.id, users.name AS editor_name
           FROM items JOIN users ON users.id = items.last_editor
          WHERE items.project_id = $1`,
        [projectId],
      ),
    ]);

  const assignees = new Map<string, Assignee[]>();
  for (const row of assignmentRows) {
    const list = assignees.get(row.item_id);
    const entry: Assignee = { userId: row.user_id, name: row.name, hours: Number(row.hours) };
    if (list) list.push(entry);
    else assignees.set(row.item_id, [entry]);
  }

  const ordered = flattenRows(itemRows);
  const items: StoredItem[] = ordered.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    group: row.group_id,
    chosenStart: row.chosen_start,
    duration: row.duration,
    percent: row.percent,
    version: row.version,
    assignees: assignees.get(row.id) ?? [],
  }));

  const baselineRow = baselineRows[0] ?? null;
  const baseline: StoredBaseline | null = baselineRow
    ? {
        name: baselineRow.name,
        finish: baselineRow.finish,
        items: new Map(
          baselineItemRows.map((row) => [row.item_id, { start: row.start_date, end: row.end_date }]),
        ),
      }
    : null;

  return {
    id: project.id,
    name: project.name,
    workspaceId: project.workspace_id,
    holidays: holidayRows.map((row) => ({ date: row.date, name: row.name })),
    items,
    rows: ordered,
    links: linkRows.map((row) => ({
      id: row.id,
      from: row.from_item,
      to: row.to_item,
      type: row.type,
      lag: row.lag,
    })),
    baseline,
    editorNames: new Map(editorRows.map((row) => [row.id, row.editor_name])),
  };
}

export function scheduleOf(state: ProjectState): Schedule {
  return computeSchedule({
    items: state.items,
    links: state.links,
    holidays: state.holidays.map((holiday) => holiday.date),
    today: today(),
    baseline: state.baseline,
  });
}

export function toProject(state: ProjectState, schedule: Schedule): Project {
  return {
    id: state.id,
    name: state.name,
    finish: schedule.finish,
    holidays: state.holidays,
    items: schedule.items.map(stripInternals),
    links: schedule.links,
    baseline: state.baseline
      ? {
          name: state.baseline.name,
          finish: state.baseline.finish,
          finishVariance: schedule.finishVariance,
        }
      : null,
  };
}

function stripInternals(item: Item & { startNumber?: number | null; finishNumber?: number | null }): Item {
  return {
    id: item.id,
    row: item.row,
    name: item.name,
    kind: item.kind,
    group: item.group,
    chosenStart: item.chosenStart,
    start: item.start,
    end: item.end,
    duration: item.duration,
    percent: item.percent,
    critical: item.critical,
    float: item.float,
    late: item.late,
    version: item.version,
    assignees: item.assignees,
    baseline: item.baseline,
  };
}

export interface DateSnapshot {
  map: Map<string, { start: string | null; end: string | null; kind: ItemKind }>;
}

export function snapshotDates(schedule: Schedule): DateSnapshot {
  return {
    map: new Map(
      schedule.items.map((item) => [item.id, { start: item.start, end: item.end, kind: item.kind }]),
    ),
  };
}

/** The items whose shown start or end changed, in row order, excluding groups and `excludeId`. */
export function movedItems(
  before: DateSnapshot,
  schedule: Schedule,
  excludeId: string | null,
): { id: string; start: string | null; end: string | null }[] {
  const result: { id: string; start: string | null; end: string | null }[] = [];
  for (const item of schedule.items) {
    if (item.kind === 'group' || item.id === excludeId) continue;
    const old = before.map.get(item.id);
    if (!old) continue;
    if (old.start !== item.start || old.end !== item.end) {
      result.push({ id: item.id, start: item.start, end: item.end });
    }
  }
  return result;
}
