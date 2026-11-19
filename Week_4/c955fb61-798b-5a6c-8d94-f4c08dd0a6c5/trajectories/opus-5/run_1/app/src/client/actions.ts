import { ApiCallError, api } from './api.js';
import { bus } from './bus.js';
import { canEdit, itemById, state } from './state.js';
import {
  addedSentence,
  assignedSentence,
  baselineSentence,
  constraintSentence,
  deleteSentence,
  holidaySentence,
  linkSentence,
  minimumDurationSentence,
  movedToRowSentence,
  moveSentence,
  noLongerInGroupSentence,
  nowInGroupSentence,
  percentSentence,
  predecessorsSentence,
  resizeSentence,
  savedSentence,
  unassignedSentence,
} from './sentences.js';
import { ALERTS, alreadyAssignedMessage, conflictMessage } from '../shared/copy.js';
import { formatHours } from '../shared/hours.js';
import { Calendar } from '../shared/calendar.js';
import { fromIso, toIso } from '../shared/dates.js';
import type { ExportFormat, Item, ItemKind, Link, LinkType, MovedItem } from '../shared/types.js';

export class ActionFailure extends Error {
  constructor(
    readonly text: string,
    readonly field: string | null = null,
    readonly conflictItem: Item | null = null,
    readonly code: string = '',
  ) {
    super(text);
  }
}

interface ItemAnswer {
  item: Item;
  moved: MovedItem[];
  finish: string | null;
  constraint?: { predecessor: string } | null;
}

export function calendar(): Calendar {
  return new Calendar((state.project?.holidays ?? []).map((holiday) => holiday.date));
}

/** The one place the browser previews a snapped date: the drag tip and the in-flight bar. */
export function shiftWorkingDays(iso: string, steps: number): string {
  const cal = calendar();
  let day = fromIso(iso);
  for (let step = 0; step < Math.abs(steps); step += 1) {
    day = steps > 0 ? cal.nextWorkingDay(day + 1) : cal.prevWorkingDay(day - 1);
  }
  return toIso(day);
}

export function endForDuration(start: string, duration: number): string {
  const cal = calendar();
  return cal.isoAt(cal.indexOfIso(start) + Math.max(1, duration) - 1);
}

function failureText(error: unknown, item: Item | null): ActionFailure {
  if (!(error instanceof ApiCallError)) return new ActionFailure(ALERTS.saveFailed);
  const { status, body } = error.failure;
  const code = String(body.error ?? '');
  if (code === 'read_only') return new ActionFailure(ALERTS.readOnly);
  if (code === 'version_conflict') {
    const current = body.item as Item;
    serverVersions.set(current.id, current.version);
    if (state.project) {
      state.project = {
        ...state.project,
        items: state.project.items.map((entry) => (entry.id === current.id ? current : entry)),
      };
    }
    return new ActionFailure(conflictMessage(String(body.by), current.name), null, current);
  }
  if (code === 'has_assignees') return new ActionFailure(ALERTS.hasAssignees);
  if (code === 'invalid_predecessors') return new ActionFailure(String(body.message));
  if (code === 'loop') return new ActionFailure(String(body.message));
  if (code === 'self_link') return new ActionFailure(ALERTS.selfLink);
  if (code === 'group_link') return new ActionFailure(ALERTS.groupLink);
  if (code === 'duplicate_link') return new ActionFailure(ALERTS.duplicateLink);
  if (code === 'invalid_link') return new ActionFailure(ALERTS.lagRange, String(body.field));
  if (code === 'already_assigned') return new ActionFailure('', null, null, code);
  if (code === 'not_a_task') return new ActionFailure(ALERTS.saveFailed);
  if (code === 'weekend') return new ActionFailure(ALERTS.holidayWeekend);
  if (code === 'duplicate_holiday') return new ActionFailure(ALERTS.holidayDuplicate);
  if (code === 'storage_unavailable') return new ActionFailure(ALERTS.storageOutage);
  if (code === 'invalid_field') {
    const field = String(body.field);
    if (field === 'name') return new ActionFailure(ALERTS.itemName, field);
    if (field === 'start') return new ActionFailure(ALERTS.itemStart, field);
    if (field === 'duration') return new ActionFailure(ALERTS.itemDuration, field);
    if (field === 'percent') {
      const milestone = item?.kind === 'milestone';
      return new ActionFailure(milestone ? ALERTS.milestonePercent : ALERTS.itemPercent, field);
    }
    if (field === 'hours') return new ActionFailure(ALERTS.assignHours, field);
    if (field === 'text') return new ActionFailure(ALERTS.commentLength, field);
    if (field === 'date') return new ActionFailure(ALERTS.holidayDate, field);
    return new ActionFailure(ALERTS.saveFailed, field);
  }
  if (status >= 500) return new ActionFailure(ALERTS.saveFailed);
  return new ActionFailure(ALERTS.saveFailed);
}

/** Edits to one item are sent one at a time, so each is based on the version the last one left. */
const chains = new Map<string, Promise<unknown>>();
const inFlight = new Map<string, number>();
const serverVersions = new Map<string, number>();

function enter(itemId: string): void {
  inFlight.set(itemId, (inFlight.get(itemId) ?? 0) + 1);
  state.busy.add(itemId);
}

function leave(itemId: string): void {
  const left = (inFlight.get(itemId) ?? 1) - 1;
  if (left > 0) {
    inFlight.set(itemId, left);
    return;
  }
  inFlight.delete(itemId);
  state.busy.delete(itemId);
  state.preview.delete(itemId);
}

/** The newest version this browser has been told about. */
export function baseVersion(item: Item): number {
  return Math.max(itemById(item.id)?.version ?? 0, serverVersions.get(item.id) ?? 0, item.version);
}

function remember(item: Item): void {
  serverVersions.set(item.id, item.version);
}

async function run<T>(itemId: string | null, work: () => Promise<T>, item: Item | null = null): Promise<T> {
  if (!itemId) {
    try {
      return await work();
    } catch (error) {
      throw failureText(error, item);
    }
  }
  enter(itemId);
  bus.update();
  const previous = chains.get(itemId) ?? Promise.resolve();
  const task = previous.then(work, work);
  chains.set(
    itemId,
    task.then(
      () => undefined,
      () => undefined,
    ),
  );
  try {
    const answer = await task;
    const returned = (answer as { item?: Item }).item;
    if (returned) remember(returned);
    return answer;
  } catch (error) {
    throw failureText(error, item);
  } finally {
    leave(itemId);
    bus.update();
  }
}

export function refuseViewer(): boolean {
  if (canEdit()) return false;
  bus.announceSchedule(ALERTS.readOnly);
  return true;
}

/* -------------------------------------------------------------- item edits */

export async function moveItem(item: Item, start: string): Promise<void> {
  const answer = await run<ItemAnswer>(
    item.id,
    () => api.patch(`/api/items/${item.id}`, { baseVersion: baseVersion(item), start }),
    item,
  );
  if (answer.constraint) {
    bus.announceSchedule(
      constraintSentence(answer.item.name, answer.item.start!, answer.constraint.predecessor),
    );
  } else {
    bus.announceSchedule(moveSentence(answer.item, answer.moved.length, answer.finish));
  }
}

export async function resizeItem(item: Item, duration: number): Promise<void> {
  if (duration < 1) {
    bus.announceSchedule(minimumDurationSentence(item.name));
    return;
  }
  const answer = await run<ItemAnswer>(
    item.id,
    () => api.patch(`/api/items/${item.id}`, { baseVersion: baseVersion(item), duration }),
    item,
  );
  bus.announceSchedule(resizeSentence(answer.item, answer.moved.length, answer.finish));
}

/** The start handle keeps the end, so it saves a new chosen start and a new duration together. */
export async function resizeFromStart(item: Item, start: string, duration: number): Promise<void> {
  const answer = await run<ItemAnswer>(
    item.id,
    () => api.patch(`/api/items/${item.id}`, { baseVersion: baseVersion(item), start, duration }),
    item,
  );
  bus.announceSchedule(resizeSentence(answer.item, answer.moved.length, answer.finish));
}

export async function setPercent(item: Item, percent: number): Promise<void> {
  const answer = await run<ItemAnswer>(
    item.id,
    () => api.patch(`/api/items/${item.id}`, { baseVersion: baseVersion(item), percent }),
    item,
  );
  bus.announceSchedule(percentSentence(answer.item));
}

export async function renameItem(item: Item, name: string): Promise<void> {
  const answer = await run<ItemAnswer>(
    item.id,
    () => api.patch(`/api/items/${item.id}`, { baseVersion: baseVersion(item), name }),
    item,
  );
  bus.announceSchedule(savedSentence(answer.item.name));
}

export async function setDuration(item: Item, duration: number): Promise<void> {
  const answer = await run<ItemAnswer>(
    item.id,
    () => api.patch(`/api/items/${item.id}`, { baseVersion: baseVersion(item), duration }),
    item,
  );
  if (answer.item.kind === 'milestone') {
    bus.announceSchedule(moveSentence(answer.item, answer.moved.length, answer.finish));
  } else {
    bus.announceSchedule(resizeSentence(answer.item, answer.moved.length, answer.finish));
  }
}

export interface TaskFields {
  name: string;
  start: string;
  duration: number;
  percent: number;
}

export async function saveTaskFields(item: Item, fields: TaskFields): Promise<Item> {
  const body: Record<string, unknown> =
    item.kind === 'group'
      ? { baseVersion: item.version, name: fields.name }
      : {
          baseVersion: item.version,
          name: fields.name,
          start: fields.start,
          duration: fields.duration,
          percent: fields.percent,
        };
  const answer = await run<ItemAnswer>(item.id, () => api.patch(`/api/items/${item.id}`, body), item);
  const saved = answer.item;
  if (item.kind !== 'group' && fields.duration !== item.duration) {
    bus.announceSchedule(resizeSentence(saved, answer.moved.length, answer.finish));
  } else if (answer.constraint) {
    bus.announceSchedule(constraintSentence(saved.name, saved.start!, answer.constraint.predecessor));
  } else if (saved.start !== item.start || saved.end !== item.end) {
    bus.announceSchedule(moveSentence(saved, answer.moved.length, answer.finish));
  } else if (saved.percent !== item.percent) {
    bus.announceSchedule(percentSentence(saved));
  } else {
    bus.announceSchedule(savedSentence(saved.name));
  }
  return saved;
}

export async function addItem(name: string, kind: ItemKind): Promise<Item> {
  const answer = await run<ItemAnswer>(null, () =>
    api.post(`/api/projects/${state.project!.id}/items`, { name, kind }),
  );
  bus.announceSchedule(addedSentence(answer.item.name, answer.item.row));
  return answer.item;
}


export async function deleteItem(item: Item): Promise<void> {
  const wasOnlyItem = state.project?.items.length === 1;
  const answer = await run<{ moved: MovedItem[]; finish: string | null }>(item.id, () =>
    api.del(`/api/items/${item.id}`),
  );
  bus.announceSchedule(deleteSentence(item.name, answer.moved.length, answer.finish, wasOnlyItem));
}

export async function reorderItem(item: Item, direction: 'up' | 'down'): Promise<boolean> {
  const answer = await run<{ changed: boolean; rows: { id: string; row: number }[] }>(item.id, () =>
    api.post(`/api/items/${item.id}/reorder`, { direction }),
  );
  if (!answer.changed) return false;
  const row = answer.rows.find((entry) => entry.id === item.id)!.row;
  bus.announceSchedule(movedToRowSentence(item.name, row));
  return true;
}

export async function setItemGroup(item: Item, groupId: string | null): Promise<Item> {
  const groupName = groupId ? (itemById(groupId)?.name ?? '') : '';
  const answer = await run<ItemAnswer>(
    item.id,
    () => api.patch(`/api/items/${item.id}`, { baseVersion: baseVersion(item), group: groupId }),
    item,
  );
  bus.announceSchedule(
    groupId ? nowInGroupSentence(answer.item.name, groupName) : noLongerInGroupSentence(answer.item.name),
  );
  return answer.item;
}

export async function savePredecessors(item: Item, text: string, canonical: string): Promise<void> {
  const answer = await run<ItemAnswer>(
    item.id,
    () => api.put(`/api/items/${item.id}/predecessors`, { baseVersion: baseVersion(item), text }),
    item,
  );
  bus.announceSchedule(predecessorsSentence(item.name, canonical, answer.moved.length, answer.finish));
}

/* ------------------------------------------------------------------ links */

export async function createLink(
  from: Item,
  to: Item,
  type: LinkType,
  lag: number,
): Promise<void> {
  const answer = await run<{ link: Link; moved: MovedItem[]; finish: string | null }>(null, () =>
    api.post(`/api/projects/${state.project!.id}/links`, { from: from.id, to: to.id, type, lag }),
  );
  // The successor is always listed in `moved`, so it only counts when its dates really changed.
  const movedCount = answer.moved.filter(
    (entry) => entry.id !== to.id || entry.start !== to.start || entry.end !== to.end,
  ).length;
  bus.announceSchedule(linkSentence(from.name, to.name, type, lag, movedCount, answer.finish));
}

/* --------------------------------------------------------------- holidays */

export async function addHoliday(date: string, name: string): Promise<void> {
  const answer = await run<{ moved: MovedItem[]; finish: string | null }>(null, () =>
    api.post(`/api/projects/${state.project!.id}/holidays`, { date, name }),
  );
  bus.announceSchedule(holidaySentence(name, true, answer.moved.length, answer.finish));
}

export async function removeHoliday(date: string, name: string): Promise<void> {
  const answer = await run<{ moved: MovedItem[]; finish: string | null }>(null, () =>
    api.del(`/api/projects/${state.project!.id}/holidays/${date}`),
  );
  bus.announceSchedule(holidaySentence(name, false, answer.moved.length, answer.finish));
}

/* --------------------------------------------------------------- baseline */

export async function saveBaseline(name: string, replace: boolean): Promise<void> {
  await run<unknown>(null, () =>
    api.post(`/api/projects/${state.project!.id}/baseline`, replace ? { name, replace: true } : { name }),
  );
  bus.announceSchedule(baselineSentence(name));
}

/* ------------------------------------------------------------ assignments */

export async function assign(item: Item, userId: string, name: string, hours: number): Promise<Item> {
  const answer = await run<{ item: Item }>(
    item.id,
    () => api.post(`/api/items/${item.id}/assignees`, { userId, hours }),
    item,
  ).catch((error: ActionFailure) => {
    if (error.code === 'already_assigned') throw new ActionFailure(alreadyAssignedMessage(name));
    throw error;
  });
  bus.announceSchedule(assignedSentence(name, item.name, formatHours(hours)));
  return answer.item;
}

export async function unassign(item: Item, userId: string, name: string): Promise<Item> {
  const answer = await run<{ item: Item }>(item.id, () =>
    api.del(`/api/items/${item.id}/assignees/${userId}`),
  );
  bus.announceSchedule(unassignedSentence(name, item.name));
  return answer.item;
}

/* --------------------------------------------------------------- comments */

export async function postComment(item: Item, text: string): Promise<void> {
  await run<unknown>(null, () => api.post(`/api/items/${item.id}/comments`, { text }));
  bus.announceSchedule('Comment posted.');
}

/* ---------------------------------------------------------------- exports */

export async function createExport(format: ExportFormat): Promise<void> {
  bus.announceExport(format === 'csv' ? 'Preparing the CSV export.' : 'Preparing the PDF export.');
  try {
    const answer = await api.post<{ filename: string }>(
      `/api/projects/${state.project!.id}/exports`,
      { format },
    );
    bus.announceExport(`${answer.filename} is ready to download.`);
  } catch (error) {
    bus.announceExport('');
    throw failureText(error, null);
  }
}
