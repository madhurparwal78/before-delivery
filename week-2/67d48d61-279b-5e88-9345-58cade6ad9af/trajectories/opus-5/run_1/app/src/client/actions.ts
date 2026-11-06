import { notice, rejection } from '../shared/copy.js';
import { crewName, type Priority, type Status } from '../shared/domain.js';
import type { ChangeResult, Snapshot, Task } from '../shared/types.js';
import { api, ApiFailure } from './api.js';
import { playCascade, playReverseCascade, reblockRows } from './cascade.js';
import {
  announce,
  applySnapshot,
  applyTasks,
  getState,
  setBusy,
  setState,
  taskById,
} from './store.js';

/** Changes this tab applied from its own reply, so the stream copy is ignored. */
const applied = new Set<number>();

export function markApplied(change: number): void {
  applied.add(change);
}

export function alreadyApplied(change: number): boolean {
  return applied.has(change);
}

export type TaskPatch = Partial<
  Pick<Task, 'status' | 'priority' | 'owner' | 'title' | 'details' | 'label' | 'cycle'>
>;

/** The listed tasks and the triage tasks, which the screens hold in one map. */
async function fetchTasks(): Promise<{ tasks: Map<string, Task>; snapshot: Snapshot }> {
  const [listed, triaged] = await Promise.all([api.tasks(), api.triageTasks()]);
  const tasks = new Map<string, Task>();
  for (const task of [...listed.tasks, ...triaged.tasks]) tasks.set(task.id, task);
  return { tasks, snapshot: listed.snapshot };
}

export async function loadAll(): Promise<void> {
  const [production, status, loaded] = await Promise.all([
    api.production(),
    api.status(),
    fetchTasks(),
  ]);
  setState({ production, status, tasks: loaded.tasks, snapshot: loaded.snapshot, loaded: true });
}

export async function reloadTasks(): Promise<void> {
  const loaded = await fetchTasks();
  setState({ tasks: loaded.tasks });
  applySnapshot(loaded.snapshot);
}

export async function loadDetail(id: string | null): Promise<void> {
  if (id === null) {
    setState({ activity: [], attachments: [] });
    return;
  }
  const [activity, attachments] = await Promise.all([api.activity(id), api.attachments(id)]);
  if (getState().address.task !== id) return;
  setState({ activity: activity.activity, attachments: attachments.attachments });
}

export async function loadRequests(): Promise<void> {
  try {
    const result = await api.requests();
    setState({ requests: result.requests, requestsDown: false });
  } catch (error) {
    if (error instanceof ApiFailure) setState({ requests: null, requestsDown: true });
  }
}

function applyResult(result: ChangeResult, changedId: string | null, announced: string): void {
  markApplied(result.change);
  applyTasks(result.tasks);
  applySnapshot(result.snapshot);
  playCascade(changedId, result.cascade);
  reblockRows(result.reblocked);
  announce(announced);
}

function statusNotice(id: string, result: ChangeResult, before: Map<string, Task>): string {
  const target = result.tasks.find((task) => task.id === id);
  const closed: string[] = [];
  const reopened: string[] = [];
  for (const task of result.tasks) {
    if (task.id === id) continue;
    const was = before.get(task.id);
    if (!was) continue;
    if (was.status !== 'done' && task.status === 'done') closed.push(task.id);
    if (was.status === 'done' && task.status !== 'done') reopened.push(task.id);
  }
  return notice.statusSingle(
    id,
    target?.status ?? 'todo',
    closed,
    reopened,
    result.cascade.length,
  );
}

function singleNotice(id: string, patch: TaskPatch, result: ChangeResult, before: Map<string, Task>): string {
  if (patch.status !== undefined) return statusNotice(id, result, before);
  if (patch.priority !== undefined) return notice.prioritySingle(id, patch.priority);
  if (patch.owner !== undefined) {
    return notice.ownerSingle(id, patch.owner === null ? null : crewName(patch.owner));
  }
  return notice.updatedSingle(id);
}

function singleRejection(error: ApiFailure, saved: Task, patch: TaskPatch): string {
  switch (error.code) {
    case 'version_conflict':
      return rejection.versionSingle(saved.id);
    case 'blocked_by_open':
      return rejection.blockedToDone(saved.id, error.blockedBy);
    case 'illegal_transition':
      return rejection.illegalMove(saved.id, saved.status, patch.status ?? saved.status);
    case 'open_subtasks':
      return rejection.openSubtasks(saved.id);
    case 'not_editable':
      return rejection.notEditable(saved.id, saved.status);
    case 'validation_failed':
      return Object.values(error.fields)[0] ?? rejection.network;
    default:
      return rejection.network;
  }
}

export async function editTask(id: string, patch: TaskPatch): Promise<void> {
  const saved = taskById(id);
  if (!saved) return;
  const before = new Map(getState().tasks);
  applyTasks([{ ...saved, ...patch }]);
  setBusy([id], true);
  try {
    const result = await api.patch(id, saved.version, patch as Record<string, unknown>);
    setBusy([id], false);
    applyResult(result, id, singleNotice(id, patch, result, before));
    if (getState().address.task === id) void loadDetail(id);
  } catch (error) {
    setBusy([id], false);
    if (!(error instanceof ApiFailure)) throw error;
    const current = error.current;
    applyTasks([current !== null && !Array.isArray(current) ? current : saved]);
    announce(singleRejection(error, saved, patch));
  }
}

export interface BulkSet {
  status?: Status;
  priority?: Priority;
  owner?: string | null;
}

export async function bulkSet(ids: string[], set: BulkSet): Promise<void> {
  const savedTasks = ids
    .map((id) => taskById(id))
    .filter((task): task is Task => task !== undefined);
  const only = savedTasks[0];
  if (only === undefined) return;
  if (savedTasks.length === 1) {
    await editTask(only.id, set);
    return;
  }
  applyTasks(savedTasks.map((task) => ({ ...task, ...set })));
  setBusy(ids, true);
  try {
    const result = await api.bulk(
      savedTasks.map((task) => ({ id: task.id, version: task.version })),
      set as Record<string, unknown>,
    );
    setBusy(ids, false);
    applyResult(
      result,
      savedTasks[savedTasks.length - 1]?.id ?? null,
      bulkNotice(savedTasks.length, set, result),
    );
    const open = getState().address.task;
    if (open !== null && ids.includes(open)) void loadDetail(open);
  } catch (error) {
    setBusy(ids, false);
    if (!(error instanceof ApiFailure)) throw error;
    const current = error.current;
    const restored = new Map(savedTasks.map((task) => [task.id, task]));
    if (Array.isArray(current)) for (const task of current) restored.set(task.id, task);
    applyTasks([...restored.values()]);
    announce(bulkRejection(error));
  }
}

function bulkNotice(count: number, set: BulkSet, result: ChangeResult): string {
  if (set.status !== undefined) {
    return notice.statusBulk(count, set.status, result.cascade.length);
  }
  if (set.priority !== undefined) return notice.priorityBulk(count, set.priority);
  return notice.ownerBulk(count, set.owner === null || set.owner === undefined ? null : crewName(set.owner));
}

function bulkRejection(error: ApiFailure): string {
  if (error.code === 'version_conflict') return rejection.versionBulk;
  if (error.code === 'network_error') return rejection.network;
  if (error.tasks.length > 0) return rejection.bulkRefused(error.tasks.length);
  return rejection.network;
}

export async function undoLast(): Promise<void> {
  setState({ saving: true });
  try {
    const result = await api.undo();
    setState({ saving: false });
    markApplied(result.change);
    applyTasks(result.tasks);
    applySnapshot(result.snapshot);
    playCascade(result.tasks[0]?.id ?? null, result.cascade);
    playReverseCascade(result.tasks[0]?.id ?? null, result.reblocked);
    announce(notice.undo(result.tasks.length, result.reblocked.length));
    const open = getState().address.task;
    if (open !== null) void loadDetail(open);
  } catch (error) {
    setState({ saving: false });
    if (!(error instanceof ApiFailure)) throw error;
    if (error.code === 'nothing_to_undo') announce(rejection.nothingToUndo);
    else if (error.code === 'undo_stale') announce(rejection.undoStale);
    else announce(rejection.network);
  }
}

export interface NewTaskFields {
  title: string;
  department: string;
  priority: Priority;
  owner: string | null;
  parent: string | null;
}

export async function createTask(fields: NewTaskFields): Promise<string | null> {
  setState({ saving: true, formErrors: {} });
  try {
    const result = await api.create({
      title: fields.title,
      department: fields.department,
      priority: fields.priority,
      owner: fields.owner,
      ...(fields.parent === null ? {} : { parent: fields.parent }),
    });
    setState({ saving: false });
    const created = result.tasks.reduce<Task | null>(
      (highest, task) => (highest === null || task.number > highest.number ? task : highest),
      null,
    );
    markApplied(result.change);
    applyTasks(result.tasks);
    applySnapshot(result.snapshot);
    if (created !== null) announce(notice.created(created.id));
    return created?.id ?? null;
  } catch (error) {
    setState({ saving: false });
    if (!(error instanceof ApiFailure)) throw error;
    if (error.code === 'validation_failed') setState({ formErrors: error.fields });
    else announce(rejection.network);
    return null;
  }
}

export async function addLink(blocker: string, blocked: string): Promise<boolean> {
  setState({ saving: true, formErrors: {} });
  try {
    const result = await api.addLink(blocker, blocked);
    setState({ saving: false });
    markApplied(result.change);
    applyTasks(result.tasks);
    applySnapshot(result.snapshot);
    announce(notice.linkAdded(blocker, blocked));
    const open = getState().address.task;
    if (open !== null) void loadDetail(open);
    return true;
  } catch (error) {
    setState({ saving: false });
    if (!(error instanceof ApiFailure)) throw error;
    if (error.code === 'relation_cycle') announce(rejection.linkCycle);
    else if (error.code === 'network_error') announce(rejection.network);
    else announce(rejection.linkOther);
    return false;
  }
}

export async function removeLink(blocker: string, blocked: string): Promise<void> {
  setState({ saving: true });
  try {
    const result = await api.removeLink(blocker, blocked);
    setState({ saving: false });
    markApplied(result.change);
    applyTasks(result.tasks);
    applySnapshot(result.snapshot);
    playCascade(blocker, result.cascade);
    announce(notice.linkRemoved(blocker, blocked));
    const open = getState().address.task;
    if (open !== null) void loadDetail(open);
  } catch (error) {
    setState({ saving: false });
    if (!(error instanceof ApiFailure)) throw error;
    announce(rejection.linkOther);
  }
}

export type DecisionBody =
  | { decision: 'accept'; department: string; priority: Priority; owner: string | null; label: string | null }
  | { decision: 'decline'; reason: string }
  | { decision: 'merge'; duplicate_of: string };

export async function decideRequest(id: string, body: DecisionBody): Promise<boolean> {
  setState({ saving: true, formErrors: {} });
  try {
    const result = await api.decide(id, body as unknown as Record<string, unknown>);
    setState({ saving: false });
    markApplied(result.change);
    applyTasks(result.tasks);
    applySnapshot(result.snapshot);
    let message: string;
    if (body.decision === 'accept') {
      const accepted = result.tasks.find((task) => task.id === id);
      message = notice.accepted(id, accepted?.cycle ?? 'rehearsal-1');
    } else if (body.decision === 'decline') {
      message = notice.declined(id);
    } else {
      message = notice.merged(id, body.duplicate_of);
    }
    if (result.snapshot.triage === 0) message += notice.triageClear;
    announce(message);
    return true;
  } catch (error) {
    setState({ saving: false });
    if (!(error instanceof ApiFailure)) throw error;
    if (error.code === 'validation_failed') setState({ formErrors: error.fields });
    else if (error.code === 'intake_unavailable') announce(rejection.intakeUnreachable(id));
    else if (error.code === 'intake_rejected') announce(rejection.intakeRefused(id));
    else if (error.code === 'already_decided') announce(rejection.alreadyDecided(id));
    else announce(rejection.network);
    return false;
  }
}

export async function uploadPlot(id: string, file: File, kind: string): Promise<void> {
  setState({ uploading: { name: file.name, percent: 0 } });
  try {
    await api.upload(id, file, kind, (percent) =>
      setState({ uploading: { name: file.name, percent } }),
    );
    setState({ uploading: null });
    await loadDetail(id);
    announce(notice.uploaded(file.name, id));
  } catch (error) {
    setState({ uploading: null });
    if (!(error instanceof ApiFailure)) throw error;
    if (error.code === 'storage_unavailable') announce(rejection.storageUnreachable(file.name));
    else announce(rejection.uploadInterrupted(file.name));
  }
}

export async function fileRequest(fields: {
  title: string;
  details: string;
  requester: string;
  department: string | null;
}): Promise<boolean> {
  setState({ saving: true, formErrors: {} });
  try {
    await api.fileRequest({
      title: fields.title,
      details: fields.details,
      requester: fields.requester,
      ...(fields.department === null ? {} : { department: fields.department }),
    });
    setState({ saving: false });
    announce(notice.requestFiled);
    void loadRequests();
    return true;
  } catch (error) {
    setState({ saving: false });
    if (!(error instanceof ApiFailure)) throw error;
    if (error.code === 'validation_failed') setState({ formErrors: error.fields });
    else announce(rejection.network);
    return false;
  }
}
