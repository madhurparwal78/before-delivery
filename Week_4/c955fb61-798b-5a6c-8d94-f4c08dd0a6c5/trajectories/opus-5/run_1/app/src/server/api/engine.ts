import { query } from '../db.js';
import {
  flattenRows,
  loadProjectState,
  movedItems,
  scheduleOf,
  snapshotDates,
  toProject,
  type DateSnapshot,
  type ItemRow,
  type ProjectState,
} from '../repo.js';
import { broadcastToProject, broadcastToWorkspace } from '../live.js';
import type { Schedule } from '../domain/schedule.js';
import type { LiveVerb, MovedItem, Project } from '../../shared/types.js';

export interface Actor {
  id: string;
  name: string;
}

const locks = new Map<string, Promise<void>>();

/** Edits to one project are applied one at a time, in the order the server receives them. */
export function withProjectLock<T>(projectId: string, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(projectId) ?? Promise.resolve();
  const next = previous.then(run, run);
  locks.set(
    projectId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

export interface EditStart {
  state: ProjectState;
  schedule: Schedule;
  before: DateSnapshot;
}

export async function beginEdit(projectId: string): Promise<EditStart> {
  const state = (await loadProjectState(projectId))!;
  const schedule = scheduleOf(state);
  return { state, schedule, before: snapshotDates(schedule) };
}

export interface EditEnd {
  state: ProjectState;
  schedule: Schedule;
  project: Project;
  moved: MovedItem[];
  finish: string | null;
}

export interface EditEvent {
  actor: Actor;
  verb: LiveVerb;
  /** The item the knock-on radiates from; null for holiday changes. */
  editedItemId: string | null;
  /** The item named in the `Project updates` sentence. */
  itemId: string | null;
  itemName: string | null;
  /** Always listed in `moved`, whether or not it changed. */
  alsoMoved?: string | null;
}

export async function completeEdit(
  projectId: string,
  before: DateSnapshot,
  event: EditEvent,
): Promise<EditEnd> {
  const state = (await loadProjectState(projectId))!;
  const schedule = scheduleOf(state);
  const project = toProject(state, schedule);
  const moved = movedItems(before, schedule, event.editedItemId);
  if (event.alsoMoved && !moved.some((entry) => entry.id === event.alsoMoved)) {
    const successor = schedule.byId.get(event.alsoMoved);
    if (successor) {
      moved.push({ id: successor.id, start: successor.start, end: successor.end });
      moved.sort((a, b) => schedule.byId.get(a.id)!.row - schedule.byId.get(b.id)!.row);
    }
  }

  broadcastToProject(projectId, {
    type: 'project',
    project,
    edit: {
      editedItemId: event.editedItemId,
      movedItemIds: moved.map((entry) => entry.id),
      actorId: event.actor.id,
      actorName: event.actor.name,
      verb: event.verb,
      itemId: event.itemId,
      itemName: event.itemName,
    },
  });
  broadcastToWorkspace(state.workspaceId, { type: 'workspace' });

  return { state, schedule, project, moved, finish: schedule.finish };
}

export async function setPositions(entries: readonly { id: string; position: number }[]): Promise<void> {
  if (entries.length === 0) return;
  await query(
    `UPDATE items SET position = data.position
       FROM (SELECT unnest($1::text[]) AS id, unnest($2::int[]) AS position) AS data
      WHERE items.id = data.id`,
    [entries.map((entry) => entry.id), entries.map((entry) => entry.position)],
  );
}

export function topLevelUnits(rows: readonly ItemRow[]): ItemRow[] {
  return rows.filter((row) => row.group_id === null).sort((a, b) => a.position - b.position);
}

export function childrenOfGroup(rows: readonly ItemRow[], groupId: string): ItemRow[] {
  return rows.filter((row) => row.group_id === groupId).sort((a, b) => a.position - b.position);
}

/** Write a new top-level order as positions 0..n-1. */
export async function writeTopOrder(ids: readonly string[]): Promise<void> {
  await setPositions(ids.map((id, index) => ({ id, position: index })));
}

export async function bumpVersion(itemId: string, actor: Actor): Promise<void> {
  await query('UPDATE items SET version = version + 1, last_editor = $2 WHERE id = $1', [
    itemId,
    actor.id,
  ]);
}

export function rowsAnswer(state: ProjectState): { id: string; row: number; group: string | null }[] {
  return flattenRows(state.rows).map((row, index) => ({
    id: row.id,
    row: index + 1,
    group: row.group_id,
  }));
}
