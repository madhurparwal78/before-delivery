import { useSyncExternalStore } from 'react';
import type {
  ActivityEntry,
  Attachment,
  IntakeRequest,
  Production,
  ServiceStatus,
  Snapshot,
  Task,
} from '../shared/types.js';
import { readAddress, type Address } from './address.js';

export interface FreedMark {
  order: number;
  depth: number;
  by: string;
}

export type DialogState =
  | { kind: 'none' }
  | { kind: 'drawer' }
  | { kind: 'new-task'; parent: string | null }
  | { kind: 'link'; task: string }
  | { kind: 'accept'; task: string }
  | { kind: 'decline'; task: string }
  | { kind: 'merge'; task: string }
  | { kind: 'file-request' };

export interface State {
  loaded: boolean;
  actor: string;
  production: Production | null;
  status: ServiceStatus;
  tasks: Map<string, Task>;
  snapshot: Snapshot | null;
  address: Address;
  selection: string[];
  current: string | null;
  anchor: string | null;
  notice: string;
  noticeKey: number;
  busy: string[];
  saving: boolean;
  requests: IntakeRequest[] | null;
  requestsDown: boolean;
  activity: ActivityEntry[];
  attachments: Attachment[];
  uploading: { name: string; percent: number } | null;
  freed: Map<string, FreedMark>;
  blockedDisplay: number | null;
  cascading: boolean;
  palette: { open: boolean; text: string };
  dialog: DialogState;
  formErrors: Record<string, string>;
  width: number;
  reducedMotion: boolean;
}

function initial(): State {
  return {
    loaded: false,
    actor: 'maya',
    production: null,
    status: { intake: 'up', plot_storage: 'up' },
    tasks: new Map(),
    snapshot: null,
    address: readAddress(),
    selection: [],
    current: null,
    anchor: null,
    notice: '',
    noticeKey: 0,
    busy: [],
    saving: false,
    requests: null,
    requestsDown: false,
    activity: [],
    attachments: [],
    uploading: null,
    freed: new Map(),
    blockedDisplay: null,
    cascading: false,
    palette: { open: false, text: '' },
    dialog: { kind: 'none' },
    formErrors: {},
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    reducedMotion:
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

let state: State = initial();
const listeners = new Set<() => void>();

export function getState(): State {
  return state;
}

export function setState(patch: Partial<State> | ((current: State) => Partial<State>)): void {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useApp(): State {
  return useSyncExternalStore(subscribe, getState, getState);
}

export function announce(message: string): void {
  setState((current) => ({ notice: message, noticeKey: current.noticeKey + 1 }));
}

export function taskById(id: string | null): Task | undefined {
  return id === null ? undefined : state.tasks.get(id);
}

/** Replaces tasks from a change result and drops their freed badges. */
export function applyTasks(tasks: Task[]): void {
  setState((current) => {
    const next = new Map(current.tasks);
    const freed = new Map(current.freed);
    for (const task of tasks) {
      next.set(task.id, task);
      freed.delete(task.id);
    }
    return { tasks: next, freed };
  });
}

export function setBlockedFlags(ids: string[], blocked: boolean): void {
  setState((current) => {
    const next = new Map(current.tasks);
    for (const id of ids) {
      const task = next.get(id);
      if (task) next.set(id, { ...task, blocked });
    }
    return { tasks: next };
  });
}

export function setBusy(ids: string[], busy: boolean): void {
  setState((current) => ({
    busy: busy
      ? [...new Set([...current.busy, ...ids])]
      : current.busy.filter((id) => !ids.includes(id)),
  }));
}

export function applySnapshot(snapshot: Snapshot): void {
  setState((current) =>
    current.snapshot !== null && snapshot.seq < current.snapshot.seq ? {} : { snapshot },
  );
}
