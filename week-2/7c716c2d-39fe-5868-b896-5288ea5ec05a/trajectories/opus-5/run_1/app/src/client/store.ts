import type {
  Billing,
  ChannelSummary,
  Person,
  ProjectSummary,
  ServiceStatus,
  Unread,
  Workspace,
} from '../shared/types.js';
import { copy } from './copy.js';

export type AppState = {
  person: Person | null;
  workspace: Workspace | null;
  status: ServiceStatus;
  unread: Unread;
  projects: ProjectSummary[];
  channels: ChannelSummary[];
  members: Person[];
  billing: Billing | null;
  currentCycle: number;
};

export const state: AppState = {
  person: null,
  workspace: null,
  status: { database: 'ok', mail: 'ok', storage: 'ok', billing: 'ok', held_mail: null },
  unread: { channels: {}, inbox: 0 },
  projects: [],
  channels: [],
  members: [],
  billing: null,
  currentCycle: 1,
};

export type StateKey = keyof AppState;

type Listener = (keys: Set<StateKey>) => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function update(changes: Partial<AppState>): void {
  const keys = new Set<StateKey>();
  for (const [key, value] of Object.entries(changes) as [StateKey, never][]) {
    state[key] = value;
    keys.add(key);
  }
  for (const listener of [...listeners]) listener(keys);
}

export function isOwner(): boolean {
  return state.person?.role === 'owner';
}

export function isGuest(): boolean {
  return state.person?.role === 'guest';
}

/** A person who has left the workspace still names their old assignments. */
export function nameOf(personId: string | null): string {
  if (personId === null) return 'Unassigned';
  const person = state.members.find((member) => member.id === personId);
  if (person !== undefined) return person.name;
  const known = unknownNames.get(personId);
  return known === undefined ? 'Someone' : copy.removedPerson(known);
}

const unknownNames = new Map<string, string>();

export function rememberName(personId: string, name: string): void {
  unknownNames.set(personId, name);
}

export function projectName(projectId: string): string {
  return state.projects.find((project) => project.id === projectId)?.name ?? '';
}

export function clearState(): void {
  update({
    person: null,
    workspace: null,
    unread: { channels: {}, inbox: 0 },
    projects: [],
    channels: [],
    members: [],
    billing: null,
  });
  unknownNames.clear();
}
